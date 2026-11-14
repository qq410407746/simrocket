/**
 * 模拟器对外的数据契约：配置、快照、指令与事件。
 *
 * 这是物理线程（Web Worker）与主线程之间唯一的接口。全部是纯数据，
 * 可结构化克隆；主线程只读快照，永远不直接修改物理状态。
 */
import type { Geodetic } from '../physics/frames/frames';
import type { VehicleDefinition, VehicleState } from '../vehicles/types';

/** 物理积分的固定时间步长 [s]。与渲染帧率无关。 */
export const PHYSICS_DT = 0.02;

/** 允许的时间倍率档位。 */
export const TIME_WARP_LEVELS = [1, 2, 5, 10, 100, 1000] as const;
export type TimeWarp = (typeof TIME_WARP_LEVELS)[number];

export const isTimeWarp = (value: number): value is TimeWarp =>
  (TIME_WARP_LEVELS as readonly number[]).includes(value);

/** 一次模拟会话的初始条件。 */
export interface SimulationConfig {
  readonly vehicle: VehicleDefinition;
  /** 发射场地面点（海拔为地面高度）。 */
  readonly site: Geodetic;
  /** 模拟时间 t = 0 对应的儒略日（UTC）。决定地球自转初相位与太阳方向。 */
  readonly epochJulianDate: number;
}

/** 某一时刻的完整模拟状态快照。 */
export interface SimSnapshot {
  /** 递增序号，每次 init 后从 0 重新开始。 */
  readonly seq: number;
  /** 自历元起的模拟时间 [s]。 */
  readonly simTime: number;
  /** 当前指令时间倍率。 */
  readonly timeWarp: TimeWarp;
  readonly paused: boolean;
  /**
   * 实际模拟速率：每墙钟秒推进的模拟秒数。暂停时为 0；
   * 当计算跟不上指令倍率时小于 timeWarp（如实反映，不伪造）。
   */
  readonly simRate: number;
  /** 地球自转角 θ [rad]（ECEF +X 相对 ECI +X）。 */
  readonly earthRotationAngle: number;
  readonly vehicle: VehicleState;
}

/** 主线程 → 模拟器。 */
export type SimCommand =
  | { readonly type: 'init'; readonly config: SimulationConfig }
  | { readonly type: 'setPaused'; readonly paused: boolean }
  | { readonly type: 'setTimeWarp'; readonly warp: TimeWarp }
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
  | { readonly type: 'error'; readonly message: string };
