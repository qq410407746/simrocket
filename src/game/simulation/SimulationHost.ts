/**
 * 模拟主机：实现指令/事件协议并按墙钟节拍驱动 Simulation。
 *
 * 不依赖 Worker API——只通过构造参数注入"发消息"和"取时间"两个函数，
 * 因此既可以跑在 Web Worker 里（正常路径），也可以跑在主线程（降级路径）
 * 或 Node 测试环境中。
 */
import { FixedStepClock } from './FixedStepClock';
import { Simulation, isValidVehicleState } from './Simulation';
import { buildSnapshot } from './snapshot';
import {
  PHYSICS_DT,
  type SimCommand,
  type SimEvent,
  type SimSnapshot,
  type TimeWarp,
  clampTimeWarp,
  isTimeWarp,
} from './types';

/** 建议的 tick 调用间隔 [ms]。 */
export const HOST_TICK_INTERVAL_MS = 4;
/** 快照发布的最小间隔 [ms]（约 60 Hz）。 */
export const SNAPSHOT_INTERVAL_MS = 1000 / 60;
/**
 * 单次 tick 最多执行的物理步数。
 * 1000× 倍率、4 ms tick 需要约 200 步；留出余量并防止卡顿后补算过多。
 */
const MAX_STEPS_PER_TICK = 4000;
/** 实际速率比的指数平滑时间常数 [s]。 */
const RATE_SMOOTHING_TIME = 0.5;

export class SimulationHost {
  private simulation: Simulation | null = null;
  private readonly clock = new FixedStepClock(PHYSICS_DT, MAX_STEPS_PER_TICK);
  private paused = false;
  /** 玩家指令的时间倍率。实际倍率还受物理状态限制，见 effectiveWarp。 */
  private timeWarp: TimeWarp = 1;
  private seq = 0;
  private lastTickMs: number | null = null;
  private lastSnapshotMs = -Infinity;
  /** 实际推进量 / 请求推进量 的平滑值；1 表示完全跟上指令倍率。 */
  private achievedRatio = 1;
  private faulted = false;
  private readonly emit: (event: SimEvent) => void;
  private readonly now: () => number;

  constructor(emit: (event: SimEvent) => void, now: () => number = () => performance.now()) {
    this.emit = emit;
    this.now = now;
  }

  handle(command: SimCommand): void {
    try {
      const sim = this.simulation;
      switch (command.type) {
        case 'init': {
          this.simulation = new Simulation(command.config);
          this.clock.reset();
          this.seq = 0;
          this.paused = false;
          this.timeWarp = 1;
          this.achievedRatio = 1;
          this.faulted = false;
          this.lastTickMs = null;
          this.emit({
            type: 'ready',
            epochJulianDate: this.simulation.epochJulianDate,
            earthAngleAtEpoch: this.simulation.earthAngleAtEpoch,
            physicsDt: this.simulation.dt,
          });
          break;
        }
        case 'setPaused':
          this.paused = command.paused;
          break;
        case 'setTimeWarp':
          if (!isTimeWarp(command.warp)) throw new Error(`不支持的时间倍率：${String(command.warp)}`);
          this.timeWarp = command.warp;
          break;
        case 'setThrottle':
          sim?.setThrottle(command.throttle);
          break;
        case 'setAttitudeInput':
          sim?.setAttitudeInput(command.input);
          break;
        case 'stage':
          sim?.stage();
          break;
        case 'jettisonFairing':
          sim?.jettisonFairing();
          break;
        case 'dispose':
          this.simulation = null;
          return;
      }
      // 指令可能立即改变状态（点火、分级、倍率限制）：马上发布，界面不必等到下一个快照周期。
      this.flushEvents();
      this.publishSnapshot(this.now());
    } catch (error) {
      this.fail(error);
    }
  }

  /** 由外部定时器周期性调用。 */
  tick(): void {
    const sim = this.simulation;
    if (!sim || this.faulted) return;
    try {
      const nowMs = this.now();
      const wallDt = this.lastTickMs === null ? 0 : (nowMs - this.lastTickMs) / 1000;
      this.lastTickMs = nowMs;

      if (!this.paused && wallDt > 0) {
        // 物理状态对倍率的限制在每一步之后重新检查：例如以 1000× 滑行进入大气层时，
        // 从进入的那一步起就按受限倍率推进，而不是等到下一个 tick。
        let warp = clampTimeWarp(this.timeWarp, sim.maxTimeWarp);
        const { steps, requested, dropped } = this.clock.advance(wallDt, warp);
        let executed = 0;
        for (; executed < steps; executed++) {
          sim.step();
          const limit = sim.maxTimeWarp;
          if (limit < warp) {
            // 条件变严：本 tick 剩余的步数按新倍率折算后丢弃（不计入"跟不上"的统计）。
            warp = limit;
            executed++;
            this.clock.reset();
            break;
          }
        }
        if (this.timeWarp > warp) this.timeWarp = warp;
        if (requested > 0 && executed === steps) {
          const ratio = 1 - dropped / requested;
          const alpha = 1 - Math.exp(-wallDt / RATE_SMOOTHING_TIME);
          this.achievedRatio += (ratio - this.achievedRatio) * alpha;
        }
        this.flushEvents();
      }

      if (nowMs - this.lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) this.publishSnapshot(nowMs);
    } catch (error) {
      this.fail(error);
    }
  }

  private flushEvents(): void {
    const events = this.simulation?.drainEvents() ?? [];
    if (events.length > 0) this.emit({ type: 'flightEvents', events });
  }

  private publishSnapshot(nowMs: number): void {
    const sim = this.simulation;
    if (!sim || this.faulted) return;
    // 玩家指令的倍率超过当前允许值时自动降档（并保持在降档后的值，不会自行回升）。
    const maxTimeWarp = sim.maxTimeWarp;
    if (this.timeWarp > maxTimeWarp) this.timeWarp = maxTimeWarp;
    const snapshot: SimSnapshot = buildSnapshot(sim, {
      seq: this.seq++,
      timeWarp: this.timeWarp,
      paused: this.paused,
      simRate: this.paused ? 0 : this.timeWarp * this.achievedRatio,
    });
    if (!isValidVehicleState(snapshot.vehicle) || !Number.isFinite(snapshot.simTime)) {
      throw new Error(`物理状态出现无效数值（t = ${sim.time} s），模拟已停止。`);
    }
    this.lastSnapshotMs = nowMs;
    this.emit({ type: 'snapshot', snapshot });
  }

  private fail(error: unknown): void {
    this.faulted = true;
    this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}
