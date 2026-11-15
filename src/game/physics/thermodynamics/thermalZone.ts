/**
 * 集总热容模型：一个热区（飞行器表面的一块区域）的热响应。
 *
 * 每个热区由两个节点描述，均按单位面积计：
 *
 *     气流 ──q̇_对流──▶ [ 表层  C_s, T_s ] ──G·(T_s − T_i)──▶ [ 内部结构  C_i, T_i ]
 *                           │ ε·σ·(T_s⁴ − T_env⁴) 辐射
 *                           ▼
 *                         环境
 *
 * 能量平衡：
 *     C_s·dT_s/dt = q̇_对流 − q̇_辐射 − q̇_传导 − q̇_烧蚀
 *     C_i·dT_i/dt = q̇_传导
 *   其中 q̇_对流 = q̇_冷壁·(1 − h_w/h_0)（可为负：气流冷却壁面），q̇_传导 = G·(T_s − T_i)。
 *
 * 烧蚀（可选）：表层达到烧蚀温度 T_abl 且净热流为正时，表面温度停在 T_abl，多出来的热量由烧蚀带走：
 *     ṁ″ = q̇_净 / H_abl          [kg/(m²·s)]
 *   H_abl 是"有效烧蚀热"，把材料热解、气化以及烧蚀产物对边界层的阻塞效应合在一个数里。
 *   烧蚀层用完即判定烧穿。
 *
 * 失效判据（任一满足即失效，由调用方决定后果）：
 *   - 'surface'       表面温度超过材料的最高工作温度（非烧蚀材料；烧蚀材料的表面被烧蚀钳制在 T_abl）
 *   - 'burn-through'  烧蚀层耗尽
 *   - 'structure'     内部结构温度超过限值（热量浸透）
 *
 * 这是零维模型：没有沿厚度方向的温度分布，没有热区之间的横向导热，烧蚀后退不改变外形与曲率半径。
 * 它能回答的是"这块表面大致多热、能撑多久"，不是某个具体材料的精确烧蚀量。
 */
import { hotWallFactor, radiativeHeatFlux, STEFAN_BOLTZMANN, AIR_SPECIFIC_HEAT } from './heating';

/** 烧蚀材料参数。 */
export interface AblatorProperties {
  /** 开始烧蚀的表面温度 T_abl [K]。 */
  readonly temperature: number;
  /** 有效烧蚀热 H_abl [J/kg]。 */
  readonly heatOfAblation: number;
  /** 烧蚀层初始面密度 [kg/m²]。 */
  readonly arealMass: number;
}

/** 一块表面的热学参数（单位面积）。 */
export interface ThermalSurfaceProperties {
  /** 材料名称（显示用）。 */
  readonly material: string;
  /** 表面发射率 ε [-]。 */
  readonly emissivity: number;
  /** 表层面热容 C_s = ρ·c·δ [J/(m²·K)]。 */
  readonly surfaceHeatCapacity: number;
  /** 内部结构面热容 C_i [J/(m²·K)]。 */
  readonly interiorHeatCapacity: number;
  /** 表层到内部的传热系数 G = k/δ [W/(m²·K)]。 */
  readonly conductance: number;
  /** 表面最高工作温度 [K]。 */
  readonly maxSurfaceTemperature: number;
  /** 内部结构的最高允许温度 [K]。 */
  readonly maxInteriorTemperature: number;
  /** 烧蚀层；非烧蚀材料为 null。 */
  readonly ablator: AblatorProperties | null;
}

export type ThermalFailure = 'surface' | 'burn-through' | 'structure';

/** 热区的状态（可变，由 stepThermalZone 原地更新）。 */
export interface ThermalZoneState {
  /** 表面温度 T_s [K]。 */
  surfaceTemperature: number;
  /** 内部结构温度 T_i [K]。 */
  interiorTemperature: number;
  /** 烧蚀层剩余面密度 [kg/m²]；非烧蚀材料恒为 0。 */
  ablatorRemaining: number;
  /** 累积热载荷：对流传入热量的时间积分 ∫max(q̇_对流, 0) dt [J/m²]。 */
  heatLoad: number;
  /** 最近一步的对流热流（热壁）[W/m²]，可为负。 */
  convectiveFlux: number;
  /** 最近一步的辐射散热 [W/m²]。 */
  radiativeFlux: number;
  /** 最近一步的烧蚀速率 [kg/(m²·s)]。 */
  ablationRate: number;
  /** 已失效的原因；未失效为 null。失效后状态不再更新。 */
  failure: ThermalFailure | null;
}

export const createThermalZoneState = (props: ThermalSurfaceProperties, temperature: number): ThermalZoneState => ({
  surfaceTemperature: temperature,
  interiorTemperature: temperature,
  ablatorRemaining: props.ablator ? props.ablator.arealMass : 0,
  heatLoad: 0,
  convectiveFlux: 0,
  radiativeFlux: 0,
  ablationRate: 0,
  failure: null,
});

/** 单个子步允许的最大时间：表层热时间常数的这一比例。 */
const STABILITY_FRACTION = 0.2;
const MAX_SUBSTEPS = 200;

