/**
 * 与 JPL Horizons（DE441）逐点对比：
 * 1. 近似星历的位置误差（2000–2050，每 60 天）与 JPL 公布的名义误差比较；
 * 2. 火星、金星、木星 2026 年窗口的猪排图：同一组出发日 × 飞行时间，分别用 Horizons 状态和近似星历
 *    解兰伯特问题，比较 C3、到达 v∞、总 Δv，以及最优点的位置。
 * 结果的数值写进 TESTING.md；这里断言的上限比实测略宽，防止回归。
 */
import { describe, expect, it } from 'vitest';
import { ASTRO, EARTH, RAD2DEG } from '../physics/constants';
import { length, sub, vec3 } from '../physics/math/vec3';
import { planetState } from './ephemeris';
import { solveLambert } from './lambert';
import { type PlanetId, SUN_MU } from './planets';
import { DEFAULT_CAPTURE_ALTITUDE, captureBurn, computeTransfer, hyperbolicBurn } from './transfer';
import { PLANET_POSITIONS, PORKCHOP_FIXTURES, type StateSeries, stateAt } from './testing/horizons';

const PARKING = 200_000;

/** JPL 公布的名义误差（1800–2050）：黄经 ″、黄纬 ″、距离 1000 km。 */
const NOMINAL: Record<string, readonly [number, number, number]> = {
  mercury: [15, 1, 1],
  venus: [20, 1, 4],
  emb: [20, 8, 6],
  mars: [40, 2, 25],
  jupiter: [400, 10, 600],
  saturn: [600, 25, 1500],
  uranus: [50, 2, 1000],
  neptune: [10, 1, 200],
};

