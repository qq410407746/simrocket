/**
 * 发射方位角与轨道倾角的关系。
 *
 * 从纬度 φ 的发射场以惯性方位角 β（从正北起顺时针量）水平入轨，得到的轨道倾角 i 满足球面三角关系
 *
 *     cos i = cos φ · sin β
 *
 * 因此：
 *  - 向正东发射（β = 90°）得到最小的倾角 i = |φ|：直接入轨的倾角不可能小于发射场纬度；
 *  - 同一个倾角有两个方位角：β（向北，升段）与 180° − β（向南，降段）。
 *
 * 火箭起飞时已经带着发射场随地球自转的速度 ω·R·cos φ（向东）。要让入轨时的**惯性**速度沿方位角 β，
 * 火箭相对地面需要提供的速度方向（即玩家在发射台上看到的"航向"）是
 *
 *     v_东 = v·sin β − ω·R·cos φ ，  v_北 = v·cos β ，  方位角 = atan2(v_东, v_北)
 *
 * 其中 v 为入轨速度。向东发射时地球自转是白送的速度；向极地发射时要把它抵消掉，所以方位角略微偏西。
 *
 * 这些是冲量近似下的几何关系：真实上升段持续几分钟、沿途纬度在变，实际倾角会有零点几度的偏差，
 * 需要在飞行中参照倾角读数修正。
 */
import { EARTH } from '../constants';

export type LaunchDirection = 'ascending' | 'descending';

/** 从给定纬度直接入轨能够达到的倾角范围 [rad]：[|φ|, π − |φ|]。 */
export const reachableInclination = (latitude: number): { readonly min: number; readonly max: number } => ({
  min: Math.abs(latitude),
  max: Math.PI - Math.abs(latitude),
});

/**
 * 惯性发射方位角 β [rad]，范围 [0, 2π)，从正北起顺时针。
 * 目标倾角从该纬度无法直接达到时返回 null。
 * @param direction 'ascending' 向北飞（升段入轨），'descending' 向南飞
 */
export const inertialLaunchAzimuth = (latitude: number, inclination: number, direction: LaunchDirection = 'ascending'): number | null => {
  const cosLatitude = Math.cos(latitude);
  if (!(cosLatitude > 1e-9)) return null;
  const sinBeta = Math.cos(inclination) / cosLatitude;
  if (Math.abs(sinBeta) > 1 + 1e-12) return null;
  const beta = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
  const azimuth = direction === 'ascending' ? beta : Math.PI - beta;
  return ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
};

/**
 * 相对地面的发射方位角 [rad]，范围 [0, 2π)：已扣除发射场随地球自转的速度。
 * 这是玩家起飞后应当让箭体倾斜的方向。目标倾角无法直接达到时返回 null。
 * @param orbitalSpeed 入轨时的惯性速度 [m/s]
 */
export const launchAzimuth = (
  latitude: number,
  inclination: number,
  orbitalSpeed: number,
  direction: LaunchDirection = 'ascending',
): number | null => {
  const beta = inertialLaunchAzimuth(latitude, inclination, direction);
  if (beta === null) return null;
  const east = orbitalSpeed * Math.sin(beta) - EARTH.ROTATION_RATE * EARTH.RADIUS * Math.cos(latitude);
  const north = orbitalSpeed * Math.cos(beta);
  const azimuth = Math.atan2(east, north);
  return azimuth < 0 ? azimuth + 2 * Math.PI : azimuth;
};

/** 以惯性方位角 β 从纬度 φ 水平入轨得到的轨道倾角 [rad]，范围 [0, π]。 */
export const inclinationFromAzimuth = (latitude: number, inertialAzimuth: number): number =>
  Math.acos(Math.max(-1, Math.min(1, Math.cos(latitude) * Math.sin(inertialAzimuth))));
