/**
 * 行星际发射窗口：星历、兰伯特求解器、转移 Δv 与窗口搜索。
 * 参考值来自教科书例题、已知的行星冲日日期，以及真实火星/金星任务的发射日期。
 */
import { describe, expect, it } from 'vitest';
import { ASTRO, DEG2RAD, RAD2DEG } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import { sunDirectionEci } from '../physics/ephemeris/sun';
import { angleBetween, length, negate, vec3 } from '../physics/math/vec3';
import { propagateKepler } from '../physics/orbital/kepler';
import { TABLE1_RANGE, eclipticToEquatorial, planetElements, planetState, tableFor } from './ephemeris';
import { solveLambert } from './lambert';
import { DESTINATIONS, PLANETS, SUN_MU } from './planets';
import { DEFAULT_CAPTURE_ALTITUDE, computeTransfer, hohmannTime, synodicPeriod } from './transfer';
import { porkchop, searchWindows } from './windows';

const jd = (y: number, m: number, d: number) => julianDateFromUnixMs(Date.UTC(y, m - 1, d));
const DAY = ASTRO.SECONDS_PER_DAY;

/** 日心黄经 [°]。 */
const longitude = (id: Parameters<typeof planetState>[0], t: number) => {
  const p = planetState(id, t).position;
  return Math.atan2(p.y, p.x) * RAD2DEG;
};
const angleDiff = (a: number, b: number) => Math.abs((((a - b + 540) % 360) + 360) % 360 - 180);

describe('近似星历', () => {
  it('地球的日心位置与项目里独立的太阳方向公式一致（扣除岁差后相差 < 0.03°）', () => {
    // 太阳方向公式给的是瞬时春分点的黄经，比 J2000 坐标每年多约 50.29″（岁差）
    for (const t of [jd(2000, 1, 1), jd(2026, 3, 20), jd(2026, 11, 24), jd(2040, 7, 1)]) {
      const earth = eclipticToEquatorial(planetState('earth', t).position);
      const precession = (50.29 / 3600) * ((t - ASTRO.JD_J2000) / 365.25);
      expect(Math.abs(angleBetween(negate(earth), sunDirectionEci(t)) * RAD2DEG - Math.abs(precession))).toBeLessThan(0.03);
    }
  });

  it('行星冲日时与地球的日心黄经相同（误差 < 1°）', () => {
    // 冲日日期：火星 2018-07-27、2020-10-13、2025-01-16；木星 2023-11-03；土星 2023-08-27
    const cases = [
      ['mars', jd(2018, 7, 27)],
      ['mars', jd(2020, 10, 13)],
      ['mars', jd(2025, 1, 16)],
      ['jupiter', jd(2023, 11, 3)],
      ['saturn', jd(2023, 8, 27)],
    ] as const;
    for (const [id, t] of cases) expect(angleDiff(longitude(id, t), longitude('earth', t)), `${id}`).toBeLessThan(1);
  });

  it('日心距离在近日点与远日点之间，速度与活力公式一致', () => {
    const t = jd(2030, 1, 1);
    for (const planet of PLANETS) {
      const el = planetElements(planet.id, t);
      const s = planetState(planet.id, t);
      const r = length(s.position);
      expect(r).toBeGreaterThanOrEqual(el.a * (1 - el.e) * 0.999999);
      expect(r).toBeLessThanOrEqual(el.a * (1 + el.e) * 1.000001);
      const visViva = Math.sqrt(SUN_MU * (2 / r - 1 / el.a));
      expect(Math.abs(length(s.velocity) - visViva) / visViva).toBeLessThan(0.002);
    }
  });

  it('Table 1 与 Table 2 在 1800–2050 内给出的位置相差很小；超出范围自动用 Table 2', () => {
    const t = jd(2030, 6, 1);
    for (const id of DESTINATIONS) {
      const a = planetState(id, t, 'table1').position;
      const b = planetState(id, t, 'table2').position;
      expect(angleBetween(a, b) * RAD2DEG, id).toBeLessThan(0.5);
    }
    expect(tableFor(jd(2026, 1, 1), jd(2040, 1, 1))).toBe('table1');
    expect(tableFor(jd(2026, 1, 1), TABLE1_RANGE.end + 1)).toBe('table2');
  });
});

