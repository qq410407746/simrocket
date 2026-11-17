/**
 * 任务系统的纯逻辑：判定、评分、解锁、飞行日志、发射引导，以及任务目录的自洽性。
 * 用模拟器给出的真实遥测作为基础，再按需要改写其中的读数。
 */
import { describe, expect, it } from 'vitest';
import { findLaunchSite, getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG, findMission } from '@/data/missions';
import { findVehicle, getVehicleOrDefault } from '@/data/vehicles';
import { DEG2RAD, RAD2DEG } from '../physics/constants';
import { reachableInclination } from '../physics/orbital/launch';
import { Simulation } from '../simulation/Simulation';
import { buildSnapshot } from '../simulation/snapshot';
import { canStartInOrbit, createFlightConfig } from '../simulation/startConditions';
import type { FlightOutcome, FlightStats } from '../simulation/types';
import { type OrbitTelemetry, type Telemetry, deriveTelemetry } from '../telemetry/telemetry';
import { EMPTY_PROGRESS, completedCount, isMissionUnlocked, nextMission, progressOf, recordMissionResult, sanitizeProgress } from './career';
import { comboForHeading, comboLabel, compassLabel, headingOfCombo, launchGuidance, leftOfCombo, reverseCombo } from './guidance';
import { LOGBOOK_LIMIT, buildLogEntry, isValidLogEntry, sanitizeLogbook, upsertLogEntry } from './logbook';
import { GRADE_THRESHOLDS, gradeFor, isBetterGrade, linearFraction, scoreMission } from './scoring';
import {
  ORBIT_CONFIRM_TIME,
  type MissionInput,
  createMissionState,
  missionMetrics,
  missionOrbitRequirement,
  orbitHoldProgress,
  orbitMeets,
  requiredObjectivesDone,
  updateMission,
} from './tracker';
import type { MissionDefinition, MissionScore, MissionState } from './types';

const mission = (id: string): MissionDefinition => findMission(id) as MissionDefinition;
const frontier = getVehicleOrDefault('frontier-1');
const cape = launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'));

/** 从轨道出发的边疆一号的真实遥测：200 km 圆轨道，二级还连着，发动机关着。 */
const orbitConfig = createFlightConfig(frontier, cape, 'orbit');
const orbitSim = new Simulation(orbitConfig);
const inOrbit: Telemetry = deriveTelemetry(buildSnapshot(orbitSim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), orbitConfig);
const baseStats: FlightStats = orbitSim.flightStats;

const withOrbit = (changes: Partial<OrbitTelemetry>): OrbitTelemetry => ({ ...(inOrbit.orbit as OrbitTelemetry), ...changes });
const at = (simTime: number, changes: Partial<Telemetry> = {}): Telemetry => ({ ...inOrbit, simTime, missionTime: simTime, ...changes });
const input = (telemetry: Telemetry, stats: Partial<FlightStats> = {}, outcome: FlightOutcome | null = null): MissionInput => ({
  telemetry,
  stats: { ...baseStats, ...stats },
  outcome,
});
const outcomeOf = (kind: 'landed' | 'destroyed', time: number): FlightOutcome => ({
  kind,
  cause: kind === 'destroyed' ? 'impact' : null,
  thermalZone: null,
  time,
  altitude: 0,
  impactSpeed: kind === 'landed' ? 7.5 : 120,
  verticalSpeed: kind === 'landed' ? -7.5 : -119,
  tilt: 0,
  latitude: 0.3,
  longitude: -1,
});
const capsuleOnly: Partial<Telemetry> = { stageAttached: [false, false], activeStageIndex: 2 };
/** 连续喂入若干次输入。 */
const feed = (m: MissionDefinition, state: MissionState, inputs: readonly MissionInput[]): MissionState =>
  inputs.reduce((s, i) => updateMission(m, s, i), state);

