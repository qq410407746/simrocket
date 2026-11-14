/**
 * 遥测量推导：把原始物理状态换算成仪表显示用的物理量（仍为 SI 单位）。
 * 纯函数，UI 层只做单位换算与格式化。
 */
import { EARTH, STANDARD_GRAVITY } from '../physics/constants';
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
import { angleBetween, dot, length } from '../physics/math/vec3';
import type { SimSnapshot, SimulationConfig } from '../simulation/types';
import { remainingDeltaV } from '../vehicles/configuration';
import type { FlightPhase } from '../vehicles/types';

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
}

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
  };
};
