/**
 * 飞行记录仪：把一次飞行的关键量按时间记录下来，供飞行结束后画曲线。
 *
 * 容量固定。记满之后把已有的点隔一个丢一个、采样间隔加倍——于是不管飞行持续几分钟还是几小时，
 * 整个过程始终由几百个点覆盖（越长的飞行时间分辨率越低）。
 * 曲线上的极值可能落在两个采样点之间：精确的最大值以物理线程逐步累计的统计量（FlightStats）为准。
 */
import type { FlightEvent } from '../simulation/types';
import type { Telemetry } from './telemetry';

export interface FlightSample {
  /** 任务时间（自起飞起）[s]。 */
  readonly time: number;
  /** 海拔高度 [m]。 */
  readonly altitude: number;
  /** 相对地面的速度 [m/s]。 */
  readonly speed: number;
  /** 过载 [g]。 */
  readonly gLoad: number;
  /** 动压 [Pa]。 */
  readonly dynamicPressure: number;
  /** 各热区中最大的对流热流 [W/m²]（不小于 0）。 */
  readonly heatFlux: number;
}

/** 由遥测取一个采样点；尚未起飞时返回 null。 */
export const sampleFlight = (telemetry: Telemetry): FlightSample | null => {
  if (telemetry.missionTime === null) return null;
  let heatFlux = 0;
  for (const zone of telemetry.thermal) heatFlux = Math.max(heatFlux, zone.heatFlux);
  return {
    time: telemetry.missionTime,
    altitude: telemetry.altitude,
    speed: telemetry.surfaceSpeed,
    gLoad: telemetry.gLoad,
    dynamicPressure: telemetry.dynamicPressure,
    heatFlux,
  };
};

/** 保留的事件条数上限。 */
const EVENT_LIMIT = 200;

export class FlightRecorder {
  private points: FlightSample[] = [];
  private eventLog: FlightEvent[] = [];
  private currentInterval: number;
  private readonly capacity: number;
  private readonly baseInterval: number;

  /**
   * @param capacity 最多保留的采样点数（不小于 4）
   * @param interval 初始采样间隔（任务时间）[s]
   */
  constructor(capacity = 720, interval = 1) {
    if (!(capacity >= 4)) throw new Error(`FlightRecorder: 容量至少为 4，收到 ${capacity}`);
    if (!(interval > 0)) throw new Error(`FlightRecorder: 采样间隔必须为正数，收到 ${interval}`);
    this.capacity = Math.floor(capacity);
    this.baseInterval = interval;
    this.currentInterval = interval;
  }

  /** 当前的采样间隔 [s]（记满后会加倍）。 */
  get interval(): number {
    return this.currentInterval;
  }

  get samples(): readonly FlightSample[] {
    return this.points;
  }

  get events(): readonly FlightEvent[] {
    return this.eventLog;
  }

  /**
   * 记录一个采样点。距上一个点不足一个采样间隔、时间倒退或含无效数值时忽略，返回 false。
   */
  record(sample: FlightSample | null): boolean {
    if (!sample || !Object.values(sample).every((value) => Number.isFinite(value))) return false;
    const last = this.points[this.points.length - 1];
    if (last && sample.time < last.time + this.currentInterval) return false;
    this.points.push(sample);
    if (this.points.length > this.capacity) {
      // 隔一个丢一个（保留第 0、2、4… 个），间隔加倍
      this.points = this.points.filter((_, i) => i % 2 === 0);
      this.currentInterval *= 2;
    }
    return true;
  }

  addEvents(events: readonly FlightEvent[]): void {
    if (events.length === 0) return;
    this.eventLog = [...this.eventLog, ...events].slice(-EVENT_LIMIT);
  }

  clear(): void {
    this.points = [];
    this.eventLog = [];
    this.currentInterval = this.baseInterval;
  }
}
