/**
 * 发射窗口计算器的状态：输入条件、搜索结果、当前窗口的猪排图、玩家在图上点选的轨道。
 * 计算是纯函数（`game/interplanetary`），这里只负责在输入变化后重新计算。
 */
import { create } from 'zustand';
import { type PlanetId, isPlanetId } from '@/game/interplanetary/planets';
import { type ArrivalMode, type Transfer, computeTransfer, flightTimeRange } from '@/game/interplanetary/transfer';
import { type PorkchopGrid, type WindowSearchResult, porkchop, searchWindows } from '@/game/interplanetary/windows';
import { julianDateFromUnixMs } from '@/game/physics/ephemeris/time';

/** 停泊轨道高度 [m]：与游戏里"从近地轨道出发"一致。 */
export const PARKING_ALTITUDE = 200_000;
export const SEARCH_SPANS = [5, 10, 20] as const;
export type SearchSpan = (typeof SEARCH_SPANS)[number];
export const FIRST_YEAR = 2000;
export const LAST_YEAR = 2100;

interface Inputs {
  readonly target: PlanetId;
  readonly startYear: number;
  readonly span: SearchSpan;
  readonly arrival: ArrivalMode;
  /** 最长飞行时间 [天]；null 表示使用默认上限。 */
  readonly maxFlightDays: number | null;
}

interface LaunchWindowState extends Inputs {
  readonly result: WindowSearchResult | null;
  readonly selectedWindow: number;
  readonly grid: PorkchopGrid | null;
  /** 玩家在猪排图上点选的轨道；null 表示显示窗口最优解。 */
  readonly picked: Transfer | null;
  readonly busy: boolean;
  setTarget: (target: string) => void;
  setStartYear: (year: number) => void;
  setSpan: (span: SearchSpan) => void;
  setArrival: (arrival: ArrivalMode) => void;
  setMaxFlightDays: (days: number | null) => void;
  selectWindow: (index: number) => void;
  pick: (departureJd: number, flightDays: number) => void;
  clearPick: () => void;
  /** 立即按当前输入计算（界面挂载时调用一次）。 */
  compute: () => void;
}

const currentYear = (): number => Math.min(LAST_YEAR, Math.max(FIRST_YEAR, new Date().getUTCFullYear()));

const yearJd = (year: number): number => julianDateFromUnixMs(Date.UTC(year, 0, 1));

const run = (inputs: Inputs) => {
  const result = searchWindows({
    target: inputs.target,
    startJd: yearJd(inputs.startYear),
    endJd: yearJd(inputs.startYear + inputs.span),
    arrival: inputs.arrival,
    parkingAltitude: PARKING_ALTITUDE,
    maxFlightDays: inputs.maxFlightDays ?? undefined,
  });
  const first = result.windows[0];
  const grid = first ? porkchop(inputs.target, first.best.departureJd, result.options, result.flightDays) : null;
  return { result, grid, selectedWindow: 0, picked: null, busy: false };
};

let pending: ReturnType<typeof setTimeout> | null = null;

export const useLaunchWindowStore = create<LaunchWindowState>()((set, get) => {
  /** 输入变化：先显示"计算中"，下一帧再算，避免点击后界面卡住没有反馈。 */
  const update = (patch: Partial<Inputs>) => {
    set({ ...patch, busy: true });
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      set(run(get()));
    }, 0);
  };
  return {
    target: 'mars',
    startYear: currentYear(),
    span: 10,
    arrival: 'capture',
    maxFlightDays: null,
    result: null,
    selectedWindow: 0,
    grid: null,
    picked: null,
    busy: false,
    setTarget: (target) => {
      if (isPlanetId(target) && target !== 'earth') update({ target, maxFlightDays: null });
    },
    setStartYear: (year) => {
      if (Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR) update({ startYear: year });
    },
    setSpan: (span) => update({ span }),
    setArrival: (arrival) => update({ arrival }),
    setMaxFlightDays: (days) => {
      const range = flightTimeRange(get().target);
      if (days === null || (Number.isFinite(days) && days > range.min)) update({ maxFlightDays: days });
    },
    selectWindow: (index) => {
      const { result, target } = get();
      const window = result?.windows[index];
      if (!result || !window) return;
      set({ selectedWindow: index, picked: null, grid: porkchop(target, window.best.departureJd, result.options, result.flightDays) });
    },
    pick: (departureJd, flightDays) => {
      const { result, target } = get();
      if (!result) return;
      set({ picked: computeTransfer(target, departureJd, departureJd + flightDays, result.options) });
    },
    clearPick: () => set({ picked: null }),
    compute: () => {
      if (!get().result && !get().busy) update({});
    },
  };
});
