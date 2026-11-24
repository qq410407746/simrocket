/**
 * 借力飞越：飞越模型本身、用旅行者号的真实相遇几何（JPL Horizons）核对、路线优化。
 */
import { describe, expect, it } from 'vitest';
import { RAD2DEG } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import { angleBetween, length, vec3 } from '../physics/math/vec3';
import { MIN_FLYBY_RADIUS, flyby } from './flyby';
import { evaluateRoute, isValidSequence, legBounds, searchRoute } from './mga';
import { type PlanetId, findPlanet } from './planets';
import { VOYAGER, toState } from './testing/horizons';
import { searchWindows } from './windows';

const jd = (y: number, m: number, d: number) => julianDateFromUnixMs(Date.UTC(y, m - 1, d));

describe('飞越模型', () => {
  it('进出 v∞ 相等时不需要点火，近星点半径与偏转角互相对应', () => {
    const mu = findPlanet('jupiter').mu;
    const v = 8000;
    const rp = 1e9;
    // 由 rₚ 算出总偏转角，再构造这样的进出速度
    const delta = 2 * Math.asin(1 / (1 + (rp * v * v) / mu));
    const result = flyby('jupiter', vec3(v, 0, 0), vec3(v * Math.cos(delta), v * Math.sin(delta), 0));
    expect(result.poweredDeltaV).toBeLessThan(1e-6);
    expect(result.turnDeficitDeltaV).toBe(0);
    expect(Math.abs(result.periapsisRadius - rp) / rp).toBeLessThan(1e-6);
    expect(result.feasible).toBe(true);
  });

  it('进出 v∞ 不等时在近星点补点火；所需偏转太大时按最低高度飞并标记不可行', () => {
    const powered = flyby('venus', vec3(5000, 0, 0), vec3(5500 * Math.cos(1), 5500 * Math.sin(1), 0));
    expect(powered.poweredDeltaV).toBeGreaterThan(0);
    expect(powered.feasible).toBe(true);
    const tooSharp = flyby('venus', vec3(9000, 0, 0), vec3(-9000, 100, 0));
    expect(tooSharp.feasible).toBe(false);
    expect(tooSharp.periapsisRadius).toBe(MIN_FLYBY_RADIUS.venus);
    expect(tooSharp.turnDeficitDeltaV).toBeGreaterThan(5000);
  });
});

describe('旅行者号：真实相遇日期 + 本模型 vs JPL Horizons 中的真实轨迹', () => {
  type Mission = 'voyager1' | 'voyager2';
  const routes: readonly [Mission, number, readonly PlanetId[]][] = [
    ['voyager1', jd(1977, 9, 5), ['earth', 'jupiter', 'saturn']],
    ['voyager2', jd(1977, 8, 20), ['earth', 'jupiter', 'saturn', 'uranus', 'neptune']],
  ];
  for (const [name, launch, sequence] of routes) {
    it(`${name}：飞越的偏转角相差 < 1°，近星点距离相差 < 6%，v∞ 相差 < 3%，几乎不需要点火`, () => {
      const encounters = VOYAGER[name].encounters as Record<string, (typeof VOYAGER)['voyager2']['encounters']['jupiter']>;
      const dates = [launch, ...sequence.slice(1).map((p) => encounters[p]!.closestApproachJd)];
      const solution = evaluateRoute(sequence, dates, { parkingAltitude: 200_000, arrival: 'flyby', captureAltitude: 0, table: 'table1' })!;
      expect(solution).not.toBeNull();
      for (const f of solution.flybys) {
        const e = encounters[f.body]!;
        const mu = findPlanet(f.body).mu;
        const before = toState(e.relativeBefore);
        const after = toState(e.relativeAfter);
        // Horizons：飞越前后 60 天相对行星的状态 → 双曲线剩余速度
        const vIn = Math.sqrt(length(before.velocity) ** 2 - (2 * mu) / length(before.position));
        const vOut = Math.sqrt(length(after.velocity) ** 2 - (2 * mu) / length(after.position));
        const turn = angleBetween(before.velocity, after.velocity) * RAD2DEG;
        const actualRp = e.closestApproachKm * 1e3;
        expect(Math.abs(f.flyby.turnAngle * RAD2DEG - turn), `${f.body} 偏转角`).toBeLessThan(1);
        expect(Math.abs(f.flyby.periapsisRadius - actualRp) / actualRp, `${f.body} 近星点`).toBeLessThan(0.06);
        expect(Math.abs(f.flyby.vInfIn - vIn) / vIn, `${f.body} v∞ 进`).toBeLessThan(0.03);
        expect(Math.abs(f.flyby.vInfOut - vOut) / vOut, `${f.body} v∞ 出`).toBeLessThan(0.03);
        expect(f.flyby.deltaV, `${f.body} 点火`).toBeLessThan(60);
        expect(f.flyby.feasible).toBe(true);
      }
    });
  }

  it('在 1976–1978 年搜索地球—木星—土星：最优出发日落在旅行者 1 号发射日（1977-09-05）前后 30 天内', () => {
    const result = searchRoute({ sequence: ['earth', 'jupiter', 'saturn'], startJd: jd(1976, 6, 1), endJd: jd(1978, 6, 1), arrival: 'flyby', parkingAltitude: 200_000 });
    const best = result.solutions.reduce((b, s) => (s.totalDeltaV < b.totalDeltaV ? s : b));
    expect(Math.abs(best.dates[0]! - jd(1977, 9, 5))).toBeLessThan(30);
    expect(best.flybyDeltaV).toBeLessThan(50);
    expect(best.feasible).toBe(true);
  });
});

