import { describe, expect, it } from 'vitest';
import { DEG2RAD, EARTH } from '../constants';
import { IDENTITY, fromAxisAngle, rotate } from '../math/quat';
import { UNIT_X, UNIT_Y, UNIT_Z, length, vec3 } from '../math/vec3';
import {
  type AttitudeControlParams,
  commandedBodyRate,
  integrateAttitude,
  respondBodyRate,
  sanitizeAttitudeInput,
} from './attitude';
import {
  POINTING_GAIN,
  SURFACE_REFERENCE_ALTITUDE,
  isAttitudeMode,
  pointingDirection,
  referenceVelocity,
  steeringRateCommand,
  targetAngularVelocity,
} from './pointing';

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

describe('自动指向：参考方向', () => {
  // 600 km 圆轨道：r 沿 +X，v 沿 +Y，角动量沿 +Z
  const r = vec3(EARTH.RADIUS + 600_000, 0, 0);
  const v = vec3(0, 7_500, 0);

  it('顺行/逆行沿 ±速度方向；法向沿角动量方向；径向外指向远离地球', () => {
    close(pointingDirection('prograde', r, v)!, UNIT_Y);
    close(pointingDirection('retrograde', r, v)!, vec3(0, -1, 0));
    close(pointingDirection('normal', r, v)!, UNIT_Z);
    close(pointingDirection('antinormal', r, v)!, vec3(0, 0, -1));
    close(pointingDirection('radial-out', r, v)!, UNIT_X);
    close(pointingDirection('radial-in', r, v)!, vec3(-1, 0, 0));
    expect(pointingDirection('manual', r, v)).toBeNull();
  });

  it('椭圆轨道上：径向方向在轨道面内且垂直于速度（不等于地心径向）', () => {
    const vEccentric = vec3(2_000, 7_500, 0);
    const radial = pointingDirection('radial-out', r, vEccentric)!;
    expect(length(radial)).toBeCloseTo(1, 12);
    expect(radial.x * vEccentric.x + radial.y * vEccentric.y).toBeCloseTo(0, 9);
    expect(radial.z).toBeCloseTo(0, 12);
    expect(radial.x).toBeGreaterThan(0);
  });

  it('低空的顺行以相对地面的速度为准，高空以惯性速度为准', () => {
    // 与地面共转并以 100 m/s 竖直上升：惯性速度几乎水平，相对地面速度竖直
    const low = vec3(EARTH.RADIUS + 10_000, 0, 0);
    const vLow = vec3(100, EARTH.ROTATION_RATE * (EARTH.RADIUS + 10_000), 0);
    close(referenceVelocity(low, vLow), vec3(100, 0, 0), 1e-9);
    close(pointingDirection('prograde', low, vLow)!, UNIT_X, 1e-9);
    const high = vec3(EARTH.RADIUS + SURFACE_REFERENCE_ALTITUDE + 1, 0, 0);
    expect(referenceVelocity(high, vLow)).toBe(vLow);
  });

  it('方向没有定义时返回 null：速度为零、径向运动', () => {
    expect(pointingDirection('prograde', r, vec3(0, 0, 0))).toBeNull();
    expect(pointingDirection('normal', r, vec3(3_000, 0, 0))).toBeNull();
    expect(isAttitudeMode('prograde')).toBe(true);
    expect(isAttitudeMode('sideways')).toBe(false);
    expect(isAttitudeMode(undefined)).toBe(false);
  });
});

