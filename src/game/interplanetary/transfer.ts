/**
 * 行星际转移的发射窗口计算（拼接圆锥近似）。
 *
 * 1. 日心段：出发时地球位置 → 到达时目标行星位置，用兰伯特问题求转移轨道两端的速度。
 * 2. 出发：相对地球的剩余速度 v∞ = v₁ − v地球，C3 = v∞²。从圆形停泊轨道（半径 rₚ）一次点火逃逸：
 *      Δv出发 = √(v∞² + 2μ/rₚ) − √(μ/rₚ)
 * 3. 到达：相对目标的剩余速度 v∞ = v₂ − v目标。在近星点 rₚ 一次点火：
 *      飞掠：不需要减速；
 *      进入圆轨道：Δv = √(v∞² + 2μ/rₚ) − √(μ/rₚ)
 *      进入大椭圆捕获轨道（远星点 r_a = 20 倍行星半径，本游戏的统一约定）：
 *        Δv = √(v∞² + 2μ/rₚ) − √(2μ/rₚ − 2μ/(rₚ + r_a))
 *      真实任务多先进入大椭圆轨道，再慢慢降低（或用大气减速）。
 * 4. 出发渐近线赤纬（DLA）：v∞ 方向相对地球赤道的纬度。停泊轨道倾角至少要等于 |DLA|。
 *
 * 只算直接转移（不借力飞越其他行星），零圈兰伯特解，脉冲点火，不计地球与目标的大气。
 */
import { ASTRO, EARTH } from '../physics/constants';
import { length, sub } from '../physics/math/vec3';
import { type EphemerisTable, eclipticToEquatorial, planetState } from './ephemeris';
import { solveLambert } from './lambert';
import { type PlanetId, SUN_MU, findPlanet } from './planets';

export type ArrivalMode = 'flyby' | 'capture' | 'circular';

/** 大椭圆捕获轨道的远星点半径 = 行星赤道半径 × 这个倍数。 */
export const CAPTURE_APOAPSIS_RADII = 20;

export interface TransferOptions {
  /** 地球停泊轨道高度 [m]。 */
  readonly parkingAltitude: number;
  readonly arrival: ArrivalMode;
  /** 到达后环绕轨道的近星点高度 [m]（飞掠时不用）。 */
  readonly captureAltitude: number;
  readonly table: EphemerisTable;
}

export interface Transfer {
  readonly departureJd: number;
  readonly arrivalJd: number;
  /** 飞行时间 [s]。 */
  readonly flightTime: number;
  /** 出发剩余速度 [m/s] 与 C3 [m²/s²]。 */
  readonly departureVInf: number;
  readonly c3: number;
  /** 出发渐近线赤纬 [rad]。 */
  readonly declination: number;
  /** 从停泊轨道出发的 Δv [m/s]。 */
  readonly departureDeltaV: number;
  /** 到达剩余速度 [m/s]。 */
  readonly arrivalVInf: number;
  /** 进入环绕轨道（大椭圆或圆轨道）的 Δv [m/s]；飞掠时为 0。 */
  readonly captureDeltaV: number;
  /** 出发 + 到达的总 Δv [m/s]。 */
  readonly totalDeltaV: number;
  /** 日心转移角 [rad]。 */
  readonly transferAngle: number;
}

/** 推荐的到达轨道高度 [m]：内行星取低轨道；气态巨行星取赤道半径的 10%（只作参考的统一约定）。 */
export const DEFAULT_CAPTURE_ALTITUDE: Record<PlanetId, number> = {
  mercury: 200_000,
  venus: 300_000,
  earth: 200_000,
  mars: 300_000,
  jupiter: 7_149_200,
  saturn: 6_026_800,
  uranus: 2_555_900,
  neptune: 2_476_400,
};

/** 在半径 radius 处，从剩余速度 vInf 的双曲线变成圆轨道（或从圆轨道逃逸）的 Δv。 */
export const hyperbolicBurn = (vInf: number, mu: number, radius: number): number =>
  Math.sqrt(vInf * vInf + (2 * mu) / radius) - Math.sqrt(mu / radius);

