/**
 * 模拟器：持有并推进权威物理状态。
 *
 * 阶段一范围（如实说明）：
 *  - 只实现"发射台待命"（prelaunch）状态：飞行器被牵制释放机构固定在发射台上，
 *    随地球自转做匀速圆周运动。这是一个精确的运动学约束，其位置、速度、姿态、
 *    比力都按解析式计算，不是占位数据。
 *  - 自由飞行动力学（推力、阻力、RK4 积分、分级）将在阶段二接入同一个 step() 接口。
 */
import { EARTH } from '../physics/constants';
import { greenwichMeanSiderealTime } from '../physics/ephemeris/time';
import {
  EARTH_ANGULAR_VELOCITY,
  type Geodetic,
  earthRotationAngle,
  ecefToEci,
  frameToBody,
  geodeticToEcef,
  verticalLaunchAttitude,
} from '../physics/frames/frames';
import { gravityAcceleration } from '../physics/gravity/pointMass';
import { isFiniteQuat } from '../physics/math/quat';
import { cross, isFiniteVec3, sub } from '../physics/math/vec3';
import { computeMassProperties } from '../vehicles/analysis';
import type { StageState, VehicleDefinition, VehicleState } from '../vehicles/types';
import { PHYSICS_DT, type SimulationConfig } from './types';

/** 状态有效性检查：任何 NaN / Infinity 都视为无效，不得传给渲染层。 */
export const isValidVehicleState = (s: VehicleState): boolean =>
  isFiniteVec3(s.body.position) &&
  isFiniteVec3(s.body.velocity) &&
  isFiniteQuat(s.body.attitude) &&
  isFiniteVec3(s.body.angularVelocity) &&
  isFiniteVec3(s.specificForce) &&
  Number.isFinite(s.mass) &&
  s.mass > 0 &&
  Number.isFinite(s.centerOfMassHeight) &&
  Number.isFinite(s.throttle) &&
  s.stages.every((st) => Number.isFinite(st.propellantMass) && st.propellantMass >= 0);

export class Simulation {
  readonly dt: number;
  readonly vehicle: VehicleDefinition;
  readonly site: Geodetic;
  readonly epochJulianDate: number;
  /** 历元时刻的地球自转角 [rad]。 */
  readonly earthAngleAtEpoch: number;

  private stepCount = 0;
  private readonly stages: StageState[];
  private readonly payloadPropellantMass: number;
  private readonly fairingAttached: boolean;
  /** prelaunch 状态是时间的解析函数，按需求值并缓存。 */
  private cached: { step: number; state: VehicleState } | null = null;

  constructor(config: SimulationConfig, dt: number = PHYSICS_DT) {
    if (!(dt > 0)) throw new Error(`Simulation: dt 必须为正数，收到 ${dt}`);
    if (!Number.isFinite(config.epochJulianDate)) throw new Error('Simulation: 历元儒略日无效');
    if (config.vehicle.stages.length === 0) throw new Error('Simulation: 飞行器至少需要一个推进级');

    this.dt = dt;
    this.vehicle = config.vehicle;
    this.site = config.site;
    this.epochJulianDate = config.epochJulianDate;
    this.earthAngleAtEpoch = greenwichMeanSiderealTime(config.epochJulianDate);

    this.stages = config.vehicle.stages.map((s) => ({ propellantMass: s.propellantMass, attached: true }));
    this.payloadPropellantMass = config.vehicle.payload.propellantMass;
    this.fairingAttached = config.vehicle.payload.kind === 'satellite';
  }

  /**
   * 模拟时间 [s]。由整数步数乘以步长得到，避免浮点累加漂移。
   */
  get time(): number {
    return this.stepCount * this.dt;
  }

  get earthRotationAngle(): number {
    return earthRotationAngle(this.earthAngleAtEpoch, this.time);
  }

  /** 推进一个固定物理步。 */
  step(): void {
    this.stepCount += 1;
  }

  /** 当前飞行器状态。 */
  getVehicleState(): VehicleState {
    if (this.cached?.step !== this.stepCount) {
      this.cached = { step: this.stepCount, state: this.computePrelaunchState() };
    }
    return this.cached.state;
  }

  /**
   * 发射台待命状态（解析解）。
   *
   *   r(t) = Rz(θ(t)) · r_ecef            质心位置：地固点随地球自转
   *   v(t) = ω × r(t)                     与地面共转的惯性速度
   *   姿态：机体 +X 指天、+Y 指东、+Z 指北
   *   角速度：与地球相同，ω = (0, 0, ω_E)，转换到机体系
   *   比力 f = a − g = ω × (ω × r) − g(r)   向心加速度减去引力加速度（即支撑力/质量）
   */
  private computePrelaunchState(): VehicleState {
    const { mass, centerOfMassHeight } = computeMassProperties(this.vehicle, {
      stagePropellant: this.stages.map((s) => s.propellantMass),
      stageAttached: this.stages.map((s) => s.attached),
      payloadPropellant: this.payloadPropellantMass,
      fairingAttached: this.fairingAttached,
    });

    // 飞行器底端坐落在发射台面（地面）上，质心在其上方 centerOfMassHeight 处。
    const comEcef = geodeticToEcef({ ...this.site, altitude: this.site.altitude + centerOfMassHeight });
    const position = ecefToEci(comEcef, this.earthRotationAngle);
    const velocity = cross(EARTH_ANGULAR_VELOCITY, position);
    const attitude = verticalLaunchAttitude(position);
    const centripetal = cross(EARTH_ANGULAR_VELOCITY, velocity);
    const specificForce = sub(centripetal, gravityAcceleration(position, EARTH.MU));

    return {
      body: {
        position,
        velocity,
        attitude,
        angularVelocity: frameToBody(attitude, EARTH_ANGULAR_VELOCITY),
      },
      stages: this.stages.map((s) => ({ ...s })),
      payloadPropellantMass: this.payloadPropellantMass,
      fairingAttached: this.fairingAttached,
      activeStageIndex: 0,
      throttle: 0,
      enginesOn: false,
      phase: 'prelaunch',
      mass,
      centerOfMassHeight,
      specificForce,
    };
  }
}