describe('兰伯特求解器', () => {
  it('Curtis《航天工程轨道力学》例 5.2', () => {
    const mu = 398_600e9;
    const r1 = vec3(5000e3, 10_000e3, 2100e3);
    const r2 = vec3(-14_600e3, 2500e3, 7000e3);
    const s = solveLambert(r1, r2, 3600, mu)!;
    expect(s.v1.x / 1000).toBeCloseTo(-5.9925, 3);
    expect(s.v1.y / 1000).toBeCloseTo(1.9254, 3);
    expect(s.v1.z / 1000).toBeCloseTo(3.2456, 3);
    expect(s.v2.x / 1000).toBeCloseTo(-3.3125, 3);
    expect(s.v2.y / 1000).toBeCloseTo(-4.1966, 3);
    expect(s.v2.z / 1000).toBeCloseTo(-0.38529, 3);
  });

  it('解出的轨道用开普勒传播飞 Δt 后正好到达终点（椭圆与双曲线、短程与长程）', () => {
    const au = ASTRO.AU;
    const cases = [
      [vec3(au, 0, 0), vec3(0, 1.5 * au, 0.05 * au), 200 * DAY],
      [vec3(au, 0, 0), vec3(-1.4 * au, 0.4 * au, 0), 300 * DAY],
      [vec3(au, 0, 0), vec3(-0.5 * au, -5 * au, 0.1 * au), 900 * DAY],
      [vec3(au, 0, 0), vec3(0.2 * au, 2 * au, 0), 40 * DAY],
    ] as const;
    for (const [r1, r2, dt] of cases) {
      const s = solveLambert(r1, r2, dt, SUN_MU)!;
      expect(s).not.toBeNull();
      const end = propagateKepler(r1, s.v1, dt, SUN_MU);
      expect(length(vec3(end.position.x - r2.x, end.position.y - r2.y, end.position.z - r2.z)) / length(r2)).toBeLessThan(1e-7);
      expect(length(vec3(end.velocity.x - s.v2.x, end.velocity.y - s.v2.y, end.velocity.z - s.v2.z)) / length(s.v2)).toBeLessThan(1e-6);
      // 顺行：角动量 z 分量为正
      expect(r1.x * s.v1.y - r1.y * s.v1.x).toBeGreaterThan(0);
    }
  });

  it('无效输入返回 null', () => {
    expect(solveLambert(vec3(1, 0, 0), vec3(2, 0, 0), -1, 1)).toBeNull();
    expect(solveLambert(vec3(0, 0, 0), vec3(2, 0, 0), 1, 1)).toBeNull();
  });
});

