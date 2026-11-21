import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { referenceVehicleById } from '@/data/testing/referenceVehicles';
import { dragArea } from '../physics/aerodynamics/drag';
import { atmosphereAt } from '../physics/atmosphere/standardAtmosphere';
import { DEG2RAD, EARTH, KARMAN_LINE_ALTITUDE, SEA_LEVEL, STANDARD_GRAVITY } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import {
  airRelativeVelocityEci,
  altitudeOf,
  ecefToEci,
  enuBasisAt,
  geodeticToEcef,
  pointingAngles,
  verticalLaunchAttitude,
} from '../physics/frames/frames';
import { rotate } from '../physics/math/quat';
import { type Vec3 as Vec3Like, add, addScaled, cross, distance, dot, length, scale, sub, vec3 } from '../physics/math/vec3';
import { deriveOrbit, deriveTelemetry } from '../telemetry/telemetry';
import { configurationAero, stageAloneMassProperties } from '../vehicles/configuration';
import { ATTITUDE_CONTROL, LANDING_LIMITS, Simulation, isValidVehicleState } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { buildSnapshot } from './snapshot';
import { AscentPilot, apsides } from './testing/ascentPilot';
import { type HandFlownOptions, HandFlownPilot } from './testing/handFlownPilot';
import type { FlightEvent, InitialFlightState, SimEvent, SimSnapshot, SimulationConfig } from './types';

const epochJulianDate = julianDateFromUnixMs(Date.UTC(2026, 3, 12, 14, 52));

const configFor = (vehicleId: string, siteId = 'cape-canaveral', initialState?: InitialFlightState): SimulationConfig => ({
  vehicle: referenceVehicleById(vehicleId),
  site: launchSiteGeodetic(getLaunchSiteOrDefault(siteId)),
  epochJulianDate,
  initialState,
});

const run = (sim: Simulation, seconds: number): void => {
  const steps = Math.round(seconds / sim.dt);
  for (let i = 0; i < steps; i++) sim.step();
};

const runUntil = (sim: Simulation, predicate: () => boolean, timeout: number): boolean => {
  while (sim.time < timeout) {
    if (predicate()) return true;
    sim.step();
  }
  return predicate();
};

const collectEvents = (sim: Simulation, into: FlightEvent[]): void => {
  into.push(...sim.drainEvents());
};

/** 赤道上空给定高度的圆轨道初始状态。 */
const circularOrbitState = (altitude: number, extra: Partial<InitialFlightState> = {}): InitialFlightState => {
  const radius = EARTH.RADIUS + altitude;
  return { position: vec3(radius, 0, 0), velocity: vec3(0, Math.sqrt(EARTH.MU / radius), 0), ...extra };
};

/** 发射场上空 height 米处、相对地面速度为 relativeVelocity（ENU）的初始状态。 */
const aboveSite = (siteId: string, height: number, relativeVelocityEnu = vec3(0, 0, 0)): InitialFlightState => {
  const site = launchSiteGeodetic(getLaunchSiteOrDefault(siteId));
  const position = ecefToEci(geodeticToEcef({ ...site, altitude: height }), 1.0);
  const { east, north, up } = enuBasisAt(position);
  const relative = add(add(scale(east, relativeVelocityEnu.x), scale(north, relativeVelocityEnu.y)), scale(up, relativeVelocityEnu.z));
  return { position, velocity: add(relative, cross(vec3(0, 0, EARTH.ROTATION_RATE), position)) };
};

describe('点火与起飞', () => {
  it('点火前火箭留在发射台上；点火指令使发动机启用', () => {
    const sim = new Simulation(configFor('frontier-1'));
    run(sim, 5);
    expect(sim.flightPhase).toBe('prelaunch');
    expect(sim.getVehicleState().flight.thrust).toBe(0);
    sim.stage();
    expect(sim.getVehicleState().ignited).toBe(true);
    expect(sim.drainEvents().map((e) => e.kind)).toEqual(['ignition']);
  });

  it('推力大于重力时起飞，起飞瞬间的加速度 = F/m − g_有效', () => {
    const sim = new Simulation(configFor('frontier-1'));
    const before = sim.getVehicleState();
    const h0 = altitudeOf(before.body.position);
    sim.stage();
    sim.step();
    expect(sim.flightPhase).toBe('flight');
    // 满足起飞条件时在该步起点释放
    expect(sim.liftoffAt).toBe(0);
    run(sim, 1 - sim.dt);
    const after = sim.getVehicleState();
    // 海平面推力 9 × (900 kN − 101325 Pa × 0.85 m²)；净加速度 ≈ F/m − 9.79
    const thrust = 9 * (900e3 - SEA_LEVEL.PRESSURE * 0.85);
    expect(after.flight.thrust / thrust).toBeGreaterThan(0.999);
    expect(after.flight.thrust / thrust).toBeLessThan(1.001);
    const netAccel = thrust / before.mass - 9.79;
    expect(altitudeOf(after.body.position) - h0).toBeCloseTo(0.5 * netAccel, 1);
    // 起飞时的过载 = 推力 / (质量 × g₀)
    expect(length(after.specificForce) / STANDARD_GRAVITY).toBeCloseTo(thrust / (after.mass * STANDARD_GRAVITY), 2);
  });

  it('推进剂按 ṁ = F_vac/(g₀·Isp) 消耗，质量随之减少', () => {
    const sim = new Simulation(configFor('frontier-1'));
    const m0 = sim.getVehicleState().mass;
    sim.stage();
    run(sim, 30);
    const state = sim.getVehicleState();
    const massFlow = (9 * 900e3) / (STANDARD_GRAVITY * 315);
    expect(state.flight.massFlow).toBeCloseTo(massFlow, 6);
    expect(400_000 - state.stages[0]!.propellantMass).toBeCloseTo(massFlow * 30, 3);
    expect(m0 - state.mass).toBeCloseTo(massFlow * 30, 3);
    // 质心位置随推进剂消耗而变化（余液沉在箱底：先略降，接近燃尽时移向上面级）
    const initialCom = new Simulation(configFor('frontier-1')).getVehicleState().centerOfMassHeight;
    expect(Math.abs(state.centerOfMassHeight - initialCom)).toBeGreaterThan(0.5);
    run(sim, 122);
    expect(sim.getVehicleState().centerOfMassHeight).toBeGreaterThan(initialCom);
  });

  it('推力不足时火箭被牵制在发射台上继续消耗推进剂，变轻后才起飞', () => {
    const sim = new Simulation(configFor('frontier-1'));
    // 节流指令低于最小节流 → 按最小节流 40% 工作；海平面推力约 2465 kN < 重量 5210 kN
    sim.setThrottle(0.1);
    sim.stage();
    run(sim, 60);
    let state = sim.getVehicleState();
    expect(sim.flightPhase).toBe('prelaunch');
    expect(state.flight.effectiveThrottle).toBeCloseTo(0.4, 12);
    expect(state.flight.thrust).toBeGreaterThan(2.4e6);
    expect(state.flight.thrust).toBeLessThan(state.mass * 9.79);
    expect(state.stages[0]!.propellantMass).toBeLessThan(400_000 - 60_000);
    expect(altitudeOf(state.body.position)).toBeCloseTo(state.centerOfMassHeight, 6);
    expect(length(airRelativeVelocityEci(state.body.position, state.body.velocity))).toBeLessThan(1e-9);

    // 质量降到 F/9.79 以下时自动释放
    expect(runUntil(sim, () => sim.flightPhase === 'flight', 400)).toBe(true);
    state = sim.getVehicleState();
    expect(state.flight.thrust / state.mass).toBeGreaterThan(9.78);
    expect(state.flight.thrust / state.mass).toBeLessThan(9.85);
  });

  it('节流为 0 时即使已下达点火指令也不产生推力', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.setThrottle(0);
    sim.stage();
    run(sim, 5);
    expect(sim.flightPhase).toBe('prelaunch');
    expect(sim.getVehicleState().stages[0]!.propellantMass).toBe(400_000);
  });

  it('无效的节流与姿态指令被忽略或钳制', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.setThrottle(NaN);
    expect(sim.getVehicleState().throttle).toBe(1);
    sim.setThrottle(7);
    expect(sim.getVehicleState().throttle).toBe(1);
    sim.setThrottle(-3);
    expect(sim.getVehicleState().throttle).toBe(0);
    sim.setAttitudeInput({ pitch: 9, yaw: NaN, roll: -9 });
    expect(sim.getVehicleState().attitudeInput).toEqual({ pitch: 1, yaw: 0, roll: -1 });
  });
});

