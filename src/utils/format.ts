/**
 * 显示层的单位换算与格式化。核心计算一律使用 SI；只有在这里才换成 km、t、kN、° 等便于阅读的单位。
 */
import { RAD2DEG } from '@/game/physics/constants';
import { unixMsFromJulianDate } from '@/game/physics/ephemeris/time';

export interface Formatted {
  readonly value: string;
  readonly unit: string;
}

const PLACEHOLDER = '—';

const fixed = (x: number, digits: number): string =>
  x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 距离/高度：< 10 km 用米，否则用千米。 */
export const formatDistance = (metres: number): Formatted => {
  if (!Number.isFinite(metres)) return { value: PLACEHOLDER, unit: 'm' };
  const abs = Math.abs(metres);
  if (abs < 10_000) return { value: fixed(metres, abs < 1000 ? 1 : 0), unit: 'm' };
  if (abs < 1_000_000) return { value: fixed(metres / 1000, 2), unit: 'km' };
  return { value: fixed(metres / 1000, 0), unit: 'km' };
};

/** 速度：< 10 km/s 以内统一用 m/s（航天习惯），保留一位小数。 */
export const formatSpeed = (mps: number): Formatted => {
  if (!Number.isFinite(mps)) return { value: PLACEHOLDER, unit: 'm/s' };
  // 消除 −0.0 的显示
  const v = Math.abs(mps) < 0.05 ? 0 : mps;
  return { value: fixed(v, 1), unit: 'm/s' };
};

/** 质量：≥ 10 t 用吨。 */
export const formatMass = (kg: number): Formatted => {
  if (!Number.isFinite(kg)) return { value: PLACEHOLDER, unit: 'kg' };
  if (Math.abs(kg) >= 10_000) return { value: fixed(kg / 1000, 1), unit: 't' };
  return { value: fixed(kg, 0), unit: 'kg' };
};

/** 力：kN 或 MN。 */
export const formatForce = (newtons: number): Formatted => {
  if (!Number.isFinite(newtons)) return { value: PLACEHOLDER, unit: 'kN' };
  if (Math.abs(newtons) >= 1e7) return { value: fixed(newtons / 1e6, 2), unit: 'MN' };
  return { value: fixed(newtons / 1000, 0), unit: 'kN' };
};

export const formatNumber = (x: number, digits: number): string => (Number.isFinite(x) ? fixed(x, digits) : PLACEHOLDER);

/** 角度（弧度输入）→ 度。 */
export const formatAngle = (radians: number | null, digits = 1): string =>
  radians === null || !Number.isFinite(radians) ? PLACEHOLDER : fixed(radians * RAD2DEG, digits);

/** 纬度："28.50° N"。 */
export const formatLatitude = (radians: number): string => {
  if (!Number.isFinite(radians)) return PLACEHOLDER;
  const deg = radians * RAD2DEG;
  return `${fixed(Math.abs(deg), 2)}° ${deg >= 0 ? 'N' : 'S'}`;
};

/** 经度："80.60° W"。 */
export const formatLongitude = (radians: number): string => {
  if (!Number.isFinite(radians)) return PLACEHOLDER;
  const deg = radians * RAD2DEG;
  return `${fixed(Math.abs(deg), 2)}° ${deg >= 0 ? 'E' : 'W'}`;
};

const pad2 = (n: number): string => String(Math.floor(n)).padStart(2, '0');

/** 时长 → "HH:MM:SS"（超过一天时为 "Dd HH:MM:SS"）。 */
export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return PLACEHOLDER;
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const clock = `${pad2((s % 86_400) / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
};

/** 儒略日 → "2026-04-12 14:52:24 UTC"。 */
export const formatUtc = (julianDate: number): string => {
  const ms = unixMsFromJulianDate(julianDate);
  if (!Number.isFinite(ms)) return PLACEHOLDER;
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`
  );
};
