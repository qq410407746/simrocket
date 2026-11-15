/**
 * 遥测量推导：把原始物理状态换算成仪表显示用的物理量（仍为 SI 单位）。
 * 纯函数，UI 层只做单位换算与格式化。
 */
import type { AttitudeMode } from '../physics/attitude/pointing';
import { EARTH, KARMAN_LINE_ALTITUDE, STANDARD_GRAVITY } from '../physics/constants';
import {
  airRelativeVelocityEci,
  altitudeOf,
  ecefToGeodetic,
  eciToEcef,
  enuBasisAt,
  geodeticToEcef,
  pointingAngles,
} from '../physics/frames/frames';
import { gravityMagnitude } from '../physics/gravity/pointMass';
import { type Vec3, angleBetween, dot, length } from '../physics/math/vec3';
import { type ConicKind, elementsFromState, timeToApoapsis, timeToPeriapsis } from '../physics/orbital/elements';
import type { SimSnapshot, SimulationConfig } from '../simulation/types';
import {
  canJettisonHeatShield,
  configurationLandingLimits,
  configurationParachute,
  configurationStructure,
  remainingDeltaV,
} from '../vehicles/configuration';
import type { FlightPhase, LandingLimits, ParachuteState, StructuralLimits, ThermalZoneTelemetry } from '../vehicles/types';

/**
 * 轨道的定性分类（按密切轨道的近地点高度）：
 *  - suborbital   近地点在地面以下：轨迹会撞上地面
 *  - atmospheric  近地点在地面与卡门线之间：会进入稠密大气，无法维持
 *  - orbit        近地点高于卡门线（100 km）。低于约 160 km 时阻力仍然明显，轨道会在数圈到数天内衰减
 *  - escape       抛物线或双曲线：不再返回
 */
export type OrbitClass = 'suborbital' | 'atmospheric' | 'orbit' | 'escape';

/** 当前状态对应的密切轨道（忽略推力与阻力时飞行器将沿之运动的二体轨道）。 */
export interface OrbitTelemetry {
  readonly kind: ConicKind;
  readonly classification: OrbitClass;
  /** 远地点高度 [m]；开放轨道为 Infinity。 */
  readonly apoapsisAltitude: number;
  /** 近地点高度 [m]（可为负：近地点在地面以下）。 */
  readonly periapsisAltitude: number;
  readonly eccentricity: number;
  /** 轨道倾角 [rad]。 */
  readonly inclination: number;
  /** 轨道周期 [s]；开放轨道为 Infinity。 */
  readonly period: number;
  /** 半长轴 [m]。 */
  readonly semiMajorAxis: number;
  /** 升交点赤经 Ω、近地点幅角 ω、真近点角 ν [rad]，范围 [0, 2π)。奇异情形的约定见 orbital/elements.ts。 */
  readonly raan: number;
  readonly argumentOfPeriapsis: number;
  readonly trueAnomaly: number;
  /** 到下一次远地点 / 近地点的时间 [s]；不存在时为 null。 */
  readonly timeToApoapsis: number | null;
  readonly timeToPeriapsis: number | null;
}

/** 由位置与速度（ECI）计算密切轨道的遥测量。 */
export const deriveOrbit = (position: Vec3, velocity: Vec3): OrbitTelemetry => {
  const el = elementsFromState(position, velocity);
  const periapsisAltitude = el.periapsisRadius - EARTH.RADIUS;
  const classification: OrbitClass =
    el.kind !== 'elliptic'
      ? 'escape'
      : periapsisAltitude < 0
        ? 'suborbital'
        : periapsisAltitude < KARMAN_LINE_ALTITUDE
          ? 'atmospheric'
          : 'orbit';
  return {
    kind: el.kind,
    classification,
    apoapsisAltitude: el.apoapsisRadius - EARTH.RADIUS,
    periapsisAltitude,
    eccentricity: el.eccentricity,
    inclination: el.inclination,
    period: el.period,
    semiMajorAxis: el.semiMajorAxis,
    raan: el.raan,
    argumentOfPeriapsis: el.argumentOfPeriapsis,
    trueAnomaly: el.trueAnomaly,
    timeToApoapsis: timeToApoapsis(el),
    timeToPeriapsis: timeToPeriapsis(el),
  };
};

