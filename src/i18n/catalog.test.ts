import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightSummary } from '@/components/hud/FlightSummary';
import { MissionStrip } from '@/components/hud/MissionStrip';
import { MissionBriefing, MissionList } from '@/components/menu/MissionMenu';
import { LogbookMenu } from '@/components/menu/LogbookMenu';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG as FULL_CATALOG } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { buildLogEntry } from '@/game/missions/logbook';
import { scoreMission } from '@/game/missions/scoring';
import { createMissionState, missionMetrics } from '@/game/missions/tracker';
import type { MissionDefinition } from '@/game/missions/types';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';
import type { FailureCause, FlightOutcome } from '@/game/simulation/types';
import { deriveTelemetry } from '@/game/telemetry/telemetry';
import { sampleFlight } from '@/game/telemetry/flightRecorder';
import { useCareerStore } from '@/stores/careerStore';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { INITIAL_SIM_STATE, useSimStore } from '@/stores/simStore';
import { localizeMission } from './catalog';

// 阶段六按用户要求只提供中文；保留既有七项任务的完整英文回归。
const MISSION_CATALOG = FULL_CATALOG.filter((m) => m.id !== 'geo-deployment');
const withoutChineseMission = (html: string) => html.replace(/<li><button[^>]*data-testid="mission-geo-deployment"[\s\S]*?<\/li>/, '');

vi.hoisted(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});

const render = (component: ComponentType): string => {
  // Zustand's bound hook copies API methods; spying on that copy does not change
  // its internal server snapshot. Synchronize the real hydration objects instead.
  Object.assign(useGameStore.getInitialState(), useGameStore.getState());
  Object.assign(useCareerStore.getInitialState(), useCareerStore.getState());
  Object.assign(useSimStore.getInitialState(), useSimStore.getState());
  return renderToStaticMarkup(createElement(component));
};

beforeEach(() => {
  useGameStore.setState({ language: 'en', selectedMissionId: 'karman-line' });
  useCareerStore.setState({ progress: {}, logbook: [], unlockAll: false });
  useSimStore.setState(INITIAL_SIM_STATE);
  simRuntime.flightRecorder.clear();
});
afterEach(() => vi.restoreAllMocks());

