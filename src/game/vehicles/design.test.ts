import { describe, expect, it } from 'vitest';
import { DESIGN_PARTS, designFromVehicle } from '@/data/designParts';
import { getVehicleOrDefault, VEHICLE_CATALOG } from '@/data/vehicles';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { Simulation } from '../simulation/Simulation';
import { createFlightConfig } from '../simulation/startConditions';
import { analyzeVehicle, computeMassProperties, liftoffMass } from './analysis';
import { compileDesign, parseDesign, parseDesignBackup } from './design';

const draft = () => designFromVehicle(getVehicleOrDefault('frontier-1'), 'custom-test');
describe('火箭图纸与真实飞行', () => {
  it.each(VEHICLE_CATALOG)('$nameZh复制后性能和质量完全一致，修改定义不污染目录', (original) => {
    const vehicle = compileDesign(designFromVehicle(original, 'custom-copy'), DESIGN_PARTS).vehicle!;
    const expected = analyzeVehicle(original), actual = analyzeVehicle(vehicle);
    expect(actual.liftoffMass).toBe(expected.liftoffMass);
    expect(actual.liftoffTwr).toBe(expected.liftoffTwr);
    expect(actual.totalDeltaVVacuum).toBe(expected.totalDeltaVVacuum);
    expect(vehicle.payload).toEqual(original.payload);
    expect(vehicle.stages[0]).not.toBe(original.stages[0]);
    expect(vehicle.stages[0]!.engine).not.toBe(original.stages[0]!.engine);
    expect(vehicle.payload.structure.maxBendingLoad).toBe(Infinity);
  });
  it('重组级数后质量、分离后的质量与重复模块标识正确', () => {
    const d = { ...draft(), stages: ['frontier-1-s1', 'frontier-1-s2', 'frontier-1-s2'] };
    const v = compileDesign(d, DESIGN_PARTS).vehicle!;
    expect(new Set(v.stages.map((s) => s.id)).size).toBe(3);
    expect(liftoffMass(v)).toBe(liftoffMass(getVehicleOrDefault('frontier-1')) + 99_500);
    const mass = computeMassProperties(v, { stageAttached: [false, true, true], stagePropellant: [0, 95_000, 95_000], payloadPropellant: 1200, fairingAttached: false });
    expect(mass.mass).toBe(2 * 99_500 + 7700);
    expect(compileDesign(d, DESIGN_PARTS).warnings).toEqual([]);
  });
  it.each([
    null, {}, { ...draft(), version: 2 }, { ...draft(), name: '' }, { ...draft(), name: '\u0000' },
    { ...draft(), name: '长'.repeat(41) }, { ...draft(), id: 'frontier-1' },
    { ...draft(), stages: [] }, { ...draft(), stages: Array(5).fill('frontier-1-s1') },
    { ...draft(), stages: ['不存在'] }, { ...draft(), payload: '不存在' }, { ...draft(), stages: [NaN] },
  ])('拒绝无效图纸 %#', (d) => {
    expect(parseDesign(d, DESIGN_PARTS)).toBeNull();
    expect(compileDesign(d, DESIGN_PARTS).vehicle).toBeNull();
  });
  it('接口不兼容拒绝保存；低推重比只警告，不伪造推力', () => {
    expect(compileDesign({ ...draft(), payload: 'egret-s' }, DESIGN_PARTS).errors[0]).toContain('接口直径');
    const result = compileDesign({ ...draft(), stages: ['frontier-1-s2', 'frontier-1-s1'] }, DESIGN_PARTS);
    expect(result.vehicle).not.toBeNull();
    expect(result.warnings[0]).toContain('无法');
    expect(analyzeVehicle(result.vehicle!).liftoffTwr).toBeLessThan(1);
  });
  it('备份整体拒绝未知版本、重复标识、容量超限及不兼容模块', () => {
    expect(parseDesignBackup({ version: 1, designs: [draft()] }, DESIGN_PARTS)).toEqual([draft()]);
    for (const raw of [{ version: 2, designs: [] }, { version: 1, designs: [draft(), draft()] },
      { version: 1, designs: Array(21).fill(draft()) }, { version: 1, designs: [{ ...draft(), payload: 'egret-s' }] }]) {
      expect(parseDesignBackup(raw, DESIGN_PARTS)).toBeNull();
    }
  });
  it('自定义小型火箭用同一Simulation真实耗料起飞，内置型号不改变', () => {
    const original = getVehicleOrDefault('meteor-s');
    const v = compileDesign(designFromVehicle(original, 'custom-fly'), DESIGN_PARTS).vehicle!;
    const sim = new Simulation(createFlightConfig(v, launchSiteGeodetic(getLaunchSiteOrDefault('jiuquan'))));
    sim.stage(); sim.setThrottle(1);
    for (let i = 0; i < 500; i++) sim.step();
    const state = sim.getVehicleState();
    expect(state.phase).toBe('flight');
    expect(state.mass).toBeLessThan(liftoffMass(v));
    expect(state.stages[0]!.propellantMass).toBeLessThan(v.stages[0]!.propellantMass);
    expect(original.stages[0]!.propellantMass).toBe(10_500);
  });
});
