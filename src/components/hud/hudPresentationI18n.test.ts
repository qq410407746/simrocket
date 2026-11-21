import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';
import { deriveTelemetry, type Telemetry } from '@/game/telemetry/telemetry';
import type { Language } from '@/i18n/locale';
import type * as GameStoreModule from '@/stores/gameStore';
import { useGameStore } from '@/stores/gameStore';
import type * as SimStoreModule from '@/stores/simStore';
import { INITIAL_SIM_STATE, useSimStore } from '@/stores/simStore';
import { ControlBar } from './ControlBar';
import { TopBar } from './TopBar';
import { TelemetryPanel } from './TelemetryPanel';
import { VehiclePanel } from './VehiclePanel';
import { MapOverlay } from './MapOverlay';
import * as thermalPresentation from './ThermalPanel';
import { NavBall } from './NavBall';

const locale = vi.hoisted(() => ({ language: 'zh' as 'zh' | 'en' }));
// WebGL is outside these presentation tests; do not construct its renderer in Node.
vi.mock('@react-three/fiber', () => ({ Canvas: () => null, useFrame: vi.fn(), useThree: vi.fn() }));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    language: locale.language,
    t: (zh: string, en: string) => locale.language === 'en' ? en : zh,
  }),
}));

// SSR normally reads Zustand's initial snapshot. Read the selected fixture instead;
// keep real stores, telemetry derivation, and all presentation components intact.
vi.mock('@/stores/simStore', async (importOriginal) => {
  const actual = await importOriginal<typeof SimStoreModule>();
  return { ...actual, useSimStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useSimStore.getState>) => unknown) => selector(actual.useSimStore.getState()),
    actual.useSimStore,
  ) };
});
vi.mock('@/stores/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof GameStoreModule>();
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()),
    actual.useGameStore,
  ) };
});

function telemetry(overrides: Partial<Telemetry> = {}, vehicleId = 'soyuz-2-1a', start: 'pad' | 'orbit' = 'pad'): Telemetry {
  const config = createFlightConfig(getVehicleOrDefault(vehicleId), launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral')), start);
  const sim = new Simulation(config);
  return { ...deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config), ...overrides };
}

function render(component: ComponentType, language: Language = 'en'): string {
  locale.language = language;
  return renderToStaticMarkup(createElement(component));
}

function expectEnglish(markup: string, labels: readonly string[] = []): void {
  expect(markup.match(/[\u3400-\u9fff]+/g) ?? []).toEqual([]);
  for (const label of labels) expect(markup).toContain(label);
}

beforeEach(() => {
  locale.language = 'zh';
  useSimStore.setState({ ...INITIAL_SIM_STATE, simRate: 1 });
  useGameStore.setState({ vehicleId: 'soyuz-2-1a', cameraMode: 'chase' });
});

