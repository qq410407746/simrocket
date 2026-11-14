/**
 * 遥测量推导：把原始物理状态换算成仪表显示用的物理量（仍为 SI 单位）。
 * 纯函数，UI 层只做单位换算与格式化。
 */
import { STANDARD_GRAVITY } from '../physics/constants';
import {
  airRelativeVelocityEci,
  altitudeOf,
  ecefToGeodetic,
  eciToEcef,
  enuBasisAt,
  pointingAngles,
} from '../physics/frames/frames';
import { gravityMagnitude } from '../physics/gravity/pointMass';
import { dot, length } from '../physics/math/vec3';
import type { SimSnapshot } from '../simulation/types';
import type { FlightPhase } from '../vehicles/types';

export interface Telemetry {
  readonly simTime: number;
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
  readonly payloadPropellant: number;
  readonly activeStageIndex: number;
  readonly throttle: number;
  readonly enginesOn: boolean;
}

export const deriveTelemetry = (snapshot: SimSnapshot): Telemetry => {
  const { vehicle } = snapshot;
  const { position, velocity, attitude } = vehicle.body;
  const radius = length(position);
  const surfaceVelocity = airRelativeVelocityEci(position, velocity);
  const { up } = enuBasisAt(position);
  const verticalSpeed = dot(surfaceVelocity, up);
  const surfaceSpeed = length(surfaceVelocity);
  const geodetic = ecefToGeodetic(eciToEcef(position, snapshot.earthRotationAngle));
  const angles = pointingAngles(attitude, position);

  return {
    simTime: snapshot.simTime,
    phase: vehicle.phase,
    altitude: altitudeOf(position),
    inertialSpeed: length(velocity),
    surfaceSpeed,
    verticalSpeed,
    horizontalSpeed: Math.sqrt(Math.max(0, surfaceSpeed * surfaceSpeed - verticalSpeed * verticalSpeed)),
    latitude: geodetic.latitude,
    longitude: geodetic.longitude,
    localGravity: gravityMagnitude(radius),
    gLoad: length(vehicle.specificForce) / STANDARD_GRAVITY,
    pitch: angles.pitch,
    heading: angles.heading,
    mass: vehicle.mass,
    stagePropellant: vehicle.stages.map((s) => s.propellantMass),
    payloadPropellant: vehicle.payloadPropellantMass,
    activeStageIndex: vehicle.activeStageIndex,
    throttle: vehicle.throttle,
    enginesOn: vehicle.enginesOn,
  };
};
