/**
 * 物理空间（ECI，双精度）→ 渲染空间（Three.js，单精度）的转换。
 *
 * 1) 坐标轴约定
 *    ECI 以 +Z 为北；Three.js 习惯以 +Y 为上。渲染空间 = 绕 X 轴旋转 −90° 的 ECI：
 *        render = (eci.x, eci.z, −eci.y)
 *    这是一个固定的正交旋转（行列式 +1），保持右手性。
 *
 * 2) 浮动原点（相机相对渲染）
 *    地球半径 6.4×10⁶ m，而 GPU 的 float32 只有约 7 位有效数字（在该量级精度 ≈ 0.5 m）。
 *    因此渲染时所有物体的位置都先在 CPU 上用双精度减去相机位置，再转成 float32：
 *        p_render = toRender(p_eci − camera_eci)
 *    相机永远位于渲染空间原点，近处物体的坐标数值很小，不会抖动。
 */
import { Quaternion, type Vector3 } from 'three';
import type { Quat } from '@/game/physics/math/quat';
import type { Vec3 } from '@/game/physics/math/vec3';

/** ECI 方向/位移 → 渲染空间。 */
export const eciToRender = (v: Vec3, out: Vector3): Vector3 => out.set(v.x, v.z, -v.y);

/** 相机相对位置：(p − camera) 在双精度下相减后再转换。 */
export const eciToRenderRelative = (p: Vec3, camera: Vec3, out: Vector3): Vector3 =>
  out.set(p.x - camera.x, p.z - camera.z, -(p.y - camera.y));

/** 坐标轴旋转 C = Rx(−90°) 对应的四元数。 */
const AXIS_ROTATION = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

/**
 * 把"某局部系 → ECI"的姿态四元数转换为"该局部系 → 渲染空间"的四元数：q_render = C ⊗ q。
 * 用于飞行器（机体系 → ECI）与发射场（当地系 → ECI）等对象的朝向。
 */
export const eciOrientationToRender = (q: Quat, out: Quaternion): Quaternion =>
  out.set(q.x, q.y, q.z, q.w).premultiply(AXIS_ROTATION);
