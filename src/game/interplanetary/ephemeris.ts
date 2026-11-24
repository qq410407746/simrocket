/**
 * 行星的近似日心位置与速度（JPL "Approximate Positions of the Planets" 的开普勒公式）。
 *
 * 坐标系：日心、J2000 平黄道与平春分点；单位 m、m/s。
 * 步骤（与 JPL 文档一致）：
 *   T = (JD − 2451545.0) / 36525
 *   每个根数 = 历元值 + 变化率 · T
 *   ω = ϖ − Ω，M = L − ϖ (+ b·T² + c·cos(f·T) + s·sin(f·T)，只用于 Table 2 的木星至海王星)
 *   解开普勒方程 M = E − e·sin E，x' = a(cos E − e)，y' = a√(1−e²)·sin E
 *   r = R_z(−Ω) R_x(−I) R_z(−ω) r'
 * 速度：对同一组根数求导，用 dE/dt = n / (1 − e·cos E)，n 取平黄经的变化率。
 * 时间：不区分 TDB 与 UTC（相差约 69 s，对行星位置可以忽略）。
 *
 * JPL 给出的名义误差（1800–2050，Table 1）：火星黄经约 40″，木星 400″，土星 600″；
 * Table 2（公元前 3000 – 公元 3000）误差大几倍。用于规划发射窗口足够，不能用于精确导航。
 */
import { ASTRO, DEG2RAD } from '../physics/constants';
import { type Vec3, vec3 } from '../physics/math/vec3';
import { type ElementTable, type PlanetId, findPlanet } from './planets';

const JULIAN_CENTURY_DAYS = 36_525;
const SECONDS_PER_CENTURY = JULIAN_CENTURY_DAYS * ASTRO.SECONDS_PER_DAY;

/** Table 1 的有效范围：1800-01-01 至 2050-12-31（儒略日）。 */
export const TABLE1_RANGE = { start: 2_378_496.5, end: 2_470_171.5 } as const;
/** Table 2 的有效范围：公元前 3000 年至公元 3000 年（儒略日，取整年）。 */
export const TABLE2_RANGE = { start: 625_673.5, end: 2_816_787.5 } as const;

export type EphemerisTable = 'table1' | 'table2';

/** 区间 [startJd, endJd] 全部落在 1800–2050 时用更精确的 Table 1，否则用 Table 2。 */
export const tableFor = (startJd: number, endJd: number): EphemerisTable =>
  startJd >= TABLE1_RANGE.start && endJd <= TABLE1_RANGE.end ? 'table1' : 'table2';

export const isWithinEphemeris = (jd: number): boolean => jd >= TABLE2_RANGE.start && jd <= TABLE2_RANGE.end;

export interface HeliocentricState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export interface PlanetElements {
  /** 半长轴 [m]。 */
  readonly a: number;
  readonly e: number;
  /** 倾角、升交点黄经、近日点幅角、平近点角 [rad]。 */
  readonly inclination: number;
  readonly node: number;
  readonly argumentOfPerihelion: number;
  readonly meanAnomaly: number;
  /** 平运动 [rad/s]（由平黄经的变化率得到）。 */
  readonly meanMotion: number;
}

/** 把角度规范到 [−180°, 180°)。 */
const wrapDegrees = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

export const planetElements = (id: PlanetId, jd: number, table: EphemerisTable = 'table1'): PlanetElements => {
  const data: ElementTable = findPlanet(id)[table];
  const t = (jd - ASTRO.JD_J2000) / JULIAN_CENTURY_DAYS;
  const [a0, e0, i0, l0, w0, n0] = data.epoch;
  const [a1, e1, i1, l1, w1, n1] = data.rate;
  const a = a0 + a1 * t;
  const e = e0 + e1 * t;
  const inclination = i0 + i1 * t;
  const meanLongitude = l0 + l1 * t;
  const perihelionLongitude = w0 + w1 * t;
  const node = n0 + n1 * t;
  let meanAnomaly = meanLongitude - perihelionLongitude;
  if (table === 'table2' && data.extra) {
    const [b, c, s, f] = data.extra;
    meanAnomaly += b * t * t + c * Math.cos(f * t * DEG2RAD) + s * Math.sin(f * t * DEG2RAD);
  }
  return {
    a: a * ASTRO.AU,
    e,
    inclination: inclination * DEG2RAD,
    node: node * DEG2RAD,
    argumentOfPerihelion: (perihelionLongitude - node) * DEG2RAD,
    meanAnomaly: wrapDegrees(meanAnomaly) * DEG2RAD,
    meanMotion: (l1 * DEG2RAD) / SECONDS_PER_CENTURY,
  };
};

/** 解开普勒方程 M = E − e·sin E（牛顿迭代，e < 1）。 */
export const solveKepler = (meanAnomaly: number, e: number): number => {
  let E = meanAnomaly + e * Math.sin(meanAnomaly);
  for (let i = 0; i < 50; i++) {
    const delta = (meanAnomaly - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += delta;
    if (Math.abs(delta) < 1e-14) break;
  }
  return E;
};

export const planetState = (id: PlanetId, jd: number, table: EphemerisTable = 'table1'): HeliocentricState => {
  const el = planetElements(id, jd, table);
  const E = solveKepler(el.meanAnomaly, el.e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const root = Math.sqrt(1 - el.e * el.e);
  const x = el.a * (cosE - el.e);
  const y = el.a * root * sinE;
  const eDot = el.meanMotion / (1 - el.e * cosE);
  const vx = -el.a * sinE * eDot;
  const vy = el.a * root * cosE * eDot;

  const cw = Math.cos(el.argumentOfPerihelion);
  const sw = Math.sin(el.argumentOfPerihelion);
  const cO = Math.cos(el.node);
  const sO = Math.sin(el.node);
  const cI = Math.cos(el.inclination);
  const sI = Math.sin(el.inclination);
  const m11 = cw * cO - sw * sO * cI;
  const m12 = -sw * cO - cw * sO * cI;
  const m21 = cw * sO + sw * cO * cI;
  const m22 = -sw * sO + cw * cO * cI;
  const m31 = sw * sI;
  const m32 = cw * sI;
  return {
    position: vec3(m11 * x + m12 * y, m21 * x + m22 * y, m31 * x + m32 * y),
    velocity: vec3(m11 * vx + m12 * vy, m21 * vx + m22 * vy, m31 * vx + m32 * vy),
  };
};

/** 黄道坐标 → 地球赤道坐标（J2000），绕 x 轴转黄赤交角。 */
export const eclipticToEquatorial = (v: Vec3): Vec3 => {
  const c = Math.cos(ASTRO.OBLIQUITY_J2000);
  const s = Math.sin(ASTRO.OBLIQUITY_J2000);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
};
