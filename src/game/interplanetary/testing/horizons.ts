/**
 * JPL Horizons 基准数据（由 scripts/fetch-horizons.mjs 生成）的读取与插值，只给测试用。
 * 坐标：日心 J2000 黄道；文件里是 km、km/s，这里换成 m、m/s。
 */
import { type Vec3, vec3 } from '../../physics/math/vec3';
import jupiter2026 from './horizons/porkchop-jupiter-2026.json';
import mars2026 from './horizons/porkchop-mars-2026.json';
import venus2026 from './horizons/porkchop-venus-2026.json';
import planets from './horizons/planets-2000-2050.json';
import voyager from './horizons/voyager.json';

export interface StateSeries {
  readonly startJd: number;
  readonly stepDays: number;
  readonly states: readonly (readonly number[])[];
}

export interface HorizonsState {
  readonly position: Vec3;
  readonly velocity: Vec3;
}

export const toState = (row: readonly number[]): HorizonsState => ({
  position: vec3(row[0]! * 1e3, row[1]! * 1e3, row[2]! * 1e3),
  velocity: vec3(row[3]! * 1e3, row[4]! * 1e3, row[5]! * 1e3),
});

/** 取正好落在采样点上的状态；不在采样点上返回 null（猪排图对比只用整点，避免插值误差）。 */
export const stateAt = (series: StateSeries, jd: number): HorizonsState | null => {
  const k = (jd - series.startJd) / series.stepDays;
  const i = Math.round(k);
  if (Math.abs(k - i) > 1e-9 || i < 0 || i >= series.states.length) return null;
  return toState(series.states[i]!);
};

export const PORKCHOP_FIXTURES = { mars: mars2026, venus: venus2026, jupiter: jupiter2026 } as const;
export const PLANET_POSITIONS = planets;
export const VOYAGER = voyager;
