/**
 * 任务判定：根据遥测、统计量与飞行结果推进任务状态。
 *
 * 纯函数（状态归约）：updateMission(任务, 旧状态, 输入) → 新状态；没有变化时返回同一个对象。
 * 输入全部来自物理线程——任务系统只做"读数是否满足条件"的判断，不参与任何物理计算。
 *
 * 采样率的影响：界面以约 10 Hz 调用（高时间倍率下相邻两次调用可能相隔上百秒模拟时间）。
 * 判定只使用不会被采样错过的量：
 *   - 最大高度取物理线程逐步累计的统计量（stats.maxAltitude），而不是当前高度；
 *   - 轨道目标要求"关机后连续满足一段时间"，持续性的状态不会被错过；
 *   - 着陆 / 损毁来自飞行结果（outcome），它一旦出现就不再变化。
 */
import type { FlightOutcome, FlightStats } from '../simulation/types';
import type { OrbitTelemetry, Telemetry } from '../telemetry/telemetry';
import type {
  ConfirmedOrbit,
  MissionDefinition,
  MissionFailure,
  MissionMetrics,
  MissionState,
  ObjectiveSpec,
  ObjectiveState,
  ObjectiveStatus,
  OrbitRequirement,
} from './types';

/** 轨道目标需要在发动机关机后连续满足这么久（模拟时间）[s] 才算确认。 */
export const ORBIT_CONFIRM_TIME = 10;

/** 剩余 Δv 低于该值 [m/s] 视为推进剂耗尽。 */
const DEPLETED_DELTA_V = 1;

export interface MissionInput {
  readonly telemetry: Telemetry;
  readonly stats: FlightStats;
  readonly outcome: FlightOutcome | null;
}

export const createMissionState = (mission: MissionDefinition): MissionState => ({
  status: 'active',
  objectives: mission.objectives.map((objective) => ({ id: objective.id, status: 'pending', resolvedAt: null })),
  failure: null,
  endedAt: null,
  orbitHoldSince: null,
  confirmedOrbit: null,
  minAblatorFraction: null,
});

/** 轨道是否满足要求（只看轨道本身，不管发动机是否在工作）。 */
export const orbitMeets = (orbit: OrbitTelemetry | null, requirement: OrbitRequirement): boolean => {
  if (!orbit || orbit.classification !== 'orbit') return false;
  if (orbit.periapsisAltitude < requirement.minPeriapsis || orbit.apoapsisAltitude > requirement.maxApoapsis) return false;
  const { inclination } = requirement;
  return !inclination || Math.abs(orbit.inclination - inclination.target) <= inclination.tolerance;
};

/** 返回舱是否已经与所有推进级分离。 */
const capsuleAlone = (telemetry: Telemetry): boolean => telemetry.stageAttached.every((attached) => !attached);

const orbitSpecOf = (mission: MissionDefinition): (OrbitRequirement & { readonly kind: 'orbit' }) | null => {
  for (const objective of mission.objectives) if (objective.spec.kind === 'orbit') return objective.spec;
  return null;
};

/** 任务的轨道要求（没有轨道目标时为 null）。 */
export const missionOrbitRequirement = (mission: MissionDefinition): OrbitRequirement | null => orbitSpecOf(mission);

/**
 * 单个目标在当前输入下的结论；orbitConfirmed 表示轨道保持计时已满。
 * 飞行已经结束（outcome 非空）而条件仍不满足时即为失败。
 */
const evaluateObjective = (spec: ObjectiveSpec, input: MissionInput, orbitConfirmed: boolean): ObjectiveStatus => {
  const { telemetry, stats, outcome } = input;
  switch (spec.kind) {
    case 'reach-altitude':
      if (Math.max(stats.maxAltitude, telemetry.altitude) >= spec.altitude) return 'done';
      return outcome ? 'failed' : 'pending';
    case 'orbit':
      if (orbitConfirmed) return 'done';
      return outcome ? 'failed' : 'pending';
    case 'land-capsule':
      if (!outcome) return 'pending';
      return outcome.kind === 'landed' && capsuleAlone(telemetry) ? 'done' : 'failed';
  }
};

