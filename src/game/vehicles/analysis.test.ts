import { describe, expect, it } from 'vitest';
import { STANDARD_GRAVITY } from '../physics/constants';
import { analyzeVehicle, computeMassProperties, liftoffMass, vehicleHeight } from './analysis';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { REFERENCE_VEHICLES } from '@/data/testing/referenceVehicles';
import type { VehicleDefinition } from './types';

const fullInput = (v: VehicleDefinition) => ({
  stagePropellant: v.stages.map((s) => s.propellantMass),
  stageAttached: v.stages.map(() => true),
  payloadPropellant: v.payload.propellantMass,
  fairingAttached: v.payload.kind === 'satellite',
});

describe('飞行器目录自洽性', () => {
  it.each(VEHICLE_CATALOG.map((v) => [v.id, v] as const))('%s：参数物理上合理', (_id, vehicle) => {
    const perf = analyzeVehicle(vehicle);
    // 能离开发射台，且不至于离谱
    expect(perf.liftoffTwr).toBeGreaterThan(1.15);
    expect(perf.liftoffTwr).toBeLessThan(2.0);
    for (const s of perf.stages) {
      expect(s.burnoutMass).toBeGreaterThan(0);
      expect(s.ignitionMass).toBeGreaterThan(s.burnoutMass);
      expect(s.ispSeaLevel).toBeLessThan(s.ispVacuum);
      expect(s.deltaVVacuum).toBeGreaterThan(0);
      expect(s.burnTime).toBeGreaterThan(30);
    }
    for (const stage of vehicle.stages) {
      // 结构系数（干质量 / 满载质量）在真实液体火箭的范围内。
      // 飞船的服务舱（联盟 MS，推力只有几 kN）不是运载火箭的一级，不在此列。
      const structural = stage.dryMass / (stage.dryMass + stage.propellantMass);
      if (stage.engine.thrustVacuum * stage.engineCount > 50e3) {
        expect(structural).toBeGreaterThan(0.03);
        expect(structural).toBeLessThan(0.25);
      }
      expect(stage.engine.minThrottle).toBeGreaterThan(0);
      expect(stage.engine.minThrottle).toBeLessThanOrEqual(1);
    }
  });

  it('轨道级火箭的理想 Δv 足以进入近地轨道（> 9.4 km/s），亚轨道火箭不足', () => {
    expect(analyzeVehicle(getVehicleOrDefault('soyuz-2-1a')).totalDeltaVVacuum).toBeGreaterThan(9_400);
    expect(analyzeVehicle(getVehicleOrDefault('atlas-v-401')).totalDeltaVVacuum).toBeGreaterThan(13_000);
    expect(analyzeVehicle(getVehicleOrDefault('mercury-redstone')).totalDeltaVVacuum).toBeLessThan(7_000);
  });

  it('无效 id 回退到默认飞行器', () => {
    expect(getVehicleOrDefault('does-not-exist').id).toBe('soyuz-2-1a');
  });
});

describe('性能分析', () => {
  const frontier = REFERENCE_VEHICLES['frontier-1'];

  it('起飞质量为各部分之和', () => {
    expect(liftoffMass(frontier)).toBe(25_000 + 400_000 + 4_500 + 95_000 + 6_500 + 1_200);
  });

  it('逐级质量衔接：上一级燃尽质量 − 该级干质量 = 下一级点火质量', () => {
    const perf = analyzeVehicle(frontier);
    const [s1, s2] = perf.stages;
    expect(s1 && s2).toBeTruthy();
    expect(s2!.ignitionMass).toBe(s1!.burnoutMass - 25_000);
    expect(s2!.burnoutMass).toBe(4_500 + 6_500 + 1_200);
  });

  it('Δv 与手算一致', () => {
    const perf = analyzeVehicle(frontier);
    const m0 = 532_200;
    expect(perf.stages[0]!.deltaVVacuum).toBeCloseTo(STANDARD_GRAVITY * 315 * Math.log(m0 / (m0 - 400_000)), 6);
    expect(perf.payloadDeltaV).toBeCloseTo(STANDARD_GRAVITY * 300 * Math.log(7_700 / 6_500), 6);
  });

  it('带整流罩的火箭：整流罩计入一级质量，二级点火前扣除', () => {
    const zenith = REFERENCE_VEHICLES['zenith-3'];
    const perf = analyzeVehicle(zenith);
    const [s1, s2] = perf.stages;
    expect(s1!.ignitionMass).toBe(liftoffMass(zenith));
    expect(s2!.ignitionMass).toBe(s1!.burnoutMass - 30_000 - 1_900);
  });
});

describe('质量特性', () => {
  const frontier = REFERENCE_VEHICLES['frontier-1'];

  it('满载总质量等于起飞质量，质心位于箭体内部', () => {
    const props = computeMassProperties(frontier, fullInput(frontier));
    expect(props.mass).toBe(liftoffMass(frontier));
    expect(props.centerOfMassHeight).toBeGreaterThan(0);
    expect(props.centerOfMassHeight).toBeLessThan(vehicleHeight(frontier));
  });

  it('一级推进剂消耗后质心上移', () => {
    const full = computeMassProperties(frontier, fullInput(frontier));
    const drained = computeMassProperties(frontier, {
      ...fullInput(frontier),
      stagePropellant: [0, frontier.stages[1]!.propellantMass],
    });
    expect(drained.mass).toBe(full.mass - 400_000);
    expect(drained.centerOfMassHeight).toBeGreaterThan(full.centerOfMassHeight);
  });

  it('一级分离后高度基准变为二级底面', () => {
    const props = computeMassProperties(frontier, {
      ...fullInput(frontier),
      stageAttached: [false, true],
    });
    expect(props.mass).toBe(4_500 + 95_000 + 6_500 + 1_200);
    expect(props.centerOfMassHeight).toBeLessThan(frontier.stages[1]!.geometry.length + frontier.payload.geometry.length);
  });

  it('单一均匀部件的质心在几何中心（解析验证）', () => {
    const single: VehicleDefinition = {
      ...frontier,
      stages: [{ ...frontier.stages[0]!, dryMass: 1000, propellantMass: 0 }],
      payload: { ...frontier.payload, dryMass: 1e-9, propellantMass: 0 },
    };
    const props = computeMassProperties(single, {
      stagePropellant: [0],
      stageAttached: [true],
      payloadPropellant: 0,
      fairingAttached: false,
    });
    expect(props.centerOfMassHeight).toBeCloseTo(20, 6);
  });

  it('抛整流罩减少质量', () => {
    const zenith = REFERENCE_VEHICLES['zenith-3'];
    const withFairing = computeMassProperties(zenith, fullInput(zenith));
    const without = computeMassProperties(zenith, { ...fullInput(zenith), fairingAttached: false });
    expect(withFairing.mass - without.mass).toBe(1_900);
  });
});
