/**
 * 阶段四：升力、气动加热与热防护、结构失效、降落伞。
 * 这些测试都通过完整的模拟器运行（与游戏中相同的物理步长与控制指令）。
 */
import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { ablativeHeatShield } from '@/data/materials';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { referenceVehicleById } from '@/data/testing/referenceVehicles';
import { DEG2RAD, EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import { verticalLaunchAttitude } from '../physics/frames/frames';
import { rotate } from '../physics/math/quat';
import { type Vec3, add, cross, dot, length, normalize, scale, sub, vec3 } from '../physics/math/vec3';
import { deriveOrbit } from '../telemetry/telemetry';
import { configurationAero, configurationLandingLimits, configurationParachute, initialConfiguration } from '../vehicles/configuration';
import type { CapsuleDefinition, VehicleDefinition } from '../vehicles/types';
import { STRUCTURAL_FAILURE_DELAY, Simulation } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { HandFlownPilot } from './testing/handFlownPilot';
import type { FlightEvent, InitialFlightState, SimEvent, SimulationConfig } from './types';

const site = launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'));
const epochJulianDate = julianDateFromUnixMs(Date.UTC(2026, 3, 12, 14, 52));
const OMEGA = vec3(0, 0, EARTH.ROTATION_RATE);

const configFor = (vehicle: VehicleDefinition | string, initialState?: InitialFlightState): SimulationConfig => ({
  vehicle: typeof vehicle === 'string' ? referenceVehicleById(vehicle) : vehicle,
  site,
  epochJulianDate,
  initialState,
});

const altitudeOf = (sim: Simulation): number => length(sim.getVehicleState().body.position) - EARTH.RADIUS;
const gLoadOf = (sim: Simulation): number => length(sim.getVehicleState().specificForce) / STANDARD_GRAVITY;
const zone = (sim: Simulation, id: 'nose' | 'side' | 'base') => sim.getVehicleState().thermal.find((z) => z.zone === id)!;
const run = (sim: Simulation, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / sim.dt); i++) sim.step();
};

/**
 * 再入初始状态：位于赤道上空 altitude 处，速度大小 speed，航迹角 gamma（向下为正）。
 * @param noseOffsetDeg 头部相对"逆行方向"向天偏转的角度；0 即防热大底正对来流
 */
const entryState = (
  speed: number,
  gammaDeg: number,
  options: {
    altitude?: number;
    separatedStages: number;
    attitude?: 'retrograde' | 'prograde' | 'sideways';
    noseOffsetDeg?: number;
    /** 为真时 speed 是相对（随地球转动的）大气的速度，否则是惯性速度。 */
    relativeToAir?: boolean;
  },
): InitialFlightState => {
  const radius = EARTH.RADIUS + (options.altitude ?? 120_000);
  const gamma = gammaDeg * DEG2RAD;
  const position = vec3(radius, 0, 0);
  const relative = vec3(-speed * Math.sin(gamma), speed * Math.cos(gamma), 0);
  const velocity = options.relativeToAir ? add(relative, cross(OMEGA, position)) : relative;
  const direction = normalize(relative);
  const up = normalize(position);
  // 垂直于速度、偏向天顶的方向
  const liftUp = normalize(sub(up, scale(direction, dot(up, direction))));
  let nose: Vec3;
  if (options.attitude === 'prograde') nose = direction;
  else if (options.attitude === 'sideways') nose = vec3(0, 0, 1);
  else {
    const offset = (options.noseOffsetDeg ?? 0) * DEG2RAD;
    nose = add(scale(direction, -Math.cos(offset)), scale(liftUp, Math.sin(offset)));
  }
  return { position, velocity, attitude: verticalLaunchAttitude(nose), separatedStages: options.separatedStages };
};

interface EntryResult {
  readonly sim: Simulation;
  readonly events: FlightEvent[];
  readonly maxG: number;
  /** 开伞之后出现的最大过载。 */
  readonly maxGUnderParachute: number;
  readonly skippedOut: boolean;
}

/**
 * 飞完一次再入。mode 为自动指向模式（null 表示保持初始的惯性姿态）；
 * 降到 parachuteAltitude 以下且为亚声速时开伞（null 表示不开伞）。
 */
const flyEntry = (
  config: SimulationConfig,
  mode: 'retrograde' | 'prograde' | 'normal' | null,
  parachuteAltitude: number | null = 6_000,
  timeout = 4_000,
): EntryResult => {
  const sim = new Simulation(config);
  if (mode) sim.setAttitudeMode(mode);
  const events: FlightEvent[] = [];
  let maxG = 0;
  let maxGUnderParachute = 0;
  let skippedOut = false;
  let lowest = Infinity;
  while (sim.flightPhase === 'flight' && sim.time < timeout) {
    sim.step();
    events.push(...sim.drainEvents());
    const state = sim.getVehicleState();
    const altitude = altitudeOf(sim);
    const g = gLoadOf(sim);
    maxG = Math.max(maxG, g);
    if (state.parachute.phase === 'drogue' || state.parachute.phase === 'main') maxGUnderParachute = Math.max(maxGUnderParachute, g);
    lowest = Math.min(lowest, altitude);
    if (lowest < 100_000 && altitude > 125_000) {
      skippedOut = true;
      break;
    }
    if (parachuteAltitude !== null && altitude < parachuteAltitude && state.parachute.phase === 'stowed' && state.flight.mach < 0.85) {
      sim.deployParachute();
    }
  }
  return { sim, events, maxG, maxGUnderParachute, skippedOut };
};

