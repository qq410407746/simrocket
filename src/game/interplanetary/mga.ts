/**
 * 多次借力飞越的路线（MGA, multiple gravity assist）：地球 → 飞越行星… → 目标。
 *
 * 一条路线由各次相遇的日期决定：每两次相遇之间解一段零圈兰伯特轨道；
 * 出发按停泊轨道一次点火、每次飞越按有动力飞越模型（flyby.ts）、到达按选定的入轨方式计算，总 Δv 相加。
 * 不支持连续两次飞越同一颗行星（那需要多圈兰伯特解与共振轨道，如伽利略号的地球—地球段），也不含深空机动。
 *
 * 优化：在 [出发日, 各段飞行时间] 空间里先用确定性的伪随机数撒点，挑出若干个互相分开的低点，
 * 再各自用 Nelder–Mead 单纯形法细化。全局最优不保证，但同样的输入总给出同样的结果。
 */
import { ASTRO, EARTH } from '../physics/constants';
import { type Vec3, length, sub } from '../physics/math/vec3';
import { type EphemerisTable, eclipticToEquatorial, planetState, tableFor } from './ephemeris';
import { type FlybyResult, flyby } from './flyby';
import { solveLambert } from './lambert';
import { type PlanetId, SUN_MU, findPlanet } from './planets';
import { type ArrivalMode, DEFAULT_CAPTURE_ALTITUDE, captureBurn, hyperbolicBurn } from './transfer';

const DAY = ASTRO.SECONDS_PER_DAY;

/** 两颗行星圆轨道之间的霍曼转移时间 [天]。 */
export const hohmannDays = (from: PlanetId, to: PlanetId): number => {
  const a1 = findPlanet(from).table1.epoch[0] * ASTRO.AU;
  const a2 = findPlanet(to).table1.epoch[0] * ASTRO.AU;
  const a = (a1 + a2) / 2;
  return (Math.PI * Math.sqrt((a * a * a) / SUN_MU)) / DAY;
};

/**
 * 每段飞行时间的搜索范围 [天]：霍曼时间的 0.25–1.5 倍，至少 30 天；
 * 两端都是内行星（半长轴 < 2 au）时上限放宽到 2.2 倍——金星—地球这类段常常要绕太阳大半圈（伽利略号约 300 天）。
 */
export const legBounds = (from: PlanetId, to: PlanetId): { readonly min: number; readonly max: number } => {
  const h = hohmannDays(from, to);
  const inner = findPlanet(from).table1.epoch[0] < 2 && findPlanet(to).table1.epoch[0] < 2;
  return { min: Math.max(30, 0.25 * h), max: Math.max(60, (inner ? 2.2 : 1.5) * h) };
};

export const isValidSequence = (sequence: readonly PlanetId[]): boolean =>
  sequence.length >= 3 && sequence[0] === 'earth' && sequence[sequence.length - 1] !== 'earth' && sequence.every((p, i) => i === 0 || p !== sequence[i - 1]);

export interface Encounter {
  readonly body: PlanetId;
  readonly jd: number;
  readonly flyby: FlybyResult;
}

export interface MgaLeg {
  /** 这段起点的日心位置 [m] 与速度 [m/s]（兰伯特解）。 */
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** 飞行时间 [s]。 */
  readonly seconds: number;
}

export interface MgaSolution {
  readonly sequence: readonly PlanetId[];
  readonly legs: readonly MgaLeg[];
  /** 各次相遇的儒略日：dates[0] 出发，最后一个到达。 */
  readonly dates: readonly number[];
  readonly c3: number;
  readonly departureVInf: number;
  readonly declination: number;
  readonly departureDeltaV: number;
  readonly flybys: readonly Encounter[];
  readonly flybyDeltaV: number;
  readonly arrivalVInf: number;
  readonly captureDeltaV: number;
  readonly totalDeltaV: number;
  /** 所有飞越都不低于最低飞越半径。 */
  readonly feasible: boolean;
}

export interface MgaOptions {
  readonly parkingAltitude: number;
  readonly arrival: ArrivalMode;
  readonly captureAltitude: number;
  readonly table: EphemerisTable;
}