describe('localized flight HUD presentation', () => {
  it('localizes navball readouts, attitude modes, trim guidance and every flight-key hint', () => {
    expectEnglish(render(NavBall), ['Pitch', 'Heading', 'Ref:', 'Surface', 'Pointing', 'Manual', 'Prograde', 'Retrograde', 'Normal', 'Anti-normal', 'Radial out', 'Radial in', 'Trim', 'Space', 'Ignite / stage', 'Roll / bank', 'Jettison fairing', 'Deploy chute', 'Jettison shield']);
    useSimStore.setState({ telemetry: telemetry({ phase: 'flight', altitude: 200_000 }) });
    expectEnglish(render(NavBall), ['Orbit']);
    for (const bankAngle of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      useSimStore.setState({ telemetry: telemetry({ phase: 'flight', attitudeMode: 'trim', trimAngle: 0.35, bankAngle }) });
      expectEnglish(render(NavBall), ['Bank', 'Trim AoA', 'Q / E']);
    }
    const chinese = render(NavBall, 'zh');
    for (const text of ['俯仰', '航向', '倾侧', '升力向下', '配平迎角', '指向', '反法向', '滚转 / 倾侧', '空格', '配平再入']) expect(chinese).toContain(text);
  });

  it('localizes thermal zones, materials, risk levels, chart descriptions and progress-bar names', () => {
    expect(render(thermalPresentation.ThermalPanel)).toBe('');
    useSimStore.setState({ telemetry: telemetry() });
    expectEnglish(render(thermalPresentation.ThermalPanel), ['Thermal protection', 'Monitoring', 'Nominal', 'Flux', 'Surface', 'Interior', 'Load', 'thermal margin used', 'Heat flux (cyan), surface temperature (orange) and interior temperature (gray) over time']);
    const materials = ['铝合金箱壁', '发动机舱', '整流罩（软木防热层）', '隔热瓦', '舱底结构（无防热）', '烧蚀防热层', '卫星本体'];
    const fixture = telemetry();
    for (const [margin, failure] of [[0.8, null], [0.3, null], [0.1, null], [0, 'burn-through']] as const) {
      for (const material of materials) {
        useSimStore.setState({ telemetry: { ...fixture, thermal: fixture.thermal.map((zone) => ({ ...zone, owner: 'payload', margin, failure, material, ablative: true, ablatorFraction: 0.75, heatFlux: 50_000 })) } });
        expectEnglish(render(thermalPresentation.ThermalPanel), ['Hottest', '75% left']);
      }
    }
    const chinese = render(thermalPresentation.ThermalPanel, 'zh');
    for (const text of ['热防护', '受热最强', '已失效', '卫星本体', '表面限值', '内部限值', '热裕度已用', '余 75%', '热流（青色）、表面温度（橙色）与内部温度（灰色）随时间变化的曲线']) expect(chinese).toContain(text);
  });

  it('formats the chart history span in the selected language with the original Chinese as default', () => {
    expect(thermalPresentation).toHaveProperty('thermalHistorySpanLabel');
    expect(thermalPresentation.thermalHistorySpanLabel(45, 'en')).toBe('Last 45 s');
    expect(thermalPresentation.thermalHistorySpanLabel(120, 'en')).toBe('Last 2 min');
    expect(thermalPresentation.thermalHistorySpanLabel(45)).toBe('最近 45 秒');
    expect(thermalPresentation.thermalHistorySpanLabel(120, 'zh')).toBe('最近 2 分钟');
  });

  it('localizes the map legend, impact countdown and orbital-element help in every flight phase', () => {
    expect(render(MapOverlay)).toBe('');
    useGameStore.setState({ cameraMode: 'map' });
    expectEnglish(render(MapOverlay), ['Orbit map', 'Orbit shown after liftoff.']);
    useSimStore.setState({ telemetry: telemetry({ phase: 'landed' }) });
    expectEnglish(render(MapOverlay), ['Flight has ended.']);
    useSimStore.setState({ telemetry: telemetry({ phase: 'flight', simTime: 100 }, 'soyuz-2-1a', 'orbit') });
    expectEnglish(render(MapOverlay), ['Current orbit (two-body, no drag)', 'Predicted path (with drag)', 'Apoapsis Ap / periapsis Pe', 'No ground impact within the prediction window.', 'Orbital elements', 'Drag to rotate; scroll to zoom.']);
    useSimStore.setState({ predictedImpact: { time: 130, latitude: 0, longitude: 0, speed: 123 } });
    expectEnglish(render(MapOverlay), ['Predicted impact (no further thrust)', 'Time', 'In 30 s', 'Position', 'Speed', '123.0']);
    const chinese = render(MapOverlay, 'zh');
    for (const text of ['轨道地图', '当前轨道（不计阻力的二体轨道）', '预计落点（若不再点火）', '30 s 后', '轨道根数', '拖动旋转，滚轮缩放。']) expect(chinese).toContain(text);
  });

  it('localizes every vehicle, payload, stage and propulsion state while preserving numeric values', () => {
    expectEnglish(render(VehiclePanel), ['Soyuz-2.1a', 'Soyuz MS descent module', 'Propulsion', 'Engine', 'Off', 'Thrust', 'Throttle', 'Liftoff TWR', 'Total mass', 'Remaining Δv', 'Stages &amp; fuel', 'Top to bottom']);
    for (const vehicle of VEHICLE_CATALOG) {
      useGameStore.setState({ vehicleId: vehicle.id });
      for (const state of [
        { thrust: 100, ignited: true, throttle: 0.2, effectiveThrottle: 0.4 },
        { thrust: 0, ignited: true },
        { thrust: 0, ignited: false, fairingAttached: false, stageAttached: vehicle.stages.map(() => false), activeStageIndex: vehicle.stages.length },
      ]) {
        useSimStore.setState({ telemetry: telemetry(state, vehicle.id) });
        expectEnglish(render(VehiclePanel), [vehicle.name]);
      }
    }
    useGameStore.setState({ vehicleId: 'soyuz-2-1a' });
    useSimStore.setState({ telemetry: telemetry({ thrust: 100, ignited: true, throttle: 0.2, effectiveThrottle: 0.4, stageAttached: [false, true, true, true] }) });
    expectEnglish(render(VehiclePanel), ['Running', 'Separated', '20 → 40']);
    useSimStore.setState({ telemetry: telemetry({ thrust: 0, ignited: true }) });
    expectEnglish(render(VehiclePanel), ['Standby']);
    const chinese = render(VehiclePanel, 'zh');
    for (const text of ['联盟-2.1a', '联盟 MS 返回舱', '推进', '待机', '起飞推重比', '分级与推进剂', '自上而下', '芯级（A）', '第三级（I）']) expect(chinese).toContain(text);
  });

  it('localizes telemetry headings, waiting state and every orbit classification with unchanged readouts', () => {
    expectEnglish(render(TelemetryPanel), ['Flight data', 'Waiting for physics data…']);
    useSimStore.setState({ telemetry: telemetry() });
    expectEnglish(render(TelemetryPanel), ['Position &amp; speed', 'Altitude', 'Surface speed', 'Vert. speed', 'Horiz. speed', 'Orbit speed', 'Downrange', 'Subpoint', 'After liftoff', 'Loads &amp; aero', 'G-load', 'Dyn. pressure', 'Mach', 'AoA', 'Lift/drag']);
    const orbit = telemetry({}, 'soyuz-2-1a', 'orbit').orbit!;
    for (const classification of ['suborbital', 'atmospheric', 'orbit', 'escape'] as const) {
      useSimStore.setState({ telemetry: telemetry({ phase: 'flight', altitude: 200_000, surfaceSpeed: 7_800, airDensity: 0, orbit: { ...orbit, classification } }) });
      expectEnglish(render(TelemetryPanel), ['Apoapsis', 'Periapsis', 'To apoapsis', 'To periapsis', 'Incl.', 'Ecc.', 'Period', '200.00', '7,800.0']);
    }
    const chinese = render(TelemetryPanel, 'zh');
    for (const text of ['飞行遥测', '位置与速度', '惯性速度', '星下点', '逃逸轨道', '速度超过逃逸速度：不再返回地球', '受力与气动', '升阻比']) expect(chinese).toContain(text);
  });

  it('localizes all top-bar phases, clocks and execution status without changing the underlying telemetry', () => {
    expectEnglish(render(TopBar), ['On pad', 'HOLD', 'Sim elapsed', 'Physics:', 'Relaunch', 'Menu']);
    const phases: readonly [Partial<Telemetry>, string][] = [
      [{ phase: 'prelaunch', ignited: true }, 'Engines ignited'],
      [{ phase: 'landed' }, 'Landed'],
      [{ phase: 'destroyed' }, 'Vehicle lost'],
      [{ phase: 'flight', thrust: 10 }, 'Powered flight'],
      [{ phase: 'flight', thrust: 0, parachute: { phase: 'main', dragArea: 1 } }, 'Chute descent'],
      [{ phase: 'flight', verticalSpeed: -100, referenceHeatFlux: 100_000 }, 'Reentry'],
      [{ phase: 'flight', verticalSpeed: -10, altitude: 1_000 }, 'Descent'],
      [{}, 'On orbit'],
    ];
    for (const [state, label] of phases) {
      const fixture = telemetry({ simTime: 120, missionTime: 60, ...state }, 'soyuz-2-1a', 'orbit');
      useSimStore.setState({ telemetry: fixture, execution: 'main-thread' });
      expectEnglish(render(TopBar), [label, 'Main thread (fallback)', 'T+ 00:01:00', '00:02:00']);
      expect(useSimStore.getState().telemetry).toBe(fixture);
    }
    const orbit = telemetry({}, 'soyuz-2-1a', 'orbit').orbit!;
    useSimStore.setState({ telemetry: telemetry({ phase: 'flight', orbit: { ...orbit, classification: 'escape' } }), execution: 'worker' });
    expectEnglish(render(TopBar), ['Escape', 'Web Worker']);
    useSimStore.setState({ telemetry: telemetry({ phase: 'flight', orbit: null }) });
    expectEnglish(render(TopBar), ['Coast']);
    const chinese = render(TopBar, 'zh');
    for (const text of ['轨道边疆', '无动力滑行', '模拟历时', '任务时间：自起飞瞬间开始计时', '物理：', '重新发射', '主菜单']) expect(chinese).toContain(text);
  });

  it('renders compact English control labels, shortcuts, tooltips and accessible names in every staging state', () => {
    expectEnglish(render(ControlBar), ['Time', 'Ignite', 'Throttle', 'View', 'Chase', 'Free', 'Pad', 'Orbit', 'Map', 'aria-label="Pause"']);
    const stages: readonly [Partial<Telemetry>, string][] = [
      [{ phase: 'prelaunch', ignited: false }, 'Liftoff'],
      [{ phase: 'prelaunch', ignited: true }, 'Ignited'],
      [{ phase: 'landed' }, 'Flight ended'],
      [{ phase: 'flight', ignited: false, activeStageIndex: 0 }, 'Start Boosters (B/V/G/D)'],
      [{ phase: 'flight', ignited: true, activeStageIndex: 0 }, 'Jettison boosters'],
      [{ phase: 'flight', ignited: true, activeStageIndex: 0 }, 'Core stage (A) keeps burning'],
      [{ phase: 'flight', ignited: true, activeStageIndex: 1 }, 'Separate Core stage (A)'],
      [{ phase: 'flight', ignited: false, activeStageIndex: 3 }, 'Start Service and orbital modules'],
      [{ phase: 'flight', ignited: true, activeStageIndex: 4 }, 'No stages left'],
    ];
    for (const [state, label] of stages) {
      useSimStore.setState({ telemetry: telemetry(state) });
      expectEnglish(render(ControlBar), [label]);
    }
    for (const phase of ['none', 'stowed', 'drogue', 'main', 'lost'] as const) {
      for (const safe of [true, false]) {
        useSimStore.setState({ telemetry: telemetry({
          phase: 'flight', activeStageIndex: 2, parachute: { phase, dragArea: 1 },
          parachuteLimits: { mach: 0.9, dynamicPressure: 12_000 }, mach: safe ? 0.5 : 2,
          dynamicPressure: safe ? 1_000 : 30_000, canJettisonHeatShield: true,
        }) });
        expectEnglish(render(ControlBar));
      }
    }
    useSimStore.setState({ paused: true, timeWarp: 5, maxTimeWarp: 5 });
    expectEnglish(render(ControlBar), ['aria-label="Resume"', 'Current limit: 5×']);
    useSimStore.setState({ paused: false, simRate: 2, telemetry: telemetry({ heatShieldAttached: false }) });
    expectEnglish(render(ControlBar), ['Actual 2×', 'Shield off']);
    useGameStore.setState({ vehicleId: 'atlas-v-401' });
    for (const fairingAttached of [true, false]) {
      useSimStore.setState({ telemetry: telemetry({ phase: 'flight', fairingAttached }, 'atlas-v-401') });
      expectEnglish(render(ControlBar), [fairingAttached ? 'Fairing' : 'Fairing off']);
    }
  });

  it('preserves the default Chinese control text and dynamic warnings exactly', () => {
    useSimStore.setState({ telemetry: telemetry({ phase: 'flight', ignited: true, activeStageIndex: 1 }), timeWarp: 5, maxTimeWarp: 5, simRate: 2 });
    const markup = render(ControlBar, 'zh');
    for (const text of ['分离芯级（A）', '分离芯级（A）并点燃第三级（I）（空格）', '暂停 / 继续（快捷键 P）', 'aria-label="节流阀"', '当前最高 5×：发动机工作或操纵时限 5×，稠密大气内限 10×', '实际 2×']) {
      expect(markup).toContain(text);
    }
  });
});