describe('任务判定：达到高度', () => {
  const karman = mission('karman-line');

  it('最大高度取物理线程累计的统计量：即使界面采样错过了最高点也算数', () => {
    let state = createMissionState(karman);
    expect(state.status).toBe('active');
    expect(state.objectives.map((o) => o.status)).toEqual(['pending', 'pending']);
    state = updateMission(karman, state, input(at(100, { altitude: 60_000 }), { maxAltitude: 60_000 }));
    expect(state.objectives[0]?.status).toBe('pending');
    // 采样时已经在下降（当前高度 80 km），但统计量记录过 123 km
    state = updateMission(karman, state, input(at(400, { altitude: 80_000 }), { maxAltitude: 123_000 }));
    expect(state.objectives[0]).toEqual({ id: 'altitude', status: 'done', resolvedAt: 400 });
    // 主要目标完成，但附加目标（回收）还没有结论：任务仍在进行
    expect(state.status).toBe('active');
    expect(requiredObjectivesDone(karman, state)).toBe(true);
  });

  it('附加目标失败不影响任务成功；成功要等所有目标都有结论', () => {
    let state = createMissionState(karman);
    state = updateMission(karman, state, input(at(300, { altitude: 101_000 }), { maxAltitude: 101_000 }));
    expect(state.status).toBe('active');
    // 返回舱没开伞，坠毁
    state = updateMission(karman, state, input(at(900, { ...capsuleOnly, phase: 'destroyed', altitude: 0 }), { maxAltitude: 286_000 }, outcomeOf('destroyed', 900)));
    expect(state.status).toBe('success');
    expect(state.objectives.map((o) => o.status)).toEqual(['done', 'failed']);
    expect(state.failure).toBeNull();
    expect(state.endedAt).toBe(900);
  });

  it('没到 100 km 飞行就结束：主要目标失败，任务失败并给出原因', () => {
    const crashed = feed(karman, createMissionState(karman), [
      input(at(200, { altitude: 70_000 }), { maxAltitude: 70_000 }),
      input(at(500, { phase: 'destroyed', altitude: 0 }), { maxAltitude: 84_000 }, outcomeOf('destroyed', 500)),
    ]);
    expect(crashed.status).toBe('failed');
    expect(crashed.failure).toBe('destroyed');
    expect(crashed.objectives.map((o) => o.status)).toEqual(['failed', 'failed']);
    // 返回舱安全着陆了，但高度不够
    const landedLow = updateMission(karman, createMissionState(karman), input(at(700, { ...capsuleOnly, phase: 'landed', altitude: 0 }), { maxAltitude: 84_000 }, outcomeOf('landed', 700)));
    expect(landedLow.status).toBe('failed');
    expect(landedLow.failure).toBe('flight-ended');
    expect(landedLow.objectives.map((o) => o.status)).toEqual(['failed', 'done']);
  });

  it('任务有结论后不再变化；没有变化时返回同一个对象', () => {
    const state = createMissionState(karman);
    const same = updateMission(karman, state, input(at(10, { altitude: 5_000 }), { maxAltitude: 5_000 }));
    expect(same).toBe(state);
    const done = feed(karman, state, [
      input(at(300, { altitude: 120_000 }), { maxAltitude: 120_000 }),
      input(at(900, { ...capsuleOnly, phase: 'landed', altitude: 0 }), { maxAltitude: 286_000 }, outcomeOf('landed', 900)),
    ]);
    expect(done.status).toBe('success');
    expect(done.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    expect(updateMission(karman, done, input(at(2_000, { altitude: 0 }), {}, outcomeOf('destroyed', 2_000)))).toBe(done);
  });
});

describe('任务判定：入轨', () => {
  const firstOrbit = mission('first-orbit');
  const good = withOrbit({ periapsisAltitude: 152_000, apoapsisAltitude: 221_000 });

  it('轨道要求：近地点、远地点、倾角都要满足，且必须是稳定轨道', () => {
    const requirement = missionOrbitRequirement(firstOrbit)!;
    expect(orbitMeets(good, requirement)).toBe(true);
    expect(orbitMeets(withOrbit({ periapsisAltitude: 149_000, apoapsisAltitude: 221_000 }), requirement)).toBe(false);
    expect(orbitMeets(withOrbit({ periapsisAltitude: 152_000, apoapsisAltitude: 601_000 }), requirement)).toBe(false);
    expect(orbitMeets(withOrbit({ classification: 'atmospheric', periapsisAltitude: 90_000 }), requirement)).toBe(false);
    expect(orbitMeets(withOrbit({ classification: 'escape' }), requirement)).toBe(false);
    expect(orbitMeets(null, requirement)).toBe(false);
    const inclined = missionOrbitRequirement(mission('inclined-orbit'))!;
    expect(orbitMeets(withOrbit({ ...good, inclination: 50 * DEG2RAD }), inclined)).toBe(true);
    expect(orbitMeets(withOrbit({ ...good, inclination: 53.5 * DEG2RAD }), inclined)).toBe(true);
    expect(orbitMeets(withOrbit({ ...good, inclination: 49.5 * DEG2RAD }), inclined)).toBe(false);
    expect(orbitMeets(withOrbit({ ...good, inclination: 28.5 * DEG2RAD }), inclined)).toBe(false);
    expect(missionOrbitRequirement(mission('karman-line'))).toBeNull();
  });

  it('发动机还在工作时不确认；关机后连续满足 10 秒才确认，并记录当时的轨道与余量', () => {
    let state = createMissionState(firstOrbit);
    // 点火中，瞬时读数已经满足
    state = updateMission(firstOrbit, state, input(at(440, { orbit: good, thrust: 900_000 })));
    expect(state.orbitHoldSince).toBeNull();
    expect(orbitHoldProgress(state, 440)).toBe(0);
    // 关机
    state = updateMission(firstOrbit, state, input(at(450, { orbit: good, thrust: 0, remainingDeltaV: 3_037 })));
    expect(state.orbitHoldSince).toBe(450);
    expect(state.status).toBe('active');
    state = updateMission(firstOrbit, state, input(at(455, { orbit: good, thrust: 0, remainingDeltaV: 3_037 })));
    expect(orbitHoldProgress(state, 455)).toBeCloseTo(0.5, 12);
    expect(state.objectives[0]?.status).toBe('pending');
    state = updateMission(firstOrbit, state, input(at(450 + ORBIT_CONFIRM_TIME, { orbit: good, thrust: 0, remainingDeltaV: 3_037 })));
    expect(state.status).toBe('success');
    expect(state.objectives[0]).toEqual({ id: 'orbit', status: 'done', resolvedAt: 460 });
    expect(state.confirmedOrbit).toEqual({
      apoapsisAltitude: 221_000,
      periapsisAltitude: 152_000,
      inclination: good.inclination,
      eccentricity: good.eccentricity,
      period: good.period,
      remainingDeltaV: 3_037,
    });
    expect(orbitHoldProgress(state, 999)).toBe(1);
  });

  it('保持期间重新点火、或轨道不再满足：计时清零重来', () => {
    let state = createMissionState(firstOrbit);
    state = feed(firstOrbit, state, [input(at(450, { orbit: good, thrust: 0 })), input(at(456, { orbit: good, thrust: 30_000 }))]);
    expect(state.orbitHoldSince).toBeNull();
    state = feed(firstOrbit, state, [
      input(at(460, { orbit: good, thrust: 0 })),
      input(at(465, { orbit: withOrbit({ periapsisAltitude: 152_000, apoapsisAltitude: 640_000 }), thrust: 0 })),
    ]);
    expect(state.orbitHoldSince).toBeNull();
    state = feed(firstOrbit, state, [input(at(470, { orbit: good, thrust: 0 })), input(at(479.9, { orbit: good, thrust: 0 }))]);
    expect(state.status).toBe('active');
    state = updateMission(firstOrbit, state, input(at(480, { orbit: good, thrust: 0 })));
    expect(state.status).toBe('success');
  });

  it('高时间倍率下相邻两次采样相隔很久：持续满足的轨道照样被确认', () => {
    const state = feed(firstOrbit, createMissionState(firstOrbit), [
      input(at(1_000, { orbit: good, thrust: 0 })),
      input(at(1_100, { orbit: good, thrust: 0 })),
    ]);
    expect(state.status).toBe('success');
  });

  it('没入轨就坠回大气层：任务失败', () => {
    const state = feed(firstOrbit, createMissionState(firstOrbit), [
      input(at(400, { orbit: withOrbit({ classification: 'suborbital', periapsisAltitude: -2_000_000 }), thrust: 0 })),
      input(at(900, { phase: 'destroyed', orbit: null }), {}, outcomeOf('destroyed', 900)),
    ]);
    expect(state.status).toBe('failed');
    expect(state.failure).toBe('destroyed');
    expect(state.confirmedOrbit).toBeNull();
  });

  it('停在不满足要求的稳定轨道上且推进剂耗尽：直接判定无法完成；还有推进剂就继续等', () => {
    const tooHigh = withOrbit({ periapsisAltitude: 150_000, apoapsisAltitude: 2_300_000 });
    let state = updateMission(firstOrbit, createMissionState(firstOrbit), input(at(600, { orbit: tooHigh, thrust: 0, remainingDeltaV: 498 })));
    expect(state.status).toBe('active');
    state = updateMission(firstOrbit, state, input(at(700, { orbit: tooHigh, thrust: 0, remainingDeltaV: 0 })));
    expect(state.status).toBe('failed');
    expect(state.failure).toBe('out-of-propellant');
    // 亚轨道上耗尽推进剂不提前判定：飞行会自己结束
    const falling = updateMission(
      firstOrbit,
      createMissionState(firstOrbit),
      input(at(600, { orbit: withOrbit({ classification: 'suborbital', periapsisAltitude: -500_000 }), thrust: 0, remainingDeltaV: 0 })),
    );
    expect(falling.status).toBe('active');
  });
});

describe('任务判定：返回与组合任务', () => {
  const crewReturn = mission('crew-return');
  const fullFlight = mission('orbital-flight');

  it('着陆的必须是已与推进级分离的返回舱', () => {
    const landed = outcomeOf('landed', 3_000);
    const ok = updateMission(crewReturn, createMissionState(crewReturn), input(at(3_000, { ...capsuleOnly, phase: 'landed' }), {}, landed));
    expect(ok.status).toBe('success');
    const withStage = updateMission(crewReturn, createMissionState(crewReturn), input(at(3_000, { phase: 'landed' }), {}, landed));
    expect(withStage.status).toBe('failed');
    expect(withStage.failure).toBe('flight-ended');
    const burned = updateMission(crewReturn, createMissionState(crewReturn), input(at(1_500, { ...capsuleOnly, phase: 'destroyed' }), {}, outcomeOf('destroyed', 1_500)));
    expect(burned.failure).toBe('destroyed');
  });

  it('记录防热大底烧蚀层的最小剩余比例；大底抛掉后不再更新', () => {
    const zones = (fraction: number, owner = 'payload', ablative = true): Telemetry['thermal'] =>
      inOrbit.thermal.map((z) => (z.zone === 'base' ? { ...z, owner, ablative, ablatorFraction: fraction } : z));
    let state = createMissionState(crewReturn);
    // 带着推进级时底部是发动机舱，不是大底
    state = updateMission(crewReturn, state, input(at(10)));
    expect(state.minAblatorFraction).toBeNull();
    state = feed(crewReturn, state, [
      input(at(1_000, { ...capsuleOnly, thermal: zones(1) })),
      input(at(1_200, { ...capsuleOnly, thermal: zones(0.91) })),
      input(at(1_300, { ...capsuleOnly, thermal: zones(0.83) })),
    ]);
    expect(state.minAblatorFraction).toBe(0.83);
    // 抛掉大底：底部换成舱底结构（遥测里烧蚀层比例回到 1），记录保持不变
    state = updateMission(crewReturn, state, input(at(2_000, { ...capsuleOnly, thermal: zones(1, 'payload-bare', false) })));
    expect(state.minAblatorFraction).toBe(0.83);
    state = updateMission(crewReturn, state, input(at(2_900, { ...capsuleOnly, phase: 'landed', thermal: zones(1, 'payload-bare', false) }), { maxGLoad: 4.4 }, outcomeOf('landed', 2_900)));
    const metrics = missionMetrics(crewReturn, state, input(at(2_900, { ...capsuleOnly, downrange: 15_400_000 }), { maxGLoad: 4.4 }, outcomeOf('landed', 2_900)));
    expect(metrics['ablator-remaining']).toBe(0.83);
    expect(metrics['landing-speed']).toBe(7.5);
    expect(metrics['max-g']).toBe(4.4);
    expect(metrics.downrange).toBe(15_400_000);
    expect(metrics['orbit-spread']).toBeNull();
    expect(metrics['inclination-error']).toBeNull();
  });

  it('完整任务：先入轨确认，再着陆；只入轨不返回不算完成，入轨失败直接返回也不算', () => {
    const good = withOrbit({ periapsisAltitude: 155_000, apoapsisAltitude: 200_000 });
    let state = feed(fullFlight, createMissionState(fullFlight), [
      input(at(450, { orbit: good, thrust: 0, remainingDeltaV: 3_000 })),
      input(at(461, { orbit: good, thrust: 0, remainingDeltaV: 3_000 })),
    ]);
    expect(state.objectives.map((o) => o.status)).toEqual(['done', 'pending']);
    expect(state.status).toBe('active');
    state = updateMission(fullFlight, state, input(at(3_700, { ...capsuleOnly, phase: 'landed', orbit: null }), { maxGLoad: 6.2 }, outcomeOf('landed', 3_700)));
    expect(state.status).toBe('success');
    expect(state.confirmedOrbit?.periapsisAltitude).toBe(155_000);

    // 没有入轨（中止），返回舱安全着陆
    const aborted = updateMission(fullFlight, createMissionState(fullFlight), input(at(900, { ...capsuleOnly, phase: 'landed', orbit: null }), {}, outcomeOf('landed', 900)));
    expect(aborted.status).toBe('failed');
    expect(aborted.failure).toBe('flight-ended');
    expect(aborted.objectives.map((o) => o.status)).toEqual(['failed', 'done']);
  });

  it('评分用的轨道指标取自确认时刻：之后离轨不影响', () => {
    const inclined = mission('inclined-orbit');
    const confirmed = withOrbit({ periapsisAltitude: 157_000, apoapsisAltitude: 230_000, inclination: 51.04 * DEG2RAD });
    const state = feed(inclined, createMissionState(inclined), [
      input(at(450, { orbit: confirmed, thrust: 0, remainingDeltaV: 2_883 })),
      input(at(460, { orbit: confirmed, thrust: 0, remainingDeltaV: 2_883 })),
    ]);
    expect(state.status).toBe('success');
    const later = input(at(5_000, { orbit: withOrbit({ periapsisAltitude: 20_000, apoapsisAltitude: 199_000 }), remainingDeltaV: 2_500 }), { maxGLoad: 6.24 });
    const metrics = missionMetrics(inclined, state, later);
    expect(metrics['orbit-spread']).toBe(73_000);
    expect((metrics['inclination-error'] as number) * RAD2DEG).toBeCloseTo(0.56, 6);
    expect(metrics['delta-v-margin']).toBe(2_883);
    expect(metrics['landing-speed']).toBeNull();
    expect(metrics.downrange).toBeNull();
  });
});

describe('评分', () => {
  it('线性评分：两个方向都支持，范围外截断，指标不存在或无效得 0', () => {
    // 越小越好：5 g 满分，9 g 零分
    expect(linearFraction(4, 5, 9)).toBe(1);
    expect(linearFraction(5, 5, 9)).toBe(1);
    expect(linearFraction(7, 5, 9)).toBe(0.5);
    expect(linearFraction(9, 5, 9)).toBe(0);
    expect(linearFraction(12, 5, 9)).toBe(0);
    // 越大越好：余量 3000 满分，1500 零分
    expect(linearFraction(3_500, 3_000, 1_500)).toBe(1);
    expect(linearFraction(2_250, 3_000, 1_500)).toBe(0.5);
    expect(linearFraction(1_000, 3_000, 1_500)).toBe(0);
    expect(linearFraction(null, 5, 9)).toBe(0);
    expect(linearFraction(Number.NaN, 5, 9)).toBe(0);
    expect(linearFraction(Infinity, 5, 9)).toBe(0);
    expect(linearFraction(5, 7, 7)).toBe(0);
  });

  it('评级分数线：S ≥ 90，A ≥ 80，B ≥ 65，其余为 C', () => {
    expect(GRADE_THRESHOLDS.map((t) => t.grade)).toEqual(['S', 'A', 'B', 'C']);
    expect([100, 90, 89, 80, 79, 65, 64, 0].map(gradeFor)).toEqual(['S', 'S', 'A', 'A', 'B', 'B', 'C', 'C']);
    expect(isBetterGrade('A', 'B')).toBe(true);
    expect(isBetterGrade('B', 'A')).toBe(false);
    expect(isBetterGrade('S', 'S')).toBe(false);
    expect(isBetterGrade('C', null)).toBe(true);
    expect(isBetterGrade('C', 'F')).toBe(true);
  });

  const firstOrbit = mission('first-orbit');
  const confirmed = (spreadKm: number, deltaV: number): MissionState => {
    const orbit = withOrbit({ periapsisAltitude: 150_000, apoapsisAltitude: 150_000 + spreadKm * 1_000 });
    return feed(firstOrbit, createMissionState(firstOrbit), [
      input(at(450, { orbit, thrust: 0, remainingDeltaV: deltaV })),
      input(at(460, { orbit, thrust: 0, remainingDeltaV: deltaV })),
    ]);
  };
  const scoreOf = (state: MissionState, maxGLoad: number): MissionScore =>
    scoreMission(firstOrbit, state, missionMetrics(firstOrbit, state, input(at(460), { maxGLoad })));

  it('首次入轨：各项得分按指标线性换算，总分四舍五入', () => {
    // 粗糙的飞行：150 × 221 km，剩余 3037 m/s，最大过载 6.25 g
    const rough = scoreOf(confirmed(71, 3_037), 6.25);
    expect(rough.items.map((i) => i.id)).toEqual(['objectives', 'circular', 'margin', 'g']);
    const points = Object.fromEntries(rough.items.map((i) => [i.id, i.points]));
    expect(points.objectives).toBe(50);
    expect(points.circular).toBeCloseTo((20 * (300 - 71)) / 280, 9);
    expect(points.margin).toBe(15);
    expect(points.g).toBeCloseTo(15 * 0.5, 9);
    expect(rough.total).toBe(89);
    expect(rough.grade).toBe('A');
    expect(rough.items.find((i) => i.id === 'g')).toMatchObject({ metric: 'max-g', value: 6.25, weight: 15 });
    expect(rough.items.find((i) => i.id === 'objectives')).toMatchObject({ metric: null, value: null, fraction: 1 });
    // 收了节流、轨道更圆：满分
    const clean = scoreOf(confirmed(15, 3_050), 4.6);
    expect(clean.total).toBe(100);
    expect(clean.grade).toBe('S');
    // 勉强入轨：很椭圆、余量少、过载大
    const poor = scoreOf(confirmed(440, 1_400), 8);
    expect(poor.total).toBe(50);
    expect(poor.grade).toBe('C');
  });

  it('任务失败或尚未结束：总分 0、评级 F，但各项仍然列出', () => {
    const active = createMissionState(firstOrbit);
    const score = scoreMission(firstOrbit, active, missionMetrics(firstOrbit, active, input(at(100), { maxGLoad: 3 })));
    expect(score.total).toBe(0);
    expect(score.grade).toBe('F');
    expect(score.items).toHaveLength(4);
    expect(score.items.find((i) => i.id === 'objectives')?.fraction).toBe(0);
    expect(score.items.find((i) => i.id === 'g')?.fraction).toBe(1);
  });

  it('附加目标作为单独的评分项', () => {
    const karman = mission('karman-line');
    const reached = input(at(300, { altitude: 120_000 }), { maxAltitude: 286_000 });
    const recovered = feed(karman, createMissionState(karman), [reached, input(at(1_600, { ...capsuleOnly, phase: 'landed' }), { maxAltitude: 286_000 }, outcomeOf('landed', 1_600))]);
    const lost = feed(karman, createMissionState(karman), [reached, input(at(900, { ...capsuleOnly, phase: 'destroyed' }), { maxAltitude: 286_000 }, outcomeOf('destroyed', 900))]);
    const withRecovery = scoreMission(karman, recovered, missionMetrics(karman, recovered, input(at(1_600), { maxAltitude: 286_000 }, outcomeOf('landed', 1_600))));
    const without = scoreMission(karman, lost, missionMetrics(karman, lost, input(at(900), { maxAltitude: 286_000 }, outcomeOf('destroyed', 900))));
    expect(withRecovery.total).toBe(100);
    expect(without.total).toBe(75);
    expect(without.grade).toBe('B');
    expect(without.items.find((i) => i.id === 'recover')?.points).toBe(0);
  });
});

describe('任务进度与解锁', () => {
  const score = (total: number): MissionScore => ({ total, grade: gradeFor(total), items: [] });
  const failed: MissionScore = { total: 0, grade: 'F', items: [] };

  it('一开始只有第一个任务解锁；完成后依次解锁', () => {
    expect(MISSION_CATALOG.filter((m) => isMissionUnlocked(m, {})).map((m) => m.id)).toEqual(['karman-line']);
    let progress = recordMissionResult({}, 'karman-line', score(100), true);
    expect(MISSION_CATALOG.filter((m) => isMissionUnlocked(m, progress)).map((m) => m.id)).toEqual(['karman-line', 'suborbital-hop']);
    progress = recordMissionResult(progress, 'suborbital-hop', score(81), true);
    progress = recordMissionResult(progress, 'first-orbit', score(89), true);
    // 首次入轨之后同时解锁"载人飞船返回"与"指定倾角轨道"
    expect(MISSION_CATALOG.filter((m) => isMissionUnlocked(m, progress)).map((m) => m.id)).toEqual([
      'karman-line',
      'suborbital-hop',
      'first-orbit',
      'crew-return',
      'inclined-orbit',
      'geo-deployment',
    ]);
    expect(completedCount(MISSION_CATALOG, progress)).toBe(3);
    // "全部解锁"开关
    expect(MISSION_CATALOG.every((m) => isMissionUnlocked(m, {}, true))).toBe(true);
  });

  it('失败的飞行只增加次数；成功后保留最好成绩', () => {
    let progress = recordMissionResult({}, 'first-orbit', failed, false);
    expect(progressOf(progress, 'first-orbit')).toEqual({ completed: false, bestScore: 0, bestGrade: null, attempts: 1 });
    progress = recordMissionResult(progress, 'first-orbit', score(72), true);
    expect(progressOf(progress, 'first-orbit')).toEqual({ completed: true, bestScore: 72, bestGrade: 'B', attempts: 2 });
    progress = recordMissionResult(progress, 'first-orbit', score(93), true);
    expect(progressOf(progress, 'first-orbit')).toEqual({ completed: true, bestScore: 93, bestGrade: 'S', attempts: 3 });
    // 之后成绩更差或失败：最好成绩不变，完成状态不丢
    progress = recordMissionResult(progress, 'first-orbit', score(66), true);
    progress = recordMissionResult(progress, 'first-orbit', failed, false);
    expect(progressOf(progress, 'first-orbit')).toEqual({ completed: true, bestScore: 93, bestGrade: 'S', attempts: 5 });
    expect(progressOf(progress, 'polar-orbit')).toBe(EMPTY_PROGRESS);
  });

  it('下一个任务：目录中靠后的、已解锁且未完成的第一个；全部完成时为空', () => {
    let progress = recordMissionResult({}, 'karman-line', score(100), true);
    expect(nextMission(MISSION_CATALOG, progress, 'karman-line')?.id).toBe('suborbital-hop');
    progress = recordMissionResult(progress, 'suborbital-hop', score(90), true);
    progress = recordMissionResult(progress, 'first-orbit', score(90), true);
    expect(nextMission(MISSION_CATALOG, progress, 'first-orbit')?.id).toBe('crew-return');
    // 重飞早先的任务：建议的仍是还没完成的那个
    expect(nextMission(MISSION_CATALOG, progress, 'karman-line')?.id).toBe('crew-return');
    for (const m of MISSION_CATALOG) progress = recordMissionResult(progress, m.id, score(80), true);
    expect(nextMission(MISSION_CATALOG, progress, 'polar-orbit')).toBeNull();
    // 最后一个任务尚未解锁时不会被建议
    expect(nextMission(MISSION_CATALOG, recordMissionResult({}, 'karman-line', score(100), true), 'suborbital-hop')).toBeNull();
  });
});

describe('存档校验', () => {
  it('任务进度：只保留目录里的任务，无效字段回到默认值', () => {
    expect(sanitizeProgress(null, MISSION_CATALOG)).toEqual({});
    expect(sanitizeProgress('broken', MISSION_CATALOG)).toEqual({});
    const saved = {
      'karman-line': { completed: true, bestScore: 100, bestGrade: 'S', attempts: 2 },
      'first-orbit': { completed: 'yes', bestScore: 250, bestGrade: 'Z', attempts: -3.5 },
      'suborbital-hop': { completed: true, bestScore: Number.NaN, attempts: 1.9 },
      'removed-mission': { completed: true, bestScore: 80, bestGrade: 'A', attempts: 1 },
      'crew-return': 'not an object',
    };
    expect(sanitizeProgress(saved, MISSION_CATALOG)).toEqual({
      'karman-line': { completed: true, bestScore: 100, bestGrade: 'S', attempts: 2 },
      'first-orbit': { completed: false, bestScore: 100, bestGrade: null, attempts: 0 },
      'suborbital-hop': { completed: true, bestScore: 0, bestGrade: null, attempts: 1 },
    });
    // 经过 JSON 往返（存档的实际形态）结果不变
    const progress = recordMissionResult({}, 'karman-line', { total: 92, grade: 'S', items: [] }, true);
    expect(sanitizeProgress(JSON.parse(JSON.stringify(progress)), MISSION_CATALOG)).toEqual(progress);
  });

  it('飞行日志：不是数组则为空；无效条目被丢弃；不超过条数上限', () => {
    expect(sanitizeLogbook(undefined)).toEqual([]);
    expect(sanitizeLogbook({ 0: 'x' })).toEqual([]);
    const entry = (id: string) => ({
      id,
      date: '2026-11-15T03:00:00.000Z',
      missionId: null,
      vehicleId: 'frontier-1',
      siteId: 'cape-canaveral',
      start: 'pad',
      result: 'landed',
      cause: null,
      missionStatus: null,
      score: null,
      grade: null,
      duration: 100,
      maxAltitude: 1,
      maxSpeed: 1,
      maxGLoad: 1,
      maxDynamicPressure: 1,
      maxHeatFlux: 1,
      downrange: 1,
      orbit: null,
    });
    const cleaned = sanitizeLogbook([entry('a'), { id: 'bad' }, null, entry('b'), { ...entry('c'), duration: 'long' }]);
    expect(cleaned.map((e) => e.id)).toEqual(['a', 'b']);
    const many = Array.from({ length: LOGBOOK_LIMIT + 20 }, (_, i) => entry(`flight-${i}`));
    expect(sanitizeLogbook(many)).toHaveLength(LOGBOOK_LIMIT);
    expect(sanitizeLogbook(many)[0]?.id).toBe('flight-0');
  });
});

describe('飞行日志', () => {
  const entryInput = {
    id: 'flight-1',
    date: '2026-11-15T03:00:00.000Z',
    missionId: 'first-orbit',
    vehicleId: 'frontier-1',
    siteId: 'cape-canaveral',
    start: 'pad' as const,
    telemetry: at(460, { downrange: 2_100_000 }),
    stats: { ...baseStats, maxAltitude: 209_000, maxInertialSpeed: 7_805, maxGLoad: 6.25, maxDynamicPressure: 41_400, maxHeatFlux: 45_000 },
    outcome: null,
    mission: null as MissionState | null,
    score: null as MissionScore | null,
  };

  it('一条记录包含结局、任务结果与关键数据；轨道取任务确认的轨道，否则取当前的稳定轨道', () => {
    const sandbox = buildLogEntry({ ...entryInput, missionId: null });
    expect(sandbox).toMatchObject({ result: 'in-flight', missionStatus: null, score: null, grade: null, duration: 460, maxAltitude: 209_000, maxGLoad: 6.25, downrange: 2_100_000 });
    expect(sandbox.orbit?.periapsisAltitude).toBe(inOrbit.orbit?.periapsisAltitude);
    const firstOrbit = mission('first-orbit');
    const orbit = withOrbit({ periapsisAltitude: 150_000, apoapsisAltitude: 221_000 });
    const state = feed(firstOrbit, createMissionState(firstOrbit), [input(at(450, { orbit, thrust: 0 })), input(at(460, { orbit, thrust: 0 }))]);
    const scored = buildLogEntry({ ...entryInput, mission: state, score: { total: 89, grade: 'A', items: [] } });
    expect(scored).toMatchObject({ missionStatus: 'success', score: 89, grade: 'A' });
    expect(scored.orbit).toEqual({ apoapsisAltitude: 221_000, periapsisAltitude: 150_000, inclination: orbit.inclination });
    // 任务还没有结论时不写分数；坠毁的飞行没有轨道
    const pending = buildLogEntry({ ...entryInput, mission: createMissionState(firstOrbit), score: { total: 0, grade: 'F', items: [] } });
    expect(pending).toMatchObject({ missionStatus: 'active', score: null, grade: null });
    const crashed = buildLogEntry({ ...entryInput, telemetry: at(500, { orbit: null, phase: 'destroyed' }), outcome: { ...outcomeOf('destroyed', 500), cause: 'bending' } });
    expect(crashed).toMatchObject({ result: 'destroyed', cause: 'bending', orbit: null });
    expect(isValidLogEntry(scored)).toBe(true);
  });

  it('同一次飞行的更新覆盖原记录；新飞行排在最前；超出上限丢弃最旧的', () => {
    const first = buildLogEntry(entryInput);
    const second = buildLogEntry({ ...entryInput, id: 'flight-2' });
    let log = upsertLogEntry([], first);
    log = upsertLogEntry(log, second);
    expect(log.map((e) => e.id)).toEqual(['flight-2', 'flight-1']);
    const updated = { ...first, result: 'landed' as const, duration: 3_700 };
    log = upsertLogEntry(log, updated);
    expect(log.map((e) => e.id)).toEqual(['flight-2', 'flight-1']);
    expect(log[1]).toBe(updated);
    for (let i = 3; i <= LOGBOOK_LIMIT + 5; i++) log = upsertLogEntry(log, { ...first, id: `flight-${i}` });
    expect(log).toHaveLength(LOGBOOK_LIMIT);
    expect(log[0]?.id).toBe(`flight-${LOGBOOK_LIMIT + 5}`);
    expect(log.some((e) => e.id === 'flight-1')).toBe(false);
  });

  it('从存档读回的条目要通过校验：结构不对或含无效数值的被拒绝', () => {
    const entry = buildLogEntry(entryInput);
    expect(isValidLogEntry(entry)).toBe(true);
    expect(isValidLogEntry(JSON.parse(JSON.stringify(entry)))).toBe(true);
    expect(isValidLogEntry(null)).toBe(false);
    expect(isValidLogEntry('flight')).toBe(false);
    expect(isValidLogEntry({ ...entry, id: 5 })).toBe(false);
    expect(isValidLogEntry({ ...entry, result: 'exploded' })).toBe(false);
    expect(isValidLogEntry({ ...entry, maxAltitude: null })).toBe(false);
    expect(isValidLogEntry({ ...entry, maxGLoad: Number.NaN })).toBe(false);
    const { downrange: _omitted, ...missing } = entry;
    expect(isValidLogEntry(missing)).toBe(false);
  });
});

describe('发射方向的操作引导', () => {
  it('八个方向的按键组合与名称', () => {
    expect(comboLabel(comboForHeading(90))).toBe('D');
    expect(comboLabel(comboForHeading(0))).toBe('W');
    expect(comboLabel(comboForHeading(180))).toBe('S');
    expect(comboLabel(comboForHeading(270))).toBe('A');
    expect(comboLabel(comboForHeading(45))).toBe('W + D');
    expect(comboLabel(comboForHeading(135))).toBe('S + D');
    expect(comboLabel(comboForHeading(225))).toBe('S + A');
    expect(comboLabel(comboForHeading(315))).toBe('W + A');
    // 取整到最近的 45°
    expect(comboForHeading(42.7)).toEqual(comboForHeading(45));
    expect(comboForHeading(182.8)).toEqual({ pitch: -1, yaw: 0 });
    for (const heading of [0, 45, 90, 135, 180, 225, 270, 315]) expect(headingOfCombo(comboForHeading(heading))).toBeCloseTo(heading, 9);
    expect([0, 44, 90, 130, 180, 230, 270, 316, 359].map(compassLabel)).toEqual(['北', '东北', '东', '东南', '南', '西南', '西', '西北', '北']);
  });

  it('抬头是压低的反向；左偏是把压低的那组键逆时针转 90°', () => {
    // 向东飞：D 压低，A 抬高，W 左偏（向北），S 右偏
    const east = comboForHeading(90);
    expect(comboLabel(reverseCombo(east))).toBe('A');
    expect(comboLabel(leftOfCombo(east))).toBe('W');
    // 向南飞：S 压低，D 左偏（向东），A 右偏（向西）
    const south = comboForHeading(180);
    expect(comboLabel(leftOfCombo(south))).toBe('D');
    expect(comboLabel(reverseCombo(leftOfCombo(south)))).toBe('A');
    // 向东北飞：W + D 压低，W + A 左偏（向北），S + D 右偏
    const northeast = comboForHeading(45);
    expect(comboLabel(leftOfCombo(northeast))).toBe('W + A');
    expect(comboLabel(reverseCombo(leftOfCombo(northeast)))).toBe('S + D');
  });

  it('各任务的引导：向东、东北、正南；增大倾角的转向随升段 / 降段而不同', () => {
    const east = launchGuidance(mission('first-orbit'), cape.latitude);
    expect(east.azimuthDeg).toBe(90);
    expect(comboLabel(east.lower)).toBe('D');
    expect(comboLabel(east.raise)).toBe('A');
    expect(launchGuidance(null, cape.latitude).azimuthDeg).toBe(90);

    const inclined = launchGuidance(mission('inclined-orbit'), cape.latitude);
    expect(inclined.azimuthDeg).toBeGreaterThan(42);
    expect(inclined.azimuthDeg).toBeLessThan(43.5);
    expect(inclined.keyHeadingDeg).toBe(45);
    expect(comboLabel(inclined.lower)).toBe('W + D');
    expect(comboLabel(inclined.raise)).toBe('S + A');
    // 向北飞：左偏（更偏北）增大倾角
    expect(comboLabel(inclined.increaseInclination)).toBe('W + A');
    expect(comboLabel(inclined.decreaseInclination)).toBe('S + D');

    const vandenberg = launchSiteGeodetic(getLaunchSiteOrDefault('vandenberg'));
    const polar = launchGuidance(mission('polar-orbit'), vandenberg.latitude);
    expect(polar.azimuthDeg).toBeGreaterThan(182.5);
    expect(polar.azimuthDeg).toBeLessThan(183.2);
    expect(polar.keyHeadingDeg).toBe(180);
    expect(comboLabel(polar.lower)).toBe('S');
    // 向南飞：右偏（偏西）增大倾角
    expect(comboLabel(polar.increaseInclination)).toBe('A');
    expect(comboLabel(polar.decreaseInclination)).toBe('D');
    expect(polar.direction).toBe('descending');
  });
});

describe('任务目录的自洽性', () => {
  it('标识唯一；飞行器与发射场存在；从轨道出发的任务用的是能入轨的火箭', () => {
    expect(new Set(MISSION_CATALOG.map((m) => m.id)).size).toBe(MISSION_CATALOG.length);
    for (const m of MISSION_CATALOG) {
      const vehicle = findVehicle(m.vehicleId);
      expect(vehicle, m.id).toBeDefined();
      expect(findLaunchSite(m.siteId), m.id).toBeDefined();
      if (m.start === 'orbit') expect(canStartInOrbit(vehicle!), m.id).toBe(true);
      expect(m.briefing.length, m.id).toBeGreaterThan(0);
      expect(m.flightPlan.length, m.id).toBeGreaterThan(2);
      expect(m.summary.length, m.id).toBeGreaterThan(10);
    }
    expect(findMission('first-orbit')?.title).toBe('首次入轨');
    expect(findMission('no-such-mission')).toBeUndefined();
    expect(findMission(null)).toBeUndefined();
  });

  it('每个任务至少有一个主要目标；目标标识唯一；评分项满分之和为 100 且引用的目标存在', () => {
    for (const m of MISSION_CATALOG) {
      expect(m.objectives.some((o) => !o.optional), m.id).toBe(true);
      expect(new Set(m.objectives.map((o) => o.id)).size, m.id).toBe(m.objectives.length);
      expect(m.scoring.reduce((sum, item) => sum + item.weight, 0), m.id).toBe(100);
      expect(new Set(m.scoring.map((item) => item.id)).size, m.id).toBe(m.scoring.length);
      expect(m.scoring.filter((item) => item.rule.kind === 'objectives'), m.id).toHaveLength(1);
      for (const item of m.scoring) {
        expect(item.weight, `${m.id}/${item.id}`).toBeGreaterThan(0);
        expect(item.note.length, `${m.id}/${item.id}`).toBeGreaterThan(4);
        if (item.rule.kind === 'optional-objective') {
          const { objectiveId } = item.rule;
          expect(m.objectives.find((o) => o.id === objectiveId)?.optional, `${m.id}/${item.id}`).toBe(true);
        }
        if (item.rule.kind === 'metric') expect(item.rule.full, `${m.id}/${item.id}`).not.toBe(item.rule.zero);
      }
      // 需要着陆才有的指标，只出现在包含着陆目标的任务里
      const lands = m.objectives.some((o) => o.spec.kind === 'land-capsule');
      const orbits = m.objectives.some((o) => o.spec.kind === 'orbit');
      for (const item of m.scoring) {
        if (item.rule.kind !== 'metric') continue;
        if (['landing-speed', 'ablator-remaining', 'downrange'].includes(item.rule.metric)) expect(lands, `${m.id}/${item.id}`).toBe(true);
        if (['orbit-spread', 'inclination-error', 'delta-v-margin'].includes(item.rule.metric)) expect(orbits, `${m.id}/${item.id}`).toBe(true);
      }
    }
  });

  it('解锁关系引用存在的任务、只依赖目录中排在前面的任务（没有环），第一个任务无条件开放', () => {
    expect(MISSION_CATALOG[0]?.requires).toEqual([]);
    MISSION_CATALOG.forEach((m, index) => {
      for (const id of m.requires) {
        const required = MISSION_CATALOG.findIndex((other) => other.id === id);
        expect(required, `${m.id} → ${id}`).toBeGreaterThanOrEqual(0);
        expect(required, `${m.id} → ${id}`).toBeLessThan(index);
      }
    });
    // 按目录顺序逐个完成，每一步都有已解锁的下一个任务，直到全部完成
    let progress = {};
    let current = MISSION_CATALOG[0] as MissionDefinition;
    const order: string[] = [];
    for (let i = 0; i < MISSION_CATALOG.length; i++) {
      expect(isMissionUnlocked(current, progress)).toBe(true);
      order.push(current.id);
      progress = recordMissionResult(progress, current.id, { total: 80, grade: 'A', items: [] }, true);
      const next = nextMission(MISSION_CATALOG, progress, current.id);
      if (!next) break;
      current = next;
    }
    expect(order).toEqual(MISSION_CATALOG.map((m) => m.id));
  });

  it('有倾角要求的任务：目标倾角从该发射场可以直接到达，发射引导与目标一致', () => {
    for (const m of MISSION_CATALOG) {
      const requirement = missionOrbitRequirement(m);
      const site = launchSiteGeodetic(getLaunchSiteOrDefault(m.siteId));
      if (requirement) {
        expect(requirement.minPeriapsis, m.id).toBeGreaterThanOrEqual(150_000);
        expect(requirement.maxApoapsis, m.id).toBeGreaterThan(requirement.minPeriapsis + 100_000);
      }
      if (!requirement?.inclination) {
        expect(m.launch, m.id).toBeUndefined();
        continue;
      }
      const range = reachableInclination(site.latitude);
      expect(requirement.inclination.target, m.id).toBeGreaterThanOrEqual(range.min);
      expect(requirement.inclination.target, m.id).toBeLessThanOrEqual(range.max);
      expect(m.launch?.inclination, m.id).toBe(requirement.inclination.target);
      expect(requirement.inclination.tolerance, m.id).toBeGreaterThan(1 * DEG2RAD);
    }
  });
});


describe('高级任务的顺序与连续确认', () => {
  const geo = mission('geo-deployment');
  it('NaN 不能满足轨道条件；采样之间的短点火会重新开始十秒确认', () => {
    const first = mission('first-orbit');
    expect(orbitMeets(withOrbit({ periapsisAltitude: NaN }), missionOrbitRequirement(first)!)).toBe(false);
    let state = createMissionState(first);
    state = updateMission(first, state, input(at(100)));
    state = updateMission(first, state, input(at(115, { lastOrbitChangeTime: 112 })));
    expect(state.status).toBe('active');
    expect(state.orbitHoldSince).toBe(115);
    state = updateMission(first, state, input(at(125, { lastOrbitChangeTime: 112 })));
    expect(state.status).toBe('success');
  });
  it('停泊轨道和 GTO 分别保持十秒，不能继承前一目标的计时', () => {
    let state = createMissionState(geo);
    state = feed(geo, state, [input(at(100)), input(at(110))]);
    expect(state.objectives[0]?.status).toBe('done');
    const gtoOrbit = withOrbit({ periapsisAltitude: 200_000, apoapsisAltitude: 35_793_000 });
    state = updateMission(geo, state, input(at(200, { orbit: gtoOrbit })));
    expect(state.objectives[1]?.status).toBe('pending');
    expect(orbitHoldProgress(state, 205)).toBeCloseTo(0.5);
    state = updateMission(geo, state, input(at(210, { orbit: gtoOrbit })));
    expect(state.objectives[1]?.status).toBe('done');
    expect(state.objectives.slice(2).every((o) => o.status === 'pending')).toBe(true);
  });
  it('错误轨道上提前部署且已无推进能力时失败，不会无限等待 GEO', () => {
    let state = feed(geo, createMissionState(geo), [input(at(100)), input(at(110))]);
    const orbit = withOrbit({ periapsisAltitude: 200_000, apoapsisAltitude: 35_793_000 });
    state = feed(geo, state, [input(at(200, { orbit })), input(at(210, { orbit }))]);
    state = updateMission(geo, state, input(at(220, { orbit, satelliteDeployedAt: 215, remainingDeltaV: 0,
      synchronous: { gso: false, geo: false, longitudeSpan: null, periodError: 50_000 } })));
    expect(state.status).toBe('failed');
    expect(state.failure).toBe('out-of-propellant');
  });
});
