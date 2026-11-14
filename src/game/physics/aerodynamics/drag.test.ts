import { describe, expect, it } from 'vitest';
import { CROSS_FLOW_DRAG_COEFFICIENT, type AeroProperties, dragArea, dragMachFactor, dynamicPressure } from './drag';

const rocket: AeroProperties = { referenceArea: 11.34, baseDragCoefficient: 0.3, shape: 'slender', lateralArea: 212 };
const capsule: AeroProperties = { referenceArea: 11.34, baseDragCoefficient: 1.3, shape: 'blunt', lateralArea: 14.8 };

describe('马赫数修正曲线', () => {
  it('细长体：亚声速为基准值，跨声速出现阻力峰，高超声速回落', () => {
    expect(dragMachFactor('slender', 0)).toBe(1);
    expect(dragMachFactor('slender', 0.5)).toBe(1);
    const peak = dragMachFactor('slender', 1.05);
    expect(peak).toBeGreaterThan(1.8);
    expect(dragMachFactor('slender', 0.9)).toBeLessThan(peak);
    expect(dragMachFactor('slender', 2)).toBeLessThan(peak);
    expect(dragMachFactor('slender', 10)).toBeLessThan(1);
  });

  it('钝头体：高超声速为基准值，亚声速更低', () => {
    expect(dragMachFactor('blunt', 10)).toBe(1);
    expect(dragMachFactor('blunt', 0.3)).toBeLessThan(0.7);
  });

  it('在节点之间线性插值，且整条曲线连续', () => {
    expect(dragMachFactor('slender', 0.7)).toBeCloseTo(1.075, 12);
    for (const shape of ['slender', 'blunt'] as const) {
      let prev = dragMachFactor(shape, 0);
      for (let m = 0.01; m < 25; m += 0.01) {
        const f = dragMachFactor(shape, m);
        expect(Math.abs(f - prev)).toBeLessThan(0.05);
        prev = f;
      }
    }
  });

  it('超出表格范围与无效输入时取端点值', () => {
    expect(dragMachFactor('slender', 1000)).toBe(0.75);
    expect(dragMachFactor('slender', -1)).toBe(1);
    expect(dragMachFactor('slender', NaN)).toBe(1);
  });
});

describe('有效阻力面积', () => {
  it('零迎角时等于 C_d(M)·A_ref', () => {
    expect(dragArea(rocket, 0.3, 1)).toBeCloseTo(0.3 * 11.34, 12);
    expect(dragArea(capsule, 8, -1)).toBeCloseTo(1.3 * 11.34, 12);
  });

  it('横向来流时等于横流阻力系数 × 侧向面积，远大于轴向阻力', () => {
    const sideways = dragArea(rocket, 0.3, 0);
    expect(sideways).toBeCloseTo(CROSS_FLOW_DRAG_COEFFICIENT * 212, 12);
    expect(sideways).toBeGreaterThan(50 * dragArea(rocket, 0.3, 1));
  });

  it('随迎角单调增加（细长体）', () => {
    let prev = dragArea(rocket, 2, 1);
    for (let deg = 5; deg <= 90; deg += 5) {
      const area = dragArea(rocket, 2, Math.cos((deg * Math.PI) / 180));
      expect(area).toBeGreaterThan(prev);
      prev = area;
    }
  });

  it('余弦略超出 [−1, 1]（浮点误差）时不产生负的横流项', () => {
    expect(dragArea(rocket, 0.3, 1.0000001)).toBeCloseTo(0.3 * 11.34, 9);
  });
});

describe('动压', () => {
  it('q = ½ρv²', () => {
    expect(dynamicPressure(1.225, 100)).toBeCloseTo(6125, 9);
    expect(dynamicPressure(0, 7800)).toBe(0);
  });
});
