/**
 * 兰伯特问题：已知两点位置与飞行时间，求连接它们的二体轨道在两端的速度。
 *
 * 方法：普适变量法 + 二分法（Vallado, Fundamentals of Astrodynamics and Applications, Algorithm 58），
 * 只求零圈（不绕中心天体整圈）的解；用二分而不是牛顿迭代，牺牲一点速度换取不会发散。
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
    const chi = Math.sqrt(y / c2);
    const t = (chi * chi * chi * c3 + A * Math.sqrt(y)) / sqrtMu;
    if (Math.abs(t - dt) <= 1e-9 * dt) {
      converged = true;
      break;
    }
    if (t <= dt) low = psi;
    else high = psi;
    psi = (low + high) / 2;
    c2 = stumpffC(psi);
    c3 = stumpffS(psi);
    if (high - low < 1e-14) {
      converged = Math.abs(t - dt) <= 1e-6 * dt;
      break;
    }
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
