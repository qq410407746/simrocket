import { type Vec3, vec3 } from './vec3';

/**
 * 单位四元数（Hamilton 约定，标量在后：x, y, z, w）。
 *
 * 表示"主动旋转"：rotate(q, v) 把向量 v 旋转到新方向。
 * 用作姿态时，q 把机体坐标系中的向量变换到参考系（例如 ECI）：
 *     v_eci = rotate(q_body→eci, v_body)
 */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const quat = (x: number, y: number, z: number, w: number): Quat => ({ x, y, z, w });

export const IDENTITY: Quat = Object.freeze(quat(0, 0, 0, 1));

export const fromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const half = angle / 2;
  const s = Math.sin(half);
  return quat(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
};

/** 组合旋转：multiply(a, b) 表示"先 b 后 a"。 */
export const multiply = (a: Quat, b: Quat): Quat =>
  quat(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );

/** 共轭；对单位四元数即逆旋转。 */
export const conjugate = (q: Quat): Quat => quat(-q.x, -q.y, -q.z, q.w);

export const normalizeQuat = (q: Quat): Quat => {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return n > 0 && Number.isFinite(n) ? quat(q.x / n, q.y / n, q.z / n, q.w / n) : IDENTITY;
};

/** 用单位四元数旋转向量：v' = q v q⁻¹（展开形式，避免构造中间四元数）。 */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
  // t = 2 q_vec × v ; v' = v + w t + q_vec × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec3(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
};

/**
 * 由一组右手正交单位基向量构造四元数。
 * 结果 q 满足 rotate(q, X) = xAxis，rotate(q, Y) = yAxis，rotate(q, Z) = zAxis。
 * 调用方负责保证输入是右手正交基（xAxis × yAxis = zAxis）。
 */
export const fromBasis = (xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat => {
  // 旋转矩阵的列就是基向量；使用 Shepperd 方法保证数值稳定。
  const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
  const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
  const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1);
    q = quat((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = quat(s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = quat((m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = quat((m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s);
  }
  return normalizeQuat(q);
};

/** 球面线性插值（走最短弧）。 */
export const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let cosHalf = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cosHalf < 0) {
    cosHalf = -cosHalf;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cosHalf > 0.999999) {
    // 两姿态几乎相同：退化为归一化线性插值，避免除以 sin(≈0)。
    return normalizeQuat(
      quat(a.x + (bx - a.x) * t, a.y + (by - a.y) * t, a.z + (bz - a.z) * t, a.w + (bw - a.w) * t),
    );
  }
  const half = Math.acos(cosHalf);
  const sinHalf = Math.sin(half);
  const wa = Math.sin((1 - t) * half) / sinHalf;
  const wb = Math.sin(t * half) / sinHalf;
  return quat(a.x * wa + bx * wb, a.y * wa + by * wb, a.z * wa + bz * wb, a.w * wa + bw * wb);
};

export const isFiniteQuat = (q: Quat): boolean =>
  Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
