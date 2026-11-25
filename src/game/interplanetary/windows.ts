/**
 * 发射窗口搜索与"猪排图"（porkchop plot）网格。
 *
 * 窗口搜索：按出发日期扫描，每个出发日在飞行时间范围内取最小 Δv，得到一条随出发日期变化的曲线；
 * 曲线在每个会合周期里的最低点就是一个发射窗口，再在它附近逐步加密网格找到最优的出发日与到达日。
 * 优化目标：进入环绕轨道时是"出发 + 到达"的总 Δv，飞掠时只看出发 Δv。
 */
import { ASTRO } from '../physics/constants';
import { planetState, tableFor } from './ephemeris';
import { type PlanetId } from './planets';
import { type ArrivalMode, DEFAULT_CAPTURE_ALTITUDE, type Transfer, type TransferOptions, computeTransfer, flightTimeRange, synodicPeriod } from './transfer';

export interface WindowSearchInput {
  readonly target: PlanetId;
  readonly startJd: number;
  readonly endJd: number;
  readonly arrival: ArrivalMode;
  readonly parkingAltitude: number;
  readonly captureAltitude?: number;
  /** 最长飞行时间 [天]；不给时用 flightTimeRange 的上限。 */
  readonly maxFlightDays?: number;
}

export interface LaunchWindow {
  readonly best: Transfer;
  /** Δv 不超过最优值 + margin 的出发日期范围（儒略日），用于显示窗口有多宽。 */
  readonly openJd: number;
  readonly closeJd: number;
  /** 最优解贴着飞行时间上限：放宽上限还能更省，但要飞得更久。 */
  readonly atFlightLimit: boolean;
}

export interface WindowSearchResult {
  readonly options: TransferOptions;
  readonly windows: readonly LaunchWindow[];
  readonly flightDays: { readonly min: number; readonly max: number };
  readonly synodicDays: number;
}

/** 判断"窗口还开着"的余量：比最优 Δv 多不超过这个值 [m/s]。 */
export const WINDOW_MARGIN = 500;

const FLIGHT_SAMPLES = 48;

/** 本次搜索使用的飞行时间范围 [天]。 */
export const searchFlightRange = (input: WindowSearchInput): { readonly min: number; readonly max: number } => {
  const range = flightTimeRange(input.target);
  const max = input.maxFlightDays !== undefined && input.maxFlightDays > range.min ? input.maxFlightDays : range.max;
  return { min: range.min, max };
};

export const transferOptionsFor = (input: WindowSearchInput): TransferOptions => {
  const range = searchFlightRange(input);
  return {
    parkingAltitude: input.parkingAltitude,
    arrival: input.arrival,
    captureAltitude: input.captureAltitude ?? DEFAULT_CAPTURE_ALTITUDE[input.target],
    table: tableFor(input.startJd, input.endJd + range.max),
  };
};

/** 优化目标：总 Δv（飞掠时就是出发 Δv）。 */
const cost = (t: Transfer | null): number => (t ? t.totalDeltaV : Number.POSITIVE_INFINITY);

const bestOverFlightTime = (target: PlanetId, departureJd: number, options: TransferOptions, min: number, max: number): Transfer | null => {
  let best: Transfer | null = null;
  const earth = planetState('earth', departureJd, options.table);
  for (let k = 0; k < FLIGHT_SAMPLES; k++) {
    const days = min + ((max - min) * k) / (FLIGHT_SAMPLES - 1);
    const t = computeTransfer(target, departureJd, departureJd + days, options, earth);
    if (cost(t) < cost(best)) best = t;
  }
  return best;
};

/** 在 (出发日, 飞行天数) 附近逐步缩小网格，找局部最优。 */
const refine = (target: PlanetId, seed: Transfer, options: TransferOptions, depSpan: number, tofSpan: number, range: { min: number; max: number }): Transfer => {
  let best = seed;
  let dSpan = depSpan;
  let fSpan = tofSpan;
  for (let pass = 0; pass < 8; pass++) {
    const centerDep = best.departureJd;
    const centerTof = best.arrivalJd - best.departureJd;
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        const dep = centerDep + (dSpan * i) / 4;
        const tof = Math.min(range.max, Math.max(range.min, centerTof + (fSpan * j) / 4));
        const t = computeTransfer(target, dep, dep + tof, options);
        if (cost(t) < cost(best)) best = t as Transfer;
      }
    }
    dSpan /= 3;
    fSpan /= 3;
  }
  return best;
};

