import { describe, expect, it } from 'vitest';
import { DESIGN_PARTS, designFromVehicle } from '@/data/designParts';
import { getVehicleOrDefault, VEHICLE_CATALOG } from '@/data/vehicles';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { Simulation } from '../simulation/Simulation';
import { createFlightConfig } from '../simulation/startConditions';
import { analyzeVehicle, computeMassProperties, liftoffMass } from './analysis';
import { compileDesign, parseDesign, parseDesignBackup } from './design';

const draft = () => designFromVehicle(getVehicleOrDefault('soyuz-2-1a'), 'custom-test');
const atlas = () => designFromVehicle(getVehicleOrDefault('atlas-v-401'), 'custom-atlas');
describe('火箭图纸与真实飞行', () => {
  it.each(VEHICLE_CATALOG)('$nameZh复制后性能和质量完全一致，修改定义不污染目录', (original) => {
    const result = compileDesign(designFromVehicle(original, 'custom-copy'), DESIGN_PARTS);
    const vehicle = result.vehicle!;
    const expected = analyzeVehicle(original), actual = analyzeVehicle(vehicle);
    expect(actual.liftoffMass).toBe(expected.liftoffMass);
    expect(actual.liftoffTwr).toBe(expected.liftoffTwr);
    expect(actual.totalDeltaVVacuum).toBe(expected.totalDeltaVVacuum);
    expect(vehicle.payload).toEqual(original.payload);
    expect(vehicle.stages[0]).not.toBe(original.stages[0]);
    expect(vehicle.stages[0]!.engine).not.toBe(original.stages[0]!.engine);
    expect(vehicle.stages.map((s) => s.parallel)).toEqual(original.stages.map((s) => s.parallel));
    // 原样复制的原型：直径不同的相邻两级之间是原配的级间段，不需要警告
    expect(result.warnings).toEqual([]);
  });
  it('重组级数后质量、分离后的质量与重复模块标识正确', () => {
    // 两个半人马座上下相接：直径相同（3.05 m），没有原配级间段也允许
    const d = { ...atlas(), stages: ['atlas-v-ccb', 'atlas-v-centaur', 'atlas-v-centaur'] };
    const v = compileDesign(d, DESIGN_PARTS).vehicle!;
    expect(new Set(v.stages.map((s) => s.id)).size).toBe(3);
    expect(liftoffMass(v)).toBe(liftoffMass(getVehicleOrDefault('atlas-v-401')) + 2_247 + 20_830);
    const mass = computeMassProperties(v, { stageAttached: [false, true, true], stagePropellant: [0, 20_830, 20_830], payloadPropellant: 0, fairingAttached: false });
    expect(mass.mass).toBe(2 * (2_247 + 20_830) + 1_800);
    expect(compileDesign(d, DESIGN_PARTS).warnings).toEqual([]);
  });
  it.each([
    null, {}, { ...draft(), version: 2 }, { ...draft(), name: '' }, { ...draft(), name: '\u0000' },
    { ...draft(), name: '长'.repeat(41) }, { ...draft(), id: 'soyuz-2-1a' },
    { ...draft(), stages: [] }, { ...draft(), stages: Array(5).fill('atlas-v-centaur') },
    { ...draft(), stages: ['不存在'] }, { ...draft(), payload: '不存在' }, { ...draft(), stages: [NaN] },
  ])('拒绝无效图纸 %#', (d) => {
    expect(parseDesign(d, DESIGN_PARTS)).toBeNull();
    expect(compileDesign(d, DESIGN_PARTS).vehicle).toBeNull();
  });
  it('接口不兼容拒绝保存；低推重比只警告，不伪造推力', () => {
    // 联盟号的载荷放在宇宙神的半人马座上：2.72 m 的接口对 3.05 m，没有转接结构
    expect(compileDesign({ ...atlas(), payload: 'soyuz-ms-descent' }, DESIGN_PARTS).errors[0]).toContain('接口直径');
    // 宇宙神芯级（3.81 m）上直接叠联盟号第三级（2.66 m）
    expect(compileDesign({ ...draft(), stages: ['atlas-v-ccb', 'soyuz-2-1a-block-i', 'soyuz-ms-service'] }, DESIGN_PARTS).errors[0]).toContain('接口直径');
    const result = compileDesign({ ...atlas(), stages: ['atlas-v-centaur', 'atlas-v-centaur'] }, DESIGN_PARTS);
    expect(result.vehicle).not.toBeNull();
    expect(result.warnings[0]).toContain('无法');
    expect(analyzeVehicle(result.vehicle!).liftoffTwr).toBeLessThan(1);
  });
  it('并联助推器只能绑在原配的芯级下面', () => {
    for (const stages of [
      ['soyuz-2-1a-boosters'],
      ['soyuz-2-1a-boosters', 'soyuz-2-1a-block-i', 'soyuz-ms-service'],
      ['soyuz-2-1a-core', 'soyuz-2-1a-boosters', 'soyuz-2-1a-block-i'],
    ]) {
      const result = compileDesign({ ...draft(), stages }, DESIGN_PARTS);
      expect(result.vehicle, stages.join(',')).toBeNull();
      expect(result.errors[0]).toContain('并联助推器');
    }
    // 去掉第三级也可以：助推器 + 芯级 + 服务舱（芯级 2.95 m 对服务舱 2.72 m 不是原配，会被拒绝）
    expect(compileDesign({ ...draft(), stages: ['soyuz-2-1a-boosters', 'soyuz-2-1a-core', 'soyuz-ms-service'] }, DESIGN_PARTS).errors[0]).toContain('接口直径');
  });
  it('备份整体拒绝未知版本、重复标识、容量超限及不兼容模块', () => {
    expect(parseDesignBackup({ version: 1, designs: [draft()] }, DESIGN_PARTS)).toEqual([draft()]);
    for (const raw of [{ version: 2, designs: [] }, { version: 1, designs: [draft(), draft()] },
      { version: 1, designs: Array(21).fill(draft()) }, { version: 1, designs: [{ ...atlas(), payload: 'soyuz-ms-descent' }] }]) {
      expect(parseDesignBackup(raw, DESIGN_PARTS)).toBeNull();
    }
  });
  it('自定义小型火箭用同一Simulation真实耗料起飞，内置型号不改变', () => {
    const original = getVehicleOrDefault('mercury-redstone');
    const before = original.stages[0]!.propellantMass;
    const v = compileDesign(designFromVehicle(original, 'custom-fly'), DESIGN_PARTS).vehicle!;
    const sim = new Simulation(createFlightConfig(v, launchSiteGeodetic(getLaunchSiteOrDefault('cape-canaveral'))));
    sim.stage(); sim.setThrottle(1);
    for (let i = 0; i < 500; i++) sim.step();
    const state = sim.getVehicleState();
    expect(state.phase).toBe('flight');
    expect(state.mass).toBeLessThan(liftoffMass(v));
    expect(state.stages[0]!.propellantMass).toBeLessThan(v.stages[0]!.propellantMass);
    expect(original.stages[0]!.propellantMass).toBe(before);
  });
});
