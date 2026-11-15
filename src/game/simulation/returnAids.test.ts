/**
 * 配平再入（质心横向偏移 → 配平迎角 → 升力，倾侧角控制升力方向）与抛防热大底。
 * 这些测试都通过完整的模拟器运行（与游戏中相同的物理步长与控制指令）。
 */
import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { trimDirection } from '../physics/attitude/pointing';
import { DEG2RAD, EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import { verticalLaunchAttitude } from '../physics/frames/frames';
import { rotate } from '../physics/math/quat';
import { type Vec3, add, angleBetween, cross, dot, length, negate, normalize, scale, sub, vec3 } from '../physics/math/vec3';
import { deriveTelemetry } from '../telemetry/telemetry';
import { capsuleSideAngle, computeMassProperties, heatShieldCenterHeight } from '../vehicles/analysis';
import { canJettisonHeatShield, configurationTrimAngle, initialConfiguration } from '../vehicles/configuration';
import type { CapsuleDefinition } from '../vehicles/types';
import { BANK_RATE, Simulation } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { buildSnapshot } from './snapshot';
import type { FlightEvent, InitialFlightState, SimEvent, SimulationConfig } from './types';

const site = launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'));
const epochJulianDate = julianDateFromUnixMs(Date.UTC(2026, 3, 12, 14, 52));
const OMEGA = vec3(0, 0, EARTH.ROTATION_RATE);
const frontier = getVehicleOrDefault('frontier-1');
const meteor = getVehicleOrDefault('meteor-s');
const capsule = frontier.payload as CapsuleDefinition;

const configFor = (vehicleId: string, initialState?: InitialFlightState): SimulationConfig => ({
  vehicle: getVehicleOrDefault(vehicleId),
  site,
  epochJulianDate,
  initialState,
});

const altitudeOf = (sim: Simulation): number => length(sim.getVehicleState().body.position) - EARTH.RADIUS;
const gLoadOf = (sim: Simulation): number => length(sim.getVehicleState().specificForce) / STANDARD_GRAVITY;
const airVelocityOf = (sim: Simulation): Vec3 => {
  const { position, velocity } = sim.getVehicleState().body;
  return sub(velocity, cross(OMEGA, position));
};
const noseOf = (sim: Simulation): Vec3 => rotate(sim.getVehicleState().body.attitude, vec3(1, 0, 0));
const run = (sim: Simulation, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / sim.dt); i++) sim.step();
};

/** 赤道上空 altitude 处的再入初始状态：惯性速度 speed、航迹角 gamma（向下为正），防热大底正对速度方向。 */
const entryState = (speed: number, gammaDeg: number, altitude = 120_000, separatedStages = 2): InitialFlightState => {
  const gamma = gammaDeg * DEG2RAD;
  const position = vec3(EARTH.RADIUS + altitude, 0, 0);
  const velocity = vec3(-speed * Math.sin(gamma), speed * Math.cos(gamma), 0);
  return { position, velocity, attitude: verticalLaunchAttitude(negate(normalize(velocity))), separatedStages };
};

/** 低空下降的返回舱：相对大气以 speed 竖直下落（舱顶朝上），用于伞降阶段的测试。 */
const descentState = (speed: number, altitude: number): InitialFlightState => {
  const position = vec3(EARTH.RADIUS + altitude, 0, 0);
  const velocity = add(cross(OMEGA, position), vec3(-speed, 0, 0));
  return { position, velocity, attitude: verticalLaunchAttitude(vec3(1, 0, 0)), separatedStages: 2 };
};

interface EntryResult {
  readonly sim: Simulation;
  readonly events: FlightEvent[];
  /** 开伞之前的最大过载（再入减速段）。 */
  readonly entryG: number;
  /** 落点（或结束点）相对初始轨道面的横向偏移 [m]：正值偏向初始角动量方向（飞行方向的左侧）。 */
  readonly crossRange: number;
  /** 沿初始轨道面的航程 [m]。 */
  readonly downRange: number;
  /** 掠过大气层（降到 100 km 以下）后又飞回 125 km 以上。 */
  readonly skippedOut: boolean;
  /** 各热区在飞行中出现过的最小热裕度。 */
  readonly minMargin: Readonly<Record<'nose' | 'side' | 'base', number>>;
}