export const searchWindows = (input: WindowSearchInput): WindowSearchResult => {
  const options = transferOptionsFor(input);
  const range = searchFlightRange(input);
  const synodicDays = synodicPeriod(input.target) / ASTRO.SECONDS_PER_DAY;
  const step = Math.max(1, synodicDays / 150);
  const tofStep = (range.max - range.min) / (FLIGHT_SAMPLES - 1);

  const samples: { jd: number; transfer: Transfer | null }[] = [];
  for (let jd = input.startJd; jd <= input.endJd; jd += step) {
    samples.push({ jd, transfer: bestOverFlightTime(input.target, jd, options, range.min, range.max) });
  }

  // 局部最低点：在 ±半个会合周期内最低（端点上的"最低点"说明窗口在搜索范围之外，不算）
  const half = Math.max(1, Math.round(synodicDays / 2 / step));
  const windows: LaunchWindow[] = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const c = cost(samples[i]!.transfer);
    if (!Number.isFinite(c)) continue;
    let isMin = true;
    for (let k = Math.max(0, i - half); k <= Math.min(samples.length - 1, i + half); k++) {
      if (k !== i && cost(samples[k]!.transfer) < c) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;
    if (cost(samples[i - 1]!.transfer) === c || cost(samples[i + 1]!.transfer) === c) continue;
    const best = refine(input.target, samples[i]!.transfer!, options, 2 * step, 2 * tofStep, range);
    if (best.departureJd < input.startJd || best.departureJd > input.endJd) continue;
    // 窗口宽度：从最低点向两边找到 Δv 超过余量的位置
    const limit = best.totalDeltaV + WINDOW_MARGIN;
    let lo = i;
    while (lo > 0 && cost(samples[lo - 1]!.transfer) <= limit) lo--;
    let hi = i;
    while (hi < samples.length - 1 && cost(samples[hi + 1]!.transfer) <= limit) hi++;
    const tof = best.arrivalJd - best.departureJd;
    windows.push({ best, openJd: samples[lo]!.jd, closeJd: samples[hi]!.jd, atFlightLimit: tof > range.max - 0.01 * (range.max - range.min) });
  }
  return { options, windows, flightDays: range, synodicDays };
};

export interface PorkchopGrid {
  readonly target: PlanetId;
  readonly options: TransferOptions;
  /** 出发日（儒略日），按列。 */
  readonly departures: readonly number[];
  /** 飞行时间 [天]，按行。 */
  readonly flightDays: readonly number[];
  /** 每格的总 Δv [m/s]，下标 row * departures.length + col；无解为 NaN。 */
  readonly values: Float64Array;
  readonly min: number;
}

/** 以某个窗口的最优点为中心，生成 Δv 网格；range 是飞行时间范围 [天]。 */
export const porkchop = (
  target: PlanetId,
  centerJd: number,
  options: TransferOptions,
  range: { readonly min: number; readonly max: number } = flightTimeRange(target),
  columns = 90,
  rows = 70,
): PorkchopGrid => {
  const synodicDays = synodicPeriod(target) / ASTRO.SECONDS_PER_DAY;
  const halfWidth = Math.min(150, Math.max(25, 0.2 * synodicDays));
  const departures = Array.from({ length: columns }, (_, i) => centerJd - halfWidth + (2 * halfWidth * i) / (columns - 1));
  const flightDays = Array.from({ length: rows }, (_, j) => range.min + ((range.max - range.min) * j) / (rows - 1));
  const values = new Float64Array(columns * rows);
  let min = Number.POSITIVE_INFINITY;
  // 按列（出发日）循环：每列的地球状态只算一次
  for (let i = 0; i < columns; i++) {
    const dep = departures[i]!;
    const earth = planetState('earth', dep, options.table);
    for (let j = 0; j < rows; j++) {
      const t = computeTransfer(target, dep, dep + flightDays[j]!, options, earth);
      const v = t ? t.totalDeltaV : Number.NaN;
      values[j * columns + i] = v;
      if (v < min) min = v;
    }
  }
  return { target, options, departures, flightDays, values, min };
};
