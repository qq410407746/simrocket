/**
 * 任务界面的文字：目标进度、失败原因、评分指标的数值、评级与日志条目（纯函数，便于测试）。
 */
import type { FlightLogEntry } from '@/game/missions/logbook';
import { ORBIT_CONFIRM_TIME } from '@/game/missions/tracker';
import type {
  MetricId,
  MissionCategory,
  MissionFailure,
  MissionGrade,
  MissionState,
  ObjectiveSpec,
  ObjectiveStatus,
} from '@/game/missions/types';
import { RAD2DEG } from '@/game/physics/constants';
import type { FlightStats } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import { type Language, createTranslator } from '@/i18n/locale';
import { formatNumber } from '@/utils/format';
import { failureTitle } from './thermalLabels';

const km = (meters: number, digits = 0): string => formatNumber(meters / 1000, digits);
const deg = (radians: number, digits = 1): string => formatNumber(radians * RAD2DEG, digits);

export const CATEGORY_LABEL: Record<MissionCategory, string> = { suborbital: '亚轨道', orbital: '近地轨道', return: '返回', advanced: '高级轨道' };

export const categoryLabel = (category: MissionCategory, language: Language = 'zh'): string =>
  createTranslator(language)(CATEGORY_LABEL[category], { suborbital: 'Suborbital', orbital: 'Low Earth orbit', return: 'Return', advanced: '高级轨道' }[category]);

export const OBJECTIVE_MARK: Record<ObjectiveStatus, { readonly mark: string; readonly tone: string }> = {
  pending: { mark: '○', tone: 'text-ink-dim' },
  done: { mark: '✓', tone: 'text-ok' },
  failed: { mark: '✕', tone: 'text-danger' },
};

/** 评级的颜色。 */
export const GRADE_TONE: Record<MissionGrade, string> = {
  S: 'text-[#ffd45c]',
  A: 'text-ok',
  B: 'text-data',
  C: 'text-ink-dim',
  F: 'text-danger',
};

/**
 * 一个目标当前的进度读数（飞行中显示在任务条上）。
 * 目标已有结论时返回空字符串。
 */
export const objectiveProgress = (
  spec: ObjectiveSpec,
  status: ObjectiveStatus,
  t: Telemetry | null,
  stats: FlightStats | null,
  mission: MissionState | null,
  language: Language = 'zh',
  objectiveId?: string,
): string => {
  const tr = createTranslator(language);
  if (status !== 'pending') return '';
  switch (spec.kind) {
    case 'reach-altitude': {
      const reached = Math.max(stats?.maxAltitude ?? 0, t?.altitude ?? 0);
      return tr(`最大高度 ${km(reached)} / ${km(spec.altitude)} km`, `Max altitude ${km(reached)} / ${km(spec.altitude)} km`);
    }
    case 'orbit': {
      const orbit = t?.orbit;
      if (!orbit) return tr(`近地点 ≥ ${km(spec.minPeriapsis)} km`, `Periapsis ≥ ${km(spec.minPeriapsis)} km`);
      const parts = [tr(`近地点 ${km(orbit.periapsisAltitude)} / ${km(spec.minPeriapsis)} km`, `Periapsis ${km(orbit.periapsisAltitude)} / ${km(spec.minPeriapsis)} km`)];
      if (orbit.apoapsisAltitude > spec.maxApoapsis) {
        parts.push(Number.isFinite(orbit.apoapsisAltitude) ? tr(`远地点 ${km(orbit.apoapsisAltitude)} km（上限 ${km(spec.maxApoapsis)}）`, `Apoapsis ${km(orbit.apoapsisAltitude)} km (max ${km(spec.maxApoapsis)})`) : tr('逃逸轨道', 'Escape trajectory'));
      }
      if (spec.minApoapsis !== undefined) parts.push(`远地点 ${km(orbit.apoapsisAltitude)} km（目标 ${km(spec.minApoapsis)}–${km(spec.maxApoapsis)}）`);
      if (spec.maxPeriapsis !== undefined) parts.push(`近地点上限 ${km(spec.maxPeriapsis)} km`);
      if (spec.inclination) parts.push(tr(`倾角 ${deg(orbit.inclination)}° / ${deg(spec.inclination.target)}°`, `Inclination ${deg(orbit.inclination)}° / ${deg(spec.inclination.target)}°`));
      if (mission && mission.orbitHoldSince !== null && t && (!objectiveId || mission.orbitObjectiveId === objectiveId)) {
        const remaining = formatNumber(Math.max(0, ORBIT_CONFIRM_TIME - (t.simTime - mission.orbitHoldSince)), 0);
        parts.push(tr(`确认中 ${remaining} s`, `Confirming ${remaining} s`));
      }
      return parts.join(' · ');
    }
    case 'deploy-satellite': return t?.satelliteDeployedAt != null ? '卫星已部署' : '关机并抛罩后部署卫星';
    case 'synchronous': {
      const remaining = mission?.orbitHoldSince != null && t && mission.orbitObjectiveId === objectiveId
        ? `；确认中 ${Math.max(0, ORBIT_CONFIRM_TIME - (t.simTime - mission.orbitHoldSince)).toFixed(0)} s` : '';
      return `${spec.stationary ? 'GEO' : 'GSO'}：周期误差 ${t?.synchronous?.periodError?.toFixed(1) ?? '—'} s；经度摆幅 ${t?.synchronous?.longitudeSpan == null ? '—' : deg(t.synchronous.longitudeSpan, 3) + '°'}${remaining}`;
    }
    case 'land-capsule': {
      const chute = t?.parachute.phase;
      if (chute === 'main') return tr('主伞已张开', 'Main parachute open');
      if (chute === 'drogue') return tr('减速伞工作中', 'Drogue parachute working');
      return '';
    }
  }
};

