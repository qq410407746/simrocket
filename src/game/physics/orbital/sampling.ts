/**
 * 把圆锥曲线轨道离散成折线，用于绘制。
 *
 * 采样参数：椭圆用偏近点角 E、双曲线用双曲近点角 F（而不是真近点角），
 * 这样大偏心率轨道的点在空间上分布更均匀（真近点角等分会让远地点附近过于稀疏）。
 *   椭圆：  r = a(1 − e·cos E) ，近焦点坐标 (a(cos E − e), a√(1−e²)·sin E)
 *   双曲线：r = a(1 − e·cosh F)，近焦点坐标 (a(cosh F − e), −a√(e²−1)·sinh F)   （a < 0）
 *   抛物线：按真近点角采样，r = p/(1 + cos ν)
 *
 * 只保留地心距在 [minRadius, maxRadius] 之间的部分：
 *   minRadius 通常取地球半径——轨道在地面以下的部分没有意义；
 *   maxRadius 限制开放轨道（与极扁椭圆）画到多远。
 */
import { type OrbitalElements, perifocalBasis } from './elements';

export interface ConicSampling {
  /** 采样点位置 [m]（与根数同一惯性系），按 x, y, z 依次排列。 */
  readonly points: Float64Array;
  /** 采样点个数。 */
  readonly count: number;
  /** 是否为完整的闭合椭圆（首尾两点重合）。 */
  readonly closed: boolean;
}

const EMPTY: ConicSampling = { points: new Float64Array(0), count: 0, closed: false };

/**
 * @param segments 折线段数（完整椭圆时的段数；被截断的弧段使用同样的段数）
 */
export const sampleConic = (el: OrbitalElements, segments: number, minRadius: number, maxRadius: number): ConicSampling => {
  const e = el.eccentricity;
  const a = el.semiMajorAxis;
  const n = Math.max(2, Math.floor(segments));
  if (!(el.semiLatusRectum > 0) || el.periapsisRadius >= maxRadius) return EMPTY;

  const { p, q } = perifocalBasis(el);
  const points = new Float64Array((n + 1) * 3);
  const put = (i: number, x: number, y: number): void => {
    points[i * 3] = x * p.x + y * q.x;
    points[i * 3 + 1] = x * p.y + y * q.y;
    points[i * 3 + 2] = x * p.z + y * q.z;
  };

  if (el.kind === 'elliptic') {
    if (el.apoapsisRadius <= minRadius) return EMPTY;
    const b = a * Math.sqrt(Math.max(0, 1 - e * e));
    // r(E) = a(1 − e cos E)：r ≥ minRadius ⇔ cos E ≤ (1 − minRadius/a)/e
    //                      r ≤ maxRadius ⇔ cos E ≥ (1 − maxRadius/a)/e
    const lowerClip = el.periapsisRadius < minRadius && e > 0 ? Math.acos(Math.max(-1, Math.min(1, (1 - minRadius / a) / e))) : 0;
    const upperClip = el.apoapsisRadius > maxRadius && e > 0 ? Math.acos(Math.max(-1, Math.min(1, (1 - maxRadius / a) / e))) : Math.PI;
    if (lowerClip === 0 && upperClip === Math.PI) {
      for (let i = 0; i <= n; i++) {
        const E = (i / n) * 2 * Math.PI;
        put(i, a * (Math.cos(E) - e), b * Math.sin(E));
      }
      return { points, count: n + 1, closed: true };
    }
    if (upperClip < Math.PI) {
      // 远端被截断：画包含近地点的那一段 E ∈ [−upperClip, upperClip]（若近端也在地下，则只画上升的一支）
      const from = lowerClip > 0 ? lowerClip : -upperClip;
      for (let i = 0; i <= n; i++) {
        const E = from + ((upperClip - from) * i) / n;
        put(i, a * (Math.cos(E) - e), b * Math.sin(E));
      }
      return { points, count: n + 1, closed: false };
    }
    // 近端在地面以下：画经过远地点的弧段 E ∈ [lowerClip, 2π − lowerClip]
    for (let i = 0; i <= n; i++) {
      const E = lowerClip + ((2 * Math.PI - 2 * lowerClip) * i) / n;
      put(i, a * (Math.cos(E) - e), b * Math.sin(E));
    }
    return { points, count: n + 1, closed: false };
  }

  if (el.kind === 'hyperbolic') {
    const b = -a * Math.sqrt(e * e - 1);
    const fMax = Math.acosh(Math.max(1, (1 - maxRadius / a) / e));
    const fMin = el.periapsisRadius < minRadius ? Math.acosh(Math.max(1, (1 - minRadius / a) / e)) : -fMax;
    // 近地点在地面以下时只画飞离的一支
    for (let i = 0; i <= n; i++) {
      const F = fMin + ((fMax - fMin) * i) / n;
      put(i, a * (Math.cosh(F) - e), b * Math.sinh(F));
    }
    return { points, count: n + 1, closed: false };
  }

  // 抛物线：r = p/(1 + cos ν) ≤ maxRadius ⇔ cos ν ≥ p/maxRadius − 1
  const semiLatus = el.semiLatusRectum;
  const nuMax = Math.acos(Math.max(-1, Math.min(1, semiLatus / maxRadius - 1)));
  const nuMin = el.periapsisRadius < minRadius ? Math.acos(Math.max(-1, Math.min(1, semiLatus / minRadius - 1))) : -nuMax;
  for (let i = 0; i <= n; i++) {
    const nu = nuMin + ((nuMax - nuMin) * i) / n;
    const r = semiLatus / (1 + Math.cos(nu));
    put(i, r * Math.cos(nu), r * Math.sin(nu));
  }
  return { points, count: n + 1, closed: false };
};
