import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '@/game/physics/constants';
import { julianDateFromUnixMs } from '@/game/physics/ephemeris/time';
import {
  formatAngle,
  formatDistance,
  formatDuration,
  formatForce,
  formatLatitude,
  formatLongitude,
  formatMass,
  formatNumber,
  formatSpeed,
  formatUtc,
} from './format';

describe('显示格式化', () => {
  it('距离按量级切换单位', () => {
    expect(formatDistance(28.44)).toEqual({ value: '28.4', unit: 'm' });
    expect(formatDistance(2500)).toEqual({ value: '2,500', unit: 'm' });
    expect(formatDistance(123_456)).toEqual({ value: '123.46', unit: 'km' });
    expect(formatDistance(35_786_000)).toEqual({ value: '35,786', unit: 'km' });
  });

  it('速度不显示 −0.0', () => {
    expect(formatSpeed(-0.0000001).value).toBe('0.0');
    expect(formatSpeed(7654.321)).toEqual({ value: '7,654.3', unit: 'm/s' });
  });

  it('质量与力', () => {
    expect(formatMass(532_200)).toEqual({ value: '532.2', unit: 't' });
    expect(formatMass(1800)).toEqual({ value: '1,800', unit: 'kg' });
    expect(formatForce(7_324_733)).toEqual({ value: '7,325', unit: 'kN' });
    expect(formatForce(35_000_000)).toEqual({ value: '35.00', unit: 'MN' });
  });

  it('角度与经纬度', () => {
    expect(formatAngle(Math.PI / 2)).toBe('90.0');
    expect(formatAngle(null)).toBe('—');
    expect(formatLatitude(28.5 * DEG2RAD)).toBe('28.50° N');
    expect(formatLatitude(-5.24 * DEG2RAD)).toBe('5.24° S');
    expect(formatLongitude(-80.6 * DEG2RAD)).toBe('80.60° W');
    expect(formatLongitude(110.95 * DEG2RAD)).toBe('110.95° E');
  });

  it('时长', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3725.9)).toBe('01:02:05');
    expect(formatDuration(90_061)).toBe('1d 01:01:01');
  });

  it('UTC 时间', () => {
    expect(formatUtc(julianDateFromUnixMs(Date.UTC(2026, 3, 12, 14, 52, 24)))).toBe('2026-04-12 14:52:24 UTC');
  });

  it('无效数值显示为占位符而不是 NaN', () => {
    expect(formatDistance(NaN).value).toBe('—');
    expect(formatSpeed(Infinity).value).toBe('—');
    expect(formatMass(NaN).value).toBe('—');
    expect(formatForce(NaN).value).toBe('—');
    expect(formatNumber(NaN, 2)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
    expect(formatUtc(NaN)).toBe('—');
    expect(formatLatitude(NaN)).toBe('—');
  });
});