const frontier = referenceVehicleById('frontier-1');
const capsuleOnly = { separatedStages: 2 } as const;

describe('升力', () => {
  /** 返回舱在 60 km 高度以 6 km/s 飞行，头部相对逆行方向向天偏 offset 度。 */
  const atAngle = (offsetDeg: number) => {
    const sim = new Simulation(configFor(frontier, entryState(6_000, 0, { altitude: 60_000, ...capsuleOnly, noseOffsetDeg: offsetDeg })));
    sim.step();
    const state = sim.getVehicleState();
    const airVelocity = sub(state.body.velocity, cross(OMEGA, state.body.position));
    const up = normalize(state.body.position);
    return { state, liftUp: dot(state.specificForce, up) - (dot(state.specificForce, normalize(airVelocity)) * dot(normalize(airVelocity), up)) };
  };

  it('防热大底正对来流（零迎角）时没有升力，气动力就是阻力', () => {
    const { state } = atAngle(0);
    expect(state.flight.drag).toBeGreaterThan(5e4);
    expect(state.flight.lift / state.flight.drag).toBeLessThan(1e-3);
    expect(state.flight.angleOfAttack / DEG2RAD).toBeCloseTo(180, 0);
  });

  it('舱顶向天偏 20°：升阻比约 0.3，升力向上；向地偏则升力向下', () => {
    const up = atAngle(20);
    expect(up.state.flight.lift / up.state.flight.drag).toBeGreaterThan(0.25);
    expect(up.state.flight.lift / up.state.flight.drag).toBeLessThan(0.36);
    expect(up.liftUp).toBeGreaterThan(0);
    const down = atAngle(-20);
    expect(down.state.flight.lift).toBeCloseTo(up.state.flight.lift, -2);
    expect(down.liftUp).toBeLessThan(0);
    expect(down.liftUp).toBeCloseTo(-up.liftUp, 1);
  });

  it('阻力与单独的阻力公式一致：D = q·(C_d·A)', () => {
    const { state } = atAngle(20);
    const aero = configurationAero(frontier, { ...initialConfiguration(frontier), stages: state.stages });
    const cos = Math.cos(state.flight.angleOfAttack);
    // 钝头体：C_A·A·cos² + C_N·A_lat·sin⁴
    const expected = state.flight.dynamicPressure * (1.3 * aero.referenceArea * cos * cos + 1.2 * aero.lateralArea * (1 - cos * cos) ** 2);
    expect(state.flight.drag / expected).toBeCloseTo(1, 3);
  });

  it('升力向上的再入比弹道式再入过载低得多、飞得更远', () => {
    // 手动模式保持惯性姿态。飞行中速度方向随航迹转动（每飞过 1° 地心角转 1°），
    // 所以初始把舱顶向天多偏一些（20°–30°），在主要减速段迎角仍有十几度、升力向上。
    const ballistic = flyEntry(configFor(frontier, entryState(7_800, 2.5, capsuleOnly)), 'retrograde');
    expect(ballistic.sim.flightOutcome?.kind).toBe('landed');
    expect(ballistic.maxG).toBeGreaterThan(9);
    for (const offset of [20, 30]) {
      const lifting = flyEntry(configFor(frontier, entryState(7_800, 2.5, { ...capsuleOnly, noseOffsetDeg: offset })), null);
      expect(lifting.sim.flightOutcome?.kind, `偏 ${offset}°`).toBe('landed');
      // 弹道式约 9.5 g，升力式约 5 g
      expect(lifting.maxG, `偏 ${offset}°`).toBeLessThan(ballistic.maxG - 3);
      expect(lifting.sim.flightOutcome!.time).toBeGreaterThan(ballistic.sim.flightOutcome!.time);
      // 航程：落点更远（沿飞行方向经度更大）
      expect(lifting.sim.flightOutcome!.longitude).toBeGreaterThan(ballistic.sim.flightOutcome!.longitude + 1 * DEG2RAD);
    }
  });

  it('舱顶向地偏（升力向下）：轨迹更陡，而且随着航迹转动迎角越来越大，升力把返回舱压进稠密大气，过载超过结构限值', () => {
    const { sim, maxG } = flyEntry(configFor(frontier, entryState(7_800, 2.5, { ...capsuleOnly, noseOffsetDeg: -8 })), null);
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('overload');
    expect(maxG).toBeGreaterThan(14);
    expect(outcome.altitude).toBeGreaterThan(30_000);
    // 迎角仍小于侧壁的半锥角（约 22°）时，侧壁躲在大底的背风区里，不是先被烧毁的部位
    expect(zone(sim, 'side').failure).toBeNull();
  });
});

