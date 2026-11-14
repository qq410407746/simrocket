import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
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
import { add, addScaled, cross, distance, dot, length, scale, sub, vec3 } from '../physics/math/vec3';
import { configurationAero, stageAloneMassProperties } from '../vehicles/configuration';
import { ATTITUDE_CONTROL, LANDING_LIMITS, Simulation, isValidVehicleState } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { AscentPilot, apsides } from './testing/ascentPilot';
import type { FlightEvent, InitialFlightState, SimEvent, SimSnapshot, SimulationConfig } from './types';

const epochJulianDate = julianDateFromUnixMs(Date.UTC(2026, 3, 12, 14, 52));

const configFor = (vehicleId: string, siteId = 'cape-canaveral', initialState?: InitialFlightState): SimulationConfig => ({
  vehicle: getVehicleOrDefault(vehicleId),
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
