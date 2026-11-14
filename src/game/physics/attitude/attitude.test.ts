import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../constants';
import { IDENTITY, fromAxisAngle, rotate } from '../math/quat';
import { UNIT_X, UNIT_Y, UNIT_Z, length, vec3 } from '../math/vec3';
import {
  type AttitudeControlParams,
  commandedBodyRate,
  integrateAttitude,
  respondBodyRate,
  sanitizeAttitudeInput,
} from './attitude';

const params: AttitudeControlParams = { maxPitchYawRate: 8 * DEG2RAD, maxRollRate: 15 * DEG2RAD, timeConstant: 0.4 };

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, tol = 1e-12) => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
  expect(Math.abs(a.z - b.z)).toBeLessThan(tol);
};

describe('操纵输入 → 角速度指令', () => {
  it('偏航 +1：头部（机体 +X）转向机体 +Y', () => {
    const rate = commandedBodyRate({ pitch: 0, yaw: 1, roll: 0 }, params);
    const q = integrateAttitude(IDENTITY, rate, 1);
    const nose = rotate(q, UNIT_X);
    expect(nose.y).toBeGreaterThan(0);
    expect(nose.z).toBeCloseTo(0, 12);
    expect(Math.atan2(nose.y, nose.x)).toBeCloseTo(8 * DEG2RAD, 12);
  });

  it('俯仰 +1：头部转向机体 +Z', () => {
    const rate = commandedBodyRate({ pitch: 1, yaw: 0, roll: 0 }, params);
    const nose = rotate(integrateAttitude(IDENTITY, rate, 1), UNIT_X);
    expect(nose.z).toBeGreaterThan(0);
    expect(nose.y).toBeCloseTo(0, 12);
  });

  it('滚转 +1：机体 +Y 转向机体 +Z，头部指向不变', () => {
    const rate = commandedBodyRate({ pitch: 0, yaw: 0, roll: 1 }, params);
    const q = integrateAttitude(IDENTITY, rate, 1);
    close(rotate(q, UNIT_X), UNIT_X);
    expect(rotate(q, UNIT_Y).z).toBeGreaterThan(0);
  });

  it('输入被限制在 [−1, 1]，无效数值视为 0', () => {
    expect(sanitizeAttitudeInput({ pitch: 5, yaw: -3, roll: NaN })).toEqual({ pitch: 1, yaw: -1, roll: 0 });
  });
});

describe('角速度一阶响应', () => {
  it('经过一个时间常数后达到指令值的 63.2%', () => {
    const omega = respondBodyRate(vec3(0, 0, 0), vec3(0, 0, 0.1), 0.4, 0.4);
    expect(omega.z).toBeCloseTo(0.1 * (1 - Math.exp(-1)), 12);
  });

  it('结果与步长划分无关（解析解）', () => {
    let a = vec3(0.02, -0.01, 0);
    for (let i = 0; i < 100; i++) a = respondBodyRate(a, vec3(0, 0.1, 0.05), 0.01, 0.4);
    const b = respondBodyRate(vec3(0.02, -0.01, 0), vec3(0, 0.1, 0.05), 1, 0.4);
    close(a, b, 1e-12);
  });

  it('松开输入后角速度衰减到零（姿态保持）', () => {
    let omega = vec3(0, 0, 0.14);
    for (let i = 0; i < 500; i++) omega = respondBodyRate(omega, vec3(0, 0, 0), 0.02, 0.4);
    expect(length(omega)).toBeLessThan(1e-10);
  });

  it('时间常数为 0 时立即到达指令值', () => {
    close(respondBodyRate(vec3(1, 2, 3), vec3(0, 0, 0.1), 0.02, 0), vec3(0, 0, 0.1));
  });
});

describe('姿态积分', () => {
  it('恒定角速度下转过的角度 = ω·t，与步长无关', () => {
    const omega = vec3(0, 0, 10 * DEG2RAD);
    let q = IDENTITY;
    for (let i = 0; i < 450; i++) q = integrateAttitude(q, omega, 0.02);
    close(rotate(q, UNIT_X), UNIT_Y, 1e-9);
    close(rotate(integrateAttitude(IDENTITY, omega, 9), UNIT_X), UNIT_Y, 1e-12);
  });

  it('角速度在机体系中表达：先偏航 90° 后，绕机体 +Y 的转动作用在新的机体轴上', () => {
    const yawed = integrateAttitude(IDENTITY, vec3(0, 0, Math.PI / 2), 1);
    const q = integrateAttitude(yawed, vec3(0, Math.PI / 2, 0), 1);
    // 偏航后机体 +Y 指向惯性 −X；绕它正转 90° 把头部（此时沿惯性 +Y）转向 −Z
    close(rotate(q, UNIT_X), vec3(0, 0, -1), 1e-12);
    close(rotate(q, UNIT_Y), rotate(fromAxisAngle(UNIT_Z, Math.PI / 2), UNIT_Y), 1e-12);
  });

  it('长时间积分后仍为单位四元数', () => {
    let q = IDENTITY;
    for (let i = 0; i < 100_000; i++) q = integrateAttitude(q, vec3(0.11, -0.07, 0.13), 0.02);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  });

  it('角速度为零时姿态不变', () => {
    const q = fromAxisAngle(UNIT_Z, 0.3);
    expect(integrateAttitude(q, vec3(0, 0, 0), 10)).toBe(q);
  });
});
