import { describe, expect, it } from 'vitest';
import { DEG2RAD, EARTH } from '../constants';
import { fromAxisAngle, multiply, rotate } from '../math/quat';
import { cross, dot, length, sub, vec3 } from '../math/vec3';
import {
  airRelativeVelocityEci,
  altitudeOf,
  bodyToFrame,
  ecefToEci,
  ecefToEciVelocity,
  ecefToGeodetic,
  eciToEcef,
  eciToEcefVelocity,
  enuBasisAt,
  frameToBody,
  fromEnu,
  geodeticToEcef,
  pointingAngles,
  toEnu,
  verticalLaunchAttitude,
} from './frames';

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, tol: number) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
  expect(Math.abs(a.z - b.z)).toBeLessThan(tol);
};

describe('地理坐标 ↔ ECEF', () => {
  it('赤道/本初子午线交点在 +X 轴上', () => {
    close(geodeticToEcef({ latitude: 0, longitude: 0, altitude: 0 }), vec3(EARTH.RADIUS, 0, 0), 1e-6);
  });

  it('东经 90° 赤道点在 +Y 轴上，北极在 +Z 轴上', () => {
    close(geodeticToEcef({ latitude: 0, longitude: 90 * DEG2RAD, altitude: 0 }), vec3(0, EARTH.RADIUS, 0), 1e-6);
    close(geodeticToEcef({ latitude: 90 * DEG2RAD, longitude: 0, altitude: 0 }), vec3(0, 0, EARTH.RADIUS), 1e-6);
  });

  it('往返转换保持数值（多个地点）', () => {
    const cases = [
      { latitude: 28.5 * DEG2RAD, longitude: -80.6 * DEG2RAD, altitude: 0 },
      { latitude: -33.9 * DEG2RAD, longitude: 151.2 * DEG2RAD, altitude: 408_000 },
      { latitude: 45.96 * DEG2RAD, longitude: 63.31 * DEG2RAD, altitude: 35_786_000 },
      { latitude: 0, longitude: 179.999 * DEG2RAD, altitude: 12.5 },
    ];
    for (const g of cases) {
      const back = ecefToGeodetic(geodeticToEcef(g));
      expect(back.latitude).toBeCloseTo(g.latitude, 12);
      expect(back.longitude).toBeCloseTo(g.longitude, 12);
      expect(Math.abs(back.altitude - g.altitude)).toBeLessThan(1e-6);
    }
  });

  it('altitudeOf 等于到地心距离减平均半径', () => {
    expect(altitudeOf(vec3(0, EARTH.RADIUS + 1000, 0))).toBeCloseTo(1000, 6);
  });
});

describe('ECI ↔ ECEF', () => {
  const theta = 1.2345;
  const rEci = vec3(4_000_000, -3_000_000, 4_200_000);
  const vEci = vec3(1200, 6800, -900);

  it('位置往返', () => {
    close(ecefToEci(eciToEcef(rEci, theta), theta), rEci, 1e-6);
  });

  it('θ = 0 时两系重合；θ > 0 时地固点在 ECI 中向东转', () => {
    close(eciToEcef(rEci, 0), rEci, 1e-9);
    const site = vec3(EARTH.RADIUS, 0, 0);
    const moved = ecefToEci(site, 0.001);
    expect(moved.y).toBeGreaterThan(0);
  });

  it('速度往返', () => {
    const rEcef = eciToEcef(rEci, theta);
    const vEcef = eciToEcefVelocity(rEci, vEci, theta);
    close(ecefToEciVelocity(rEcef, vEcef, theta), vEci, 1e-9);
  });

  it('地面静止点：ECEF 速度为零，ECI 速度为 ω × r（赤道处约 465 m/s 向东）', () => {
    const rEcef = geodeticToEcef({ latitude: 0, longitude: 0, altitude: 0 });
    const vEciSite = ecefToEciVelocity(rEcef, vec3(0, 0, 0), 0);
    expect(length(vEciSite)).toBeCloseTo(EARTH.ROTATION_RATE * EARTH.RADIUS, 9);
    expect(length(vEciSite)).toBeGreaterThan(464);
    expect(length(vEciSite)).toBeLessThan(466);
    expect(vEciSite.y).toBeGreaterThan(0);
    close(eciToEcefVelocity(rEcef, vEciSite, 0), vec3(0, 0, 0), 1e-12);
  });

  it('相对大气速度：与地面共转的物体为零', () => {
    const r = vec3(3_000_000, 4_000_000, 3_500_000);
    const v = cross(vec3(0, 0, EARTH.ROTATION_RATE), r);
    expect(length(airRelativeVelocityEci(r, v))).toBeLessThan(1e-12);
    // 惯性系静止的物体相对大气以 ω×r 的速度向西运动
    const rel = airRelativeVelocityEci(r, vec3(0, 0, 0));
    close(rel, sub(vec3(0, 0, 0), v), 1e-12);
  });
});

