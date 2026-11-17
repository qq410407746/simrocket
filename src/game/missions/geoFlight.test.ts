import { it, expect } from 'vitest';
import { getVehicleOrDefault } from '@/data/vehicles';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { findMission } from '@/data/missions';
import { SYNCHRONOUS_RADIUS } from '../physics/orbital/advanced';
import { EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { length } from '../physics/math/vec3';
import { suggestManeuver, type ManeuverPreset } from '../physics/orbital/planning';
import { activePropulsion } from '../vehicles/configuration';
import { HandFlownPilot } from '../simulation/testing/handFlownPilot';
import { Simulation } from '../simulation/Simulation';
import { createFlightConfig } from '../simulation/startConditions';
import { buildSnapshot } from '../simulation/snapshot';
import { deriveTelemetry } from '../telemetry/telemetry';
import { createMissionState, updateMission, missionMetrics } from './tracker';
import { scoreMission } from './scoring';

it('测试驾驶员完成从发射到 GEO 卫星部署的全部流程', () => {
  const mission = findMission('geo-deployment')!;
  const config = createFlightConfig(getVehicleOrDefault(mission.vehicleId), launchSiteGeodetic(getLaunchSiteOrDefault(mission.siteId)));
  const sim = new Simulation(config);
  const ascent = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 1 });
  const read = () => ({
    telemetry: deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config),
    stats: sim.flightStats,
    outcome: sim.flightOutcome,
  });
  let state = createMissionState(mission);
  let input = read();
  let inOrbit = false;
  let started = false;
  let duration = 0;
  let maneuvers = 0;
  let lastRead = -1;
  let resumeAt = 0;

  while (sim.time < 300_000 && state.status === 'active') {
    if (!inOrbit) {
      const status = ascent.update();
      inOrbit = status === 'orbit';
      if (status === 'ended' || status === 'out-of-propellant') break;
    } else if (state.objectives[0]?.status === 'done' && sim.time >= resumeAt) {
      const vehicle = sim.getVehicleState();
      const pending = state.objectives.find((objective) => objective.status === 'pending')?.id;
      if (pending === 'deploy') {
        sim.deploySatellite();
      } else if (pending !== 'confirm' && (sim.maneuverState || !input.telemetry.synchronous?.geo)) {
        const plan = sim.maneuverState;
        if (!plan) {
          const orbit = input.telemetry.orbit!;
          const kind: ManeuverPreset = pending === 'gto' ? 'gto'
            : orbit.inclination > 0.001 ? 'equatorial'
            : Math.abs(orbit.apoapsisAltitude - orbit.periapsisAltitude) > 100_000 ? 'circular'
            : maneuvers % 2 === 0 ? 'synchronous' : 'circular';
          const node = suggestManeuver(vehicle.body.position, vehicle.body.velocity, sim.time, kind);
          if (!node) throw new Error('不能生成机动');
          sim.setManeuver(node);
          sim.setAttitudeMode('maneuver');
          const propulsion = activePropulsion(config.vehicle, vehicle)!;
          const ve = STANDARD_GRAVITY * propulsion.engine.ispVacuum;
          duration = vehicle.mass * (1 - Math.exp(-Math.hypot(node.prograde, node.radial, node.normal) / ve))
            / (propulsion.engine.thrustVacuum * propulsion.engineCount / ve);
          started = false;
          if (++maneuvers > 12) break;
        } else if (!started && sim.time >= plan.node.time - duration / 2) {
          sim.setThrottle(1);
          started = true;
        } else if (started) {
          // 长燃烧的有限时长误差：核对实际远地点，不能只相信瞬时脉冲预览。
          if (pending === 'gto' && length(plan.remaining) < 10) sim.setAttitudeMode('prograde');
          const complete = pending === 'gto'
            ? input.telemetry.orbit!.apoapsisAltitude >= SYNCHRONOUS_RADIUS - EARTH.RADIUS
            : length(plan.remaining) < 0.5;
          if (complete || sim.time > plan.node.time + duration) {
            sim.setThrottle(0);
            sim.setManeuver(null);
            resumeAt = sim.time + 20;
          }
        }
      }
    }
    if (!sim.coastSteps(3000)) sim.step();
    if (sim.time - lastRead >= 0.1) {
      lastRead = sim.time;
      input = read();
      state = updateMission(mission, state, input);
    }
  }
  const score = scoreMission(mission, state, missionMetrics(mission, state, input));
  expect(state.status, JSON.stringify({ state, orbit: input.telemetry.orbit })).toBe('success');
  expect(state.objectives.every((objective) => objective.status === 'done')).toBe(true);
  expect(input.telemetry.synchronous?.geo).toBe(true);
  expect(sim.deployedAt).not.toBeNull();
  expect(score.total).toBeGreaterThanOrEqual(85);
}, 60_000);
