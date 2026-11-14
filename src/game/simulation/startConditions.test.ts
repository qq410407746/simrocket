import { describe, expect, it } from 'vitest';
import { LAUNCH_SITES, getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { julianDateForLocalSolarTime } from '../physics/ephemeris/time';
import { ecefToGeodetic, eciToEcef } from '../physics/frames/frames';
import { rotate } from '../physics/math/quat';
import { dot, length, normalize, vec3 } from '../physics/math/vec3';
import { circularSpeed, elementsFromState } from '../physics/orbital/elements';
import { analyzeVehicle } from '../vehicles/analysis';
import { Simulation } from './Simulation';
import { ASCENT_DELTA_V_BUDGET, ORBIT_START_ALTITUDE, canStartInOrbit, orbitStartState } from './startConditions';
import type { SimulationConfig } from './types';

const epochJulianDate = julianDateForLocalSolarTime(2026, 4, 12, 9.5, 0);

const orbitConfig = (vehicleId: string, siteId: string): SimulationConfig => {
  const vehicle = getVehicleOrDefault(vehicleId);
  const site = launchSiteGeodetic(getLaunchSiteOrDefault(siteId));
  return { vehicle, site, epochJulianDate, initialState: orbitStartState(vehicle, site, epochJulianDate) };
};

describe('从近地轨道开始', () => {
  it('只有能入轨的多级火箭可以从轨道开始', () => {
    expect(canStartInOrbit(getVehicleOrDefault('frontier-1'))).toBe(true);
    expect(canStartInOrbit(getVehicleOrDefault('zenith-3'))).toBe(true);
    // 流星-S 是单级亚轨道火箭
    expect(canStartInOrbit(getVehicleOrDefault('meteor-s'))).toBe(false);
  });

  it('初始状态是发射场正上方 200 km 的圆轨道，向正东飞行：倾角等于发射场纬度', () => {
    const vehicle = getVehicleOrDefault('frontier-1');
    for (const launchSite of LAUNCH_SITES) {
      const site = launchSiteGeodetic(launchSite);
      const state = orbitStartState(vehicle, site, epochJulianDate);
      const radius = EARTH.RADIUS + ORBIT_START_ALTITUDE;
      expect(length(state.position)).toBeCloseTo(radius, 3);
      expect(length(state.velocity)).toBeCloseTo(circularSpeed(radius), 6);
      // 速度水平
      expect(Math.abs(dot(normalize(state.position), normalize(state.velocity)))).toBeLessThan(1e-12);

      const el = elementsFromState(state.position, state.velocity);
      expect(el.eccentricity).toBeLessThan(1e-9);
      expect(el.periapsisRadius - EARTH.RADIUS).toBeCloseTo(ORBIT_START_ALTITUDE, 2);
      expect(el.inclination).toBeCloseTo(Math.abs(site.latitude), 9);
      // 顺行（向东）
      expect(el.inclination).toBeLessThan(Math.PI / 2);
    }
  });

  it('位于发射场正上方（按历元时刻的地球自转角换算）', () => {
    const config = orbitConfig('frontier-1', 'wenchang');
    const sim = new Simulation(config);
    const body = sim.getVehicleState().body;
    // 模拟器的 t = 0 对应历元；此时的星下点应当就是发射场
    const geodetic = ecefToGeodetic(eciToEcef(body.position, sim.earthRotationAngle));
    expect(geodetic.latitude).toBeCloseTo(config.site.latitude, 9);
    expect(geodetic.longitude).toBeCloseTo(config.site.longitude, 9);
    expect(geodetic.altitude).toBeCloseTo(ORBIT_START_ALTITUDE, 2);
  });

  it('姿态：头部朝前（顺行），机体 −Z 朝天', () => {
    const state = orbitStartState(getVehicleOrDefault('frontier-1'), launchSiteGeodetic(getLaunchSiteOrDefault('kourou')), epochJulianDate);
    const nose = rotate(state.attitude!, vec3(1, 0, 0));
    const bodyZ = rotate(state.attitude!, vec3(0, 0, 1));
    expect(dot(nose, normalize(state.velocity))).toBeCloseTo(1, 12);
    expect(dot(bodyZ, normalize(state.position))).toBeCloseTo(-1, 12);
  });

  it('边疆一号：只剩二级与飞船；二级推进剂按"理想 Δv − 上升段预算"反推', () => {
    const vehicle = getVehicleOrDefault('frontier-1');
    const sim = new Simulation(orbitConfig('frontier-1', 'cape-canaveral'));
    const state = sim.getVehicleState();
    expect(sim.flightPhase).toBe('flight');
    expect(state.activeStageIndex).toBe(1);
    expect(state.stages[0]!.attached).toBe(false);
    expect(state.stages[1]!.attached).toBe(true);
    expect(state.ignited).toBe(false);
    expect(state.flight.thrust).toBe(0);

    const performance = analyzeVehicle(vehicle);
    const stage = vehicle.stages[1]!;
    const propellant = state.stages[1]!.propellantMass;
    expect(propellant).toBeGreaterThan(0);
    expect(propellant).toBeLessThan(stage.propellantMass);
    // 用掉这些推进剂能得到的 Δv = 全箭理想 Δv − 飞船自带的 Δv − 上升段预算
    const upperDry = state.mass - propellant;
    const stageDeltaV = STANDARD_GRAVITY * stage.engine.ispVacuum * Math.log(state.mass / upperDry);
    expect(stageDeltaV).toBeCloseTo(performance.totalDeltaVVacuum - performance.payloadDeltaV - ASCENT_DELTA_V_BUDGET, 6);
    // 飞船自带的推进剂是满的
    expect(state.payloadPropellantMass).toBe(vehicle.payload.propellantMass);
  });

  it('天顶三号：只剩三级与卫星，整流罩已抛', () => {
    const sim = new Simulation(orbitConfig('zenith-3', 'kourou'));
    const state = sim.getVehicleState();
    expect(state.activeStageIndex).toBe(2);
    expect(state.stages.map((s) => s.attached)).toEqual([false, false, true]);
    expect(state.fairingAttached).toBe(false);
    expect(sim.getDebris()).toHaveLength(0);
  });

  it('之后的运动由同一个模拟器计算：滑行一圈后仍在约 200 km 的轨道上（只有极稀薄大气的阻力）', () => {
    const sim = new Simulation(orbitConfig('frontier-1', 'cape-canaveral'));
    const period = 2 * Math.PI * Math.sqrt((EARTH.RADIUS + ORBIT_START_ALTITUDE) ** 3 / EARTH.MU);
    const steps = Math.round(period / sim.dt);
    let minAltitude = Infinity;
    let maxAltitude = -Infinity;
    for (let i = 0; i < steps; i++) {
      sim.step();
      if (i % 500 === 0) {
        const altitude = length(sim.getVehicleState().body.position) - EARTH.RADIUS;
        minAltitude = Math.min(minAltitude, altitude);
        maxAltitude = Math.max(maxAltitude, altitude);
      }
    }
    expect(sim.flightPhase).toBe('flight');
    expect(maxAltitude).toBeLessThan(ORBIT_START_ALTITUDE + 50);
    // 200 km 处的阻力使轨道每圈下降几十到几百米
    expect(minAltitude).toBeGreaterThan(ORBIT_START_ALTITUDE - 1_500);
    expect(minAltitude).toBeLessThan(ORBIT_START_ALTITUDE);
    expect(sim.predictTrajectory()).toBeNull();
  });
});