describe('再入：合理的条件可以成功返回', () => {
  it('近地轨道弹道再入（7.8 km/s，航迹角 1.5°，防热大底朝前）：安全着陆', () => {
    const { sim, events, maxG, maxGUnderParachute } = flyEntry(configFor(frontier, entryState(7_800, 1.5, capsuleOnly)), 'retrograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('landed');
    expect(outcome.cause).toBeNull();
    // 主伞下的落地速度
    expect(outcome.impactSpeed).toBeGreaterThan(5);
    expect(outcome.impactSpeed).toBeLessThan(10);
    // 弹道再入的峰值过载约 8–9 g（与东方号、联盟号弹道再入的量级相符）
    expect(maxG).toBeGreaterThan(7);
    expect(maxG).toBeLessThan(10);
    // 开伞冲击远小于再入过载
    expect(maxGUnderParachute).toBeGreaterThan(1.5);
    expect(maxGUnderParachute).toBeLessThan(6);

    const stats = sim.flightStats;
    // 峰值驻点热流约 0.5 MW/m²（曲率半径 4.6 m 的钝头体）
    expect(stats.maxHeatFlux).toBeGreaterThan(0.35e6);
    expect(stats.maxHeatFlux).toBeLessThan(0.75e6);
    // 累积热载荷数十 MJ/m²
    expect(stats.maxHeatLoad).toBeGreaterThan(40e6);
    expect(stats.maxHeatLoad).toBeLessThan(110e6);
    // 最大动压约 40 kPa
    expect(stats.maxDynamicPressure).toBeGreaterThan(30_000);
    expect(stats.maxDynamicPressure).toBeLessThan(55_000);

    const shield = zone(sim, 'base');
    expect(shield.material).toBe('烧蚀防热层');
    expect(shield.ablative).toBe(true);
    // 烧蚀层消耗了一部分，但余量充足
    expect(shield.ablatorFraction).toBeGreaterThan(0.6);
    expect(shield.ablatorFraction).toBeLessThan(0.95);
    // 表面温度曾达到烧蚀温度；内部结构只升温几十到一百来度
    expect(stats.maxSurfaceTemperature).toBe(1_500);
    expect(shield.interiorTemperature).toBeGreaterThan(300);
    expect(shield.interiorTemperature).toBeLessThan(shield.interiorLimit - 60);
    // 背风面的舱顶与侧壁只有中等温升
    expect(zone(sim, 'nose').failure).toBeNull();
    expect(zone(sim, 'side').failure).toBeNull();

    expect(events.map((e) => e.kind)).toEqual(['drogue-deployed', 'main-deployed', 'landed']);
  });

  it('亚轨道返回（流星-S 返回舱，约 2.2 km/s 陡峭下落）：热载荷很小，过载较大但在限值内，安全着陆', () => {
    const { sim, maxG } = flyEntry(configFor('meteor-s', entryState(2_200, 60, { separatedStages: 1 })), 'retrograde');
    expect(sim.flightOutcome?.kind).toBe('landed');
    expect(maxG).toBeGreaterThan(12);
    expect(maxG).toBeLessThan(25);
    expect(zone(sim, 'base').ablatorFraction).toBe(1);
    expect(sim.flightStats.maxSurfaceTemperature).toBeLessThan(700);
  });

  it('从 200 km 轨道离轨、分离二级、保持逆行、开伞：完整的返回流程', () => {
    const radius = EARTH.RADIUS + 200_000;
    const sim = new Simulation(
      configFor(frontier, {
        position: vec3(radius, 0, 0),
        velocity: vec3(0, Math.sqrt(EARTH.MU / radius), 0),
        attitude: verticalLaunchAttitude(vec3(0, -1, 0)),
        separatedStages: 1,
        stagePropellant: [0, 12_000],
      }),
    );
    sim.setAttitudeMode('retrograde');
    sim.setThrottle(1);
    sim.stage();
    const v0 = length(sim.getVehicleState().body.velocity);
    while (v0 - length(sim.getVehicleState().body.velocity) < 120) sim.step();
    sim.setThrottle(0);
    // 分离二级：只剩返回舱，降落伞进入待命
    expect(sim.getVehicleState().parachute.phase).toBe('none');
    sim.stage();
    expect(sim.getVehicleState().parachute.phase).toBe('stowed');
    expect(deriveOrbit(sim.getVehicleState().body.position, sim.getVehicleState().body.velocity).periapsisAltitude).toBeLessThan(0);

    let deployedAt = 0;
    while (sim.flightPhase === 'flight' && sim.time < 5_000) {
      sim.step();
      const state = sim.getVehicleState();
      if (state.parachute.phase === 'stowed' && altitudeOf(sim) < 7_000 && state.flight.mach < 0.85) {
        sim.deployParachute();
        deployedAt = sim.time;
      }
    }
    expect(deployedAt).toBeGreaterThan(0);
    expect(sim.flightOutcome?.kind).toBe('landed');
    expect(sim.flightOutcome!.impactSpeed).toBeLessThan(10);
    expect(sim.flightStats.maxGLoad).toBeLessThan(10);
  });
});

describe('再入：不同的速度、角度与热防护参数给出不同的结果', () => {
  it('航迹角越浅：峰值热流与过载越低，但受热时间更长、累积热载荷与结构温升更大', () => {
    const results = [0.8, 1.5, 2.5, 4].map((gamma) => {
      const { sim, maxG } = flyEntry(configFor(frontier, entryState(7_800, gamma, capsuleOnly)), 'retrograde');
      expect(sim.flightOutcome?.kind, `γ = ${gamma}°`).toBe('landed');
      return { gamma, maxG, stats: sim.flightStats, interior: zone(sim, 'base').interiorTemperature };
    });
    for (let i = 1; i < results.length; i++) {
      const shallow = results[i - 1]!;
      const steep = results[i]!;
      expect(steep.maxG).toBeGreaterThan(shallow.maxG);
      expect(steep.stats.maxHeatFlux).toBeGreaterThan(shallow.stats.maxHeatFlux);
      expect(steep.stats.maxHeatLoad).toBeLessThan(shallow.stats.maxHeatLoad);
      expect(steep.interior).toBeLessThan(shallow.interior);
    }
    // 4° 时过载已经超过 12 g
    expect(results[3]!.maxG).toBeGreaterThan(12);
  });

  it('再入角过陡（6°）：过载超过结构限值，在高空解体', () => {
    const { sim, maxG } = flyEntry(configFor(frontier, entryState(7_800, 6, capsuleOnly)), 'retrograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('overload');
    expect(outcome.thermalZone).toBeNull();
    expect(maxG).toBeGreaterThan(14);
    expect(outcome.altitude).toBeGreaterThan(25_000);
    expect(outcome.altitude).toBeLessThan(60_000);
    // 解体时仍在高速飞行
    expect(outcome.impactSpeed).toBeGreaterThan(3_000);
  });

  it('再入角过浅（速度高于圆轨道速度）：掠过高层大气后重新飞出——跳跃式再入', () => {
    // 9 km/s、航迹角 3°：大气不足以在这一次掠过中把它留下
    const { sim, skippedOut } = flyEntry(configFor(frontier, entryState(9_000, 3, capsuleOnly)), 'retrograde');
    expect(skippedOut).toBe(true);
    expect(sim.flightPhase).toBe('flight');
    // 损失了一部分能量，但仍在一条远地点很高的轨道上；防热大底没有损伤
    const state = sim.getVehicleState();
    const orbit = deriveOrbit(state.body.position, state.body.velocity);
    expect(orbit.apoapsisAltitude).toBeGreaterThan(300_000);
    expect(length(state.body.velocity)).toBeLessThan(9_000);
    expect(zone(sim, 'base').failure).toBeNull();
    // 同样的速度、更陡的角度（4.5°）则一次进入并着陆
    expect(flyEntry(configFor(frontier, entryState(9_000, 4.5, capsuleOnly)), 'retrograde').sim.flightOutcome?.kind).toBe('landed');
  });

  it('离轨点火不足（近地点 90 km 对比 40 km）：没有在预期的地方下降——多飞几千公里、多受热几分钟', () => {
    const deorbit = (periapsis: number) => {
      const radius = EARTH.RADIUS + 200_000;
      const rp = EARTH.RADIUS + periapsis;
      const speed = Math.sqrt(EARTH.MU * (2 / radius - 2 / (radius + rp)));
      return flyEntry(
        configFor(frontier, { position: vec3(radius, 0, 0), velocity: vec3(0, speed, 0), attitude: verticalLaunchAttitude(vec3(0, -1, 0)), separatedStages: 2 }),
        'retrograde',
        6_000,
        8_000,
      ).sim;
    };
    const nominal = deorbit(40_000);
    const shallow = deorbit(90_000);
    expect(nominal.flightOutcome?.kind).toBe('landed');
    expect(shallow.flightOutcome?.kind).toBe('landed');
    // 落地晚了好几分钟，落点沿轨道方向远了上千公里
    expect(shallow.flightOutcome!.time - nominal.flightOutcome!.time).toBeGreaterThan(300);
    const rangeDifference = (shallow.flightOutcome!.time - nominal.flightOutcome!.time) * 7.4;
    expect(rangeDifference).toBeGreaterThan(2_000);
    // 受热时间更长：累积热载荷更大、内部结构更热
    expect(shallow.flightStats.maxHeatLoad).toBeGreaterThan(nominal.flightStats.maxHeatLoad);
    expect(zone(shallow, 'base').interiorTemperature).toBeGreaterThan(zone(nominal, 'base').interiorTemperature);
    // 峰值过载却几乎一样（约 8 g）：从圆轨道很浅地弹道再入时，过载基本与再入角无关
    expect(Math.abs(shallow.flightStats.maxGLoad - nominal.flightStats.maxGLoad)).toBeLessThan(0.6);
    expect(nominal.flightStats.maxGLoad).toBeGreaterThan(7.5);
    expect(nominal.flightStats.maxGLoad).toBeLessThan(8.6);
  });

  it('再入速度越高：峰值热流与烧蚀层消耗越大', () => {
    const at = (speed: number, gamma: number) => {
      const { sim } = flyEntry(configFor(frontier, entryState(speed, gamma, capsuleOnly)), 'retrograde');
      return { sim, flux: sim.flightStats.maxHeatFlux, ablator: zone(sim, 'base').ablatorFraction };
    };
    const leo = at(7_800, 2.5);
    const fast = at(9_000, 4.5);
    const gto = at(10_300, 5.5);
    expect(leo.sim.flightOutcome?.kind).toBe('landed');
    expect(fast.sim.flightOutcome?.kind).toBe('landed');
    expect(gto.sim.flightOutcome?.kind).toBe('landed');
    expect(fast.flux).toBeGreaterThan(1.3 * leo.flux);
    expect(gto.flux).toBeGreaterThan(1.3 * fast.flux);
    expect(fast.ablator).toBeLessThan(leo.ablator - 0.1);
    expect(gto.ablator).toBeLessThan(fast.ablator - 0.1);
    // 地球同步转移轨道返回的速度（10.3 km/s）已经用掉大半烧蚀层
    expect(gto.ablator).toBeLessThan(0.45);
  });

  it('再入速度过高（11 km/s）：近地轨道级别的防热大底被烧穿', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(11_000, 5.5, capsuleOnly)), 'retrograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('burn-through');
    expect(outcome.thermalZone).toBe('base');
    expect(zone(sim, 'base').ablatorFraction).toBe(0);
    // 峰值热流超过 1 MW/m²
    expect(sim.flightStats.maxHeatFlux).toBeGreaterThan(1.0e6);
  });

  it('同样的再入条件，防热层厚度不同结果不同', () => {
    const withShield = (arealMass: number): VehicleDefinition => ({
      ...frontier,
      payload: {
        ...(frontier.payload as CapsuleDefinition),
        heatShield: { noseRadius: 4.6, surface: ablativeHeatShield(arealMass), mass: 650 },
      },
    });
    const outcomeOf = (arealMass: number) => flyEntry(configFor(withShield(arealMass), entryState(7_800, 1.5, capsuleOnly)), 'retrograde').sim;
    const thin = outcomeOf(0.4);
    expect(thin.flightOutcome?.cause).toBe('burn-through');
    const nominal = outcomeOf(4);
    const thick = outcomeOf(12);
    expect(nominal.flightOutcome?.kind).toBe('landed');
    expect(thick.flightOutcome?.kind).toBe('landed');
    // 消耗的烧蚀层质量相同，所以越厚剩余比例越高
    expect(zone(thick, 'base').ablatorFraction).toBeGreaterThan(zone(nominal, 'base').ablatorFraction);
    const consumed = (sim: Simulation, arealMass: number) => (1 - zone(sim, 'base').ablatorFraction) * arealMass;
    expect(consumed(thick, 12)).toBeCloseTo(consumed(nominal, 4), 1);
  });

  it('曲率半径更小的防热大底热流更高（q̇ ∝ 1/√R_n）', () => {
    const withRadius = (noseRadius: number): VehicleDefinition => ({
      ...frontier,
      payload: { ...(frontier.payload as CapsuleDefinition), heatShield: { noseRadius, surface: ablativeHeatShield(4), mass: 650 } },
    });
    const fluxOf = (noseRadius: number) =>
      flyEntry(configFor(withRadius(noseRadius), entryState(7_800, 1.5, capsuleOnly)), 'retrograde').sim.flightStats.maxHeatFlux;
    const blunt = fluxOf(4.6);
    const sharp = fluxOf(1.15);
    // 冷壁热流相差 2 倍；热壁修正对两者相同（表面都在烧蚀温度）
    expect(sharp / blunt).toBeGreaterThan(1.9);
    expect(sharp / blunt).toBeLessThan(2.1);
  });

  it('亚轨道级别的薄防热层（流星-S 返回舱）承受不了轨道速度的再入', () => {
    const { sim } = flyEntry(configFor('meteor-s', entryState(7_800, 1.5, { separatedStages: 1 })), 'retrograde');
    expect(sim.flightOutcome?.cause).toBe('burn-through');
  });
});