export interface Telemetry {
  readonly simTime: number;
  /** 任务时间 [s]：自起飞起经过的时间；尚未起飞时为 null。 */
  readonly missionTime: number | null;
  readonly phase: FlightPhase;
  /** 质心海拔高度 [m]。 */
  readonly altitude: number;
  /** 惯性速度大小（轨道速度）[m/s]。 */
  readonly inertialSpeed: number;
  /** 相对地面（旋转地球）的速度大小 [m/s]。 */
  readonly surfaceSpeed: number;
  /** 垂直速度 [m/s]，向上为正。 */
  readonly verticalSpeed: number;
  /** 水平速度（相对地面）[m/s]。 */
  readonly horizontalSpeed: number;
  /** 纬度 [rad]。 */
  readonly latitude: number;
  /** 经度 [rad]。 */
  readonly longitude: number;
  /** 航程 [m]：发射场到星下点的地面大圆距离。 */
  readonly downrange: number;
  /** 当地引力加速度 [m/s²]。 */
  readonly localGravity: number;
  /** 过载 [g]：比力大小 / g₀。 */
  readonly gLoad: number;
  /** 俯仰角 [rad]。 */
  readonly pitch: number;
  /** 航向角 [rad]；箭体竖直时为 null。 */
  readonly heading: number | null;
  /** 总质量 [kg]。 */
  readonly mass: number;
  /** 各级推进剂剩余量 [kg]。 */
  readonly stagePropellant: readonly number[];
  /** 各级是否仍连接。 */
  readonly stageAttached: readonly boolean[];
  readonly payloadPropellant: number;
  readonly fairingAttached: boolean;
  readonly activeStageIndex: number;
  /** 节流指令 [0, 1]。 */
  readonly throttle: number;
  /** 发动机实际节流；未工作时为 0。 */
  readonly effectiveThrottle: number;
  readonly ignited: boolean;
  /** 当前总推力 [N]。 */
  readonly thrust: number;
  /** 当前推重比：推力 /（质量 × 当地引力加速度）。 */
  readonly thrustToWeight: number;
  /** 当前构型的剩余理想 Δv（真空）[m/s]。 */
  readonly remainingDeltaV: number;
  /** 动压 [Pa]。 */
  readonly dynamicPressure: number;
  /** 马赫数。 */
  readonly mach: number;
  /** 气动阻力 [N]。 */
  readonly drag: number;
  /** 迎角 [rad]。 */
  readonly angleOfAttack: number;
  /** 大气密度 [kg/m³]。 */
  readonly airDensity: number;
  /** 自动指向模式。 */
  readonly attitudeMode: AttitudeMode;
  /** 当前构型的配平迎角 [rad]；不能做配平再入（不是单独的返回舱、或质心没有横向偏移）时为 0。 */
  readonly trimAngle: number;
  /** 配平再入的倾侧角 [rad]，(−π, π]：0 为升力向上，正值向右。 */
  readonly bankAngle: number;
  /** 防热大底是否仍在，以及现在能否抛掉（只有单独飞行的返回舱可以）。 */
  readonly heatShieldAttached: boolean;
  readonly canJettisonHeatShield: boolean;
  /** 密切轨道；只在自由飞行中给出，其余阶段为 null。 */
  readonly orbit: OrbitTelemetry | null;
  /** 气动升力 [N] 与升阻比（没有阻力时为 0）。 */
  readonly lift: number;
  readonly liftToDrag: number;
  /** 横向气动载荷 q·sin α [Pa]。 */
  readonly bendingLoad: number;
  /** 参考驻点热流 [W/m²]（1 m 曲率半径、冷壁）：加热环境的强弱。 */
  readonly referenceHeatFlux: number;
  /** 三个热区（头部、侧壁、底部）的热状态。 */
  readonly thermal: readonly ThermalZoneTelemetry[];
  /** 最危险的热区（热裕度最小）在 thermal 中的下标。 */
  readonly criticalZone: number;
  /** 当前构型的结构强度限值（过载、动压、横向气动载荷）与可承受的接地条件。 */
  readonly structure: StructuralLimits;
  readonly landingLimits: LandingLimits;
  readonly parachute: ParachuteState;
  /** 当前构型带有降落伞时：允许开伞的最大动压 [Pa] 与最大马赫数；没有降落伞时为 null。 */
  readonly parachuteLimits: { readonly dynamicPressure: number; readonly mach: number } | null;
}