interface EntryOptions {
  readonly mode: 'retrograde' | 'trim';
  readonly bankDeg?: number;
  /** 主伞张开后抛掉防热大底。 */
  readonly jettisonShield?: boolean;
  readonly timeout?: number;
}

const flyEntry = (config: SimulationConfig, options: EntryOptions): EntryResult => {
  const sim = new Simulation(config);
  sim.setAttitudeMode(options.mode);
  sim.setBankAngle((options.bankDeg ?? 0) * DEG2RAD);
  const start = sim.getVehicleState().body;
  const planeNormal = normalize(cross(start.position, start.velocity));
  const events: FlightEvent[] = [];
  const minMargin = { nose: 1, side: 1, base: 1 };
  let entryG = 0;
  let lowest = Infinity;
  let skippedOut = false;
  while (sim.flightPhase === 'flight' && sim.time < (options.timeout ?? 4_000)) {
    sim.step();
    events.push(...sim.drainEvents());
    const state = sim.getVehicleState();
    const altitude = altitudeOf(sim);
    lowest = Math.min(lowest, altitude);
    if (lowest < 100_000 && altitude > 125_000) {
      skippedOut = true;
      break;
    }
    for (const zone of state.thermal) minMargin[zone.zone] = Math.min(minMargin[zone.zone], zone.margin);
    if (state.parachute.phase === 'stowed') entryG = Math.max(entryG, gLoadOf(sim));
    if (altitudeOf(sim) < 6_000 && state.parachute.phase === 'stowed' && state.flight.mach < 0.85) sim.deployParachute();
    if (options.jettisonShield && state.parachute.phase === 'main' && state.heatShieldAttached) sim.jettisonHeatShield();
  }
  // 结束点在惯性系中的位置（落地后飞行器随地球转动，这里用结束时刻的位置）
  const end = normalize(sim.getVehicleState().body.position);
  const crossRange = Math.asin(dot(end, planeNormal)) * EARTH.RADIUS;
  const inPlane = normalize(sub(end, scale(planeNormal, dot(end, planeNormal))));
  const downRange = angleBetween(inPlane, normalize(start.position)) * EARTH.RADIUS;
  return { sim, events, entryG, crossRange, downRange, skippedOut, minMargin };
};

const capsuleEntry = (speed = 7_800, gammaDeg = 1.5): SimulationConfig => configFor('frontier-1', entryState(speed, gammaDeg));

describe('配平迎角：由质心的横向偏移决定', () => {
  it('白鹭号的质心偏移 11 cm 给出约 20° 的配平迎角；只有单独的返回舱才有', () => {
    const attached = initialConfiguration(frontier);
    expect(configurationTrimAngle(frontier, attached)).toBe(0);
    const alone = { ...attached, stages: attached.stages.map((s) => ({ ...s, attached: false })) };
    const trim = configurationTrimAngle(frontier, alone);
    expect(trim / DEG2RAD).toBeGreaterThan(18);
    expect(trim / DEG2RAD).toBeLessThan(21);
    // 模型的适用范围：迎角不超过侧壁半锥角（这里取 25° 作为上限）
    expect(capsule.centerOfMass.lateralOffset).toBeGreaterThan(0);
  });

  it('流星-S 的返回舱质心在轴线上：弹道式返回舱，没有配平迎角', () => {
    const config = initialConfiguration(meteor);
    const alone = { ...config, stages: config.stages.map((s) => ({ ...s, attached: false })) };
    expect(configurationTrimAngle(meteor, alone)).toBe(0);
    const sim = new Simulation(configFor('meteor-s', entryState(2_000, 30, 100_000, 1)));
    sim.setAttitudeMode('trim');
    expect(sim.getVehicleState().attitudeMode).toBe('manual');
    expect(sim.getVehicleState().trimAngle).toBe(0);
  });

  it('目录中每个返回舱的质心都在舱体内，配平迎角在模型适用范围内，大底质量是干质量的一小部分', () => {
    for (const vehicle of VEHICLE_CATALOG) {
      const { payload } = vehicle;
      if (payload.kind !== 'capsule') continue;
      expect(payload.centerOfMass.height).toBeGreaterThan(0);
      expect(payload.centerOfMass.height).toBeLessThan(payload.geometry.length / 2);
      expect(payload.centerOfMass.lateralOffset).toBeGreaterThanOrEqual(0);
      expect(payload.centerOfMass.lateralOffset).toBeLessThan(payload.geometry.diameter * 0.1);
      const config = initialConfiguration(vehicle);
      const alone = { ...config, stages: config.stages.map((s) => ({ ...s, attached: false })) };
      expect(configurationTrimAngle(vehicle, alone) / DEG2RAD).toBeLessThan(25);
      expect(payload.heatShield.mass).toBeGreaterThan(0);
      expect(payload.heatShield.mass).toBeLessThan(payload.dryMass * 0.2);
    }
  });
});

