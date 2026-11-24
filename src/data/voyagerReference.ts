/**
 * 旅行者 1、2 号的真实飞越几何，供知识库"轨道之星"展示。
 *
 * 最接近时刻与距离（从行星中心量起）：由 JPL Horizons 中旅行者号相对各行星的状态，在名义日期 ±2 天内按 10 分钟步长求最小距离得到
 * （数据见 src/game/interplanetary/testing/horizons/voyager.json，2026-11-24 下载）。
 * 偏转角：Horizons 中飞越前后 60 天、旅行者号相对行星的速度方向之间的夹角。
 * 发射日只取日期（UTC 0 时）：旅行者 2 号 1977-08-20，旅行者 1 号 1977-09-05。
 */
import type { PlanetId } from '@/game/interplanetary/planets';
import { julianDateFromUnixMs } from '@/game/physics/ephemeris/time';

export interface VoyagerEncounter {
  readonly body: PlanetId;
  /** 最接近时刻（儒略日，TDB）。 */
  readonly jd: number;
  /** 最接近距离 [km]，从行星中心量起。 */
  readonly closestKm: number;
  /** 实际偏转角 [°]；最后一站（不再用于借力的到达点）为 null。 */
  readonly turnDeg: number | null;
}

export interface VoyagerRoute {
  readonly id: 'voyager1' | 'voyager2';
  readonly nameZh: string;
  readonly name: string;
  readonly launchJd: number;
  readonly encounters: readonly VoyagerEncounter[];
}

export const VOYAGER_ROUTES: readonly VoyagerRoute[] = [
  {
    id: 'voyager2',
    nameZh: '旅行者 2 号',
    name: 'Voyager 2',
    launchJd: julianDateFromUnixMs(Date.UTC(1977, 7, 20)),
    encounters: [
      { body: 'jupiter', jd: 2444064.4375, closestKm: 721_375, turnDeg: 96.9 },
      { body: 'saturn', jd: 2444842.63889, closestKm: 160_787, turnDeg: 84.9 },
      { body: 'uranus', jd: 2446455.25, closestKm: 107_154, turnDeg: 23.0 },
      { body: 'neptune', jd: 2447763.66667, closestKm: 29_599, turnDeg: null },
    ],
  },
  {
    id: 'voyager1',
    nameZh: '旅行者 1 号',
    name: 'Voyager 1',
    launchJd: julianDateFromUnixMs(Date.UTC(1977, 8, 5)),
    encounters: [
      { body: 'jupiter', jd: 2443938.00694, closestKm: 348_487, turnDeg: 98.1 },
      { body: 'saturn', jd: 2444556.49306, closestKm: 184_083, turnDeg: null },
    ],
  },
];