describe('无动力飞行：引力与阻力', () => {
  it('关闭发动机后继续按引力与阻力运动：先上升、再下落、最终撞击地面', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 20);
    sim.setThrottle(0);
    sim.step();
    const cutoff = sim.getVehicleState();
    const { up } = enuBasisAt(cutoff.body.position);
    const vUp = dot(airRelativeVelocityEci(cutoff.body.position, cutoff.body.velocity), up);
    expect(cutoff.flight.thrust).toBe(0);
    expect(vUp).toBeGreaterThan(50);
    // 关机后只受阻力：过载远小于 1 g，且方向与速度相反
    expect(length(cutoff.specificForce) / STANDARD_GRAVITY).toBeLessThan(0.1);
    expect(dot(cutoff.specificForce, up)).toBeLessThan(0);

    const hCutoff = altitudeOf(cutoff.body.position);
    expect(runUntil(sim, () => sim.flightPhase !== 'flight', 300)).toBe(true);
    expect(sim.flightStats.maxAltitude).toBeGreaterThan(hCutoff + 100);
    // 无阻力时的弹道顶点为 h + v²/2g；有阻力时应更低
    expect(sim.flightStats.maxAltitude).toBeLessThan(hCutoff + (vUp * vUp) / (2 * 9.8));
    expect(sim.flightPhase).toBe('destroyed');
    expect(sim.flightOutcome!.impactSpeed).toBeGreaterThan(30);
  });

  it('阻力大小 = ½ρv²·C_dA，方向与相对大气速度相反', () => {
    // 10 km 高度、向东 250 m/s（相对大气）、箭体竖直 → 迎角 90°，横流阻力
    const sim = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 10_000, vec3(250, 0, 0))));
    const state = sim.getVehicleState();
    const atm = atmosphereAt(altitudeOf(state.body.position));
    const aero = configurationAero(sim.vehicle, state);
    const expected = (0.5 * atm.density * 250 * 250 * dragArea(aero, 250 / atm.speedOfSound, 0)) / state.mass;
    expect(length(state.specificForce)).toBeCloseTo(expected, 6);
    const relative = airRelativeVelocityEci(state.body.position, state.body.velocity);
    expect(dot(state.specificForce, relative) / (length(state.specificForce) * length(relative))).toBeCloseTo(-1, 9);

    sim.step();
    const flight = sim.getVehicleState().flight;
    expect(flight.angleOfAttack).toBeCloseTo(Math.PI / 2, 2);
    expect(flight.mach).toBeCloseTo(250 / atm.speedOfSound, 2);
    // 一个步长内已被横流阻力略微减速，动压略低于初始值
    const q0 = 0.5 * atm.density * 250 * 250;
    expect(flight.dynamicPressure / q0).toBeGreaterThan(0.98);
    expect(flight.dynamicPressure / q0).toBeLessThanOrEqual(1);
  });

  it('阻力使用相对旋转大气的速度：与地面共转的物体不受阻力', () => {
    const sim = new Simulation(configFor('meteor-s', 'kourou', aboveSite('kourou', 5_000)));
    const state = sim.getVehicleState();
    expect(length(state.body.velocity)).toBeGreaterThan(460);
    expect(length(state.specificForce)).toBeLessThan(1e-9);
  });

  it('自由下落趋近终端速度 v_t = √(2mg / (ρ·C_dA))', () => {
    // 返回舱单独从 6 km 落下（头部朝上，来流沿轴向）
    const initial = { ...aboveSite('cape-canaveral', 6_000), separatedStages: 1 };
    const sim = new Simulation(configFor('meteor-s', 'cape-canaveral', initial));
    expect(runUntil(sim, () => altitudeOf(sim.getVehicleState().body.position) < 1_000, 200)).toBe(true);
    const state = sim.getVehicleState();
    const atm = atmosphereAt(altitudeOf(state.body.position));
    const cdA = dragArea(configurationAero(sim.vehicle, state), state.flight.mach, 1);
    const terminal = Math.sqrt((2 * state.mass * 9.80) / (atm.density * cdA));
    expect(state.flight.airspeed / terminal).toBeGreaterThan(0.97);
    expect(state.flight.airspeed / terminal).toBeLessThan(1.05);
    // 接近终端速度时阻力 ≈ 重力，过载 ≈ 1 g（下落中空气越来越密，阻力略大于重力）
    const g = length(state.specificForce) / STANDARD_GRAVITY;
    expect(g).toBeGreaterThan(0.95);
    expect(g).toBeLessThan(1.1);
  });

  it('真空中的轨道：一圈后回到出发点，能量守恒（完整模拟器，0.02 s 步长）', () => {
    // 1200 km：高于大气模型上界，没有阻力，纯二体问题
    const sim = new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(1_200_000, { separatedStages: 2 })));
    const start = sim.getVehicleState().body;
    const energy = (b: { position: typeof start.position; velocity: typeof start.velocity }) =>
      dot(b.velocity, b.velocity) / 2 - EARTH.MU / length(b.position);
    const momentum = (b: { position: typeof start.position; velocity: typeof start.velocity }) => length(cross(b.position, b.velocity));
    const period = 2 * Math.PI * Math.sqrt((EARTH.RADIUS + 1_200_000) ** 3 / EARTH.MU);
    const steps = Math.round(period / sim.dt);
    for (let i = 0; i < steps; i++) sim.step();
    const end = sim.getVehicleState().body;
    expect(Math.abs(energy(end) - energy(start)) / Math.abs(energy(start))).toBeLessThan(1e-11);
    expect(Math.abs(momentum(end) - momentum(start)) / momentum(start)).toBeLessThan(1e-11);
    // 步数取整使终点与一个整周期相差不到一个步长（< 0.02 s × 7.3 km/s）
    expect(distance(end.position, start.position)).toBeLessThan(150);
    expect(Math.abs(length(end.position) - length(start.position))).toBeLessThan(1e-3);
    expect(sim.flightPhase).toBe('flight');
  });

  it('低轨道受大气阻力衰减：150 km 轨道的能量持续下降', () => {
    const sim = new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(150_000, { separatedStages: 2 })));
    const a0 = apsides(sim);
    run(sim, 3000);
    const a1 = apsides(sim);
    expect(a1.apoapsis).toBeLessThan(a0.apoapsis - 50);
    expect(a1.apoapsis).toBeGreaterThan(a0.apoapsis - 20_000);
  });
});

