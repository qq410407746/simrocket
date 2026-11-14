/**
 * 太阳方向（低精度星历）。
 *
 * 公式来源：The Astronomical Almanac, "Low precision formulas for the Sun's coordinates"。
 *   n  = JD − 2451545.0
 *   L  = 280.460° + 0.9856474°·n          （平黄经）
 *   g  = 357.528° + 0.9856003°·n          （平近点角）
 *   λ  = L + 1.915°·sin g + 0.020°·sin 2g （视黄经）
 *   ε  = 23.439° − 0.0000004°·n           （黄赤交角）
 *   方向 = (cos λ, cos ε·sin λ, sin ε·sin λ)   （地心赤道坐标 = 本项目的 ECI）
 * 精度：1950–2050 年间约 0.01°。
 * 用途：昼夜光照、晨昏线、飞行器光照；后续用于太阳同步轨道与热辐射环境。
 */
import { ASTRO, DEG2RAD } from '../constants';
import { type Vec3, vec3 } from '../math/vec3';

/** 给定儒略日，返回地心指向太阳的单位向量（ECI）。 */
export const sunDirectionEci = (jd: number): Vec3 => {
  const n = jd - ASTRO.JD_J2000;
  const meanLongitude = (280.46 + 0.9856474 * n) * DEG2RAD;
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG2RAD;
  const eclipticLongitude =
    meanLongitude + (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG2RAD;
  const obliquity = (23.439 - 0.0000004 * n) * DEG2RAD;
  const sinLon = Math.sin(eclipticLongitude);
  return vec3(Math.cos(eclipticLongitude), Math.cos(obliquity) * sinLon, Math.sin(obliquity) * sinLon);
};