/** 按给定的相遇日期计算整条路线；任何一段兰伯特无解时返回 null。 */
export const evaluateRoute = (sequence: readonly PlanetId[], dates: readonly number[], options: MgaOptions): MgaSolution | null => {
  if (dates.length !== sequence.length) return null;
  const states = sequence.map((body, i) => planetState(body, dates[i]!, options.table));
  const legs = [];
  for (let i = 0; i + 1 < sequence.length; i++) {
    const seconds = (dates[i + 1]! - dates[i]!) * DAY;
    const leg = solveLambert(states[i]!.position, states[i + 1]!.position, seconds, SUN_MU, true);
    if (!leg) return null;
    legs.push(leg);
  }
  const vInfDep = sub(legs[0]!.v1, states[0]!.velocity);
  const departureVInf = length(vInfDep);
  const departureDeltaV = hyperbolicBurn(departureVInf, EARTH.MU, EARTH.RADIUS + options.parkingAltitude);
  const flybys: Encounter[] = [];
  for (let i = 1; i + 1 < sequence.length; i++) {
    const vIn = sub(legs[i - 1]!.v2, states[i]!.velocity);
    const vOut = sub(legs[i]!.v1, states[i]!.velocity);
    flybys.push({ body: sequence[i]!, jd: dates[i]!, flyby: flyby(sequence[i]!, vIn, vOut) });
  }
  const last = sequence.length - 1;
  const arrivalVInf = length(sub(legs[last - 1]!.v2, states[last]!.velocity));
  const captureDeltaV = captureBurn(sequence[last]!, options.arrival, arrivalVInf, options.captureAltitude);
  const flybyDeltaV = flybys.reduce((s, f) => s + f.flyby.deltaV, 0);
  const equatorial = eclipticToEquatorial(vInfDep);
  return {
    sequence,
    legs: legs.map((leg, i) => ({ position: states[i]!.position, velocity: leg.v1, seconds: (dates[i + 1]! - dates[i]!) * DAY })),
    dates,
    c3: departureVInf * departureVInf,
    departureVInf,
    declination: Math.asin(Math.max(-1, Math.min(1, equatorial.z / departureVInf))),
    departureDeltaV,
    flybys,
    flybyDeltaV,
    arrivalVInf,
    captureDeltaV,
    totalDeltaV: departureDeltaV + flybyDeltaV + captureDeltaV,
    feasible: flybys.every((f) => f.flyby.feasible),
  };
};

/** 只列出总 Δv 不超过最好解这么多 [m/s] 的窗口。 */
export const MAX_EXTRA_DELTA_V = 5000;

export interface MgaSearchInput {
  readonly sequence: readonly PlanetId[];
  readonly startJd: number;
  readonly endJd: number;
  readonly arrival: ArrivalMode;
  readonly parkingAltitude: number;
  readonly captureAltitude?: number;
  /** 总飞行时间上限 [天]；不给时只受各段范围限制。 */
  readonly maxTotalDays?: number;
  /** 撒点数量（默认按段数自动选择）。 */
  readonly samples?: number;
}

export interface MgaSearchResult {
  readonly options: MgaOptions;
  /** 互相分开（出发日相差足够远）的若干个解，按出发日期排序。 */
  readonly solutions: readonly MgaSolution[];
  readonly legBounds: readonly { readonly min: number; readonly max: number }[];
}

/** 确定性伪随机数（mulberry32）。 */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

