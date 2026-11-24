/**
 * 二体问题的解析传播：给定 (r₀, v₀) 与时间间隔 Δt，直接求出 (r, v)。
 *
 * 使用通用变量（universal variable）形式的开普勒方程，对椭圆、抛物线、双曲线统一成立，
 * 没有根数的奇异问题。算法：Curtis, "Orbital Mechanics for Engineering Students", 算法 3.3/3.4。
 *
 *   α = 2/r₀ − v₀²/μ                               （半长轴的倒数）
 *   求 χ 使  (r₀·v_r0/√μ)·χ²·C(z) + (1 − α·r₀)·χ³·S(z) + r₀·χ = √μ·Δt ，z = α·χ²
 *   f = 1 − χ²·C/r₀ ，g = Δt − χ³·S/√μ ，r = f·r₀ + g·v₀
 *   ḟ = √μ·(α·χ³·S − χ)/(r·r₀) ，ġ = 1 − χ²·C/r ，v = ḟ·r₀ + ġ·v₀
 * 其中 C(z)、S(z) 为 Stumpff 函数。
 *
 * 这是二体问题的精确解（只受迭代收敛容差与浮点舍入限制），不含阻力、推力与摄动。
 * 在本项目中用于：验证数值积分器、计算轨道上未来时刻的位置；
 * 模拟器的状态推进仍由 RK4 完成（高倍率在轨滑行改用解析传播属于阶段六）。
 */
import { EARTH, TWO_PI } from '../constants';
import { type Vec3, dot, length, vec3 } from '../math/vec3';

/**
 * |z| 小于该值时用级数计算 Stumpff 函数。
 * 闭式在 z → 0 时是两个相近数相减（例如 1 − cos√z），|z| = 10⁻² 处的相对舍入误差约 10⁻¹⁴；
 * 五项级数在该范围内的截断误差 < 10⁻¹⁹。
 */
const SERIES_THRESHOLD = 1e-2;

/** Stumpff 函数 C(z) = (1 − cos√z)/z。 */
export const stumpffC = (z: number): number => {
  if (z > SERIES_THRESHOLD) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -SERIES_THRESHOLD) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  // Σ (−z)ᵏ / (2k+2)!
  return 1 / 2 - z * (1 / 24 - z * (1 / 720 - z * (1 / 40_320 - z / 3_628_800)));
};

/** Stumpff 函数 S(z) = (√z − sin√z)/√z³。 */
export const stumpffS = (z: number): number => {
  if (z > SERIES_THRESHOLD) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -SERIES_THRESHOLD) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  // Σ (−z)ᵏ / (2k+3)!
  return 1 / 6 - z * (1 / 120 - z * (1 / 5_040 - z * (1 / 362_880 - z / 39_916_800)));
};

const MAX_ITERATIONS = 60;
const RELATIVE_TOLERANCE = 1e-13;

export interface KeplerState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

/**
 * 把二体轨道状态解析地推进 dt 秒（dt 可为负）。
 * 对退化输入（r₀ = 0 或数值无效）原样返回输入，不产生 NaN。
 */
