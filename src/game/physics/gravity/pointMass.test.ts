import { describe, expect, it } from 'vitest';
import { EARTH, SIDEREAL_DAY } from '../constants';
import { dot, length, normalize, vec3 } from '../math/vec3';
import { gravityAcceleration, gravityMagnitude } from './pointMass';

describe('二体引力', () => {
  it('海平面（平均半径）引力加速度约 9.820 m/s²', () => {
    // μ/R² = 3.986004418e14 / 6371000² = 9.8203 m/s²
    expect(gravityMagnitude(EARTH.RADIUS)).toBeCloseTo(9.8203, 3);
  });

  it('不同高度的引力加速度', () => {
    // 参考值由 μ/r² 直接计算：400 km → 8.694；35786 km（GEO）→ 0.2243
    expect(gravityMagnitude(EARTH.RADIUS + 400_000)).toBeCloseTo(8.694, 2);
    expect(gravityMagnitude(EARTH.RADIUS + 100_000)).toBeCloseTo(9.519, 2);
    expect(gravityMagnitude(42_164_000)).toBeCloseTo(0.2242, 3);
  });

  it('满足平方反比律', () => {
    const r = 7_000_000;
    expect(gravityMagnitude(2 * r) / gravityMagnitude(r)).toBeCloseTo(0.25, 14);
  });

  it('加速度矢量指向地心，大小与标量公式一致', () => {
    const r = vec3(3_000_000, -5_000_000, 2_500_000);
    const a = gravityAcceleration(r);
    expect(dot(normalize(a), normalize(r))).toBeCloseTo(-1, 14);
    expect(length(a)).toBeCloseTo(gravityMagnitude(length(r)), 12);
  });

  it('地心处返回零向量而不是 NaN', () => {
    const a = gravityAcceleration(vec3(0, 0, 0));
    expect(a).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('常量自洽：地球同步轨道半径处的圆轨道周期等于恒星日', () => {
    // r_GEO = (μ T² / 4π²)^(1/3) ≈ 42164 km
    const rGeo = Math.cbrt((EARTH.MU * SIDEREAL_DAY * SIDEREAL_DAY) / (4 * Math.PI * Math.PI));
    expect(rGeo / 1000).toBeCloseTo(42_164.2, 0);
    expect(SIDEREAL_DAY).toBeCloseTo(86_164.1, 0);
  });
});
