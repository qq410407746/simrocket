import { describe, expect, it } from 'vitest';
import { atmosphereAt } from '@/game/physics/atmosphere/standardAtmosphere';
import { stagnationHeatFlux } from '@/game/physics/thermodynamics/heating';
import {
  INCANDESCENCE_ONSET,
  PLASMA_FULL_FLUX,
  PLASMA_ONSET_FLUX,
  canopyRadius,
  incandescence,
  plasmaColor,
  plasmaIntensity,
} from './reentryVisuals';

describe('再入辉光由热流驱动', () => {
  it('热流低于起始值时没有辉光；随热流单调增强；到满值后饱和', () => {
    expect(plasmaIntensity(0)).toBe(0);
    expect(plasmaIntensity(PLASMA_ONSET_FLUX)).toBe(0);
    expect(plasmaIntensity(NaN)).toBe(0);
    let previous = 0;
    for (let flux = PLASMA_ONSET_FLUX * 1.05; flux <= PLASMA_FULL_FLUX; flux *= 1.2) {
      const intensity = plasmaIntensity(flux);
      expect(intensity).toBeGreaterThan(previous);
      expect(intensity).toBeLessThanOrEqual(1);
      previous = intensity;
    }
    expect(plasmaIntensity(PLASMA_FULL_FLUX)).toBe(1);
    expect(plasmaIntensity(PLASMA_FULL_FLUX * 10)).toBe(1);
  });

  it('不是"只看高度"：同一高度下，慢速没有辉光，轨道速度才有；真空中再快也没有', () => {
    const at = (altitude: number, speed: number) => plasmaIntensity(stagnationHeatFlux(atmosphereAt(altitude).density, speed, 1));
    // 60 km：伞降前的亚声速下落 vs 再入中的 6.5 km/s
    expect(at(60_000, 300)).toBe(0);
    expect(at(60_000, 6_500)).toBeGreaterThan(0.6);
    // 上升段：40 km、1.5 km/s 还没有辉光
    expect(at(40_000, 1_500)).toBeLessThan(0.15);
    // 200 km 轨道上以 7.8 km/s 飞行：稀薄到没有辉光
    expect(at(200_000, 7_800)).toBe(0);
    // 再入初期（90 km）开始出现，随着下降增强
    expect(at(90_000, 7_800)).toBeGreaterThan(0);
    expect(at(70_000, 7_600)).toBeGreaterThan(at(90_000, 7_800));
  });

  it('颜色随强度从暗红橙过渡到暖白色，各分量连续且在 [0, 1] 内', () => {
    const dim = plasmaColor(0);
    const hot = plasmaColor(1);
    // 弱辉光偏红：红 ≫ 蓝
    expect(dim[0]).toBeGreaterThan(3 * dim[2]);
    // 最强时接近（偏暖的）白色
    expect(hot[2]).toBeGreaterThan(0.75);
    expect(hot[0] - hot[1]).toBeLessThan(0.15);
    let previous = dim;
    for (let i = 1; i <= 100; i++) {
      const color = plasmaColor(i / 100);
      for (let c = 0; c < 3; c++) {
        expect(color[c]!).toBeGreaterThanOrEqual(0);
        expect(color[c]!).toBeLessThanOrEqual(1);
        expect(Math.abs(color[c]! - previous[c]!)).toBeLessThan(0.05);
      }
      previous = color;
    }
    expect(plasmaColor(5)).toEqual(hot);
    expect(plasmaColor(-1)).toEqual(dim);
  });
});

describe('高温表面的自发光', () => {
  it('低于约 800 K 不发光；温度越高越亮；先红后橙黄', () => {
    expect(incandescence(300)).toEqual([0, 0, 0]);
    expect(incandescence(INCANDESCENCE_ONSET)).toEqual([0, 0, 0]);
    expect(incandescence(NaN)).toEqual([0, 0, 0]);
    const dull = incandescence(950);
    const orange = incandescence(1_500);
    const bright = incandescence(2_200);
    // 刚开始发光时几乎只有红色
    expect(dull[0]).toBeGreaterThan(0);
    expect(dull[1]).toBeLessThan(0.15 * dull[0]);
    // 烧蚀温度（1500 K）：明显的橙红色
    expect(orange[0]).toBeGreaterThan(dull[0]);
    expect(orange[1] / orange[0]).toBeGreaterThan(dull[1] / dull[0]);
    expect(bright[0]).toBeGreaterThan(orange[0]);
    // 蓝色分量始终最小
    for (const color of [dull, orange, bright]) expect(color[2]).toBeLessThan(color[1]);
  });
});

describe('降落伞外观', () => {
  it('伞衣半径由阻力面积反算：2000 m² 的主伞半径约 28 m，60 m² 的减速伞约 4.9 m', () => {
    expect(canopyRadius(2_000)).toBeCloseTo(28.2, 1);
    expect(canopyRadius(60)).toBeCloseTo(4.9, 1);
    expect(canopyRadius(0)).toBe(0);
    expect(canopyRadius(-5)).toBe(0);
  });
});
