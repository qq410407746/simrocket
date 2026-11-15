/**
 * 模拟运行时：连接"物理线程 ↔ 状态 store ↔ 渲染"的唯一枢纽（模块级单例）。
 *
 * 数据流（单向）：
 *   UI 指令 ──▶ simRuntime ──postMessage──▶ Worker(SimulationHost → Simulation)
 *   Worker ──快照(≈60 Hz)──▶ simRuntime.snapshots ──(每帧插值)──▶ 渲染层
 *                                   └──(节流到 10 Hz)──▶ useSimStore ──▶ React UI
 *                                                 └──▶ 任务判定、飞行记录仪 ──▶ 生涯存档
 *
 * 任务判定只读遥测、统计量与飞行结果（game/missions/tracker.ts），从不向物理线程发指令。
 */
import type { LaunchSite } from '@/data/launchSites';
import { launchSiteGeodetic } from '@/data/launchSites';
import { buildLogEntry } from '@/game/missions/logbook';
import { scoreMission } from '@/game/missions/scoring';
import { createMissionState, missionMetrics, updateMission } from '@/game/missions/tracker';
import type { MissionDefinition } from '@/game/missions/types';
import type { AttitudeInput } from '@/game/physics/attitude/attitude';
import type { AttitudeMode } from '@/game/physics/attitude/pointing';
import { RenderClock, SnapshotBuffer } from '@/game/simulation/interpolation';
import { createFlightConfig } from '@/game/simulation/startConditions';
import type {
  SimEvent,
  SimSnapshot,
  SimulationConfig,
  TimeWarp,
  TrajectoryPrediction,
} from '@/game/simulation/types';
import { FlightRecorder, sampleFlight } from '@/game/telemetry/flightRecorder';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import { ThermalHistory, sampleThermal } from '@/game/telemetry/thermalHistory';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { SimulationClient } from '@/workers/SimulationClient';
import { useCareerStore } from './careerStore';
import type { StartMode } from './gameStore';
import { EVENT_LOG_LIMIT, INITIAL_SIM_STATE, useSimStore } from './simStore';

/** UI 遥测刷新间隔 [ms]。 */
const TELEMETRY_INTERVAL_MS = 100;

export const createSimulationConfig = (vehicle: VehicleDefinition, site: LaunchSite, start: StartMode = 'pad'): SimulationConfig =>
  createFlightConfig(vehicle, launchSiteGeodetic(site), start);

/** 一次飞行的背景：从哪个发射场、以哪种方式出发、属于哪个任务。写进飞行日志。 */
export interface FlightContext {
  readonly siteId: string;
  readonly start: StartMode;
  readonly mission: MissionDefinition | null;
}

const NO_CONTEXT: FlightContext = { siteId: '', start: 'pad', mission: null };

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
  /** 整次飞行的高度、速度、过载、热流记录（非响应式），供结果面板画曲线。 */
  readonly flightRecorder = new FlightRecorder(720, 1);
  /** 当前飞行的背景与标识。 */
  context: FlightContext = NO_CONTEXT;
  private flightId = '';
  private flightCounter = 0;

  private client: SimulationClient | null = null;
  private lastTelemetryMs = -Infinity;
  private lastDiscreteKey = '';
  /** 待补发的尾随遥测更新的定时器。 */
  private trailingTelemetry: ReturnType<typeof setTimeout> | null = null;

  /** 以给定配置（重新）开始模拟。context 给出这次飞行属于哪个任务（没有则是自由飞行）。 */
  start(config: SimulationConfig, context: FlightContext = NO_CONTEXT): void {
    // 离开上一次飞行之前，把它记进飞行日志
    this.logFlight();
    if (!this.client) this.client = new SimulationClient(this.handleEvent);
    this.config = config;
    this.context = context;
    this.flightCounter += 1;
    this.flightId = `${Date.now().toString(36)}-${this.flightCounter}`;
    this.prediction = null;
    this.thermalHistory.clear();
    this.flightRecorder.clear();
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
      missionId: context.mission?.id ?? null,
      mission: context.mission ? createMissionState(context.mission) : null,
    });
    this.client.send({ type: 'init', config });
  }

  /** 以当前配置重新开始（回到发射台）。任务飞行重新开始的仍是同一个任务。 */
  restart(): void {
    if (this.config) this.start(this.config, this.context);
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
    this.logFlight();
    this.client?.dispose();
    this.client = null;
    this.config = null;
    this.context = NO_CONTEXT;
    this.prediction = null;
    this.thermalHistory.clear();
    this.flightRecorder.clear();
    this.cancelTrailingTelemetry();
    this.snapshots.clear();
    useSimStore.setState({ ...INITIAL_SIM_STATE });
  }

  private publishTelemetry(snapshot: SimSnapshot, config: SimulationConfig, now: number): void {
    this.lastTelemetryMs = now;
    this.lastDiscreteKey = discreteStateKey(snapshot);
    const telemetry = deriveTelemetry(snapshot, config);
    const previous = useSimStore.getState();
    this.flightRecorder.record(sampleFlight(telemetry));

    // 任务判定：只读遥测、统计量与飞行结果
    const { mission } = this.context;
    let missionState = previous.mission;
    let missionScore = previous.missionScore;
    let missionEnded = false;
    if (mission && missionState) {
      const input = { telemetry, stats: snapshot.stats, outcome: snapshot.outcome };
      const next = updateMission(mission, missionState, input);
      if (next.status !== 'active' && missionState.status === 'active') {
        missionScore = scoreMission(mission, next, missionMetrics(mission, next, input));
        missionEnded = true;
      }
      missionState = next;
    }
    const flightEnded = snapshot.outcome !== null && previous.outcome === null;

    useSimStore.setState({
      status: 'running',
      telemetry,
      paused: snapshot.paused,
      timeWarp: snapshot.timeWarp,
      maxTimeWarp: snapshot.maxTimeWarp,
      simRate: snapshot.simRate,
      liftoffTime: snapshot.liftoffTime,
      stats: snapshot.stats,
      outcome: snapshot.outcome,
      mission: missionState,
      missionScore,
    });

    if (missionEnded && mission && missionState && missionScore) {
      useCareerStore.getState().recordMission(mission.id, missionScore, missionState.status === 'success');
    }
    // 任务有了结论、或飞行结束：写入（或更新）这次飞行的日志
    if (missionEnded || flightEnded) this.logFlight();
  }

  /**
   * 把当前飞行写进飞行日志（同一次飞行重复调用会更新同一条记录）。
   * 还没有起飞、或"从轨道出发"后什么都没做（没有任何飞行事件）的飞行不记录。
   */
  private logFlight(): void {
    const config = this.config;
    const store = useSimStore.getState();
    const { telemetry, stats } = store;
    if (!config || !telemetry || !stats || store.liftoffTime === null) return;
    if (store.events.length === 0 && store.outcome === null) return;
    useCareerStore.getState().saveFlight(
      buildLogEntry({
        id: this.flightId,
        date: new Date().toISOString(),
        missionId: this.context.mission?.id ?? null,
        vehicleId: config.vehicle.id,
        siteId: this.context.siteId,
        start: this.context.start,
        telemetry,
        stats,
        outcome: store.outcome,
        mission: store.mission,
        score: store.missionScore,
      }),
    );
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
        this.flightRecorder.addEvents(event.events);
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
