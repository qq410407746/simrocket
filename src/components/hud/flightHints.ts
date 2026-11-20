/**
 * 操作提示：根据当前遥测给出一句最相关的提示（面向没有航天知识的玩家）。
 * 纯函数，不依赖 React，便于测试。提示只读取界面上同样显示的遥测量。
 */
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { dataText } from '@/i18n/dataText';
import { type Language, createTranslator } from '@/i18n/locale';
import { formatNumber } from '@/utils/format';
import { bankLabel, thermalZoneLabel } from './thermalLabels';

export interface FlightHint {
  readonly text: string;
  readonly tone: 'info' | 'warn';
}

/**
 * 根据当前物理状态给出一句操作提示（面向没有航天知识的玩家）。
 * 没有需要提示的情况时返回 null。
 */
export const flightHint = (t: Telemetry | null, vehicle: VehicleDefinition, language: Language = 'zh'): FlightHint | null => {
  const tr = createTranslator(language);
  if (!t) return null;
  if (t.phase === 'prelaunch') {
    if (!t.ignited) return { text: tr('按 空格 点火起飞', 'Press Space to ignite and lift off'), tone: 'info' };
    if (t.throttle <= 0) return { text: tr('节流阀为 0：按 Z 或 ↑ 增大推力', 'Throttle is 0: press Z or ↑ to increase thrust'), tone: 'warn' };
    if (t.thrust > 0 && t.thrustToWeight <= 1) {
      return { text: tr(`推力不足，无法离开发射台（推重比 ${formatNumber(t.thrustToWeight, 2)}）——增大节流`, `Not enough thrust to lift off (TWR ${formatNumber(t.thrustToWeight, 2)}) — increase throttle`), tone: 'warn' };
    }
    return null;
  }
  if (t.phase !== 'flight') return null;
  const stage = vehicle.stages[t.activeStageIndex];
  const stageName = stage ? dataText(stage.name, language) : '';
  const returning = returnHint(t, vehicle, language);
  if (returning) return returning;
  // 发动机尚未启用（从轨道开始，或飞船发动机）
  if (
    !t.ignited &&
    t.thrust === 0 &&
    t.orbit?.classification === 'orbit' &&
    t.missionTime !== null &&
    t.missionTime < 20 &&
    stage &&
    (t.stagePropellant[t.activeStageIndex] ?? 0) > 0
  ) {
    return { text: tr(`已在轨道上。按 空格 启动${stageName}发动机，再用 Z / ↑ 给推力；按 M 查看轨道地图`, `Already in orbit. Press Space to enable the ${stageName} engine, then Z / ↑ for thrust; press M for the orbit map`), tone: 'info' };
  }
  if (stage?.parallel && (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0) {
    return { text: tr(`${stageName}已烧完：按 空格 抛掉，芯级继续工作`, `${stageName} burned out: press Space to jettison them; the core stage keeps burning`), tone: 'warn' };
  }
  if (stage && (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0) {
    return { text: tr(`${stageName}推进剂耗尽：按 空格 分离`, `${stageName} propellant depleted: press Space to separate`), tone: 'warn' };
  }
  const orbit = t.orbit;
  if (orbit) {
    const burning = t.thrust > 0;
    // 入轨：近地点已经抬出大气层（逆行点火是在降低轨道，不提示"已入轨"）
    if (burning && t.attitudeMode !== 'retrograde' && orbit.classification === 'orbit' && orbit.periapsisAltitude > 140_000) {
      return { text: tr(`近地点 ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km：已入轨，可以关机（X）`, `Periapsis ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km: orbit achieved; shut down the engine (X)`), tone: 'info' };
    }
    // 关机后停在稳定轨道上
    if (!burning && orbit.classification === 'orbit' && orbit.periapsisAltitude > 140_000 && (t.missionTime ?? 0) >= 20) {
      return {
        text: tr(`轨道稳定：${formatNumber(orbit.periapsisAltitude / 1000, 0)} × ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km。按 M 查看轨道地图；顺行（R）/ 逆行（T）点火会抬高 / 降低轨道的另一侧`, `Stable orbit: ${formatNumber(orbit.periapsisAltitude / 1000, 0)} × ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km. Press M for the orbit map; prograde (R) / retrograde (T) burns raise / lower the opposite side of the orbit`),
        tone: 'info',
      };
    }
    // 远地点已经够高但近地点还在大气层内或地下：到远地点附近再加速
    if (!burning && t.altitude > 70_000 && orbit.classification !== 'orbit' && orbit.classification !== 'escape' && orbit.apoapsisAltitude > 120_000) {
      const wait = orbit.timeToApoapsis;
      // 还有没有推进剂可用：没有的话（例如已经分离出来的无动力返回舱）只能沿弹道飞完
      const powered = t.remainingDeltaV > 1;
      if (t.verticalSpeed > 0 && wait !== null && wait > 40) {
        return powered
          ? { text: tr(`滑行中：约 ${formatNumber(wait, 0)} s 后到达远地点。到达前开启顺行保持（R）并点火，把近地点抬出大气层`, `Coasting: apoapsis in about ${formatNumber(wait, 0)} s. Enable prograde hold (R) and burn before arrival to raise periapsis above the atmosphere`), tone: 'info' }
          : {
              text: tr(`靠惯性上升中：约 ${formatNumber(wait, 0)} s 后到达最高点（约 ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km），之后落回大气层`, `Coasting upward: highest point in about ${formatNumber(wait, 0)} s (about ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km), then falling back into the atmosphere`),
              tone: 'info',
            };
      }
      if (t.verticalSpeed <= 0) {
        // 带返回舱的飞行器：这也是一条返回轨道
        if (vehicle.payload.kind === 'capsule') {
          const separate = stage ? tr(`按 空格 分离${stageName}，`, `press Space to separate ${stageName}, then `) : '';
          return {
            text: tr(`近地点在大气层内：将再入大气层。准备返回：${separate}按 T 让防热大底朝前${powered ? '；想留在轨道上则顺行点火' : ''}`, `Periapsis is inside the atmosphere: reentry ahead. Prepare to return: ${separate}press T to point the heat shield forward${powered ? '; burn prograde instead to stay in orbit' : ''}`),
            tone: 'warn',
          };
        }
        return { text: powered ? tr('已过远地点且近地点过低：顺行点火可挽救，否则将再入大气层', 'Past apoapsis with periapsis too low: burn prograde to recover, or reenter the atmosphere') : tr('已过最高点：将落回大气层', 'Past the highest point: falling back into the atmosphere'), tone: 'warn' };
      }
    }
  }
  // 上升段的结构与热警告
  if (t.bendingLoad > 0.6 * t.structure.maxBendingLoad) {
    return { text: tr('横向气动载荷接近结构限值：让头部贴近速度方向（顺行保持 R），否则箭体会折断', 'Aerodynamic bending load near the structural limit: align the nose with velocity (prograde hold R) to avoid breakup'), tone: 'warn' };
  }
  if (t.dynamicPressure > 0.85 * t.structure.maxDynamicPressure) {
    return { text: tr('动压接近结构限值：在稠密大气里飞得太快', 'Dynamic pressure near the structural limit: flying too fast in dense air'), tone: 'warn' };
  }
  const critical = t.thermal[t.criticalZone];
  if (critical && critical.margin < 0.3 && critical.heatFlux > 5_000) {
    const zone = thermalZoneLabel(critical, language);
    const material = dataText(critical.material, language);
    return { text: tr(`${zone}温度过高（${material}）：在大气层里飞得太低、太快`, `${zone} overheating (${material}): flying too low and too fast in the atmosphere`), tone: 'warn' };
  }
  // 上面级飞行（第一级已经分离）：用俯仰角管理垂直速度，把水平速度加到入轨。
  // 第一级还在工作时不提示——那时只需要等它烧完。
  if (
    orbit &&
    t.thrust > 0 &&
    t.activeStageIndex > 0 &&
    t.altitude > 60_000 &&
    (orbit.classification === 'suborbital' || orbit.classification === 'atmospheric')
  ) {
    if (t.verticalSpeed < -30 && t.altitude < 160_000) {
      return { text: tr('正在下降：把头部抬到地平线以上，先稳住高度，再继续加速', 'Descending: raise the nose above the horizon to stabilize altitude before accelerating further'), tone: 'warn' };
    }
    const manual = t.attitudeMode === 'manual' ? '' : tr('按 R 回到手动。', 'Press R to return to manual control. ');
    return {
      text: tr(`${manual}用俯仰角控制垂直速度（升得太快就压低头部，反之抬高），让它在目标高度附近降到 0；近地点升到 150 km 以上即入轨（现在 ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km）`, `${manual}Use pitch to control vertical speed: lower the nose if climbing too fast, or raise it otherwise. Bring vertical speed to 0 near the target altitude; orbit is achieved above 150 km periapsis (now ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km)`),
      tone: 'info',
    };
  }
  // 上升段过载过高、发动机又能节流（例如 RD-180 可以收到 47%）：提示收节流
  if (stage && t.thrust > 0 && t.gLoad > 5 && stage.engine.minThrottle < 1 && t.throttle > stage.engine.minThrottle + 0.01 && t.altitude > 20_000) {
    const minimum = formatNumber(stage.engine.minThrottle * 100, 0);
    return { text: tr(`过载 ${formatNumber(t.gLoad, 1)} g：按 ↓ 收小节流（${stageName}最低 ${minimum}%）`, `G-load ${formatNumber(t.gLoad, 1)} g: press ↓ to throttle down (${stageName} minimum ${minimum}%)`), tone: 'info' };
  }
  if (t.ignited && t.throttle <= 0 && stage) return { text: tr('发动机已关机：按 Z 或 ↑ 恢复推力', 'Engine shut down: press Z or ↑ to restore thrust'), tone: 'info' };
  if (t.altitude < 20_000 && t.verticalSpeed < -20) return { text: tr('正在下降，高度不足', 'Descending with insufficient altitude'), tone: 'warn' };
  // 推重比低的火箭（例如宇宙神 V 401，约 1.2）要晚一些、轻一些地倾斜，否则重力把轨迹压得太平
  const sluggish = t.activeStageIndex === 0 && t.thrustToWeight > 0 && t.thrustToWeight < 1.3;
  if (sluggish && t.missionTime !== null && t.missionTime < 45 && t.pitch > 1.55) {
    return { text: tr('推重比低：速度达到约 100 m/s 后，按住 D 向东倾斜约 1°（俯仰读数 89°）', 'Low thrust-to-weight: at about 100 m/s, hold D to tilt east by about 1° (pitch reading 89°)'), tone: 'info' };
  }
  if (!sluggish && t.missionTime !== null && t.missionTime < 12 && t.pitch > 1.55) {
    return { text: tr('速度达到约 60 m/s 后，按住 D 向东倾斜 2–3°（俯仰读数 87–88°）', 'At about 60 m/s, hold D to tilt east by 2–3° (pitch reading 87–88°)'), tone: 'info' };
  }
  // 已经开始转弯、仍在稠密大气内、还在手动：把重力转弯交给顺行保持
  if (t.attitudeMode === 'manual' && t.thrust > 0 && t.altitude < 30_000 && t.surfaceSpeed > 60 && t.pitch < 1.553 && t.pitch > 1.2) {
    return { text: tr('已开始转弯：按 R 开启顺行保持，火箭会沿速度方向飞行，自动完成大气层内的重力转弯', 'Turn started: press R for prograde hold. The rocket will follow its velocity and complete the atmospheric gravity turn automatically'), tone: 'info' };
  }
  return null;
};

/** 提示开伞的高度上限 [m]，以及开始提示"等待开伞"的高度 [m]。 */
const CHUTE_HINT_ALTITUDE = 12_000;
const CHUTE_WAIT_ALTITUDE = 30_000;
/** 相对地面的速度高于该值 [m/s] 时按"再入"给提示，低于它按"等待开伞"给提示。 */
const REENTRY_SPEED = 1_000;

/** 迎角大于该值 [rad] 视为"防热大底朝前"（大底正对来流时迎角为 180°；配平再入时约 160°）。 */
const SHIELD_FORWARD_ANGLE = (150 * Math.PI) / 180;

/**
 * 返回阶段的提示：再入前的准备、再入中的状态、开伞。
 * 不处于返回过程时返回 null，由调用方继续给出其他提示。
 */
const returnHint = (t: Telemetry, vehicle: VehicleDefinition, language: Language = 'zh'): FlightHint | null => {
  const tr = createTranslator(language);
  // —— 降落伞 ——
  const chute = t.parachute.phase;
  // 大底已经抛掉，却还有明显的气动加热：舱底没有防热能力
  if (!t.heatShieldAttached && vehicle.payload.kind === 'capsule' && t.referenceHeatFlux > 10_000) {
    return { text: tr('防热大底已抛掉，舱底结构正直接受热：无法承受再入', 'Heat shield jettisoned: exposed capsule structure is heating directly and cannot withstand reentry'), tone: 'warn' };
  }
  if (chute === 'main') {
    const descent = tr(`主伞已张开：下降速度 ${formatNumber(Math.abs(t.verticalSpeed), 0)} m/s`, `Main parachute open: descent speed ${formatNumber(Math.abs(t.verticalSpeed), 0)} m/s`);
    return t.canJettisonHeatShield
      ? { text: tr(`${descent}。可以按 H 抛掉防热大底：减轻质量，落得更慢`, `${descent}. You can press H to jettison the heat shield: less mass means a slower descent`), tone: 'info' }
      : { text: tr(`${descent}，等待着陆`, `${descent}; awaiting landing`), tone: 'info' };
  }
  if (chute === 'drogue') return { text: tr('减速伞工作中：动压降低后主伞自动打开', 'Drogue parachute working: the main parachute opens automatically as dynamic pressure drops'), tone: 'info' };
  const descending = t.verticalSpeed < 0;
  if (chute === 'lost' && descending && t.altitude < 30_000) return { text: tr('降落伞已损毁：无法减速着陆', 'Parachute destroyed: unable to slow down for landing'), tone: 'warn' };
  const limits = t.parachuteLimits;
  if (chute === 'stowed' && limits && descending && t.altitude < CHUTE_HINT_ALTITUDE) {
    if (t.mach <= limits.mach && t.dynamicPressure <= limits.dynamicPressure) {
      return { text: tr(`已降到亚声速（高度 ${formatNumber(t.altitude / 1000, 1)} km）：按 G 开伞`, `Now subsonic (altitude ${formatNumber(t.altitude / 1000, 1)} km): press G to deploy the parachute`), tone: t.altitude < 4_000 ? 'warn' : 'info' };
    }
    return { text: tr(`等速度降到马赫 ${limits.mach} 以下再开伞（现在马赫 ${formatNumber(t.mach, 2)}）`, `Wait until below Mach ${limits.mach} before deploying the parachute (now Mach ${formatNumber(t.mach, 2)})`), tone: 'info' };
  }
  // 减速已经结束、还没降到开伞高度：告诉玩家在等什么（否则只会看到"正在下降"）
  if (chute === 'stowed' && limits && descending && t.altitude < CHUTE_WAIT_ALTITUDE && t.surfaceSpeed <= REENTRY_SPEED) {
    return {
      text: tr(`继续下落：降到 ${CHUTE_HINT_ALTITUDE / 1000} km 以下、马赫 ${limits.mach} 以下时按 G 开伞（现在 ${formatNumber(t.altitude / 1000, 1)} km，马赫 ${formatNumber(t.mach, 2)}）`, `Keep descending: below ${CHUTE_HINT_ALTITUDE / 1000} km and Mach ${limits.mach}, press G to deploy the parachute (now ${formatNumber(t.altitude / 1000, 1)} km, Mach ${formatNumber(t.mach, 2)})`),
      tone: 'info',
    };
  }

  // —— 再入 ——
  const orbit = t.orbit;
  const entering =
    t.thrust === 0 &&
    descending &&
    t.altitude < 140_000 &&
    t.surfaceSpeed > REENTRY_SPEED &&
    orbit !== null &&
    (orbit.classification === 'suborbital' || orbit.classification === 'atmospheric');
  if (!entering || vehicle.payload.kind !== 'capsule') return null;

  const stage = vehicle.stages[t.activeStageIndex];
  if (stage) {
    const name = dataText(stage.name, language);
    return { text: tr(`即将再入：按 空格 分离${name}——只有返回舱的防热大底能承受再入加热`, `Reentry ahead: press Space to separate ${name} — only the capsule heat shield can withstand reentry heating`), tone: 'warn' };
  }
  const canTrim = t.trimAngle > 0;
  if (t.angleOfAttack < SHIELD_FORWARD_ANGLE) {
    return {
      text: tr(`防热大底没有朝前：按 T 开启逆行保持${canTrim ? '（或按 Y 配平再入）' : ''}，否则舱顶与侧壁会被烧毁`, `Heat shield is not facing forward: press T for retrograde hold${canTrim ? ' (or Y for trimmed reentry)' : ''}, or the capsule nose and sidewalls will burn up`),
      tone: 'warn',
    };
  }
  if (t.gLoad > 0.8 * t.structure.maxGLoad) {
    return { text: tr(`过载 ${formatNumber(t.gLoad, 1)} g，接近结构限值 ${formatNumber(t.structure.maxGLoad, 0)} g：再入角过陡`, `G-load ${formatNumber(t.gLoad, 1)} g, near the structural limit of ${formatNumber(t.structure.maxGLoad, 0)} g: reentry angle too steep`), tone: 'warn' };
  }
  const shield = t.thermal.find((zone) => zone.zone === 'base');
  if (shield && shield.margin < 0.25) {
    return { text: tr(`防热大底余量不足（烧蚀层剩余 ${formatNumber(shield.ablatorFraction * 100, 0)}%）`, `Heat shield margin low (${formatNumber(shield.ablatorFraction * 100, 0)}% ablator remaining)`), tone: 'warn' };
  }
  if (t.altitude < 45_000) {
    return { text: tr(`减速中：马赫 ${formatNumber(t.mach, 1)}，过载 ${formatNumber(t.gLoad, 1)} g。降到亚声速（约 10 km 高度）后按 G 开伞`, `Decelerating: Mach ${formatNumber(t.mach, 1)}, G-load ${formatNumber(t.gLoad, 1)} g. Once subsonic (about 10 km altitude), press G to deploy the parachute`), tone: 'info' };
  }
  const trimming = t.attitudeMode === 'trim';
  if (t.referenceHeatFlux > 50_000 && shield) {
    const lift = trimming
      ? tr(`配平再入（升阻比 ${formatNumber(t.liftToDrag, 2)}，倾侧 ${bankLabel(t.bankAngle, language)}）：Q / E 改变升力方向。`, `Trimmed reentry (L/D ${formatNumber(t.liftToDrag, 2)}, bank ${bankLabel(t.bankAngle, language)}): Q / E changes lift direction. `)
      : tr('保持防热大底朝前。', 'Keep the heat shield forward. ');
    return {
      text: tr(`再入中：${lift}过载 ${formatNumber(t.gLoad, 1)} g，烧蚀层剩余 ${formatNumber(shield.ablatorFraction * 100, 0)}%；降到亚声速后按 G 开伞`, `Reentry: ${lift}G-load ${formatNumber(t.gLoad, 1)} g, ${formatNumber(shield.ablatorFraction * 100, 0)}% ablator remaining; press G once subsonic to deploy the parachute`),
      tone: 'info',
    };
  }
  if (trimming) {
    return { text: tr(`即将再入大气层：配平再入，倾侧 ${bankLabel(t.bankAngle, language)}。升力向上过载最小；降到亚声速后按 G 开伞`, `Atmospheric entry ahead: trimmed reentry, bank ${bankLabel(t.bankAngle, language)}. Lift up minimizes G-load; press G once subsonic to deploy the parachute`), tone: 'info' };
  }
  return {
    text: tr(`即将再入大气层：保持逆行（防热大底朝前）${canTrim ? '；按 Y 改为配平再入，利用升力把过载从约 8 g 降到约 4 g' : ''}；降到亚声速后按 G 开伞`, `Atmospheric entry ahead: Keep retrograde (heat shield forward)${canTrim ? '; press Y for trimmed reentry, using lift to reduce G-load from about 8 g to about 4 g' : ''}; press G once subsonic to deploy the parachute`),
    tone: 'info',
  };
};
