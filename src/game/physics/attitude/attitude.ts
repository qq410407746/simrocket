/**
 * 姿态运动学与简化姿态控制。
 *
 * 【简化模型——如实说明】
 * 这里没有求解刚体转动动力学（欧拉方程），也没有力矩、转动惯量与气动力矩。
 * 采用"角速度指令 + 一阶响应"的运动学模型：
 *
 *     ω̇ = (ω_cmd − ω) / τ            （机体系角速度向指令值指数趋近）
 *     q̇ = ½·q ⊗ (ω, 0)               （四元数运动学方程）
 *
 * 没有输入时 ω_cmd = 0，即保持当前惯性姿态（相当于始终开启的姿态稳定）。
 * 这个模型给出了"转动需要时间、松手后保持姿态"的操纵手感，但：
 *  - 控制能力与推力大小、推进剂、气动载荷无关（真实火箭依靠推力矢量/RCS/气动舵）；
 *  - 箭体不会因气动不稳定而翻滚，也不会因迎角过大而解体（结构载荷在阶段四处理）。
 * 力矩驱动的刚体转动计划在专家难度中实现。
 */
import { type Quat, multiply, normalizeQuat, quat } from '../math/quat';
import { type Vec3, vec3 } from '../math/vec3';

/** 姿态控制参数。 */
export interface AttitudeControlParams {
  /** 俯仰/偏航最大角速度 [rad/s]。 */
  readonly maxPitchYawRate: number;
  /** 滚转最大角速度 [rad/s]。 */
  readonly maxRollRate: number;
  /** 角速度响应时间常数 τ [s]。 */
  readonly timeConstant: number;
}

/** 操纵输入，各分量范围 [−1, 1]。 */
export interface AttitudeInput {
  /** 俯仰：+1 使头部转向机体 +Z（"低头"）。 */
  readonly pitch: number;
  /** 偏航：+1 使头部转向机体 +Y（"向右"）。 */
  readonly yaw: number;
  /** 滚转：+1 绕机体 +X 右手方向转动（从后方看为顺时针）。 */
  readonly roll: number;
}

export const NO_ATTITUDE_INPUT: AttitudeInput = Object.freeze({ pitch: 0, yaw: 0, roll: 0 });

const clampUnit = (x: number): number => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);

/** 把输入限制到 [−1, 1]，无效数值视为 0。 */
export const sanitizeAttitudeInput = (input: AttitudeInput): AttitudeInput => ({
  pitch: clampUnit(input.pitch),
  yaw: clampUnit(input.yaw),
  roll: clampUnit(input.roll),
});

/**
 * 操纵输入 → 机体系角速度指令 [rad/s]。
 * 机体系：+X 头部。绕 +Z 正转使头部转向 +Y；绕 +Y 负转使头部转向 +Z。
 */
export const commandedBodyRate = (input: AttitudeInput, params: AttitudeControlParams): Vec3 =>
  vec3(input.roll * params.maxRollRate, -input.pitch * params.maxPitchYawRate, input.yaw * params.maxPitchYawRate);

/** 一阶响应：经过 dt 后的角速度（解析解，任意步长都稳定）。 */
export const respondBodyRate = (omega: Vec3, command: Vec3, dt: number, timeConstant: number): Vec3 => {
  const k = timeConstant > 0 ? 1 - Math.exp(-dt / timeConstant) : 1;
  return vec3(
    omega.x + (command.x - omega.x) * k,
    omega.y + (command.y - omega.y) * k,
    omega.z + (command.z - omega.z) * k,
  );
};

/**
 * 以恒定机体系角速度 ω 把姿态推进 dt：q ← q ⊗ exp(½·ω·dt)。
 * 使用指数映射（精确的有限转动），对任意大小的转角都保持单位四元数。
 */
export const integrateAttitude = (attitude: Quat, omegaBody: Vec3, dt: number): Quat => {
  const rate = Math.hypot(omegaBody.x, omegaBody.y, omegaBody.z);
  const angle = rate * dt;
  if (angle < 1e-12) return attitude;
  const s = Math.sin(angle / 2) / rate;
  const delta = quat(omegaBody.x * s, omegaBody.y * s, omegaBody.z * s, Math.cos(angle / 2));
  return normalizeQuat(multiply(attitude, delta));
};