const sphere = (p: { x: number; y: number; z: number }) => {
  const r = Math.hypot(p.x, p.y, p.z);
  return { lon: Math.atan2(p.y, p.x), lat: Math.asin(p.z / r), r };
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('近似星历 vs Horizons（2000–2050）', () => {
  /**
   * 实测最大误差的约 1.3 倍，用来防止回归（黄经 ″、黄纬 ″、距离 1000 km）。
   * 注意：火星、天王星、海王星的实测最大值是 JPL 名义误差的 2–6 倍。JPL 的名义误差是对当年 DE200 拟合给出的，
   * 而 Horizons 现在用 DE441；这些误差（最大 0.16°，在土星）对选发射窗口仍然很小。
   */
  const LIMIT: Record<string, readonly [number, number, number]> = {
    mercury: [40, 5, 3],
    venus: [40, 3, 9],
    emb: [30, 4, 10],
    mars: [130, 5, 52],
    jupiter: [700, 15, 820],
    saturn: [750, 36, 3700],
    uranus: [150, 5, 1550],
    neptune: [80, 3, 1700],
  };

  it('每颗行星的黄经、黄纬、距离误差在实测范围内（并与 JPL 名义误差一起打印）', () => {
    const rows: string[] = [];
    for (const [name, [lonN, latN, distN]] of Object.entries(NOMINAL)) {
      const ours: PlanetId = name === 'emb' ? 'earth' : (name as PlanetId);
      const series = PLANET_POSITIONS.bodies[name as keyof typeof PLANET_POSITIONS.bodies];
      let lonMax = 0;
      let latMax = 0;
      let distMax = 0;
      series.forEach((row, i) => {
        const jd = PLANET_POSITIONS.startJd + i * PLANET_POSITIONS.stepDays;
        const h = sphere(vec3(row[0]! * 1e3, row[1]! * 1e3, row[2]! * 1e3));
        const a = sphere(planetState(ours, jd, 'table1').position);
        lonMax = Math.max(lonMax, Math.abs(wrapPi(a.lon - h.lon)) * RAD2DEG * 3600);
        latMax = Math.max(latMax, Math.abs(a.lat - h.lat) * RAD2DEG * 3600);
        distMax = Math.max(distMax, Math.abs(a.r - h.r) / 1e6);
      });
      rows.push(`${name.padEnd(8)} 黄经 ${lonMax.toFixed(1)}″ (名义 ${lonN})  黄纬 ${latMax.toFixed(1)}″ (${latN})  距离 ${distMax.toFixed(1)} 千km (${distN})`);
      const [lonL, latL, distL] = LIMIT[name]!;
      expect(lonMax, name).toBeLessThan(lonL);
      expect(latMax, name).toBeLessThan(latL);
      expect(distMax, name).toBeLessThan(distL);
    }
    console.log(['最大误差（2000–2050，每 60 天）：', ...rows].join('\n'));
  });
});

interface Cell {
  readonly c3: number;
  readonly vInfArr: number;
  readonly total: number;
}

/** 用给定的地球与目标状态算一格。 */
const cell = (target: PlanetId, earth: { position: ReturnType<typeof vec3>; velocity: ReturnType<typeof vec3> }, planet: typeof earth, seconds: number): Cell | null => {
  const s = solveLambert(earth.position, planet.position, seconds, SUN_MU, true);
  if (!s) return null;
  const vInfDep = length(sub(s.v1, earth.velocity));
  const vInfArr = length(sub(s.v2, planet.velocity));
  const total = hyperbolicBurn(vInfDep, EARTH.MU, EARTH.RADIUS + PARKING) + captureBurn(target, 'capture', vInfArr, DEFAULT_CAPTURE_ALTITUDE[target]);
  return { c3: vInfDep * vInfDep, vInfArr, total };
};

interface Comparison {
  readonly cells: number;
  /** 最优值 +1 km/s 以内（真正会用来发射的区域）。 */
  readonly nearCells: number;
  readonly nearC3Max: number;
  readonly nearTotalMax: number;
  /** C3 误差最大的那一格本身的 C3 [km²/s²]。 */
  readonly c3AtWorst: number;
  readonly c3Max: number;
  readonly c3Median: number;
  readonly vInfMax: number;
  readonly totalMax: number;
  readonly totalMedian: number;
  readonly bestHorizons: { dep: number; tof: number; total: number };
  readonly bestOurs: { dep: number; tof: number; total: number };
}

/** 在两组星历上算同一张猪排图；只统计总 Δv 在最优值 +3 km/s 以内的格子（图上着色的区域）。 */
const compare = (target: PlanetId, fixture: { earth: StateSeries; planet: StateSeries }, depStep: number, tofs: readonly number[]): Comparison => {
  const results: { dep: number; tof: number; h: Cell; a: Cell }[] = [];
  const earthSeries = fixture.earth;
  for (let i = 0; i < earthSeries.states.length; i += depStep) {
    const dep = earthSeries.startJd + i;
    const earthH = stateAt(earthSeries, dep)!;
    const earthA = planetState('earth', dep, 'table1');
    for (const tof of tofs) {
      const planetH = stateAt(fixture.planet, dep + tof);
      if (!planetH) continue;
      const seconds = tof * ASTRO.SECONDS_PER_DAY;
      const h = cell(target, earthH, planetH, seconds);
      const ours = computeTransfer(target, dep, dep + tof, { parkingAltitude: PARKING, arrival: 'capture', captureAltitude: DEFAULT_CAPTURE_ALTITUDE[target], table: 'table1' });
      if (!h || !ours) continue;
      // 用星历本身算出的结果要与 computeTransfer 一致
      const a = cell(target, earthA, planetState(target, dep + tof, 'table1'), seconds)!;
      expect(Math.abs(a.total - ours.totalDeltaV)).toBeLessThan(1e-6);
      results.push({ dep, tof, h, a });
    }
  }
  const minH = Math.min(...results.map((r) => r.h.total));
  const shown = results.filter((r) => r.h.total <= minH + 3000);
  const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)]!;
  const bestBy = (key: 'h' | 'a') => {
    const r = results.reduce((b, x) => (x[key].total < b[key].total ? x : b));
    return { dep: r.dep, tof: r.tof, total: r[key].total };
  };
  const near = results.filter((r) => r.h.total <= minH + 1000);
  const worst = shown.reduce((w, r) => (Math.abs(r.a.c3 - r.h.c3) > Math.abs(w.a.c3 - w.h.c3) ? r : w));
  return {
    cells: shown.length,
    nearCells: near.length,
    nearC3Max: Math.max(...near.map((r) => Math.abs(r.a.c3 - r.h.c3))) / 1e6,
    nearTotalMax: Math.max(...near.map((r) => Math.abs(r.a.total - r.h.total))),
    c3AtWorst: worst.h.c3 / 1e6,
    c3Max: Math.max(...shown.map((r) => Math.abs(r.a.c3 - r.h.c3))) / 1e6,
    c3Median: median(shown.map((r) => Math.abs(r.a.c3 - r.h.c3))) / 1e6,
    vInfMax: Math.max(...shown.map((r) => Math.abs(r.a.vInfArr - r.h.vInfArr))),
    totalMax: Math.max(...shown.map((r) => Math.abs(r.a.total - r.h.total))),
    totalMedian: median(shown.map((r) => Math.abs(r.a.total - r.h.total))),
    bestHorizons: bestBy('h'),
    bestOurs: bestBy('a'),
  };
};

