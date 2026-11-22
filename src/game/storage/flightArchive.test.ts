import { describe, expect, it } from 'vitest';
import { parseFlightArchive, sampleArchiveAt, type FlightArchive } from './flightArchive';
const archive: FlightArchive = {
  version: 1, id: 'test-flight', vehicleName: '测试火箭', savedAt: '2026-11-17T00:00:00Z',
  samples: [
    { time: 0, altitude: 0, speed: 0, gLoad: 1, dynamicPressure: 0, heatFlux: 0 },
    { time: 10, altitude: 100, speed: 20, gLoad: 2, dynamicPressure: 200, heatFlux: 500 },
  ], events: [{ kind: 'liftoff', time: 0, stageIndex: 0 }],
};
describe('遥测档案边界', () => {
  it('读回校验并剔除额外字段，保留事件与采样', () => {
    expect(parseFlightArchive({ ...archive, extra: '无关' })).toEqual(archive);
    expect(parseFlightArchive(archive)?.samples).not.toBe(archive.samples);
  });
  it.each([null, {}, { ...archive, version: 2 }, { ...archive, savedAt: '无效' },
    { ...archive, samples: [{ ...archive.samples[0], altitude: Infinity }] },
    { ...archive, samples: [{ ...archive.samples[0], speed: -1 }] },
    { ...archive, samples: [...archive.samples].reverse() },
    { ...archive, samples: [archive.samples[0], archive.samples[0]] },
    { ...archive, samples: Array(721).fill(archive.samples[0]) },
    { ...archive, events: [{ kind: 'fake', time: 0, stageIndex: -1 }] },
    { ...archive, events: [{ kind: 'liftoff', time: NaN, stageIndex: 0 }] },
    { ...archive, events: [{ kind: 'liftoff', time: 0, stageIndex: 1.5 }] },
    { ...archive, events: Array(201).fill(archive.events[0]) },
  ])('拒绝损坏存档 %#', (raw) => expect(parseFlightArchive(raw)).toBeNull());
  it('回看线性估读且不外推；空记录和非法时刻不产生读数', () => {
    expect(sampleArchiveAt(archive.samples, 5)).toMatchObject({ time: 5, altitude: 50, speed: 10, gLoad: 1.5 });
    expect(sampleArchiveAt(archive.samples, -100)).toEqual(archive.samples[0]);
    expect(sampleArchiveAt(archive.samples, 100)).toEqual(archive.samples[1]);
    expect(sampleArchiveAt([], 0)).toBeNull();
    expect(sampleArchiveAt(archive.samples, Infinity)).toBeNull();
  });
});