describe('再入：热防护不足导致烧毁', () => {
  it('舱顶朝前（顺行）再入：没有防热大底保护，舱顶在约 80 km 高度过热', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(7_800, 1.5, { ...capsuleOnly, attitude: 'prograde' })), 'prograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('thermal-surface');
    expect(outcome.thermalZone).toBe('nose');
    expect(outcome.altitude).toBeGreaterThan(65_000);
    expect(outcome.altitude).toBeLessThan(100_000);
    // 防热大底在尾流区，几乎没有受热
    expect(zone(sim, 'base').ablatorFraction).toBe(1);
    expect(zone(sim, 'base').surfaceTemperature).toBeLessThan(450);
  });

  it('侧向再入：侧壁过热', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(7_800, 1.5, { ...capsuleOnly, attitude: 'sideways' })), 'normal');
    expect(sim.flightOutcome?.cause).toBe('thermal-surface');
    expect(sim.flightOutcome?.thermalZone).toBe('side');
  });

  it('不分离二级就再入：朝前的发动机舱没有防热设计，在约 70 km 高度烧毁', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(7_800, 1.5, { separatedStages: 1 })), 'retrograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('thermal-surface');
    expect(outcome.thermalZone).toBe('base');
    expect(zone(sim, 'base').material).toBe('发动机舱');
    expect(outcome.altitude).toBeGreaterThan(55_000);
    expect(outcome.altitude).toBeLessThan(90_000);
    // 带着推进级时没有降落伞可用
    expect(sim.getVehicleState().parachute.phase).toBe('none');
  });

  it('没有防热设计的卫星在高层大气就会失效', () => {
    const { sim } = flyEntry(configFor('zenith-3', entryState(7_800, 1.5, { separatedStages: 3 })), 'retrograde');
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toMatch(/^thermal-/);
    expect(outcome.altitude).toBeGreaterThan(90_000);
  });

  it('空中解体后飞行结束：状态点留在解体位置（随地球转动），不再变化', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(7_800, 1.5, { ...capsuleOnly, attitude: 'prograde' })), 'prograde');
    expect(sim.flightPhase).toBe('destroyed');
    const outcome = sim.flightOutcome!;
    const before = sim.getVehicleState();
    expect(length(before.body.position) - EARTH.RADIUS).toBeCloseTo(outcome.altitude, 0);
    run(sim, 30);
    const after = sim.getVehicleState();
    expect(sim.flightOutcome).toEqual(outcome);
    expect(length(after.body.position)).toBeCloseTo(length(before.body.position), 3);
    // 相对地面静止
    expect(length(sub(after.body.velocity, cross(OMEGA, after.body.position)))).toBeLessThan(1e-6);
    expect(after.flight.thrust).toBe(0);
  });
});

