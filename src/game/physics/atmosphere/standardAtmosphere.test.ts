import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../constants';
import { ATMOSPHERE_TOP, atmosphereAt, sampleAtmosphere } from './standardAtmosphere';

/** 相对误差。 */
const rel = (actual: number, expected: number): number => Math.abs(actual - expected) / expected;

describe('标准大气 USSA76：0–86 km 解析段', () => {
  it('海平面：288.15 K、101325 Pa、1.225 kg/m³、声速 340.3 m/s', () => {
    const a = atmosphereAt(0);
    expect(a.temperature).toBeCloseTo(SEA_LEVEL.TEMPERATURE, 10);
    expect(a.pressure).toBeCloseTo(SEA_LEVEL.PRESSURE, 6);
    expect(a.density).toBeCloseTo(SEA_LEVEL.DENSITY, 4);
    expect(a.speedOfSound).toBeCloseTo(340.29, 1);
  });

  // 参考值：U.S. Standard Atmosphere 1976 表列值，按几何高度查表（NOAA-S/T 76-1562, Table I）
  it.each([
    [1_000, 281.651, 8.9876e4, 1.1117],
    [5_000, 255.676, 5.4048e4, 7.3643e-1],
    [10_000, 223.252, 2.6499e4, 4.1351e-1],
    [15_000, 216.65, 1.2111e4, 1.9476e-1],
    [20_000, 216.65, 5.5293e3, 8.891e-2],
    [30_000, 226.509, 1.197e3, 1.841e-2],
    [40_000, 250.35, 2.8714e2, 3.9957e-3],
    [50_000, 270.65, 7.9779e1, 1.0269e-3],
    [60_000, 247.021, 2.1958e1, 3.0968e-4],
    [70_000, 219.585, 5.2209, 8.2829e-5],
    [80_000, 198.639, 1.0524, 1.8458e-5],
  ])('高度 %d m：T、p、ρ 与标准表一致（误差 < 0.02%%）', (z, temperature, pressure, density) => {
    const a = atmosphereAt(z);
    expect(rel(a.temperature, temperature)).toBeLessThan(2e-4);
    expect(rel(a.pressure, pressure)).toBeLessThan(2e-4);
    expect(rel(a.density, density)).toBeLessThan(2e-4);
  });

  it('对流层顶以上的平流层下部为等温层（11–20 km 位势高度）', () => {
    expect(atmosphereAt(12_000).temperature).toBeCloseTo(216.65, 6);
    expect(atmosphereAt(19_000).temperature).toBeCloseTo(216.65, 6);
  });

  it('层与层之间压力、温度连续', () => {
    // 位势高度 11 km 对应几何高度约 11019 m
    for (const z of [11_019.1, 20_063.1, 32_161.9, 47_350.1, 51_412.5, 71_802.0]) {
      const below = atmosphereAt(z - 0.5);
      const above = atmosphereAt(z + 0.5);
      expect(rel(above.pressure, below.pressure)).toBeLessThan(2e-4);
      expect(Math.abs(above.temperature - below.temperature)).toBeLessThan(0.01);
    }
  });

  it('满足理想气体状态方程 p = ρ·R·T', () => {
    for (const z of [0, 8_000, 25_000, 60_000]) {
      const a = atmosphereAt(z);
      expect(rel(a.pressure, a.density * 287.053 * a.temperature)).toBeLessThan(1e-5);
    }
  });
});

describe('标准大气 USSA76：86 km 以上表列段', () => {
  it('86 km 处与解析段连续，且与标准表一致', () => {
    const below = atmosphereAt(85_999.9);
    const above = atmosphereAt(86_000.1);
    expect(rel(above.density, below.density)).toBeLessThan(1e-4);
    expect(rel(above.pressure, below.pressure)).toBeLessThan(1e-4);
    expect(rel(above.density, 6.958e-6)).toBeLessThan(5e-3);
    expect(rel(above.pressure, 0.37338)).toBeLessThan(5e-3);
  });

  it.each([
    [100_000, 5.604e-7, 3.2011e-2],
    [200_000, 2.541e-10, 8.4736e-5],
    [400_000, 2.803e-12, 1.4518e-6],
    [1_000_000 - 1, 3.561e-15, 7.5138e-9],
  ])('高度 %d m 的节点值', (z, density, pressure) => {
    const a = atmosphereAt(z);
    expect(rel(a.density, density)).toBeLessThan(1e-3);
    expect(rel(a.pressure, pressure)).toBeLessThan(1e-3);
  });

  it('节点之间按指数规律插值（对数线性）', () => {
    const mid = atmosphereAt(250_000 + 25_000).density;
    expect(mid).toBeCloseTo(Math.sqrt(6.073e-11 * 1.916e-11), 14);
  });

  it('卡门线处密度约为海平面的两百万分之一', () => {
    const ratio = atmosphereAt(100_000).density / SEA_LEVEL.DENSITY;
    expect(ratio).toBeGreaterThan(3e-7);
    expect(ratio).toBeLessThan(6e-7);
  });
});

describe('标准大气：全局性质', () => {
  it('密度与压力随高度严格单调递减', () => {
    let prev = atmosphereAt(-500);
    for (let z = 0; z < ATMOSPHERE_TOP; z += 1_337) {
      const a = atmosphereAt(z);
      expect(a.density).toBeLessThan(prev.density);
      expect(a.pressure).toBeLessThan(prev.pressure);
      prev = a;
    }
  });

  it('模型上界以上为真空', () => {
    const a = atmosphereAt(ATMOSPHERE_TOP);
    expect(a.density).toBe(0);
    expect(a.pressure).toBe(0);
    expect(atmosphereAt(35_786_000).density).toBe(0);
  });

  it('异常输入不产生 NaN：负高度被钳制，NaN 按真空处理', () => {
    for (const z of [-1e9, -100, NaN, Infinity]) {
      const a = atmosphereAt(z);
      for (const v of Object.values(a)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(atmosphereAt(-1e9).density).toBe(atmosphereAt(-2_000).density);
  });

  it('sampleAtmosphere 复用输出对象', () => {
    const out = { density: 0, pressure: 0, temperature: 0, speedOfSound: 0 };
    expect(sampleAtmosphere(5_000, out)).toBe(out);
    expect(out.density).toBeCloseTo(atmosphereAt(5_000).density, 15);
  });
});