describe('事件检测', () => {
  it('推进剂在步内耗尽：推进剂精确归零，燃烧时间 = m_p/ṁ', () => {
    const sim = new Simulation(configFor('meteor-s'));
    const events: FlightEvent[] = [];
    sim.stage();
    while (sim.time < 200 && sim.getVehicleState().stages[0]!.propellantMass > 0) {
      sim.step();
      collectEvents(sim, events);
    }
    const burnTime = 10_500 / (250e3 / (STANDARD_GRAVITY * 295));
    const depleted = events.find((e) => e.kind === 'depleted');
    expect(depleted).toBeDefined();
    // 事件时间是所在物理步的末尾，与解析燃烧时间相差不超过一个步长
    expect(depleted!.time - sim.liftoffAt!).toBeGreaterThan(burnTime - 0.05);
    expect(depleted!.time - sim.liftoffAt!).toBeLessThan(burnTime + 0.05);
    const state = sim.getVehicleState();
    expect(state.stages[0]!.propellantMass).toBe(0);
    expect(state.flight.thrust).toBe(0);
    expect(state.mass).toBe(2_600 + 1_800);
  });

  it('燃尽时获得的速度增量与步长无关（步内拆分为有动力段与无动力段）', () => {
    const burnoutSpeed = (dt: number): number => {
      const sim = new Simulation(configFor('meteor-s'), dt);
      sim.stage();
      runUntil(sim, () => sim.getVehicleState().stages[0]!.propellantMass === 0, 300);
      // 统一比较 t = 125 s 时的速度
      while (sim.time < 125 - 1e-9) sim.step();
      return length(sim.getVehicleState().body.velocity);
    };
    const fine = burnoutSpeed(0.01);
    const coarse = burnoutSpeed(0.25);
    expect(Math.abs(fine - coarse)).toBeLessThan(0.05);
  });

  it('高速撞地不会穿过地面：接地点高度在容差内，记录撞击速度', () => {
    // 1 km 高度、以 2000 m/s 垂直下落；用 1 s 的大步长，一步内就会穿过地面
    const sim = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 1_000, vec3(0, 0, -2_000))), 1);
    sim.step();
    expect(sim.flightPhase).toBe('destroyed');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.time).toBeGreaterThan(0.4);
    expect(outcome.time).toBeLessThan(0.6);
    expect(outcome.impactSpeed).toBeGreaterThan(1_500);
    expect(outcome.verticalSpeed).toBeLessThan(-1_500);
    const state = sim.getVehicleState();
    // 接地后固定在地面：底端高度在毫米量级
    expect(Math.abs(altitudeOf(state.body.position) - state.centerOfMassHeight)).toBeLessThan(0.01);
    expect((outcome.latitude / DEG2RAD)).toBeCloseTo(28.5, 2);
    expect(sim.drainEvents().map((e) => e.kind)).toContain('destroyed');
  });

  it('接地判定与步长无关', () => {
    const impact = (dt: number) => {
      const sim = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 3_000, vec3(40, 0, -100))), dt);
      runUntil(sim, () => sim.flightPhase !== 'flight', 200);
      return sim.flightOutcome!;
    };
    const fine = impact(0.005);
    const coarse = impact(0.5);
    expect(Math.abs(fine.time - coarse.time)).toBeLessThan(1e-3);
    expect(Math.abs(fine.impactSpeed - coarse.impactSpeed)).toBeLessThan(0.01);
  });

  it('低速竖直接地判定为着陆；超过容限则损毁', () => {
    // 质心在地面以上 (质心高度 + 0.3 m) 处由静止落下 → 接地速度 √(2·g·0.3) ≈ 2.4 m/s
    const probe = new Simulation(configFor('meteor-s'));
    const com = probe.getVehicleState().centerOfMassHeight;
    const soft = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', com + 0.3)));
    runUntil(soft, () => soft.flightPhase !== 'flight', 10);
    expect(soft.flightPhase).toBe('landed');
    expect(Math.abs(soft.flightOutcome!.verticalSpeed)).toBeLessThan(LANDING_LIMITS.verticalSpeed);
    expect(Math.abs(soft.flightOutcome!.verticalSpeed)).toBeCloseTo(Math.sqrt(2 * 9.79 * 0.3), 1);

    const hard = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', com + 5)));
    runUntil(hard, () => hard.flightPhase !== 'flight', 10);
    expect(hard.flightPhase).toBe('destroyed');

    // 水平速度过大同样损毁
    const sliding = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', com + 0.1, vec3(10, 0, 0))));
    runUntil(sliding, () => sliding.flightPhase !== 'flight', 10);
    expect(sliding.flightPhase).toBe('destroyed');
  });

  it('飞行结束后状态固定在地面并随地球自转，数值保持有效', () => {
    const sim = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 500, vec3(0, 0, -50))));
    runUntil(sim, () => sim.flightPhase !== 'flight', 60);
    const a = sim.getVehicleState();
    run(sim, 600);
    const b = sim.getVehicleState();
    expect(isValidVehicleState(b)).toBe(true);
    expect(length(airRelativeVelocityEci(b.body.position, b.body.velocity))).toBeLessThan(1e-9);
    expect(altitudeOf(b.body.position)).toBeCloseTo(altitudeOf(a.body.position), 6);
    // 600 s 内随地球转过约 245 km
    expect(distance(a.body.position, b.body.position)).toBeGreaterThan(200_000);
    // 飞行结束后指令无效
    sim.stage();
    expect(sim.flightPhase).toBe(a.phase);
  });
});

