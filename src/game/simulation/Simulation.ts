/**
 * 模拟器：持有并推进权威物理状态。
 *
 * 飞行阶段：
 *  - prelaunch  飞行器被牵制机构固定在发射台上，随地球自转（解析解）。点火后发动机消耗推进剂；
 *               当推力超过保持静止所需的支撑力时释放，进入自由飞行。
 *  - flight     自由飞行。平动：引力 + 推力 + 气动阻力，RK4 固定步长积分。
 *               姿态：角速度指令的一阶响应（简化模型，见 physics/attitude）。
 *  - landed / destroyed  接地后固定在地固系中，飞行结束。
 *
 * 一个物理步内会被精确处理的事件（不会因步长或时间倍率而错过）：
 *  - 推进剂耗尽：把该步拆成"有动力段 + 无动力段"；
 *  - 接地：对步内时间做二分，定位接地瞬间并记录当时的速度与姿态。
 *
 * 尚未建模（如实说明）：升力与气动力矩、结构与热失效、降落伞、发动机启动/关机瞬态、
 * 推进剂晃动与沉底、分离体之间的碰撞。
 */
import { type AeroProperties, CROSS_FLOW_DRAG_COEFFICIENT, dragArea, dynamicPressure } from '../physics/aerodynamics/drag';
import { type AtmosphereSample, sampleAtmosphere } from '../physics/atmosphere/standardAtmosphere';
import {
  type AttitudeControlParams,
  type AttitudeInput,
  NO_ATTITUDE_INPUT,
  commandedBodyRate,
  integrateAttitude,
  respondBodyRate,
  sanitizeAttitudeInput,
} from '../physics/attitude/attitude';
import {
  type AttitudeMode,
  isAttitudeMode,
  pointingDirection,
  steeringRateCommand,
  targetAngularVelocity,
} from '../physics/attitude/pointing';
import { DEG2RAD, EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { greenwichMeanSiderealTime } from '../physics/ephemeris/time';
import {
  EARTH_ANGULAR_VELOCITY,
  type Geodetic,
  earthRotationAngle,
  ecefToEci,
  ecefToGeodetic,
  eciToEcef,
  frameToBody,
  geodeticToEcef,
  verticalLaunchAttitude,
} from '../physics/frames/frames';
import { gravityAcceleration } from '../physics/gravity/pointMass';
import { type AccelerationFn, type MutableVec3, Rk4Integrator } from '../physics/integration/rk4';
import { type Quat, fromAxisAngle, isFiniteQuat, multiply, rotate } from '../physics/math/quat';
import { type Vec3, UNIT_Z, addScaled, cross, dot, isFiniteVec3, length, normalize, sub, vec3 } from '../physics/math/vec3';
import { elementsFromState } from '../physics/orbital/elements';
import { engineMassFlow, engineThrust } from '../physics/propulsion/engine';
import type { RigidBodyState } from '../physics/state/types';
import {
  type ActivePropulsion,
  activePropulsion,
  configurationAero,
  configurationMassProperties,
  initialConfiguration,
  lowestAttachedStage,
  stackHeight,
  stageAloneMassProperties,
} from '../vehicles/configuration';
import type { FlightDiagnostics, FlightPhase, VehicleDefinition, VehicleState } from '../vehicles/types';
import {
  type DebrisState,
  type FlightEvent,
  type FlightEventKind,
  type FlightOutcome,
  type FlightStats,
  type InitialFlightState,
  PHYSICS_DT,
  PREDICTION_PERIAPSIS_LIMIT,
  type PredictedImpact,
  type SimulationConfig,
  type TimeWarp,
  type TrajectoryPrediction,
} from './types';

/** 简化姿态控制的参数。 */
export const ATTITUDE_CONTROL: AttitudeControlParams = {
  maxPitchYawRate: 8 * DEG2RAD,
  maxRollRate: 15 * DEG2RAD,
  timeConstant: 0.45,
};

/** 级间分离机构给出的相对分离速度 [m/s]。 */
const STAGE_SEPARATION_SPEED = 1.5;
/** 整流罩半罩的横向分离速度 [m/s]。 */
const FAIRING_SEPARATION_SPEED = 3;
/** 同时跟踪的分离体数量上限与最长跟踪时间 [s]。 */
const MAX_DEBRIS = 8;
const DEBRIS_LIFETIME = 1800;

/** 可承受的接地条件（没有起落架与降落伞，容限很小）。 */
export const LANDING_LIMITS = {
  /** 最大垂直速度 [m/s]。 */
  verticalSpeed: 4,
  /** 最大水平速度 [m/s]。 */
  horizontalSpeed: 2,
  /** 箭体纵轴偏离竖直方向的最大角度 [rad]。 */
  tilt: 15 * DEG2RAD,
} as const;

/** 低于地面超过该值 [m] 才判定为接地，避免起飞瞬间的浮点误差误触发。 */
const CONTACT_TOLERANCE = 1e-3;
/** 接地时刻二分的迭代次数：把 0.02 s 的步长细分到约 10⁻⁹ s。 */
const CONTACT_BISECTIONS = 24;

/** 轨迹预测：最长预测时段 [s]、最多积分步数、输出的最多采样点数。 */
const PREDICTION_MAX_HORIZON = 12 * 3600;
const PREDICTION_MAX_STEPS = 8000;
const PREDICTION_MAX_POINTS = 400;

/** 时间倍率限制 —— 发动机工作或有操纵输入时、稠密大气内。 */
const WARP_LIMIT_POWERED: TimeWarp = 5;
const WARP_LIMIT_ATMOSPHERE: TimeWarp = 10;
const WARP_LIMIT_NONE: TimeWarp = 1000;
/** 低于该高度 [m] 视为处于稠密大气内。 */
const ATMOSPHERE_WARP_ALTITUDE = 70_000;

const BODY_X = vec3(1, 0, 0);
const BODY_Y = vec3(0, 1, 0);
const OMEGA = EARTH.ROTATION_RATE;

const ZERO_DIAGNOSTICS: FlightDiagnostics = Object.freeze({
  thrust: 0,
  effectiveThrottle: 0,
  massFlow: 0,
  ambientPressure: 0,
  airDensity: 0,
  airspeed: 0,
  mach: 0,
  dynamicPressure: 0,
  drag: 0,
  angleOfAttack: 0,
});

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

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
  Number.isFinite(s.payloadPropellantMass) &&
  s.stages.every((st) => Number.isFinite(st.propellantMass) && st.propellantMass >= 0) &&
  Object.values(s.flight).every((x) => Number.isFinite(x));

/**
 * 把轨迹采样点抽稀到不超过 maxPoints 个（保留首尾）。
 * 采样点在大气内较密、大气外较疏，等间隔抽取即可保持这种疏密关系。
 */
const decimateTrajectory = (
  times: readonly number[],
  points: readonly number[],
  maxPoints: number,
): { times: number[]; points: number[] } => {
  const count = times.length;
  if (count <= maxPoints) return { times: [...times], points: [...points] };
  const outTimes: number[] = [];
  const outPoints: number[] = [];
  for (let k = 0; k < maxPoints; k++) {
    const i = Math.round((k * (count - 1)) / (maxPoints - 1));
    outTimes.push(times[i] as number);
    outPoints.push(points[i * 3] as number, points[i * 3 + 1] as number, points[i * 3 + 2] as number);
  }
  return { times: outTimes, points: outPoints };
};

/**
 * 飞行器受力模型：给定位置与速度，计算引力加速度、推力与气动阻力。
 * 字段是"当前积分段"的参数，由 Simulation 在每段开始前设置。
 * 使用标量运算并复用对象——它被 RK4 每步调用四次。
 */
class VehicleForceModel {
  /** 当前节流下的真空总推力 τ·F_vac·N [N]；发动机不工作时为 0。 */
  thrustVacuum = 0;
  /** 喷管出口总面积 [m²]。 */
  exitArea = 0;
  /** 质量流量 [kg/s]。 */
  massFlow = 0;
  /** 本段起始时刻与起始质量。 */
  t0 = 0;
  mass0 = 1;
  /** 箭体纵轴（推力方向），ECI。 */
  noseX = 1;
  noseY = 0;
  noseZ = 0;
  aero: AeroProperties = { referenceArea: 1, baseDragCoefficient: 0.3, shape: 'slender', lateralArea: 1 };
  /**
   * 非 'manual' 时，纵轴不取上面的固定方向，而是按该指向模式由 (r, v) 即时计算。
   * 只有轨迹预测使用：预测跨越很长的时间，期间自动指向会让箭体一直跟随参考方向。
   * 真实飞行的每一步里姿态由姿态模型给出，这里保持 'manual'。
   */
  pointing: AttitudeMode = 'manual';

  // —— 最近一次 evaluate 的结果 ——
  gx = 0;
  gy = 0;
  gz = 0;
  thrust = 0;
  dragX = 0;
  dragY = 0;
  dragZ = 0;
  airspeed = 0;
  mach = 0;
  cosAlpha = 1;
  readonly atmosphere: AtmosphereSample = { density: 0, pressure: 0, temperature: 0, speedOfSound: 1 };

  evaluate(r: Readonly<MutableVec3>, v: Readonly<MutableVec3>): void {
    const radius = Math.hypot(r.x, r.y, r.z);
    const k = -EARTH.MU / (radius * radius * radius);
    this.gx = r.x * k;
    this.gy = r.y * k;
    this.gz = r.z * k;

    const atm = sampleAtmosphere(radius - EARTH.RADIUS, this.atmosphere);

    // 相对（随地球共转的）大气的速度：v − ω × r，ω = (0, 0, ω_E)
    const vx = v.x + OMEGA * r.y;
    const vy = v.y - OMEGA * r.x;
    const vz = v.z;
    const speed = Math.hypot(vx, vy, vz);
    this.airspeed = speed;
    this.mach = speed / atm.speedOfSound;
    if (atm.density > 0 && speed > 1e-9) {
      if (this.pointing !== 'manual') {
        const target = pointingDirection(this.pointing, r, v);
        if (target) {
          this.noseX = target.x;
          this.noseY = target.y;
          this.noseZ = target.z;
        }
      }
      const cosAlpha = (vx * this.noseX + vy * this.noseY + vz * this.noseZ) / speed;
      this.cosAlpha = cosAlpha;
      // F_d = −½·ρ·|v|·(C_d·A)·v
      const c = -0.5 * atm.density * speed * dragArea(this.aero, this.mach, cosAlpha);
      this.dragX = c * vx;
      this.dragY = c * vy;
      this.dragZ = c * vz;
    } else {
      this.cosAlpha = 1;
      this.dragX = 0;
      this.dragY = 0;
      this.dragZ = 0;
    }

    // F = τ·F_vac − p_a·A_e（不小于 0）
    this.thrust = this.thrustVacuum > 0 ? Math.max(0, this.thrustVacuum - atm.pressure * this.exitArea) : 0;
  }

  readonly acceleration: AccelerationFn = (t, r, v, out) => {
    this.evaluate(r, v);
    const mass = this.mass0 - this.massFlow * (t - this.t0);
    out.x = this.gx + (this.thrust * this.noseX + this.dragX) / mass;
    out.y = this.gy + (this.thrust * this.noseY + this.dragY) / mass;
    out.z = this.gz + (this.thrust * this.noseZ + this.dragZ) / mass;
  };
}

/** 分离体受力模型：引力 + 阻力（常数有效阻力面积，相当于对翻滚姿态取平均）。 */
class BallisticForceModel {
  dragArea = 1;
  mass = 1;
  private readonly atmosphere: AtmosphereSample = { density: 0, pressure: 0, temperature: 0, speedOfSound: 1 };

  readonly acceleration: AccelerationFn = (_t, r, v, out) => {
    const radius = Math.hypot(r.x, r.y, r.z);
    const k = -EARTH.MU / (radius * radius * radius);
    const atm = sampleAtmosphere(radius - EARTH.RADIUS, this.atmosphere);
    const vx = v.x + OMEGA * r.y;
    const vy = v.y - OMEGA * r.x;
    const vz = v.z;
    const c = (-0.5 * atm.density * Math.hypot(vx, vy, vz) * this.dragArea) / this.mass;
    out.x = r.x * k + c * vx;
    out.y = r.y * k + c * vy;
    out.z = r.z * k + c * vz;
  };
}

interface DebrisBody {
  readonly id: number;
  readonly kind: 'stage' | 'fairing';
  readonly stageIndex: number;
  readonly half: -1 | 0 | 1;
  readonly r: MutableVec3;
  readonly v: MutableVec3;
  attitude: Quat;
  /** 机体系角速度（常数：分离后缓慢翻滚）[rad/s]。 */
  readonly angularVelocity: Vec3;
  readonly mass: number;
  readonly propellantMass: number;
  readonly dragArea: number;
  readonly createdAt: number;
}

interface MutableStats {
  maxAltitude: number;
  maxSurfaceSpeed: number;
  maxInertialSpeed: number;
  maxGLoad: number;
  maxDynamicPressure: number;
}

interface MutableStage {
  propellantMass: number;
  attached: boolean;
}

export class Simulation {
  readonly dt: number;
  readonly vehicle: VehicleDefinition;
  readonly site: Geodetic;
  readonly epochJulianDate: number;
  /** 历元时刻的地球自转角 [rad]。 */
  readonly earthAngleAtEpoch: number;

  private stepCount = 0;
  private phase: FlightPhase = 'prelaunch';

  // —— 构型（结构上满足 ConfigurationState，可直接传给构型相关的纯函数）——
  private readonly cfg: { stages: MutableStage[]; payloadPropellantMass: number; fairingAttached: boolean };
  /** 由构型导出的量（构型或推进剂变化后刷新）。 */
  private mass = 1;
  private centerOfMassHeight = 0;
  private height = 1;

  // —— 控制 ——
  private throttle = 1;
  private ignited = false;
  private attitudeInput: AttitudeInput = NO_ATTITUDE_INPUT;
  private attitudeMode: AttitudeMode = 'manual';
  /** 上一步的自动指向目标，用于估计目标方向的转动角速度（前馈）。 */
  private lastPointing: { readonly mode: AttitudeMode; readonly direction: Vec3 } | null = null;

  // —— 自由飞行状态（ECI）——
  private readonly r: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly v: MutableVec3 = { x: 0, y: 0, z: 0 };
  private attitude: Quat = { x: 0, y: 0, z: 0, w: 1 };
  /** 机体系角速度 [rad/s]。 */
  private omega: Vec3 = vec3(0, 0, 0);

  /** 接地后的位姿（地固系）。 */
  private groundPose: { readonly positionEcef: Vec3; readonly attitudeEcef: Quat } | null = null;

  private liftoffTime: number | null = null;
  private outcome: FlightOutcome | null = null;
  private diagnostics: FlightDiagnostics = ZERO_DIAGNOSTICS;
  private specificForce: Vec3 = vec3(0, 0, 0);
  private readonly stats: MutableStats = {
    maxAltitude: 0,
    maxSurfaceSpeed: 0,
    maxInertialSpeed: 0,
    maxGLoad: 0,
    maxDynamicPressure: 0,
  };

  private debris: DebrisBody[] = [];
  private nextDebrisId = 1;
  private events: FlightEvent[] = [];

  private readonly rk4 = new Rk4Integrator();
  private readonly forces = new VehicleForceModel();
  /** 轨迹预测专用的受力模型与积分器：与真实状态的推进完全隔离。 */
  private readonly predictionForces = new VehicleForceModel();
  private readonly predictionRk4 = new Rk4Integrator();
  private readonly ballistic = new BallisticForceModel();
  private readonly r0: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly v0: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly padAtmosphere: AtmosphereSample = { density: 0, pressure: 0, temperature: 0, speedOfSound: 1 };

  constructor(config: SimulationConfig, dt: number = PHYSICS_DT) {
    if (!(dt > 0)) throw new Error(`Simulation: dt 必须为正数，收到 ${dt}`);
    if (!Number.isFinite(config.epochJulianDate)) throw new Error('Simulation: 历元儒略日无效');
    if (config.vehicle.stages.length === 0) throw new Error('Simulation: 飞行器至少需要一个推进级');

    this.dt = dt;
    this.vehicle = config.vehicle;
    this.site = config.site;
    this.epochJulianDate = config.epochJulianDate;
    this.earthAngleAtEpoch = greenwichMeanSiderealTime(config.epochJulianDate);

    const initial = initialConfiguration(config.vehicle);
    this.cfg = {
      stages: initial.stages.map((s) => ({ ...s })),
      payloadPropellantMass: initial.payloadPropellantMass,
      fairingAttached: initial.fairingAttached,
    };
    this.refreshConfiguration();
    this.updatePadDiagnostics(0, 0, 0);
    if (config.initialState) this.startInFlight(config.initialState);
  }

  /** 跳过发射台，直接以给定状态进入自由飞行（发动机关闭，节流指令为 0）。 */
  private startInFlight(initial: InitialFlightState): void {
    if (!isFiniteVec3(initial.position) || !isFiniteVec3(initial.velocity)) {
      throw new Error('Simulation: 初始飞行状态含无效数值');
    }
    if (length(initial.position) < EARTH.RADIUS) throw new Error('Simulation: 初始位置位于地面以下');
    const separated = Math.max(0, Math.min(this.cfg.stages.length, Math.floor(initial.separatedStages ?? 0)));
    this.cfg.stages.forEach((stage, i) => {
      if (i < separated) stage.attached = false;
      const override = initial.stagePropellant?.[i];
      const capacity = this.vehicle.stages[i]?.propellantMass ?? 0;
      if (override !== undefined && Number.isFinite(override)) stage.propellantMass = Math.max(0, Math.min(capacity, override));
    });
    if (initial.fairingJettisoned) this.cfg.fairingAttached = false;
    this.refreshConfiguration();

    this.r.x = initial.position.x;
    this.r.y = initial.position.y;
    this.r.z = initial.position.z;
    this.v.x = initial.velocity.x;
    this.v.y = initial.velocity.y;
    this.v.z = initial.velocity.z;
    this.attitude = initial.attitude ?? verticalLaunchAttitude(initial.position);
    this.omega = vec3(0, 0, 0);
    this.throttle = 0;
    this.phase = 'flight';
    this.liftoffTime = 0;
    this.forces.thrustVacuum = 0;
    this.forces.massFlow = 0;
    const nose = rotate(this.attitude, BODY_X);
    this.forces.noseX = nose.x;
    this.forces.noseY = nose.y;
    this.forces.noseZ = nose.z;
    this.forces.evaluate(this.r, this.v);
    this.specificForce = vec3(this.forces.dragX / this.mass, this.forces.dragY / this.mass, this.forces.dragZ / this.mass);
  }

  // ───────────────────────────── 只读访问 ─────────────────────────────

  /** 模拟时间 [s]。由整数步数乘以步长得到，避免浮点累加漂移。 */
  get time(): number {
    return this.stepCount * this.dt;
  }

  get earthRotationAngle(): number {
    return earthRotationAngle(this.earthAngleAtEpoch, this.time);
  }

  get flightPhase(): FlightPhase {
    return this.phase;
  }

  get liftoffAt(): number | null {
    return this.liftoffTime;
  }

  get flightOutcome(): FlightOutcome | null {
    return this.outcome;
  }

  get flightStats(): FlightStats {
    return { ...this.stats };
  }

  /**
   * 当前物理状态允许的最大时间倍率。
   * 步长固定，倍率不影响积分精度；限制的目的是保证玩家来得及操作、关键过程不被一闪而过。
   */
  get maxTimeWarp(): TimeWarp {
    const steering = this.attitudeInput.pitch !== 0 || this.attitudeInput.yaw !== 0 || this.attitudeInput.roll !== 0;
    if (this.phase === 'prelaunch') return this.ignited && this.throttle > 0 ? WARP_LIMIT_POWERED : WARP_LIMIT_NONE;
    if (this.phase !== 'flight') return WARP_LIMIT_NONE;
    if (this.diagnostics.thrust > 0 || steering) return WARP_LIMIT_POWERED;
    const altitude = Math.hypot(this.r.x, this.r.y, this.r.z) - EARTH.RADIUS;
    return altitude < ATMOSPHERE_WARP_ALTITUDE ? WARP_LIMIT_ATMOSPHERE : WARP_LIMIT_NONE;
  }

  /** 取出并清空自上次调用以来发生的事件。 */
  drainEvents(): FlightEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  getDebris(): DebrisState[] {
    return this.debris.map((d) => ({
      id: d.id,
      kind: d.kind,
      stageIndex: d.stageIndex,
      half: d.half,
      position: vec3(d.r.x, d.r.y, d.r.z),
      velocity: vec3(d.v.x, d.v.y, d.v.z),
      attitude: d.attitude,
      propellantMass: d.propellantMass,
    }));
  }

  /** 当前飞行器状态（不可变副本）。 */
  getVehicleState(): VehicleState {
    let body: RigidBodyState;
    let specificForce: Vec3;
    if (this.phase === 'flight') {
      body = {
        position: vec3(this.r.x, this.r.y, this.r.z),
        velocity: vec3(this.v.x, this.v.y, this.v.z),
        attitude: this.attitude,
        angularVelocity: this.omega,
      };
      specificForce = this.specificForce;
    } else {
      body = this.phase === 'prelaunch' ? this.padPose(this.time) : this.groundFixedPose(this.time);
      // 静止在地面上：比力 = 向心加速度 − 引力加速度（即支撑力 / 质量）
      specificForce = sub(cross(EARTH_ANGULAR_VELOCITY, body.velocity), gravityAcceleration(body.position));
    }
    return {
      body,
      stages: this.cfg.stages.map((s) => ({ ...s })),
      payloadPropellantMass: this.cfg.payloadPropellantMass,
      fairingAttached: this.cfg.fairingAttached,
      activeStageIndex: lowestAttachedStage(this.cfg),
      throttle: this.throttle,
      ignited: this.ignited,
      attitudeInput: this.attitudeInput,
      attitudeMode: this.attitudeMode,
      phase: this.phase,
      mass: this.mass,
      centerOfMassHeight: this.centerOfMassHeight,
      specificForce,
      flight: { ...this.diagnostics },
    };
  }

  // ───────────────────────────── 控制指令 ─────────────────────────────

  /** 节流指令 [0, 1]。无效数值被忽略。 */
  setThrottle(throttle: number): void {
    if (Number.isFinite(throttle)) this.throttle = clamp01(throttle);
  }

  setAttitudeInput(input: AttitudeInput): void {
    this.attitudeInput = sanitizeAttitudeInput(input);
  }

  /** 自动指向模式。无效的取值被忽略。手动操纵输入会暂时覆盖自动指向。 */
  setAttitudeMode(mode: AttitudeMode): void {
    if (isAttitudeMode(mode)) this.attitudeMode = mode;
  }

  /**
   * 执行飞行序列的下一步：
   *   发射台上 → 发动机点火；
   *   飞行中，当前推进单元有推进剂但尚未启用 → 点火（载荷发动机、或从轨道开始时的上面级）；
   *   飞行中，其余情况 → 分离当前最低一级，并点燃它上面的推进级。
   */
  stage(): void {
    if (this.phase === 'prelaunch') {
      if (!this.ignited) {
        this.ignited = true;
        this.emit('ignition', lowestAttachedStage(this.cfg));
      }
      return;
    }
    if (this.phase !== 'flight') return;

    // 当前推进单元还有推进剂但尚未启用（载荷发动机，或"从轨道开始"时的上面级）：先点火。
    const propulsion = activePropulsion(this.vehicle, this.cfg);
    if (!this.ignited && propulsion && propulsion.propellantMass > 0) {
      this.ignited = true;
      if (propulsion.source === 'stage') this.emit('ignition', propulsion.stageIndex);
      else this.emit('payload-ignition', -1);
      return;
    }

    const index = lowestAttachedStage(this.cfg);
    if (index < this.cfg.stages.length) {
      this.separateStage(index);
      const next = lowestAttachedStage(this.cfg);
      this.ignited = next < this.cfg.stages.length;
      if (this.ignited) this.emit('ignition', next);
    }
  }

  /** 抛整流罩（仅飞行中有效）。两个半罩沿机体 ±Y 方向分离。 */
  jettisonFairing(): void {
    const { payload } = this.vehicle;
    if (this.phase !== 'flight' || !this.cfg.fairingAttached || payload.kind !== 'satellite') return;

    const nose = rotate(this.attitude, BODY_X);
    const lateral = rotate(this.attitude, BODY_Y);
    const oldCom = this.centerOfMassHeight;
    const fairingLength = payload.fairing.geometry.length;
    const fairingBase = this.height - fairingLength;
    const center = addScaled(vec3(this.r.x, this.r.y, this.r.z), nose, fairingBase + fairingLength / 2 - oldCom);
    const halfMass = payload.fairing.mass / 2;
    const area =
      0.5 * CROSS_FLOW_DRAG_COEFFICIENT * payload.fairing.geometry.diameter * fairingLength +
      0.5 * 1.0 * ((Math.PI * payload.fairing.geometry.diameter ** 2) / 8);

    for (const half of [1, -1] as const) {
      // half = +1 的半罩位于模型 +X 一侧，即机体 −Y 一侧。
      const direction = -half;
      this.addDebris({
        kind: 'fairing',
        stageIndex: -1,
        half,
        position: center,
        velocity: addScaled(vec3(this.v.x, this.v.y, this.v.z), lateral, direction * FAIRING_SEPARATION_SPEED),
        angularVelocity: vec3(0, 0, direction * 0.5),
        mass: halfMass,
        propellantMass: 0,
        dragArea: area,
      });
    }

    this.cfg.fairingAttached = false;
    this.refreshConfiguration();
    // 质心在箭体内的位置变了：把状态点移到新的质心上（箭体本身没有移动）。
    this.shiftPosition(nose, this.centerOfMassHeight - oldCom);
    this.emit('fairing', -1);
  }

  // ───────────────────────────── 推进 ─────────────────────────────

  /** 推进一个固定物理步。 */
  step(): void {
    const t0 = this.time;
    this.stepCount += 1;
    if (this.phase === 'prelaunch') this.stepOnPad(t0);
    else if (this.phase === 'flight') this.stepFlight(t0);
    if (this.debris.length > 0) this.stepDebris(t0);
  }

  /**
   * 发射台上的一步：[t0, t0 + dt]。
   *
   * 牵制机构提供保持静止所需的任意支撑力，直到推力超过该支撑力：
   *   支撑比力 f = ω×(ω×r) − g(r)，沿天向的分量 ≈ g − ω²R·cos²φ
   *   当 F/m > f·ê_up 时在本步起点释放，本步即按自由飞行积分
   *   （这样起飞时刻与获得的速度不依赖步长）。
   * 点火但推力不足时，火箭留在台上继续消耗推进剂（质量下降后可能起飞）。
   */
  private stepOnPad(t0: number): void {
    const propulsion = activePropulsion(this.vehicle, this.cfg);
    sampleAtmosphere(this.site.altitude, this.padAtmosphere);
    if (!(this.ignited && this.throttle > 0 && propulsion && propulsion.propellantMass > 0)) {
      this.updatePadDiagnostics(0, 0, 0);
      return;
    }

    const effectiveThrottle = Math.max(propulsion.engine.minThrottle, this.throttle);
    const massFlow = engineMassFlow(propulsion.engine, effectiveThrottle) * propulsion.engineCount;
    const thrust = engineThrust(propulsion.engine, this.padAtmosphere.pressure, effectiveThrottle) * propulsion.engineCount;

    const pose = this.padPose(t0);
    const up = normalize(pose.position);
    const support = sub(cross(EARTH_ANGULAR_VELOCITY, pose.velocity), gravityAcceleration(pose.position));
    if (thrust / this.mass > dot(support, up)) {
      // 起飞：自由飞行的初始状态就是此刻的发射台状态。
      this.r.x = pose.position.x;
      this.r.y = pose.position.y;
      this.r.z = pose.position.z;
      this.v.x = pose.velocity.x;
      this.v.y = pose.velocity.y;
      this.v.z = pose.velocity.z;
      this.attitude = pose.attitude;
      this.omega = pose.angularVelocity;
      this.phase = 'flight';
      this.liftoffTime = t0;
      this.events.push({ kind: 'liftoff', time: t0, stageIndex: propulsion.stageIndex });
      this.stepFlight(t0);
      return;
    }

    // 仍被牵制：在台上燃烧一个步长。
    const burned = Math.min(propulsion.propellantMass, massFlow * this.dt);
    this.consumePropellant(propulsion, burned);
    this.refreshConfiguration();
    if (burned >= propulsion.propellantMass) {
      this.emit('depleted', propulsion.stageIndex);
      this.updatePadDiagnostics(0, 0, 0);
    } else {
      this.updatePadDiagnostics(thrust, massFlow, effectiveThrottle);
    }
  }

  /** 自由飞行的一步：[t0, t0 + dt]。 */
  private stepFlight(t0: number): void {
    const dt = this.dt;
    const fm = this.forces;

    // 姿态（算子分裂）：先转半步，用中点姿态做平动积分，再转后半步。
    this.omega = respondBodyRate(this.omega, this.bodyRateCommand(), dt, ATTITUDE_CONTROL.timeConstant);
    const midAttitude = integrateAttitude(this.attitude, this.omega, dt / 2);
    const nose = rotate(midAttitude, BODY_X);
    fm.noseX = nose.x;
    fm.noseY = nose.y;
    fm.noseZ = nose.z;

    const propulsion = activePropulsion(this.vehicle, this.cfg);
    let effectiveThrottle = 0;
    let massFlow = 0;
    let burnTime = 0;
    if (this.ignited && this.throttle > 0 && propulsion && propulsion.propellantMass > 0) {
      effectiveThrottle = Math.max(propulsion.engine.minThrottle, this.throttle);
      massFlow = engineMassFlow(propulsion.engine, effectiveThrottle) * propulsion.engineCount;
      burnTime = Math.min(dt, propulsion.propellantMass / massFlow);
    }

    let t = t0;
    let burning = false;
    if (propulsion && burnTime > 0) {
      fm.thrustVacuum = effectiveThrottle * propulsion.engine.thrustVacuum * propulsion.engineCount;
      fm.exitArea = propulsion.engine.nozzleExitArea * propulsion.engineCount;
      fm.massFlow = massFlow;
      fm.mass0 = this.mass;
      fm.t0 = t;
      const elapsed = this.integrateSegment(t, burnTime, nose);
      t += elapsed;
      // 残量小于一微克视为耗尽（含"恰好在步末烧完"的情形）。
      const depleted = propulsion.propellantMass - massFlow * elapsed <= 1e-9;
      this.consumePropellant(propulsion, depleted ? propulsion.propellantMass : massFlow * elapsed);
      this.refreshConfiguration();
      if (depleted) this.emit('depleted', propulsion.stageIndex);
      burning = !depleted;
    }

    const remaining = t0 + dt - t;
    if (this.phase === 'flight' && remaining > 1e-12) {
      // 无动力段（整步滑行，或推进剂在步内耗尽后的剩余部分）
      fm.thrustVacuum = 0;
      fm.exitArea = 0;
      fm.massFlow = 0;
      fm.mass0 = this.mass;
      fm.t0 = t;
      this.integrateSegment(t, remaining, nose);
      burning = false;
    }

    if (this.phase !== 'flight') return;
    this.attitude = integrateAttitude(midAttitude, this.omega, dt / 2);

    // 步末的受力诊断量
    if (!burning) {
      fm.thrustVacuum = 0;
      fm.massFlow = 0;
    }
    fm.evaluate(this.r, this.v);
    const drag = Math.hypot(fm.dragX, fm.dragY, fm.dragZ);
    this.specificForce = vec3(
      (fm.thrust * nose.x + fm.dragX) / this.mass,
      (fm.thrust * nose.y + fm.dragY) / this.mass,
      (fm.thrust * nose.z + fm.dragZ) / this.mass,
    );
    this.diagnostics = {
      thrust: fm.thrust,
      effectiveThrottle: burning ? effectiveThrottle : 0,
      massFlow: burning ? massFlow : 0,
      ambientPressure: fm.atmosphere.pressure,
      airDensity: fm.atmosphere.density,
      airspeed: fm.airspeed,
      mach: fm.mach,
      dynamicPressure: dynamicPressure(fm.atmosphere.density, fm.airspeed),
      drag,
      angleOfAttack: Math.acos(Math.max(-1, Math.min(1, fm.cosAlpha))),
    };
    this.updateStats();
  }

  /** 本步的角速度指令：有手动输入时听手动的；否则按自动指向模式转向目标方向；都没有则保持姿态。 */
  private bodyRateCommand(): Vec3 {
    const input = this.attitudeInput;
    const manual = input.pitch !== 0 || input.yaw !== 0 || input.roll !== 0;
    if (manual || this.attitudeMode === 'manual') {
      this.lastPointing = null;
      return commandedBodyRate(input, ATTITUDE_CONTROL);
    }
    const target = pointingDirection(this.attitudeMode, this.r, this.v);
    if (!target) {
      this.lastPointing = null;
      return vec3(0, 0, 0);
    }
    // 前馈：目标方向相对上一步的转动角速度（同一指向模式下才有意义）
    const previous = this.lastPointing;
    const feedForward =
      previous && previous.mode === this.attitudeMode
        ? targetAngularVelocity(previous.direction, target, this.dt, ATTITUDE_CONTROL.maxPitchYawRate)
        : undefined;
    this.lastPointing = { mode: this.attitudeMode, direction: target };
    return steeringRateCommand(this.attitude, rotate(this.attitude, BODY_X), target, ATTITUDE_CONTROL, feedForward);
  }

  /**
   * 轨迹预测：假设从现在起发动机关机、指向模式不变（手动模式即惯性姿态保持不变），
   * 在状态的副本上传播 引力 + 阻力，直到触地或超出预测时段。不改变真实状态。
   *
   * 步长随环境调整（预测只用于显示，不需要 0.02 s 的步长）：
   *   大气内约 0.5–1 s；大气外取轨道特征时间 r/|v| 的 1%，上限 120 s。
   * 不在飞行中、或轨道近地点高于 PREDICTION_PERIAPSIS_LIMIT（稳定轨道，用解析圆锥曲线即可）时返回 null。
   */
  predictTrajectory(): TrajectoryPrediction | null {
    if (this.phase !== 'flight') return null;
    const elements = elementsFromState(this.r, this.v);
    if (elements.periapsisRadius - EARTH.RADIUS >= PREDICTION_PERIAPSIS_LIMIT) return null;

    const fm = this.predictionForces;
    fm.aero = this.forces.aero;
    fm.noseX = this.forces.noseX;
    fm.noseY = this.forces.noseY;
    fm.noseZ = this.forces.noseZ;
    fm.pointing = this.attitudeMode;
    fm.thrustVacuum = 0;
    fm.exitArea = 0;
    fm.massFlow = 0;
    fm.mass0 = this.mass;
    fm.t0 = 0;

    const r: MutableVec3 = { x: this.r.x, y: this.r.y, z: this.r.z };
    const v: MutableVec3 = { x: this.v.x, y: this.v.y, z: this.v.z };
    const start = this.time;
    const horizon = Math.min(PREDICTION_MAX_HORIZON, Number.isFinite(elements.period) ? elements.period * 1.05 : PREDICTION_MAX_HORIZON);
    const times: number[] = [start];
    const points: number[] = [r.x, r.y, r.z];
    let impact: PredictedImpact | null = null;
    let elapsed = 0;

    for (let i = 0; i < PREDICTION_MAX_STEPS && elapsed < horizon; i++) {
      const radius = Math.hypot(r.x, r.y, r.z);
      const speed = Math.hypot(v.x, v.y, v.z);
      const altitude = radius - EARTH.RADIUS;
      let h = Math.min(120, Math.max(0.5, (0.01 * radius) / Math.max(speed, 1)));
      if (altitude < 150_000) h = Math.min(h, 1);
      if (altitude < 90_000) h = 0.5;
      const px = r.x;
      const py = r.y;
      const pz = r.z;
      this.predictionRk4.step(r, v, elapsed, h, fm.acceleration);
      const newRadius = Math.hypot(r.x, r.y, r.z);

      if (newRadius <= EARTH.RADIUS) {
        // 触地发生在本步内：按高度线性插值出触地点
        const s = radius > newRadius ? (radius - EARTH.RADIUS) / (radius - newRadius) : 1;
        const ix = px + (r.x - px) * s;
        const iy = py + (r.y - py) * s;
        const iz = pz + (r.z - pz) * s;
        const impactTime = start + elapsed + h * s;
        const geodetic = ecefToGeodetic(eciToEcef(vec3(ix, iy, iz), earthRotationAngle(this.earthAngleAtEpoch, impactTime)));
        impact = {
          time: impactTime,
          latitude: geodetic.latitude,
          longitude: geodetic.longitude,
          speed: Math.hypot(v.x + OMEGA * r.y, v.y - OMEGA * r.x, v.z),
        };
        times.push(impactTime);
        points.push(ix, iy, iz);
        break;
      }
      elapsed += h;
      times.push(start + elapsed);
      points.push(r.x, r.y, r.z);
      // 飞到很远处（逃逸轨道）就不再继续
      if (newRadius > 80 * EARTH.RADIUS) break;
    }

    return { computedAt: start, ...decimateTrajectory(times, points, PREDICTION_MAX_POINTS), impact };
  }

  /**
   * 以当前受力参数把状态从 t 积分 h。若途中接地，则定位接地时刻、结束飞行，
   * 并返回实际推进的时间（< h）。
   */
  private integrateSegment(t: number, h: number, nose: Vec3): number {
    const { r, v, r0, v0 } = this;
    r0.x = r.x;
    r0.y = r.y;
    r0.z = r.z;
    v0.x = v.x;
    v0.y = v.y;
    v0.z = v.z;

    this.rk4.step(r, v, t, h, this.forces.acceleration);
    if (!this.isBelowGround(nose)) return h;

    // 接地发生在本段内：对段内时间二分。lo 始终是"尚未接地"的时刻。
    let lo = 0;
    let hi = h;
    for (let i = 0; i < CONTACT_BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      this.restoreSegmentStart();
      this.rk4.step(r, v, t, mid, this.forces.acceleration);
      if (this.isBelowGround(nose)) hi = mid;
      else lo = mid;
    }
    this.restoreSegmentStart();
    if (lo > 0) this.rk4.step(r, v, t, lo, this.forces.acceleration);
    this.resolveGroundContact(t + lo, nose);
    return lo;
  }

  private restoreSegmentStart(): void {
    this.r.x = this.r0.x;
    this.r.y = this.r0.y;
    this.r.z = this.r0.z;
    this.v.x = this.v0.x;
    this.v.y = this.v0.y;
    this.v.z = this.v0.z;
  }

  /** 箭体最低点是否已低于地面且正在下降。最低点取箭体轴线的两个端点。 */
  private isBelowGround(nose: Vec3): boolean {
    const { r, v } = this;
    const toBase = -this.centerOfMassHeight;
    const toTop = this.height - this.centerOfMassHeight;
    const base = Math.hypot(r.x + nose.x * toBase, r.y + nose.y * toBase, r.z + nose.z * toBase);
    const top = Math.hypot(r.x + nose.x * toTop, r.y + nose.y * toTop, r.z + nose.z * toTop);
    if (Math.min(base, top) - EARTH.RADIUS >= -CONTACT_TOLERANCE) return false;
    // 相对地面的径向速度：(v − ω×r)·r̂。ω×r 与 r 垂直，因此等于 v·r̂。
    return v.x * r.x + v.y * r.y + v.z * r.z < 0;
  }

  /** 接地：按速度与姿态判定结果，把飞行器固定到地固系。 */
  private resolveGroundContact(time: number, nose: Vec3): void {
    const position = vec3(this.r.x, this.r.y, this.r.z);
    const velocity = vec3(this.v.x, this.v.y, this.v.z);
    const up = normalize(position);
    const relative = sub(velocity, cross(EARTH_ANGULAR_VELOCITY, position));
    const impactSpeed = length(relative);
    const verticalSpeed = dot(relative, up);
    const horizontalSpeed = Math.sqrt(Math.max(0, impactSpeed * impactSpeed - verticalSpeed * verticalSpeed));
    const tilt = Math.acos(Math.max(-1, Math.min(1, dot(nose, up))));
    const survivable =
      Math.abs(verticalSpeed) <= LANDING_LIMITS.verticalSpeed &&
      horizontalSpeed <= LANDING_LIMITS.horizontalSpeed &&
      tilt <= LANDING_LIMITS.tilt;

    const theta = earthRotationAngle(this.earthAngleAtEpoch, time);
    const positionEcef = eciToEcef(position, theta);
    const geodetic = ecefToGeodetic(positionEcef);
    this.groundPose = { positionEcef, attitudeEcef: multiply(fromAxisAngle(UNIT_Z, -theta), this.attitude) };
    const kind = survivable ? 'landed' : 'destroyed';
    this.phase = kind;
    this.ignited = false;
    this.attitudeInput = NO_ATTITUDE_INPUT;
    this.attitudeMode = 'manual';
    this.outcome = {
      kind,
      time,
      impactSpeed,
      verticalSpeed,
      tilt,
      latitude: geodetic.latitude,
      longitude: geodetic.longitude,
    };
    this.diagnostics = { ...ZERO_DIAGNOSTICS, ambientPressure: this.forces.atmosphere.pressure, airDensity: this.forces.atmosphere.density };
    this.emit(kind, -1);
  }

  // ───────────────────────────── 分级与分离体 ─────────────────────────────

  /** 分离第 index 级：它成为独立的弹道物体，飞行器的质量、质心与外形随之更新。 */
  private separateStage(index: number): void {
    const stage = this.vehicle.stages[index];
    const state = this.cfg.stages[index];
    if (!stage || !state) return;

    const nose = rotate(this.attitude, BODY_X);
    const oldCom = this.centerOfMassHeight;
    const dropped = stageAloneMassProperties(stage, state.propellantMass);
    const position = vec3(this.r.x, this.r.y, this.r.z);
    const velocity = vec3(this.v.x, this.v.y, this.v.z);

    state.attached = false;
    this.refreshConfiguration();

    // 动量守恒的分离冲量：两者沿箭体轴线以 STAGE_SEPARATION_SPEED 的相对速度分开。
    const total = this.mass + dropped.mass;
    const vehicleKick = (STAGE_SEPARATION_SPEED * dropped.mass) / total;
    const debrisKick = (-STAGE_SEPARATION_SPEED * this.mass) / total;

    const lateralArea = stage.geometry.diameter * stage.geometry.length;
    this.addDebris({
      kind: 'stage',
      stageIndex: index,
      half: 0,
      position: addScaled(position, nose, dropped.centerOfMassHeight - oldCom),
      velocity: addScaled(velocity, nose, debrisKick),
      angularVelocity: vec3(0, 0.03, 0.012),
      mass: dropped.mass,
      propellantMass: state.propellantMass,
      dragArea:
        0.5 * stage.aero.dragCoefficient * stage.aero.referenceArea + 0.5 * CROSS_FLOW_DRAG_COEFFICIENT * lateralArea,
    });

    // 剩余部分的质心：原底面之上 (被抛级长度 + 新质心高度) 处。
    this.shiftPosition(nose, stage.geometry.length + this.centerOfMassHeight - oldCom);
    this.v.x += nose.x * vehicleKick;
    this.v.y += nose.y * vehicleKick;
    this.v.z += nose.z * vehicleKick;
    this.emit('separation', index);
  }

  private addDebris(init: {
    kind: 'stage' | 'fairing';
    stageIndex: number;
    half: -1 | 0 | 1;
    position: Vec3;
    velocity: Vec3;
    angularVelocity: Vec3;
    mass: number;
    propellantMass: number;
    dragArea: number;
  }): void {
    this.debris.push({
      id: this.nextDebrisId++,
      kind: init.kind,
      stageIndex: init.stageIndex,
      half: init.half,
      r: { x: init.position.x, y: init.position.y, z: init.position.z },
      v: { x: init.velocity.x, y: init.velocity.y, z: init.velocity.z },
      attitude: this.attitude,
      angularVelocity: init.angularVelocity,
      mass: init.mass,
      propellantMass: init.propellantMass,
      dragArea: init.dragArea,
      createdAt: this.time,
    });
    if (this.debris.length > MAX_DEBRIS) this.debris.shift();
  }

  /** 分离体：引力 + 阻力的弹道飞行。落地或超过跟踪时限后移除。 */
  private stepDebris(t0: number): void {
    const now = this.time;
    let removed = false;
    for (const d of this.debris) {
      this.ballistic.dragArea = d.dragArea;
      this.ballistic.mass = d.mass;
      this.rk4.step(d.r, d.v, t0, this.dt, this.ballistic.acceleration);
      d.attitude = integrateAttitude(d.attitude, d.angularVelocity, this.dt);
      if (Math.hypot(d.r.x, d.r.y, d.r.z) < EARTH.RADIUS || now - d.createdAt > DEBRIS_LIFETIME) removed = true;
    }
    if (removed) {
      this.debris = this.debris.filter(
        (d) => Math.hypot(d.r.x, d.r.y, d.r.z) >= EARTH.RADIUS && now - d.createdAt <= DEBRIS_LIFETIME,
      );
    }
  }

  // ───────────────────────────── 内部辅助 ─────────────────────────────

  private emit(kind: FlightEventKind, stageIndex: number): void {
    this.events.push({ kind, time: this.time, stageIndex });
  }

  private consumePropellant(propulsion: ActivePropulsion, amount: number): void {
    if (propulsion.source === 'stage') {
      const state = this.cfg.stages[propulsion.stageIndex];
      if (state) state.propellantMass = Math.max(0, state.propellantMass - amount);
    } else {
      this.cfg.payloadPropellantMass = Math.max(0, this.cfg.payloadPropellantMass - amount);
    }
  }

  /** 构型或推进剂变化后，刷新质量、质心、高度与气动特性。 */
  private refreshConfiguration(): void {
    const props = configurationMassProperties(this.vehicle, this.cfg);
    this.mass = props.mass;
    this.centerOfMassHeight = props.centerOfMassHeight;
    this.height = stackHeight(this.vehicle, this.cfg);
    this.forces.aero = configurationAero(this.vehicle, this.cfg);
  }

  private shiftPosition(direction: Vec3, distance: number): void {
    this.r.x += direction.x * distance;
    this.r.y += direction.y * distance;
    this.r.z += direction.z * distance;
  }

  private updatePadDiagnostics(thrust: number, massFlow: number, effectiveThrottle: number): void {
    sampleAtmosphere(this.site.altitude, this.padAtmosphere);
    this.diagnostics = {
      ...ZERO_DIAGNOSTICS,
      thrust,
      massFlow,
      effectiveThrottle,
      ambientPressure: this.padAtmosphere.pressure,
      airDensity: this.padAtmosphere.density,
    };
  }

  private updateStats(): void {
    const s = this.stats;
    const altitude = Math.hypot(this.r.x, this.r.y, this.r.z) - EARTH.RADIUS;
    const inertialSpeed = Math.hypot(this.v.x, this.v.y, this.v.z);
    const gLoad = length(this.specificForce) / STANDARD_GRAVITY;
    if (altitude > s.maxAltitude) s.maxAltitude = altitude;
    if (this.diagnostics.airspeed > s.maxSurfaceSpeed) s.maxSurfaceSpeed = this.diagnostics.airspeed;
    if (inertialSpeed > s.maxInertialSpeed) s.maxInertialSpeed = inertialSpeed;
    if (gLoad > s.maxGLoad) s.maxGLoad = gLoad;
    if (this.diagnostics.dynamicPressure > s.maxDynamicPressure) s.maxDynamicPressure = this.diagnostics.dynamicPressure;
  }

  /**
   * 发射台待命状态（解析解）。
   *   r(t) = Rz(θ(t))·r_ecef ，v(t) = ω × r(t) ，姿态竖直，角速度与地球相同。
   * 飞行器底端坐落在发射台面上，质心在其上方 centerOfMassHeight 处。
   */
  private padPose(time: number): RigidBodyState {
    const theta = earthRotationAngle(this.earthAngleAtEpoch, time);
    const comEcef = geodeticToEcef({ ...this.site, altitude: this.site.altitude + this.centerOfMassHeight });
    const position = ecefToEci(comEcef, theta);
    const attitude = verticalLaunchAttitude(position);
    return {
      position,
      velocity: cross(EARTH_ANGULAR_VELOCITY, position),
      attitude,
      angularVelocity: frameToBody(attitude, EARTH_ANGULAR_VELOCITY),
    };
  }

  /** 接地后的状态：固定在地固系中，随地球自转。 */
  private groundFixedPose(time: number): RigidBodyState {
    const pose = this.groundPose;
    if (!pose) return this.padPose(time);
    const theta = earthRotationAngle(this.earthAngleAtEpoch, time);
    const position = ecefToEci(pose.positionEcef, theta);
    const attitude = multiply(fromAxisAngle(UNIT_Z, theta), pose.attitudeEcef);
    return {
      position,
      velocity: cross(EARTH_ANGULAR_VELOCITY, position),
      attitude,
      angularVelocity: frameToBody(attitude, EARTH_ANGULAR_VELOCITY),
    };
  }
}