describe('上升段与在轨的加热（同一套热物理）', () => {
  it('正常上升：头部温升有限，没有任何热区接近限值；入轨后停止受热', () => {
    const config = configFor(frontier);
    const sim = new Simulation(config);
    expect(new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5 }).fly()).toBe('orbit');
    const stats = sim.flightStats;
    // 头部（舱顶，曲率半径 0.5 m）峰值热流几十 kW/m²
    expect(stats.maxHeatFlux).toBeGreaterThan(10_000);
    expect(stats.maxHeatFlux).toBeLessThan(150_000);
    expect(stats.maxSurfaceTemperature).toBeGreaterThan(400);
    expect(stats.maxSurfaceTemperature).toBeLessThan(1_100);
    for (const z of sim.getVehicleState().thermal) {
      expect(z.failure).toBeNull();
      expect(z.margin).toBeGreaterThan(0.5);
    }
    // 在 150 km 以上的轨道上：热流只有自由分子流的水平
    expect(zone(sim, 'nose').heatFlux).toBeLessThan(2_000);
  });

  it('200 km 圆轨道上飞一圈：自由分子流加热微不足道，各表面保持在环境温度附近', () => {
    const radius = EARTH.RADIUS + 200_000;
    const sim = new Simulation(configFor(frontier, { position: vec3(radius, 0, 0), velocity: vec3(0, Math.sqrt(EARTH.MU / radius), 0), separatedStages: 2 }));
    run(sim, 5_400);
    expect(sim.flightPhase).toBe('flight');
    for (const z of sim.getVehicleState().thermal) {
      expect(z.heatFlux).toBeLessThan(100);
      expect(z.surfaceTemperature).toBeGreaterThan(250);
      expect(z.surfaceTemperature).toBeLessThan(300);
      expect(z.margin).toBeGreaterThan(0.95);
    }
    // 不加稀薄流上限的 Sutton–Graves 在这里会给出约 1 kW/m²
    expect(sim.getVehicleState().flight.referenceHeatFlux).toBeLessThan(100);
  });

  it('过早抛整流罩：卫星暴露在气流中被毁；出了大气层再抛则安全', () => {
    const fly = (jettisonAltitude: number) => {
      const config = configFor('zenith-3');
      const sim = new Simulation(config);
      const pilot = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 1 });
      let status = pilot.update();
      while (status === 'ascending' && sim.time < 2_000) {
        sim.step();
        if (sim.getVehicleState().fairingAttached && altitudeOf(sim) > jettisonAltitude) sim.jettisonFairing();
        status = pilot.update();
      }
      return { sim, status };
    };
    const early = fly(35_000);
    expect(early.status).toBe('ended');
    expect(early.sim.flightOutcome?.kind).toBe('destroyed');
    // 卫星的展开机构承受不了几 kPa 的动压，也可能先被烤坏
    expect(['dynamic-pressure', 'thermal-surface', 'thermal-structure']).toContain(early.sim.flightOutcome?.cause);
    expect(early.sim.flightOutcome!.altitude).toBeLessThan(60_000);

    const late = fly(110_000);
    expect(late.status).toBe('orbit');
    expect(zone(late.sim, 'nose').material).toBe('卫星本体');
    expect(zone(late.sim, 'nose').failure).toBeNull();
  });

  it('整流罩抛掉后头部热区换成卫星本体，并从环境温度重新开始', () => {
    const sim = new Simulation(configFor('zenith-3', entryState(3_000, -20, { altitude: 130_000, separatedStages: 2 })));
    expect(zone(sim, 'nose').owner).toBe('fairing');
    expect(zone(sim, 'nose').material).toContain('整流罩');
    sim.jettisonFairing();
    expect(zone(sim, 'nose').owner).toBe('payload');
    expect(zone(sim, 'nose').material).toBe('卫星本体');
    expect(zone(sim, 'nose').surfaceTemperature).toBeCloseTo(288.15, 1);
    // 侧壁与底部仍属于同一级，状态延续
    expect(zone(sim, 'side').owner).toBe('stage-2');
  });
});

