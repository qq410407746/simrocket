import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../constants';
import { capHalfAngle, maxTrimAngle, newtonianCapForceAngle, newtonianCapLiftToDrag, trimAngleOfAttack } from './trim';

/**
 * 直接对球冠表面做数值积分（牛顿流 p ∝ (û·n̂)²），得到合力偏离轴线的角度。
 * 用来验证 trim.ts 里的解析式，两者互相独立。
 */
const integratedForceAngle = (alpha: number, halfAngle: number): number => {
  const steps = 400;
  let axial = 0;
  let lateral = 0;
  for (let i = 0; i < steps; i++) {
    const theta = ((i + 0.5) / steps) * halfAngle;
    for (let j = 0; j < steps; j++) {
      const phi = ((j + 0.5) / steps) * 2 * Math.PI;
      // 外法线 n = (cosθ, sinθ·cosφ, sinθ·sinφ)，来向 u = (cosα, sinα, 0)
      const facing = Math.cos(alpha) * Math.cos(theta) + Math.sin(alpha) * Math.sin(theta) * Math.cos(phi);
      if (facing <= 0) continue;
      const pressure = facing * facing * Math.sin(theta);
      axial += pressure * Math.cos(theta);
      lateral += pressure * Math.sin(theta) * Math.cos(phi);
    }
  }
  return Math.atan2(lateral, axial);
};

describe('牛顿流球冠的合力方向', () => {
  it('解析式与对球冠表面的数值积分一致', () => {
    for (const halfAngleDeg of [15, 24.4, 40, 60]) {
      for (const alphaDeg of [5, 12, 20, 28]) {
        const halfAngle = halfAngleDeg * DEG2RAD;
        const alpha = alphaDeg * DEG2RAD;
        if (alpha + halfAngle > Math.PI / 2) continue;
        expect(newtonianCapForceAngle(alpha, halfAngle)).toBeCloseTo(integratedForceAngle(alpha, halfAngle), 5);
      }
    }
  });

  it('零迎角时合力沿轴线；迎角越大偏离越多', () => {
    const halfAngle = 24 * DEG2RAD;
    expect(newtonianCapForceAngle(0, halfAngle)).toBe(0);
    let previous = 0;
    for (let deg = 1; deg <= 66; deg++) {
      const delta = newtonianCapForceAngle(deg * DEG2RAD, halfAngle);
      expect(delta).toBeGreaterThan(previous);
      previous = delta;
    }
  });

  it('大底越平，合力越贴近轴线、升阻比越接近 tan α；半球的合力沿来流方向（没有升力）', () => {
    const alpha = 20 * DEG2RAD;
    expect(newtonianCapForceAngle(alpha, 1 * DEG2RAD)).toBeLessThan(1e-3);
    expect(newtonianCapLiftToDrag(alpha, 1 * DEG2RAD)).toBeCloseTo(Math.tan(alpha), 3);
    expect(newtonianCapForceAngle(10 * DEG2RAD, 40 * DEG2RAD)).toBeGreaterThan(newtonianCapForceAngle(10 * DEG2RAD, 20 * DEG2RAD));
    // 球体：压力合力必然沿来流方向。这里只在解析式的适用范围边界上检查趋势（半球、α → 0）
    const small = 0.01 * DEG2RAD;
    expect(newtonianCapForceAngle(small, Math.PI / 2) / small).toBeCloseTo(1, 3);
  });
});

describe('配平迎角', () => {
  // 阿波罗指令舱的量级：大底曲率半径 4.69 m，最大半径 1.956 m，质心距大底约 1.0 m、偏离轴线约 0.14 m
  const apollo = { noseRadius: 4.69, baseRadius: 1.956, centerOfMassHeight: 1.0, centerOfMassOffset: 0.14 };

  it('阿波罗量级的质心偏移给出约 20° 的配平迎角与约 0.35 的升阻比', () => {
    const alpha = trimAngleOfAttack(apollo);
    expect(alpha / DEG2RAD).toBeGreaterThan(18);
    expect(alpha / DEG2RAD).toBeLessThan(25);
    const liftToDrag = newtonianCapLiftToDrag(alpha, capHalfAngle(apollo.noseRadius, apollo.baseRadius));
    expect(liftToDrag).toBeGreaterThan(0.3);
    expect(liftToDrag).toBeLessThan(0.42);
  });

  it('解满足力矩平衡：合力的作用线同时通过球心与质心', () => {
    const alpha = trimAngleOfAttack(apollo);
    const delta = newtonianCapForceAngle(alpha, capHalfAngle(apollo.noseRadius, apollo.baseRadius));
    expect(Math.tan(delta)).toBeCloseTo(apollo.centerOfMassOffset / (apollo.noseRadius - apollo.centerOfMassHeight), 9);
  });

  it('质心在轴线上时没有配平迎角；偏移越大、质心越靠后，配平迎角越大', () => {
    expect(trimAngleOfAttack({ ...apollo, centerOfMassOffset: 0 })).toBe(0);
    expect(trimAngleOfAttack({ ...apollo, centerOfMassOffset: -0.1 })).toBe(0);
    const small = trimAngleOfAttack({ ...apollo, centerOfMassOffset: 0.07 });
    const large = trimAngleOfAttack(apollo);
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(large);
    // 小偏移时近似成正比
    expect(large / small).toBeGreaterThan(1.8);
    expect(large / small).toBeLessThan(2.3);
    // 质心离球心越近（越靠舱顶），同样的偏移对应的合力偏角越大
    expect(trimAngleOfAttack({ ...apollo, centerOfMassHeight: 2.0 })).toBeGreaterThan(large);
  });

  it('偏移超出模型适用范围时返回适用范围的上限（整个球冠仍然迎风）', () => {
    const halfAngle = capHalfAngle(apollo.noseRadius, apollo.baseRadius);
    expect(trimAngleOfAttack({ ...apollo, centerOfMassOffset: 3 })).toBeCloseTo(maxTrimAngle(halfAngle), 9);
    expect(maxTrimAngle(halfAngle) / DEG2RAD).toBeCloseTo(90 - halfAngle / DEG2RAD, 9);
  });

  it('球冠半角由曲率半径与边缘半径决定', () => {
    expect(capHalfAngle(2, 1) / DEG2RAD).toBeCloseTo(30, 9);
    expect(capHalfAngle(1, 1) / DEG2RAD).toBeCloseTo(90, 9);
    expect(capHalfAngle(1, 5) / DEG2RAD).toBeCloseTo(90, 9);
  });
});
