/**
 * 模拟状态（供 React UI 订阅）。以约 10 Hz 更新，避免 60 Hz 快照触发整棵 UI 树重渲染。
 * 渲染层不读这个 store，而是直接读 simRuntime 中的快照缓冲。
 */
import { create } from 'zustand';
import type { FlightEvent, FlightOutcome, FlightStats, PredictedImpact, TimeWarp } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { SimulationExecution } from '@/workers/SimulationClient';

export type SimStatus = 'idle' | 'starting' | 'running' | 'error';

/** 事件记录里保留的最近事件条数。 */
export const EVENT_LOG_LIMIT = 30;

interface SimState {
  status: SimStatus;
  errorMessage: string | null;
  /** 物理实际运行位置：Web Worker 或主线程降级。 */
  execution: SimulationExecution | null;
  telemetry: Telemetry | null;
  paused: boolean;
  timeWarp: TimeWarp;
  /** 当前物理状态允许的最大时间倍率。 */
  maxTimeWarp: TimeWarp;
  /** 实际模拟速率 [模拟秒/墙钟秒]。 */
  simRate: number;
  epochJulianDate: number | null;
  /** 起飞时刻的模拟时间 [s]；未起飞为 null。 */
  liftoffTime: number | null;
  stats: FlightStats | null;
  outcome: FlightOutcome | null;
  /** 最近的飞行事件，按时间先后排列。 */
  events: readonly FlightEvent[];
  /** 轨迹预测给出的落点（假设从现在起不再有推力）；没有预测或预测时段内不触地时为 null。 */
  predictedImpact: PredictedImpact | null;
}

export const INITIAL_SIM_STATE: SimState = {
  status: 'idle',
  errorMessage: null,
  execution: null,
  telemetry: null,
  paused: false,
  timeWarp: 1,
  maxTimeWarp: 1000,
  simRate: 0,
  epochJulianDate: null,
  liftoffTime: null,
  stats: null,
  outcome: null,
  events: [],
  predictedImpact: null,
};

export const useSimStore = create<SimState>()(() => ({ ...INITIAL_SIM_STATE }));
