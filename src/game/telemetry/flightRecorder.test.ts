import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { Simulation } from '../simulation/Simulation';
import { buildSnapshot } from '../simulation/snapshot';
import { createFlightConfig } from '../simulation/startConditions';
import { type FlightSample, FlightRecorder, sampleFlight } from './flightRecorder';
import { deriveTelemetry } from './telemetry';

const sample = (time: number, altitude = time * 100): FlightSample => ({ time, altitude, speed: time, gLoad: 1, dynamicPressure: 0, heatFlux: 0 });

describe('飞行记录仪', () => {
  it('按采样间隔记录：间隔不足、时间倒退、含无效数值的点被忽略', () => {
    const recorder = new FlightRecorder(100, 1);
    expect(recorder.record(sample(0))).toBe(true);
    expect(recorder.record(sample(0.5))).toBe(false);
    expect(recorder.record(sample(1))).toBe(true);
    expect(recorder.record(sample(0.2))).toBe(false);
    expect(recorder.record({ ...sample(5), gLoad: Number.NaN })).toBe(false);
    expect(recorder.record({ ...sample(6), altitude: Infinity })).toBe(false);
    expect(recorder.record(null)).toBe(false);
    expect(recorder.samples.map((s) => s.time)).toEqual([0, 1]);
    expect(recorder.interval).toBe(1);
  });

  it('记满后隔一个丢一个、间隔加倍：点数始终不超过容量，首点保留，时间仍然递增', () => {
    const recorder = new FlightRecorder(8, 1);
    for (let t = 0; t <= 100; t++) recorder.record(sample(t));
    expect(recorder.samples.length).toBeLessThanOrEqual(8);
    expect(recorder.samples.length).toBeGreaterThanOrEqual(4);
    expect(recorder.samples[0]?.time).toBe(0);
    const times = recorder.samples.map((s) => s.time);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1] as number);
    // 100 s 的飞行、容量 8：间隔已经加倍到 16 s，相邻点至少相隔一个当前间隔的一半
    expect(recorder.interval).toBe(16);
    expect(times[times.length - 1]).toBeGreaterThan(80);
    // 丢点不改变保留下来的数据
    for (const s of recorder.samples) expect(s.altitude).toBe(s.time * 100);
  });

  it('几小时的飞行也能被完整覆盖', () => {
    const recorder = new FlightRecorder(720, 1);
    for (let t = 0; t <= 20_000; t += 100) recorder.record(sample(t));
    expect(recorder.samples.length).toBe(201);
    for (let t = 20_100; t <= 200_000; t += 100) recorder.record(sample(t));
    expect(recorder.samples.length).toBeLessThanOrEqual(720);
    expect(recorder.samples[0]?.time).toBe(0);
    expect(recorder.samples[recorder.samples.length - 1]?.time).toBeGreaterThan(190_000);
  });

  it('事件按顺序保留，数量有上限；clear 恢复初始状态', () => {
    const recorder = new FlightRecorder(8, 2);
    recorder.addEvents([]);
    recorder.addEvents([
      { kind: 'ignition', time: 0, stageIndex: 0 },
      { kind: 'liftoff', time: 0.5, stageIndex: 0 },
    ]);
    recorder.addEvents([{ kind: 'separation', time: 160, stageIndex: 0 }]);
    expect(recorder.events.map((e) => e.kind)).toEqual(['ignition', 'liftoff', 'separation']);
    for (let i = 0; i < 300; i++) recorder.addEvents([{ kind: 'depleted', time: 200 + i, stageIndex: 1 }]);
    expect(recorder.events.length).toBe(200);
    expect(recorder.events[199]?.time).toBe(499);
    for (let t = 0; t < 60; t += 2) recorder.record(sample(t));
    expect(recorder.interval).toBeGreaterThan(2);
    recorder.clear();
    expect(recorder.samples).toHaveLength(0);
    expect(recorder.events).toHaveLength(0);
    expect(recorder.interval).toBe(2);
  });

  it('参数无效时抛出错误', () => {
    expect(() => new FlightRecorder(2, 1)).toThrow();
    expect(() => new FlightRecorder(100, 0)).toThrow();
  });

  it('由遥测取样：起飞前不记录；起飞后给出任务时间、高度、速度、过载与最大热流', () => {
    const vehicle = getVehicleOrDefault('frontier-1');
    const config = createFlightConfig(vehicle, launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral')));
    const sim = new Simulation(config);
    const telemetry = () => deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    expect(sampleFlight(telemetry())).toBeNull();
    sim.stage();
    for (let i = 0; i < 1_500; i++) sim.step();
    const t = telemetry();
    const s = sampleFlight(t)!;
    expect(s.time).toBeCloseTo(t.missionTime as number, 12);
    expect(s.altitude).toBe(t.altitude);
    expect(s.altitude).toBeGreaterThan(500);
    expect(s.speed).toBe(t.surfaceSpeed);
    expect(s.gLoad).toBeGreaterThan(1.3);
    expect(s.dynamicPressure).toBeGreaterThan(1_000);
    expect(s.heatFlux).toBeGreaterThanOrEqual(0);
    expect(s.heatFlux).toBe(Math.max(0, ...t.thermal.map((z) => z.heatFlux)));
  });
});
