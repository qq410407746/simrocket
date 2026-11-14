import { describe, expect, it } from 'vitest';
import { EARTH } from '../constants';
import { type AccelerationFn, type MutableVec3, Rk4Integrator } from './rk4';

const twoBody: AccelerationFn = (_t, r, _v, out) => {
  const d = Math.hypot(r.x, r.y, r.z);
  const k = -EARTH.MU / (d * d * d);
  out.x = r.x * k;
  out.y = r.y * k;
  out.z = r.z * k;
};

const energy = (r: MutableVec3, v: MutableVec3): number =>
  (v.x * v.x + v.y * v.y + v.z * v.z) / 2 - EARTH.MU / Math.hypot(r.x, r.y, r.z);

const angularMomentum = (r: MutableVec3, v: MutableVec3): number =>
  Math.hypot(r.y * v.z - r.z * v.y, r.z * v.x - r.x * v.z, r.x * v.y - r.y * v.x);

/** 圆轨道初始条件（倾角 51.6°）。 */
const circularOrbit = (altitude: number) => {
  const radius = EARTH.RADIUS + altitude;
  const speed = Math.sqrt(EARTH.MU / radius);
  const inc = (51.6 * Math.PI) / 180;
  return {
    radius,
    speed,
    period: 2 * Math.PI * Math.sqrt(radius ** 3 / EARTH.MU),
    r: { x: radius, y: 0, z: 0 },
    v: { x: 0, y: speed * Math.cos(inc), z: speed * Math.sin(inc) },
  };
};

const propagate = (r: MutableVec3, v: MutableVec3, duration: number, dt: number, accel: AccelerationFn): void => {
  const rk4 = new Rk4Integrator();
  const steps = Math.round(duration / dt);
  for (let i = 0; i < steps; i++) rk4.step(r, v, i * dt, dt, accel);
};

describe('RK4：解析可验证的运动', () => {
  it('匀加速运动精确（多项式次数 ≤ 4 时 RK4 无截断误差）', () => {
    const r = { x: 0, y: 0, z: 100 };
    const v = { x: 30, y: 0, z: 50 };
    propagate(r, v, 4, 0.5, (_t, _r, _v, out) => {
      out.x = 0;
      out.y = 0;
      out.z = -9.8;
    });
    expect(r.x).toBeCloseTo(120, 10);
    expect(r.z).toBeCloseTo(100 + 50 * 4 - 0.5 * 9.8 * 16, 10);
    expect(v.z).toBeCloseTo(50 - 9.8 * 4, 10);
  });

  it('随时间线性变化的加速度精确（验证时间参数传递正确）', () => {
    // a = 6t → v = 3t², r = t³
    const r = { x: 0, y: 0, z: 0 };
    const v = { x: 0, y: 0, z: 0 };
    propagate(r, v, 2, 0.25, (t, _r, _v, out) => {
      out.x = 6 * t;
      out.y = 0;
      out.z = 0;
    });
    expect(v.x).toBeCloseTo(12, 10);
    expect(r.x).toBeCloseTo(8, 10);
  });

  it('线性阻力下的速度衰减 v = v₀·e^(−kt)（验证速度依赖项）', () => {
    const k = 0.7;
    const r = { x: 0, y: 0, z: 0 };
    const v = { x: 100, y: 0, z: 0 };
    propagate(r, v, 3, 0.01, (_t, _r, vel, out) => {
      out.x = -k * vel.x;
      out.y = -k * vel.y;
      out.z = -k * vel.z;
    });
    expect(v.x).toBeCloseTo(100 * Math.exp(-k * 3), 8);
    expect(r.x).toBeCloseTo((100 / k) * (1 - Math.exp(-k * 3)), 7);
  });

  it('简谐振动：一个周期后回到初始状态', () => {
    const omega = 2;
    const r = { x: 1, y: 0, z: 0 };
    const v = { x: 0, y: 0, z: 0 };
    propagate(r, v, Math.PI, Math.PI / 2000, (_t, pos, _v, out) => {
      out.x = -omega * omega * pos.x;
      out.y = 0;
      out.z = 0;
    });
    expect(r.x).toBeCloseTo(1, 9);
    expect(v.x).toBeCloseTo(0, 8);
  });
});