/**
 * 把热区状态推进 dt。
 *
 * 表层节点是刚性的（辐射项 ∝ T⁴），显式积分的稳定步长约为表层时间常数
 *   τ = C_s / (4εσT_s³ + G + q̇_冷壁·c_p/h_0)。
 * 游戏的物理步长（0.02 s）远小于 τ（通常 > 0.3 s），一步即可；
 * 步长较大时（测试、轨迹预测）自动细分子步，保证任意 dt 下都稳定。
 *
 * @param coldWallFlux 该热区的冷壁对流热流 [W/m²]（已乘以部位与迎角的比例）
 * @param ambientTemperature 来流静温 [K]
 * @param speed 相对大气的速度 [m/s]
 * @param sinkTemperature 辐射环境温度 [K]
 * @returns 本步内新发生的失效；没有则为 null
 */
export const stepThermalZone = (
  props: ThermalSurfaceProperties,
  state: ThermalZoneState,
  coldWallFlux: number,
  ambientTemperature: number,
  speed: number,
  sinkTemperature: number,
  dt: number,
): ThermalFailure | null => {
  if (state.failure || !(dt > 0)) return null;
  const totalEnthalpy = AIR_SPECIFIC_HEAT * ambientTemperature + 0.5 * speed * speed;
  const flux = coldWallFlux > 0 ? coldWallFlux : 0;
  const convectiveSlope = totalEnthalpy > 0 ? (flux * AIR_SPECIFIC_HEAT) / totalEnthalpy : 0;

  let remaining = dt;
  for (let i = 0; i < MAX_SUBSTEPS && remaining > 0; i++) {
    const ts = state.surfaceTemperature;
    const rate = 4 * props.emissivity * STEFAN_BOLTZMANN * ts * ts * ts + props.conductance + convectiveSlope;
    const tau = props.surfaceHeatCapacity / Math.max(rate, 1e-12);
    const interiorTau = props.interiorHeatCapacity / Math.max(props.conductance, 1e-12);
    const h = i === MAX_SUBSTEPS - 1 ? remaining : Math.min(remaining, STABILITY_FRACTION * Math.min(tau, interiorTau));
    remaining -= h;

    const convective = flux * hotWallFactor(ts, ambientTemperature, speed);
    const radiative = radiativeHeatFlux(props.emissivity, ts, sinkTemperature);
    const conduction = props.conductance * (ts - state.interiorTemperature);
    const net = convective - radiative - conduction;

    state.convectiveFlux = convective;
    state.radiativeFlux = radiative;
    state.ablationRate = 0;
    if (convective > 0) state.heatLoad += convective * h;
    state.interiorTemperature += (conduction * h) / props.interiorHeatCapacity;

    const ablator = props.ablator;
    if (ablator && state.ablatorRemaining > 0 && net > 0 && ts + (net * h) / props.surfaceHeatCapacity >= ablator.temperature) {
      // 先把表层加热到烧蚀温度，剩余的热量由烧蚀带走
      const toReach = Math.max(0, (ablator.temperature - ts) * props.surfaceHeatCapacity);
      const excess = net * h - toReach;
      state.surfaceTemperature = ablator.temperature;
      const ablated = excess / ablator.heatOfAblation;
      state.ablationRate = ablated / h;
      state.ablatorRemaining -= ablated;
      if (state.ablatorRemaining <= 0) {
        state.ablatorRemaining = 0;
        state.failure = 'burn-through';
        return state.failure;
      }
    } else {
      state.surfaceTemperature = ts + (net * h) / props.surfaceHeatCapacity;
    }

    if (state.surfaceTemperature > props.maxSurfaceTemperature) {
      state.failure = 'surface';
      return state.failure;
    }
    if (state.interiorTemperature > props.maxInteriorTemperature) {
      state.failure = 'structure';
      return state.failure;
    }
  }
  return null;
};

/** 烧蚀层剩余比例 [0, 1]；非烧蚀材料返回 1。 */
export const ablatorFraction = (props: ThermalSurfaceProperties, state: ThermalZoneState): number =>
  props.ablator && props.ablator.arealMass > 0 ? Math.max(0, Math.min(1, state.ablatorRemaining / props.ablator.arealMass)) : 1;

/**
 * 热裕度 [0, 1]：1 表示完全没有受热，0 表示到达失效限值。取三项中最小的：
 * 表面温度距最高工作温度、内部温度距限值（均以初始温度为零点）、烧蚀层剩余比例。
 */
export const thermalMargin = (props: ThermalSurfaceProperties, state: ThermalZoneState, referenceTemperature: number): number => {
  if (state.failure) return 0;
  const span = (limit: number, value: number): number =>
    limit > referenceTemperature ? Math.max(0, Math.min(1, (limit - value) / (limit - referenceTemperature))) : 0;
  // 烧蚀材料的表面温度被钳制在烧蚀温度，表面项不构成失效，改由烧蚀层余量衡量
  const surface = props.ablator ? 1 : span(props.maxSurfaceTemperature, state.surfaceTemperature);
  const interior = span(props.maxInteriorTemperature, state.interiorTemperature);
  return Math.min(surface, interior, ablatorFraction(props, state));
};