describe('分级', () => {
  const stagedSim = () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 40);
    sim.drainEvents();
    return sim;
  };

  it('分离后质量、高度基准与工作级更新，下一级自动点火', () => {
    const sim = stagedSim();
    const before = sim.getVehicleState();
    sim.stage();
    const after = sim.getVehicleState();
    expect(after.stages[0]!.attached).toBe(false);
    expect(after.activeStageIndex).toBe(1);
    expect(after.mass).toBe(4_500 + 95_000 + 6_500 + 1_200);
    expect(after.ignited).toBe(true);
    expect(after.centerOfMassHeight).toBeLessThan(before.centerOfMassHeight);
    expect(sim.drainEvents().map((e) => e.kind)).toEqual(['separation', 'ignition']);

    sim.step();
    // 二级真空发动机在低空受背压影响，推力小于真空值但大于 0
    const thrust = sim.getVehicleState().flight.thrust;
    expect(thrust).toBeGreaterThan(0);
    expect(thrust).toBeLessThan(950e3);
  });

  it('分离过程动量守恒，系统质心位置连续', () => {
    const sim = stagedSim();
    const before = sim.getVehicleState();
    const stage = sim.vehicle.stages[0]!;
    const droppedMass = stageAloneMassProperties(stage, before.stages[0]!.propellantMass).mass;
    sim.stage();
    const after = sim.getVehicleState();
    const debris = sim.getDebris();
    expect(debris).toHaveLength(1);
    const d = debris[0]!;
    expect(d.kind).toBe('stage');
    expect(d.stageIndex).toBe(0);

    // 总动量：m_v·v_v + m_d·v_d = (m_v + m_d)·v_0
    const momentum = add(scale(after.body.velocity, after.mass), scale(d.velocity, droppedMass));
    expect(distance(scale(momentum, 1 / before.mass), before.body.velocity)).toBeLessThan(1e-9);
    // 系统质心：(m_v·r_v + m_d·r_d)/(m_v + m_d) = r_0
    const center = scale(add(scale(after.body.position, after.mass), scale(d.position, droppedMass)), 1 / before.mass);
    expect(distance(center, before.body.position)).toBeLessThan(1e-6);
    // 两者沿箭体轴线以设定的相对速度分开，被抛级在后
    const nose = rotate(after.body.attitude, vec3(1, 0, 0));
    expect(dot(sub(after.body.velocity, d.velocity), nose)).toBeCloseTo(1.5, 9);
    expect(dot(sub(after.body.position, d.position), nose)).toBeGreaterThan(10);
  });

  it('分离体作为独立弹道物体继续飞行，最终落地后被移除', () => {
    const sim = stagedSim();
    sim.stage();
    sim.setThrottle(0);
    const id = sim.getDebris()[0]!.id;
    run(sim, 5);
    const d = sim.getDebris().find((x) => x.id === id)!;
    expect(altitudeOf(d.position)).toBeGreaterThan(0);
    expect(Number.isFinite(d.attitude.w)).toBe(true);
    expect(runUntil(sim, () => sim.getDebris().length === 0, 600)).toBe(true);
  });

  it('只剩载荷后：有发动机的飞船可以点火，分级指令不再分离任何东西', () => {
    const sim = new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(300_000, { separatedStages: 2 })));
    expect(sim.getVehicleState().activeStageIndex).toBe(2);
    expect(sim.getVehicleState().mass).toBe(7_700);
    sim.setThrottle(1);
    sim.stage();
    expect(sim.drainEvents().map((e) => e.kind)).toEqual(['payload-ignition']);
    run(sim, 10);
    const state = sim.getVehicleState();
    expect(state.flight.thrust).toBeCloseTo(4 * 7_500, 3);
    expect(1_200 - state.payloadPropellantMass).toBeCloseTo(((4 * 7_500) / (STANDARD_GRAVITY * 300)) * 10, 2);
    sim.stage();
    expect(sim.getDebris()).toHaveLength(0);
  });

  it('飞船发动机顺行点火提高轨道：Δv 与齐奥尔科夫斯基方程一致', () => {
    const base = circularOrbitState(300_000, { separatedStages: 2 });
    // 头部沿速度方向（+Y）
    const attitude = verticalLaunchAttitude(vec3(0, 1, 0));
    const sim = new Simulation(configFor('frontier-1', 'cape-canaveral', { ...base, attitude }));
    const v0 = length(sim.getVehicleState().body.velocity);
    sim.setThrottle(1);
    sim.stage();
    run(sim, 20);
    const state = sim.getVehicleState();
    const expected = STANDARD_GRAVITY * 300 * Math.log(7_700 / state.mass);
    // 20 s 内轨道弧段很短，速度大小的增加 ≈ Δv（引力方向几乎垂直于速度）
    expect(length(state.body.velocity) - v0).toBeCloseTo(expected, 0);
    expect(apsides(sim).apoapsis).toBeGreaterThan(300_000 + 50_000);
  });

  it('从轨道开始：上面级带着推进剂但尚未启用，分级指令先点火而不是把它抛掉', () => {
    const sim = new Simulation(
      configFor('frontier-1', 'cape-canaveral', circularOrbitState(200_000, { separatedStages: 1, stagePropellant: [0, 12_000] })),
    );
    const before = sim.getVehicleState();
    expect(before.activeStageIndex).toBe(1);
    expect(before.stages[1]!.propellantMass).toBe(12_000);
    expect(before.ignited).toBe(false);
    expect(before.throttle).toBe(0);
    sim.stage();
    expect(sim.getVehicleState().ignited).toBe(true);
    expect(sim.getVehicleState().stages[1]!.attached).toBe(true);
    expect(sim.drainEvents().map((e) => e.kind)).toEqual(['ignition']);
    // 节流仍为 0：没有推力，直到玩家给油
    run(sim, 2);
    expect(sim.getVehicleState().flight.thrust).toBe(0);
    sim.setThrottle(1);
    run(sim, 2);
    expect(sim.getVehicleState().flight.thrust).toBeCloseTo(950e3, -2);
    // 已启用后再按：分离该级
    sim.stage();
    expect(sim.getVehicleState().stages[1]!.attached).toBe(false);
  });

  it('初始状态可以指定各级推进剂，超出容量的值被钳制', () => {
    const sim = new Simulation(
      configFor('frontier-1', 'cape-canaveral', circularOrbitState(300_000, { separatedStages: 1, stagePropellant: [0, 9e9] })),
    );
    expect(sim.getVehicleState().stages[1]!.propellantMass).toBe(95_000);
  });

  it('无动力载荷：分级指令在最后一级分离后不点火', () => {
    const sim = new Simulation(configFor('meteor-s'));
    sim.stage();
    run(sim, 30);
    sim.stage();
    const state = sim.getVehicleState();
    expect(state.activeStageIndex).toBe(1);
    expect(state.ignited).toBe(false);
    expect(state.mass).toBe(1_800);
    sim.stage();
    expect(sim.getVehicleState().ignited).toBe(false);
  });
});

describe('整流罩', () => {
  it('抛罩：质量减少、产生两个半罩、总动量与质心不变', () => {
    const sim = new Simulation(configFor('zenith-3'));
    sim.stage();
    run(sim, 60);
    const before = sim.getVehicleState();
    sim.jettisonFairing();
    const after = sim.getVehicleState();
    expect(after.fairingAttached).toBe(false);
    expect(before.mass - after.mass).toBe(1_900);
    const halves = sim.getDebris();
    expect(halves.map((d) => d.kind)).toEqual(['fairing', 'fairing']);
    expect(halves.map((d) => d.half).sort()).toEqual([-1, 1]);
    const momentum = add(scale(after.body.velocity, after.mass), add(scale(halves[0]!.velocity, 950), scale(halves[1]!.velocity, 950)));
    expect(distance(scale(momentum, 1 / before.mass), before.body.velocity)).toBeLessThan(1e-9);
    // 两个半罩向相反方向横向分离
    expect(length(sub(halves[0]!.velocity, halves[1]!.velocity))).toBeCloseTo(6, 9);
    // 箭体本身没有移动：底端位置不变
    const nose = rotate(after.body.attitude, vec3(1, 0, 0));
    const baseBefore = addScaled(before.body.position, nose, -before.centerOfMassHeight);
    const baseAfter = addScaled(after.body.position, nose, -after.centerOfMassHeight);
    expect(distance(baseBefore, baseAfter)).toBeLessThan(1e-6);
    expect(sim.drainEvents().some((e) => e.kind === 'fairing')).toBe(true);

    // 重复指令无效
    sim.jettisonFairing();
    expect(sim.getDebris()).toHaveLength(2);
  });

  it('发射台上不能抛罩；没有整流罩的火箭忽略该指令', () => {
    const zenith = new Simulation(configFor('zenith-3'));
    zenith.jettisonFairing();
    expect(zenith.getVehicleState().fairingAttached).toBe(true);
    const frontier = new Simulation(configFor('frontier-1'));
    frontier.stage();
    run(frontier, 10);
    frontier.jettisonFairing();
    expect(frontier.getDebris()).toHaveLength(0);
  });
});

