/**
 * 主线程侧的模拟客户端：封装"物理跑在哪里"。
 *
 * 正常路径：Web Worker。物理积分不占用主线程，UI 与渲染不会被长时间阻塞。
 * 降级路径：若 Worker 无法创建（极少数环境 / 安全策略），在主线程用同一个
 *           SimulationHost 以定时器驱动，行为一致但会与渲染争用 CPU。
 */
import { HOST_TICK_INTERVAL_MS, SimulationHost } from '@/game/simulation/SimulationHost';
import type { SimCommand, SimEvent } from '@/game/simulation/types';

export type SimulationExecution = 'worker' | 'main-thread';

export class SimulationClient {
  private worker: Worker | null = null;
  private fallbackHost: SimulationHost | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly listener: (event: SimEvent) => void;

  constructor(listener: (event: SimEvent) => void) {
    this.listener = listener;
    try {
      const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<SimEvent>) => {
        if (!this.disposed) this.listener(event.data);
      };
      worker.onerror = (event) => {
        if (this.disposed) return;
        this.listener({ type: 'error', message: `物理线程错误：${event.message || '未知错误'}` });
      };
      this.worker = worker;
    } catch {
      this.startFallback();
    }
  }

  get execution(): SimulationExecution {
    return this.worker ? 'worker' : 'main-thread';
  }

  send(command: SimCommand): void {
    if (this.disposed) return;
    if (this.worker) this.worker.postMessage(command);
    else this.fallbackHost?.handle(command);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    if (this.fallbackTimer !== null) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
    this.fallbackHost = null;
  }

  private startFallback(): void {
    const host = new SimulationHost((event) => {
      if (!this.disposed) this.listener(event);
    });
    this.fallbackHost = host;
    this.fallbackTimer = setInterval(() => host.tick(), HOST_TICK_INTERVAL_MS);
  }
}
