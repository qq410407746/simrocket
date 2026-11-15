import { describe, expect, it } from 'vitest';
import type { ThermalZoneTelemetry } from '../vehicles/types';
import { criticalZoneIndex } from './telemetry';
import { ThermalHistory, sampleThermal } from './thermalHistory';

const zone = (overrides: Partial<ThermalZoneTelemetry>): ThermalZoneTelemetry => ({
  zone: 'nose',
  owner: 'payload',
  material: '测试',
  surfaceTemperature: 300,
  interiorTemperature: 290,
  surfaceLimit: 1_500,
  interiorLimit: 480,
  heatFlux: 0,
  heatLoad: 0,
  ablative: false,
  ablatorFraction: 1,
  margin: 1,
  failure: null,
  ...overrides,
});

describe('热历程采样', () => {
  it('采样点取各热区的最大值', () => {
    const sample = sampleThermal(12, [
      zone({ heatFlux: 5_000, surfaceTemperature: 400, interiorTemperature: 300 }),
      zone({ zone: 'side', heatFlux: -200, surfaceTemperature: 320, interiorTemperature: 350 }),
      zone({ zone: 'base', heatFlux: 400_000, surfaceTemperature: 1_500, interiorTemperature: 310 }),
    ]);
    expect(sample).toEqual({ time: 12, heatFlux: 400_000, surfaceTemperature: 1_500, interiorTemperature: 350 });
    expect(sampleThermal(0, [])).toEqual({ time: 0, heatFlux: 0, surfaceTemperature: 0, interiorTemperature: 0 });
  });

  it('按最小间隔记录，间隔内的采样被忽略', () => {
    const history = new ThermalHistory(10, 1);
    expect(history.latest).toBeNull();
    expect(history.record({ time: 0, heatFlux: 1, surfaceTemperature: 300, interiorTemperature: 300 })).toBe(true);
    expect(history.record({ time: 0.5, heatFlux: 2, surfaceTemperature: 300, interiorTemperature: 300 })).toBe(false);
    expect(history.record({ time: 1, heatFlux: 3, surfaceTemperature: 300, interiorTemperature: 300 })).toBe(true);
    expect(history.length).toBe(2);
    expect(history.latest?.heatFlux).toBe(3);
    expect(history.at(0)?.heatFlux).toBe(1);
    expect(history.at(5)).toBeUndefined();
  });

  it('环形缓冲：超过容量后丢弃最旧的点，顺序保持不变', () => {
    const history = new ThermalHistory(5, 1);
    for (let t = 0; t < 12; t++) history.record({ time: t, heatFlux: t * 10, surfaceTemperature: 300 + t, interiorTemperature: 290 });
    expect(history.length).toBe(5);
    expect(history.toArray().map((s) => s.time)).toEqual([7, 8, 9, 10, 11]);
    expect(history.at(0)?.time).toBe(7);
    expect(history.latest?.time).toBe(11);
  });

  it('时间倒退（重新开始飞行）时清空；无效数值被拒绝', () => {
    const history = new ThermalHistory(5, 1);
    history.record({ time: 100, heatFlux: 1, surfaceTemperature: 300, interiorTemperature: 300 });
    history.record({ time: 101, heatFlux: 1, surfaceTemperature: 300, interiorTemperature: 300 });
    expect(history.record({ time: 0, heatFlux: 9, surfaceTemperature: 288, interiorTemperature: 288 })).toBe(true);
    expect(history.toArray()).toHaveLength(1);
    expect(history.record({ time: NaN, heatFlux: 1, surfaceTemperature: 300, interiorTemperature: 300 })).toBe(false);
    expect(history.record({ time: 5, heatFlux: Infinity, surfaceTemperature: 300, interiorTemperature: 300 })).toBe(false);
    history.clear();
    expect(history.length).toBe(0);
    expect(history.latest).toBeNull();
  });
});

describe('最危险的热区', () => {
  it('热裕度最小的那个；裕度相同时取热流最大的', () => {
    expect(criticalZoneIndex([zone({ margin: 0.9 }), zone({ margin: 0.3 }), zone({ margin: 0.6 })])).toBe(1);
    expect(criticalZoneIndex([zone({ margin: 1, heatFlux: 10 }), zone({ margin: 1, heatFlux: 500 }), zone({ margin: 1, heatFlux: 20 })])).toBe(1);
    expect(criticalZoneIndex([])).toBe(0);
  });
});