/** 推进任务状态。任务已有结论后不再变化。 */
export const updateMission = (mission: MissionDefinition, state: MissionState, input: MissionInput): MissionState => {
  if (state.status !== 'active') return state;
  const { telemetry, outcome } = input;
  const now = telemetry.simTime;

  // —— 防热大底烧蚀层的最小剩余比例（大底抛掉后不再更新）——
  let minAblatorFraction = state.minAblatorFraction;
  const shield = telemetry.thermal.find((zone) => zone.zone === 'base' && zone.ablative && zone.owner === 'payload');
  if (shield && (minAblatorFraction === null || shield.ablatorFraction < minAblatorFraction)) minAblatorFraction = shield.ablatorFraction;

  // —— 轨道保持计时 ——
  const orbitSpec = orbitSpecOf(mission);
  const orbitPending = state.objectives.some((o, i) => o.status === 'pending' && mission.objectives[i]?.spec.kind === 'orbit');
  let orbitHoldSince = state.orbitHoldSince;
  let confirmedOrbit: ConfirmedOrbit | null = state.confirmedOrbit;
  let orbitConfirmed = false;
  if (orbitSpec && orbitPending) {
    const holding = telemetry.phase === 'flight' && telemetry.thrust === 0 && orbitMeets(telemetry.orbit, orbitSpec);
    if (!holding) orbitHoldSince = null;
    else if (orbitHoldSince === null) orbitHoldSince = now;
    else if (now - orbitHoldSince >= ORBIT_CONFIRM_TIME && telemetry.orbit) {
      orbitConfirmed = true;
      confirmedOrbit = {
        apoapsisAltitude: telemetry.orbit.apoapsisAltitude,
        periapsisAltitude: telemetry.orbit.periapsisAltitude,
        inclination: telemetry.orbit.inclination,
        eccentricity: telemetry.orbit.eccentricity,
        period: telemetry.orbit.period,
        remainingDeltaV: telemetry.remainingDeltaV,
      };
    }
  }

  // —— 各目标 ——
  let failure: MissionFailure | null = state.failure;
  let changed = false;
  const objectives: ObjectiveState[] = state.objectives.map((objective, i) => {
    const definition = mission.objectives[i];
    if (!definition || objective.status !== 'pending') return objective;
    let status = evaluateObjective(definition.spec, input, orbitConfirmed);
    // 停在一条不满足要求的稳定轨道上、发动机关着、推进剂也用完了：飞行不会自己结束，直接判定无法完成
    if (
      status === 'pending' &&
      definition.spec.kind === 'orbit' &&
      telemetry.phase === 'flight' &&
      telemetry.thrust === 0 &&
      telemetry.remainingDeltaV < DEPLETED_DELTA_V &&
      telemetry.orbit?.classification === 'orbit' &&
      !orbitMeets(telemetry.orbit, definition.spec)
    ) {
      status = 'failed';
      if (!definition.optional && failure === null) failure = 'out-of-propellant';
    }
    if (status === 'pending') return objective;
    changed = true;
    if (status === 'failed' && !definition.optional && failure === null) {
      failure = outcome?.kind === 'destroyed' ? 'destroyed' : 'flight-ended';
    }
    return { id: objective.id, status, resolvedAt: now };
  });

  // —— 任务结论 ——
  // 主要目标有一个失败：任务失败（不必等其余目标）。全部目标都有结论且主要目标都完成：任务成功。
  const requiredFailed = objectives.some((o, i) => o.status === 'failed' && !mission.objectives[i]?.optional);
  const allResolved = objectives.every((o) => o.status !== 'pending');
  const status = requiredFailed ? 'failed' : allResolved ? 'success' : 'active';

  if (
    !changed &&
    status === state.status &&
    orbitHoldSince === state.orbitHoldSince &&
    minAblatorFraction === state.minAblatorFraction &&
    confirmedOrbit === state.confirmedOrbit
  ) {
    return state;
  }
  return {
    status,
    objectives: changed ? objectives : state.objectives,
    failure: status === 'failed' ? failure : null,
    endedAt: status === 'active' ? null : now,
    orbitHoldSince,
    confirmedOrbit,
    minAblatorFraction,
  };
};

/** 主要目标是否已经全部完成（附加目标可能还没有结论）。 */
export const requiredObjectivesDone = (mission: MissionDefinition, state: MissionState): boolean =>
  state.objectives.every((o, i) => mission.objectives[i]?.optional || o.status === 'done');

/** 轨道保持计时的进度 [0, 1]：0 表示当前不满足，1 表示已确认。 */
export const orbitHoldProgress = (state: MissionState, simTime: number): number => {
  if (state.confirmedOrbit) return 1;
  if (state.orbitHoldSince === null) return 0;
  return Math.max(0, Math.min(1, (simTime - state.orbitHoldSince) / ORBIT_CONFIRM_TIME));
};

/** 评分用的指标：来自任务状态、统计量、飞行结果与最后的遥测。 */
export const missionMetrics = (mission: MissionDefinition, state: MissionState, input: MissionInput): MissionMetrics => {
  const { telemetry, stats, outcome } = input;
  const orbit = state.confirmedOrbit;
  const target = orbitSpecOf(mission)?.inclination?.target ?? null;
  const landed = outcome?.kind === 'landed';
  return {
    'max-g': stats.maxGLoad,
    'max-altitude': stats.maxAltitude,
    'orbit-spread': orbit ? orbit.apoapsisAltitude - orbit.periapsisAltitude : null,
    'inclination-error': orbit && target !== null ? Math.abs(orbit.inclination - target) : null,
    'delta-v-margin': orbit ? orbit.remainingDeltaV : null,
    'landing-speed': landed ? Math.abs(outcome.verticalSpeed) : null,
    'ablator-remaining': landed ? state.minAblatorFraction : null,
    downrange: landed ? telemetry.downrange : null,
  };
};
