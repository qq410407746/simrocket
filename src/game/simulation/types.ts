/**
 * 模拟器对外的数据契约：配置、快照、指令与事件。
 *
 * 这是物理线程（Web Worker）与主线程之间唯一的接口。全部是纯数据，
 * 可结构化克隆；主线程只读快照，永远不直接修改物理状态。
 */
import type { AttitudeInput } from '../physics/attitude/attitude';
import type { AttitudeMode } from '../physics/attitude/pointing';
import type { Geodetic } from '../physics/frames/frames';
import type { Quat } from '../physics/math/quat';
import type { Vec3 } from '../physics/math/vec3';
import type { ThermalZoneId } from '../physics/thermodynamics/heating';
import type { VehicleDefinition, VehicleState } from '../vehicles/types';

/** 物理积分的固定时间步长 [s]。与渲染帧率无关。 */
export const PHYSICS_DT = 0.02;

/** 允许的时间倍率档位。 */
export const TIME_WARP_LEVELS = [1, 2, 5, 10, 100, 1000] as const;
export type TimeWarp = (typeof TIME_WARP_LEVELS)[number];

export const isTimeWarp = (value: number): value is TimeWarp =>
  (TIME_WARP_LEVELS as readonly number[]).includes(value);

/** 不超过 limit 的最大倍率档位。 */
export const clampTimeWarp = (warp: TimeWarp, limit: TimeWarp): TimeWarp => (warp <= limit ? warp : limit);

/**
 * 直接从飞行状态开始（而不是从发射台开始）时的初始条件。
 * 用于物理测试，以及后续的"从轨道开始"类任务与沙盒场景。
 */
export interface InitialFlightState {
  /** 质心位置 [m]，ECI。 */
  readonly position: Vec3;
  /** 质心速度 [m/s]，ECI。 */
  readonly velocity: Vec3;
  /** 姿态（机体系 → ECI）；缺省为头部沿当地天向。 */
  readonly attitude?: Quat;
  /** 已经分离的推进级数量（自下而上）；缺省为 0。 */
  readonly separatedStages?: number;
  /** 各推进级的推进剂质量 [kg]（与 definition.stages 对应）；缺省为满载。 */
  readonly stagePropellant?: readonly number[];
  /** 整流罩是否已抛掉；缺省为否。 */
  readonly fairingJettisoned?: boolean;
}

/** 一次模拟会话的初始条件。 */
export interface SimulationConfig {
  readonly vehicle: VehicleDefinition;
  /** 发射场地面点（海拔为地面高度）。 */
  readonly site: Geodetic;
  /** 模拟时间 t = 0 对应的儒略日（UTC）。决定地球自转初相位与太阳方向。 */
  readonly epochJulianDate: number;
  /** 给出时跳过发射台阶段，直接以该状态进入自由飞行。 */
  readonly initialState?: InitialFlightState;
}

/** 本次飞行的统计量（自起飞起累计）。 */
export interface FlightStats {
  /** 最大海拔高度 [m]。 */
  readonly maxAltitude: number;
  /** 相对地面的最大速度 [m/s]。 */
  readonly maxSurfaceSpeed: number;
  /** 最大惯性速度 [m/s]。 */
  readonly maxInertialSpeed: number;
  /** 最大过载 [g]。 */
  readonly maxGLoad: number;
  /** 最大动压 [Pa]。 */
  readonly maxDynamicPressure: number;
  /** 各热区中出现过的最大对流热流 [W/m²]、最高表面温度 [K]、最大累积热载荷 [J/m²]。 */
  readonly maxHeatFlux: number;
  readonly maxSurfaceTemperature: number;
  readonly maxHeatLoad: number;
}

/**
 * 飞行器损毁的原因。
 *  - impact            接地时超出可承受的速度或姿态
 *  - thermal-surface   表面温度超过材料的最高工作温度
 *  - burn-through      烧蚀防热层耗尽
 *  - thermal-structure 内部结构被热透
 *  - overload          过载超过结构限值
 *  - dynamic-pressure  动压超过结构限值
 *  - bending           带迎角飞行的横向气动载荷超过结构限值
 */
export type FailureCause =
  | 'impact'
  | 'thermal-surface'
  | 'burn-through'
  | 'thermal-structure'
  | 'overload'
  | 'dynamic-pressure'
  | 'bending';

/** 飞行结束时的结果。 */
export interface FlightOutcome {
  readonly kind: 'landed' | 'destroyed';
  /** 损毁原因；安全着陆时为 null。 */
  readonly cause: FailureCause | null;
  /** 热失效发生在哪个热区；其余情况为 null。 */
  readonly thermalZone: ThermalZoneId | null;
  /** 结束时刻的模拟时间 [s]。 */
  readonly time: number;
  /** 结束时的高度 [m]：接地为 0 附近，空中解体为解体高度。 */
  readonly altitude: number;
  /** 结束瞬间相对地面的速度大小 [m/s]。 */
  readonly impactSpeed: number;
  /** 结束瞬间的垂直速度 [m/s]（向上为正）。 */
  readonly verticalSpeed: number;
  /** 结束瞬间箭体纵轴与当地天向的夹角 [rad]。 */
  readonly tilt: number;
  /** 落点（或解体点的星下点）纬度、经度 [rad]。 */
  readonly latitude: number;
  readonly longitude: number;
}

