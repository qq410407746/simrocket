/**
 * 发射方向的操作引导：把"要朝哪个方向飞"换算成"按哪几个键"。
 *
 * 姿态键是机体轴上的指令。发射台上箭体竖直，W / S（俯仰）使头部倒向北 / 南，D / A（偏航）倒向东 / 西；
 * 同时按两个键就是 45° 的斜向。游戏里没有滚转程序（箭体不会自己滚转去对准发射方位），
 * 所以起飞时用哪组键把头部压向飞行方向，之后整个上升段"压低头部"就一直是这组键；
 * 抬高头部是它的反向；让航向左偏 / 右偏则是与它垂直的那两组键。
 * 界面提示与测试驾驶员都用这里的换算，保证"提示怎么说"与"测试怎么飞"是同一回事。
 */
import { DEG2RAD, EARTH, RAD2DEG } from '../physics/constants';
import { circularSpeed } from '../physics/orbital/elements';
import { type LaunchDirection, launchAzimuth } from '../physics/orbital/launch';
import type { MissionDefinition } from './types';

/** 一组姿态键：俯仰、偏航各为 −1、0 或 1（W = 俯仰 +1，S = −1，D = 偏航 +1，A = −1）。 */
export interface KeyCombo {
  readonly pitch: number;
  readonly yaw: number;
}

/** 把头部压向给定航向（从正北起顺时针 [°]）要按的键：取整到键盘能按出的八个方向。 */
export const comboForHeading = (headingDeg: number): KeyCombo => {
  const heading = headingDeg * DEG2RAD;
  // +0 把 −0 归一成 0，便于比较
  return { pitch: Math.round(Math.cos(heading)) + 0, yaw: Math.round(Math.sin(heading)) + 0 };
};

/** 一组键对应的航向 [°]，范围 [0, 360)。 */
export const headingOfCombo = (combo: KeyCombo): number => {
  const heading = Math.atan2(combo.yaw, combo.pitch) * RAD2DEG;
  return heading < 0 ? heading + 360 : heading;
};

export const reverseCombo = (combo: KeyCombo): KeyCombo => ({ pitch: -combo.pitch + 0, yaw: -combo.yaw + 0 });

/** 使航向向左偏（从上方看逆时针）的那组键：把"压低头部"的那组键逆时针转 90°。 */
export const leftOfCombo = (combo: KeyCombo): KeyCombo => ({ pitch: combo.yaw + 0, yaw: -combo.pitch + 0 });

/** 键位的文字：'D'、'W + D'、'S + A'…… */
export const comboLabel = (combo: KeyCombo): string => {
  const keys: string[] = [];
  if (combo.pitch > 0) keys.push('W');
  if (combo.pitch < 0) keys.push('S');
  if (combo.yaw > 0) keys.push('D');
  if (combo.yaw < 0) keys.push('A');
  return keys.join(' + ');
};

const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;

/** 航向 [°] 的方位名称（八个方位）。 */
export const compassLabel = (headingDeg: number): string => COMPASS[((Math.round(headingDeg / 45) % 8) + 8) % 8] as string;

/** 估算发射方位角时采用的入轨高度 [m]。 */
const REFERENCE_ORBIT_ALTITUDE = 200_000;

export interface LaunchGuidance {
  /** 理论发射方位角 [°]（相对地面、已扣除地球自转）；向正东发射时为 90。 */
  readonly azimuthDeg: number;
  /** 起飞倾斜时按的键，以及它实际对应的航向 [°]（键盘只能按出 45° 的倍数）。 */
  readonly lower: KeyCombo;
  readonly keyHeadingDeg: number;
  /** 抬高头部的键。 */
  readonly raise: KeyCombo;
  /** 航向左偏 / 右偏的键。 */
  readonly left: KeyCombo;
  readonly right: KeyCombo;
  /**
   * 增大 / 减小轨道倾角的键：向北飞（升段）时航向左偏使倾角增大，向南飞（降段）时右偏使倾角增大。
   */
  readonly increaseInclination: KeyCombo;
  readonly decreaseInclination: KeyCombo;
  readonly direction: LaunchDirection;
}

/**
 * 任务的发射引导。没有倾角要求的任务向正东发射（按 D）。
 * @param latitude 发射场纬度 [rad]
 */
export const launchGuidance = (mission: Pick<MissionDefinition, 'launch'> | null, latitude: number): LaunchGuidance => {
  const launch = mission?.launch;
  const direction: LaunchDirection = launch?.direction ?? 'ascending';
  const azimuth = launch
    ? launchAzimuth(latitude, launch.inclination, circularSpeed(EARTH.RADIUS + REFERENCE_ORBIT_ALTITUDE), direction)
    : null;
  const azimuthDeg = azimuth === null ? 90 : azimuth * RAD2DEG;
  const lower = comboForHeading(azimuthDeg);
  const left = leftOfCombo(lower);
  const right = reverseCombo(left);
  return {
    azimuthDeg,
    lower,
    keyHeadingDeg: headingOfCombo(lower),
    raise: reverseCombo(lower),
    left,
    right,
    increaseInclination: direction === 'ascending' ? left : right,
    decreaseInclination: direction === 'ascending' ? right : left,
    direction,
  };
};