const hashSeed = (parts: readonly (string | number)[]): number => {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** Nelder–Mead 单纯形法（在 [0,1]^n 里，越界的点按边界截断）。 */
const nelderMead = (f: (x: number[]) => number, start: number[], step: number, iterations: number): { x: number[]; value: number } => {
  const n = start.length;
  const clamp = (x: number[]) => x.map((v) => Math.min(1, Math.max(0, v)));
  let simplex = [clamp(start)];
  for (let i = 0; i < n; i++) {
    const p = [...start];
    p[i] = p[i]! + (p[i]! + step <= 1 ? step : -step);
    simplex.push(clamp(p));
  }
  let values = simplex.map(f);
  for (let it = 0; it < iterations; it++) {
    const order = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]).map(([, i]) => i);
    simplex = order.map((i) => simplex[i]!);
    values = order.map((i) => values[i]!);
    if (Math.abs(values[n]! - values[0]!) < 1e-3) break;
    const centroid = Array.from({ length: n }, (_, k) => simplex.slice(0, n).reduce((s, p) => s + p[k]!, 0) / n);
    const along = (t: number) => clamp(centroid.map((c, k) => c + t * (simplex[n]![k]! - c)));
    const reflected = along(-1);
    const fr = f(reflected);
    if (fr < values[0]!) {
      const expanded = along(-2);
      const fe = f(expanded);
      if (fe < fr) {
        simplex[n] = expanded;
        values[n] = fe;
      } else {
        simplex[n] = reflected;
        values[n] = fr;
      }
    } else if (fr < values[n - 1]!) {
      simplex[n] = reflected;
      values[n] = fr;
    } else {
      const contracted = along(0.5);
      const fc = f(contracted);
      if (fc < values[n]!) {
        simplex[n] = contracted;
        values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = clamp(simplex[i]!.map((v, k) => simplex[0]![k]! + 0.5 * (v - simplex[0]![k]!)));
          values[i] = f(simplex[i]!);
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return { x: simplex[best]!, value: values[best]! };
};

export const mgaOptionsFor = (input: MgaSearchInput): MgaOptions => {
  const target = input.sequence[input.sequence.length - 1]!;
  const bounds = input.sequence.slice(1).map((to, i) => legBounds(input.sequence[i]!, to));
  const longest = bounds.reduce((s, b) => s + b.max, 0);
  return {
    parkingAltitude: input.parkingAltitude,
    arrival: input.arrival,
    captureAltitude: input.captureAltitude ?? DEFAULT_CAPTURE_ALTITUDE[target],
    table: tableFor(input.startJd, input.endJd + Math.min(longest, input.maxTotalDays ?? longest)),
  };
};

export const searchRoute = (input: MgaSearchInput): MgaSearchResult => {
  const { sequence } = input;
  if (!isValidSequence(sequence)) throw new Error(`无效的飞越路线：${sequence.join('-')}`);
  const options = mgaOptionsFor(input);
  const bounds = sequence.slice(1).map((to, i) => legBounds(sequence[i]!, to));
  const span = input.endJd - input.startJd;
  const maxTotal = input.maxTotalDays ?? Number.POSITIVE_INFINITY;

  const decode = (x: readonly number[]): number[] => {
    const dates = [input.startJd + x[0]! * span];
    bounds.forEach((b, i) => dates.push(dates[i]! + b.min + x[i + 1]! * (b.max - b.min)));
    return dates;
  };
  const cost = (x: number[]): number => {
    const dates = decode(x);
    const total = dates[dates.length - 1]! - dates[0]!;
    const s = evaluateRoute(sequence, dates, options);
    if (!s) return 1e9;
    // 超过总时间上限：每多一天罚 50 m/s
    return s.totalDeltaV + (total > maxTotal ? 50 * (total - maxTotal) : 0);
  };

  const dims = sequence.length;
  const samples = input.samples ?? Math.round(Math.min(40_000, 4000 * dims * Math.max(1, span / 365)));
  const rand = random(hashSeed([...sequence, input.startJd, input.endJd, input.arrival, maxTotal]));
  const pool: { x: number[]; value: number }[] = [];
  for (let k = 0; k < samples; k++) {
    const x = Array.from({ length: dims }, rand);
    pool.push({ x, value: cost(x) });
  }
  pool.sort((p, q) => p.value - q.value);

  // 出发日至少相差这么多天才算不同的窗口：第一段的会合周期的一半，最少 60 天
  const first = findPlanet(sequence[1]!).table1.rate[3];
  const earthRate = findPlanet('earth').table1.rate[3];
  const synodic = (360 / Math.abs(earthRate - first)) * 36_525;
  const separation = Math.max(60, Math.min(400, synodic / 2));
  const seeds: { x: number[]; value: number }[] = [];
  for (const p of pool) {
    if (p.value >= 1e9) break;
    const dep = decode(p.x)[0]!;
    if (seeds.some((q) => Math.abs(decode(q.x)[0]! - dep) < separation)) continue;
    seeds.push(p);
    if (seeds.length >= 16) break;
  }
  const refined = seeds.map((s) => nelderMead(cost, s.x, 0.02, 600));
  const distinct: { x: number[]; value: number }[] = [];
  for (const r of refined.sort((p, q) => p.value - q.value)) {
    const dep = decode(r.x)[0]!;
    if (distinct.some((q) => Math.abs(decode(q.x)[0]! - dep) < separation)) continue;
    distinct.push(r);
  }
  const evaluated = distinct
    .map((r) => evaluateRoute(sequence, decode(r.x), options))
    .filter((s): s is MgaSolution => s !== null && s.dates[s.dates.length - 1]! - s.dates[0]! <= maxTotal + 1)
    // 出发日贴着搜索边界：真正的低点在范围外，不算一个窗口
    .filter((s) => s.dates[0]! - input.startJd > 2 && input.endJd - s.dates[0]! > 2);
  const best = Math.min(...evaluated.map((s) => s.totalDeltaV));
  const solutions = evaluated
    // 比最好的解贵很多的局部低点没有参考价值
    .filter((s) => s.totalDeltaV <= best + MAX_EXTRA_DELTA_V)
    .sort((p, q) => p.dates[0]! - q.dates[0]!);
  return { options, solutions, legBounds: bounds };
};

/** 预设路线（都从地球出发）。参考了真实任务用过的借力方式，但不是这些任务的复刻。 */
export const PRESET_ROUTES: Record<PlanetId, readonly (readonly PlanetId[])[]> = {
  mercury: [['earth', 'venus', 'mercury']],
  venus: [],
  earth: [],
  mars: [['earth', 'venus', 'mars']],
  jupiter: [
    ['earth', 'venus', 'earth', 'jupiter'],
    ['earth', 'mars', 'jupiter'],
  ],
  saturn: [
    ['earth', 'jupiter', 'saturn'],
    ['earth', 'venus', 'earth', 'jupiter', 'saturn'],
  ],
  uranus: [
    ['earth', 'jupiter', 'uranus'],
    ['earth', 'saturn', 'uranus'],
  ],
  neptune: [
    ['earth', 'jupiter', 'neptune'],
    ['earth', 'saturn', 'neptune'],
  ],
};