describe('配平再入的头部方向', () => {
  const r = vec3(EARTH.RADIUS + 80_000, 0, 0);
  const v = vec3(-300, 7_400, 0);
  const air = normalize(sub(v, cross(OMEGA, r)));
  const up = normalize(r);
  const liftUp = normalize(sub(up, scale(air, dot(up, air))));
  const right = cross(air, liftUp);
  const angle = 20 * DEG2RAD;

  it('头部偏离"正对来流"恰好一个配平迎角；倾侧角 0 时偏向天顶', () => {
    const nose = trimDirection(r, v, { angle, bank: 0 })!;
    expect(angleBetween(nose, negate(air)) / DEG2RAD).toBeCloseTo(20, 9);
    expect(dot(nose, liftUp)).toBeCloseTo(Math.sin(angle), 9);
    expect(dot(nose, right)).toBeCloseTo(0, 9);
    expect(length(nose)).toBeCloseTo(1, 12);
  });

  it('倾侧角 +90° 偏向飞行方向的右侧，180° 偏向地面，−90° 偏向左侧', () => {
    const rightward = trimDirection(r, v, { angle, bank: 90 * DEG2RAD })!;
    expect(dot(rightward, right)).toBeCloseTo(Math.sin(angle), 9);
    expect(dot(rightward, liftUp)).toBeCloseTo(0, 9);
    const downward = trimDirection(r, v, { angle, bank: Math.PI })!;
    expect(dot(downward, liftUp)).toBeCloseTo(-Math.sin(angle), 9);
    const leftward = trimDirection(r, v, { angle, bank: -90 * DEG2RAD })!;
    expect(dot(leftward, right)).toBeCloseTo(-Math.sin(angle), 9);
    // 向东飞行时"右"是南：赤道上空即 −Z
    expect(right.z).toBeLessThan(-0.99);
  });

  it('配平迎角为 0、或速度沿竖直方向（"向上"没有定义）时退化为正对来流', () => {
    const straight = trimDirection(r, v, { angle: 0, bank: 1 })!;
    expect(angleBetween(straight, negate(air))).toBeLessThan(1e-9);
    const vertical = add(cross(OMEGA, r), vec3(-500, 0, 0));
    const falling = trimDirection(r, vertical, { angle, bank: 0 })!;
    expect(angleBetween(falling, up)).toBeLessThan(1e-6);
    expect(trimDirection(r, cross(OMEGA, r), { angle, bank: 0 })).toBeNull();
  });
});

