/**
 * 二体（质点）引力模型。
 *
 * 公式：a = −μ·r / |r|³        （牛顿万有引力，中心天体视为质点/球对称）
 * 单位：r [m] → a [m/s²]
 * 适用：地球外部（|r| ≥ R）。忽略 J2 及更高阶带谐项、第三体（日、月）引力。
 *       J2 摄动计划在专家模式中加入（见 ROADMAP.md）。
 */
import { EARTH } from '../constants';
import { type Vec3, ZERO, length, scale } from '../math/vec3';

/** 引力加速度矢量 [m/s²]。r 为相对地心的位置（ECI 或 ECEF 均可）。地心处返回零向量。 */
export const gravityAcceleration = (r: Vec3, mu: number = EARTH.MU): Vec3 => {
  const d = length(r);
  if (d === 0) return ZERO;
  return scale(r, -mu / (d * d * d));
};

/** 距地心 radius [m] 处的引力加速度大小 [m/s²]。 */
export const gravityMagnitude = (radius: number, mu: number = EARTH.MU): number => mu / (radius * radius);