describe('简化姿态控制', () => {
  it('偏航输入使火箭以设定角速度向东倾斜；松开后保持姿态', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 10);
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    run(sim, 5);
    let state = sim.getVehicleState();
    let angles = pointingAngles(state.body.attitude, state.body.position);
    // 5 s 内转过约 8°/s × (5 − τ) ≈ 36°
    const turned = 90 - angles.pitch / DEG2RAD;
    const expected = (ATTITUDE_CONTROL.maxPitchYawRate / DEG2RAD) * (5 - ATTITUDE_CONTROL.timeConstant);
    expect(turned).toBeGreaterThan(expected - 1.5);
    expect(turned).toBeLessThan(expected + 1.5);
    expect(angles.heading! / DEG2RAD).toBeCloseTo(90, 0);

    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 4);
    state = sim.getVehicleState();
    const held = rotate(state.body.attitude, vec3(1, 0, 0));
    expect(length(state.body.angularVelocity) / DEG2RAD).toBeLessThan(0.01);
    run(sim, 4);
    // 姿态保持是相对惯性空间的
    expect(distance(rotate(sim.getVehicleState().body.attitude, vec3(1, 0, 0)), held)).toBeLessThan(1e-4);
    angles = pointingAngles(sim.getVehicleState().body.attitude, sim.getVehicleState().body.position);
    expect(angles.pitch / DEG2RAD).toBeLessThan(60);
  });

  it('俯仰输入使火箭向北倾斜（发射台初始朝向下）', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 5);
    sim.setAttitudeInput({ pitch: 1, yaw: 0, roll: 0 });
    run(sim, 3);
    const state = sim.getVehicleState();
    const angles = pointingAngles(state.body.attitude, state.body.position);
    expect(angles.pitch / DEG2RAD).toBeLessThan(80);
    expect(Math.min(angles.heading!, 2 * Math.PI - angles.heading!) / DEG2RAD).toBeLessThan(1);
  });

  it('推力沿箭体纵轴：倾斜后获得水平速度', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 8);
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    run(sim, 4);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 10);
    const state = sim.getVehicleState();
    const { east } = enuBasisAt(state.body.position);
    expect(dot(airRelativeVelocityEci(state.body.position, state.body.velocity), east)).toBeGreaterThan(20);
  });

  it('发射台上的姿态输入不改变姿态', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.setAttitudeInput({ pitch: 1, yaw: 1, roll: 1 });
    run(sim, 5);
    const state = sim.getVehicleState();
    expect(pointingAngles(state.body.attitude, state.body.position).pitch).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('时间倍率限制', () => {
  it('发射台待命不限制；点火后与发动机工作时限制为 5×', () => {
    const sim = new Simulation(configFor('frontier-1'));
    expect(sim.maxTimeWarp).toBe(1000);
    sim.stage();
    expect(sim.maxTimeWarp).toBe(5);
    run(sim, 5);
    expect(sim.maxTimeWarp).toBe(5);
  });

  it('稠密大气内滑行限制为 10×；大气层外不限制；有操纵输入时限制为 5×', () => {
    const low = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 30_000, vec3(0, 0, 500))));
    low.step();
    expect(low.maxTimeWarp).toBe(10);
    const high = new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(300_000)));
    high.step();
    expect(high.maxTimeWarp).toBe(1000);
    high.setAttitudeInput({ pitch: 0, yaw: 0.5, roll: 0 });
    expect(high.maxTimeWarp).toBe(5);
  });

  it('主机在条件变严的那一步立即降档，且不会自行回升', () => {
    const events: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost((e) => events.push(e), () => now);
    const lastSnapshot = (): SimSnapshot => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.type === 'snapshot') return e.snapshot;
      }
      throw new Error('没有快照');
    };
    const advance = (ms: number) => {
      const end = now + ms;
      while (now < end) {
        now += 4;
        host.tick();
      }
    };
    // 从 90 km 高度以 300 m/s 下落：约 70 s 后降到 70 km 以下
    host.handle({ type: 'init', config: configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 90_000, vec3(0, 0, -300))) });
    host.handle({ type: 'setTimeWarp', warp: 1000 });
    advance(40);
    expect(lastSnapshot().timeWarp).toBe(1000);
    advance(400);
    const snapshot = lastSnapshot();
    expect(snapshot.maxTimeWarp).toBe(10);
    expect(snapshot.timeWarp).toBe(10);
    // 降档发生在越过 70 km 的那一步：此刻高度应仍接近 70 km（而不是已经掉下去很多）
    expect(altitudeOf(snapshot.vehicle.body.position)).toBeGreaterThan(60_000);

    // 玩家要求的倍率超过上限时被钳制
    host.handle({ type: 'setTimeWarp', warp: 100 });
    expect(lastSnapshot().timeWarp).toBe(10);
  });

  it('主机转发飞行指令并发布飞行事件', () => {
    const events: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost((e) => events.push(e), () => now);
    host.handle({ type: 'init', config: configFor('frontier-1') });
    host.handle({ type: 'stage' });
    for (let i = 0; i < 500; i++) {
      now += 4;
      host.tick();
    }
    host.handle({ type: 'setThrottle', throttle: 0.6 });
    host.handle({ type: 'setAttitudeInput', input: { pitch: 0, yaw: 1, roll: 0 } });
    const kinds = events.flatMap((e) => (e.type === 'flightEvents' ? e.events.map((x) => x.kind) : []));
    expect(kinds).toEqual(['ignition', 'liftoff']);
    const last = events.filter((e) => e.type === 'snapshot').at(-1);
    const snapshot = last && last.type === 'snapshot' ? last.snapshot : null;
    expect(snapshot!.vehicle.phase).toBe('flight');
    expect(snapshot!.vehicle.throttle).toBe(0.6);
    expect(snapshot!.vehicle.attitudeInput.yaw).toBe(1);
    expect(snapshot!.liftoffTime).not.toBeNull();
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });
});

describe('完整上升飞行（脚本驾驶，只使用公开的控制指令）', () => {
  it('流星-S 垂直发射：突破卡门线，弹道飞行后坠回地面', () => {
    const sim = new Simulation(configFor('meteor-s'));
    sim.stage();
    expect(runUntil(sim, () => sim.flightPhase !== 'flight' && sim.flightPhase !== 'prelaunch', 3_000)).toBe(true);
    const stats = sim.flightStats;
    expect(stats.maxAltitude).toBeGreaterThan(KARMAN_LINE_ALTITUDE);
    expect(stats.maxAltitude).toBeLessThan(600_000);
    // 上升段最大动压出现在跨声速/超声速初期，量级为几十 kPa
    expect(stats.maxSurfaceSpeed).toBeGreaterThan(1_500);
    expect(sim.flightPhase).toBe('destroyed');
    // 垂直发射：落点仍在发射场附近（地球自转造成向西的科里奥利偏移，量级为数十公里）
    expect(Math.abs(sim.flightOutcome!.latitude / DEG2RAD - 28.5)).toBeLessThan(0.5);
    expect(sim.flightOutcome!.longitude / DEG2RAD).toBeLessThan(-80.6);
    expect(sim.flightOutcome!.longitude / DEG2RAD).toBeGreaterThan(-82.5);
  });

  it('边疆一号：重力转弯 + 分级 + 闭环制导，进入约 200 km 近地轨道并有推进剂余量', () => {
    const sim = new Simulation(configFor('frontier-1'));
    const status = new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 4 }).fly();
    expect(status).toBe('orbit');
    const orbit = apsides(sim);
    expect(orbit.periapsis).toBeGreaterThan(180_000);
    expect(orbit.apoapsis).toBeLessThan(230_000);
    const state = sim.getVehicleState();
    expect(length(state.body.velocity)).toBeGreaterThan(7_700);
    expect(length(state.body.velocity)).toBeLessThan(7_900);
    expect(state.stages[1]!.propellantMass).toBeGreaterThan(8_000);
    const stats = sim.flightStats;
    // 最大动压：真实中型运载火箭约为 30–40 kPa
    expect(stats.maxDynamicPressure).toBeGreaterThan(25_000);
    expect(stats.maxDynamicPressure).toBeLessThan(50_000);
    expect(stats.maxGLoad).toBeLessThan(7);
    // 一级已分离并作为分离体被跟踪过
    expect(state.stages[0]!.attached).toBe(false);
    // 向东发射：轨道倾角 ≈ 发射场纬度
    const h = cross(state.body.position, state.body.velocity);
    expect(Math.acos(h.z / length(h)) / DEG2RAD).toBeCloseTo(28.5, 0);
  });

  it('入轨后继续滑行一圈：轨道稳定，不再回落', () => {
    const sim = new Simulation(configFor('frontier-1'));
    expect(new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 4 }).fly()).toBe('orbit');
    const before = apsides(sim);
    run(sim, 5_400);
    const after = apsides(sim);
    expect(sim.flightPhase).toBe('flight');
    // 200 km 轨道有微弱阻力，一圈下降不超过几公里
    expect(before.periapsis - after.periapsis).toBeLessThan(5_000);
    expect(after.periapsis).toBeGreaterThan(170_000);
  });

  it('限制过载时仍可入轨（节流生效）', () => {
    const sim = new Simulation(configFor('frontier-1'));
    expect(new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 3, maxG: 4 }).fly()).toBe('orbit');
    expect(sim.flightStats.maxGLoad).toBeLessThan(4.1);
  });

  it('天顶三号：三级入轨并抛整流罩，上面级保留足够执行 GTO/GEO 机动的推进剂', () => {
    const sim = new Simulation(configFor('zenith-3'));
    expect(new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 2 }).fly()).toBe('orbit');
    const state = sim.getVehicleState();
    expect(state.fairingAttached).toBe(false);
    expect(state.activeStageIndex).toBe(2);
    expect(apsides(sim).periapsis).toBeGreaterThan(180_000);
    // 剩余 Δv = g₀·Isp·ln(m₀/m_f) > 4.3 km/s（从 28.5° 倾角的近地轨道到地球静止轨道所需）
    const remaining = STANDARD_GRAVITY * 452 * Math.log(state.mass / (state.mass - state.stages[2]!.propellantMass));
    expect(remaining).toBeGreaterThan(4_300);
  });

  it('发射场纬度影响运载能力：低纬度发射场借助地球自转，入轨后剩余推进剂更多', () => {
    const remaining = (site: string): number => {
      const sim = new Simulation(configFor('frontier-1', site));
      expect(new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 3 }).fly()).toBe('orbit');
      return sim.getVehicleState().stages[1]!.propellantMass;
    };
    const kourou = remaining('kourou');
    const cape = remaining('cape-canaveral');
    const baikonur = remaining('baikonur');
    expect(kourou).toBeGreaterThan(cape + 100);
    expect(cape).toBeGreaterThan(baikonur + 100);
  });

  it('转弯过猛导致轨迹过低：火箭在大气层内坠毁（结果由物理决定）', () => {
    const sim = new Simulation(configFor('zenith-3'));
    const status = new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 6 }).fly();
    expect(status).toBe('ended');
    expect(sim.flightPhase).toBe('destroyed');
  });
});

