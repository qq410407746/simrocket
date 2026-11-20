/**
 * 并联助推器（联盟-2.1a 的四个捆绑助推器）：与芯级同时点火、按各自的质量流量耗尽、单独分离。
 */
import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { SEA_LEVEL, STANDARD_GRAVITY } from '../physics/constants';
import { idealDeltaV } from '../physics/propulsion/engine';
import { analyzeVehicle, liftoffMass, parallelPhase, stageBurnTime, stageThrust, vehicleHeight } from '../vehicles/analysis';
import {
  activePropulsion,
  combineEngines,
  configurationAero,
  configurationMassProperties,
  initialConfiguration,
  remainingDeltaV,
  stackHeight,
} from '../vehicles/configuration';
import { Simulation } from './Simulation';
import { createFlightConfig } from './startConditions';

const soyuz = getVehicleOrDefault('soyuz-2-1a');
const [boosters, core, third] = soyuz.stages;
const config = () => createFlightConfig(soyuz, launchSiteGeodetic(getLaunchSiteOrDefault('baikonur')));

/** 竖直飞到 untilTime [s]（或某个条件成立），返回模拟器。 */
const flyVertical = (until: (sim: Simulation) => boolean, maxTime = 400): Simulation => {
  const sim = new Simulation(config());
  sim.stage();
  while (sim.time < maxTime && sim.flightPhase !== 'destroyed' && !until(sim)) sim.step();
  return sim;
};

describe('并联助推器：构型与静态分析', () => {
  it('助推器组与芯级同时工作：合成推力 = 两者之和，合成比冲介于两者之间', () => {
    const propulsion = activePropulsion(soyuz, initialConfiguration(soyuz))!;
    expect(propulsion.units.map((u) => u.stageIndex)).toEqual([0, 1]);
    expect(propulsion.engineCount).toBe(1);
    expect(propulsion.engine.thrustVacuum).toBeCloseTo(boosters!.engine.thrustVacuum * 4 + core!.engine.thrustVacuum, 6);
    expect(propulsion.engine.nozzleExitArea).toBeCloseTo(boosters!.engine.nozzleExitArea * 4 + core!.engine.nozzleExitArea, 9);
    expect(propulsion.propellantMass).toBe(boosters!.propellantMass + core!.propellantMass);
    // 资料：起飞时 4 × 838.5 + 792.5 kN
    const seaLevel = stageThrust(boosters!, SEA_LEVEL.PRESSURE) + stageThrust(core!, SEA_LEVEL.PRESSURE);
    expect(seaLevel / 1e3).toBeCloseTo(4 * 838.5 + 792.5, 0);
    // 两台发动机真空比冲都是 319 s
    expect(combineEngines(propulsion.units).ispVacuum).toBeCloseTo(319, 6);
  });

  it('助推器绑在芯级旁边：不增加箭体高度，迎风面积按个数累加', () => {
    const full = initialConfiguration(soyuz);
    const noBoosters = { ...full, stages: full.stages.map((s, i) => (i === 0 ? { ...s, attached: false } : s)) };
    expect(stackHeight(soyuz, full)).toBeCloseTo(stackHeight(soyuz, noBoosters), 9);
    expect(vehicleHeight(soyuz)).toBeCloseTo(core!.geometry.length + third!.geometry.length + soyuz.stages[3]!.geometry.length + soyuz.payload.geometry.length, 9);
    const withArea = configurationAero(soyuz, full).referenceArea;
    const coreArea = configurationAero(soyuz, noBoosters).referenceArea;
    expect(withArea - coreArea).toBeCloseTo(4 * boosters!.aero.referenceArea, 6);
    // 抛掉助推器后质心基准不变（底面与芯级齐平），质量减少助推器的全部质量
    const a = configurationMassProperties(soyuz, full);
    const b = configurationMassProperties(soyuz, noBoosters);
    expect(a.mass - b.mass).toBeCloseTo(boosters!.dryMass + boosters!.propellantMass, 6);
  });

  it('Δv 分两段：并联段用合成比冲，芯级接着烧剩下的推进剂；与资料中的燃烧时间一致', () => {
    const phase = parallelPhase(boosters!, core!, boosters!.propellantMass, core!.propellantMass);
    // 资料：助推器燃烧 118 s、芯级 286 s（由推力、比冲、推进剂量算出的满推力时间与之相差不到 2%）
    expect(phase.time).toBeCloseTo(stageBurnTime(boosters!), 6);
    expect(Math.abs(phase.time - 118) / 118).toBeLessThan(0.02);
    expect(Math.abs(stageBurnTime(core!) - 286) / 286).toBeLessThan(0.02);
    expect(phase.burnedBooster).toBeCloseTo(boosters!.propellantMass, 6);

    const total = liftoffMass(soyuz);
    const burnout = total - phase.burnedBooster - phase.burnedCore;
    const coreIgnition = burnout - boosters!.dryMass;
    const coreLeft = core!.propellantMass - phase.burnedCore;
    let expected = idealDeltaV(319, total, burnout) + idealDeltaV(319, coreIgnition, coreIgnition - coreLeft);
    let mass = coreIgnition - coreLeft - core!.dryMass;
    for (const stage of soyuz.stages.slice(2)) {
      expected += idealDeltaV(stage.engine.ispVacuum, mass, mass - stage.propellantMass);
      mass -= stage.propellantMass + stage.dryMass;
    }
    expect(remainingDeltaV(soyuz, initialConfiguration(soyuz))).toBeCloseTo(expected, 6);
    expect(analyzeVehicle(soyuz).totalDeltaVVacuum).toBeCloseTo(expected, 6);
    // 资料：起飞质量 312 t
    expect(Math.abs(total - 312_000) / 312_000).toBeLessThan(0.005);
  });
});