describe('路线搜索', () => {
  it('路线必须从地球出发、不能连续飞越同一颗行星', () => {
    expect(isValidSequence(['earth', 'venus', 'mercury'])).toBe(true);
    expect(isValidSequence(['earth', 'mercury'])).toBe(false);
    expect(isValidSequence(['venus', 'earth', 'jupiter'])).toBe(false);
    expect(isValidSequence(['earth', 'earth', 'jupiter'])).toBe(false);
    expect(() => searchRoute({ sequence: ['earth', 'earth', 'jupiter'], startJd: 0, endJd: 1, arrival: 'flyby', parkingAltitude: 2e5 })).toThrow();
    expect(legBounds('venus', 'earth').max).toBeGreaterThan(250);
  });

  it('经金星借力去水星比直飞省（2026–2031）', () => {
    const range = { startJd: jd(2026, 1, 1), endJd: jd(2031, 1, 1), arrival: 'flyby' as const, parkingAltitude: 200_000 };
    const viaVenus = searchRoute({ sequence: ['earth', 'venus', 'mercury'], ...range }).solutions;
    const direct = searchWindows({ target: 'mercury', ...range }).windows;
    const bestVia = Math.min(...viaVenus.map((s) => s.totalDeltaV));
    const bestDirect = Math.min(...direct.map((w) => w.best.totalDeltaV));
    expect(bestVia).toBeLessThan(bestDirect - 500);
  });

  it('同样的输入给出同样的结果；所有解的出发日都在搜索范围内、日期递增', () => {
    const input = { sequence: ['earth', 'jupiter', 'saturn'] as const, startJd: jd(2028, 1, 1), endJd: jd(2031, 1, 1), arrival: 'capture' as const, parkingAltitude: 200_000 };
    const a = searchRoute(input);
    const b = searchRoute(input);
    expect(a.solutions.map((s) => s.totalDeltaV)).toEqual(b.solutions.map((s) => s.totalDeltaV));
    expect(a.solutions.length).toBeGreaterThan(0);
    for (const s of a.solutions) {
      expect(s.dates[0]).toBeGreaterThan(input.startJd);
      expect(s.dates[0]).toBeLessThan(input.endJd);
      for (let i = 1; i < s.dates.length; i++) expect(s.dates[i]).toBeGreaterThan(s.dates[i - 1]!);
      expect(s.totalDeltaV).toBeCloseTo(s.departureDeltaV + s.flybyDeltaV + s.captureDeltaV, 6);
    }
  });

  it('可以限制总飞行时间', () => {
    const input = { sequence: ['earth', 'jupiter', 'saturn'] as const, startJd: jd(2028, 1, 1), endJd: jd(2031, 1, 1), arrival: 'flyby' as const, parkingAltitude: 200_000 };
    for (const s of searchRoute({ ...input, maxTotalDays: 6 * 365 }).solutions) expect(s.dates[2]! - s.dates[0]!).toBeLessThanOrEqual(6 * 365 + 1);
  });
});
