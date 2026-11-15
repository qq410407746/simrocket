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
import type { AttitudeMode } from '@/game/physics/attitude/pointing';
import { DEG2RAD } from '@/game/physics/constants';
import { julianDateForLocalSolarTime } from '@/game/physics/ephemeris/time';
import { RenderClock, SnapshotBuffer } from '@/game/simulation/interpolation';
import { canStartInOrbit, orbitStartState } from '@/game/simulation/startConditions';
import type {
  SimEvent,
  SimSnapshot,
  SimulationConfig,
  TimeWarp,
  TrajectoryPrediction,
} from '@/game/simulation/types';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import { ThermalHistory, sampleThermal } from '@/game/telemetry/thermalHistory';
import type { VehicleDefinition } from '@/game/vehicles/types';
import type { StartMode } from './gameStore';
import { SimulationClient } from '@/workers/SimulationClient';
import { EVENT_LOG_LIMIT, INITIAL_SIM_STATE, useSimStore } from './simStore';

/** UI 遥测刷新间隔 [ms]。 */
const TELEMETRY_INTERVAL_MS = 100;

/** 默认发射日期与地方平太阳时：上午的侧向光照下火箭与地表最有层次。 */
const DEFAULT_LAUNCH_DATE = { year: 2026, month: 4, day: 12 } as const;
const DEFAULT_LOCAL_SOLAR_HOURS = 9.5;

export const createSimulationConfig = (vehicle: VehicleDefinition, site: LaunchSite, start: StartMode = 'pad'): SimulationConfig => {
  const epochJulianDate = julianDateForLocalSolarTime(
    DEFAULT_LAUNCH_DATE.year,
    DEFAULT_LAUNCH_DATE.month,
    DEFAULT_LAUNCH_DATE.day,
    DEFAULT_LOCAL_SOLAR_HOURS,
    site.longitudeDeg * DEG2RAD,
  );
  const geodetic = launchSiteGeodetic(site);
  return {
    vehicle,
    site: geodetic,
    epochJulianDate,
    initialState: start === 'orbit' && canStartInOrbit(vehicle) ? orbitStartState(vehicle, geodetic, epochJulianDate) : undefined,
  };
};

/** 界面需要立即（而不是等到下一个 100 ms 周期）反映的离散状态。 */
const discreteStateKey = (s: SimSnapshot): string =>
  `${s.paused}|${s.timeWarp}|${s.maxTimeWarp}|${s.vehicle.phase}|${s.vehicle.ignited}|${s.vehicle.activeStageIndex}|` +
  `${s.vehicle.fairingAttached}|${s.vehicle.heatShieldAttached}|${s.vehicle.parachute.phase}|` +
  `${s.vehicle.throttle.toFixed(3)}|${s.vehicle.attitudeMode}|` +
  `${s.liftoffTime !== null}|${s.outcome !== null}`;

class SimRuntime {
  /** 渲染层每帧读取的快照缓冲（非响应式）。 */
  readonly snapshots = new SnapshotBuffer();
  readonly renderClock = new RenderClock();
  /** 当前会话配置；渲染层据此生成火箭模型与发射场位置。 */
  config: SimulationConfig | null = null;
  /** 历元时刻地球自转角 [rad]（由模拟器在 ready 事件中给出）。 */
  earthAngleAtEpoch = 0;
  /** 最新的轨迹预测（非响应式，轨道地图每帧读取）；不适用时为 null。 */
  prediction: TrajectoryPrediction | null = null;
  /** 热流与温度的时间历程（约每模拟秒一个点，最近 10 分钟），供热防护面板画曲线。 */
  readonly thermalHistory = new ThermalHistory(600, 1);

  private client: SimulationClient | null = null;
  private lastTelemetryMs = -Infinity;
  private lastDiscreteKey = '';
  /** 待补发的尾随遥测更新的定时器。 */
  private trailingTelemetry: ReturnType<typeof setTimeout> | null = null;

  /** 以给定配置（重新）开始模拟。 */
  start(config: SimulationConfig): void {
    if (!this.client) this.client = new SimulationClient(this.handleEvent);
    this.config = config;
    this.prediction = null;
    this.thermalHistory.clear();
    this.cancelTrailingTelemetry();
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

  /** 自动指向模式（手动 / 顺行 / 逆行 / 法向 / 径向）。 */
  setAttitudeMode(mode: AttitudeMode): void {
    this.client?.send({ type: 'setAttitudeMode', mode });
  }

  /** 飞行序列的下一步：点火 / 分级 / 载荷发动机点火。 */
  stage(): void {
    this.client?.send({ type: 'stage' });
  }

  jettisonFairing(): void {
    this.client?.send({ type: 'jettisonFairing' });
  }

  /** 开伞（减速伞 → 主伞）。 */
  deployParachute(): void {
    this.client?.send({ type: 'deployParachute' });
  }

  /** 抛掉防热大底。 */
  jettisonHeatShield(): void {
    this.client?.send({ type: 'jettisonHeatShield' });
  }

  stop(): void {
    this.client?.dispose();
    this.client = null;
    this.config = null;
    this.prediction = null;
    this.thermalHistory.clear();
    this.cancelTrailingTelemetry();
    this.snapshots.clear();
    useSimStore.setState({ ...INITIAL_SIM_STATE });
  }

  private publishTelemetry(snapshot: SimSnapshot, config: SimulationConfig, now: number): void {
    this.lastTelemetryMs = now;
    this.lastDiscreteKey = discreteStateKey(snapshot);
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

  private cancelTrailingTelemetry(): void {
    if (this.trailingTelemetry !== null) clearTimeout(this.trailingTelemetry);
    this.trailingTelemetry = null;
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
        this.thermalHistory.record(sampleThermal(snapshot.simTime, snapshot.vehicle.thermal));
        const key = discreteStateKey(snapshot);
        const store = useSimStore.getState();
        const elapsed = now - this.lastTelemetryMs;
        if (key !== this.lastDiscreteKey || store.status !== 'running' || elapsed >= TELEMETRY_INTERVAL_MS) {
          this.publishTelemetry(snapshot, config, now);
        } else if (this.trailingTelemetry === null) {
          // 尾随更新：主线程卡顿后会一口气处理一批积压的快照，它们的到达时刻几乎相同，
          // 只有第一个（最旧的）能通过上面的节流。稍后用缓冲区里最新的快照补发一次，界面才不会停在旧数据上。
          this.trailingTelemetry = setTimeout(() => {
            this.trailingTelemetry = null;
            const latest = this.snapshots.latest;
            if (latest && this.config) this.publishTelemetry(latest, this.config, performance.now());
          }, TELEMETRY_INTERVAL_MS - elapsed);
        }
        break;
      }
      case 'prediction': {
        this.prediction = event.prediction;
        const impact = event.prediction?.impact ?? null;
        if (impact !== useSimStore.getState().predictedImpact) useSimStore.setState({ predictedImpact: impact });
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
