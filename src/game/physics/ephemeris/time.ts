/**
 * 时间系统与地球定向。
 *
 * 简化：不区分 UTC / UT1 / TT（差值 < 70 s，对游戏内的昼夜与发射窗口可忽略）。
 */
import { ASTRO, DEG2RAD, TWO_PI } from '../constants';

const UNIX_EPOCH_JD = 2_440_587.5;
const MS_PER_DAY = ASTRO.SECONDS_PER_DAY * 1000;

/** Unix 毫秒时间戳 → 儒略日。 */
export const julianDateFromUnixMs = (ms: number): number => ms / MS_PER_DAY + UNIX_EPOCH_JD;

/** 儒略日 → Unix 毫秒时间戳。 */
export const unixMsFromJulianDate = (jd: number): number => (jd - UNIX_EPOCH_JD) * MS_PER_DAY;

/** 历元儒略日 + 模拟时间 [s] → 当前儒略日。 */
export const julianDateAt = (epochJd: number, simTime: number): number =>
  epochJd + simTime / ASTRO.SECONDS_PER_DAY;

/** 把角度归一化到 [0, 2π)。 */
export const wrapTwoPi = (angle: number): number => {
  const a = angle % TWO_PI;
  const b = a < 0 ? a + TWO_PI : a;
  // 极小的负数加 2π 后会舍入成恰好 2π
  return b >= TWO_PI ? 0 : b;
};

/**
 * 格林尼治平恒星时角 GMST [rad]，范围 [0, 2π)。
 *
 * 公式（Meeus, Astronomical Algorithms, 式 12.4；IAU 1982）：
 *   θ = 280.46061837° + 360.98564736629°·(JD − 2451545.0) + 0.000387933°·T² − T³/38710000°
 *   其中 T 为自 J2000.0 起的儒略世纪数。
 * 精度：对 1900–2100 年优于 0.1 角秒，远超游戏需要。
 */
export const greenwichMeanSiderealTime = (jd: number): number => {
  const d = jd - ASTRO.JD_J2000;
  const t = d / 36_525;
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38_710_000;
  return wrapTwoPi(deg * DEG2RAD);
};

/**
 * 求给定 UTC 日期上、经度 longitude [rad] 处"地方平太阳时"为 localHours [h] 的时刻（儒略日）。
 * 地方平太阳时 = UTC + 经度/15°。用于为发射场选择一个光照合适的默认发射时刻。
 * 忽略均时差（±16 min）。
 */
export const julianDateForLocalSolarTime = (
  year: number,
  month: number,
  day: number,
  localHours: number,
  longitude: number,
): number => {
  const utcHours = localHours - longitude / DEG2RAD / 15;
  return julianDateFromUnixMs(Date.UTC(year, month - 1, day) + utcHours * 3_600_000);
};
