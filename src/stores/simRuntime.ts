/**
 * 模拟运行时：连接"物理线程 ↔ 状态 store ↔ 渲染"的唯一枢纽（模块级单例）。
 *
 * 数据流（单向）：
 *   UI 指令 ──▶ simRuntime ──postMessage──▶ Worker(SimulationHost → Simulation)
 *   Worker ──快照(≈60 Hz)──▶ simRuntime.snapshots ──(每帧插值)──▶ 渲染层
 *                                   └──(节流到 10 Hz)──▶ useSimStore ──▶ React UI
 */
import type { LaunchSite } from '@/data/launchSites';
import { launchSiteGeodetic } from '@/data/launchSites';
import type { AttitudeInput } from '@/game/physics/attitude/attitude';
import { DEG2RAD } from '@/game/physics/constants';
import { julianDateForLocalSolarTime } from '@/game/physics/ephemeris/time';
import { RenderClock, SnapshotBuffer } from '@/game/simulation/interpolation';
import type { SimEvent, SimSnapshot, SimulationConfig, TimeWarp } from '@/game/simulation/types';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { SimulationClient } from '@/workers/SimulationClient';
import { EVENT_LOG_LIMIT, INITIAL_SIM_STATE, useSimStore } from './simStore';

/** UI 遥测刷新间隔 [ms]。 */
const TELEMETRY_INTERVAL_MS = 100;

/** 默认发射日期与地方平太阳时：上午的侧向光照下火箭与地表最有层次。 */
const DEFAULT_LAUNCH_DATE = { year: 2026, month: 4, day: 12 } as const;
const DEFAULT_LOCAL_SOLAR_HOURS = 9.5;

export const createSimulationConfig = (vehicle: VehicleDefinition, site: LaunchSite): SimulationConfig => ({
  vehicle,
  site: launchSiteGeodetic(site),
  epochJulianDate: julianDateForLocalSolarTime(
    DEFAULT_LAUNCH_DATE.year,
    DEFAULT_LAUNCH_DATE.month,
    DEFAULT_LAUNCH_DATE.day,
    DEFAULT_LOCAL_SOLAR_HOURS,
    site.longitudeDeg * DEG2RAD,
  ),
});

/** 界面需要立即（而不是等到下一个 100 ms 周期）反映的离散状态。 */
const discreteStateKey = (s: SimSnapshot): string =>
  `${s.paused}|${s.timeWarp}|${s.maxTimeWarp}|${s.vehicle.phase}|${s.vehicle.ignited}|${s.vehicle.activeStageIndex}|` +
  `${s.vehicle.fairingAttached}|${s.vehicle.throttle.toFixed(3)}|${s.liftoffTime !== null}|${s.outcome !== null}`;

class SimRuntime {
  /** 渲染层每帧读取的快照缓冲（非响应式）。 */
  readonly snapshots = new SnapshotBuffer();
  readonly renderClock = new RenderClock();
  /** 当前会话配置；渲染层据此生成火箭模型与发射场位置。 */
  config: SimulationConfig | null = null;
  /** 历元时刻地球自转角 [rad]（由模拟器在 ready 事件中给出）。 */
  earthAngleAtEpoch = 0;

  private client: SimulationClient | null = null;
  private lastTelemetryMs = -Infinity;
  private lastDiscreteKey = '';

  /** 以给定配置（重新）开始模拟。 */
  start(config: SimulationConfig): void {
    if (!this.client) this.client = new SimulationClient(this.handleEvent);
    this.config = config;
    this.snapshots.clear();
    this.renderClock.reset();
    this.lastTelemetryMs = -Infinity;
    this.lastDiscreteKey = '';
    useSimStore.setState({
      ...INITIAL_SIM_STATE,
      status: 'starting',
      execution: this.client.execution,
      epochJulianDate: config.epochJulianDate,
    });
    this.client.send({ type: 'init', config });
  }

  /** 以当前配置重新开始（回到发射台）。 */
  restart(): void {
    if (this.config) this.start(this.config);
  }

  setPaused(paused: boolean): void {
    this.client?.send({ type: 'setPaused', paused });
  }

  setTimeWarp(warp: TimeWarp): void {
    this.client?.send({ type: 'setTimeWarp', warp });
  }

  /** 节流指令 [0, 1]。 */
  setThrottle(throttle: number): void {
    this.client?.send({ type: 'setThrottle', throttle });
  }

  setAttitudeInput(input: AttitudeInput): void {
    this.client?.send({ type: 'setAttitudeInput', input });
  }

  /** 飞行序列的下一步：点火 / 分级 / 载荷发动机点火。 */
  stage(): void {
    this.client?.send({ type: 'stage' });
  }

  jettisonFairing(): void {
    this.client?.send({ type: 'jettisonFairing' });
  }

  stop(): void {
    this.client?.dispose();
    this.client = null;
    this.config = null;
    this.snapshots.clear();
    useSimStore.setState({ ...INITIAL_SIM_STATE });
  }

  private readonly handleEvent = (event: SimEvent): void => {
    const config = this.config;
    switch (event.type) {
      case 'ready':
        this.earthAngleAtEpoch = event.earthAngleAtEpoch;
        break;
      case 'snapshot': {
        if (!config) break;
        const now = performance.now();
        const { snapshot } = event;
        this.snapshots.push(snapshot, now);
        const key = discreteStateKey(snapshot);
        const store = useSimStore.getState();
        if (key !== this.lastDiscreteKey || store.status !== 'running' || now - this.lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
          this.lastTelemetryMs = now;
          this.lastDiscreteKey = key;
          useSimStore.setState({
            status: 'running',
            telemetry: deriveTelemetry(snapshot, config),
            paused: snapshot.paused,
            timeWarp: snapshot.timeWarp,
            maxTimeWarp: snapshot.maxTimeWarp,
            simRate: snapshot.simRate,
            liftoffTime: snapshot.liftoffTime,
            stats: snapshot.stats,
            outcome: snapshot.outcome,
          });
        }
        break;
      }
      case 'flightEvents': {
        const events = [...useSimStore.getState().events, ...event.events];
        useSimStore.setState({ events: events.slice(-EVENT_LOG_LIMIT) });
        break;
      }
      case 'error':
        console.error('[simulation]', event.message);
        useSimStore.setState({ status: 'error', errorMessage: event.message });
        break;
    }
  };
}

export const simRuntime = new SimRuntime();
