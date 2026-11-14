/**
 * 物理模拟 Web Worker 入口。
 * 只做"胶水"：把消息转交给 SimulationHost，并用定时器驱动它。
 * 所有逻辑都在 SimulationHost / Simulation 中，可脱离 Worker 测试。
 */
import { HOST_TICK_INTERVAL_MS, SimulationHost } from '@/game/simulation/SimulationHost';
import type { SimCommand, SimEvent } from '@/game/simulation/types';

/** Worker 全局作用域中本文件用到的最小接口（避免同时引入 DOM 与 WebWorker 类型库的冲突）。 */
interface WorkerScope {
  postMessage(message: SimEvent): void;
  onmessage: ((event: MessageEvent<SimCommand>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const host = new SimulationHost((event) => scope.postMessage(event));

scope.onmessage = (event) => host.handle(event.data);
setInterval(() => host.tick(), HOST_TICK_INTERVAL_MS);