describe('并联助推器：飞行中', () => {
  it('助推器先烧完：耗尽事件只针对助推器，芯级继续工作，推力降到芯级一台', () => {
    const sim = flyVertical((s) => (s.getVehicleState().stages[0]?.propellantMass ?? 1) === 0, 200);
    const state = sim.getVehicleState();
    expect(state.stages[0]!.propellantMass).toBe(0);
    expect(state.stages[1]!.propellantMass).toBeGreaterThan(0.5 * core!.propellantMass);
    // 燃尽时刻与满推力燃烧时间一致（发射台上牵制的时间很短）
    expect(Math.abs(sim.time - stageBurnTime(boosters!))).toBeLessThan(3);
    // 芯级在同一步里接着工作
    sim.step();
    const after = sim.getVehicleState();
    expect(after.flight.thrust).toBeGreaterThan(0.9 * core!.engine.thrustVacuum);
    expect(after.flight.thrust).toBeLessThan(1.01 * core!.engine.thrustVacuum);
    const depleted = sim.drainEvents().filter((e) => e.kind === 'depleted');
    expect(depleted.map((e) => e.stageIndex)).toEqual([0]);
  });

  it('抛掉助推器：生成四个分离体，总动量守恒；芯级不重新点火、推力不中断', () => {
    const sim = flyVertical((s) => (s.getVehicleState().stages[0]?.propellantMass ?? 1) === 0, 200);
    sim.drainEvents();
    const before = sim.getVehicleState();
    const massBefore = before.mass;
    const vBefore = before.body.velocity;
    sim.stage();
    const after = sim.getVehicleState();
    const debris = sim.getDebris().filter((d) => d.kind === 'stage' && d.stageIndex === 0);
    expect(debris).toHaveLength(4);
    expect(new Set(debris.map((d) => d.unit))).toEqual(new Set([0, 1, 2, 3]));
    expect(after.stages[0]!.attached).toBe(false);
    expect(after.ignited).toBe(true);
    expect(after.activeStageIndex).toBe(1);
    expect(massBefore - after.mass).toBeCloseTo(boosters!.dryMass, 3);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.kind === 'ignition')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'separation').map((e) => e.stageIndex)).toEqual([0]);
    // 动量守恒：分离前后（四个分离体 + 剩余箭体）总动量相同
    const each = boosters!.dryMass / 4;
    for (const axis of ['x', 'y', 'z'] as const) {
      const total = after.mass * after.body.velocity[axis] + debris.reduce((sum, d) => sum + each * d.velocity[axis], 0);
      expect(total).toBeCloseTo(massBefore * vBefore[axis], 0);
    }
    sim.step();
    expect(sim.getVehicleState().flight.thrust).toBeGreaterThan(0.9 * core!.engine.thrustVacuum);
  });

  it('助推器还有推进剂时也可以提前抛掉：剩余推进剂随分离体带走', () => {
    const sim = flyVertical((s) => s.time >= 60, 100);
    const left = sim.getVehicleState().stages[0]!.propellantMass;
    expect(left).toBeGreaterThan(0);
    const massBefore = sim.getVehicleState().mass;
    sim.stage();
    expect(massBefore - sim.getVehicleState().mass).toBeCloseTo(boosters!.dryMass + left, 3);
    const debris = sim.getDebris().filter((d) => d.kind === 'stage' && d.stageIndex === 0);
    expect(debris.reduce((sum, d) => sum + d.propellantMass, 0)).toBeCloseTo(left, 6);
  });

  it('起飞推重比由资料推力决定：约 1.35，发动机不能节流', () => {
    const perf = analyzeVehicle(soyuz);
    expect(perf.liftoffTwr).toBeCloseTo((4 * 838.5e3 + 792.5e3) / (liftoffMass(soyuz) * STANDARD_GRAVITY), 2);
    expect(boosters!.engine.minThrottle).toBe(1);
    expect(core!.engine.minThrottle).toBe(1);
  });
});
