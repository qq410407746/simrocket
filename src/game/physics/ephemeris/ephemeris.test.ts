import { describe, expect, it } from 'vitest';
import { ASTRO, DEG2RAD, EARTH, RAD2DEG, SIDEREAL_DAY, TWO_PI } from '../constants';
import { length } from '../math/vec3';
import { sunDirectionEci } from './sun';
import { enuBasisAt, ecefToEci, geodeticToEcef } from '../frames/frames';
import { dot } from '../math/vec3';
import {
  greenwichMeanSiderealTime,
  julianDateAt,
  julianDateForLocalSolarTime,
  julianDateFromUnixMs,
  unixMsFromJulianDate,
  wrapTwoPi,
} from './time';

describe('时间系统', () => {
  it('J2000.0 = 2000-01-01T12:00:00Z = JD 2451545.0', () => {
    expect(julianDateFromUnixMs(Date.UTC(2000, 0, 1, 12, 0, 0))).toBe(ASTRO.JD_J2000);
  });

  it('儒略日 ↔ Unix 时间往返', () => {
    const ms = Date.UTC(2026, 10, 14, 8, 30, 15);
    expect(unixMsFromJulianDate(julianDateFromUnixMs(ms))).toBeCloseTo(ms, 0);
  });

  it('julianDateAt 按秒推进', () => {
    expect(julianDateAt(ASTRO.JD_J2000, 43_200)).toBeCloseTo(ASTRO.JD_J2000 + 0.5, 12);
  });

  it('wrapTwoPi 归一化到 [0, 2π)', () => {
    expect(wrapTwoPi(-0.1)).toBeCloseTo(TWO_PI - 0.1, 12);
    expect(wrapTwoPi(TWO_PI + 0.2)).toBeCloseTo(0.2, 12);
  });
});

describe('格林尼治恒星时', () => {
  it('J2000.0 时刻 GMST = 280.46061837°', () => {
    expect(greenwichMeanSiderealTime(ASTRO.JD_J2000) * RAD2DEG).toBeCloseTo(280.46061837, 8);
  });

  it('参考值：1987-04-10 19:21:00 UT → GMST = 128.7378734°（Meeus 例 12.b）', () => {
    const jd = julianDateFromUnixMs(Date.UTC(1987, 3, 10, 19, 21, 0));
    expect(greenwichMeanSiderealTime(jd) * RAD2DEG).toBeCloseTo(128.7378734, 5);
  });

  it('一个恒星日后 GMST 回到原值（与 EARTH.ROTATION_RATE 自洽）', () => {
    const jd0 = julianDateFromUnixMs(Date.UTC(2026, 5, 1, 0, 0, 0));
    const a = greenwichMeanSiderealTime(jd0);
    const b = greenwichMeanSiderealTime(jd0 + SIDEREAL_DAY / ASTRO.SECONDS_PER_DAY);
    const diff = Math.abs(wrapTwoPi(b - a + Math.PI) - Math.PI);
    // 两个来源的自转速率相差约 1e-7（GMST 含岁差），一天内累积误差 < 1e-5 rad。
    expect(diff).toBeLessThan(1e-5);
    expect(TWO_PI / SIDEREAL_DAY).toBeCloseTo(EARTH.ROTATION_RATE, 15);
  });
});

describe('太阳方向', () => {
  const declination = (jd: number) => Math.asin(sunDirectionEci(jd).z) * RAD2DEG;

  it('返回单位向量', () => {
    for (const month of [0, 3, 6, 9]) {
      expect(length(sunDirectionEci(julianDateFromUnixMs(Date.UTC(2026, month, 15))))).toBeCloseTo(1, 12);
    }
  });

  it('春分时太阳位于 +X 方向附近，赤纬约为 0', () => {
    // 2026 年春分：3 月 20 日 14:46 UTC
    const jd = julianDateFromUnixMs(Date.UTC(2026, 2, 20, 14, 46));
    const dir = sunDirectionEci(jd);
    expect(dir.x).toBeGreaterThan(0.9999);
    expect(Math.abs(declination(jd))).toBeLessThan(0.02);
  });

  it('夏至赤纬约 +23.44°，冬至约 −23.44°', () => {
    // 2026 年夏至 6 月 21 日 08:24 UTC；冬至 12 月 21 日 20:50 UTC
    expect(declination(julianDateFromUnixMs(Date.UTC(2026, 5, 21, 8, 24)))).toBeCloseTo(23.44, 1);
    expect(declination(julianDateFromUnixMs(Date.UTC(2026, 11, 21, 20, 50)))).toBeCloseTo(-23.44, 1);
  });

  it('秋分时太阳位于 −X 方向附近', () => {
    // 2026 年秋分：9 月 23 日 00:05 UTC
    const dir = sunDirectionEci(julianDateFromUnixMs(Date.UTC(2026, 8, 23, 0, 5)));
    expect(dir.x).toBeLessThan(-0.9999);
  });

  it('黄赤交角常量与星历一致', () => {
    expect(ASTRO.OBLIQUITY_J2000 / DEG2RAD).toBeCloseTo(23.4393, 3);
  });
});

describe('地方太阳时', () => {
  it('本初子午线上地方时即 UTC', () => {
    expect(julianDateForLocalSolarTime(2026, 4, 12, 12, 0)).toBe(julianDateFromUnixMs(Date.UTC(2026, 3, 12, 12)));
  });

  it('西经 90° 的地方正午对应 UTC 18 时', () => {
    expect(julianDateForLocalSolarTime(2026, 4, 12, 12, -90 * DEG2RAD)).toBeCloseTo(
      julianDateFromUnixMs(Date.UTC(2026, 3, 12, 18)),
      9,
    );
  });

  it('端到端：地方正午时太阳位于当地子午面附近且高度角为正', () => {
    // 把 GMST、地固→惯性转换、太阳星历串起来验证：正午太阳应在正南/正北方向（东向分量≈0）。
    for (const [latDeg, lonDeg] of [[28.5, -80.6], [19.61, 110.95], [45.96, 63.31]] as const) {
      const jd = julianDateForLocalSolarTime(2026, 4, 12, 12, lonDeg * DEG2RAD);
      const site = ecefToEci(
        geodeticToEcef({ latitude: latDeg * DEG2RAD, longitude: lonDeg * DEG2RAD, altitude: 0 }),
        greenwichMeanSiderealTime(jd),
      );
      const { east, up } = enuBasisAt(site);
      const sun = sunDirectionEci(jd);
      // 均时差（4 月中旬约 −1 min）与公式近似带来 < 1° 的方位偏差
      expect(Math.abs(dot(sun, east))).toBeLessThan(0.02);
      expect(dot(sun, up)).toBeGreaterThan(0.5);
    }
  });

  it('端到端：地方时 0 点太阳在地平线以下', () => {
    const lon = 110.95 * DEG2RAD;
    const jd = julianDateForLocalSolarTime(2026, 4, 12, 0, lon);
    const site = ecefToEci(geodeticToEcef({ latitude: 19.61 * DEG2RAD, longitude: lon, altitude: 0 }), greenwichMeanSiderealTime(jd));
    expect(dot(sunDirectionEci(jd), enuBasisAt(site).up)).toBeLessThan(-0.5);
  });
});
