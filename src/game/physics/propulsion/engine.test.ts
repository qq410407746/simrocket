import { describe, expect, it } from 'vitest';
import { SEA_LEVEL, STANDARD_GRAVITY } from '../constants';
import { engineIsp, engineMassFlow, engineThrust, idealDeltaV } from './engine';

const engine = { thrustVacuum: 900e3, ispVacuum: 315, nozzleExitArea: 0.85 };

describe('发动机性能', () => {
  it('真空推力等于额定真空推力', () => {
    expect(engineThrust(engine, 0, 1)).toBe(900e3);
  });

  it('海平面推力 = F_vac − p₀·A_e', () => {
    expect(engineThrust(engine, SEA_LEVEL.PRESSURE, 1)).toBeCloseTo(900e3 - 101_325 * 0.85, 6);
  });

  it('质量流量 ṁ = F_vac / (g₀·Isp_vac)，与环境压力无关', () => {
    expect(engineMassFlow(engine, 1)).toBeCloseTo(900e3 / (STANDARD_GRAVITY * 315), 9);
    expect(engineMassFlow(engine, 0.5)).toBeCloseTo(engineMassFlow(engine, 1) / 2, 12);
  });

  it('真空比冲还原为额定值；海平面比冲更低', () => {
    expect(engineIsp(engine, 0)).toBeCloseTo(315, 10);
    const ispSl = engineIsp(engine, SEA_LEVEL.PRESSURE);
    expect(ispSl).toBeLessThan(315);
    expect(ispSl).toBeCloseTo((315 * (900e3 - 101_325 * 0.85)) / 900e3, 9);
  });

  it('节流为 0 时推力与流量均为 0；节流指令被限制在 [0, 1]', () => {
    expect(engineThrust(engine, SEA_LEVEL.PRESSURE, 0)).toBe(0);
    expect(engineMassFlow(engine, 0)).toBe(0);
    expect(engineThrust(engine, 0, 2)).toBe(900e3);
    expect(engineMassFlow(engine, -1)).toBe(0);
  });

  it('背压超过节流后推力时结果钳制为 0 而不是负值', () => {
    const vacuumEngine = { thrustVacuum: 110e3, ispVacuum: 452, nozzleExitArea: 3.5 };
    expect(engineThrust(vacuumEngine, SEA_LEVEL.PRESSURE, 1)).toBe(0);
  });
});

describe('齐奥尔科夫斯基方程', () => {
  it('Δv = g₀·Isp·ln(m₀/m_f)', () => {
    expect(idealDeltaV(300, Math.E * 1000, 1000)).toBeCloseTo(STANDARD_GRAVITY * 300, 9);
  });

  it('质量比为 1 时 Δv 为 0；无效输入返回 0', () => {
    expect(idealDeltaV(300, 1000, 1000)).toBe(0);
    expect(idealDeltaV(300, 0, 1000)).toBe(0);
    expect(idealDeltaV(300, 1000, 2000)).toBe(0);
    expect(idealDeltaV(300, NaN, 1000)).toBe(0);
  });
});