const orbitConfig = createFlightConfig(getVehicleOrDefault('frontier-1'), launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral')), 'orbit');
const simulation = new Simulation(orbitConfig);
const telemetry = deriveTelemetry(buildSnapshot(simulation, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), orbitConfig);
const stats = simulation.flightStats;
const baseLog = buildLogEntry({
  id: 'test-flight', date: '2026-11-14T12:00:00.000Z', missionId: 'first-orbit',
  vehicleId: 'frontier-1', siteId: 'cape-canaveral', start: 'orbit', telemetry, stats,
  outcome: null, mission: null, score: null,
});

describe('mission result presentation', () => {
  it('localizes each mission failure reason while retaining the failure grade and score', () => {
    const definition = MISSION_CATALOG[2]!;
    for (const failure of ['destroyed', 'flight-ended', 'out-of-propellant'] as const) {
      const state = { ...createMissionState(definition), status: 'failed' as const, failure };
      const score = scoreMission(definition, state, missionMetrics(definition, state, { telemetry, stats, outcome: null }));
      useSimStore.setState({ missionId: definition.id, mission: state, missionScore: score, telemetry, stats });
      const html = render(FlightSummary);
      expect(html, failure).not.toMatch(/\p{Script=Han}/u);
      expect(html).toContain('MISSION FAILED');
      expect(html).toContain('data-testid="mission-failure"');
      expect(score.total).toBe(0);
      expect(score.grade).toBe('F');
      expect(useSimStore.getState().missionScore).toBe(score);
    }
  });

  it('localizes chart series, peak legends and the dynamic sampling explanation', () => {
    simRuntime.flightRecorder.record(sampleFlight({ ...telemetry, missionTime: 0 }));
    simRuntime.flightRecorder.record(sampleFlight({ ...telemetry, missionTime: 1 }));
    const definition = MISSION_CATALOG[2]!;
    const state = { ...createMissionState(definition), status: 'success' as const };
    const score = scoreMission(definition, state, missionMetrics(definition, state, { telemetry, stats, outcome: null }));
    useSimStore.setState({ missionId: definition.id, mission: state, missionScore: score, telemetry, stats });
    const html = render(FlightSummary);
    expect(html).not.toMatch(/\p{Script=Han}/u);
    expect(html).toContain('data-testid="flight-charts"');
    expect(html).toContain('Altitude');
    expect(html).toContain('Speed');
    expect(html).toContain('G-load');
    expect(html).toContain('Heat flux');
    expect(html.match(/<span class="readout text-ink">Peak /g)).toHaveLength(4);
    expect(html).toContain('2 sample points');
    useGameStore.setState({ language: 'zh' });
    expect(render(FlightSummary)).toContain('采样点');
    expect(render(FlightSummary)).toContain('最大');
  });

  it('localizes free-flight landings and all destruction explanations, including thermal materials', () => {
    const causes: (FailureCause | null)[] = [null, 'impact', 'thermal-surface', 'burn-through', 'thermal-structure', 'overload', 'dynamic-pressure', 'bending'];
    const outcome: FlightOutcome = {
      kind: 'destroyed', cause: 'impact', thermalZone: 'base', time: 1234,
      altitude: 50000, impactSpeed: 7500, verticalSpeed: -3000, tilt: 1,
      latitude: 0.5, longitude: -1.2,
    };
    for (const cause of causes) {
      useSimStore.setState({ telemetry, stats, liftoffTime: 0, outcome: { ...outcome, cause } });
      const html = render(FlightSummary);
      expect(html, String(cause)).not.toMatch(/\p{Script=Han}/u);
      expect(html).toContain('aria-label="Flight results"');
      expect(html).toContain('Vehicle destroyed');
      expect(html).toContain('data-testid="flight-reasons"');
      expect(html).toContain('Relaunch');
    }
    useSimStore.setState({ outcome: { ...outcome, kind: 'landed', cause: null, verticalSpeed: -7.2, impactSpeed: 7.2 } });
    expect(render(FlightSummary)).not.toMatch(/\p{Script=Han}/u);
    expect(render(FlightSummary)).toContain('Landed');
    expect(render(FlightSummary)).toContain('within the limit');
    expect(useSimStore.getState().stats).toBe(stats);
    useGameStore.setState({ language: 'zh' });
    expect(render(FlightSummary)).toContain('已着陆');
    expect(render(FlightSummary)).toContain('可承受的范围内');
  });

  it('localizes all mission results and score tooltips by ID without changing recorded scores', () => {
    for (const definition of MISSION_CATALOG) {
      const state = {
        ...createMissionState(definition), status: 'success' as const, endedAt: 600,
        objectives: definition.objectives.map((objective) => ({ id: objective.id, status: 'done' as const, resolvedAt: 600 })),
        confirmedOrbit: { ...telemetry.orbit!, remainingDeltaV: 3000 },
      };
      const computed = scoreMission(definition, state, missionMetrics(definition, state, { telemetry, stats, outcome: null }));
      // Saved score text is Chinese and order need not match the catalog.
      const score = { ...computed, items: [...computed.items].reverse() };
      useSimStore.setState({ missionId: definition.id, mission: state, missionScore: score, telemetry, stats, liftoffTime: 0 });
      useCareerStore.setState({ progress: { [definition.id]: { completed: true, bestScore: 93, bestGrade: 'S', attempts: 2 } } });
      const html = render(FlightSummary);
      expect(html, definition.id).not.toMatch(/\p{Script=Han}/u);
      expect(html).toContain('aria-label="Mission results"');
      expect(html).toContain(localizeMission(definition, 'en').title);
      for (const item of localizeMission(definition, 'en').scoring) {
        const tooltip = renderToStaticMarkup(createElement('span', { title: item.note })).match(/title="[^"]*"/)?.[0];
        expect(tooltip).toBeDefined();
        expect(html).toContain(tooltip);
      }
      expect(html).toContain('Best result 93');
      expect(html).toContain('Continue flying');
      expect(html).toContain('Confirmed orbit');
      if (definition.id === 'karman-line') expect(html).toContain('Next mission: Suborbital Flight and Recovery');
      expect(useSimStore.getState().missionScore).toBe(score);
      expect(score.items[0]!.label).toMatch(/\p{Script=Han}/u);
    }
    useGameStore.setState({ language: 'zh' });
    expect(render(FlightSummary)).toContain('极地轨道');
    expect(render(FlightSummary)).toContain('最好成绩');
  });
});

describe('in-flight mission presentation', () => {
  it('localizes every mission, objective, live progress, optional marker and title tooltip', () => {
    for (const mission of MISSION_CATALOG) {
      useSimStore.setState({ missionId: mission.id, mission: createMissionState(mission), telemetry, stats });
      const html = render(MissionStrip);
      expect(html, mission.id).not.toMatch(/\p{Script=Han}/u);
      expect(html).toContain(localizeMission(mission, 'en').title);
      expect(html).toContain('Show / hide the flight plan for this mission');
      expect(html.match(/data-testid="objective-/g)).toHaveLength(mission.objectives.length);
    }
    const mission = MISSION_CATALOG[0]!;
    useSimStore.setState({ missionId: mission.id, mission: { ...createMissionState(mission), status: 'success' } });
    expect(render(MissionStrip)).toContain('Completed');
    useSimStore.setState({ mission: { ...createMissionState(mission), status: 'failed' } });
    expect(render(MissionStrip)).toContain('Failed');
    useGameStore.setState({ language: 'zh' });
    expect(render(MissionStrip)).toContain('突破卡门线');
    expect(render(MissionStrip)).toContain('附加');
  });
});

describe('flight log presentation', () => {
  it('localizes empty and populated logs, results and vehicle/site metadata without rewriting entries', () => {
    expect(render(LogbookMenu)).toContain('Flight log');
    expect(render(LogbookMenu)).not.toMatch(/\p{Script=Han}/u);
    const entries = [
      { ...baseLog, id: 'orbit' },
      { ...baseLog, id: 'landed', missionId: 'crew-return', result: 'landed' as const },
      { ...baseLog, id: 'destroyed', missionId: null, result: 'destroyed' as const, cause: 'dynamic-pressure' as const },
      { ...baseLog, id: 'exited', missionId: null, orbit: null },
    ];
    useCareerStore.setState({ logbook: entries });
    const html = render(LogbookMenu);
    // 阶段七新增回看入口按当前要求使用中文；旧日志元数据继续检查英文。
    expect(html).toContain('查看遥测曲线');
    expect(html.replaceAll('查看遥测曲线', '')).not.toMatch(/\p{Script=Han}/u);
    expect(html).toContain('First Orbit');
    expect(html).toContain('Crew Return');
    expect(html).toContain('Free flight');
    expect(html).toContain('Frontier-1');
    expect(html).toContain('Cape Canaveral');
    expect(html).toContain('Clear mission progress and flight log');
    expect(html.match(/data-testid="logbook-entry"/g)).toHaveLength(entries.length);
    expect(useCareerStore.getState().logbook).toBe(entries);
    useGameStore.setState({ language: 'zh' });
    expect(render(LogbookMenu)).toContain('载人飞船返回');
    expect(render(LogbookMenu)).toContain('卡纳维拉尔角');
  });
});

describe('mission menu presentation', () => {
  it('localizes saved best results and singular or plural flight counts', () => {
    const record = { completed: true, bestScore: 87, bestGrade: 'A' as const, attempts: 1 };
    useCareerStore.setState({ progress: { 'karman-line': record } });
    const html = render(MissionBriefing);
    expect(html).not.toMatch(/\p{Script=Han}/u);
    expect(html).toContain('Best result');
    expect(html).toContain(' · 1 flight</span>');
    expect(render(MissionList)).toContain('Completed 1 / 8');
    useCareerStore.setState({ progress: { 'karman-line': { ...record, attempts: 2 } } });
    expect(render(MissionBriefing)).toContain(' · 2 flights</span>');
    useCareerStore.setState({ progress: { 'karman-line': { ...record, completed: false, bestGrade: null } } });
    expect(render(MissionBriefing)).toContain('Not yet completed');
  });

  it('renders the complete English catalog, metadata, prerequisites and launch guidance', () => {
    const list = withoutChineseMission(render(MissionList));
    expect(list).toContain('Missions');
    expect(list).not.toMatch(/\p{Script=Han}/u);
    expect(list.match(/data-testid="mission-(?:karman-line|suborbital-hop|first-orbit|crew-return|orbital-flight|inclined-orbit|polar-orbit)"/g)).toHaveLength(7);

    for (const mission of MISSION_CATALOG) {
      useGameStore.setState({ selectedMissionId: mission.id });
      const briefing = render(MissionBriefing);
      expect(briefing, mission.id).not.toMatch(/\p{Script=Han}/u);
      expect(briefing).toContain(localizeMission(mission, 'en').title);
      expect(briefing).toContain('Flight plan');
      expect(briefing).toContain('Scoring (out of 100)');
      expect(briefing).toContain('Objectives');
    }
    expect(render(MissionBriefing)).toContain('Complete first: Target Inclination');
    expect(render(MissionBriefing)).toContain('Theoretical launch azimuth');

    useGameStore.setState({ language: 'zh', selectedMissionId: 'karman-line' });
    expect(render(MissionList)).toContain('流星-S');
    expect(render(MissionBriefing)).toContain('突破卡门线');
    expect(render(MissionBriefing)).toContain('附加目标');
  });
});

const gameplayDefinition = (mission: MissionDefinition) => ({
  ...mission,
  title: undefined,
  summary: undefined,
  briefing: undefined,
  flightPlan: undefined,
  objectives: mission.objectives.map(({ title: _title, ...objective }) => objective),
  scoring: mission.scoring.map(({ label: _label, note: _note, ...item }) => item),
});

describe('localizeMission', () => {
  it('returns the untouched original mission for Chinese', () => {
    for (const mission of MISSION_CATALOG) {
      expect(localizeMission(mission, 'zh')).toBe(mission);
    }
  });

  it('completely translates all seven missions without changing any gameplay data', () => {
    const original = structuredClone(MISSION_CATALOG);
    const expected = [
      ['karman-line', 'Cross the Kármán Line', 3, 2, 3, 5],
      ['suborbital-hop', 'Suborbital Flight and Recovery', 4, 2, 4, 5],
      ['first-orbit', 'First Orbit', 4, 1, 4, 5],
      ['crew-return', 'Crew Return', 4, 1, 4, 5],
      ['orbital-flight', 'Crewed Orbital Flight', 3, 2, 5, 4],
      ['inclined-orbit', 'Target Inclination', 4, 1, 5, 5],
      ['polar-orbit', 'Polar Orbit', 4, 1, 5, 5],
    ];
    const localized = MISSION_CATALOG.map((mission) => localizeMission(mission, 'en'));
    expect(localized.map((mission) => [
      mission.id, mission.title, mission.briefing.length, mission.objectives.length, mission.scoring.length, mission.flightPlan.length,
    ])).toEqual(expected);
    expect(localized.reduce((counts, mission) => ({
      missions: counts.missions + 1,
      briefing: counts.briefing + mission.briefing.length,
      objectives: counts.objectives + mission.objectives.length,
      scoring: counts.scoring + mission.scoring.length,
      flightPlan: counts.flightPlan + mission.flightPlan.length,
    }), { missions: 0, briefing: 0, objectives: 0, scoring: 0, flightPlan: 0 })).toEqual({
      missions: 7, briefing: 26, objectives: 10, scoring: 30, flightPlan: 34,
    });

    localized.forEach((mission, index) => {
      const source = MISSION_CATALOG[index]!;
      expect(gameplayDefinition(mission)).toEqual(gameplayDefinition(source));
      expect(mission).not.toBe(source);
      // Includes IDs, category, launch/site/vehicle metadata, every paragraph,
      // objective, scoring tooltip and flight-plan step, not only the headings.
      expect(JSON.stringify(mission), mission.id).not.toMatch(/\p{Script=Han}/u);
      const content = (item: MissionDefinition): string[] => [
        item.title, item.summary, ...item.briefing,
        ...item.objectives.map((objective) => objective.title),
        ...item.scoring.flatMap((score) => [score.label, score.note]), ...item.flightPlan,
      ];
      content(mission).forEach((text, textIndex) => {
        expect(text.trim().length, `${mission.id}: text ${textIndex}`).toBeGreaterThan(0);
        expect(text).not.toBe(content(source)[textIndex]);
      });
      mission.objectives.forEach((objective, i) => expect(objective.spec).toBe(source.objectives[i]!.spec));
      mission.scoring.forEach((item, i) => expect(item.rule).toBe(source.scoring[i]!.rule));
      expect(mission.launch).toBe(source.launch);
      expect(mission.ascent).toBe(source.ascent);
      expect(mission.requires).toBe(source.requires);
    });
    expect(MISSION_CATALOG).toEqual(original);
    // Numeric constraints and controls survive in the long-form teaching text.
    expect(localized[5]!.briefing.join(' ')).toContain('cos i = cos φ · sin β');
    expect(localized[6]!.briefing.join(' ')).toContain('380 m/s');
    expect(localized[3]!.flightPlan.join(' ')).toContain('0–50 km');
    expect(localized[1]!.flightPlan.join(' ')).toContain('300 m/s');
  });
});

it('新增的高级轨道任务按要求保留中文，且没有改变任务定义', () => {
 const mission = FULL_CATALOG.find((m) => m.id === 'geo-deployment')!;
 expect(localizeMission(mission, 'en')).toBe(mission);
 expect(localizeMission(mission, 'zh').title).toContain('同步通信卫星');
});
