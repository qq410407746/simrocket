import { describe, expect, it } from 'vitest';
import { DEG2RAD, EARTH, RAD2DEG } from '../constants';
import { circularSpeed } from './elements';
import { inclinationFromAzimuth, inertialLaunchAzimuth, launchAzimuth, reachableInclination } from './launch';

const deg = (radians: number | null): number => (radians as number) * RAD2DEG;
const orbitalSpeed = circularSpeed(EARTH.RADIUS + 200_000);

describe('发射方位角与轨道倾角', () => {
  it('向正东发射得到最小倾角：等于发射场纬度', () => {
    for (const latitudeDeg of [0, 5.24, 28.5, 45.96, -33]) {
      const latitude = latitudeDeg * DEG2RAD;
      expect(deg(inclinationFromAzimuth(latitude, Math.PI / 2))).toBeCloseTo(Math.abs(latitudeDeg), 9);
      expect(deg(inertialLaunchAzimuth(latitude, Math.abs(latitude)))).toBeCloseTo(90, 5);
      const range = reachableInclination(latitude);
      expect(deg(range.min)).toBeCloseTo(Math.abs(latitudeDeg), 12);
      expect(deg(range.max)).toBeCloseTo(180 - Math.abs(latitudeDeg), 12);
    }
  });

  it('倾角小于发射场纬度时无法直接到达', () => {
    expect(inertialLaunchAzimuth(45.96 * DEG2RAD, 28.5 * DEG2RAD)).toBeNull();
    expect(launchAzimuth(45.96 * DEG2RAD, 28.5 * DEG2RAD, orbitalSpeed)).toBeNull();
    // 逆行方向同理：倾角大于 180° − 纬度也到不了
    expect(inertialLaunchAzimuth(45.96 * DEG2RAD, 140 * DEG2RAD)).toBeNull();
    expect(inertialLaunchAzimuth(Math.PI / 2, 1)).toBeNull();
  });

  it('同一个倾角有向北、向南两个方位角，关于正东对称；代回去得到同样的倾角', () => {
    const latitude = 28.5 * DEG2RAD;
    for (const inclinationDeg of [28.5, 40, 51.6, 75, 90, 98, 120]) {
      const inclination = inclinationDeg * DEG2RAD;
      const north = inertialLaunchAzimuth(latitude, inclination, 'ascending') as number;
      const south = inertialLaunchAzimuth(latitude, inclination, 'descending') as number;
      expect(deg(inclinationFromAzimuth(latitude, north))).toBeCloseTo(inclinationDeg, 5);
      expect(deg(inclinationFromAzimuth(latitude, south))).toBeCloseTo(inclinationDeg, 5);
      // 两者关于东西轴对称：β 与 180° − β
      expect(Math.sin(north)).toBeCloseTo(Math.sin(south), 12);
      expect(Math.cos(north)).toBeCloseTo(-Math.cos(south), 12);
    }
  });

  it('卡纳维拉尔角 → 51.6°：惯性方位角约 45°，扣除地球自转后相对地面约 43°', () => {
    const latitude = 28.5 * DEG2RAD;
    const inertial = deg(inertialLaunchAzimuth(latitude, 51.6 * DEG2RAD));
    expect(inertial).toBeCloseTo(44.98, 1);
    const relative = deg(launchAzimuth(latitude, 51.6 * DEG2RAD, orbitalSpeed));
    expect(relative).toBeGreaterThan(42);
    expect(relative).toBeLessThan(43.5);
    // 地球自转白送向东的速度，所以箭体要比惯性方位更偏北
    expect(relative).toBeLessThan(inertial);
  });

  it('范登堡 → 极地轨道：惯性方位角正南，相对地面要偏西约 3° 以抵消地球自转', () => {
    const latitude = 34.74 * DEG2RAD;
    expect(deg(inertialLaunchAzimuth(latitude, Math.PI / 2, 'descending'))).toBeCloseTo(180, 9);
    const relative = deg(launchAzimuth(latitude, Math.PI / 2, orbitalSpeed, 'descending'));
    const expected = 180 + Math.atan((EARTH.ROTATION_RATE * EARTH.RADIUS * Math.cos(latitude)) / orbitalSpeed) * RAD2DEG;
    expect(relative).toBeCloseTo(expected, 9);
    expect(relative).toBeGreaterThan(182.5);
    expect(relative).toBeLessThan(183.2);
    // 向北发射的极地轨道：对称地偏西
    expect(deg(launchAzimuth(latitude, Math.PI / 2, orbitalSpeed, 'ascending'))).toBeCloseTo(360 - (expected - 180), 9);
  });

  it('向正东发射时相对地面的方位角仍是正东（自转速度与发射方向同向）', () => {
    const latitude = 28.5 * DEG2RAD;
    expect(deg(launchAzimuth(latitude, latitude, orbitalSpeed))).toBeCloseTo(90, 4);
    // 入轨速度越大，地球自转的修正越小
    const slow = deg(launchAzimuth(latitude, 51.6 * DEG2RAD, 5_000));
    const fast = deg(launchAzimuth(latitude, 51.6 * DEG2RAD, 10_000));
    expect(Math.abs(fast - 44.98)).toBeLessThan(Math.abs(slow - 44.98));
  });
});
