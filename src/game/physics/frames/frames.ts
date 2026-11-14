/**
 * 参考系与坐标转换。
 *
 * 本项目使用四个参考系（详见 PHYSICS.md §2）：
 *
 *  1. ECI  地心惯性系：原点在地心；+Z 沿地球自转轴指向北极；+X 指向历元春分点方向；
 *          +Y 构成右手系。不随地球自转。所有动力学积分都在此系进行。
 *  2. ECEF 地心地固系：原点在地心；+Z 同 ECI；+X 穿过赤道与本初子午线交点 (0°N, 0°E)；
 *          随地球以 ω 自转。ECEF = Rz(−θ)·ECI，θ 为地球自转角（格林尼治恒星时角）。
 *  3. ENU  局部水平系（东-北-天）：原点在某一位置；Up 沿地心径向（球形地球假设）。
 *  4. Body 机体系：+X 沿箭体纵轴指向头部；+Y、+Z 为横向轴，构成右手系。
 *
 * 简化与适用范围：
 *  - 球形地球：大地纬度 = 地心纬度，"天向"= 径向。WGS-84 椭球尚未实现。
 *  - 忽略岁差、章动、极移：ECI 的 Z 轴与地球自转轴严格重合。
 */
import { EARTH } from '../constants';
import { type Quat, conjugate, fromBasis, rotate } from '../math/quat';
import { type Vec3, UNIT_Y, UNIT_Z, cross, dot, length, normalize, rotateZ, sub, vec3 } from '../math/vec3';

/** 地球自转角速度矢量（ECI 与 ECEF 中表达相同，因为沿公共 Z 轴）[rad/s]。 */
export const EARTH_ANGULAR_VELOCITY: Vec3 = Object.freeze(vec3(0, 0, EARTH.ROTATION_RATE));

/**
 * 地球自转角 θ(t) [rad]：ECEF 的 +X 轴相对 ECI +X 轴绕 +Z 转过的角度。
 * @param angleAtEpoch 历元时刻的自转角（格林尼治平恒星时角）[rad]
 * @param t 自历元起的模拟时间 [s]
 */
export const earthRotationAngle = (angleAtEpoch: number, t: number): number =>
  angleAtEpoch + EARTH.ROTATION_RATE * t;

/** 位置：ECI → ECEF。 */
export const eciToEcef = (rEci: Vec3, theta: number): Vec3 => rotateZ(rEci, -theta);

/** 位置：ECEF → ECI。 */
export const ecefToEci = (rEcef: Vec3, theta: number): Vec3 => rotateZ(rEcef, theta);

/**
 * 速度：ECI → ECEF（相对旋转地球的速度，在 ECEF 轴上表达）。
 * v_ecef = Rz(−θ)·(v_eci − ω × r_eci)
 */
export const eciToEcefVelocity = (rEci: Vec3, vEci: Vec3, theta: number): Vec3 =>
  rotateZ(sub(vEci, cross(EARTH_ANGULAR_VELOCITY, rEci)), -theta);

/**
 * 速度：ECEF → ECI。
 * v_eci = Rz(θ)·(v_ecef + ω × r_ecef)
 */
export const ecefToEciVelocity = (rEcef: Vec3, vEcef: Vec3, theta: number): Vec3 => {
  const co = cross(EARTH_ANGULAR_VELOCITY, rEcef);
  return rotateZ(vec3(vEcef.x + co.x, vEcef.y + co.y, vEcef.z + co.z), theta);
};

/**
 * 相对大气（随地球刚性共转）的速度，在 ECI 轴上表达 [m/s]。
 * 气动力、马赫数、气动加热必须使用这个速度，而不是惯性速度。
 */
export const airRelativeVelocityEci = (rEci: Vec3, vEci: Vec3): Vec3 =>
  sub(vEci, cross(EARTH_ANGULAR_VELOCITY, rEci));

/** 球坐标形式的地理位置。 */
export interface Geodetic {
  /** 纬度 [rad]，北纬为正，范围 [−π/2, π/2]。 */
  readonly latitude: number;
  /** 经度 [rad]，东经为正，范围 (−π, π]。 */
  readonly longitude: number;
  /** 海拔高度 [m]（相对平均半径球面）。 */
  readonly altitude: number;
}

/** 地理坐标 → ECEF（球形地球）。 */
export const geodeticToEcef = (g: Geodetic): Vec3 => {
  const r = EARTH.RADIUS + g.altitude;
  const cosLat = Math.cos(g.latitude);
  return vec3(r * cosLat * Math.cos(g.longitude), r * cosLat * Math.sin(g.longitude), r * Math.sin(g.latitude));
};