describe('手动操作流程（粗糙的按键式操纵，只看仪表上的读数）', () => {
  const flyByHand = (vehicleId: string, options: HandFlownOptions) => {
    const config = configFor(vehicleId);
    const sim = new Simulation(config);
    const pilot = new HandFlownPilot(sim, config, options);
    const status = pilot.fly();
    const { position, velocity } = sim.getVehicleState().body;
    return { sim, pilot, status, orbit: deriveOrbit(position, velocity), hud: pilot.readHud() };
  };

  it('边疆一号：照着界面提示的流程操作，进入稳定的近地轨道并能一直飞下去', () => {
    const { sim, pilot, status, orbit, hud } = flyByHand('frontier-1', { targetAltitude: 200_000, kickAngleDeg: 2.5 });
    expect(status).toBe('orbit');
    expect(orbit.classification).toBe('orbit');
    expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(orbit.apoapsisAltitude).toBeLessThan(400_000);
    // 向正东发射：倾角 ≈ 发射场纬度
    expect(orbit.inclination / DEG2RAD).toBeGreaterThan(28.3);
    expect(orbit.inclination / DEG2RAD).toBeLessThan(28.7);
    // 粗糙的手动操纵比闭环制导多花一些推进剂，但余量仍然充足
    expect(hud.remainingDeltaV).toBeGreaterThan(2_500);
    expect(hud.activeStageIndex).toBe(1);
    expect(pilot.maxDynamicPressure).toBeGreaterThan(30_000);
    expect(pilot.maxDynamicPressure).toBeLessThan(45_000);
    expect(sim.time).toBeLessThan(500);

    // "稳定"：关机后再飞一整圈，仍在轨道上，近地点没有明显下降
    run(sim, orbit.period);
    expect(sim.flightPhase).toBe('flight');
    const later = sim.getVehicleState().body;
    const after = deriveOrbit(later.position, later.velocity);
    expect(after.classification).toBe('orbit');
    expect(after.periapsisAltitude).toBeGreaterThan(orbit.periapsisAltitude - 3_000);
    expect(sim.predictTrajectory()).toBeNull();
  });

  it('对操作误差不敏感：转弯角 1.5°–4°、每 2–5 秒才调整一次俯仰角，都能入轨', () => {
    const cases: HandFlownOptions[] = [
      { targetAltitude: 200_000, kickAngleDeg: 1.5 },
      { targetAltitude: 200_000, kickAngleDeg: 2 },
      { targetAltitude: 200_000, kickAngleDeg: 3 },
      { targetAltitude: 200_000, kickAngleDeg: 4 },
      { targetAltitude: 200_000, kickAngleDeg: 2, decisionInterval: 2 },
      { targetAltitude: 200_000, kickAngleDeg: 2, decisionInterval: 5 },
      { targetAltitude: 200_000, kickAngleDeg: 3, pitchStepDeg: 10 },
    ];
    // （每 8 秒才调整一次时这个简单的规则会振荡：仍能入轨，但远地点可能高达上万公里、几乎耗尽推进剂，
    //   结果对微小扰动很敏感，因此不作为断言。）
    for (const options of cases) {
      const { status, orbit, hud } = flyByHand('frontier-1', options);
      const label = JSON.stringify(options);
      expect(status, label).toBe('orbit');
      expect(orbit.periapsisAltitude, label).toBeGreaterThanOrEqual(150_000);
      // 操纵越粗糙，轨道越椭圆（远地点偏高），但都是稳定轨道
      expect(orbit.apoapsisAltitude, label).toBeLessThan(1_000_000);
      expect(hud.remainingDeltaV, label).toBeGreaterThan(2_300);
    }
  });

  it('天顶三号（起飞推重比 1.23）：同样的流程，转弯要轻一些（约 1°）', () => {
    const { status, orbit, hud } = flyByHand('zenith-3', { targetAltitude: 200_000, kickAngleDeg: 1 });
    expect(status).toBe('orbit');
    expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(orbit.apoapsisAltitude).toBeLessThan(400_000);
    expect(hud.activeStageIndex).toBe(2);
    expect(hud.fairingAttached).toBe(false);
    expect(hud.remainingDeltaV).toBeGreaterThan(3_500);
  });

  it('同一枚火箭转弯过猛（2°）则轨迹过低而坠毁：流程不是"怎么飞都行"', () => {
    const { status, sim } = flyByHand('zenith-3', { targetAltitude: 200_000, kickAngleDeg: 2 });
    expect(status).toBe('ended');
    expect(sim.flightPhase).toBe('destroyed');
  });
});