describe('转移与发射窗口', () => {
  const capture = { parkingAltitude: 200_000, arrival: 'circular' as const };

  it('会合周期与霍曼时间符合公认值', () => {
    expect(synodicPeriod('mars') / DAY).toBeCloseTo(780, -1);
    expect(synodicPeriod('venus') / DAY).toBeCloseTo(584, -1);
    expect(synodicPeriod('jupiter') / DAY).toBeCloseTo(399, -1);
    expect(hohmannTime('mars') / DAY).toBeCloseTo(259, 0);
  });

  it('真实火星任务的轨道：毅力号 2020-07-30 → 2021-02-18，C3 在可行范围内', () => {
    const t = computeTransfer('mars', jd(2020, 7, 30), jd(2021, 2, 18), { parkingAltitude: 200_000, arrival: 'flyby', captureAltitude: 300_000, table: 'table1' })!;
    // 毅力号的发射 C3 约 14.5 km²/s²、到达 v∞ 约 2.7 km/s（量级核对）
    expect(t.c3 / 1e6).toBeGreaterThan(10);
    expect(t.c3 / 1e6).toBeLessThan(20);
    expect(t.arrivalVInf / 1000).toBeGreaterThan(2);
    expect(t.arrivalVInf / 1000).toBeLessThan(4);
  });

  it('2020 年火星窗口：最省 Δv 的出发日在 2020 年 7–8 月（天问一号、毅力号都在 7 月下旬发射）', () => {
    const result = searchWindows({ target: 'mars', startJd: jd(2019, 10, 1), endJd: jd(2021, 3, 1), arrival: 'flyby', parkingAltitude: 200_000 });
    expect(result.windows).toHaveLength(1);
    const best = result.windows[0]!.best;
    expect(best.departureJd).toBeGreaterThan(jd(2020, 6, 20));
    expect(best.departureJd).toBeLessThan(jd(2020, 9, 1));
    // 从 200 km 停泊轨道出发约 3.5–3.8 km/s
    expect(best.departureDeltaV).toBeGreaterThan(3400);
    expect(best.departureDeltaV).toBeLessThan(3900);
    expect(result.windows[0]!.openJd).toBeLessThanOrEqual(best.departureJd);
    expect(result.windows[0]!.closeJd).toBeGreaterThanOrEqual(best.departureJd);
  });

  it('2005 年金星窗口包含金星快车的发射日（2005-11-09）', () => {
    const result = searchWindows({ target: 'venus', startJd: jd(2005, 3, 1), endJd: jd(2006, 6, 1), arrival: 'capture', parkingAltitude: 200_000 });
    expect(result.windows.length).toBeGreaterThanOrEqual(1);
    const window = result.windows.find((w) => w.openJd <= jd(2005, 11, 9) && w.closeJd >= jd(2005, 11, 9));
    expect(window).toBeDefined();
  });

  it('连续窗口的间隔约等于会合周期；离开地球的 Δv 与公认的霍曼估计相符', () => {
    const expected = { mars: [3.4, 4.1], venus: [3.3, 3.9], jupiter: [6.0, 6.7], saturn: [7.0, 8.0] } as const;
    for (const target of ['mars', 'venus', 'jupiter', 'saturn'] as const) {
      const result = searchWindows({ target, startJd: jd(2026, 1, 1), endJd: jd(2034, 1, 1), arrival: 'flyby', parkingAltitude: 200_000 });
      expect(result.windows.length, target).toBeGreaterThanOrEqual(3);
      const gaps = result.windows.slice(1).map((w, i) => w.best.departureJd - result.windows[i]!.best.departureJd);
      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      expect(Math.abs(mean - result.synodicDays) / result.synodicDays, target).toBeLessThan(0.08);
      const [lo, hi] = expected[target];
      for (const w of result.windows) {
        expect(w.best.departureDeltaV / 1000, target).toBeGreaterThan(lo);
        expect(w.best.departureDeltaV / 1000, target).toBeLessThan(hi);
      }
    }
  });

  it('进入环绕轨道时优化的是总 Δv，且大于飞掠时的出发 Δv', () => {
    const window = searchWindows({ target: 'mars', startJd: jd(2026, 6, 1), endJd: jd(2027, 6, 1), ...capture }).windows[0]!;
    expect(window.best.captureDeltaV).toBeGreaterThan(1500);
    expect(window.best.totalDeltaV).toBeCloseTo(window.best.departureDeltaV + window.best.captureDeltaV, 6);
    expect(DEFAULT_CAPTURE_ALTITUDE.mars).toBe(300_000);
    // 停泊轨道倾角至少要等于出发渐近线赤纬
    expect(Math.abs(window.best.declination)).toBeLessThan(60 * DEG2RAD);
  });

  it('猪排图网格的最小值不低于窗口最优值（网格更粗），且两者接近', () => {
    const result = searchWindows({ target: 'mars', startJd: jd(2028, 6, 1), endJd: jd(2029, 6, 1), ...capture });
    const best = result.windows[0]!.best;
    const grid = porkchop('mars', best.departureJd, result.options, result.flightDays, 60, 50);
    expect(grid.values).toHaveLength(60 * 50);
    expect(grid.min).toBeGreaterThanOrEqual(best.totalDeltaV - 1);
    expect(grid.min - best.totalDeltaV).toBeLessThan(150);
  });

  it('可以限制最长飞行时间；最优解贴着上限时给出标记', () => {
    const base = { target: 'neptune' as const, startJd: jd(2030, 1, 1), endJd: jd(2031, 1, 1), arrival: 'capture' as const, parkingAltitude: 200_000 };
    const loose = searchWindows(base).windows[0]!;
    const tight = searchWindows({ ...base, maxFlightDays: 20 * 365 }).windows[0]!;
    expect(tight.best.arrivalJd - tight.best.departureJd).toBeLessThanOrEqual(20 * 365 + 1e-6);
    expect(tight.atFlightLimit).toBe(true);
    // 飞得越快越费：20 年到海王星比默认上限（约 38 年）要多花 Δv
    expect(tight.best.totalDeltaV).toBeGreaterThan(loose.best.totalDeltaV);
    const mars = searchWindows({ target: 'mars', startJd: jd(2026, 6, 1), endJd: jd(2027, 6, 1), arrival: 'flyby', parkingAltitude: 200_000 }).windows[0]!;
    expect(mars.atFlightLimit).toBe(false);
  });
});