/** 分离体（抛掉的箭体或整流罩半罩）。它们作为独立的弹道物体继续被模拟。 */
export interface DebrisState {
  readonly id: number;
  readonly kind: 'stage' | 'fairing';
  /** kind 为 'stage' 时：对应 definition.stages 的下标。 */
  readonly stageIndex: number;
  /** kind 为 'fairing' 时：+1 / −1 表示两个半罩；否则为 0。 */
  readonly half: -1 | 0 | 1;
  /** 质心（整流罩为几何中心）位置 [m]，ECI。 */
  readonly position: Vec3;
  /** 速度 [m/s]，ECI。 */
  readonly velocity: Vec3;
  /** 姿态：与飞行器相同的机体系约定 → ECI。 */
  readonly attitude: Quat;
  /** 残余推进剂 [kg]（决定质心位置）。 */
  readonly propellantMass: number;
}

/**
 * 轨迹预测：假设从现在起发动机关机、姿态保持不变，飞行器在引力与大气阻力作用下的未来轨迹。
 * 由物理线程在状态的副本上数值传播得到，不影响真实状态。
 * 只在轨道会进入大气层（近地点低于 PREDICTION_PERIAPSIS_LIMIT）时计算；稳定轨道直接用解析圆锥曲线表示。
 */
export interface TrajectoryPrediction {
  /** 计算时的模拟时间 [s]。 */
  readonly computedAt: number;
  /** 各采样点的模拟时间 [s]，递增。 */
  readonly times: readonly number[];
  /** 各采样点的位置 [m]（ECI），按 x, y, z 依次排列。 */
  readonly points: readonly number[];
  /** 预测的触地点；预测时段内没有触地时为 null。 */
  readonly impact: PredictedImpact | null;
}

export interface PredictedImpact {
  /** 触地时的模拟时间 [s]。 */
  readonly time: number;
  /** 落点纬度、经度 [rad]（已计入这段时间内的地球自转）。 */
  readonly latitude: number;
  readonly longitude: number;
  /** 触地时相对地面的速度 [m/s]。 */
  readonly speed: number;
}

/** 近地点高度低于该值 [m] 时进行数值轨迹预测。 */
export const PREDICTION_PERIAPSIS_LIMIT = 150_000;

/** 飞行过程中的离散事件（用于界面上的事件记录）。 */
export type FlightEventKind =
  | 'ignition'
  | 'liftoff'
  | 'depleted'
  | 'separation'
  | 'fairing'
  | 'payload-ignition'
  /** 减速伞张开、主伞张开、降落伞因开伞条件超限而被撕毁。 */
  | 'drogue-deployed'
  | 'main-deployed'
  | 'parachute-failed'
  | 'landed'
  | 'destroyed';

export interface FlightEvent {
  readonly kind: FlightEventKind;
  /** 事件发生时的模拟时间 [s]。 */
  readonly time: number;
  /** 相关的推进级下标；与级无关的事件为 −1。 */
  readonly stageIndex: number;
}

/** 某一时刻的完整模拟状态快照。 */
export interface SimSnapshot {
  /** 递增序号，每次 init 后从 0 重新开始。 */
  readonly seq: number;
  /** 自历元起的模拟时间 [s]。 */
  readonly simTime: number;
  /** 当前指令时间倍率。 */
  readonly timeWarp: TimeWarp;
  /** 当前物理状态允许的最大时间倍率（发动机工作、稠密大气内会受限）。 */
  readonly maxTimeWarp: TimeWarp;
  readonly paused: boolean;
  /**
   * 实际模拟速率：每墙钟秒推进的模拟秒数。暂停时为 0；
   * 当计算跟不上指令倍率时小于 timeWarp（如实反映，不伪造）。
   */
  readonly simRate: number;
  /** 地球自转角 θ [rad]（ECEF +X 相对 ECI +X）。 */
  readonly earthRotationAngle: number;
  readonly vehicle: VehicleState;
  /** 起飞时刻的模拟时间 [s]；尚未起飞时为 null。 */
  readonly liftoffTime: number | null;
  readonly stats: FlightStats;
  /** 飞行结果；飞行尚未结束时为 null。 */
  readonly outcome: FlightOutcome | null;
  readonly debris: readonly DebrisState[];
}

/** 主线程 → 模拟器。 */
export type SimCommand =
  | { readonly type: 'init'; readonly config: SimulationConfig }
  | { readonly type: 'setPaused'; readonly paused: boolean }
  | { readonly type: 'setTimeWarp'; readonly warp: TimeWarp }
  /** 节流指令 [0, 1]。 */
  | { readonly type: 'setThrottle'; readonly throttle: number }
  /** 姿态操纵输入，各分量 [−1, 1]。 */
  | { readonly type: 'setAttitudeInput'; readonly input: AttitudeInput }
  /** 自动指向模式。 */
  | { readonly type: 'setAttitudeMode'; readonly mode: AttitudeMode }
  /** 执行飞行序列的下一步：点火 → 逐级分离并点燃下一级 → 载荷发动机点火。 */
  | { readonly type: 'stage' }
  | { readonly type: 'jettisonFairing' }
  /** 开伞：先放出减速伞，动压降低后主伞自动打开。只对已与推进级分离的返回舱有效。 */
  | { readonly type: 'deployParachute' }
  | { readonly type: 'dispose' };

/** 模拟器 → 主线程。 */
export type SimEvent =
  | {
      readonly type: 'ready';
      readonly epochJulianDate: number;
      /** 历元时刻的地球自转角 [rad]。主线程据此解析计算任意时刻的地球姿态。 */
      readonly earthAngleAtEpoch: number;
      readonly physicsDt: number;
    }
  | { readonly type: 'snapshot'; readonly snapshot: SimSnapshot }
  | { readonly type: 'flightEvents'; readonly events: readonly FlightEvent[] }
  /** 轨迹预测（约 2 Hz）；不适用时为 null。 */
  | { readonly type: 'prediction'; readonly prediction: TrajectoryPrediction | null }
  | { readonly type: 'error'; readonly message: string };
