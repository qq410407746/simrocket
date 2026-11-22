import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVehicleOrDefault } from '@/data/vehicles';
import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { PHYSICS_DT, type SimCommand, type SimEvent } from '@/game/simulation/types';

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: SimEvent }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  commands: SimCommand[] = [];
  constructor() { TestWorker.instances.push(this); }
  postMessage(command: SimCommand) { this.commands.push(command); }
  terminate() { this.terminated = true; }
  /** 即使模拟已经排队的旧回调仍触发，也必须由客户端丢弃。 */
  emit(event: SimEvent) { this.onmessage?.({ data: event }); }
}
afterEach(() => { vi.unstubAllGlobals(); TestWorker.instances = []; });
describe('飞行会话隔离', () => {
  it('重启后旧Worker的迟到消息不进入新飞行；新Worker仍接收指令', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', TestWorker);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    const { simRuntime, createSimulationConfig } = await import('./simRuntime');
    const config = createSimulationConfig(getVehicleOrDefault('meteor-s'), getLaunchSiteOrDefault('jiuquan'));
    try {
      simRuntime.start(config);
      const old = TestWorker.instances[0]!;
      old.emit({ type: 'ready', epochJulianDate: config.epochJulianDate, physicsDt: PHYSICS_DT, earthAngleAtEpoch: 1 });
      expect(simRuntime.earthAngleAtEpoch).toBe(1);
      simRuntime.restart();
      expect(old.terminated).toBe(true);
      expect(TestWorker.instances).toHaveLength(2);
      const current = TestWorker.instances[1]!;
      current.emit({ type: 'ready', epochJulianDate: config.epochJulianDate, physicsDt: PHYSICS_DT, earthAngleAtEpoch: 2 });
      old.emit({ type: 'ready', epochJulianDate: config.epochJulianDate, physicsDt: PHYSICS_DT, earthAngleAtEpoch: 99 });
      old.emit({ type: 'error', message: '过期错误' });
      const { useSimStore } = await import('./simStore');
      expect(useSimStore.getState().errorMessage).toBeNull();
      expect(simRuntime.earthAngleAtEpoch).toBe(2);
      simRuntime.setThrottle(0);
      expect(current.commands.at(-1)).toEqual({ type: 'setThrottle', throttle: 0 });
      expect(old.commands).toHaveLength(1);
    } finally { simRuntime.stop(); }
    expect(TestWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});