describe('局部水平系 ENU', () => {
  it('基向量正交归一并构成右手系', () => {
    const p = geodeticToEcef({ latitude: 40 * DEG2RAD, longitude: 100 * DEG2RAD, altitude: 0 });
    const { east, north, up } = enuBasisAt(p);
    expect(length(east)).toBeCloseTo(1, 14);
    expect(length(north)).toBeCloseTo(1, 14);
    expect(length(up)).toBeCloseTo(1, 14);
    expect(dot(east, north)).toBeCloseTo(0, 14);
    expect(dot(east, up)).toBeCloseTo(0, 14);
    close(cross(east, north), up, 1e-14);
  });

  it('赤道/本初子午线：东 = +Y，北 = +Z，天 = +X', () => {
    const { east, north, up } = enuBasisAt(vec3(EARTH.RADIUS, 0, 0));
    close(east, vec3(0, 1, 0), 1e-14);
    close(north, vec3(0, 0, 1), 1e-14);
    close(up, vec3(1, 0, 0), 1e-14);
  });

  it('北半球的"北"有正的 Z 分量', () => {
    const p = geodeticToEcef({ latitude: 28.5 * DEG2RAD, longitude: -80.6 * DEG2RAD, altitude: 0 });
    expect(enuBasisAt(p).north.z).toBeGreaterThan(0);
  });

  it('极点奇异处输出仍然有限且正交', () => {
    const { east, north, up } = enuBasisAt(vec3(0, 0, EARTH.RADIUS));
    for (const v of [east, north, up]) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    expect(dot(east, up)).toBeCloseTo(0, 14);
    expect(dot(north, up)).toBeCloseTo(0, 14);
  });

  it('toEnu / fromEnu 往返', () => {
    const basis = enuBasisAt(geodeticToEcef({ latitude: -20 * DEG2RAD, longitude: 30 * DEG2RAD, altitude: 0 }));
    const v = vec3(12.5, -7.25, 3.125);
    close(fromEnu(toEnu(v, basis), basis), v, 1e-12);
  });
});

describe('机体系与姿态', () => {
  const site = geodeticToEcef({ latitude: 28.5 * DEG2RAD, longitude: -80.6 * DEG2RAD, altitude: 0 });

  it('发射台姿态：机体 +X 指天、+Y 指东、+Z 指北', () => {
    const q = verticalLaunchAttitude(site);
    const { east, north, up } = enuBasisAt(site);
    close(bodyToFrame(q, vec3(1, 0, 0)), up, 1e-12);
    close(bodyToFrame(q, vec3(0, 1, 0)), east, 1e-12);
    close(bodyToFrame(q, vec3(0, 0, 1)), north, 1e-12);
  });

  it('bodyToFrame / frameToBody 互逆', () => {
    const q = verticalLaunchAttitude(site);
    const v = vec3(1, 2, 3);
    close(frameToBody(q, bodyToFrame(q, v)), v, 1e-12);
  });

  it('竖直姿态：俯仰 90°，航向无定义', () => {
    const angles = pointingAngles(verticalLaunchAttitude(site), site);
    expect(angles.pitch).toBeCloseTo(Math.PI / 2, 9);
    expect(angles.heading).toBeNull();
  });

  it('向东倾斜 30°：俯仰 60°，航向 90°', () => {
    const base = verticalLaunchAttitude(site);
    const { north } = enuBasisAt(site);
    // 绕"北"轴右手旋转 +30°，把"天"转向"东"。
    const tilted = multiply(fromAxisAngle(north, 30 * DEG2RAD), base);
    const angles = pointingAngles(tilted, site);
    expect(angles.pitch).toBeCloseTo(60 * DEG2RAD, 9);
    expect(angles.heading).toBeCloseTo(90 * DEG2RAD, 9);
    // 自检：倾斜后的头部方向确实有正的东向分量。
    expect(dot(rotate(tilted, vec3(1, 0, 0)), enuBasisAt(site).east)).toBeGreaterThan(0);
  });

  it('向北倾斜到水平：俯仰 0°，航向 0°', () => {
    const base = verticalLaunchAttitude(site);
    const { east } = enuBasisAt(site);
    // 绕"东"轴右手旋转 −90°，把"天"转向"北"。
    const level = multiply(fromAxisAngle(east, -90 * DEG2RAD), base);
    const angles = pointingAngles(level, site);
    expect(angles.pitch).toBeCloseTo(0, 9);
    expect(angles.heading === null ? NaN : Math.min(angles.heading, 2 * Math.PI - angles.heading)).toBeCloseTo(0, 9);
  });
});
