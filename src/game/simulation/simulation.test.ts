import { describe, expect, it } from 'vitest';
import { launchSiteGeodetic, getLaunchSiteOrDefault } from '@/data/launchSites';
import { EARTH, SIDEREAL_DAY, STANDARD_GRAVITY } from '../physics/constants';
import { julianDateFromUnixMs } from '../physics/ephemeris/time';
import {
  airRelativeVelocityEci,
  altitudeOf,
  bodyToFrame,
  ecefToGeodetic,
  eciToEcef,
  enuBasisAt,
} from '../physics/frames/frames';
import { distance, dot, length, vec3 } from '../physics/math/vec3';
import { deriveTelemetry } from '../telemetry/telemetry';
import { liftoffMass } from '../vehicles/analysis';
import { getVehicleOrDefault } from '@/data/vehicles';
import { FixedStepClock, MAX_WALL_DT } from './FixedStepClock';
import { Simulation, isValidVehicleState } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { buildSnapshot } from './snapshot';
import { PHYSICS_DT, type SimEvent, type SimSnapshot, type SimulationConfig } from './types';

const site = getLaunchSiteOrDefault('cape-canaveral');
const config: SimulationConfig = {
  vehicle: getVehicleOrDefault('frontier-1'),
  site: launchSiteGeodetic(site),
  epochJulianDate: julianDateFromUnixMs(Date.UTC(2026, 2, 20, 15, 0, 0)),
};

describe('FixedStepClock', () => {
  it('步数只取决于累计时间，与调用划分方式无关（确定性）', () => {
    const coarse = new FixedStepClock(0.02, 1e9);
    const fine = new FixedStepClock(0.02, 1e9);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 100; i++) a += coarse.advance(0.1, 1).steps;
    for (let i = 0; i < 1000; i++) b += fine.advance(0.01, 1).steps;
    // 两种划分都累计 10 s；浮点舍入最多造成 1 步的时刻差异
    expect(Math.abs(a - 500)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 500)).toBeLessThanOrEqual(1);
  });

  it('时间倍率按比例增加步数', () => {
    const clock = new FixedStepClock(0.02, 1e9);
    expect(clock.advance(0.1, 100).steps).toBe(500);
  });

  it('不足一步的时间被保留到下一次', () => {
    const clock = new FixedStepClock(0.02, 1e9);
    expect(clock.advance(0.015, 1).steps).toBe(0);
    expect(clock.advance(0.015, 1).steps).toBe(1);
  });

  it('过载保护：限制单次步数并如实上报丢弃量', () => {
    const clock = new FixedStepClock(0.02, 100);
    const result = clock.advance(0.1, 1000);
    expect(result.steps).toBe(100);
    expect(result.requested).toBeCloseTo(100, 9);
    expect(result.dropped).toBeCloseTo(100 - 100 * 0.02, 6);
    // 丢弃后不会在下一次补算
    expect(clock.advance(1e-6, 1).steps).toBe(0);
  });

  it('过长的墙钟间隔被截断（标签页挂起后恢复）', () => {
    const clock = new FixedStepClock(0.02, 1e9);
    expect(clock.advance(60, 1).requested).toBeCloseTo(MAX_WALL_DT, 12);
  });

  it('非正的 dt / 倍率不推进；非法构造参数抛出错误', () => {
    const clock = new FixedStepClock(0.02, 10);
    expect(clock.advance(-1, 1).steps).toBe(0);
    expect(clock.advance(0.1, 0).steps).toBe(0);
    expect(clock.advance(NaN, 1).steps).toBe(0);
    expect(() => new FixedStepClock(0, 10)).toThrow();
    expect(() => new FixedStepClock(0.02, 0)).toThrow();
  });
});

