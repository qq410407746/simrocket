import { describe, expect, it } from 'vitest';
import {
  CROSS_FLOW_DRAG_COEFFICIENT,
  type AeroProperties,
  axialForceArea,
  dragArea,
  dragMachFactor,
  dynamicPressure,
  liftArea,
  normalForceArea,
} from './drag';

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

describe('升力（由轴向力与法向力合成）', () => {
  const cosDeg = (deg: number) => Math.cos((deg * Math.PI) / 180);

  it('零迎角、横向来流、尾部朝前时都没有升力', () => {
    for (const aero of [rocket, capsule]) {
      expect(liftArea(aero, 5, 1)).toBeCloseTo(0, 12);
      expect(liftArea(aero, 5, 0)).toBeCloseTo(0, 12);
      expect(liftArea(aero, 5, -1)).toBeCloseTo(0, 12);
    }
  });

  it('细长箭体头部朝前带迎角：升力指向头部偏向的一侧，随迎角先增后减', () => {
    const at5 = liftArea(rocket, 2, cosDeg(5));
    const at20 = liftArea(rocket, 2, cosDeg(20));
    const at45 = liftArea(rocket, 2, cosDeg(45));
    const at80 = liftArea(rocket, 2, cosDeg(80));
    expect(at5).toBeGreaterThan(0);
    expect(at20).toBeGreaterThan(at5);
    expect(at45).toBeGreaterThan(at20);
    expect(at80).toBeLessThan(at45);
    // 小迎角：L ≈ q·α·(C_N·A_lat − C_A·A_ref)
    const alpha = (5 * Math.PI) / 180;
    expect(at5).toBeCloseTo(Math.sin(alpha) * Math.cos(alpha) * (1.2 * 212 - axialForceArea(rocket, 2)), 9);
  });

  it('返回舱大底朝前、舱顶偏离逆行方向 20°：升阻比约 0.3，升力指向舱顶偏向的一侧', () => {
    const cosAlpha = cosDeg(160);
    const lift = liftArea(capsule, 20, cosAlpha);
    const drag = dragArea(capsule, 20, cosAlpha);
    expect(lift).toBeGreaterThan(0);
    expect(lift / drag).toBeGreaterThan(0.25);
    expect(lift / drag).toBeLessThan(0.36);
    // 小迎角下钝头体的法向力远小于轴向力
    expect(normalForceArea(capsule, 1 - cosAlpha * cosAlpha)).toBeLessThan(0.2 * axialForceArea(capsule, 20));
  });

  it('钝头体横向来流时的阻力仍等于横流阻力系数 × 侧向面积', () => {
    expect(dragArea(capsule, 3, 0)).toBeCloseTo(CROSS_FLOW_DRAG_COEFFICIENT * 14.8, 12);
  });

  it('阻力与升力就是机体轴向力、法向力在来流坐标系中的投影：D² + L² = F_A² + F_N²', () => {
    for (const aero of [rocket, capsule]) {
      for (const deg of [3, 25, 60, 110, 165]) {
        const cos = cosDeg(deg);
        const sin2 = 1 - cos * cos;
        const axial = axialForceArea(aero, 4) * cos;
        const normal = normalForceArea(aero, sin2) * Math.sqrt(sin2);
        const drag = dragArea(aero, 4, cos);
        const lift = liftArea(aero, 4, cos);
        expect(drag * drag + lift * lift).toBeCloseTo(axial * axial + normal * normal, 6);
        expect(drag).toBeGreaterThan(0);
      }
    }
  });
});

describe('动压', () => {
  it('q = ½ρv²', () => {
    expect(dynamicPressure(1.225, 100)).toBeCloseTo(6125, 9);
    expect(dynamicPressure(0, 7800)).toBe(0);
  });
});
