import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '@/game/physics/constants';
import { julianDateFromUnixMs } from '@/game/physics/ephemeris/time';
import {
  formatAngle,
  formatApsis,
  formatCountdown,
  formatDistance,
  formatDuration,
  formatForce,
  formatLatitude,
  formatLongitude,
  formatMass,
  formatMissionTime,
  formatNumber,
  formatPressure,
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

  it('压力与任务时间', () => {
    expect(formatPressure(38_912)).toEqual({ value: '38.91', unit: 'kPa' });
    expect(formatPressure(12.34)).toEqual({ value: '12.3', unit: 'Pa' });
    expect(formatPressure(NaN).value).toBe('—');
    expect(formatMissionTime(null)).toBe('T− 00:00:00');
    expect(formatMissionTime(152.6)).toBe('T+ 00:02:32');
  });

  it('倒计时与拱点高度', () => {
    expect(formatCountdown(12.4)).toBe('12 s');
    expect(formatCountdown(185)).toBe('3 m 05 s');
    expect(formatCountdown(5_230)).toBe('1 h 27 m');
    expect(formatCountdown(183_600)).toBe('2 d 03 h');
    expect(formatCountdown(null)).toBe('—');
    expect(formatCountdown(NaN)).toBe('—');
    expect(formatApsis(202_812)).toEqual({ value: '202.8', unit: 'km' });
    expect(formatApsis(-6_099_000)).toEqual({ value: '-6,099.0', unit: 'km' });
    expect(formatApsis(35_786_000)).toEqual({ value: '35,786', unit: 'km' });
    expect(formatApsis(Infinity).value).toBe('∞');
    expect(formatApsis(NaN).value).toBe('—');
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
