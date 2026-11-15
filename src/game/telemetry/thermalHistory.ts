/**
 * 热流与温度的时间历程（供热防护监控面板画曲线）。
 * 定长环形缓冲：按固定的模拟时间间隔采样，只保留最近的一段。纯数据结构，不依赖界面。
 */
import type { ThermalZoneTelemetry } from '../vehicles/types';

export interface ThermalSample {
  /** 模拟时间 [s]。 */
  readonly time: number;
  /** 各热区中最大的对流热流 [W/m²]。 */
  readonly heatFlux: number;
  /** 各热区中最高的表面温度、内部温度 [K]。 */
  readonly surfaceTemperature: number;
  readonly interiorTemperature: number;
}

/** 由三个热区的遥测取一个采样点（各项取最大值）。 */
export const sampleThermal = (time: number, zones: readonly ThermalZoneTelemetry[]): ThermalSample => {
  let heatFlux = 0;
  let surfaceTemperature = 0;
  let interiorTemperature = 0;
  for (const zone of zones) {
    if (zone.heatFlux > heatFlux) heatFlux = zone.heatFlux;
    if (zone.surfaceTemperature > surfaceTemperature) surfaceTemperature = zone.surfaceTemperature;
    if (zone.interiorTemperature > interiorTemperature) interiorTemperature = zone.interiorTemperature;
  }
  return { time, heatFlux, surfaceTemperature, interiorTemperature };
};

export class ThermalHistory {
  private readonly buffer: ThermalSample[] = [];
  private start = 0;
  readonly capacity: number;
  /** 相邻采样点之间的最小模拟时间间隔 [s]。 */
  readonly interval: number;

  constructor(capacity = 600, interval = 1) {
    this.capacity = Math.max(2, Math.floor(capacity));
    this.interval = interval;
  }

  get length(): number {
    return this.buffer.length;
  }

  /** 最新的采样点；没有则为 null。 */
  get latest(): ThermalSample | null {
    return this.buffer.length === 0 ? null : (this.at(this.buffer.length - 1) as ThermalSample);
  }

  /** 第 i 个采样点（0 为最旧）。 */
  at(index: number): ThermalSample | undefined {
    if (index < 0 || index >= this.buffer.length) return undefined;
    return this.buffer[(this.start + index) % this.buffer.length];
  }

  /**
   * 记录一个采样点。距上一个采样点不足 interval 时忽略；
   * 时间倒退（重新开始了一次飞行）时清空后重新记录。
   * @returns 是否记录了新的采样点
   */
  record(sample: ThermalSample): boolean {
    if (!Number.isFinite(sample.time) || !Number.isFinite(sample.heatFlux) || !Number.isFinite(sample.surfaceTemperature)) return false;
    const last = this.latest;
    if (last) {
      if (sample.time < last.time) this.clear();
      else if (sample.time - last.time < this.interval) return false;
    }
    if (this.buffer.length < this.capacity) {
      this.buffer.push(sample);
    } else {
      this.buffer[this.start] = sample;
      this.start = (this.start + 1) % this.capacity;
    }
    return true;
  }

  clear(): void {
    this.buffer.length = 0;
    this.start = 0;
  }

  /** 按时间先后排列的全部采样点（新数组）。 */
  toArray(): ThermalSample[] {
    const out: ThermalSample[] = [];
    for (let i = 0; i < this.buffer.length; i++) out.push(this.at(i) as ThermalSample);
    return out;
  }
}
