/**
 * 发射窗口计算器的状态：输入条件、搜索结果、当前窗口的猪排图、玩家在图上点选的轨道。
 * 计算是纯函数（`game/interplanetary`），在后台线程里执行；这里只负责在输入变化后发出请求、接收结果。
 */
import { create } from 'zustand';
import { type PlanetId, isPlanetId } from '@/game/interplanetary/planets';
import { type ArrivalMode, type Transfer, computeTransfer, flightTimeRange } from '@/game/interplanetary/transfer';
import { type PorkchopGrid, type WindowSearchInput, type WindowSearchResult, porkchop } from '@/game/interplanetary/windows';
import { type MgaSearchInput, type MgaSearchResult, PRESET_ROUTES, isValidSequence, searchRoute } from '@/game/interplanetary/mga';
import { type InterplanetaryRequest, type InterplanetaryResponse, runDirect } from '@/workers/interplanetary.worker';
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
  /** 借力飞越的中间行星（不含地球出发点与目标）；空数组表示直飞。 */
  readonly flybys: readonly PlanetId[];
}

interface LaunchWindowState extends Inputs {
  readonly result: WindowSearchResult | null;
  readonly selectedWindow: number;
  readonly grid: PorkchopGrid | null;
  /** 玩家在猪排图上点选的轨道；null 表示显示窗口最优解。 */
  readonly picked: Transfer | null;
  readonly busy: boolean;
  /** 借力路线的搜索结果（后台线程计算）。 */
  readonly routeResult: MgaSearchResult | null;
  readonly routeError: string | null;
  readonly selectedSolution: number;
  setFlybys: (flybys: readonly PlanetId[]) => void;
  selectSolution: (index: number) => void;
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

const directInput = (inputs: Inputs): WindowSearchInput => ({
  target: inputs.target,
  startJd: yearJd(inputs.startYear),
  endJd: yearJd(inputs.startYear + inputs.span),
  arrival: inputs.arrival,
  parkingAltitude: PARKING_ALTITUDE,
  maxFlightDays: inputs.maxFlightDays ?? undefined,
});

/** 借力路线 = 地球 + 中间行星 + 目标。 */
export const routeOf = (inputs: Pick<Inputs, 'target' | 'flybys'>): PlanetId[] => ['earth', ...inputs.flybys, inputs.target];

export const presetFlybys = (target: PlanetId): PlanetId[][] => PRESET_ROUTES[target].map((route) => route.slice(1, -1));

let worker: Worker | null = null;
/** 后台线程正在算的请求；新请求到来时直接终止旧线程，不让它排在一个已经没用的长计算后面。 */
let inFlight = false;
let requestId = 0;

/** 发出请求；没有 Worker 的环境（例如 Node 测试）在下一轮事件循环里同步计算。 */
const dispatch = (request: InterplanetaryRequest, onMessage: (response: InterplanetaryResponse) => void): void => {
  if (typeof Worker === 'undefined') {
    setTimeout(() => {
      try {
        onMessage(request.kind === 'direct' ? { id: request.id, direct: runDirect(request.input) } : { id: request.id, route: searchRoute(request.input) });
      } catch (error) {
        onMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
      }
    }, 0);
    return;
  }
  if (worker && inFlight) {
    worker.terminate();
    worker = null;
  }
  if (!worker) worker = new Worker(new URL('../workers/interplanetary.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<InterplanetaryResponse>) => {
    if (event.data.id === requestId) inFlight = false;
    onMessage(event.data);
  };
  inFlight = true;
  worker.postMessage(request);
};

export const useLaunchWindowStore = create<LaunchWindowState>()((set, get) => {
  /** 输入变化：显示"计算中"，把计算交给后台线程；只接受最后一次请求的结果。 */
  const update = (patch: Partial<Inputs>) => {
    set({ ...patch, busy: true });
    const inputs = get();
    const id = ++requestId;
    if (inputs.flybys.length > 0) {
      const request: InterplanetaryRequest = {
        id,
        kind: 'route',
        input: {
          sequence: routeOf(inputs),
          startJd: yearJd(inputs.startYear),
          endJd: yearJd(inputs.startYear + inputs.span),
          arrival: inputs.arrival,
          parkingAltitude: PARKING_ALTITUDE,
          maxTotalDays: inputs.maxFlightDays ?? undefined,
        } satisfies MgaSearchInput,
      };
      set({ routeResult: null, routeError: null, selectedSolution: 0 });
      dispatch(request, (response) => {
        if (response.id !== requestId) return;
        set({ routeResult: response.route ?? null, routeError: response.error ?? null, busy: false, selectedSolution: 0 });
      });
      return;
    }
    dispatch({ id, kind: 'direct', input: directInput(inputs) }, (response) => {
      if (response.id !== requestId) return;
      if (response.direct) set({ result: response.direct.result, grid: response.direct.grid, selectedWindow: 0, picked: null, busy: false });
      else set({ busy: false, routeError: response.error ?? null });
    });
  };
  return {
    target: 'mars',
    startYear: currentYear(),
    span: 10,
    arrival: 'capture',
    maxFlightDays: null,
    flybys: [],
    routeResult: null,
    routeError: null,
    selectedSolution: 0,
    result: null,
    selectedWindow: 0,
    grid: null,
    picked: null,
    busy: false,
    setTarget: (target) => {
      if (isPlanetId(target) && target !== 'earth') update({ target, maxFlightDays: null, flybys: [] });
    },
    setStartYear: (year) => {
      if (Number.isInteger(year) && year >= FIRST_YEAR && year <= LAST_YEAR) update({ startYear: year });
    },
    setSpan: (span) => update({ span }),
    setArrival: (arrival) => update({ arrival }),
    setMaxFlightDays: (days) => {
      const { target, flybys } = get();
      const min = flybys.length > 0 ? 30 : flightTimeRange(target).min;
      if (days === null || (Number.isFinite(days) && days > min)) update({ maxFlightDays: days });
    },
    setFlybys: (flybys) => {
      const { target } = get();
      if (flybys.length > 0 && !isValidSequence(['earth', ...flybys, target])) return;
      update({ flybys: [...flybys], maxFlightDays: null });
    },
    selectSolution: (index) => {
      if (get().routeResult?.solutions[index]) set({ selectedSolution: index });
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
      const s = get();
      if (!s.busy && (s.flybys.length > 0 ? !s.routeResult : !s.result)) update({});
    },
  };
});