/** 在近星点 periapsis 处，从双曲线变成远星点为 apoapsis 的椭圆的 Δv。 */
export const ellipticCaptureBurn = (vInf: number, mu: number, periapsis: number, apoapsis: number): number =>
  Math.sqrt(vInf * vInf + (2 * mu) / periapsis) - Math.sqrt((2 * mu) / periapsis - (2 * mu) / (periapsis + apoapsis));

export const captureBurn = (target: PlanetId, mode: ArrivalMode, vInf: number, altitude: number): number => {
  if (mode === 'flyby') return 0;
  const body = findPlanet(target);
  const periapsis = body.equatorialRadius + altitude;
  if (mode === 'circular') return hyperbolicBurn(vInf, body.mu, periapsis);
  return ellipticCaptureBurn(vInf, body.mu, periapsis, Math.max(periapsis, CAPTURE_APOAPSIS_RADII * body.equatorialRadius));
};

export const computeTransfer = (target: PlanetId, departureJd: number, arrivalJd: number, options: TransferOptions): Transfer | null => {
  const flightTime = (arrivalJd - departureJd) * ASTRO.SECONDS_PER_DAY;
  if (!(flightTime > 0)) return null;
  const earth = planetState('earth', departureJd, options.table);
  const planet = planetState(target, arrivalJd, options.table);
  const solution = solveLambert(earth.position, planet.position, flightTime, SUN_MU, true);
  if (!solution) return null;
  const vInfDep = sub(solution.v1, earth.velocity);
  const vInfArr = sub(solution.v2, planet.velocity);
  const departureVInf = length(vInfDep);
  const arrivalVInf = length(vInfArr);
  const parkingRadius = EARTH.RADIUS + options.parkingAltitude;
  const departureDeltaV = hyperbolicBurn(departureVInf, EARTH.MU, parkingRadius);
  const captureDeltaV = captureBurn(target, options.arrival, arrivalVInf, options.captureAltitude);
  const equatorial = eclipticToEquatorial(vInfDep);
  return {
    departureJd,
    arrivalJd,
    flightTime,
    departureVInf,
    c3: departureVInf * departureVInf,
    declination: Math.asin(Math.max(-1, Math.min(1, equatorial.z / departureVInf))),
    departureDeltaV,
    arrivalVInf,
    captureDeltaV,
    totalDeltaV: departureDeltaV + captureDeltaV,
    transferAngle: solution.transferAngle,
  };
};

/** 两个圆轨道之间的霍曼转移时间 [s]，用来确定飞行时间的搜索范围。 */
export const hohmannTime = (target: PlanetId): number => {
  const a1 = findPlanet('earth').table1.epoch[0] * ASTRO.AU;
  const a2 = findPlanet(target).table1.epoch[0] * ASTRO.AU;
  const a = (a1 + a2) / 2;
  return Math.PI * Math.sqrt((a * a * a) / SUN_MU);
};

/** 会合周期 [s]：同一种相对位置（即发射窗口）重复出现的间隔。 */
export const synodicPeriod = (target: PlanetId): number => {
  const n1 = findPlanet('earth').table1.rate[3];
  const n2 = findPlanet(target).table1.rate[3];
  // 平黄经变化率 [°/世纪] → 周期
  return (360 / Math.abs(n1 - n2)) * 36_525 * ASTRO.SECONDS_PER_DAY;
};

/**
 * 飞行时间的搜索范围 [天]：霍曼时间的 0.45–1.25 倍。
 * 上限不再放宽：对外行星，飞得越慢到达时越省，最优解会一直贴着上限（海王星可达几十年），失去参考意义。
 */
export const FLIGHT_TIME_FACTORS = { min: 0.45, max: 1.25 } as const;
export const flightTimeRange = (target: PlanetId): { readonly min: number; readonly max: number } => {
  const days = hohmannTime(target) / ASTRO.SECONDS_PER_DAY;
  return { min: Math.max(40, FLIGHT_TIME_FACTORS.min * days), max: FLIGHT_TIME_FACTORS.max * days };
};
