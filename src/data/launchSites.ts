/**
 * 发射场数据。
 *
 * 经纬度为真实地理位置的近似值。当前地球模型为球体且没有地形高度数据，
 * 因此所有发射场的海拔都按 0 m 处理（真实海拔见注释，地形实现后启用）。
 */
import { DEG2RAD } from '@/game/physics/constants';
import type { Geodetic } from '@/game/physics/frames/frames';

export interface LaunchSite {
  readonly id: string;
  readonly name: string;
  readonly nameZh: string;
  readonly region: string;
  /** 纬度 [°]，北纬为正。 */
  readonly latitudeDeg: number;
  /** 经度 [°]，东经为正。 */
  readonly longitudeDeg: number;
  readonly note: string;
}

export const LAUNCH_SITES: readonly LaunchSite[] = [
  {
    id: 'cape-canaveral',
    name: 'Cape Canaveral',
    nameZh: '卡纳维拉尔角',
    region: '北美 · 佛罗里达',
    latitudeDeg: 28.5,
    longitudeDeg: -80.6,
    note: '向东发射飞越大西洋，直接入轨倾角约 28.5°。',
  },
  {
    id: 'wenchang',
    name: 'Wenchang',
    nameZh: '文昌',
    region: '亚洲 · 海南',
    latitudeDeg: 19.61,
    longitudeDeg: 110.95,
    note: '低纬度滨海发射场，适合地球同步转移轨道任务。',
  },
  {
    id: 'kourou',
    name: 'Kourou',
    nameZh: '库鲁',
    region: '南美 · 法属圭亚那',
    latitudeDeg: 5.24,
    longitudeDeg: -52.77,
    note: '近赤道发射场，能最大限度利用地球自转速度。',
  },
  {
    id: 'jiuquan',
    name: 'Jiuquan',
    nameZh: '酒泉',
    region: '亚洲 · 戈壁',
    latitudeDeg: 40.96,
    longitudeDeg: 100.29,
    note: '内陆中纬度发射场（真实海拔约 1000 m）。',
  },
  {
    id: 'baikonur',
    name: 'Baikonur',
    nameZh: '拜科努尔',
    region: '中亚 · 哈萨克草原',
    latitudeDeg: 45.96,
    longitudeDeg: 63.31,
    note: '高纬度内陆发射场，直接入轨倾角不低于约 46°。',
  },
  {
    id: 'vandenberg',
    name: 'Vandenberg',
    nameZh: '范登堡',
    region: '北美 · 加利福尼亚',
    latitudeDeg: 34.74,
    longitudeDeg: -120.57,
    note: '向南发射飞越太平洋，适合极地轨道与太阳同步轨道。',
  },
];

export const DEFAULT_LAUNCH_SITE_ID = 'cape-canaveral';

export const findLaunchSite = (id: string): LaunchSite | undefined => LAUNCH_SITES.find((s) => s.id === id);

export const getLaunchSiteOrDefault = (id: string): LaunchSite =>
  findLaunchSite(id) ?? (findLaunchSite(DEFAULT_LAUNCH_SITE_ID) as LaunchSite);

/** 发射场地面点的地理坐标（弧度、海拔 0）。 */
export const launchSiteGeodetic = (site: LaunchSite, altitude = 0): Geodetic => ({
  latitude: site.latitudeDeg * DEG2RAD,
  longitude: site.longitudeDeg * DEG2RAD,
  altitude,
});
