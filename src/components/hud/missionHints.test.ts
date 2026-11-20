/**
 * 任务提示（教学提示）与任务界面文字。
 * 让测试驾驶员把任务飞一遍，记录玩家在界面上会依次看到的提示。
 */
import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { fineKickKeys, headingOfCombo, launchGuidance } from '@/game/missions/guidance';
import { type MissionPilot, type PilotFactory, flyMission } from '@/game/missions/testing/flyMission';
import { createMissionState, missionOrbitRequirement } from '@/game/missions/tracker';
import type { MissionDefinition, MissionState } from '@/game/missions/types';
import { DEG2RAD } from '@/game/physics/constants';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';
import { type HandFlownOptions, HandFlownPilot } from '@/game/simulation/testing/handFlownPilot';
import { ReturnPilot, SuborbitalPilot } from '@/game/simulation/testing/missionPilots';
import type { OrbitTelemetry, Telemetry } from '@/game/telemetry/telemetry';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import { flightHint } from './flightHints';
import { missionFlightHint } from './missionHints';
import { logDate, logOrbit, logResult, metricText, missionFailureText, objectiveProgress } from './missionLabels';

const missionOf = (id: string): MissionDefinition => MISSION_CATALOG.find((m) => m.id === id) as MissionDefinition;
const siteOf = (mission: MissionDefinition) => launchSiteGeodetic(getLaunchSiteOrDefault(mission.siteId));

/** 飞一个任务，返回玩家依次看到的提示（数字替换成 #，相邻重复的合并）。 */
const hintsDuring = (id: string, pilot: PilotFactory, timeout = 12_000): { hints: string[]; status: string } => {
  const mission = missionOf(id);
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = siteOf(mission);
  const hints: string[] = [];
  const flight = flyMission(mission, vehicle, site, pilot, timeout, (telemetry, state) => {
    const text = (missionFlightHint(telemetry, vehicle, mission, state, site.latitude)?.text ?? '').replace(/[-−]?\d[\d,.]*/g, '#');
    if (text && hints[hints.length - 1] !== text) hints.push(text);
  });
  return { hints, status: flight.state.status };
};

/** 断言这些片段按顺序出现在提示序列里。 */
const expectInOrder = (hints: readonly string[], expected: readonly string[]): void => {
  let cursor = -1;
  for (const fragment of expected) {
    const index = hints.findIndex((text, i) => i > cursor && text.includes(fragment));
    expect(index, `提示"${fragment}"应当出现在第 ${cursor} 条之后；实际序列：\n${hints.join('\n')}`).toBeGreaterThan(cursor);
    cursor = index;
  }
};

const orbitalPilot = (id: string, extra: Partial<HandFlownOptions> = {}, back: ConstructorParameters<typeof ReturnPilot>[2] | null = null): PilotFactory => {
  const mission = missionOf(id);
  const guidance = launchGuidance(mission, siteOf(mission).latitude);
  const target = missionOrbitRequirement(mission)?.inclination?.target;
  return (sim, config): MissionPilot => {
    const ascent = new HandFlownPilot(sim, config, {
      targetAltitude: 200_000,
      kickAngleDeg: 2.5,
      pitchStepDeg: 2,
      decisionInterval: 2,
      kickHeadingDeg: headingOfCombo(guidance.lower),
      kickAzimuthDeg: fineKickKeys(guidance.azimuthDeg) ? guidance.azimuthDeg : undefined,
      inclination: target !== undefined ? { target, increase: guidance.direction === 'ascending' ? 'left' : 'right' } : undefined,
      ...extra,
    });
    const descent = back ? new ReturnPilot(sim, config, back) : null;
    let inOrbit = false;
    return {
      update: (state) => {
        if (!inOrbit) inOrbit = ascent.update() === 'orbit';
        else if (descent && state.objectives.find((o) => o.id === 'orbit')?.status === 'done') descent.update();
      },
    };
  };
};