export const propagateKepler = (r0: Vec3, v0: Vec3, dt: number, mu: number = EARTH.MU): KeplerState => {
  const r0Mag = length(r0);
  if (!(r0Mag > 0) || !Number.isFinite(dt) || dt === 0) return { position: r0, velocity: v0 };

  const sqrtMu = Math.sqrt(mu);
  const vr0 = dot(r0, v0) / r0Mag;
  const alpha = 2 / r0Mag - dot(v0, v0) / mu;

  // 椭圆轨道：先去掉整数圈，改善初值与收敛
  let t = dt;
  if (alpha > 0) {
    const period = TWO_PI / (sqrtMu * Math.pow(alpha, 1.5));
    t = dt % period;
  }
  if (t === 0) return { position: r0, velocity: v0 };

  const kepler = (chi: number): number => {
    const z = alpha * chi * chi;
    return (r0Mag * vr0 * chi * chi * stumpffC(z)) / sqrtMu + (1 - alpha * r0Mag) * chi * chi * chi * stumpffS(z) + r0Mag * chi - sqrtMu * t;
  };
  const keplerDerivative = (chi: number): number => {
    const z = alpha * chi * chi;
    return (r0Mag * vr0 * chi * (1 - z * stumpffS(z))) / sqrtMu + (1 - alpha * r0Mag) * chi * chi * stumpffC(z) + r0Mag;
  };

  // 初值。椭圆：χ ≈ √μ·α·t；抛物线：χ ≈ √μ·t/r₀；
  // 双曲线：Vallado 给出的对数形式——线性初值在长时间跨度下会大到让 cosh/sinh 溢出。
  let chi: number;
  const sign = t > 0 ? 1 : -1;
  if (alpha > 1e-12 / r0Mag) {
    chi = sqrtMu * alpha * t;
  } else if (alpha < -1e-12 / r0Mag) {
    const a = 1 / alpha;
    const argument = (-2 * mu * alpha * t) / (dot(r0, v0) + sign * Math.sqrt(-mu * a) * (1 - r0Mag * alpha));
    chi = argument > 0 ? sign * Math.sqrt(-a) * Math.log(argument) : (sqrtMu * t) / r0Mag;
  } else {
    chi = (sqrtMu * t) / r0Mag;
  }
  // 对数初值是长时间跨度的渐近式：时间较短时对数的自变量 < 1，给出的 χ 与 t 反号，必须改用线性初值
  if (!Number.isFinite(chi) || chi === 0 || Math.sign(chi) !== sign) chi = (sqrtMu * t) / r0Mag;

  // 牛顿迭代，以逐步收紧的包围区间兜底。F(χ) 单调递增（F' = r > 0）且 F(0) = −√μ·t，
  // 所以根与 t 同号：一侧的界从一开始就是 0。
  let lo = t > 0 ? 0 : -Infinity;
  let hi = t > 0 ? Infinity : 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const f = kepler(chi);
    const slope = keplerDerivative(chi);
    let next: number;
    if (!Number.isFinite(f) || !Number.isFinite(slope) || slope <= 0) {
      // 溢出：|χ| 取得太大，向 0 收缩
      if (chi > 0) hi = Math.min(hi, chi);
      else lo = Math.max(lo, chi);
      next = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : chi / 2;
    } else {
      if (f > 0) hi = Math.min(hi, chi);
      else lo = Math.max(lo, chi);
      next = chi - f / slope;
      // 牛顿步跳出包围区间时改用二分（或在只有单侧界时加倍）
      if (!Number.isFinite(next) || next <= lo || next >= hi) {
        // 只有单侧界时朝着没有界的一侧加倍（根与 t 同号）
        next = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : t > 0 ? Math.max(2 * Math.abs(chi), 2 * lo) : Math.min(-2 * Math.abs(chi), 2 * hi);
      }
    }
    const converged = Math.abs(next - chi) <= RELATIVE_TOLERANCE * Math.max(1, Math.abs(next));
    chi = next;
    if (converged) break;
  }

  const z = alpha * chi * chi;
  const c = stumpffC(z);
  const s = stumpffS(z);
  const f = 1 - (chi * chi * c) / r0Mag;
  const g = t - (chi * chi * chi * s) / sqrtMu;
  const position = vec3(f * r0.x + g * v0.x, f * r0.y + g * v0.y, f * r0.z + g * v0.z);
  const rMag = length(position);
  const fDot = (sqrtMu * (z * s - 1) * chi) / (rMag * r0Mag);
  const gDot = 1 - (chi * chi * c) / rMag;
  return {
    position,
    velocity: vec3(fDot * r0.x + gDot * v0.x, fDot * r0.y + gDot * v0.y, fDot * r0.z + gDot * v0.z),
  };
};