describe('自动指向（模拟器内）', () => {
  const angleToNose = (sim: Simulation, direction: { x: number; y: number; z: number }): number => {
    const state = sim.getVehicleState();
    const nose = rotate(state.body.attitude, vec3(1, 0, 0));
    return Math.acos(Math.max(-1, Math.min(1, dot(nose, direction) / length(direction)))) / DEG2RAD;
  };
  const orbiting = () => new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(300_000, { separatedStages: 2 })));

  it('顺行保持：从竖直姿态转到速度方向，并在轨道上持续跟踪', () => {
    const sim = orbiting();
    expect(angleToNose(sim, sim.getVehicleState().body.velocity)).toBeCloseTo(90, 6);
    sim.setAttitudeMode('prograde');
    expect(sim.getVehicleState().attitudeMode).toBe('prograde');
    run(sim, 40);
    expect(angleToNose(sim, sim.getVehicleState().body.velocity)).toBeLessThan(0.2);
    // 半圈之后速度方向转过了 180°，头部仍然对准
    run(sim, 2_700);
    expect(angleToNose(sim, sim.getVehicleState().body.velocity)).toBeLessThan(0.2);
  });

  it('逆行、法向、反法向、径向', () => {
    const cases = [
      ['retrograde', (_r: Vec3Like, v: Vec3Like) => scale(v, -1)],
      ['normal', (r: Vec3Like, v: Vec3Like) => cross(r, v)],
      ['antinormal', (r: Vec3Like, v: Vec3Like) => cross(v, r)],
      ['radial-out', (r: Vec3Like, v: Vec3Like) => cross(v, cross(r, v))],
      ['radial-in', (r: Vec3Like, v: Vec3Like) => cross(cross(r, v), v)],
    ] as const;
    for (const [mode, direction] of cases) {
      const sim = orbiting();
      sim.setAttitudeMode(mode);
      run(sim, 60);
      const { position, velocity } = sim.getVehicleState().body;
      expect(angleToNose(sim, direction(position, velocity))).toBeLessThan(0.3);
    }
  });

  it('上升段低空：顺行保持使迎角趋于零（以相对来流为准）', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 20);
    // 快速向东偏转约 20°：头部领先于速度方向，产生明显的迎角
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    run(sim, 3);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    expect(sim.getVehicleState().flight.angleOfAttack / DEG2RAD).toBeGreaterThan(8);
    sim.setAttitudeMode('prograde');
    run(sim, 15);
    expect(sim.getVehicleState().flight.angleOfAttack / DEG2RAD).toBeLessThan(0.5);
  });

  it('手动输入暂时覆盖自动指向，松开后回到目标方向', () => {
    const sim = orbiting();
    sim.setAttitudeMode('prograde');
    run(sim, 40);
    sim.setAttitudeInput({ pitch: 1, yaw: 0, roll: 0 });
    run(sim, 5);
    expect(angleToNose(sim, sim.getVehicleState().body.velocity)).toBeGreaterThan(20);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 40);
    expect(angleToNose(sim, sim.getVehicleState().body.velocity)).toBeLessThan(0.2);
    expect(sim.getVehicleState().attitudeMode).toBe('prograde');
  });

  it('自动指向不限制时间倍率；无效模式被忽略；飞行结束后回到手动', () => {
    const sim = orbiting();
    sim.setAttitudeMode('normal');
    sim.step();
    expect(sim.maxTimeWarp).toBe(1000);
    // @ts-expect-error 故意传入无效模式
    sim.setAttitudeMode('sideways');
    expect(sim.getVehicleState().attitudeMode).toBe('normal');

    const falling = new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 300, vec3(0, 0, -60))));
    falling.setAttitudeMode('retrograde');
    runUntil(falling, () => falling.flightPhase !== 'flight', 30);
    expect(falling.getVehicleState().attitudeMode).toBe('manual');
  });

  it('圆化机动：在远地点顺行点火把近地点抬到轨道高度（飞船发动机）', () => {
    // 200 × 400 km 椭圆轨道，从近地点出发
    const rp = EARTH.RADIUS + 200_000;
    const a = EARTH.RADIUS + 300_000;
    const sim = new Simulation(
      configFor('frontier-1', 'cape-canaveral', {
        position: vec3(rp, 0, 0),
        velocity: vec3(0, Math.sqrt(EARTH.MU * (2 / rp - 1 / a)), 0),
        separatedStages: 2,
      }),
    );
    sim.setAttitudeMode('prograde');
    // 滑行到远地点前约 60 s
    const halfPeriod = Math.PI * Math.sqrt(a ** 3 / EARTH.MU);
    run(sim, halfPeriod - 60);
    expect(apsides(sim).periapsis).toBeLessThan(205_000);
    sim.setThrottle(1);
    sim.stage();
    expect(runUntil(sim, () => apsides(sim).periapsis > 390_000 || sim.getVehicleState().payloadPropellantMass === 0, sim.time + 600)).toBe(true);
    sim.setThrottle(0);
    const orbit = apsides(sim);
    expect(orbit.periapsis).toBeGreaterThan(390_000);
    expect(orbit.apoapsis).toBeLessThan(420_000);
    // 霍曼转移第二次冲量的理论值约 57 m/s，折合约 150 kg 自燃推进剂
    const used = 1_200 - sim.getVehicleState().payloadPropellantMass;
    expect(used).toBeGreaterThan(120);
    expect(used).toBeLessThan(200);
  });
});