const FAILURE_TEXT: Record<MissionFailure, string> = {
  destroyed: '飞行器损毁',
  'flight-ended': '飞行结束时还有主要目标没有完成',
  'out-of-propellant': '停在了不符合要求的轨道上，推进剂已经耗尽',
};

export const missionFailureText = (failure: MissionFailure | null, language: Language = 'zh'): string => {
  if (!failure) return '';
  const english: Record<MissionFailure, string> = {
    destroyed: 'Vehicle destroyed',
    'flight-ended': 'The flight ended before all primary objectives were completed',
    'out-of-propellant': 'Propellant exhausted in an orbit that does not meet the requirements',
  };
  return createTranslator(language)(FAILURE_TEXT[failure], english[failure]);
};

/** 评分指标的数值显示；指标不存在时为"—"。 */
export const metricText = (metric: MetricId | null, value: number | null): string => {
  if (metric === null) return '';
  if (value === null || !Number.isFinite(value)) return '—';
  switch (metric) {
    case 'max-g':
      return `${formatNumber(value, 1)} g`;
    case 'orbit-spread':
    case 'max-altitude':
    case 'downrange':
      return `${km(value)} km`;
    case 'period-error': return `${formatNumber(value, 1)} s`;
    case 'longitude-span':
    case 'inclination-error':
      return `${deg(value, 2)}°`;
    case 'delta-v-margin':
      return `${formatNumber(value, 0)} m/s`;
    case 'landing-speed':
      return `${formatNumber(value, 1)} m/s`;
    case 'ablator-remaining':
      return `${formatNumber(value * 100, 0)}%`;
  }
};

/** 日志条目的结局文字与颜色。 */
export const logResult = (entry: Pick<FlightLogEntry, 'result' | 'cause' | 'missionStatus' | 'orbit'>, language: Language = 'zh'): { readonly text: string; readonly tone: string } => {
  const t = createTranslator(language);
  if (entry.result === 'destroyed') return { text: entry.cause ? failureTitle(entry.cause, language) : t('损毁', 'Destroyed'), tone: 'text-danger' };
  if (entry.result === 'landed') return { text: t('安全着陆', 'Safe landing'), tone: 'text-ok' };
  return entry.orbit ? { text: t('在轨', 'In orbit'), tone: 'text-data' } : { text: t('飞行中退出', 'Exited in flight'), tone: 'text-ink-dim' };
};

/** 日志条目的日期显示：本地时间 月-日 时:分。无法解析时原样返回。 */
export const logDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** 日志里的轨道显示：近地点 × 远地点 km，倾角。 */
export const logOrbit = (orbit: FlightLogEntry['orbit']): string =>
  orbit ? `${km(orbit.periapsisAltitude)} × ${km(orbit.apoapsisAltitude)} km · ${deg(orbit.inclination)}°` : '';
