import { create } from 'zustand';

/** 实测的渲染性能（每 0.5 s 更新一次）。 */
interface PerfState {
  /** 每秒帧数（实测值）。 */
  fps: number;
  /** 平均帧间隔 [ms]。 */
  frameMs: number;
  /** 统计窗口内最长的单帧间隔 [ms]。 */
  worstFrameMs: number;
}

export const usePerfStore = create<PerfState>()(() => ({ fps: 0, frameMs: 0, worstFrameMs: 0 }));