const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const report = (name: string, c: Comparison) =>
  console.log(
    `${name}：着色区 ${c.cells} 格；C3 误差 最大 ${c.c3Max.toFixed(3)}（该格 C3 ${c.c3AtWorst.toFixed(1)}）/ 中位 ${c.c3Median.toFixed(3)} km²/s²；` +
      `最优 +1 km/s 内 ${c.nearCells} 格：C3 最大 ${c.nearC3Max.toFixed(3)} km²/s²、总 Δv 最大 ${c.nearTotalMax.toFixed(0)} m/s；到达 v∞ 最大 ${c.vInfMax.toFixed(0)} m/s；` +
      `总 Δv 最大 ${c.totalMax.toFixed(0)} / 中位 ${c.totalMedian.toFixed(0)} m/s；` +
      `最优点 Horizons 出发 JD ${c.bestHorizons.dep} 飞 ${c.bestHorizons.tof} 天 ${c.bestHorizons.total.toFixed(1)} m/s，` +
      `近似星历 JD ${c.bestOurs.dep} 飞 ${c.bestOurs.tof} 天 ${c.bestOurs.total.toFixed(1)} m/s`,
  );

describe('猪排图逐点对比 Horizons（2026 年窗口）', () => {
  it('火星：出发日每 3 天 × 飞行 120–420 天每 5 天', () => {
    const c = compare('mars', PORKCHOP_FIXTURES.mars, 3, range(120, 420, 5));
    report('火星', c);
    expect(c.cells).toBeGreaterThan(1500);
    expect(c.c3Max).toBeLessThan(1.3);
    expect(c.nearC3Max).toBeLessThan(0.3);
    expect(c.nearTotalMax).toBeLessThan(20);
    expect(c.totalMax).toBeLessThan(120);
    // 最优点：同一天出发、同样的飞行时间，总 Δv 相差 < 2 m/s
    expect(Math.abs(c.bestOurs.total - c.bestHorizons.total)).toBeLessThan(2);
    expect(c.bestOurs.dep).toBe(c.bestHorizons.dep);
    expect(c.bestOurs.tof).toBe(c.bestHorizons.tof);
  });

  it('金星：出发日每 3 天 × 飞行 70–230 天每 4 天', () => {
    const c = compare('venus', PORKCHOP_FIXTURES.venus, 3, range(70, 230, 4));
    report('金星', c);
    expect(c.cells).toBeGreaterThan(1000);
    expect(c.c3Max).toBeLessThan(0.3);
    expect(c.nearTotalMax).toBeLessThan(10);
    expect(c.totalMax).toBeLessThan(15);
    // 最优点：同一天出发、同样的飞行时间，总 Δv 相差 < 2 m/s
    expect(Math.abs(c.bestOurs.total - c.bestHorizons.total)).toBeLessThan(2);
    expect(c.bestOurs.dep).toBe(c.bestHorizons.dep);
    expect(c.bestOurs.tof).toBe(c.bestHorizons.tof);
  });

  it('木星：出发日每 2 天 × 飞行 451–1241 天每 10 天', () => {
    const c = compare('jupiter', PORKCHOP_FIXTURES.jupiter, 2, range(451, 1241, 10));
    report('木星', c);
    expect(c.cells).toBeGreaterThan(1000);
    expect(c.c3Max).toBeLessThan(2.6);
    expect(c.nearC3Max).toBeLessThan(0.7);
    expect(c.nearTotalMax).toBeLessThan(25);
    expect(c.totalMax).toBeLessThan(90);
    expect(Math.abs(c.bestOurs.total - c.bestHorizons.total)).toBeLessThan(20);
    expect(c.bestOurs.dep).toBe(c.bestHorizons.dep);
  });
});
