/**
 * 只读调试接口，挂在 window.__orbitalFrontier 上。
 * 供端到端测试与开发者在控制台检查"渲染层实际拿到了什么数据"，不提供任何修改状态的入口。
 */
import { frameState } from '@/rendering/core/frameState';
import { simRuntime } from '@/stores/simRuntime';
import { usePerfStore } from '@/stores/perfStore';
import { useSimStore } from '@/stores/simStore';

export interface DebugApi {
  /** 当前渲染帧状态的副本。 */
  frame: () => typeof frameState;
  /** 最新的物理快照。 */
  snapshot: () => ReturnType<typeof latestSnapshot>;
  /** UI 层看到的模拟状态。 */
  sim: () => ReturnType<typeof useSimStore.getState>;
  perf: () => ReturnType<typeof usePerfStore.getState>;
}

const latestSnapshot = () => simRuntime.snapshots.latest;

declare global {
  interface Window {
    __orbitalFrontier?: DebugApi;
  }
}

export const installDebugApi = (): void => {
  window.__orbitalFrontier = {
    frame: () => ({ ...frameState }),
    snapshot: latestSnapshot,
    sim: () => useSimStore.getState(),
    perf: () => usePerfStore.getState(),
  };
};