describe('RK4：二体轨道', () => {
  it('圆轨道：轨道速度 √(μ/r)，一个周期后回到出发点', () => {
    const orbit = circularOrbit(400_000);
    expect(orbit.speed).toBeCloseTo(7672.6, 0);
    expect(orbit.period / 60).toBeCloseTo(92.4, 1);
    const steps = 20_000;
    const dt = orbit.period / steps;
    const rk4 = new Rk4Integrator();
    for (let i = 0; i < steps; i++) rk4.step(orbit.r, orbit.v, i * dt, dt, twoBody);
    expect(Math.hypot(orbit.r.x - orbit.radius, orbit.r.y, orbit.r.z)).toBeLessThan(1e-3);
    expect(Math.hypot(orbit.r.x, orbit.r.y, orbit.r.z)).toBeCloseTo(orbit.radius, 4);
  });

  it('游戏步长 0.02 s 下：近地轨道一圈的能量与角动量相对漂移 < 10⁻¹¹', () => {
    const orbit = circularOrbit(200_000);
    const e0 = energy(orbit.r, orbit.v);
    const h0 = angularMomentum(orbit.r, orbit.v);
    propagate(orbit.r, orbit.v, orbit.period, 0.02, twoBody);
    expect(Math.abs(energy(orbit.r, orbit.v) - e0) / Math.abs(e0)).toBeLessThan(1e-11);
    expect(Math.abs(angularMomentum(orbit.r, orbit.v) - h0) / h0).toBeLessThan(1e-11);
  });

  it('大偏心率椭圆轨道（GTO）：能量与角动量守恒，远地点高度正确', () => {
    const rp = EARTH.RADIUS + 200_000;
    const ra = 42_164_000;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(EARTH.MU * (2 / rp - 1 / a));
    const r = { x: rp, y: 0, z: 0 };
    const v = { x: 0, y: vp, z: 0 };
    const e0 = energy(r, v);
    const h0 = angularMomentum(r, v);
    const halfPeriod = Math.PI * Math.sqrt(a ** 3 / EARTH.MU);
    propagate(r, v, halfPeriod, 1, twoBody);
    expect(Math.abs(energy(r, v) - e0) / Math.abs(e0)).toBeLessThan(1e-9);
    expect(Math.abs(angularMomentum(r, v) - h0) / h0).toBeLessThan(1e-9);
    // 半个周期后到达远地点
    expect(Math.abs(Math.hypot(r.x, r.y, r.z) - ra)).toBeLessThan(50);
  });

  it('收敛阶：步长减半，位置误差缩小约 16 倍（四阶）', () => {
    const errorFor = (dt: number): number => {
      const orbit = circularOrbit(300_000);
      const duration = 1200;
      propagate(orbit.r, orbit.v, duration, dt, twoBody);
      // 圆轨道解析解：在轨道面内转过 θ = v·t/r
      const theta = (orbit.speed * duration) / orbit.radius;
      const inc = (51.6 * Math.PI) / 180;
      const exact = {
        x: orbit.radius * Math.cos(theta),
        y: orbit.radius * Math.sin(theta) * Math.cos(inc),
        z: orbit.radius * Math.sin(theta) * Math.sin(inc),
      };
      return Math.hypot(orbit.r.x - exact.x, orbit.r.y - exact.y, orbit.r.z - exact.z);
    };
    const e40 = errorFor(40);
    const e20 = errorFor(20);
    const e10 = errorFor(10);
    expect(e40 / e20).toBeGreaterThan(12);
    expect(e40 / e20).toBeLessThan(20);
    expect(e20 / e10).toBeGreaterThan(12);
    expect(e20 / e10).toBeLessThan(20);
  });

  it('长期稳定性：0.02 s 步长连续 10 圈后轨道半径漂移 < 1 mm', () => {
    const orbit = circularOrbit(250_000);
    propagate(orbit.r, orbit.v, orbit.period * 10, 0.02, twoBody);
    expect(Math.abs(Math.hypot(orbit.r.x, orbit.r.y, orbit.r.z) - orbit.radius)).toBeLessThan(1e-3);
  });
});