/** ECEF → 地理坐标（球形地球）。地心处纬度/经度无定义，约定返回 0。 */
export const ecefToGeodetic = (rEcef: Vec3): Geodetic => {
  const r = length(rEcef);
  if (r === 0) return { latitude: 0, longitude: 0, altitude: -EARTH.RADIUS };
  return {
    latitude: Math.asin(Math.max(-1, Math.min(1, rEcef.z / r))),
    longitude: Math.atan2(rEcef.y, rEcef.x),
    altitude: r - EARTH.RADIUS,
  };
};

/** 海拔高度 [m]：到地心距离减去平均半径。对 ECI 与 ECEF 位置都适用。 */
export const altitudeOf = (r: Vec3): number => length(r) - EARTH.RADIUS;

/** 局部水平系的三个单位基向量，在与输入位置相同的参考系（ECI 或 ECEF）中表达。 */
export interface EnuBasis {
  readonly east: Vec3;
  readonly north: Vec3;
  readonly up: Vec3;
}

/**
 * 给定位置处的东-北-天基向量。
 *
 * 因为 ECI 与 ECEF 共用 Z 轴，本函数对两种参考系中的位置都成立：
 * 传入 ECI 位置得到 ECI 轴上的基向量，传入 ECEF 位置得到 ECEF 轴上的基向量。
 *
 * 奇点：在两极正上方，东/北方向没有定义。此时约定 east = +Y，以保证输出有限且正交。
 */
export const enuBasisAt = (position: Vec3): EnuBasis => {
  const up = normalize(position, UNIT_Z);
  const eastRaw = cross(UNIT_Z, up);
  const east = length(eastRaw) > 1e-12 ? normalize(eastRaw) : UNIT_Y;
  const north = cross(up, east);
  return { east, north, up };
};

/** 把向量分解到 ENU 基上：返回 (东, 北, 天) 分量。 */
export const toEnu = (v: Vec3, basis: EnuBasis): Vec3 =>
  vec3(dot(v, basis.east), dot(v, basis.north), dot(v, basis.up));

/** 由 ENU 分量 (东, 北, 天) 合成向量。 */
export const fromEnu = (enu: Vec3, basis: EnuBasis): Vec3 =>
  vec3(
    basis.east.x * enu.x + basis.north.x * enu.y + basis.up.x * enu.z,
    basis.east.y * enu.x + basis.north.y * enu.y + basis.up.y * enu.z,
    basis.east.z * enu.x + basis.north.z * enu.y + basis.up.z * enu.z,
  );

/** 机体系向量 → 参考系（attitude 为 body→参考系 四元数）。 */
export const bodyToFrame = (attitude: Quat, vBody: Vec3): Vec3 => rotate(attitude, vBody);

/** 参考系向量 → 机体系。 */
export const frameToBody = (attitude: Quat, vFrame: Vec3): Vec3 => rotate(conjugate(attitude), vFrame);

/**
 * 发射台竖直姿态：机体 +X（头部）指向天，+Y 指向东，+Z 指向北。
 * （天 × 东 = 北，构成右手系。）返回 body→输入位置所在参考系 的四元数。
 */
export const verticalLaunchAttitude = (position: Vec3): Quat => {
  const { east, north, up } = enuBasisAt(position);
  return fromBasis(up, east, north);
};

/** 箭体纵轴相对当地水平面的指向。 */
export interface PointingAngles {
  /** 俯仰角 [rad]：头部相对当地水平面的仰角，+π/2 为竖直向上。 */
  readonly pitch: number;
  /** 航向角 [rad]：头部在水平面投影的方位角，自正北顺时针（向东）为正，范围 [0, 2π)。
   *  箭体竖直时航向没有定义，返回 null。 */
  readonly heading: number | null;
}

/** 竖直判定阈值：水平分量小于该值时认为航向无定义。 */
const HEADING_UNDEFINED_EPS = 1e-6;

/**
 * 由姿态四元数与位置计算俯仰角与航向角。
 * attitude 与 position 必须在同一参考系（通常为 ECI）中表达。
 */
export const pointingAngles = (attitude: Quat, position: Vec3): PointingAngles => {
  const nose = rotate(attitude, vec3(1, 0, 0));
  const enu = toEnu(nose, enuBasisAt(position));
  const horizontal = Math.hypot(enu.x, enu.y);
  const pitch = Math.atan2(enu.z, horizontal);
  if (horizontal < HEADING_UNDEFINED_EPS) return { pitch, heading: null };
  const heading = Math.atan2(enu.x, enu.y);
  return { pitch, heading: heading < 0 ? heading + 2 * Math.PI : heading };
};