describe('配平保持', () => {
  it('带着推进级时不能进入配平模式；分离后可以', () => {
    const sim = new Simulation(configFor('frontier-1', entryState(7_800, 0, 200_000, 1)));
    sim.setAttitudeMode('trim');
    expect(sim.getVehicleState().attitudeMode).toBe('manual');
    expect(sim.getVehicleState().trimAngle).toBe(0);
    sim.stage(); // 启动二级
    sim.stage(); // 分离二级
    expect(sim.getVehicleState().activeStageIndex).toBe(2);
    expect(sim.getVehicleState().trimAngle).toBeGreaterThan(0.3);
    sim.setAttitudeMode('trim');
    expect(sim.getVehicleState().attitudeMode).toBe('trim');
  });

  it('再入过程中迎角保持在 180° − 配平迎角，升阻比约 0.3，升力向上', () => {
    const sim = new Simulation(capsuleEntry());
    sim.setAttitudeMode('trim');
    const trim = sim.getVehicleState().trimAngle;
    let samples = 0;
    while (sim.flightPhase === 'flight' && sim.time < 1_500 && altitudeOf(sim) > 30_000) {
      sim.step();
      const state = sim.getVehicleState();
      if (sim.time < 60 || state.flight.dynamicPressure < 200) continue;
      samples += 1;
      expect(Math.abs(state.flight.angleOfAttack - (Math.PI - trim)) / DEG2RAD).toBeLessThan(0.3);
      expect(state.flight.lift / state.flight.drag).toBeGreaterThan(0.29);
      expect(state.flight.lift / state.flight.drag).toBeLessThan(0.33);
      // 升力（比力中垂直于来流的部分）指向天顶一侧
      const air = normalize(airVelocityOf(sim));
      const lift = sub(state.specificForce, scale(air, dot(state.specificForce, air)));
      expect(dot(lift, normalize(state.body.position))).toBeGreaterThan(0);
    }
    expect(samples).toBeGreaterThan(5_000);
  });

  it('滚转键改变倾侧角（不打断配平保持）；俯仰/偏航键才是手动接管', () => {
    const sim = new Simulation(capsuleEntry());
    sim.setAttitudeMode('trim');
    run(sim, 40);
    expect(sim.getVehicleState().bankAngle).toBe(0);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 1 });
    run(sim, 2);
    // E 键：以 BANK_RATE 向右倾侧
    expect(sim.getVehicleState().bankAngle).toBeCloseTo(BANK_RATE * 2, 6);
    expect(sim.getVehicleState().attitudeMode).toBe('trim');
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 10);
    const state = sim.getVehicleState();
    expect(state.bankAngle).toBeCloseTo(BANK_RATE * 2, 6);
    // 头部跟上了新的倾侧角：相对"正对来流"的偏转有向右的分量
    const air = normalize(airVelocityOf(sim));
    const up = normalize(state.body.position);
    const liftUp = normalize(sub(up, scale(air, dot(up, air))));
    const right = cross(air, liftUp);
    const nose = noseOf(sim);
    expect(angleBetween(nose, negate(air)) / DEG2RAD).toBeCloseTo(state.trimAngle / DEG2RAD, 0);
    expect(dot(nose, right)).toBeCloseTo(Math.sin(state.trimAngle) * Math.sin(BANK_RATE * 2), 2);

    // 俯仰输入：手动接管，头部离开配平方向；松开后配平保持把它拉回来
    sim.setAttitudeInput({ pitch: 1, yaw: 0, roll: 0 });
    run(sim, 3);
    expect(Math.abs(angleBetween(noseOf(sim), negate(normalize(airVelocityOf(sim)))) - state.trimAngle) / DEG2RAD).toBeGreaterThan(5);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 20);
    expect(angleBetween(noseOf(sim), negate(normalize(airVelocityOf(sim)))) / DEG2RAD).toBeCloseTo(state.trimAngle / DEG2RAD, 0);
  });

  it('倾侧角指令以有限的速率、沿最短路径执行', () => {
    const sim = new Simulation(capsuleEntry());
    sim.setAttitudeMode('trim');
    sim.setBankAngle(170 * DEG2RAD);
    run(sim, 4);
    expect(sim.getVehicleState().bankAngle / DEG2RAD).toBeCloseTo(60, 6);
    run(sim, 10);
    expect(sim.getVehicleState().bankAngle / DEG2RAD).toBeCloseTo(170, 6);
    // 从 +170° 到 −170°：经过 180° 只需转 20°，而不是反向转 340°
    sim.setBankAngle(-170 * DEG2RAD);
    run(sim, 1);
    expect(Math.abs(sim.getVehicleState().bankAngle) / DEG2RAD).toBeGreaterThan(170);
    run(sim, 1);
    expect(sim.getVehicleState().bankAngle / DEG2RAD).toBeCloseTo(-170, 6);
    // 无效的指令被忽略
    sim.setBankAngle(Number.NaN);
    run(sim, 1);
    expect(sim.getVehicleState().bankAngle / DEG2RAD).toBeCloseTo(-170, 6);
  });

  it('开伞后退出配平模式（返回舱被伞绳拉正）', () => {
    const sim = new Simulation(configFor('frontier-1', descentState(120, 6_000)));
    sim.setAttitudeMode('trim');
    expect(sim.getVehicleState().attitudeMode).toBe('trim');
    run(sim, 2);
    sim.deployParachute();
    expect(sim.getVehicleState().parachute.phase).toBe('drogue');
    expect(sim.getVehicleState().attitudeMode).toBe('manual');
  });
});

