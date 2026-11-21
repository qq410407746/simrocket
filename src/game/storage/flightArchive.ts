/** 遥测档案不是可恢复的物理快照，不参与模拟推进。 */
import type { FlightEvent, FlightEventKind } from '../simulation/types';
import type { FlightSample } from '../telemetry/flightRecorder';

export interface FlightArchive {
  readonly version: 1;
  readonly id: string;
  readonly vehicleName: string;
  readonly savedAt: string;
  readonly samples: readonly FlightSample[];
  /** 时间已换算为自起飞起的秒数。 */
  readonly events: readonly FlightEvent[];
}
export const ARCHIVE_SAMPLE_LIMIT = 720;
export const ARCHIVE_EVENT_LIMIT = 200;
const fields = ['time', 'altitude', 'speed', 'gLoad', 'dynamicPressure', 'heatFlux'] as const;
const eventKinds: readonly FlightEventKind[] = ['ignition', 'liftoff', 'depleted', 'separation', 'fairing', 'heat-shield', 'payload-ignition', 'drogue-deployed', 'main-deployed', 'parachute-failed', 'landed', 'destroyed'];
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12;
export function parseFlightArchive(raw: unknown): FlightArchive | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Partial<FlightArchive>;
  if (a.version !== 1 || typeof a.id !== 'string' || !a.id || a.id.length > 100 ||
      typeof a.vehicleName !== 'string' || !a.vehicleName || a.vehicleName.length > 100 ||
      typeof a.savedAt !== 'string' || !Number.isFinite(Date.parse(a.savedAt)) ||
      !Array.isArray(a.samples) || a.samples.length > ARCHIVE_SAMPLE_LIMIT ||
      !Array.isArray(a.events) || a.events.length > ARCHIVE_EVENT_LIMIT) return null;
  let lastTime = -Infinity;
  const samples: FlightSample[] = [];
  for (const rawSample of a.samples as unknown[]) {
    if (!rawSample || typeof rawSample !== 'object') return null;
    const s = rawSample as FlightSample;
    if (!fields.every((key) => finite(s[key])) || s.time < 0 || s.time <= lastTime ||
        s.speed < 0 || s.gLoad < 0 || s.dynamicPressure < 0 || s.heatFlux < 0) return null;
    lastTime = s.time;
    samples.push({ time: s.time, altitude: s.altitude, speed: s.speed, gLoad: s.gLoad, dynamicPressure: s.dynamicPressure, heatFlux: s.heatFlux });
  }
  const events: FlightEvent[] = [];
  let lastEvent = -Infinity;
  for (const rawEvent of a.events as unknown[]) {
    if (!rawEvent || typeof rawEvent !== 'object') return null;
    const e = rawEvent as FlightEvent;
    if (!eventKinds.includes(e.kind) || !finite(e.time) || e.time < 0 || e.time < lastEvent ||
        !Number.isInteger(e.stageIndex) || e.stageIndex < -1 || e.stageIndex > 4) return null;
    events.push({ kind: e.kind, time: e.time, stageIndex: e.stageIndex }); lastEvent = e.time;
  }
  return { version: 1, id: a.id, vehicleName: a.vehicleName, savedAt: a.savedAt, samples, events };
}

/** 采样之间仅线性估读；边界钳制，不外推、不重演物理。 */
export function sampleArchiveAt(samples: readonly FlightSample[], time: number): FlightSample | null {
  const first = samples[0], last = samples[samples.length - 1];
  if (!first || !last || !Number.isFinite(time)) return null;
  if (time <= first.time) return first;
  if (time >= last.time) return last;
  const index = samples.findIndex((s) => s.time >= time);
  const a = samples[index - 1]!, b = samples[index]!;
  const f = (time - a.time) / (b.time - a.time);
  const lerp = (key: keyof FlightSample) => a[key] * (1 - f) + b[key] * f;
  return { time, altitude: lerp('altitude'), speed: lerp('speed'), gLoad: lerp('gLoad'), dynamicPressure: lerp('dynamicPressure'), heatFlux: lerp('heatFlux') };
}
