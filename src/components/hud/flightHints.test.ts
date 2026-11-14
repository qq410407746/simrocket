import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { EARTH } from '@/game/physics/constants';
import { julianDateForLocalSolarTime } from '@/game/physics/ephemeris/time';
import { verticalLaunchAttitude } from '@/game/physics/frames/frames';
import { vec3 } from '@/game/physics/math/vec3';
import { propagateKepler } from '@/game/physics/orbital/kepler';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { orbitStartState } from '@/game/simulation/startConditions';
import { HandFlownPilot } from '@/game/simulation/testing/handFlownPilot';
import type { InitialFlightState, SimulationConfig } from '@/game/simulation/types';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import { flightHint } from './flightHints';

const vehicle = getVehicleOrDefault('frontier-1');
const site = launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'));
const epochJulianDate = julianDateForLocalSolarTime(2026, 4, 12, 9.5, site.longitude);
const configWith = (initialState?: InitialFlightState): SimulationConfig => ({ vehicle, site, epochJulianDate, initialState });

const hud = (sim: Simulation, config: SimulationConfig) =>
  deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
const hintText = (sim: Simulation, config: SimulationConfig): string => flightHint(hud(sim, config), vehicle)?.text ?? '';
const run = (sim: Simulation, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / sim.dt); i++) sim.step();
};

describe('操作提示', () => {
  it('没有遥测时不给提示', () => {
    expect(flightHint(null, vehicle)).toBeNull();
  });

  it('发射台：先提示点火；节流为 0 或推力不足时说明原因', () => {
    const config = configWith();
    const sim = new Simulation(config);
    expect(hintText(sim, config)).toContain('空格');
    sim.setThrottle(0);
    sim.stage();
    run(sim, 0.1);
    expect(flightHint(hud(sim, config), vehicle)).toEqual({ text: expect.stringContaining('节流阀为 0'), tone: 'warn' });
    // 边疆一号的最小节流为 60% 左右：推重比不到 1，留在台上
    sim.setThrottle(0.1);
    run(sim, 0.5);
    expect(sim.flightPhase).toBe('prelaunch');
    expect(hintText(sim, config)).toContain('推力不足');
  });

  it('照着提示手动飞到入轨：各阶段依次出现对应的提示', () => {
    const config = configWith();
    const sim = new Simulation(config);
    const pilot = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5 });
    const seen: string[] = [];
    let status = pilot.update();
    while (status === 'ascending' && sim.time < 1_000) {
      sim.step();
      if (Math.round(sim.time / sim.dt) % 5 === 0) {
        const text = hintText(sim, config);
        if (text && seen[seen.length - 1] !== text) seen.push(text);
      }
      status = pilot.update();
    }
    expect(status).toBe('orbit');
    // 去掉提示里随状态变化的数字，只看提示的种类与先后顺序
    const kinds = seen.map((text) => text.replace(/[-−]?\d[\d,.]*/g, '#'));
    const order = [
      '速度达到约 # m/s 后，按住 D 向东倾斜',
      '已开始转弯：按 R 开启顺行保持',
      '一级推进剂耗尽：按 空格 分离',
      '用俯仰角控制垂直速度',
      '已入轨，可以关机',
    ];
    let cursor = -1;
    for (const expected of order) {
      const index = kinds.findIndex((kind, i) => i > cursor && kind.includes(expected));
      expect(index, `提示"${expected}"应当出现在第 ${cursor} 条之后；实际序列：\n${kinds.join('\n')}`).toBeGreaterThan(cursor);
      cursor = index;
    }
    // 第一级还在工作时不会提前出现上面级的俯仰提示
    const burnout = kinds.findIndex((kind) => kind.includes('一级推进剂耗尽'));
    expect(kinds.slice(0, burnout).some((kind) => kind.includes('用俯仰角控制垂直速度'))).toBe(false);
    // 重力转弯期间（顺行保持、稠密大气内）没有迎角过大的警告
    expect(kinds.some((kind) => kind.includes('迎角过大'))).toBe(false);
    // 整个上升过程没有"正在下降"的警告
    expect(kinds.some((kind) => kind.includes('正在下降'))).toBe(false);

    // 关机后滑行：提示轨道已经稳定
    run(sim, 30);
    expect(hintText(sim, config)).toMatch(/^轨道稳定：\d+ × \d+ km/);
  });

  it('上面级点火后仍开着顺行保持：提示先回到手动', () => {
    const config = configWith();
    const sim = new Simulation(config);
    const pilot = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5 });
    while (sim.getVehicleState().activeStageIndex === 0 && sim.time < 400) {
      pilot.update();
      sim.step();
    }
    sim.setAttitudeMode('prograde');
    run(sim, 2);
    expect(hintText(sim, config)).toMatch(/^按 R 回到手动。用俯仰角控制垂直速度/);
    sim.setAttitudeMode('manual');
    run(sim, 0.1);
    expect(hintText(sim, config)).toMatch(/^用俯仰角控制垂直速度/);
  });

  it('从轨道出发：先提示启动上面级；之后提示轨道稳定', () => {
    const config = configWith(orbitStartState(vehicle, site, epochJulianDate));
    const sim = new Simulation(config);
    run(sim, 1);
    expect(hintText(sim, config)).toContain('启动二级发动机');
    run(sim, 30);
    expect(hintText(sim, config)).toMatch(/^轨道稳定：200 × 200 km/);
    // 启动发动机但节流为 0
    sim.stage();
    run(sim, 0.1);
    expect(hintText(sim, config)).toMatch(/^轨道稳定/);
  });

  it('亚轨道滑行：提示在远地点前顺行点火；过了远地点则警告', () => {
    // 远地点 200 km、近地点 −500 km 的轨道，从上升段（远地点前约 4 分钟）开始
    const ra = EARTH.RADIUS + 200_000;
    const a = EARTH.RADIUS - 150_000;
    const apoapsisSpeed = Math.sqrt(EARTH.MU * (2 / ra - 1 / a));
    const atApoapsis: InitialFlightState = {
      position: vec3(ra, 0, 0),
      velocity: vec3(0, apoapsisSpeed, 0),
      separatedStages: 1,
      attitude: verticalLaunchAttitude(vec3(0, 1, 0)),
    };
    // 远地点前 4 分钟（由解析传播反推）：还在上升
    const before = propagateKepler(atApoapsis.position, atApoapsis.velocity, -240, EARTH.MU);
    const rising = configWith({ ...atApoapsis, position: before.position, velocity: before.velocity });
    const climbing = new Simulation(rising);
    run(climbing, 1);
    const coast = flightHint(hud(climbing, rising), vehicle);
    expect(coast?.tone).toBe('info');
    expect(coast?.text).toMatch(/^滑行中：约 23\d s 后到达远地点。到达前开启顺行保持（R）并点火/);

    const config = configWith(atApoapsis);
    const sim = new Simulation(config);
    run(sim, 25);
    // 刚过远地点、正在下降
    const falling = flightHint(hud(sim, config), vehicle);
    expect(falling?.tone).toBe('warn');
    expect(falling?.text).toContain('已过远地点且近地点过低');
  });

  it('离轨后贴近地面下降时给出警告', () => {
    const config = configWith({
      position: vec3(EARTH.RADIUS + 15_000, 0, 0),
      velocity: vec3(-200, 300, 0),
      separatedStages: 2,
    });
    const sim = new Simulation(config);
    run(sim, 1);
    expect(flightHint(hud(sim, config), vehicle)).toEqual({ text: '正在下降，高度不足', tone: 'warn' });
  });
});
