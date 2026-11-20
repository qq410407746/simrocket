import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import type { FlightLogEntry } from '@/game/missions/logbook';
import { createMissionState } from '@/game/missions/tracker';
import type { MissionDefinition, ObjectiveSpec } from '@/game/missions/types';
import { DEG2RAD } from '@/game/physics/constants';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';
import { type Telemetry, deriveTelemetry } from '@/game/telemetry/telemetry';
import { CATEGORY_LABEL, categoryLabel, logDate, logOrbit, logResult, metricText, missionFailureText, objectiveProgress } from './missionLabels';

const mission = MISSION_CATALOG.find((task) => task.id === 'inclined-orbit') as MissionDefinition;
const vehicle = getVehicleOrDefault(mission.vehicleId);
const config = createFlightConfig(vehicle, launchSiteGeodetic(getLaunchSiteOrDefault(mission.siteId)), 'orbit');
const sim = new Simulation(config);
const telemetry = deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);
const spec: ObjectiveSpec = { kind: 'orbit', minPeriapsis: 150_000, maxApoapsis: 600_000, inclination: { target: 51.6 * DEG2RAD, tolerance: 2 * DEG2RAD } };

describe('English mission progress', () => {
  it.each([['suborbital', 'Suborbital'], ['orbital', 'Low Earth orbit'], ['return', 'Return']] as const)('translates the %s category while preserving constants', (category, expected) => {
    expect(categoryLabel(category, 'en')).toBe(expected);
    expect(categoryLabel(category)).toBe(CATEGORY_LABEL[category]);
  });

  it('translates altitude progress using the maximum achieved altitude', () => {
    expect(objectiveProgress({ kind: 'reach-altitude', altitude: 100_000 }, 'pending', { ...telemetry, altitude: 61_400 }, { ...sim.flightStats, maxAltitude: 86_300 }, null, 'en')).toBe('Max altitude 86 / 100 km');
    expect(objectiveProgress({ kind: 'reach-altitude', altitude: 100_000 }, 'pending', null, null, null, 'en')).toBe('Max altitude 0 / 100 km');
    expect(objectiveProgress(spec, 'done', telemetry, null, null, 'en')).toBe('');
    expect(objectiveProgress(spec, 'failed', telemetry, null, null, 'en')).toBe('');
  });

  it('translates orbit readings, limits, inclination, and confirmation countdown', () => {
    const high: Telemetry = { ...telemetry, orbit: { ...telemetry.orbit!, apoapsisAltitude: 812_000 } };
    const holding = { ...createMissionState(mission), orbitHoldSince: telemetry.simTime - 3 };
    expect(objectiveProgress(spec, 'pending', high, null, holding, 'en')).toBe('Periapsis 200 / 150 km · Apoapsis 812 km (max 600) · Inclination 46.0° / 51.6° · Confirming 7 s');
    expect(objectiveProgress(spec, 'pending', { ...high, orbit: { ...high.orbit!, apoapsisAltitude: Infinity } }, null, null, 'en')).toContain('Escape trajectory');
    expect(objectiveProgress(spec, 'pending', null, null, null, 'en')).toBe('Periapsis ≥ 150 km');
    expect(objectiveProgress({ kind: 'orbit', minPeriapsis: 150_000, maxApoapsis: 600_000 }, 'pending', telemetry, null, null, 'en')).toBe('Periapsis 200 / 150 km');
  });

  it.each([['main', 'Main parachute open'], ['drogue', 'Drogue parachute working'], ['stowed', ''], ['lost', ''], ['none', '']] as const)('translates landing progress for %s', (phase, expected) => {
    expect(objectiveProgress({ kind: 'land-capsule' }, 'pending', { ...telemetry, parachute: { phase, dragArea: 0 } }, null, null, 'en')).toBe(expected);
  });
});

describe('English mission failures and logs', () => {
  it.each([
    ['destroyed', 'Vehicle destroyed'],
    ['flight-ended', 'The flight ended before all primary objectives were completed'],
    ['out-of-propellant', 'Propellant exhausted in an orbit that does not meet the requirements'],
  ] as const)('translates mission failure %s', (failure, expected) => {
    expect(missionFailureText(failure, 'en')).toBe(expected);
    expect(missionFailureText(failure, 'zh')).toBe(missionFailureText(failure));
    expect(missionFailureText(null, 'en')).toBe('');
  });

  const cases: [Pick<FlightLogEntry, 'result' | 'cause' | 'missionStatus' | 'orbit'>, string][] = [
    [{ result: 'destroyed', cause: 'overload', missionStatus: 'failed', orbit: null }, 'G-load breakup'],
    [{ result: 'destroyed', cause: null, missionStatus: null, orbit: null }, 'Destroyed'],
    [{ result: 'landed', cause: null, missionStatus: 'success', orbit: null }, 'Safe landing'],
    [{ result: 'in-flight', cause: null, missionStatus: 'success', orbit: { periapsisAltitude: 150_000, apoapsisAltitude: 200_000, inclination: 0 } }, 'In orbit'],
    [{ result: 'in-flight', cause: null, missionStatus: null, orbit: null }, 'Exited in flight'],
  ];
  it.each(cases)('translates log result %o', (entry, expected) => {
    expect(logResult(entry, 'en').text).toBe(expected);
    expect(logResult(entry, 'en').tone).toBe(logResult(entry).tone);
    expect(logResult(entry, 'zh')).toEqual(logResult(entry));
  });

  it('keeps unit-only metrics and date/orbit formatting language independent', () => {
    const metrics = ['max-g', 'orbit-spread', 'max-altitude', 'downrange', 'inclination-error', 'delta-v-margin', 'landing-speed', 'ablator-remaining'] as const;
    for (const metric of metrics) {
      expect(metricText(metric, 42)).not.toMatch(/\p{Script=Han}/u);
      expect(metricText(metric, Infinity)).toBe('—');
      expect(metricText(metric, null)).toBe('—');
    }
    expect(logDate('invalid-date')).toBe('invalid-date');
    expect(logOrbit(null)).toBe('');
    expect(logOrbit({ periapsisAltitude: 150_000, apoapsisAltitude: 200_000, inclination: 0 })).toBe('150 × 200 km · 0.0°');
  });
});