/** 最危险的热区：热裕度最小的那个；裕度相同时取对流热流最大的。 */
export const criticalZoneIndex = (zones: readonly ThermalZoneTelemetry[]): number => {
  let best = 0;
  zones.forEach((zone, i) => {
    const current = zones[best];
    if (!current) return;
    if (zone.margin < current.margin - 1e-9 || (Math.abs(zone.margin - current.margin) <= 1e-9 && zone.heatFlux > current.heatFlux)) best = i;
  });
  return best;
};

export const deriveTelemetry = (snapshot: SimSnapshot, config: SimulationConfig): Telemetry => {
  const { vehicle } = snapshot;
  const { position, velocity, attitude } = vehicle.body;
  const radius = length(position);
  const surfaceVelocity = airRelativeVelocityEci(position, velocity);
  const { up } = enuBasisAt(position);
  const verticalSpeed = dot(surfaceVelocity, up);
  const surfaceSpeed = length(surfaceVelocity);
  const positionEcef = eciToEcef(position, snapshot.earthRotationAngle);
  const geodetic = ecefToGeodetic(positionEcef);
  const angles = pointingAngles(attitude, position);
  const localGravity = gravityMagnitude(radius);
  const chute = configurationParachute(config.vehicle, vehicle);

  return {
    simTime: snapshot.simTime,
    missionTime: snapshot.liftoffTime === null ? null : snapshot.simTime - snapshot.liftoffTime,
    phase: vehicle.phase,
    altitude: altitudeOf(position),
    inertialSpeed: length(velocity),
    surfaceSpeed,
    verticalSpeed,
    horizontalSpeed: Math.sqrt(Math.max(0, surfaceSpeed * surfaceSpeed - verticalSpeed * verticalSpeed)),
    latitude: geodetic.latitude,
    longitude: geodetic.longitude,
    downrange: EARTH.RADIUS * angleBetween(positionEcef, geodeticToEcef(config.site)),
    localGravity,
    gLoad: length(vehicle.specificForce) / STANDARD_GRAVITY,
    pitch: angles.pitch,
    heading: angles.heading,
    mass: vehicle.mass,
    stagePropellant: vehicle.stages.map((s) => s.propellantMass),
    stageAttached: vehicle.stages.map((s) => s.attached),
    payloadPropellant: vehicle.payloadPropellantMass,
    fairingAttached: vehicle.fairingAttached,
    activeStageIndex: vehicle.activeStageIndex,
    throttle: vehicle.throttle,
    effectiveThrottle: vehicle.flight.effectiveThrottle,
    ignited: vehicle.ignited,
    thrust: vehicle.flight.thrust,
    thrustToWeight: vehicle.flight.thrust / (vehicle.mass * localGravity),
    remainingDeltaV: remainingDeltaV(config.vehicle, vehicle),
    dynamicPressure: vehicle.flight.dynamicPressure,
    mach: vehicle.flight.mach,
    drag: vehicle.flight.drag,
    angleOfAttack: vehicle.flight.angleOfAttack,
    airDensity: vehicle.flight.airDensity,
    attitudeMode: vehicle.attitudeMode,
    trimAngle: vehicle.trimAngle,
    bankAngle: vehicle.bankAngle,
    heatShieldAttached: vehicle.heatShieldAttached,
    canJettisonHeatShield: vehicle.phase === 'flight' && canJettisonHeatShield(config.vehicle, vehicle),
    orbit: vehicle.phase === 'flight' ? deriveOrbit(position, velocity) : null,
    lift: vehicle.flight.lift,
    liftToDrag: vehicle.flight.drag > 1e-6 ? vehicle.flight.lift / vehicle.flight.drag : 0,
    bendingLoad: vehicle.flight.bendingLoad,
    referenceHeatFlux: vehicle.flight.referenceHeatFlux,
    thermal: vehicle.thermal,
    criticalZone: criticalZoneIndex(vehicle.thermal),
    structure: configurationStructure(config.vehicle, vehicle),
    landingLimits: configurationLandingLimits(config.vehicle, vehicle),
    parachute: vehicle.parachute,
    parachuteLimits: chute ? { dynamicPressure: chute.maxDeployDynamicPressure, mach: chute.maxDeployMach } : null,
  };
};
