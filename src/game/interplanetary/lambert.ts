/**
 * 兰伯特问题：已知两点位置与飞行时间，求连接它们的二体轨道在两端的速度。
 *
 * 方法：普适变量法（Vallado, Fundamentals of Astrodynamics and Applications, Algorithm 58；Curtis, Algorithm 5.2），
 * 只求零圈（不绕中心天体整圈）的解。求根用带区间保护的牛顿迭代：飞行时间随 ψ 单调递增，
 * 每次求值都收紧 [low, high]；牛顿步（解析导数，Curtis 式 5.43）跳出区间或无效时退回二分，因此不会发散。
 * 一般 4–8 次迭代收敛，比纯二分（约 40 次）快得多；收敛标准不变（飞行时间相对误差 1e-9）。
 * 方向：prograde = true 时取与 z 轴同向旋转（日心黄道坐标里就是与行星公转同向）的那一支。
 */
import { stumpffC, stumpffS } from '../physics/orbital/kepler';
import { type Vec3, cross, dot, length, scale, sub } from '../physics/math/vec3';

export interface LambertSolution {
  readonly v1: Vec3;
  readonly v2: Vec3;
  /** 转移角 [rad]。 */
  readonly transferAngle: number;
}

const MAX_ITERATIONS = 200;
/** |ψ| 小于该值时用 ψ = 0 处的导数公式（一般公式在 ψ → 0 时是 0/0）。只影响牛顿步的快慢，不影响结果。 */
const SMALL_PSI = 1e-4;

export const solveLambert = (r1: Vec3, r2: Vec3, dt: number, mu: number, prograde = true): LambertSolution | null => {
  const r1m = length(r1);
  const r2m = length(r2);
  if (!(r1m > 0) || !(r2m > 0) || !(dt > 0)) return null;
  const cosAngle = Math.min(1, Math.max(-1, dot(r1, r2) / (r1m * r2m)));
  let angle = Math.acos(cosAngle);
  const hz = cross(r1, r2).z;
  if ((prograde && hz < 0) || (!prograde && hz >= 0)) angle = 2 * Math.PI - angle;
  const sinAngle = Math.sin(angle);
  const A = sinAngle * Math.sqrt((r1m * r2m) / (1 - cosAngle));
  // 转移角接近 0° 或 180° 时轨道面不确定
  if (!Number.isFinite(A) || Math.abs(A) < 1e-9 * Math.sqrt(r1m * r2m)) return null;

  const sqrtMu = Math.sqrt(mu);
  let low = -4 * Math.PI;
  let high = 4 * Math.PI * Math.PI;
  let psi = 0;
  let y = 0;
  let c2 = stumpffC(psi);
  let c3 = stumpffS(psi);
  let converged = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    y = r1m + r2m + (A * (psi * c3 - 1)) / Math.sqrt(c2);
    if (A > 0 && y < 0) {
      // y 必须为正：把下界抬高
      low = psi;
      psi = (low + high) / 2;
      c2 = stumpffC(psi);
      c3 = stumpffS(psi);
      continue;
    }
    const sqrtY = Math.sqrt(y);
    const chi3 = (y / c2) * Math.sqrt(y / c2);
    const t = (chi3 * c3 + A * sqrtY) / sqrtMu;
    if (Math.abs(t - dt) <= 1e-9 * dt) {
      converged = true;
      break;
    }
    if (t <= dt) low = psi;
    else high = psi;
    if (high - low < 1e-14) {
      converged = Math.abs(t - dt) <= 1e-6 * dt;
      break;
    }
    // dF/dψ，F(ψ) = √μ·(t(ψ) − Δt)
    const slope =
      Math.abs(psi) > SMALL_PSI
        ? chi3 * ((c2 - (1.5 * c3) / c2) / (2 * psi) + (0.75 * c3 * c3) / c2) + (A / 8) * ((3 * c3 * sqrtY) / c2 + A * Math.sqrt(c2 / y))
        : (Math.SQRT2 / 40) * y * sqrtY + (A / 8) * (sqrtY + A * Math.sqrt(1 / (2 * y)));
    let next = psi - (sqrtMu * (t - dt)) / slope;
    if (!Number.isFinite(next) || next <= low || next >= high) next = (low + high) / 2;
    psi = next;
    c2 = stumpffC(psi);
    c3 = stumpffS(psi);
  }
  if (!converged || !(y > 0)) return null;

  const f = 1 - y / r1m;
  const g = A * Math.sqrt(y / mu);
  const gDot = 1 - y / r2m;
  return {
    v1: scale(sub(r2, scale(r1, f)), 1 / g),
    v2: scale(sub(scale(r2, gDot), r1), 1 / g),
    transferAngle: angle,
  };
};
