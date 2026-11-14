/**
 * 操作提示：根据当前遥测给出一句最相关的提示（面向没有航天知识的玩家）。
 * 纯函数，不依赖 React，便于测试。提示只读取界面上同样显示的遥测量。
 */
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { formatNumber } from '@/utils/format';

export interface FlightHint {
  readonly text: string;
  readonly tone: 'info' | 'warn';
}

/**
 * 根据当前物理状态给出一句操作提示（面向没有航天知识的玩家）。
 * 没有需要提示的情况时返回 null。
 */
export const flightHint = (t: Telemetry | null, vehicle: VehicleDefinition): FlightHint | null => {
  if (!t) return null;
  if (t.phase === 'prelaunch') {
    if (!t.ignited) return { text: '按 空格 点火起飞', tone: 'info' };
    if (t.throttle <= 0) return { text: '节流阀为 0：按 Z 或 ↑ 增大推力', tone: 'warn' };
    if (t.thrust > 0 && t.thrustToWeight <= 1) {
      return { text: `推力不足，无法离开发射台（推重比 ${formatNumber(t.thrustToWeight, 2)}）——增大节流`, tone: 'warn' };
    }
    return null;
  }
  if (t.phase !== 'flight') return null;
  const stage = vehicle.stages[t.activeStageIndex];
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
    return { text: `已在轨道上。按 空格 启动${stage.name}发动机，再用 Z / ↑ 给推力；按 M 查看轨道地图`, tone: 'info' };
  }
  if (stage && (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0) {
    return { text: `${stage.name}推进剂耗尽：按 空格 分离`, tone: 'warn' };
  }
  const orbit = t.orbit;
  if (orbit) {
    const burning = t.thrust > 0;
    // 入轨：近地点已经抬出大气层
    if (burning && orbit.classification === 'orbit' && orbit.periapsisAltitude > 140_000) {
      return { text: `近地点 ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km：已入轨，可以关机（X）`, tone: 'info' };
    }
    // 关机后停在稳定轨道上
    if (!burning && orbit.classification === 'orbit' && orbit.periapsisAltitude > 140_000 && (t.missionTime ?? 0) >= 20) {
      return {
        text: `轨道稳定：${formatNumber(orbit.periapsisAltitude / 1000, 0)} × ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km。按 M 查看轨道地图；顺行（R）/ 逆行（T）点火会抬高 / 降低轨道的另一侧`,
        tone: 'info',
      };
    }
    // 远地点已经够高但近地点还在大气层内或地下：到远地点附近再加速
    if (!burning && t.altitude > 70_000 && orbit.classification !== 'orbit' && orbit.classification !== 'escape' && orbit.apoapsisAltitude > 120_000) {
      const wait = orbit.timeToApoapsis;
      if (t.verticalSpeed > 0 && wait !== null && wait > 40) {
        return { text: `滑行中：约 ${formatNumber(wait, 0)} s 后到达远地点。到达前开启顺行保持（R）并点火，把近地点抬出大气层`, tone: 'info' };
      }
      if (t.verticalSpeed <= 0) return { text: '已过远地点且近地点过低：顺行点火可挽救，否则将再入大气层', tone: 'warn' };
    }
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
      return { text: '正在下降：把头部抬到地平线以上，先稳住高度，再继续加速', tone: 'warn' };
    }
    const manual = t.attitudeMode === 'manual' ? '' : '按 R 回到手动。';
    return {
      text: `${manual}用俯仰角控制垂直速度（升得太快就压低头部，反之抬高），让它在目标高度附近降到 0；近地点升到 150 km 以上即入轨（现在 ${formatNumber(orbit.periapsisAltitude / 1000, 0)} km）`,
      tone: 'info',
    };
  }
  if (t.ignited && t.throttle <= 0 && stage) return { text: '发动机已关机：按 Z 或 ↑ 恢复推力', tone: 'info' };
  if (t.altitude < 20_000 && t.verticalSpeed < -20) return { text: '正在下降，高度不足', tone: 'warn' };
  if (t.dynamicPressure > 5_000 && t.angleOfAttack > 0.35) return { text: '动压较大时迎角过大：让头部靠近速度方向', tone: 'warn' };
  if (t.missionTime !== null && t.missionTime < 12 && t.pitch > 1.55) {
    return { text: '速度达到约 60 m/s 后，按住 D 向东倾斜 2–3°（俯仰读数 87–88°）', tone: 'info' };
  }
  // 已经开始转弯、仍在稠密大气内、还在手动：把重力转弯交给顺行保持
  if (t.attitudeMode === 'manual' && t.thrust > 0 && t.altitude < 30_000 && t.surfaceSpeed > 60 && t.pitch < 1.553 && t.pitch > 1.2) {
    return { text: '已开始转弯：按 R 开启顺行保持，火箭会沿速度方向飞行，自动完成大气层内的重力转弯', tone: 'info' };
  }
  return null;
};
