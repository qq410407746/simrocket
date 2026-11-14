import { describe, expect, it } from 'vitest';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { vehicleHeight, vehicleMaxDiameter } from '@/game/vehicles/analysis';
import { buildRocketLayout, nozzleArrangement } from './rocketLayout';

describe('火箭外形生成', () => {
  it.each(VEHICLE_CATALOG.map((v) => [v.id, v] as const))('%s：模型尺寸与物理定义一致', (_id, vehicle) => {
    const layout = buildRocketLayout(vehicle);
    expect(layout.height).toBeCloseTo(vehicleHeight(vehicle), 9);
    expect(layout.maxRadius).toBeCloseTo(vehicleMaxDiameter(vehicle) / 2, 9);
    expect(layout.sections).toHaveLength(vehicle.stages.length + 1);

    // 分段首尾相接
    let y = 0;
    for (const section of layout.sections) {
      expect(section.baseY).toBeCloseTo(y, 9);
      y += section.length;
    }

    // 所有部件都在各自分段的高度范围内，且数值有限
    for (const section of layout.sections) {
      for (const part of section.parts) {
        if (part.kind === 'lathe') {
          for (const [r, h] of part.profile) {
            expect(Number.isFinite(r) && Number.isFinite(h)).toBe(true);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(h).toBeGreaterThanOrEqual(-1e-9);
            expect(h).toBeLessThanOrEqual(section.length + 1e-9);
          }
        }
      }
    }
  });

  it('底级喷管数量等于发动机台数', () => {
    for (const vehicle of VEHICLE_CATALOG) {
      const nozzles = buildRocketLayout(vehicle).sections[0]!.parts.filter((p) => p.kind === 'nozzle');
      expect(nozzles).toHaveLength(vehicle.stages[0]!.engineCount);
    }
  });

  it('带整流罩的载荷使用整流罩外形，飞船使用返回舱外形', () => {
    const zenith = VEHICLE_CATALOG.find((v) => v.payload.kind === 'satellite')!;
    const frontier = VEHICLE_CATALOG.find((v) => v.id === 'frontier-1')!;
    const fairing = buildRocketLayout(zenith).sections.at(-1)!;
    const capsule = buildRocketLayout(frontier).sections.at(-1)!;
    expect(fairing.length).toBe(zenith.payload.kind === 'satellite' ? zenith.payload.fairing.geometry.length : NaN);
    expect(capsule.parts.some((p) => p.kind === 'lathe' && p.material === 'heatShield')).toBe(true);
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
