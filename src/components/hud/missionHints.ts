/**
 * 任务相关的操作提示（教学提示）：在通用提示（flightHints.ts）的基础上，结合任务目标给出更具体的一句话。
 * 纯函数，不依赖 React。按键与方向的换算来自 game/missions/guidance.ts（与测试驾驶员共用）。
 *
 * 优先级：通用提示里的警告（结构、过热、推进剂耗尽、再入姿态……）优先；
 * 其余时候任务提示优先，没有任务提示再回到通用提示。
 */
import { type LaunchGuidance, comboLabel, compassLabel, launchGuidance } from '@/game/missions/guidance';
import { ORBIT_CONFIRM_TIME, missionOrbitRequirement, orbitMeets } from '@/game/missions/tracker';
import type { MissionDefinition, MissionState, OrbitRequirement } from '@/game/missions/types';
import { RAD2DEG } from '@/game/physics/constants';
import type { OrbitTelemetry, Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { formatNumber } from '@/utils/format';
import { type FlightHint, flightHint } from './flightHints';

const km = (meters: number): string => formatNumber(meters / 1000, 0);
const degrees = (radians: number, digits = 1): string => formatNumber(radians * RAD2DEG, digits);

const pending = (mission: MissionDefinition, state: MissionState, kind: 'orbit' | 'land-capsule' | 'reach-altitude'): boolean =>
  state.objectives.some((objective, i) => objective.status === 'pending' && mission.objectives[i]?.spec.kind === kind);

/** 倾角偏差超过该值 [rad] 才提示修正（约 0.3°）。 */
const INCLINATION_HINT_THRESHOLD = 0.3 / RAD2DEG;

/** 倾角修正的提示；不需要修正时返回 null。 */
const inclinationAdvice = (orbit: OrbitTelemetry, requirement: OrbitRequirement, guidance: LaunchGuidance): string | null => {
  const target = requirement.inclination?.target;
  if (target === undefined) return null;
  const error = target - orbit.inclination;
  if (Math.abs(error) < INCLINATION_HINT_THRESHOLD) return null;
  const keys = comboLabel(error > 0 ? guidance.increaseInclination : guidance.decreaseInclination);
  return `倾角 ${degrees(orbit.inclination)}°，目标 ${degrees(target)}°：点按 ${keys} 修正航向（差得多就多偏一些，接近了回正）`;
};

/** 上升段（第一级工作期间）的任务提示。 */
const ascentHint = (t: Telemetry, mission: MissionDefinition, guidance: LaunchGuidance): FlightHint | null => {
  if (t.activeStageIndex !== 0 || t.thrust <= 0) return null;
  const pitch = t.pitch * RAD2DEG;
  const ascent = mission.ascent;
  if (ascent?.kind === 'vertical') {
    if (pitch < 86) return { text: '这次任务全程竖直：箭体已经倾斜，最大高度会降低', tone: 'warn' };
    return { text: '保持竖直上升（不要按姿态键），等发动机燃尽——约两分钟', tone: 'info' };
  }
  const keys = comboLabel(guidance.lower);
  const direction = compassLabel(guidance.keyHeadingDeg);
  if (ascent?.kind === 'kick') {
    if (t.attitudeMode !== 'manual' || pitch < 90 - ascent.minAngleDeg) return null;
    if (t.surfaceSpeed < ascent.speed) {
      return { text: `先保持竖直：速度到 ${ascent.speed} m/s 再倾斜（现在 ${formatNumber(t.surfaceSpeed, 0)} m/s）。太早倾斜会在稠密大气里飞得过低过快`, tone: 'info' };
    }
    return {
      text: `按住 ${keys} 向${direction}倾斜 ${ascent.minAngleDeg}–${ascent.maxAngleDeg}°（俯仰读数 ${90 - ascent.maxAngleDeg}–${90 - ascent.minAngleDeg}°），松开后按 R 开启顺行保持`,
      tone: 'info',
    };
  }
  // 标准的重力转弯：只有不是向正东发射时才需要改写通用提示里的方向
  if (guidance.keyHeadingDeg !== 90 && t.missionTime !== null && t.missionTime < 12 && t.pitch > 1.55) {
    return {
      text: `速度达到约 60 m/s 后，按住 ${keys} 向${direction}倾斜约 2°（俯仰读数 88°，航向约 ${String(Math.round(guidance.keyHeadingDeg)).padStart(3, '0')}°）`,
      tone: 'info',
    };
  }
  return null;
};

/** 入轨目标尚未完成时的提示：上面级点火中、关机后。 */
const orbitHint = (
  t: Telemetry,
  state: MissionState,
  requirement: OrbitRequirement,
  guidance: LaunchGuidance,
): FlightHint | null => {
  const orbit = t.orbit;
  if (!orbit) return null;
  const meets = orbitMeets(orbit, requirement);
  const minimum = km(requirement.minPeriapsis);
  if (t.thrust > 0) {
    if (t.activeStageIndex === 0) return null;
    if (meets) return { text: `轨道已满足要求（近地点 ${km(orbit.periapsisAltitude)} km）：按 X 关机，保持 ${ORBIT_CONFIRM_TIME} 秒确认`, tone: 'info' };
    const steer = orbit.classification === 'escape' ? null : inclinationAdvice(orbit, requirement, guidance);
    const eastward = guidance.keyHeadingDeg === 90;
    // 近地点已经出了大气层但还不到要求的高度：通用提示会说"可以关机"，这里纠正
    if (orbit.classification === 'orbit' && orbit.periapsisAltitude < requirement.minPeriapsis) {
      return { text: `${steer ? `${steer}。` : ''}近地点 ${km(orbit.periapsisAltitude)} km：升到 ${minimum} km 再关机`, tone: 'info' };
    }
    if (orbit.classification === 'orbit' && orbit.apoapsisAltitude > requirement.maxApoapsis) {
      return { text: `远地点 ${km(orbit.apoapsisAltitude)} km，超过 ${km(requirement.maxApoapsis)} km 的上限：按 X 关机，之后在近地点附近逆行点火把它降下来`, tone: 'warn' };
    }
    if (steer) return { text: `${steer}；近地点升到 ${minimum} km 后关机（现在 ${km(orbit.periapsisAltitude)} km）`, tone: 'info' };
    if (!eastward && t.altitude > 60_000 && (orbit.classification === 'suborbital' || orbit.classification === 'atmospheric') && t.verticalSpeed >= -30) {
      const manual = t.attitudeMode === 'manual' ? '' : '按 R 回到手动。';
      return {
        text: `${manual}用 ${comboLabel(guidance.lower)} 压低头部、${comboLabel(guidance.raise)} 抬高头部来控制垂直速度，让它在目标高度附近降到 0；近地点升到 ${minimum} km 后关机（现在 ${km(orbit.periapsisAltitude)} km）`,
        tone: 'info',
      };
    }
    return null;
  }
  // —— 发动机关着 ——
  if (state.orbitHoldSince !== null) {
    const remaining = Math.max(0, ORBIT_CONFIRM_TIME - (t.simTime - state.orbitHoldSince));
    return { text: `轨道确认中：保持关机，还需 ${formatNumber(remaining, 0)} 秒`, tone: 'info' };
  }
  if (orbit.classification !== 'orbit') return null;
  if (orbit.periapsisAltitude < requirement.minPeriapsis) {
    return { text: `近地点 ${km(orbit.periapsisAltitude)} km，低于要求的 ${minimum} km：滑行到远地点附近，开启顺行保持（R）再点火`, tone: 'info' };
  }
  if (orbit.apoapsisAltitude > requirement.maxApoapsis) {
    return { text: `远地点 ${km(orbit.apoapsisAltitude)} km，超过 ${km(requirement.maxApoapsis)} km 的上限：在近地点附近开启逆行保持（T）点火，把远地点降下来`, tone: 'info' };
  }
  const { inclination } = requirement;
  if (inclination && Math.abs(orbit.inclination - inclination.target) > inclination.tolerance) {
    return {
      text: `倾角 ${degrees(orbit.inclination)}°，要求 ${degrees(inclination.target)}° ± ${degrees(inclination.tolerance, 0)}°。入轨后修正倾角很费推进剂（每度约 140 m/s）：在轨道与赤道的交点附近用 法向 / 反法向 保持并点火，看倾角读数朝哪边变`,
      tone: 'warn',
    };
  }
  return null;
};

/** 返回目标尚未完成、且仍在稳定轨道上时的提示：离轨。 */
const deorbitHint = (t: Telemetry, vehicle: VehicleDefinition): FlightHint | null => {
  const orbit = t.orbit;
  if (!orbit || vehicle.payload.kind !== 'capsule') return null;
  const stage = vehicle.stages[t.activeStageIndex];
  if (t.thrust > 0) {
    // 逆行点火中：近地点正在下降
    if (t.attitudeMode !== 'retrograde') return null;
    if (orbit.periapsisAltitude < -300_000) {
      return { text: `近地点 ${km(orbit.periapsisAltitude)} km，已经很低：再入角会很陡、过载更大——按 X 关机`, tone: 'warn' };
    }
    if (orbit.periapsisAltitude <= 50_000) return { text: `近地点 ${km(orbit.periapsisAltitude)} km：按 X 关机，然后按 空格 分离${stage?.name ?? '推进级'}`, tone: 'info' };
    return { text: `离轨点火中：近地点 ${km(orbit.periapsisAltitude)} km，降到 0–50 km 后按 X 关机`, tone: 'info' };
  }
  if (orbit.classification !== 'orbit') return null;
  if (t.attitudeMode !== 'retrograde') return { text: '任务：返回地球。按 T 开启逆行保持，等箭体调头（可以用 . 加快时间）', tone: 'info' };
  const engine = stage ? `${stage.name}` : '飞船';
  return {
    text: t.ignited
      ? `逆行保持中：箭体调头后按 Z 点火，把近地点降到 0–50 km`
      : `逆行保持中：箭体调头后按 空格 启动${engine}发动机，再按 Z 点火，把近地点降到 0–50 km`,
    tone: 'info',
  };
};

/**
 * 任务飞行中的操作提示。没有任务（自由飞行）时就是通用提示。
 * @param latitude 发射场纬度 [rad]（用来计算发射方位）
 */
export const missionFlightHint = (
  t: Telemetry | null,
  vehicle: VehicleDefinition,
  mission: MissionDefinition | null,
  state: MissionState | null,
  latitude: number,
): FlightHint | null => {
  const generic = flightHint(t, vehicle);
  if (!t || !mission || !state || state.status !== 'active' || t.phase !== 'flight') return generic;
  if (generic?.tone === 'warn') return generic;

  const guidance = launchGuidance(mission, latitude);
  const ascent = ascentHint(t, mission, guidance);
  if (ascent) return ascent;

  const requirement = missionOrbitRequirement(mission);
  if (requirement && pending(mission, state, 'orbit')) {
    const hint = orbitHint(t, state, requirement, guidance);
    if (hint) return hint;
  } else if (pending(mission, state, 'land-capsule')) {
    const hint = deorbitHint(t, vehicle);
    if (hint) return hint;
    // 倾斜飞行的亚轨道任务：返回舱分离后提醒开启逆行保持
    const alone = t.stageAttached.every((attached) => !attached);
    if (alone && mission.ascent?.kind === 'kick' && t.attitudeMode !== 'retrograde' && t.parachute.phase === 'stowed' && t.altitude > 20_000) {
      return { text: '返回舱已分离：按 T 开启逆行保持，下落时防热大底才会一直朝前', tone: 'info' };
    }
  }
  return generic;
};
