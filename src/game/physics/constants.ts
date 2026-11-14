/**
 * 物理常量 —— 全项目唯一来源（single source of truth）。
 *
 * 约定：核心计算一律使用国际单位制（m, s, kg, N, K, J, W/m²）。
 * 任何模块都不得在代码中硬编码这些数值，必须从本文件导入。
 */

/** 标准重力加速度 g₀ [m/s²]（CGPM 1901 定义值，用于比冲换算，不是当地重力）。 */
export const STANDARD_GRAVITY = 9.80665;

/** 地球模型参数。 */
export const EARTH = {
  /** 标准引力参数 μ = GM [m³/s²]（WGS-84 / IERS）。 */
  MU: 3.986004418e14,
  /** 平均半径 [m]。基础版本使用球形地球，此半径即"海平面"。 */
  RADIUS: 6_371_000,
  /** 赤道半径 [m]（WGS-84）。预留给 J2 摄动与椭球模型，目前未使用。 */
  EQUATORIAL_RADIUS: 6_378_137,
  /** 自转角速度 ω [rad/s]（相对惯性空间，WGS-84）。 */
  ROTATION_RATE: 7.292115e-5,
  /** 二阶带谐系数 J2 [-]。预留给后续摄动模型，目前未使用。 */
  J2: 1.08262668e-3,
} as const;

/** 恒星日 [s]：地球相对惯性空间自转一周的时间 = 2π/ω。 */
export const SIDEREAL_DAY = (2 * Math.PI) / EARTH.ROTATION_RATE;

/** 海平面标准大气（ISA）参数。 */
export const SEA_LEVEL = {
  /** 气压 [Pa]。 */
  PRESSURE: 101_325,
  /** 密度 [kg/m³]。 */
  DENSITY: 1.225,
  /** 温度 [K]。 */
  TEMPERATURE: 288.15,
} as const;

/** 卡门线高度 [m]（FAI 定义的太空边界，游戏任务判定使用）。 */
export const KARMAN_LINE_ALTITUDE = 100_000;

/** 天文常量。 */
export const ASTRO = {
  /** 天文单位 [m]。 */
  AU: 1.495978707e11,
  /** J2000.0 历元对应的儒略日。 */
  JD_J2000: 2_451_545.0,
  /** 一天的秒数 [s]。 */
  SECONDS_PER_DAY: 86_400,
  /** J2000 黄赤交角 [rad]。 */
  OBLIQUITY_J2000: (23.439291 * Math.PI) / 180,
} as const;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = 2 * Math.PI;
