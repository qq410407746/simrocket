import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import { bodyToFrame, enuBasisAt } from '../physics/frames/frames';
import { distance, dot, vec3 } from '../physics/math/vec3';
import { getVehicleOrDefault } from '@/data/vehicles';
import { Simulation } from './Simulation';
import { buildSnapshot } from './snapshot';
import {
  RENDER_DELAY,
  RenderClock,
  SnapshotBuffer,
  hasDiscontinuity,
  hermitePosition,
  hermiteVelocity,
  interpolateDebris,
  interpolateMotion,
} from './interpolation';
import type { SimSnapshot, SimulationConfig } from './types';

const config: SimulationConfig = {
  vehicle: getVehicleOrDefault('frontier-1'),
  site: launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral')),
  epochJulianDate: julianDateFromUnixMs(Date.UTC(2026, 2, 20, 15, 0, 0)),
};

/** 生成模拟时间 t 处的真实快照（dt 取 t 本身，一步到位）。 */
const snapshotAt = (t: number, seq = 0, simRate = 1): SimSnapshot => {
  const sim = new Simulation(config, t > 0 ? t : 1);
  if (t > 0) sim.step();
  return buildSnapshot(sim, { seq, timeWarp: 1, paused: false, simRate });
};

describe('Hermite 插值', () => {
  it('端点处还原位置与速度', () => {
    const p0 = vec3(1, 2, 3);
    const v0 = vec3(0.5, -1, 2);
    const p1 = vec3(4, 0, -1);
    const v1 = vec3(-2, 1, 0);
    expect(hermitePosition(p0, v0, p1, v1, 2, 0)).toEqual(p0);
    expect(hermitePosition(p0, v0, p1, v1, 2, 1)).toEqual(p1);
    const dv0 = hermiteVelocity(p0, v0, p1, v1, 2, 0);
    const dv1 = hermiteVelocity(p0, v0, p1, v1, 2, 1);
    expect(distance(dv0, v0)).toBeLessThan(1e-12);
    expect(distance(dv1, v1)).toBeLessThan(1e-12);
  });

  it('对匀加速运动（抛物线）精确', () => {
    const a = vec3(0, 0, -9.8);
    const at = (t: number) => vec3(10 * t, 0, 50 * t + 0.5 * a.z * t * t);
    const vel = (t: number) => vec3(10, 0, 50 + a.z * t);
    const p = hermitePosition(at(0), vel(0), at(4), vel(4), 4, 0.3);
    expect(distance(p, at(1.2))).toBeLessThan(1e-10);
  });
});

describe('快照插值', () => {
  it('发射台随地球自转：1000× 倍率、60 Hz 快照间隔下插值误差 < 1 mm', () => {
    const h = 1000 / 60; // 两快照相隔 16.7 s 模拟时间
    const a = snapshotAt(100);
    const b = snapshotAt(100 + h);
    for (const s of [0.1, 0.37, 0.5, 0.9]) {
      const t = 100 + h * s;
      const truth = snapshotAt(t).vehicle.body;
      const interp = interpolateMotion(a, b, t);
      expect(distance(interp.position, truth.position)).toBeLessThan(1e-3);
      expect(distance(interp.velocity, truth.velocity)).toBeLessThan(1e-6);
      // 姿态：插值后的头部方向仍沿当地天向
      const nose = bodyToFrame(interp.attitude, vec3(1, 0, 0));
      expect(dot(nose, enuBasisAt(truth.position).up)).toBeGreaterThan(1 - 1e-12);
    }
  });

  it('区间外按端点速度线性外推', () => {
    const a = snapshotAt(10);
    const b = snapshotAt(10.02);
    const ahead = interpolateMotion(a, b, 10.03);
    const truth = snapshotAt(10.03).vehicle.body.position;
    expect(distance(ahead.position, truth)).toBeLessThan(1e-3);
  });

  it('两快照时间相同时返回较新的状态（不产生 NaN）', () => {
    const a = snapshotAt(5);
    const m = interpolateMotion(a, a, 5);
    expect(m.position).toEqual(a.vehicle.body.position);
  });
});

describe('SnapshotBuffer', () => {
  it('空缓冲返回 null；单个快照可外推', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.sample(0)).toBeNull();
    expect(buffer.latest).toBeNull();
    buffer.push(snapshotAt(1, 0), 0);
    expect(buffer.sample(1)?.position).toEqual(snapshotAt(1).vehicle.body.position);
  });

  it('在正确的区间内插值', () => {
    const buffer = new SnapshotBuffer();
    [1, 2, 3, 4].forEach((t, i) => buffer.push(snapshotAt(t, i), i * 16));
    const m = buffer.sample(2.5);
    expect(m).not.toBeNull();
    expect(distance(m!.position, snapshotAt(2.5).vehicle.body.position)).toBeLessThan(1e-6);
    // 早于最旧快照：钳到最旧区间并外推
    expect(buffer.sample(0.5)).not.toBeNull();
  });

  it('模拟时间倒退（重新初始化）时丢弃旧快照', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snapshotAt(100, 50), 0);
    buffer.push(snapshotAt(101, 51), 16);
    buffer.push(snapshotAt(1, 0), 32);
    expect(buffer.latest?.simTime).toBe(1);
    expect(distance(buffer.sample(1)!.position, snapshotAt(1).vehicle.body.position)).toBeLessThan(1e-9);
  });

  it('缓冲长度有上限', () => {
    const buffer = new SnapshotBuffer();
    for (let i = 1; i <= 100; i++) buffer.push(snapshotAt(i, i), i);
    expect(buffer.sample(1)).not.toBeNull();
    expect(buffer.latest?.simTime).toBe(100);
    expect(buffer.latestArrival).toBe(100);
  });
});

