/**
 * 飞行的起始条件。
 *
 * 默认从发射台开始（见 Simulation 构造函数）。这里提供"从近地轨道开始"的初始状态：
 * 跳过上升段，直接练习轨道机动。它只是给出一组初始位置、速度、姿态与推进剂量，
 * 此后的运动与从发射台飞上来完全一样，由同一个模拟器计算。
 */
import { EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { greenwichMeanSiderealTime, julianDateForLocalSolarTime } from '../physics/ephemeris/time';
import { type Geodetic, ecefToEci, enuBasisAt, geodeticToEcef } from '../physics/frames/frames';
import { fromBasis } from '../physics/math/quat';
import { negate, scale } from '../physics/math/vec3';
import { circularSpeed } from '../physics/orbital/elements';
import { analyzeVehicle } from '../vehicles/analysis';
import type { VehicleDefinition } from '../vehicles/types';
import type { InitialFlightState, SimulationConfig } from './types';

/** "从轨道开始"的轨道高度 [m]。 */
export const ORBIT_START_ALTITUDE = 200_000;

/**
 * "从轨道开始"时假设上升段已经用掉的 Δv [m/s]：进入近地轨道的典型代价（含重力与阻力损失）。
 * 据此估算最后一级还剩多少推进剂。这是一个设定值，不是对某次具体上升的计算结果。
 */
export const ASCENT_DELTA_V_BUDGET = 9_400;

/** 该火箭能否"从轨道开始"：至少两级，且理想 Δv 足以入轨。 */
export const canStartInOrbit = (vehicle: VehicleDefinition): boolean =>
  vehicle.stages.length >= 2 && analyzeVehicle(vehicle).totalDeltaVVacuum > ASCENT_DELTA_V_BUDGET;

/**
 * "从轨道开始"的初始状态：发射场正上方 ORBIT_START_ALTITUDE 的圆轨道，向正东飞行
 * （因此倾角等于发射场纬度的绝对值），只保留最后一级与载荷，整流罩已抛，头部朝前。
 *
 * 最后一级的推进剂按"全箭理想 Δv − 上升段预算"由火箭方程反推，不超过满载量；
 * 载荷自带的推进剂保持满载。
 *
 * @param site 发射场地面点（弧度）
 * @param epochJulianDate 模拟历元（决定该时刻发射场在惯性系中的位置）
 */
export const orbitStartState = (vehicle: VehicleDefinition, site: Geodetic, epochJulianDate: number): InitialFlightState => {
  const overhead: Geodetic = { latitude: site.latitude, longitude: site.longitude, altitude: ORBIT_START_ALTITUDE };
  const position = ecefToEci(geodeticToEcef(overhead), greenwichMeanSiderealTime(epochJulianDate));
  const { east, north, up } = enuBasisAt(position);

  const performance = analyzeVehicle(vehicle);
  const last = vehicle.stages[vehicle.stages.length - 1] as VehicleDefinition['stages'][number];
  const { payload } = vehicle;
  const upperDry = last.dryMass + payload.dryMass + payload.propellantMass;
  const stageDeltaV = Math.max(0, performance.totalDeltaVVacuum - performance.payloadDeltaV - ASCENT_DELTA_V_BUDGET);
  const remaining = upperDry * (Math.exp(stageDeltaV / (STANDARD_GRAVITY * last.engine.ispVacuum)) - 1);

  return {
    position,
    velocity: scale(east, circularSpeed(EARTH.RADIUS + ORBIT_START_ALTITUDE)),
    // 头部（机体 +X）朝东即顺行；机体 −Z 朝天（导航球"上"为天）；机体 +Y 朝南（飞行方向的右侧）
    attitude: fromBasis(east, negate(north), negate(up)),
    separatedStages: vehicle.stages.length - 1,
    stagePropellant: vehicle.stages.map((stage, i) =>
      i === vehicle.stages.length - 1 ? Math.min(stage.propellantMass, remaining) : stage.propellantMass,
    ),
    fairingJettisoned: true,
  };
};

/** 默认发射日期与地方平太阳时：上午的侧向光照下火箭与地表最有层次。 */
export const DEFAULT_LAUNCH_DATE = { year: 2026, month: 4, day: 12 } as const;
export const DEFAULT_LOCAL_SOLAR_HOURS = 9.5;

/**
 * 一次飞行的模拟配置：飞行器、发射场，以及从发射台还是从近地轨道出发。
 * 历元取默认发射日期、发射场当地上午 9:30（地方平太阳时）。火箭无法入轨时"从轨道出发"退回到发射台。
 */
export const createFlightConfig = (vehicle: VehicleDefinition, site: Geodetic, start: 'pad' | 'orbit' = 'pad'): SimulationConfig => {
  const epochJulianDate = julianDateForLocalSolarTime(
    DEFAULT_LAUNCH_DATE.year,
    DEFAULT_LAUNCH_DATE.month,
    DEFAULT_LAUNCH_DATE.day,
    DEFAULT_LOCAL_SOLAR_HOURS,
    site.longitude,
  );
  return {
    vehicle,
    site,
    epochJulianDate,
    initialState: start === 'orbit' && canStartInOrbit(vehicle) ? orbitStartState(vehicle, site, epochJulianDate) : undefined,
  };
};
