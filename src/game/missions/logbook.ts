/**
 * 飞行记录（日志）：每次飞行留下一条摘要——用了什么火箭、从哪里出发、结果如何、关键数据。
 * 纯数据与纯函数；持久化由 stores/careerStore.ts 负责。时间历程曲线见 telemetry/flightRecorder.ts。
 */
import type { FailureCause, FlightOutcome, FlightStats } from '../simulation/types';
import type { Telemetry } from '../telemetry/telemetry';
import type { MissionGrade, MissionScore, MissionState, MissionStatus } from './types';

/** 飞行的结局：着陆、损毁，或者记录时仍在飞行（例如停在轨道上就退出了）。 */
export type FlightResult = 'landed' | 'destroyed' | 'in-flight';

export interface FlightLogEntry {
  /** 一次飞行一个标识：同一次飞行后续的更新会覆盖同一条记录。 */
  readonly id: string;
  /** 记录时的墙钟时间（ISO 8601）。 */
  readonly date: string;
  readonly missionId: string | null;
  readonly vehicleId: string;
  readonly siteId: string;
  readonly start: 'pad' | 'orbit';
  readonly result: FlightResult;
  readonly cause: FailureCause | null;
  readonly missionStatus: MissionStatus | null;
  readonly score: number | null;
  readonly grade: MissionGrade | null;
  /** 记录时的任务时间（自起飞起）[s]。 */
  readonly duration: number;
  readonly maxAltitude: number;
  readonly maxSpeed: number;
  readonly maxGLoad: number;
  readonly maxDynamicPressure: number;
  readonly maxHeatFlux: number;
  /** 记录时到发射场的地面距离 [m]。 */
  readonly downrange: number;
  /** 轨道：任务确认的轨道，或记录时所在的稳定轨道；没有则为 null。高度 [m]、倾角 [rad]。 */
  readonly orbit: { readonly apoapsisAltitude: number; readonly periapsisAltitude: number; readonly inclination: number } | null;
}

/** 日志最多保留的条数（最新的在前）。 */
export const LOGBOOK_LIMIT = 50;

export interface LogEntryInput {
  readonly id: string;
  readonly date: string;
  readonly missionId: string | null;
  readonly vehicleId: string;
  readonly siteId: string;
  readonly start: 'pad' | 'orbit';
  readonly telemetry: Telemetry;
  readonly stats: FlightStats;
  readonly outcome: FlightOutcome | null;
  readonly mission: MissionState | null;
  readonly score: MissionScore | null;
}

export const buildLogEntry = (input: LogEntryInput): FlightLogEntry => {
  const { telemetry, stats, outcome, mission, score } = input;
  const confirmed = mission?.confirmedOrbit ?? null;
  const current = telemetry.orbit && telemetry.orbit.classification === 'orbit' ? telemetry.orbit : null;
  const orbit = confirmed ?? current;
  return {
    id: input.id,
    date: input.date,
    missionId: input.missionId,
    vehicleId: input.vehicleId,
    siteId: input.siteId,
    start: input.start,
    result: outcome ? outcome.kind : 'in-flight',
    cause: outcome?.cause ?? null,
    missionStatus: mission ? mission.status : null,
    score: mission && mission.status !== 'active' && score ? score.total : null,
    grade: mission && mission.status !== 'active' && score ? score.grade : null,
    duration: telemetry.missionTime ?? 0,
    maxAltitude: stats.maxAltitude,
    maxSpeed: stats.maxInertialSpeed,
    maxGLoad: stats.maxGLoad,
    maxDynamicPressure: stats.maxDynamicPressure,
    maxHeatFlux: stats.maxHeatFlux,
    downrange: telemetry.downrange,
    orbit: orbit ? { apoapsisAltitude: orbit.apoapsisAltitude, periapsisAltitude: orbit.periapsisAltitude, inclination: orbit.inclination } : null,
  };
};

/** 写入一条记录：同一 id 的旧记录被替换（位置不变），否则插到最前面；超出上限的旧记录被丢弃。 */
export const upsertLogEntry = (log: readonly FlightLogEntry[], entry: FlightLogEntry, limit = LOGBOOK_LIMIT): FlightLogEntry[] => {
  const index = log.findIndex((existing) => existing.id === entry.id);
  if (index >= 0) return log.map((existing, i) => (i === index ? entry : existing));
  return [entry, ...log].slice(0, Math.max(0, limit));
};

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** 校验从存档读回的日志条目：结构不对的条目被丢弃（旧版本存档、手工改坏的数据）。 */
export const isValidLogEntry = (value: unknown): value is FlightLogEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<FlightLogEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.vehicleId === 'string' &&
    typeof entry.siteId === 'string' &&
    (entry.result === 'landed' || entry.result === 'destroyed' || entry.result === 'in-flight') &&
    isFiniteNumber(entry.duration) &&
    isFiniteNumber(entry.maxAltitude) &&
    isFiniteNumber(entry.maxSpeed) &&
    isFiniteNumber(entry.maxGLoad) &&
    isFiniteNumber(entry.maxDynamicPressure) &&
    isFiniteNumber(entry.maxHeatFlux) &&
    isFiniteNumber(entry.downrange)
  );
};