describe('English mission ascent hints', () => {
  const mission = missionOf('first-orbit');
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = siteOf(mission);
  const config = createFlightConfig(vehicle, site, 'orbit');
  const raw = deriveTelemetry(buildSnapshot(new Simulation(config), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
  const base: Telemetry = {
    ...raw, phase: 'flight', altitude: 10_000, activeStageIndex: 0, thrust: 100, throttle: 1,
    ignited: true, orbit: null, surfaceSpeed: 100, verticalSpeed: 100, pitch: Math.PI / 2,
    attitudeMode: 'manual', missionTime: 5, thermal: [], dynamicPressure: 0, bendingLoad: 0,
    referenceHeatFlux: 0, stagePropellant: [10, 10],
  };
  const hint = (telemetry: Telemetry, task = mission) => missionFlightHint(telemetry, vehicle, task, createMissionState(task), site.latitude, 'en');

  it.each([
    ['upright', { ...base }, 'Keep climbing vertically'],
    ['tilted', { ...base, pitch: 80 * DEG2RAD }, 'vertical throughout'],
  ] as const)('translates vertical ascent when %s', (_name, telemetry, expected) => {
    const text = hint(telemetry, missionOf('karman-line'))?.text;
    expect(text).toContain(expected);
    expect(text).not.toMatch(/\p{Script=Han}/u);
  });

  it.each([100, 350])('translates a kick at %d m/s', (surfaceSpeed) => {
    const text = hint({ ...base, surfaceSpeed }, missionOf('suborbital-hop'))?.text;
    expect(text).toContain(surfaceSpeed < 300 ? '300 m/s' : 'east');
    expect(text).not.toMatch(/\p{Script=Han}/u);
  });

  it.each([
    [0, 'ascending', 'east'], [45, 'ascending', 'northeast'], [90, 'ascending', 'north'], [135, 'ascending', 'northwest'],
    [180, 'ascending', 'west'], [135, 'descending', 'southwest'], [90, 'descending', 'south'], [45, 'descending', 'southeast'],
  ] as const)('maps the %d° %s launch compass to %s in presentation', (inclination, direction, expected) => {
    const task: MissionDefinition = {
      ...mission, ascent: { kind: 'kick', speed: 60, minAngleDeg: 2, maxAngleDeg: 3 },
      launch: { inclination: inclination * DEG2RAD, direction },
    };
    const text = missionFlightHint(base, vehicle, task, createMissionState(task), 0, 'en')?.text;
    expect(text).toContain(`tilt ${expected} by 2–3°`);
    expect(text).not.toMatch(/\p{Script=Han}/u);
  });

  it.each([
    // 拜科努尔飞 51.6°：方位角 062°，离八个键盘方向都远，提示"按住 D、间断点按 W"
    ['inclined-orbit', 'tapping W'],
    // 宇宙神 V 推重比低：100 m/s 时向南轻轻倾斜
    ['polar-orbit', 'tilt south'],
  ])('translates the launch turn for %s', (id, expected) => {
    const text = hint({ ...base, surfaceSpeed: id === 'polar-orbit' ? 120 : 70 }, missionOf(id))?.text;
    expect(text).toContain(expected);
    expect(text).not.toMatch(/\p{Script=Han}/u);
  });

  it('passes English through every generic fallback and keeps warning priority', () => {
    const state = createMissionState(mission);
    expect(missionFlightHint(base, vehicle, null, null, site.latitude, 'en')).toEqual(flightHint(base, vehicle, 'en'));
    expect(missionFlightHint(base, vehicle, mission, null, site.latitude, 'en')).toEqual(flightHint(base, vehicle, 'en'));
    expect(missionFlightHint(base, vehicle, mission, { ...state, status: 'success' }, site.latitude, 'en')).toEqual(flightHint(base, vehicle, 'en'));
    const pad = { ...base, phase: 'prelaunch' as const, ignited: false };
    expect(missionFlightHint(pad, vehicle, mission, state, site.latitude, 'en')?.text).toContain('Space');
    const depleted = { ...base, stagePropellant: [0, 10] };
    expect(hint(depleted)).toEqual(flightHint(depleted, vehicle, 'en'));
    expect(missionFlightHint(null, vehicle, mission, state, site.latitude, 'en')).toBeNull();
  });
});

describe('English mission orbit hints', () => {
  const mission = missionOf('inclined-orbit');
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = siteOf(mission);
  const config = createFlightConfig(vehicle, site, 'orbit');
  const raw = deriveTelemetry(buildSnapshot(new Simulation(config), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
  const orbit: OrbitTelemetry = { ...raw.orbit!, periapsisAltitude: 160_000, apoapsisAltitude: 300_000, inclination: 51.6 * DEG2RAD };
  const base: Telemetry = {
    ...raw, orbit, simTime: 100, missionTime: 100, altitude: 80_000, activeStageIndex: 1, thrust: 100,
    ignited: true, throttle: 1, verticalSpeed: 100, thermal: [], dynamicPressure: 0, bendingLoad: 0,
    referenceHeatFlux: 0, stagePropellant: [0, 10, 10, 10], attitudeMode: 'manual',
  };
  const cases: [string, Partial<OrbitTelemetry>, Partial<Telemetry>, string, Partial<MissionState>?][] = [
    ['orbit achieved', {}, {}, 'requirements met'],
    ['periapsis below minimum', { periapsisAltitude: 140_000 }, {}, '150 km'],
    ['periapsis and plane error', { periapsisAltitude: 140_000, inclination: 47 * DEG2RAD }, {}, 'tap W'],
    ['apoapsis above maximum', { apoapsisAltitude: 900_000 }, {}, '900 km'],
    ['increase inclination', { inclination: 47 * DEG2RAD }, {}, 'tap W'],
    ['decrease inclination', { inclination: 56 * DEG2RAD }, {}, 'tap S'],
    ['upper-stage pitch control', { classification: 'suborbital', periapsisAltitude: -200_000 }, {}, 'Use pitch'],
    ['non-east controls automatic', { classification: 'atmospheric', periapsisAltitude: 20_000 }, { attitudeMode: 'prograde' }, 'Press R'],
    ['orbit confirmation', {}, { thrust: 0 }, '6 s', { orbitHoldSince: 96 }],
    ['coasting low periapsis', { periapsisAltitude: 120_000 }, { thrust: 0 }, 'prograde hold (R)'],
    ['coasting high apoapsis', { apoapsisAltitude: 900_000 }, { thrust: 0 }, 'retrograde hold (T)'],
    ['coasting plane correction', { inclination: 47 * DEG2RAD }, { thrust: 0 }, 'normal / antinormal'],
    ['coasting non-orbit', { classification: 'suborbital', periapsisAltitude: -200_000, timeToApoapsis: 200 }, { thrust: 0 }, 'Coasting'],
    ['generic stable orbit', {}, { thrust: 0 }, 'Stable orbit'],
  ];
  it.each(cases)('translates %s without Han text', (_name, orbitChanges, changes, expected, stateChanges = {}) => {
    const telemetry = { ...base, ...changes, orbit: { ...orbit, ...orbitChanges } };
    const state = { ...createMissionState(mission), ...stateChanges };
    const hint = missionFlightHint(telemetry, vehicle, mission, state, site.latitude, 'en');
    expect(hint?.text).toContain(expected);
    expect(hint?.text).not.toMatch(/\p{Script=Han}/u);
    expect(hint?.tone).toBe(missionFlightHint(telemetry, vehicle, mission, state, site.latitude)?.tone);
    expect(missionFlightHint(telemetry, vehicle, mission, state, site.latitude, 'zh')).toEqual(missionFlightHint(telemetry, vehicle, mission, state, site.latitude));
  });
});

describe('English mission return hints', () => {
  const mission = missionOf('crew-return');
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = siteOf(mission);
  const config = createFlightConfig(vehicle, site, 'orbit');
  const raw = deriveTelemetry(buildSnapshot(new Simulation(config), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
  const base: Telemetry = {
    ...raw, missionTime: 100, altitude: 200_000, thrust: 0, throttle: 1, ignited: false,
    thermal: [], bendingLoad: 0, dynamicPressure: 0, referenceHeatFlux: 0, attitudeMode: 'retrograde',
    stagePropellant: [0, 0, 0, 10],
  };
  const cases: [string, Partial<Telemetry>, string][] = [
    ['turn around', { attitudeMode: 'manual' }, 'Press T'],
    ['start stage engine', {}, 'Service and orbital modules'],
    ['start spacecraft engine', { activeStageIndex: vehicle.stages.length }, 'spacecraft engine'],
    ['resume burn', { ignited: true }, 'press Z'],
    ['deorbit burn', { thrust: 100 }, 'Deorbit burn'],
    ['excessive burn', { thrust: 100, orbit: { ...raw.orbit!, periapsisAltitude: -400_000 } }, 'too steep'],
    ['shutdown and separate', { thrust: 100, orbit: { ...raw.orbit!, periapsisAltitude: 40_000 } }, 'separate Service and orbital modules'],
    ['missing propulsion stage', { thrust: 100, activeStageIndex: vehicle.stages.length, orbit: { ...raw.orbit!, periapsisAltitude: 40_000 } }, 'propulsion stage'],
  ];
  it.each(cases)('translates %s without Han text', (_name, changes, expected) => {
    const telemetry = { ...base, ...changes };
    const state = createMissionState(mission);
    const hint = missionFlightHint(telemetry, vehicle, mission, state, site.latitude, 'en');
    expect(hint?.text).toContain(expected);
    expect(hint?.text).not.toMatch(/\p{Script=Han}/u);
    expect(hint?.tone).toBe(missionFlightHint(telemetry, vehicle, mission, state, site.latitude)?.tone);
  });

  it('reminds a detached suborbital capsule to hold retrograde in English', () => {
    const task = missionOf('suborbital-hop');
    const telemetry: Telemetry = {
      ...base, activeStageIndex: vehicle.stages.length, stageAttached: vehicle.stages.map(() => false),
      orbit: null, attitudeMode: 'manual', parachute: { phase: 'stowed', dragArea: 0 },
    };
    const text = missionFlightHint(telemetry, vehicle, task, createMissionState(task), site.latitude, 'en')?.text;
    expect(text).toContain('Capsule separated');
    expect(text).toContain('T');
    expect(text).not.toMatch(/\p{Script=Han}/u);
  });
});

describe('任务提示：亚轨道任务', () => {
  it('突破卡门线：全程提示保持竖直；燃尽后分离；无动力上升时提示最高点；最后开伞', () => {
    const { hints, status } = hintsDuring('karman-line', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 0 }));
    expect(status).toBe('success');
    // （驾驶员在界面第一次刷新之前就点了火，燃尽的那一刻就按了分离：这两条提示在 flightHints.test.ts 里单独验证）
    expectInOrder(hints, [
      '保持竖直上升（不要按姿态键），等发动机燃尽',
      '靠惯性上升中：约 # s 后到达最高点',
      '将再入大气层',
      '减速中：马赫',
      '继续下落：降到 # km 以下、马赫 # 以下时按 G 开伞',
      '减速伞工作中',
      '主伞已张开',
    ]);
    // 这个任务不应该出现"向东倾斜"或"到远地点点火"的通用提示
    expect(hints.some((h) => h.includes('向东倾斜'))).toBe(false);
    expect(hints.some((h) => h.includes('顺行保持（R）并点火'))).toBe(false);
  });

  it('突破卡门线：箭体被推歪时给出警告', () => {
    const mission = missionOf('karman-line');
    const vehicle = getVehicleOrDefault(mission.vehicleId);
    const site = siteOf(mission);
    const config = createFlightConfig(vehicle, site);
    const sim = new Simulation(config);
    sim.stage();
    for (let i = 0; i < 1_500; i++) sim.step();
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    for (let i = 0; i < 60; i++) sim.step();
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    for (let i = 0; i < 100; i++) sim.step();
    const telemetry = deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    expect(telemetry.pitch / DEG2RAD).toBeLessThan(86);
    expect(missionFlightHint(telemetry, vehicle, mission, createMissionState(mission), site.latitude)).toEqual({
      text: '这次任务全程竖直：箭体已经倾斜，最大高度会降低',
      tone: 'warn',
    });
  });

  it('亚轨道飞行：先提示保持竖直等到 300 m/s，再提示倾斜的角度；分离后提示逆行保持', () => {
    const { hints, status } = hintsDuring('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 12, kickSpeed: 300, jettisonShield: true }));
    expect(status).toBe('success');
    expectInOrder(hints, [
      '先保持竖直：速度到 # m/s 再倾斜',
      '按住 D 向东倾斜 #–#°（俯仰读数 #–#°），松开后按 R 开启顺行保持',
      '靠惯性上升中',
      '已降到亚声速',
      '主伞已张开：下降速度 # m/s。可以按 H 抛掉防热大底',
      '主伞已张开：下降速度 # m/s，等待着陆',
    ]);
  });

  it('亚轨道飞行：返回舱分离后还没开启逆行保持时给出提醒', () => {
    const mission = missionOf('suborbital-hop');
    const vehicle = getVehicleOrDefault(mission.vehicleId);
    const site = siteOf(mission);
    const config = createFlightConfig(vehicle, site);
    const sim = new Simulation(config);
    sim.stage();
    while (sim.getVehicleState().stages[0]?.propellantMass !== 0) sim.step();
    sim.stage();
    for (let i = 0; i < 500; i++) sim.step();
    const hud = (): Telemetry => deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    // 竖直飞行时远地点很高：通用提示给出"靠惯性上升"，它是普通信息，任务提示优先
    const state = createMissionState(mission);
    expect(missionFlightHint(hud(), vehicle, mission, state, site.latitude)?.text).toBe('返回舱已分离：按 T 开启逆行保持，下落时防热大底才会一直朝前');
    sim.setAttitudeMode('retrograde');
    sim.step();
    expect(missionFlightHint(hud(), vehicle, mission, state, site.latitude)?.text).toMatch(/^靠惯性上升中/);
  });
});

describe('任务提示：入轨', () => {
  it('首次入轨（向东）：沿用通用的上升提示；关机后提示轨道确认中', () => {
    const { hints, status } = hintsDuring('first-orbit', orbitalPilot('first-orbit', { kickAngleDeg: 3 }), 1_500);
    expect(status).toBe('success');
    expectInOrder(hints, [
      '速度达到约 # m/s 后，按住 D 向东倾斜 #–#°',
      '助推器（B/V/G/D）已烧完：按 空格 抛掉，芯级继续工作',
      '芯级（A）推进剂耗尽：按 空格 分离',
      '用俯仰角控制垂直速度',
      '轨道确认中：保持关机，还需 # 秒',
    ]);
    // 近地点过了 140 km 但还不到 150 km 时，不能说"已入轨，可以关机"
    expect(hints.some((h) => h.includes('已入轨，可以关机'))).toBe(false);
    expect(hints.some((h) => /近地点 # km：升到 # km 再关机/.test(h))).toBe(true);
  });

  it('指定倾角轨道：起飞提示按住 D、间断点按 W 对准 062°；上面级飞行中提示用 W / S 修正倾角', () => {
    const { hints, status } = hintsDuring('inclined-orbit', orbitalPilot('inclined-orbit'), 1_500);
    expect(status).toBe('success');
    expectInOrder(hints, [
      '速度达到约 # m/s 后，按住 D 倾斜的同时间断地点按 W（大约一半的时间），倾斜约 #° 时航向读数应在 #° 附近',
      '助推器（B/V/G/D）已烧完',
      '倾角 #°，目标 #°：点按',
      '轨道确认中',
    ]);
    expect(hints.some((h) => h.includes('按住 D 向东倾斜'))).toBe(false);
  });

  it('极地轨道：起飞提示 S 向南；倾角不到 90° 时提示用 A 把航向压向西', () => {
    const { hints, status } = hintsDuring('polar-orbit', orbitalPilot('polar-orbit', { kickSpeed: 100, kickAngleDeg: 1.5, maxGLoad: 5 }), 1_500);
    expect(status).toBe('success');
    expectInOrder(hints, ['先保持竖直：速度到 # m/s 再倾斜', '按住 S 向南倾斜 #–#°', '过载 # g：按 ↓ 收小节流', '倾角 #°，目标 #°：点按 A 修正航向', '轨道确认中']);
  });

  it('入轨后轨道不符合要求：分别说明近地点太低、远地点太高、倾角不对', () => {
    const mission = missionOf('inclined-orbit');
    const vehicle = getVehicleOrDefault(mission.vehicleId);
    const site = siteOf(mission);
    const config = createFlightConfig(vehicle, site, 'orbit');
    const sim = new Simulation(config);
    for (let i = 0; i < 1_500; i++) sim.step();
    const base = deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    const state = createMissionState(mission);
    const withOrbit = (changes: Partial<OrbitTelemetry>): Telemetry => ({ ...base, orbit: { ...(base.orbit as OrbitTelemetry), ...changes } });
    const hint = (telemetry: Telemetry, missionState: MissionState = state) => missionFlightHint(telemetry, vehicle, mission, missionState, site.latitude);
    expect(hint(withOrbit({ periapsisAltitude: 120_000, apoapsisAltitude: 300_000, inclination: 51.6 * DEG2RAD }))?.text).toMatch(/^近地点 120 km，低于要求的 150 km：滑行到远地点附近/);
    expect(hint(withOrbit({ periapsisAltitude: 160_000, apoapsisAltitude: 900_000, inclination: 51.6 * DEG2RAD }))?.text).toMatch(/^远地点 900 km，超过 600 km 的上限：在近地点附近开启逆行保持/);
    const wrongPlane = hint(withOrbit({ periapsisAltitude: 160_000, apoapsisAltitude: 300_000, inclination: 46.9 * DEG2RAD }));
    expect(wrongPlane?.tone).toBe('warn');
    expect(wrongPlane?.text).toMatch(/^倾角 46\.9°，要求 51\.6° ± 2°。入轨后修正倾角很费推进剂/);
    // 轨道满足要求、正在保持：给出剩余秒数
    const holding = hint(withOrbit({ periapsisAltitude: 160_000, apoapsisAltitude: 300_000, inclination: 51.6 * DEG2RAD }), { ...state, orbitHoldSince: base.simTime - 4 });
    expect(holding?.text).toBe('轨道确认中：保持关机，还需 6 秒');
    // 自由飞行（没有任务）时就是通用提示
    expect(missionFlightHint(base, vehicle, null, null, site.latitude)).toEqual(flightHint(base, vehicle));
  });
});

describe('任务提示：返回', () => {
  // These two integration tests simulate entire flights, not a single hint.
  // Allow for CPU contention when the full suite runs workers in parallel.
  const fullFlightTimeout = 20_000;

  it('载人飞船返回：依次提示逆行保持、点火离轨、关机分离、再入、开伞、抛大底', () => {
    const { hints, status } = hintsDuring('crew-return', (sim, config) => new ReturnPilot(sim, config, { entry: 'trim', jettisonShield: true }));
    expect(status).toBe('success');
    expectInOrder(hints, [
      '逆行保持中：箭体调头后按 空格 启动服务舱与轨道舱发动机，再按 Z 点火',
      '离轨点火中：近地点 # km，降到 #–# km 后按 X 关机',
      '近地点 # km：按 X 关机，然后按 空格 分离服务舱与轨道舱',
      '即将再入大气层：配平再入',
      '再入中：配平再入',
      '已降到亚声速',
      '主伞已张开',
    ]);
    // 离轨点火期间不出现"已入轨，可以关机"
    expect(hints.some((h) => h.includes('已入轨，可以关机'))).toBe(false);
  }, fullFlightTimeout);

  it('载人飞船返回：任务一开始提示的是离轨，而不是通用的"已在轨道上，启动二级"', () => {
    const mission = missionOf('crew-return');
    const vehicle = getVehicleOrDefault(mission.vehicleId);
    const site = siteOf(mission);
    const config = createFlightConfig(vehicle, site, 'orbit');
    const sim = new Simulation(config);
    sim.step();
    const telemetry = deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    expect(flightHint(telemetry, vehicle)?.text).toMatch(/^已在轨道上。按 空格 启动服务舱与轨道舱发动机/);
    expect(missionFlightHint(telemetry, vehicle, mission, createMissionState(mission), site.latitude)).toEqual({
      text: '任务：返回地球。按 T 开启逆行保持，等箭体调头（可以用 . 加快时间）',
      tone: 'info',
    });
    // 发射台上的任务：点火提示照常
    const pad = missionOf('first-orbit');
    const padConfig = createFlightConfig(getVehicleOrDefault(pad.vehicleId), siteOf(pad));
    const padTelemetry = deriveTelemetry(buildSnapshot(new Simulation(padConfig), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), padConfig);
    expect(missionFlightHint(padTelemetry, getVehicleOrDefault(pad.vehicleId), pad, createMissionState(pad), siteOf(pad).latitude)?.text).toBe('按 空格 点火起飞');
  });

  it('载人轨道飞行：轨道确认之后提示返回', () => {
    const { hints, status } = hintsDuring('orbital-flight', orbitalPilot('orbital-flight', {}, { entry: 'trim' }));
    expect(status).toBe('success');
    expectInOrder(hints, ['用俯仰角控制垂直速度', '轨道确认中', '任务：返回地球。按 T 开启逆行保持', '离轨点火中', '已降到亚声速']);
  }, fullFlightTimeout);
});

describe('任务界面的文字', () => {
  const mission = missionOf('inclined-orbit');
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const config = createFlightConfig(vehicle, siteOf(mission), 'orbit');
  const sim = new Simulation(config);
  const telemetry = deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
  const orbitSpec = mission.objectives[0]!.spec;

  it('目标的进度读数', () => {
    expect(objectiveProgress({ kind: 'reach-altitude', altitude: 100_000 }, 'pending', { ...telemetry, altitude: 61_400 }, { ...sim.flightStats, maxAltitude: 86_300 }, null)).toBe(
      '最大高度 86 / 100 km',
    );
    expect(objectiveProgress({ kind: 'reach-altitude', altitude: 100_000 }, 'done', telemetry, sim.flightStats, null)).toBe('');
    // 入轨目标：近地点、倾角；远地点超限时才显示
    expect(objectiveProgress(orbitSpec, 'pending', telemetry, sim.flightStats, null)).toBe('近地点 200 / 150 km · 倾角 46.0° / 51.6°');
    const high = { ...telemetry, orbit: { ...(telemetry.orbit as OrbitTelemetry), apoapsisAltitude: 812_000 } };
    expect(objectiveProgress(orbitSpec, 'pending', high, sim.flightStats, null)).toBe('近地点 200 / 150 km · 远地点 812 km（上限 600） · 倾角 46.0° / 51.6°');
    const holding = { ...createMissionState(mission), orbitHoldSince: telemetry.simTime - 3 };
    expect(objectiveProgress(orbitSpec, 'pending', telemetry, sim.flightStats, holding)).toContain('确认中 7 s');
    expect(objectiveProgress(orbitSpec, 'pending', { ...telemetry, orbit: null }, sim.flightStats, null)).toBe('近地点 ≥ 150 km');
    expect(objectiveProgress({ kind: 'land-capsule' }, 'pending', telemetry, sim.flightStats, null)).toBe('');
    expect(objectiveProgress({ kind: 'land-capsule' }, 'pending', { ...telemetry, parachute: { phase: 'main', dragArea: 2_000 } }, sim.flightStats, null)).toBe('主伞已张开');
  });

  it('评分指标的数值带上各自的单位；不存在的指标显示"—"', () => {
    expect(metricText('max-g', 6.249)).toBe('6.2 g');
    expect(metricText('orbit-spread', 71_300)).toBe('71 km');
    expect(metricText('max-altitude', 286_300)).toBe('286 km');
    expect(metricText('downrange', 531_000)).toBe('531 km');
    expect(metricText('inclination-error', 0.56 * DEG2RAD)).toBe('0.56°');
    expect(metricText('delta-v-margin', 3_037.4)).toBe('3,037 m/s');
    expect(metricText('landing-speed', 7.49)).toBe('7.5 m/s');
    expect(metricText('ablator-remaining', 0.913)).toBe('91%');
    expect(metricText('landing-speed', null)).toBe('—');
    expect(metricText(null, null)).toBe('');
  });

  it('失败原因与飞行日志的显示', () => {
    expect(missionFailureText('destroyed')).toBe('飞行器损毁');
    expect(missionFailureText('out-of-propellant')).toContain('推进剂已经耗尽');
    expect(missionFailureText(null)).toBe('');
    expect(logResult({ result: 'landed', cause: null, missionStatus: 'success', orbit: null })).toEqual({ text: '安全着陆', tone: 'text-ok' });
    expect(logResult({ result: 'destroyed', cause: 'overload', missionStatus: 'failed', orbit: null }).text).toBe('过载解体');
    expect(logResult({ result: 'destroyed', cause: null, missionStatus: null, orbit: null }).text).toBe('损毁');
    const orbit = { apoapsisAltitude: 221_000, periapsisAltitude: 150_000, inclination: 28.48 * DEG2RAD };
    expect(logResult({ result: 'in-flight', cause: null, missionStatus: 'success', orbit }).text).toBe('在轨');
    expect(logResult({ result: 'in-flight', cause: null, missionStatus: null, orbit: null }).text).toBe('飞行中退出');
    expect(logOrbit(orbit)).toBe('150 × 221 km · 28.5°');
    expect(logOrbit(null)).toBe('');
    expect(logDate('not a date')).toBe('not a date');
    expect(logDate(new Date(2026, 10, 15, 9, 5).toISOString())).toBe('11-15 09:05');
  });
});