describe('自动指向：角速度指令', () => {
  it('转轴使头部沿最短路径转向目标，角速度不超过上限且没有滚转分量', () => {
    // 姿态为单位四元数：头部沿 +X。目标沿 +Y → 应绕 +Z 正转
    const command = steeringRateCommand(IDENTITY, UNIT_X, UNIT_Y, params);
    expect(command.z).toBeCloseTo(params.maxPitchYawRate, 12);
    expect(command.x).toBeCloseTo(0, 12);
    expect(command.y).toBeCloseTo(0, 12);
  });

  it('小角度误差时角速度与误差成正比', () => {
    const angle = 2 * DEG2RAD;
    const target = vec3(Math.cos(angle), Math.sin(angle), 0);
    const command = steeringRateCommand(IDENTITY, UNIT_X, target, params);
    expect(length(command)).toBeCloseTo(POINTING_GAIN * angle, 9);
  });

  it('已对准时指令为零；恰好反向时仍给出有限的转动指令', () => {
    expect(length(steeringRateCommand(IDENTITY, UNIT_X, UNIT_X, params))).toBe(0);
    const flip = steeringRateCommand(IDENTITY, UNIT_X, vec3(-1, 0, 0), params);
    expect(length(flip)).toBeCloseTo(params.maxPitchYawRate, 12);
    expect(flip.x).toBe(0);
  });

  it('前馈：目标方向以恒定角速度转动时没有稳态滞后；方向突变时不前馈', () => {
    // 目标绕 +Z 以 1.5°/s 转动，头部初始时与目标重合
    const spin = 1.5 * DEG2RAD;
    const dt = 0.02;
    const targetAt = (t: number) => vec3(Math.cos(spin * t), Math.sin(spin * t), 0);
    const lag = (useFeedForward: boolean): number => {
      let q = IDENTITY;
      let omega = vec3(0, 0, 0);
      let previous = targetAt(0);
      for (let i = 1; i <= 3000; i++) {
        const target = targetAt(i * dt);
        const feedForward = useFeedForward ? targetAngularVelocity(previous, target, dt, params.maxPitchYawRate) : undefined;
        omega = respondBodyRate(omega, steeringRateCommand(q, rotate(q, UNIT_X), target, params, feedForward), dt, params.timeConstant);
        q = integrateAttitude(q, omega, dt);
        previous = target;
      }
      const nose = rotate(q, UNIT_X);
      const target = targetAt(3000 * dt);
      return Math.acos(Math.min(1, nose.x * target.x + nose.y * target.y + nose.z * target.z)) / DEG2RAD;
    };
    // 纯比例控制：滞后 ≈ 角速度/增益 = 1.5°
    expect(lag(false)).toBeGreaterThan(1.2);
    // 加入前馈后只剩一阶响应与离散化带来的百分之几度
    expect(lag(true)).toBeLessThan(0.05);

    close(targetAngularVelocity(UNIT_X, vec3(Math.cos(0.001), Math.sin(0.001), 0), 0.02, 1), vec3(0, 0, Math.sin(0.001) / 0.02), 1e-12);
    // 方向在一步内突变 90°：视为不连续，不给前馈
    expect(length(targetAngularVelocity(UNIT_X, UNIT_Y, 0.02, params.maxPitchYawRate))).toBe(0);
    expect(length(targetAngularVelocity(UNIT_X, UNIT_Y, 0, params.maxPitchYawRate))).toBe(0);
  });

  it('闭环：从任意初始姿态收敛到目标方向且超调很小', () => {
    let q = fromAxisAngle(UNIT_Z, 0);
    let omega = vec3(0, 0, 0);
    const target = vec3(Math.cos(2.5), Math.sin(2.5) * 0.8, Math.sin(2.5) * 0.6);
    const dt = 0.02;
    let minDot = 1;
    let aligned = false;
    for (let i = 0; i < 4000; i++) {
      const nose = rotate(q, UNIT_X);
      const cosine = nose.x * target.x + nose.y * target.y + nose.z * target.z;
      if (cosine > 0.9999) aligned = true;
      if (aligned) minDot = Math.min(minDot, cosine);
      omega = respondBodyRate(omega, steeringRateCommand(q, nose, target, params), dt, params.timeConstant);
      q = integrateAttitude(q, omega, dt);
    }
    const nose = rotate(q, UNIT_X);
    expect(nose.x * target.x + nose.y * target.y + nose.z * target.z).toBeGreaterThan(1 - 1e-9);
    // 对准之后不再偏离超过 1°
    expect(Math.acos(minDot) / DEG2RAD).toBeLessThan(1);
  });
});