describe('Simulation：发射台待命状态', () => {
  it('模拟时间 = 步数 × 步长（无累加漂移）', () => {
    const sim = new Simulation(config);
    for (let i = 0; i < 12_345; i++) sim.step();
    expect(sim.time).toBe(12_345 * PHYSICS_DT);
  });

  it('底端坐落在地面，质心高度等于质心到底端的距离', () => {
    const state = new Simulation(config).getVehicleState();
    expect(altitudeOf(state.body.position)).toBeCloseTo(state.centerOfMassHeight, 6);
    expect(state.centerOfMassHeight).toBeGreaterThan(5);
    expect(state.mass).toBe(liftoffMass(config.vehicle));
  });

  it('位于发射场经纬度，且随时间保持不变', () => {
    const sim = new Simulation(config);
    for (const steps of [0, 5_000, 500_000]) {
      for (let i = 0; i < steps; i++) sim.step();
      const g = ecefToGeodetic(eciToEcef(sim.getVehicleState().body.position, sim.earthRotationAngle));
      expect(g.latitude).toBeCloseTo(config.site.latitude, 10);
      expect(g.longitude).toBeCloseTo(config.site.longitude, 10);
    }
  });

  it('惯性速度 = ω·R·cos(纬度)，方向朝东；相对地面速度为零', () => {
    const state = new Simulation(config).getVehicleState();
    const { position, velocity } = state.body;
    const expected = EARTH.ROTATION_RATE * length(position) * Math.cos(config.site.latitude);
    expect(length(velocity)).toBeCloseTo(expected, 6);
    expect(length(velocity)).toBeGreaterThan(400);
    expect(length(velocity)).toBeLessThan(415);
    expect(dot(velocity, enuBasisAt(position).east)).toBeCloseTo(expected, 6);
    expect(length(airRelativeVelocityEci(position, velocity))).toBeLessThan(1e-9);
  });

  it('一个恒星日后回到同一惯性位置', () => {
    const steps = 1000;
    const sim = new Simulation(config, SIDEREAL_DAY / steps);
    const start = sim.getVehicleState().body.position;
    for (let i = 0; i < steps / 2; i++) sim.step();
    // 半个恒星日后位于地轴另一侧（相距约 2·R·cos φ）
    expect(distance(sim.getVehicleState().body.position, start)).toBeGreaterThan(1.1e7);
    for (let i = 0; i < steps / 2; i++) sim.step();
    expect(distance(sim.getVehicleState().body.position, start)).toBeLessThan(1e-4);
  });

  it('箭体竖直：机体 +X 沿当地天向', () => {
    const state = new Simulation(config).getVehicleState();
    const nose = bodyToFrame(state.body.attitude, vec3(1, 0, 0));
    expect(dot(nose, enuBasisAt(state.body.position).up)).toBeCloseTo(1, 12);
  });

  it('角速度大小等于地球自转角速度', () => {
    const state = new Simulation(config).getVehicleState();
    expect(length(state.body.angularVelocity)).toBeCloseTo(EARTH.ROTATION_RATE, 15);
  });

  it('比力（过载）略小于 1 g：引力减去自转离心效应', () => {
    const state = new Simulation(config).getVehicleState();
    const g = EARTH.MU / length(state.body.position) ** 2;
    const centrifugalVertical = EARTH.ROTATION_RATE ** 2 * length(state.body.position) * Math.cos(config.site.latitude) ** 2;
    // 沿天向的支撑加速度 = g − ω²R cos²φ
    const up = enuBasisAt(state.body.position).up;
    expect(dot(state.specificForce, up)).toBeCloseTo(g - centrifugalVertical, 9);
    const gLoad = length(state.specificForce) / STANDARD_GRAVITY;
    expect(gLoad).toBeGreaterThan(0.99);
    expect(gLoad).toBeLessThan(1.005);
  });

  it('状态始终有效；检测器能识别 NaN', () => {
    const sim = new Simulation(config);
    const state = sim.getVehicleState();
    expect(isValidVehicleState(state)).toBe(true);
    expect(isValidVehicleState({ ...state, mass: NaN })).toBe(false);
    expect(isValidVehicleState({ ...state, body: { ...state.body, position: vec3(0, Infinity, 0) } })).toBe(false);
  });

  it('拒绝无效配置', () => {
    expect(() => new Simulation({ ...config, epochJulianDate: NaN })).toThrow();
    expect(() => new Simulation(config, 0)).toThrow();
    expect(() => new Simulation({ ...config, vehicle: { ...config.vehicle, stages: [] } })).toThrow();
  });

  it('不同发射场纬度给出不同的自转线速度', () => {
    const speedAt = (id: string) => {
      const s = new Simulation({ ...config, site: launchSiteGeodetic(getLaunchSiteOrDefault(id)) });
      return length(s.getVehicleState().body.velocity);
    };
    expect(speedAt('kourou')).toBeGreaterThan(speedAt('cape-canaveral'));
    expect(speedAt('cape-canaveral')).toBeGreaterThan(speedAt('baikonur'));
  });
});

