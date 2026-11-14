/**
 * 模拟器对外的数据契约：配置、快照、指令与事件。
 *
 * 这是物理线程（Web Worker）与主线程之间唯一的接口。全部是纯数据，
 * 可结构化克隆；主线程只读快照，永远不直接修改物理状态。
 */
import type { AttitudeInput } from '../physics/attitude/attitude';
import type { Geodetic } from '../physics/frames/frames';
import type { Quat } from '../physics/math/quat';
import type { Vec3 } from '../physics/math/vec3';
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
}

/** 飞行结束时的结果。 */
export interface FlightOutcome {
  readonly kind: 'landed' | 'destroyed';
  /** 结束时刻的模拟时间 [s]。 */
  readonly time: number;
  /** 接地瞬间相对地面的速度大小 [m/s]。 */
  readonly impactSpeed: number;
  /** 接地瞬间的垂直速度 [m/s]（向上为正）。 */
  readonly verticalSpeed: number;
  /** 接地瞬间箭体纵轴与当地天向的夹角 [rad]。 */
  readonly tilt: number;
  /** 落点纬度、经度 [rad]。 */
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

/** 飞行过程中的离散事件（用于界面上的事件记录）。 */
export type FlightEventKind =
  | 'ignition'
  | 'liftoff'
  | 'depleted'
  | 'separation'
  | 'fairing'
  | 'payload-ignition'
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
  /** 执行飞行序列的下一步：点火 → 逐级分离并点燃下一级 → 载荷发动机点火。 */
  | { readonly type: 'stage' }
  | { readonly type: 'jettisonFairing' }
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
  | { readonly type: 'error'; readonly message: string };
