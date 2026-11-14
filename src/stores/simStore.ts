/**
 * 模拟状态（供 React UI 订阅）。以约 10 Hz 更新，避免 60 Hz 快照触发整棵 UI 树重渲染。
 * 渲染层不读这个 store，而是直接读 simRuntime 中的快照缓冲。
 */
import { create } from 'zustand';
import type { TimeWarp } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { SimulationExecution } from '@/workers/SimulationClient';

export type SimStatus = 'idle' | 'starting' | 'running' | 'error';

interface SimState {
  status: SimStatus;
  errorMessage: string | null;
  /** 物理实际运行位置：Web Worker 或主线程降级。 */
  execution: SimulationExecution | null;
  telemetry: Telemetry | null;
  paused: boolean;
  timeWarp: TimeWarp;
  /** 实际模拟速率 [模拟秒/墙钟秒]。 */
  simRate: number;
  epochJulianDate: number | null;
}

export const useSimStore = create<SimState>()(() => ({
  status: 'idle',
  errorMessage: null,
  execution: null,
  telemetry: null,
  paused: false,
  timeWarp: 1,
  simRate: 0,
  epochJulianDate: null,
}));