describe('配平再入：升力改变再入的结果', () => {
  const ballistic = flyEntry(capsuleEntry(), { mode: 'retrograde' });
  const liftUp = flyEntry(capsuleEntry(), { mode: 'trim', bankDeg: 0 });

  it('升力向上：过载从约 8 g 降到 4 g 以下，飞得更远，峰值热流更低而总热载荷更高', () => {
    expect(ballistic.sim.flightOutcome?.kind).toBe('landed');
    expect(liftUp.sim.flightOutcome?.kind).toBe('landed');
    expect(ballistic.entryG).toBeGreaterThan(7.5);
    expect(liftUp.entryG).toBeLessThan(3);
    expect(liftUp.entryG).toBeGreaterThan(2.2);
    expect(liftUp.downRange).toBeGreaterThan(ballistic.downRange + 1_000_000);
    expect(liftUp.sim.flightStats.maxHeatFlux).toBeLessThan(ballistic.sim.flightStats.maxHeatFlux * 0.8);
    expect(liftUp.sim.flightStats.maxHeatLoad).toBeGreaterThan(ballistic.sim.flightStats.maxHeatLoad * 1.2);
    // 两者都以降落伞下的稳定速度着陆
    expect(Math.abs(liftUp.sim.flightOutcome!.verticalSpeed)).toBeLessThan(9);
  });

  it('升力向上放宽了再入走廊：5°、6° 的再入角弹道式会过载解体，配平再入可以承受', () => {
    for (const gamma of [5, 6]) {
      const steepBallistic = flyEntry(capsuleEntry(7_800, gamma), { mode: 'retrograde' });
      expect(steepBallistic.sim.flightOutcome?.cause).toBe('overload');
      const steepLifting = flyEntry(capsuleEntry(7_800, gamma), { mode: 'trim', bankDeg: 0 });
      expect(steepLifting.sim.flightOutcome?.kind).toBe('landed');
      expect(steepLifting.entryG).toBeLessThan(capsule.structure.maxGLoad);
    }
  });

  it('升力向下（倾侧 180°）：扎进稠密大气，过载超过结构限值', () => {
    const liftDown = flyEntry(capsuleEntry(), { mode: 'trim', bankDeg: 180 });
    expect(liftDown.sim.flightOutcome?.kind).toBe('destroyed');
    expect(liftDown.sim.flightOutcome?.cause).toBe('overload');
    expect(liftDown.downRange).toBeLessThan(ballistic.downRange);
  });

  it('倾侧 60°：升力的竖直分量减半，过载与航程介于两者之间', () => {
    const banked = flyEntry(capsuleEntry(), { mode: 'trim', bankDeg: 60 });
    expect(banked.sim.flightOutcome?.kind).toBe('landed');
    expect(banked.entryG).toBeGreaterThan(liftUp.entryG);
    expect(banked.entryG).toBeLessThan(ballistic.entryG);
    expect(banked.downRange).toBeGreaterThan(ballistic.downRange);
    expect(banked.downRange).toBeLessThan(liftUp.downRange);
  });

  it('向右 / 向左倾侧使落点向相应一侧偏移（横向机动），两侧对称', () => {
    const rightward = flyEntry(capsuleEntry(), { mode: 'trim', bankDeg: 60 });
    const leftward = flyEntry(capsuleEntry(), { mode: 'trim', bankDeg: -60 });
    // 向东飞行：右侧是南，即初始角动量方向（+Z）的反方向
    expect(rightward.crossRange).toBeLessThan(-30_000);
    expect(leftward.crossRange).toBeGreaterThan(30_000);
    expect(Math.abs(rightward.crossRange + leftward.crossRange)).toBeLessThan(0.15 * Math.abs(rightward.crossRange));
    expect(Math.abs(liftUp.crossRange)).toBeLessThan(5_000);
    expect(Math.abs(ballistic.crossRange)).toBeLessThan(5_000);
  });

  it('配平迎角小于侧壁的半锥角：侧壁躲在大底的背风区里，正常的配平再入各部位都留有充分的热裕度', () => {
    for (const gamma of [0.8, 1.5, 2.5]) {
      const { sim, minMargin, entryG } = flyEntry(capsuleEntry(7_800, gamma), { mode: 'trim' });
      expect(sim.flightOutcome?.kind, `航迹角 ${gamma}°`).toBe('landed');
      expect(entryG, `航迹角 ${gamma}°`).toBeLessThan(3);
      expect(minMargin.side, `航迹角 ${gamma}°`).toBeGreaterThan(0.45);
      expect(minMargin.nose, `航迹角 ${gamma}°`).toBeGreaterThan(0.45);
      expect(minMargin.base, `航迹角 ${gamma}°`).toBeGreaterThan(0.6);
    }
    // 目录数据：配平迎角确实小于半锥角
    expect(configurationTrimAngle(frontier, { ...initialConfiguration(frontier), stages: [{ propellantMass: 0, attached: false }, { propellantMass: 0, attached: false }] })).toBeLessThan(capsuleSideAngle(capsule));
  });

  it('高于圆轨道速度（10.3 km/s，5.5°）：升力向上会跳出大气层，侧向倾侧能留在大气层内并着陆，升力向下则过载解体', () => {
    const up = flyEntry(capsuleEntry(10_300, 5.5), { mode: 'trim', bankDeg: 0 });
    expect(up.skippedOut).toBe(true);
    const sideways = flyEntry(capsuleEntry(10_300, 5.5), { mode: 'trim', bankDeg: 90 });
    expect(sideways.skippedOut).toBe(false);
    expect(sideways.sim.flightOutcome?.kind).toBe('landed');
    const down = flyEntry(capsuleEntry(10_300, 5.5), { mode: 'trim', bankDeg: 180 });
    expect(down.sim.flightOutcome?.cause).toBe('overload');
  });

  it('轨迹预测跟随配平模式：升力向上时预测的落点比弹道式更远', () => {
    const predictedAndFlown = (mode: 'retrograde' | 'trim'): { predicted: number; flown: number } => {
      const sim = new Simulation(capsuleEntry());
      sim.setAttitudeMode(mode);
      run(sim, 30);
      const before = sim.getVehicleState();
      const prediction = sim.predictTrajectory()!;
      // 预测不改变真实状态
      expect(sim.getVehicleState()).toEqual(before);
      expect(prediction.impact).not.toBeNull();
      const n = prediction.times.length;
      const last = vec3(prediction.points[(n - 1) * 3]!, prediction.points[(n - 1) * 3 + 1]!, prediction.points[(n - 1) * 3 + 2]!);
      // 继续把这次飞行飞完（不开伞），与预测的落点比较
      while (sim.flightPhase === 'flight' && sim.time < 4_000) sim.step();
      return {
        predicted: angleBetween(last, before.body.position) * EARTH.RADIUS,
        flown: angleBetween(sim.getVehicleState().body.position, before.body.position) * EARTH.RADIUS,
      };
    };
    const lifting = predictedAndFlown('trim');
    const plain = predictedAndFlown('retrograde');
    expect(lifting.predicted).toBeGreaterThan(plain.predicted + 800_000);
    // 预测与实际飞行的航程一致（升力式再入的航程对升阻比很敏感，这里要求 3% 以内）
    expect(Math.abs(lifting.predicted - lifting.flown) / lifting.flown).toBeLessThan(0.03);
    expect(Math.abs(plain.predicted - plain.flown) / plain.flown).toBeLessThan(0.03);
  });
});

