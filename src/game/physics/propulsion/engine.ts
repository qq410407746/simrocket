/**
 * 火箭发动机稳态性能模型。
 *
 * 推力方程（一维理想喷管）：
 *   F = ṁ·v_e + (p_e − p_a)·A_e
 * 真空中 p_a = 0，得 F_vac = ṁ·v_e + p_e·A_e，于是任意环境压力下
 *   F(p_a) = F_vac − p_a·A_e                                   (1)
 * 质量流量由真空比冲定义给出：
 *   ṁ = F_vac / (g₀·Isp_vac)                                   (2)
 * 节流：假设质量流量与室压同比例变化，喷管出口压力随之同比例变化，
 *   故 F_vac 与 ṁ 都乘以节流系数 τ，而背压项 p_a·A_e 不变：
 *   F(p_a, τ) = τ·F_vac − p_a·A_e ,   ṁ(τ) = τ·F_vac / (g₀·Isp_vac)
 *
 * 单位：F [N]，ṁ [kg/s]，p [Pa]，A [m²]，Isp [s]。
 * 适用范围：稳态工作；不模拟启动/关机瞬态、过度膨胀喷管内的流动分离、
 *           混合比变化。真空优化发动机在海平面由式 (1) 得到的推力只是下界估计。
 */
import { STANDARD_GRAVITY } from '../constants';

/** 计算发动机性能所需的最小参数集。 */
export interface EnginePerformanceParams {
  /** 单台真空推力 [N]。 */
  readonly thrustVacuum: number;
  /** 真空比冲 [s]。 */
  readonly ispVacuum: number;
  /** 喷管出口面积 [m²]。 */
  readonly nozzleExitArea: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 单台发动机质量流量 [kg/s]。 */
export const engineMassFlow = (engine: EnginePerformanceParams, throttle: number): number =>
  (clamp01(throttle) * engine.thrustVacuum) / (STANDARD_GRAVITY * engine.ispVacuum);

/** 单台发动机在环境压力 ambientPressure [Pa] 下的推力 [N]（不小于 0）。 */
export const engineThrust = (
  engine: EnginePerformanceParams,
  ambientPressure: number,
  throttle: number,
): number => {
  const tau = clamp01(throttle);
  if (tau === 0) return 0;
  return Math.max(0, tau * engine.thrustVacuum - ambientPressure * engine.nozzleExitArea);
};

/** 环境压力下的有效比冲 [s]（满推力）。 */
export const engineIsp = (engine: EnginePerformanceParams, ambientPressure: number): number => {
  const mdot = engineMassFlow(engine, 1);
  return mdot > 0 ? engineThrust(engine, ambientPressure, 1) / (mdot * STANDARD_GRAVITY) : 0;
};

/**
 * 齐奥尔科夫斯基火箭方程：Δv = g₀·Isp·ln(m₀ / m_f)。
 * 假设：无重力、无阻力、比冲恒定。用于估算"理想 Δv 预算"。
 */
export const idealDeltaV = (isp: number, initialMass: number, finalMass: number): number => {
  if (!(initialMass > 0) || !(finalMass > 0) || finalMass > initialMass) return 0;
  return STANDARD_GRAVITY * isp * Math.log(initialMass / finalMass);
};
