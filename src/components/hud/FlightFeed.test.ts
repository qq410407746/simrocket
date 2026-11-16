import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG } from '@/data/missions';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { createMissionState } from '@/game/missions/tracker';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';
import type { FlightEvent } from '@/game/simulation/types';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import type * as GameStoreModule from '@/stores/gameStore';
import { useGameStore } from '@/stores/gameStore';
import type * as SimStoreModule from '@/stores/simStore';
import { INITIAL_SIM_STATE, useSimStore } from '@/stores/simStore';
import { FlightFeed, describeEvent } from './FlightFeed';

// SSR normally reads the initial Zustand snapshot. Select the current fixture
// while retaining the real stores, useI18n hook, and presentation functions.
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

const vehicle = getVehicleOrDefault('frontier-1');

beforeEach(() => {
  useSimStore.setState({ ...INITIAL_SIM_STATE });
  useGameStore.setState({ vehicleId: vehicle.id, siteId: 'cape-canaveral', cameraMode: 'chase', language: 'zh' });
});

describe('bilingual flight event labels', () => {
  it.each([
    ['ignition', 0, '一级发动机点火', 'Stage 1 engine ignition'],
    ['liftoff', -1, '起飞', 'Liftoff'],
    ['depleted', 1, '二级推进剂耗尽', 'Stage 2 propellant depleted'],
    ['depleted', 2, '飞船推进剂耗尽', 'Spacecraft propellant depleted'],
    ['separation', 0, '一级分离', 'Stage 1 separated'],
    ['fairing', -1, '整流罩分离', 'Fairing separated'],
    ['heat-shield', -1, '防热大底分离', 'Heat shield separated'],
    ['payload-ignition', -1, '飞船发动机点火', 'Spacecraft engine ignition'],
    ['drogue-deployed', -1, '减速伞张开', 'Drogue parachute deployed'],
    ['main-deployed', -1, '主伞张开', 'Main parachute deployed'],
    ['parachute-failed', -1, '降落伞被撕毁', 'Parachute torn apart'],
    ['landed', -1, '着陆', 'Landing'],
    ['destroyed', -1, '飞行器损毁', 'Vehicle destroyed'],
  ] as const)('translates %s (%d) while preserving Chinese defaults', (kind, stageIndex, zh, en) => {
    const event: FlightEvent = { kind, stageIndex, time: 10 };
    expect(describeEvent(event, vehicle, 'en')).toBe(en);
    expect(describeEvent(event, vehicle, 'zh')).toBe(zh);
    expect(describeEvent(event, vehicle)).toBe(zh);
  });

  it('translates the composed names of every catalog stage', () => {
    for (const craft of VEHICLE_CATALOG) {
      for (let stageIndex = 0; stageIndex < craft.stages.length; stageIndex++) {
        for (const kind of ['ignition', 'depleted', 'separation'] as const) {
          const text = describeEvent({ kind, stageIndex, time: 0 }, craft, 'en');
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toMatch(/\p{Script=Han}/u);
        }
      }
    }
  });
});

describe('FlightFeed current language', () => {
  const site = launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'));
  const render = () => renderToStaticMarkup(createElement(FlightFeed));

  it('switches existing flight hints and event history together without changing simulation state', () => {
    const config = createFlightConfig(vehicle, site);
    const telemetry = deriveTelemetry(buildSnapshot(new Simulation(config), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    const events: FlightEvent[] = [
      { kind: 'ignition', stageIndex: 0, time: 0 }, { kind: 'liftoff', stageIndex: -1, time: 1 },
      { kind: 'depleted', stageIndex: 0, time: 120 }, { kind: 'separation', stageIndex: 0, time: 121 },
      { kind: 'fairing', stageIndex: -1, time: 130 },
    ];
    useSimStore.setState({ telemetry, events, liftoffTime: 1 });
    useGameStore.setState({ language: 'en' });
    const english = render();
    expect(english).toContain('Press Space');
    expect(english).toContain('Stage 1 propellant depleted');
    expect(english).toContain('Stage 1 separated');
    expect(english).toContain('Fairing separated');
    expect(english).not.toMatch(/\p{Script=Han}/u);
    expect(english.match(/<li /g)).toHaveLength(4);

    useGameStore.setState({ language: 'zh' });
    const chinese = render();
    expect(chinese).toContain('按 空格 点火起飞');
    expect(chinese).toContain('一级推进剂耗尽');
    useGameStore.setState({ language: 'en' });
    expect(render()).toBe(english);
    expect(useSimStore.getState().telemetry).toBe(telemetry);
    expect(useSimStore.getState().events).toBe(events);
  });

  it('passes the current language into mission-specific hints', () => {
    const mission = MISSION_CATALOG.find((task) => task.id === 'crew-return')!;
    const config = createFlightConfig(vehicle, site, 'orbit');
    const telemetry = deriveTelemetry(buildSnapshot(new Simulation(config), { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
    useSimStore.setState({ telemetry, missionId: mission.id, mission: createMissionState(mission) });
    useGameStore.setState({ language: 'en', cameraMode: 'map' });
    const english = render();
    expect(english).toContain('Press T for retrograde hold');
    expect(english).toContain('pl-[15.75rem]');
    expect(english).not.toMatch(/\p{Script=Han}/u);
    useGameStore.setState({ language: 'zh' });
    expect(render()).toContain('任务：返回地球');
  });
});