describe('RenderClock', () => {
  it('稳态下以模拟速率推进，并落后最新快照一个固定延迟', () => {
    const clock = new RenderClock();
    let simTime = 0;
    let renderTime = 0;
    const frame = 1 / 60;
    for (let i = 0; i < 600; i++) {
      simTime += frame;
      renderTime = clock.update(frame, { ...snapshotAt(1), simTime, simRate: 1 }, 0);
    }
    expect(simTime - renderTime).toBeCloseTo(RENDER_DELAY, 3);
  });

  it('暂停（速率 0）时收敛到最新快照时间并停住', () => {
    const clock = new RenderClock();
    const snap = { ...snapshotAt(1), simTime: 42, simRate: 0, paused: true };
    let t = 0;
    for (let i = 0; i < 300; i++) t = clock.update(1 / 60, snap, i / 60);
    expect(t).toBeCloseTo(42, 6);
  });

  it('时间单调不减（正常推进时）', () => {
    const clock = new RenderClock();
    let simTime = 0;
    let prev = -Infinity;
    for (let i = 0; i < 300; i++) {
      // 模拟快照到达抖动：每 2 帧到达一次
      if (i % 2 === 0) simTime += 2 / 60;
      const t = clock.update(1 / 60, { ...snapshotAt(1), simTime, simRate: 1 }, i % 2 === 0 ? 0 : 1 / 60);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('误差过大时直接跳变（如切换时间倍率或重新初始化）', () => {
    const clock = new RenderClock();
    clock.update(1 / 60, { ...snapshotAt(1), simTime: 10, simRate: 1 }, 0);
    const t = clock.update(1 / 60, { ...snapshotAt(1), simTime: 5000, simRate: 1 }, 0);
    expect(t).toBeCloseTo(5000 - RENDER_DELAY, 6);
  });
});

describe('分级前后的渲染采样', () => {
  /** 飞行 40 s 后分级，返回分级前后相邻的两个快照。 */
  const stagingPair = () => {
    const sim = new Simulation(config);
    sim.stage();
    for (let i = 0; i < 2000; i++) sim.step();
    const before = buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 });
    sim.stage();
    sim.step();
    const after = buildSnapshot(sim, { seq: 1, timeWarp: 1, paused: false, simRate: 1 });
    return { before, after };
  };

  it('识别分级造成的不连续', () => {
    const { before, after } = stagingPair();
    expect(hasDiscontinuity(before, after)).toBe(true);
    expect(hasDiscontinuity(before, before)).toBe(false);
    // 质心在箭体内上移了几十米：两个快照的位置差远大于一个步长内的飞行距离
    const jump = distance(after.vehicle.body.position, before.vehicle.body.position);
    expect(jump).toBeGreaterThan(20);
  });

  it('不跨越分级做插值：区间内的位置始终与后一个快照的构型一致', () => {
    const { before, after } = stagingPair();
    const t = (before.simTime + after.simTime) / 2;
    const m = interpolateMotion(before, after, t);
    const expected = {
      x: after.vehicle.body.position.x + after.vehicle.body.velocity.x * (t - after.simTime),
      y: after.vehicle.body.position.y + after.vehicle.body.velocity.y * (t - after.simTime),
      z: after.vehicle.body.position.z + after.vehicle.body.velocity.z * (t - after.simTime),
    };
    expect(distance(m.position, expected)).toBeLessThan(1e-9);
  });

  it('渲染采样返回一致的离散状态，并把新出现的分离体对齐到同一时刻', () => {
    const { before, after } = stagingPair();
    const buffer = new SnapshotBuffer();
    buffer.push(before, 0);
    buffer.push(after, 16);
    const t = (before.simTime + after.simTime) / 2;
    const sample = buffer.sampleForRender(t)!;
    expect(sample.state).toBe(after);
    expect(sample.debris).toHaveLength(1);
    // 分离体与飞行器的间距应等于后一个快照中的间距（两者按各自速度反推，相对速度只有 1.5 m/s）
    const gapAfter = distance(after.vehicle.body.position, after.debris[0]!.position);
    const gapSample = distance(sample.motion.position, sample.debris[0]!.position);
    expect(Math.abs(gapSample - gapAfter)).toBeLessThan(0.05);
  });

  it('已存在的分离体在快照之间做 Hermite 插值', () => {
    const sim = new Simulation(config);
    sim.stage();
    for (let i = 0; i < 2000; i++) sim.step();
    sim.stage();
    for (let i = 0; i < 50; i++) sim.step();
    const a = buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 });
    sim.step();
    const mid = buildSnapshot(sim, { seq: 1, timeWarp: 1, paused: false, simRate: 1 });
    sim.step();
    const b = buildSnapshot(sim, { seq: 2, timeWarp: 1, paused: false, simRate: 1 });
    const [d] = interpolateDebris(a, b, mid.simTime);
    expect(distance(d!.position, mid.debris[0]!.position)).toBeLessThan(1e-3);
  });
});
