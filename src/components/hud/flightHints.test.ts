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
    // 带返回舱的飞行器：这同时也是一条返回轨道，提示两种选择
    expect(falling?.text).toMatch(/^近地点在大气层内：将再入大气层。准备返回：按 空格 分离二级，按 T 让防热大底朝前；想留在轨道上则顺行点火/);

    // 没有返回舱的飞行器（天顶三号）：只提示挽救轨道
    const zenith = getVehicleOrDefault('zenith-3');
    const zenithConfig: SimulationConfig = { vehicle: zenith, site, epochJulianDate, initialState: { ...atApoapsis, separatedStages: 2 } };
    const satellite = new Simulation(zenithConfig);
    run(satellite, 25);
    expect(flightHint(deriveTelemetry(buildSnapshot(satellite, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), zenithConfig), zenith)?.text).toContain(
      '已过远地点且近地点过低',
    );
  });

  it('返回全程：离轨 → 分离推进级 → 大底朝前 → 再入 → 开伞 → 着陆，各阶段给出对应的提示', () => {
    const config = configWith(orbitStartState(vehicle, site, epochJulianDate));
    const sim = new Simulation(config);
    const seen: string[] = [];
    const note = () => {
      const text = hintText(sim, config).replace(/[-−]?\d[\d,.]*/g, '#');
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    };
    const advance = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / sim.dt) && sim.flightPhase === 'flight'; i++) {
        sim.step();
        if (i % 5 === 0) note();
      }
    };
    // 逆行点火离轨
    sim.setAttitudeMode('retrograde');
    advance(40);
    sim.stage();
    sim.setThrottle(1);
    const v0 = Math.hypot(sim.getVehicleState().body.velocity.x, sim.getVehicleState().body.velocity.y, sim.getVehicleState().body.velocity.z);
    while (v0 - Math.hypot(sim.getVehicleState().body.velocity.x, sim.getVehicleState().body.velocity.y, sim.getVehicleState().body.velocity.z) < 120) sim.step();
    sim.setThrottle(0);
    advance(30);
    // 一直滑行到 140 km 以下才分离二级：先看到"即将再入：分离二级"的警告
    while (sim.flightPhase === 'flight' && hud(sim, config).altitude > 135_000) advance(5);
    expect(hintText(sim, config)).toMatch(/^即将再入：按 空格 分离二级/);
    sim.stage();
    advance(2);
    // 故意把舱顶朝前：提示调整姿态
    sim.setAttitudeMode('prograde');
    advance(40);
    expect(hintText(sim, config)).toMatch(/^防热大底没有朝前：按 T 开启逆行保持/);
    sim.setAttitudeMode('retrograde');
    advance(40);
    expect(hintText(sim, config)).toMatch(/^即将再入大气层：保持逆行/);
    // 再入、减速
    while (sim.flightPhase === 'flight' && hud(sim, config).altitude > 11_000) advance(2);
    // 照提示开伞
    while (sim.flightPhase === 'flight' && !hintText(sim, config).includes('按 G 开伞')) advance(1);
    expect(hud(sim, config).mach).toBeLessThan(0.9);
    sim.deployParachute();
    while (sim.flightPhase === 'flight') advance(5);
    expect(sim.flightOutcome?.kind).toBe('landed');
    expect(flightHint(hud(sim, config), vehicle)).toBeNull();

    const order = [
      '近地点在大气层内：将再入大气层。准备返回',
      '即将再入：按 空格 分离二级',
      '防热大底没有朝前',
      '即将再入大气层：保持逆行',
      '再入中：保持防热大底朝前',
      '已降到亚声速',
      '减速伞工作中',
      '主伞已张开',
    ];
    let cursor = -1;
    for (const expected of order) {
      const index = seen.findIndex((text, i) => i > cursor && text.includes(expected));
      expect(index, `提示"${expected}"应当出现在第 ${cursor} 条之后；实际序列：\n${seen.join('\n')}`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it('配平再入与抛大底：提示升力方向；主伞张开后提示可以抛大底，抛掉后不再提示', () => {
    const config = configWith(orbitStartState(vehicle, site, epochJulianDate));
    const sim = new Simulation(config);
    const advance = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / sim.dt) && sim.flightPhase === 'flight'; i++) sim.step();
    };
    const speed = () => Math.hypot(sim.getVehicleState().body.velocity.x, sim.getVehicleState().body.velocity.y, sim.getVehicleState().body.velocity.z);
    sim.setAttitudeMode('retrograde');
    advance(40);
    sim.stage();
    sim.setThrottle(1);
    const v0 = speed();
    while (v0 - speed() < 120) sim.step();
    sim.setThrottle(0);
    sim.stage();
    advance(2);
    while (sim.flightPhase === 'flight' && hud(sim, config).altitude > 135_000) advance(5);
    // 逆行保持中：提示里给出配平再入这个选项
    expect(hintText(sim, config)).toContain('按 Y 改为配平再入');
    sim.setAttitudeMode('trim');
    advance(30);
    expect(hintText(sim, config)).toMatch(/^即将再入大气层：配平再入，倾侧 0° 升力向上/);
    while (sim.flightPhase === 'flight' && hud(sim, config).referenceHeatFlux < 100_000) advance(2);
    expect(hintText(sim, config)).toMatch(/^再入中：配平再入（升阻比 0\.3\d，倾侧 0° 升力向上）：Q \/ E 改变升力方向/);
    while (sim.flightPhase === 'flight' && !hintText(sim, config).includes('已降到亚声速')) advance(1);
    sim.deployParachute();
    while (sim.flightPhase === 'flight' && sim.getVehicleState().parachute.phase !== 'main') advance(0.5);
    expect(hintText(sim, config)).toMatch(/^主伞已张开：下降速度 \d+ m\/s。可以按 H 抛掉防热大底/);
    sim.jettisonHeatShield();
    advance(1);
    expect(hintText(sim, config)).toMatch(/^主伞已张开：下降速度 \d+ m\/s，等待着陆$/);
    while (sim.flightPhase === 'flight') advance(5);
    expect(sim.flightOutcome?.kind).toBe('landed');
  });

  it('再入前就抛掉了大底：一旦开始受热就给出警告', () => {
    const config = configWith(orbitStartState(vehicle, site, epochJulianDate));
    const sim = new Simulation(config);
    const speed = () => Math.hypot(sim.getVehicleState().body.velocity.x, sim.getVehicleState().body.velocity.y, sim.getVehicleState().body.velocity.z);
    sim.setAttitudeMode('retrograde');
    for (let i = 0; i < 2_000; i++) sim.step();
    sim.stage();
    sim.setThrottle(1);
    const v0 = speed();
    while (v0 - speed() < 120) sim.step();
    sim.setThrottle(0);
    sim.stage();
    sim.jettisonHeatShield();
    expect(sim.getVehicleState().heatShieldAttached).toBe(false);
    let warned = false;
    while (sim.flightPhase === 'flight' && sim.time < 4_000) {
      sim.step();
      if (Math.round(sim.time / sim.dt) % 50 === 0 && hintText(sim, config).startsWith('防热大底已抛掉，舱底结构正直接受热')) warned = true;
    }
    expect(warned).toBe(true);
    expect(sim.flightOutcome?.cause).toBe('thermal-surface');
    expect(sim.flightOutcome?.thermalZone).toBe('base');
  });

  it('降到开伞高度但仍是超声速：提示等待，而不是提示开伞', () => {
    // 从 20 km 高度以马赫 2 俯冲的返回舱
    const speed = 600;
    const position = vec3(EARTH.RADIUS + 11_500, 0, 0);
    const config = configWith({
      position,
      velocity: vec3(-speed, EARTH.ROTATION_RATE * (EARTH.RADIUS + 11_500), 0),
      attitude: verticalLaunchAttitude(vec3(1, 0, 0)),
      separatedStages: 2,
    });
    const sim = new Simulation(config);
    run(sim, 0.1);
    const t = hud(sim, config);
    expect(t.mach).toBeGreaterThan(1.5);
    expect(t.parachute.phase).toBe('stowed');
    expect(hintText(sim, config)).toMatch(/^等速度降到马赫 0.9 以下再开伞（现在马赫 \d\.\d\d）/);
  });

  it('带迎角穿过大动压区：在箭体折断之前给出警告', () => {
    const config = configWith();
    const sim = new Simulation(config);
    sim.stage();
    while (hud(sim, config).dynamicPressure < 20_000) sim.step();
    sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    let warned = false;
    while (sim.flightPhase === 'flight' && sim.time < 200) {
      sim.step();
      if (hintText(sim, config).includes('横向气动载荷接近结构限值')) warned = true;
    }
    expect(warned).toBe(true);
    expect(sim.flightOutcome?.cause).toBe('bending');
  });

  it('贴近地面下降：带着推进级（没有降落伞）给出警告；单独的返回舱则提示等待开伞', () => {
    const descending = (separatedStages: number) => {
      // 相对（随地球转动的）大气以 40 m/s 竖直下落
      const config = configWith({ position: vec3(EARTH.RADIUS + 15_000, 0, 0), velocity: vec3(-40, EARTH.ROTATION_RATE * (EARTH.RADIUS + 15_000), 0), separatedStages });
      const sim = new Simulation(config);
      run(sim, 1);
      return flightHint(hud(sim, config), vehicle);
    };
    expect(descending(1)).toEqual({ text: '正在下降，高度不足', tone: 'warn' });
    // 返回舱：减速已经结束、还没降到开伞高度——告诉玩家在等什么
    const capsule = descending(2);
    expect(capsule?.tone).toBe('info');
    expect(capsule?.text).toMatch(/^继续下落：降到 12 km 以下、马赫 0\.9 以下时按 G 开伞（现在 1[45]\.\d km，马赫 0\.\d\d）$/);
  });

  it('无动力的返回舱沿弹道上升：提示何时到达最高点，而不是提示点火', () => {
    const meteor = getVehicleOrDefault('meteor-s');
    const config: SimulationConfig = { vehicle: meteor, site, epochJulianDate };
    const sim = new Simulation(config);
    sim.stage();
    while (sim.flightPhase === 'flight' || sim.flightPhase === 'prelaunch') {
      sim.step();
      if (sim.getVehicleState().stages[0]?.propellantMass === 0) break;
    }
    // 燃尽：提示分离
    expect(flightHint(hud(sim, config), meteor)?.text).toBe('芯级推进剂耗尽：按 空格 分离');
    sim.stage();
    while (hud(sim, config).altitude < 80_000) sim.step();
    const coasting = flightHint(hud(sim, config), meteor);
    expect(coasting?.tone).toBe('info');
    expect(coasting?.text).toMatch(/^靠惯性上升中：约 \d+ s 后到达最高点（约 2\d\d km），之后落回大气层$/);
    // 过了最高点：提示准备再入，不再提"顺行点火"
    while (hud(sim, config).verticalSpeed >= 0) sim.step();
    run(sim, 5);
    const falling = flightHint(hud(sim, config), meteor)?.text ?? '';
    expect(falling).toContain('将再入大气层');
    expect(falling).not.toContain('顺行点火');
  });
});