describe('结构失效', () => {
  it('动压过大：流星-S 不分离返回舱，整箭高速坠入稠密大气，在二十多公里高度解体', () => {
    const sim = new Simulation(configFor('meteor-s'));
    sim.stage();
    while ((sim.flightPhase === 'prelaunch' || sim.flightPhase === 'flight') && sim.time < 3_000) sim.step();
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('dynamic-pressure');
    expect(outcome.altitude).toBeGreaterThan(10_000);
    expect(outcome.altitude).toBeLessThan(40_000);
    expect(sim.flightStats.maxDynamicPressure).toBeGreaterThan(120_000);
  });

  it('带迎角穿过最大动压区：横向气动载荷超限，箭体折断', () => {
    const sim = new Simulation(configFor(frontier));
    sim.stage();
    // 竖直上升到最大动压区附近（约 50 s、动压 20 kPa 以上），然后猛打方向
    while (sim.getVehicleState().flight.dynamicPressure < 20_000 && sim.time < 120) sim.step();
    expect(sim.flightPhase).toBe('flight');
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    while (sim.flightPhase === 'flight' && sim.time < 200) sim.step();
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('destroyed');
    expect(outcome.cause).toBe('bending');
    // 迎角只有十来度就已经超限
    expect(outcome.altitude).toBeGreaterThan(3_000);
  });

  it('同样的操纵在低动压下是安全的（起飞后的程序转弯）', () => {
    const sim = new Simulation(configFor(frontier));
    sim.stage();
    while (sim.getVehicleState().flight.airspeed < 60) sim.step();
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    run(sim, 1);
    sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    run(sim, 5);
    expect(sim.flightPhase).toBe('flight');
    expect(sim.getVehicleState().flight.bendingLoad).toBeLessThan(1_000);
  });

  it('超限需要持续一小段时间才判定解体（滤掉单步尖峰）', () => {
    expect(STRUCTURAL_FAILURE_DELAY).toBeGreaterThan(0.05);
    expect(STRUCTURAL_FAILURE_DELAY).toBeLessThan(1);
  });
});

