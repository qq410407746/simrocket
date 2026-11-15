import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { vehicleHeight, vehicleMaxDiameter } from '@/game/vehicles/analysis';
import { buildRocketLayout, nozzleArrangement } from './rocketLayout';

describe('火箭外形生成', () => {
  it.each(VEHICLE_CATALOG.map((v) => [v.id, v] as const))('%s：模型尺寸与物理定义一致', (_id, vehicle) => {
    const layout = buildRocketLayout(vehicle);
    expect(layout.height).toBeCloseTo(vehicleHeight(vehicle), 9);
    expect(layout.maxRadius).toBeCloseTo(vehicleMaxDiameter(vehicle) / 2, 9);

    // 推进级分段首尾相接，载荷相关的分段都从最上面一级的顶部开始
    const stages = layout.sections.filter((s) => s.kind === 'stage');
    expect(stages).toHaveLength(vehicle.stages.length);
    let y = 0;
    stages.forEach((section, i) => {
      expect(section.stageIndex).toBe(i);
      expect(section.baseY).toBeCloseTo(y, 9);
      expect(section.length).toBe(vehicle.stages[i]!.geometry.length);
      y += section.length;
    });
    for (const section of layout.sections.filter((s) => s.kind !== 'stage')) expect(section.baseY).toBeCloseTo(y, 9);

    // 所有部件都在各自分段的高度范围内（级间段允许超出名义长度），且数值有限
    for (const section of layout.sections) {
      for (const part of section.parts) {
        if (part.kind !== 'lathe') continue;
        for (const [r, h] of part.profile) {
          expect(Number.isFinite(r) && Number.isFinite(h)).toBe(true);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(h).toBeGreaterThanOrEqual(-1e-9);
          expect(h).toBeLessThanOrEqual(section.length + section.overhang + 1e-9);
        }
      }
    }
  });

  it('每一级的喷管数量与尾焰出口数量等于发动机台数', () => {
    for (const vehicle of VEHICLE_CATALOG) {
      const layout = buildRocketLayout(vehicle);
      vehicle.stages.forEach((stage, i) => {
        const section = layout.sections.find((s) => s.kind === 'stage' && s.stageIndex === i)!;
        expect(section.parts.filter((p) => p.kind === 'nozzle')).toHaveLength(stage.engineCount);
        expect(section.plumes).toHaveLength(stage.engineCount);
      });
    }
  });

  it('级间段属于下面一级，长度覆盖上面一级的发动机舱', () => {
    const frontier = VEHICLE_CATALOG.find((v) => v.id === 'frontier-1')!;
    const [first, second] = buildRocketLayout(frontier).sections;
    expect(first!.overhang).toBeGreaterThan(1);
    expect(second!.overhang).toBe(0);
    // 上面级的喷管完全位于被级间段包住的高度范围内
    for (const part of second!.parts) {
      if (part.kind === 'nozzle') expect(part.y + part.length).toBeLessThanOrEqual(first!.overhang);
    }
  });

  it('飞船使用返回舱外形；有发动机的飞船带尾焰出口，无动力返回舱没有', () => {
    const frontier = VEHICLE_CATALOG.find((v) => v.id === 'frontier-1')!;
    const meteor = VEHICLE_CATALOG.find((v) => v.id === 'meteor-s')!;
    const layout = buildRocketLayout(frontier);
    const capsule = layout.sections.find((s) => s.kind === 'capsule')!;
    expect(capsule.plumes).toHaveLength(1);
    // 防热大底是单独的分段（可以被抛掉），与舱体底面在同一高度；舱体自己带一块舱底结构
    const shield = layout.sections.find((s) => s.kind === 'heat-shield')!;
    expect(shield.parts.some((p) => p.kind === 'lathe' && p.material === 'heatShield')).toBe(true);
    expect(shield.baseY).toBe(capsule.baseY);
    expect(shield.length).toBeLessThan(capsule.length * 0.2);
    expect(capsule.parts.some((p) => p.kind === 'lathe' && p.material === 'heatShield')).toBe(false);
    expect(capsule.parts.some((p) => p.kind === 'lathe' && p.material === 'metal' && p.profile[0]?.[0] === 0)).toBe(true);
    expect(buildRocketLayout(meteor).sections.find((s) => s.kind === 'capsule')!.plumes).toHaveLength(0);
  });

  it('卫星构型：卫星本体 + 两个互补的整流罩半罩', () => {
    const zenith = VEHICLE_CATALOG.find((v) => v.payload.kind === 'satellite')!;
    const layout = buildRocketLayout(zenith);
    const halves = layout.sections.filter((s) => s.kind === 'fairing');
    expect(halves.map((s) => s.half).sort()).toEqual([-1, 1]);
    expect(layout.sections.filter((s) => s.kind === 'satellite')).toHaveLength(1);
    const fairingLength = zenith.payload.kind === 'satellite' ? zenith.payload.fairing.geometry.length : NaN;
    for (const half of halves) {
      expect(half.length).toBe(fairingLength);
      // 每个半罩的回转张角略小于半圈，两者合起来不重叠
      for (const part of half.parts) {
        if (part.kind === 'lathe') {
          expect(part.phiLength).toBeLessThan(Math.PI);
          expect(part.phiLength).toBeGreaterThan(Math.PI * 0.98);
        }
      }
    }
    const starts = halves.map((s) => {
      const first = s.parts[0];
      return first?.kind === 'lathe' ? (first.phiStart ?? NaN) : NaN;
    });
    expect(Math.abs(starts[0]! - starts[1]!)).toBeCloseTo(Math.PI, 9);
    // 卫星能装进整流罩
    const satellite = layout.sections.find((s) => s.kind === 'satellite')!;
    expect(satellite.length).toBeLessThan(fairingLength);
  });
});

describe('喷管排布', () => {
  it('单台发动机居中', () => {
    const { positions } = nozzleArrangement(1, 0.5, 1.9);
    expect(positions).toEqual([[0, 0]]);
  });

  it.each([2, 3, 4, 5, 7, 9])('%d 台：互不重叠且都在箭体轮廓内', (count) => {
    const bodyRadius = 1.9;
    const { positions, radius } = nozzleArrangement(count, 0.52, bodyRadius);
    expect(positions).toHaveLength(count);
    for (let i = 0; i < positions.length; i++) {
      const [x, z] = positions[i]!;
      expect(Math.hypot(x, z) + radius).toBeLessThanOrEqual(bodyRadius + 1e-9);
      for (let j = i + 1; j < positions.length; j++) {
        const [x2, z2] = positions[j]!;
        expect(Math.hypot(x - x2, z - z2)).toBeGreaterThanOrEqual(2 * radius - 1e-9);
      }
    }
  });

  it('喷管过大时缩小显示半径', () => {
    const { radius } = nozzleArrangement(1, 5, 1.9);
    expect(radius).toBeLessThan(1.9);
  });
});
