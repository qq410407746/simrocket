/**
 * 核心物理状态数据结构。全部为可结构化克隆的纯数据（plain object），
 * 以便在 Web Worker 与主线程之间通过 postMessage 传递，并可直接序列化存档。
 */
import type { Quat } from '../math/quat';
import type { Vec3 } from '../math/vec3';

/** 刚体运动状态。动力学积分的状态量，全部在 ECI 中表达（角速度除外）。 */
export interface RigidBodyState {
  /** 质心位置 [m]，ECI。 */
  readonly position: Vec3;
  /** 质心速度 [m/s]，ECI（惯性速度）。 */
  readonly velocity: Vec3;
  /** 姿态四元数：机体系 → ECI。 */
  readonly attitude: Quat;
  /** 机体相对惯性空间的角速度 [rad/s]，在机体系中表达。 */
  readonly angularVelocity: Vec3;
}