describe('降落伞', () => {
  /** 返回舱在高空自由下落到给定高度。 */
  const fallingCapsule = (vehicleId: string, altitude: number) => {
    const vehicle = referenceVehicleById(vehicleId);
    const sim = new Simulation(
      configFor(vehicle, entryState(200, 80, { altitude: 30_000, separatedStages: vehicle.stages.length, relativeToAir: true })),
    );
    sim.setAttitudeMode('retrograde');
    while (sim.flightPhase === 'flight' && altitudeOf(sim) > altitude) sim.step();
    return sim;
  };

  it('只有与推进级分离后的返回舱才有降落伞可用', () => {
    const stack = new Simulation(configFor(frontier, entryState(200, 80, { altitude: 5_000, separatedStages: 1, relativeToAir: true })));
    expect(stack.getVehicleState().parachute.phase).toBe('none');
    stack.deployParachute();
    expect(stack.getVehicleState().parachute.phase).toBe('none');
    expect(stack.drainEvents()).toEqual([]);

    const satellite = new Simulation(configFor('zenith-3', entryState(200, 80, { altitude: 5_000, separatedStages: 3, relativeToAir: true })));
    expect(satellite.getVehicleState().parachute.phase).toBe('none');

    const onPad = new Simulation(configFor(frontier));
    onPad.deployParachute();
    expect(onPad.getVehicleState().parachute.phase).toBe('none');
  });

  it('开伞序列：减速伞 → 动压降低后主伞自动打开 → 以约 8 m/s 着陆', () => {
    const sim = fallingCapsule('frontier-1', 6_000);
    const before = sim.getVehicleState();
    expect(before.parachute.phase).toBe('stowed');
    // 自由下落的终端速度约 150 m/s
    expect(before.flight.airspeed).toBeGreaterThan(110);
    expect(before.flight.airspeed).toBeLessThan(200);
    sim.deployParachute();
    expect(sim.getVehicleState().parachute.phase).toBe('drogue');
    expect(sim.getVehicleState().attitudeMode).toBe('manual');

    const events: FlightEvent[] = [...sim.drainEvents()];
    let maxG = 0;
    let mainAt = 0;
    while (sim.flightPhase === 'flight' && sim.time < 3_000) {
      sim.step();
      events.push(...sim.drainEvents());
      maxG = Math.max(maxG, gLoadOf(sim));
      if (!mainAt && sim.getVehicleState().parachute.phase === 'main') mainAt = altitudeOf(sim);
    }
    expect(events.map((e) => e.kind)).toEqual(['drogue-deployed', 'main-deployed', 'landed']);
    expect(mainAt).toBeGreaterThan(3_000);
    // 开伞冲击：几个 g，远低于结构限值
    expect(maxG).toBeGreaterThan(1.5);
    expect(maxG).toBeLessThan(6);
    const outcome = sim.flightOutcome!;
    expect(outcome.kind).toBe('landed');
    // 终端速度 v = √(2mg / (ρ·C_d·A))：7.7 t、2000 m² 时约 7.8 m/s
    expect(Math.abs(outcome.verticalSpeed)).toBeGreaterThan(7);
    expect(Math.abs(outcome.verticalSpeed)).toBeLessThan(8.5);
    // 被伞绳拉正：舱顶朝上
    expect(outcome.tilt / DEG2RAD).toBeLessThan(10);
  });

  it('伞下的姿态不受操纵：舱顶指向来流的反方向', () => {
    const sim = fallingCapsule('frontier-1', 6_000);
    sim.deployParachute();
    sim.setAttitudeMode('prograde');
    sim.setAttitudeInput({ pitch: 1, yaw: 1, roll: 0 });
    run(sim, 40);
    const state = sim.getVehicleState();
    const airVelocity = sub(state.body.velocity, cross(OMEGA, state.body.position));
    const nose = rotate(state.body.attitude, vec3(1, 0, 0));
    expect(dot(nose, normalize(airVelocity))).toBeLessThan(-0.98);
  });

  it('超声速、高动压时开伞：伞被撕毁，返回舱以上百 m/s 撞击地面', () => {
    const { sim } = flyEntry(configFor(frontier, entryState(7_800, 1.5, capsuleOnly)), 'retrograde', null);
    // 重新飞一次，在 30 km（约马赫 2）处强行开伞
    const again = new Simulation(configFor(frontier, entryState(7_800, 1.5, capsuleOnly)));
    again.setAttitudeMode('retrograde');
    while (again.flightPhase === 'flight' && altitudeOf(again) > 30_000) again.step();
    expect(again.getVehicleState().flight.mach).toBeGreaterThan(1.2);
    again.drainEvents();
    again.deployParachute();
    expect(again.getVehicleState().parachute.phase).toBe('lost');
    expect(again.drainEvents().map((e) => e.kind)).toEqual(['parachute-failed']);
    // 不能再次开伞
    again.deployParachute();
    expect(again.getVehicleState().parachute.phase).toBe('lost');
    while (again.flightPhase === 'flight' && again.time < 3_000) again.step();

    for (const flight of [sim, again]) {
      const outcome = flight.flightOutcome!;
      expect(outcome.kind).toBe('destroyed');
      expect(outcome.cause).toBe('impact');
      // 减速不足：以终端速度（约 120 m/s）撞击
      expect(outcome.impactSpeed).toBeGreaterThan(90);
      expect(outcome.impactSpeed).toBeLessThan(160);
    }
  });

  it('在大气层外提前开伞：再入时伞衣被高超声速气流烧毁', () => {
    const sim = new Simulation(configFor(frontier, entryState(7_800, 1.5, capsuleOnly)));
    sim.setAttitudeMode('retrograde');
    sim.deployParachute();
    expect(sim.getVehicleState().parachute.phase).toBe('drogue');
    const events: FlightEvent[] = [];
    while (sim.flightPhase === 'flight' && sim.time < 3_000) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    // 真空中两级伞都会张开；进入大气后被高超声速气流烧毁（此时还在 100 km 以上）
    expect(events.map((e) => e.kind)).toEqual(['drogue-deployed', 'main-deployed', 'parachute-failed', 'destroyed']);
    expect(sim.getVehicleState().parachute.phase).toBe('lost');
    // 没有伞，返回舱不可能安全着陆
    expect(sim.flightOutcome?.kind).toBe('destroyed');
  });

  it('开伞后时间倍率不超过 10×', () => {
    const sim = fallingCapsule('frontier-1', 6_000);
    sim.deployParachute();
    run(sim, 30);
    expect(sim.maxTimeWarp).toBe(10);
  });

  it('开伞指令通过主机协议生效，并产生事件', () => {
    const events: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost((e) => events.push(e), () => now);
    host.handle({ type: 'init', config: configFor(frontier, entryState(150, 80, { altitude: 5_000, separatedStages: 2, relativeToAir: true })) });
    host.handle({ type: 'deployParachute' });
    for (let i = 0; i < 50; i++) {
      now += 4;
      host.tick();
    }
    const kinds = events.flatMap((e) => (e.type === 'flightEvents' ? e.events.map((x) => x.kind) : []));
    expect(kinds).toContain('drogue-deployed');
    const last = [...events].reverse().find((e) => e.type === 'snapshot');
    expect(last?.type === 'snapshot' && last.snapshot.vehicle.parachute.phase).toBe('drogue');
  });

  it('目录中每个返回舱的降落伞参数自洽：减速伞能把动压降到主伞开伞值以下，主伞落地速度在限值内', () => {
    for (const vehicle of VEHICLE_CATALOG) {
      const { payload } = vehicle;
      if (payload.kind !== 'capsule' || !payload.parachute) continue;
      const allSeparated = { ...initialConfiguration(vehicle), stages: vehicle.stages.map(() => ({ propellantMass: 0, attached: false })) };
      const chute = configurationParachute(vehicle, allSeparated)!;
      const limits = configurationLandingLimits(vehicle, allSeparated);
      const weight = (payload.dryMass + payload.propellantMass) * STANDARD_GRAVITY;
      const subsonicCapsuleArea = 0.62 * payload.aero.dragCoefficient * payload.aero.referenceArea;
      // 减速伞下的终端动压 q = mg / (C_d·A)
      expect(weight / (chute.drogueDragArea + subsonicCapsuleArea), vehicle.id).toBeLessThan(0.8 * chute.mainDeployDynamicPressure);
      // 自由下落的终端动压低于允许开伞的动压
      expect(weight / subsonicCapsuleArea, vehicle.id).toBeLessThan(chute.maxDeployDynamicPressure);
      // 主伞下的海平面终端速度
      const terminal = Math.sqrt((2 * weight) / (1.225 * (chute.mainDragArea + subsonicCapsuleArea)));
      expect(terminal, vehicle.id).toBeLessThan(0.9 * limits.verticalSpeed);
      expect(terminal, vehicle.id).toBeGreaterThan(5);
    }
  });
});

describe('时间倍率与气动加热', () => {
  it('高层大气中受热明显时（70 km 以上）倍率同样受限', () => {
    const sim = new Simulation(configFor(frontier, entryState(7_800, 1.5, capsuleOnly)));
    sim.setAttitudeMode('retrograde');
    expect(sim.maxTimeWarp).toBe(1000);
    while (sim.flightPhase === 'flight' && zone(sim, 'base').heatFlux < 30_000) sim.step();
    expect(altitudeOf(sim)).toBeGreaterThan(70_000);
    expect(sim.maxTimeWarp).toBe(10);
  });
});