describe('抛防热大底', () => {
  it('发射台上、带着推进级时不能抛（大底被挡在里面）', () => {
    const pad = new Simulation(configFor('frontier-1'));
    pad.jettisonHeatShield();
    expect(pad.getVehicleState().heatShieldAttached).toBe(true);
    const attached = new Simulation(configFor('frontier-1', entryState(7_800, 0, 200_000, 1)));
    expect(canJettisonHeatShield(frontier, attached.getVehicleState())).toBe(false);
    attached.jettisonHeatShield();
    expect(attached.getVehicleState().heatShieldAttached).toBe(true);
    expect(attached.drainEvents()).toHaveLength(0);
    // 卫星没有防热大底
    expect(new Simulation(configFor('zenith-3')).getVehicleState().heatShieldAttached).toBe(false);
  });

  it('减去大底的质量、质心上移、动量守恒，大底成为独立的分离体', () => {
    const sim = new Simulation(configFor('frontier-1', descentState(100, 4_000)));
    run(sim, 1);
    const before = sim.getVehicleState();
    const momentumBefore = scale(before.body.velocity, before.mass);
    expect(canJettisonHeatShield(frontier, before)).toBe(true);
    sim.jettisonHeatShield();
    const after = sim.getVehicleState();
    expect(after.heatShieldAttached).toBe(false);
    expect(after.mass).toBeCloseTo(before.mass - capsule.heatShield.mass, 9);
    expect(after.centerOfMassHeight).toBeGreaterThan(before.centerOfMassHeight);
    expect(sim.drainEvents().map((e) => e.kind)).toEqual(['heat-shield']);

    const [shield] = sim.getDebris();
    expect(shield?.kind).toBe('heat-shield');
    const momentumAfter = add(scale(after.body.velocity, after.mass), scale(shield!.velocity, capsule.heatShield.mass));
    expect(length(sub(momentumAfter, momentumBefore)) / length(momentumBefore)).toBeLessThan(1e-12);
    // 大底向舱底方向弹出，相对速度 2 m/s
    const relative = sub(shield!.velocity, after.body.velocity);
    expect(length(relative)).toBeCloseTo(2, 9);
    expect(dot(normalize(relative), rotate(after.body.attitude, vec3(1, 0, 0)))).toBeCloseTo(-1, 9);
    // 状态点移到了新的质心：舱体本身没有瞬移（舱底的位置不变）
    const baseBefore = sub(before.body.position, scale(rotate(before.body.attitude, vec3(1, 0, 0)), before.centerOfMassHeight));
    const baseAfter = sub(after.body.position, scale(rotate(after.body.attitude, vec3(1, 0, 0)), after.centerOfMassHeight));
    expect(length(sub(baseAfter, baseBefore))).toBeLessThan(1e-6);

    // 再抛一次没有效果
    sim.jettisonHeatShield();
    expect(sim.getVehicleState().mass).toBe(after.mass);
    expect(sim.getDebris()).toHaveLength(1);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('质量特性：大底在舱底，抛掉后返回舱的质心上移', () => {
    const input = { stagePropellant: [0, 0], stageAttached: [false, false], payloadPropellant: 0, fairingAttached: false };
    const withShield = computeMassProperties(frontier, input);
    expect(withShield.mass).toBe(capsule.dryMass);
    expect(withShield.centerOfMassHeight).toBeCloseTo(capsule.centerOfMass.height, 12);
    const without = computeMassProperties(frontier, { ...input, heatShieldAttached: false });
    expect(without.mass).toBe(capsule.dryMass - capsule.heatShield.mass);
    const expected =
      (capsule.dryMass * capsule.centerOfMass.height - capsule.heatShield.mass * heatShieldCenterHeight(capsule)) /
      (capsule.dryMass - capsule.heatShield.mass);
    expect(without.centerOfMassHeight).toBeCloseTo(expected, 12);
  });

  it('底部热区改由舱底结构承担：没有烧蚀层，从环境温度开始', () => {
    const sim = new Simulation(capsuleEntry());
    sim.setAttitudeMode('retrograde');
    run(sim, 200);
    const shield = sim.getVehicleState().thermal.find((z) => z.zone === 'base')!;
    expect(shield.ablative).toBe(true);
    expect(shield.owner).toBe('payload');
    expect(shield.surfaceTemperature).toBeGreaterThan(900);
    sim.jettisonHeatShield();
    const bare = sim.getVehicleState().thermal.find((z) => z.zone === 'base')!;
    expect(bare.ablative).toBe(false);
    expect(bare.owner).toBe('payload-bare');
    expect(bare.material).toBe(capsule.thermal.aft.material);
    expect(bare.surfaceTemperature).toBeLessThan(300);
    expect(bare.surfaceLimit).toBe(capsule.thermal.aft.maxSurfaceTemperature);
    // 侧壁与舱顶的热状态不受影响
    expect(sim.getVehicleState().thermal.find((z) => z.zone === 'side')!.owner).toBe('payload');
  });

  it('主伞张开后抛大底：着陆速度按 √(质量比) 降低', () => {
    const kept = flyEntry(capsuleEntry(), { mode: 'retrograde' });
    const dropped = flyEntry(capsuleEntry(), { mode: 'retrograde', jettisonShield: true });
    expect(kept.sim.flightOutcome?.kind).toBe('landed');
    expect(dropped.sim.flightOutcome?.kind).toBe('landed');
    expect(dropped.events.map((e) => e.kind)).toContain('heat-shield');
    const keptSpeed = Math.abs(kept.sim.flightOutcome!.verticalSpeed);
    const droppedSpeed = Math.abs(dropped.sim.flightOutcome!.verticalSpeed);
    expect(droppedSpeed).toBeLessThan(keptSpeed - 0.25);
    const massRatio = dropped.sim.getVehicleState().mass / kept.sim.getVehicleState().mass;
    expect(droppedSpeed / keptSpeed).toBeCloseTo(Math.sqrt(massRatio), 2);
  });

  it('再入前抛掉大底：舱底结构在高层大气里就被烧毁', () => {
    const sim = new Simulation(capsuleEntry());
    sim.setAttitudeMode('retrograde');
    sim.jettisonHeatShield();
    while (sim.flightPhase === 'flight' && sim.time < 2_000) sim.step();
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('thermal-surface');
    expect(outcome.thermalZone).toBe('base');
    expect(outcome.altitude).toBeGreaterThan(70_000);
  });

  it('遥测给出大底状态与能否抛掉；整个过程中没有无效数值', () => {
    const config = capsuleEntry();
    const emitted: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost(
      (event) => emitted.push(event),
      () => now,
    );
    host.handle({ type: 'init', config });
    host.handle({ type: 'setAttitudeMode', mode: 'trim' });
    host.handle({ type: 'setBankAngle', angle: 0.5 });
    for (let i = 0; i < 200; i++) {
      now += 16;
      host.tick();
    }
    host.handle({ type: 'jettisonHeatShield' });
    expect(emitted.some((e) => e.type === 'error')).toBe(false);
    const snapshots = emitted.filter((e) => e.type === 'snapshot').map((e) => e.snapshot);
    const last = snapshots[snapshots.length - 1]!;
    expect(last.vehicle.heatShieldAttached).toBe(false);
    expect(last.vehicle.attitudeMode).toBe('trim');
    expect(last.vehicle.bankAngle).toBeCloseTo(0.5, 9);
    expect(last.debris.some((d) => d.kind === 'heat-shield')).toBe(true);
    const telemetry = deriveTelemetry(last, config);
    expect(telemetry.heatShieldAttached).toBe(false);
    expect(telemetry.canJettisonHeatShield).toBe(false);
    expect(telemetry.trimAngle).toBeGreaterThan(0.3);
    const first = deriveTelemetry(snapshots[0]!, config);
    expect(first.heatShieldAttached).toBe(true);
    expect(first.canJettisonHeatShield).toBe(true);
    // 快照构造函数本身就是界面读到的数据
    const sim = new Simulation(config);
    expect(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }).vehicle.bankAngle).toBe(0);
  });
});