describe('轨迹预测', () => {
  it('发射台上与稳定轨道上不做数值预测', () => {
    expect(new Simulation(configFor('frontier-1')).predictTrajectory()).toBeNull();
    const orbit = new Simulation(configFor('frontier-1', 'cape-canaveral', circularOrbitState(400_000, { separatedStages: 2 })));
    expect(orbit.predictTrajectory()).toBeNull();
  });

  it('弹道飞行：预测的落点与落地时间和实际飞行结果一致', () => {
    // 流星-S 燃尽后分离出返回舱：无动力弹道（含大气阻力与升力的再入），不开伞直到落地
    const sim = new Simulation(configFor('meteor-s'));
    sim.stage();
    run(sim, 10);
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    run(sim, 2.5);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    runUntil(sim, () => sim.getVehicleState().stages[0]!.propellantMass === 0, 300);
    run(sim, 5);
    sim.stage();
    expect(sim.getVehicleState().activeStageIndex).toBe(1);
    sim.setAttitudeMode('retrograde');
    run(sim, 30);

    const prediction = sim.predictTrajectory()!;
    expect(prediction).not.toBeNull();
    expect(prediction.impact).not.toBeNull();
    expect(prediction.points.length).toBe(prediction.times.length * 3);
    expect(prediction.times.length).toBeLessThanOrEqual(400);
    expect(prediction.times[0]).toBe(sim.time);
    for (let i = 1; i < prediction.times.length; i++) expect(prediction.times[i]!).toBeGreaterThan(prediction.times[i - 1]!);
    for (const value of prediction.points) expect(Number.isFinite(value)).toBe(true);

    runUntil(sim, () => sim.flightPhase !== 'flight', 3_000);
    const actual = sim.flightOutcome!;
    // 预测步长比真实积分粗得多（0.5–120 s 对比 0.02 s），仍应在数秒、数公里之内
    expect(Math.abs(prediction.impact!.time - actual.time)).toBeLessThan(3);
    const kmPerRad = EARTH.RADIUS / 1000;
    expect(Math.abs(prediction.impact!.latitude - actual.latitude) * kmPerRad).toBeLessThan(3);
    expect(Math.abs(prediction.impact!.longitude - actual.longitude) * kmPerRad * Math.cos(actual.latitude)).toBeLessThan(3);
    expect(Math.abs(prediction.impact!.speed - actual.impactSpeed) / actual.impactSpeed).toBeLessThan(0.05);
  });

  it('预测不改变真实状态：做与不做预测，后续轨迹逐位相同', () => {
    const make = () => new Simulation(configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 80_000, vec3(900, 0, 400))));
    const a = make();
    const b = make();
    for (let i = 0; i < 500; i++) {
      a.step();
      b.step();
      if (i % 25 === 0) {
        const before = a.getVehicleState();
        expect(a.predictTrajectory()).not.toBeNull();
        expect(a.getVehicleState()).toEqual(before);
      }
    }
    expect(a.getVehicleState()).toEqual(b.getVehicleState());
    expect(a.time).toBe(b.time);
  });

  it('发动机工作时的预测假设"现在关机"', () => {
    const sim = new Simulation(configFor('frontier-1'));
    sim.stage();
    run(sim, 30);
    expect(sim.getVehicleState().flight.thrust).toBeGreaterThan(0);
    const prediction = sim.predictTrajectory()!;
    expect(prediction.impact).not.toBeNull();
    // 30 s 时关机：一两分钟内就会落回地面
    expect(prediction.impact!.time - sim.time).toBeGreaterThan(10);
    expect(prediction.impact!.time - sim.time).toBeLessThan(200);
  });

  it('近地点在大气层内的轨道：预测到再入并给出落点；计算耗时在毫秒量级', () => {
    // 300 km 远地点、60 km 近地点（典型的离轨后轨道），从远地点出发
    const ra = EARTH.RADIUS + 300_000;
    const a = EARTH.RADIUS + 180_000;
    const sim = new Simulation(
      configFor('frontier-1', 'cape-canaveral', {
        position: vec3(ra, 0, 0),
        velocity: vec3(0, Math.sqrt(EARTH.MU * (2 / ra - 1 / a)), 0),
        separatedStages: 2,
      }),
    );
    const start = performance.now();
    const prediction = sim.predictTrajectory()!;
    const elapsed = performance.now() - start;
    expect(prediction.impact).not.toBeNull();
    // 约半圈后进入大气层并落地
    expect(prediction.impact!.time).toBeGreaterThan(1_800);
    expect(prediction.impact!.time).toBeLessThan(4_500);
    // 返回舱以终端速度落地（没有降落伞）
    expect(prediction.impact!.speed).toBeGreaterThan(50);
    expect(prediction.impact!.speed).toBeLessThan(400);
    expect(elapsed).toBeLessThan(100);
  });

  it('逆行保持下的离轨再入：预测按"指向模式不变"计算，落点与实际一致，且不随时间漂移', () => {
    // 200 km 圆轨道，带着接近空箱的二级：逆行点火约 150 m/s 后关机并分离二级，
    // 返回舱保持逆行指向（防热大底朝前）直到落地；不开伞。
    const base = circularOrbitState(200_000, { separatedStages: 1, stagePropellant: [0, 12_000] });
    const sim = new Simulation(configFor('frontier-1', 'cape-canaveral', { ...base, attitude: verticalLaunchAttitude(vec3(0, -1, 0)) }));
    sim.setAttitudeMode('retrograde');
    sim.setThrottle(1);
    sim.stage();
    const v0 = length(sim.getVehicleState().body.velocity);
    runUntil(sim, () => v0 - length(sim.getVehicleState().body.velocity) > 150, 60);
    sim.setThrottle(0);
    sim.stage();
    expect(sim.getVehicleState().activeStageIndex).toBe(2);
    run(sim, 1);

    const early = sim.predictTrajectory()!;
    expect(early.impact).not.toBeNull();
    // 滑行约 10 分钟后（仍在大气层外）重新预测：两次预测应当指向同一个落点
    run(sim, 600);
    expect(length(sim.getVehicleState().body.position) - EARTH.RADIUS).toBeGreaterThan(120_000);
    const later = sim.predictTrajectory()!;
    expect(later.impact).not.toBeNull();

    runUntil(sim, () => sim.flightPhase !== 'flight', 6_000);
    const actual = sim.flightOutcome!;
    const kmPerRad = EARTH.RADIUS / 1000;
    const miss = (p: NonNullable<typeof early.impact>) =>
      Math.hypot((p.latitude - actual.latitude) * kmPerRad, (p.longitude - actual.longitude) * kmPerRad * Math.cos(actual.latitude));
    // 返回舱完整地落到地面（没有开伞，以约 120 m/s 的终端速度撞击）
    expect(actual.cause).toBe('impact');
    expect(actual.impactSpeed).toBeGreaterThan(80);
    expect(actual.impactSpeed).toBeLessThan(200);
    // 若预测仍假设惯性姿态不变，返回舱会在再入时横对来流，预测落点将明显偏离。
    expect(Math.abs(early.impact!.time - actual.time)).toBeLessThan(2);
    expect(miss(early.impact!)).toBeLessThan(5);
    expect(Math.abs(later.impact!.time - actual.time)).toBeLessThan(2);
    expect(miss(later.impact!)).toBeLessThan(5);
  });

  it('主机约每 0.5 s 发布一次预测；轨道变稳定后发一次 null 清除', () => {
    const events: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost((e) => events.push(e), () => now);
    host.handle({ type: 'init', config: configFor('meteor-s', 'cape-canaveral', aboveSite('cape-canaveral', 60_000, vec3(500, 0, 300))) });
    for (let i = 0; i < 500; i++) {
      now += 4;
      host.tick();
    }
    const predictions = events.filter((e) => e.type === 'prediction');
    expect(predictions.length).toBeGreaterThanOrEqual(3);
    expect(predictions.length).toBeLessThanOrEqual(6);
    expect(predictions.every((e) => e.type === 'prediction' && e.prediction !== null)).toBe(true);

    // 稳定轨道：从不发布预测
    const quiet: SimEvent[] = [];
    const host2 = new SimulationHost((e) => quiet.push(e), () => now);
    host2.handle({ type: 'init', config: configFor('frontier-1', 'cape-canaveral', circularOrbitState(400_000, { separatedStages: 2 })) });
    for (let i = 0; i < 500; i++) {
      now += 4;
      host2.tick();
    }
    expect(quiet.some((e) => e.type === 'prediction')).toBe(false);
  });
});

describe('轨道遥测', () => {
  const telemetryOf = (sim: Simulation, config: SimulationConfig) =>
    deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);

  it('发射台上不给出轨道参数；起飞后为亚轨道', () => {
    const config = configFor('frontier-1');
    const sim = new Simulation(config);
    expect(telemetryOf(sim, config).orbit).toBeNull();
    sim.stage();
    run(sim, 20);
    const orbit = telemetryOf(sim, config).orbit!;
    expect(orbit.classification).toBe('suborbital');
    expect(orbit.periapsisAltitude).toBeLessThan(0);
    expect(orbit.apoapsisAltitude).toBeGreaterThan(0);
  });

  it('入轨后：分类为在轨，远/近地点、倾角、周期与轨道一致', () => {
    const config = configFor('frontier-1');
    const sim = new Simulation(config);
    expect(new AscentPilot(sim, { targetAltitude: 200_000, kickAngleDeg: 4 }).fly()).toBe('orbit');
    const t = telemetryOf(sim, config);
    const orbit = t.orbit!;
    const reference = apsides(sim);
    expect(orbit.classification).toBe('orbit');
    expect(orbit.periapsisAltitude).toBeCloseTo(reference.periapsis, 3);
    expect(orbit.apoapsisAltitude).toBeCloseTo(reference.apoapsis, 3);
    expect(orbit.inclination / DEG2RAD).toBeCloseTo(28.5, 0);
    expect(orbit.period / 60).toBeGreaterThan(87);
    expect(orbit.period / 60).toBeLessThan(90);
    expect(orbit.eccentricity).toBeLessThan(0.005);
    expect(orbit.timeToApoapsis).not.toBeNull();
    expect(orbit.timeToPeriapsis).not.toBeNull();
    expect(t.attitudeMode).toBe('manual');
    // 其余根数：角度都在 [0, 2π) 内
    for (const angle of [orbit.raan, orbit.argumentOfPeriapsis, orbit.trueAnomaly]) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(2 * Math.PI);
    }
    // 向正东发射时发射场是轨道的最北点（纬度幅角 u = ω + ν = 90°）；入轨时已向东飞出约 14°（约 1500 km）
    const argumentOfLatitude = ((orbit.argumentOfPeriapsis + orbit.trueAnomaly) / DEG2RAD) % 360;
    expect(argumentOfLatitude).toBeGreaterThan(98);
    expect(argumentOfLatitude).toBeLessThan(112);
    expect(orbit.semiMajorAxis).toBeCloseTo(EARTH.RADIUS + (reference.periapsis + reference.apoapsis) / 2, 3);
  });

  it('近地点在大气层内、逃逸轨道的分类', () => {
    const ra = EARTH.RADIUS + 300_000;
    const low = deriveOrbit(vec3(ra, 0, 0), vec3(0, Math.sqrt(EARTH.MU * (2 / ra - 1 / (EARTH.RADIUS + 180_000))), 0));
    expect(low.classification).toBe('atmospheric');
    expect(low.periapsisAltitude / 1000).toBeCloseTo(60, 3);
    const escape = deriveOrbit(vec3(ra, 0, 0), vec3(0, 11_500, 0));
    expect(escape.classification).toBe('escape');
    expect(escape.apoapsisAltitude).toBe(Infinity);
    expect(escape.timeToApoapsis).toBeNull();
  });
});