describe('遥测推导', () => {
  it('发射台上的读数', () => {
    const sim = new Simulation(config);
    const snapshot: SimSnapshot = buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 });
    const t = deriveTelemetry(snapshot, config);
    expect(t.altitude).toBeCloseTo(snapshot.vehicle.centerOfMassHeight, 6);
    expect(t.surfaceSpeed).toBeLessThan(1e-9);
    expect(t.verticalSpeed).toBeCloseTo(0, 9);
    expect(t.horizontalSpeed).toBeLessThan(1e-4);
    expect(t.inertialSpeed).toBeGreaterThan(400);
    expect(t.latitude).toBeCloseTo(config.site.latitude, 10);
    expect(t.longitude).toBeCloseTo(config.site.longitude, 10);
    expect(t.localGravity).toBeCloseTo(9.82, 2);
    expect(t.gLoad).toBeCloseTo(1, 2);
    expect(t.pitch).toBeCloseTo(Math.PI / 2, 9);
    expect(t.heading).toBeNull();
    expect(t.stagePropellant).toEqual([400_000, 95_000]);
    expect(t.ignited).toBe(false);
    expect(t.thrust).toBe(0);
    expect(t.missionTime).toBeNull();
    expect(t.downrange).toBeLessThan(1e-6);
    expect(t.remainingDeltaV).toBeCloseTo(12_175, -1);
    expect(t.stageAttached).toEqual([true, true]);
  });
});

describe('SimulationHost', () => {
  const setup = () => {
    const events: SimEvent[] = [];
    let now = 0;
    const host = new SimulationHost(
      (e) => events.push(e),
      () => now,
    );
    const advance = (ms: number, tickMs = 4) => {
      const end = now + ms;
      while (now < end) {
        now += tickMs;
        host.tick();
      }
    };
    const lastSnapshot = (): SimSnapshot => {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.type === 'snapshot') return e.snapshot;
      }
      throw new Error('没有快照');
    };
    return { host, events, advance, lastSnapshot };
  };

  it('init 后发出 ready 与初始快照', () => {
    const { host, events } = setup();
    host.handle({ type: 'init', config });
    expect(events[0]?.type).toBe('ready');
    expect(events[1]?.type).toBe('snapshot');
  });

  it('1× 倍率下模拟时间与墙钟时间同步推进', () => {
    const { host, advance, lastSnapshot } = setup();
    host.handle({ type: 'init', config });
    advance(2000);
    expect(lastSnapshot().simTime).toBeGreaterThan(1.9);
    expect(lastSnapshot().simTime).toBeLessThanOrEqual(2.0 + 1e-9);
    expect(lastSnapshot().simRate).toBeCloseTo(1, 6);
  });

  it('1000× 倍率能跟上（实际速率 ≈ 指令倍率）', () => {
    const { host, advance, lastSnapshot } = setup();
    host.handle({ type: 'init', config });
    host.handle({ type: 'setTimeWarp', warp: 1000 });
    advance(1000);
    expect(lastSnapshot().simTime).toBeGreaterThan(950);
    expect(lastSnapshot().simTime).toBeLessThanOrEqual(1000 + 1e-6);
    expect(lastSnapshot().simRate).toBeCloseTo(1000, 3);
  });

  it('暂停后时间停止，恢复后继续', () => {
    const { host, advance, lastSnapshot } = setup();
    host.handle({ type: 'init', config });
    advance(500);
    host.handle({ type: 'setPaused', paused: true });
    const frozen = lastSnapshot().simTime;
    advance(1000);
    expect(lastSnapshot().simTime).toBe(frozen);
    expect(lastSnapshot().paused).toBe(true);
    expect(lastSnapshot().simRate).toBe(0);
    host.handle({ type: 'setPaused', paused: false });
    advance(500);
    expect(lastSnapshot().simTime).toBeGreaterThan(frozen + 0.4);
  });

  it('快照以约 60 Hz 发布，序号递增', () => {
    const { host, events, advance } = setup();
    host.handle({ type: 'init', config });
    advance(1000);
    const snaps = events.filter((e) => e.type === 'snapshot').map((e) => (e.type === 'snapshot' ? e.snapshot : null)!);
    expect(snaps.length).toBeGreaterThan(45);
    expect(snaps.length).toBeLessThan(70);
    for (let i = 1; i < snaps.length; i++) expect(snaps[i]!.seq).toBe(snaps[i - 1]!.seq + 1);
  });

  it('非法指令产生 error 事件并停止模拟，而不是抛出异常', () => {
    const { host, events, advance } = setup();
    host.handle({ type: 'init', config });
    // @ts-expect-error 故意传入不支持的倍率
    host.handle({ type: 'setTimeWarp', warp: 7 });
    expect(events.some((e) => e.type === 'error')).toBe(true);
    const count = events.length;
    advance(200);
    expect(events.length).toBe(count);
  });

  it('未初始化时 tick 不做任何事', () => {
    const { events, advance } = setup();
    advance(100);
    expect(events).toHaveLength(0);
  });
});
