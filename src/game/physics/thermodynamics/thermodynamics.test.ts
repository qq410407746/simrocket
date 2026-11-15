import { describe, expect, it } from 'vitest';
import { atmosphereAt } from '../atmosphere/standardAtmosphere';
import {
  AIR_SPECIFIC_HEAT,
  CYLINDER_FRACTION,
  LEEWARD_FRACTION,
  SIDEWALL_FRACTION,
  SPACE_SINK_TEMPERATURE,
  STEFAN_BOLTZMANN,
  SUTTON_GRAVES_EARTH,
  environmentTemperature,
  exposure,
  hotWallFactor,
  radiativeEquilibriumTemperature,
  radiativeHeatFlux,
  stagnationHeatFlux,
} from './heating';
import {
  type ThermalSurfaceProperties,
  ablatorFraction,
  createThermalZoneState,
  stepThermalZone,
  thermalMargin,
} from './thermalZone';

const metal: ThermalSurfaceProperties = {
  material: '测试金属',
  emissivity: 0.8,
  surfaceHeatCapacity: 8_000,
  interiorHeatCapacity: 20_000,
  conductance: 50,
  maxSurfaceTemperature: 900,
  maxInteriorTemperature: 600,
  ablator: null,
};

const ablative: ThermalSurfaceProperties = {
  material: '测试烧蚀材料',
  emissivity: 0.85,
  surfaceHeatCapacity: 6_000,
  interiorHeatCapacity: 20_000,
  conductance: 6,
  maxSurfaceTemperature: 2_400,
  maxInteriorTemperature: 520,
  ablator: { temperature: 1_600, heatOfAblation: 2.5e7, arealMass: 5 },
};

/** 以恒定条件推进一段时间。 */
const soak = (
  props: ThermalSurfaceProperties,
  state: ReturnType<typeof createThermalZoneState>,
  flux: number,
  seconds: number,
  dt = 0.02,
  speed = 7_000,
) => {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    if (stepThermalZone(props, state, flux, 250, speed, 250, dt)) break;
  }
  return state;
};

describe('驻点对流热流', () => {
  it('Sutton–Graves：q̇ = k·√(ρ/R_n)·v³，与手算一致', () => {
    // 60 km 高度、6.5 km/s、头部半径 1 m
    const { density } = atmosphereAt(60_000);
    const q = stagnationHeatFlux(density, 6_500, 1);
    expect(q).toBeCloseTo(SUTTON_GRAVES_EARTH * Math.sqrt(density) * 6_500 ** 3, 6);
    // 量级：约 0.8–0.9 MW/m²
    expect(q).toBeGreaterThan(0.7e6);
    expect(q).toBeLessThan(1.0e6);
  });

  it('标度关系：速度翻倍热流为 8 倍；密度 4 倍或半径 1/4 时热流翻倍', () => {
    const base = stagnationHeatFlux(1e-4, 4_000, 2);
    expect(stagnationHeatFlux(1e-4, 8_000, 2) / base).toBeCloseTo(8, 9);
    expect(stagnationHeatFlux(4e-4, 4_000, 2) / base).toBeCloseTo(2, 9);
    expect(stagnationHeatFlux(1e-4, 4_000, 0.5) / base).toBeCloseTo(2, 9);
  });

  it('典型近地轨道再入的峰值热流量级与文献相符（钝头返回舱约 0.3–1 MW/m²）', () => {
    // 弹道再入的峰值加热点：约 60 km、速度约为再入速度的 0.85 倍
    const { density } = atmosphereAt(58_000);
    const q = stagnationHeatFlux(density, 6_600, 4.6);
    expect(q).toBeGreaterThan(0.3e6);
    expect(q).toBeLessThan(1.0e6);
  });

  it('稀薄流上限：热流不超过来流的能量通量 ½ρv³', () => {
    // 200 km 轨道：不加上限的 Sutton–Graves 约 1 kW/m²，物理上限约 60 W/m²
    const { density } = atmosphereAt(200_000);
    const speed = 7_800;
    const unbounded = SUTTON_GRAVES_EARTH * Math.sqrt(density / 1.3) * speed ** 3;
    const q = stagnationHeatFlux(density, speed, 1.3);
    expect(unbounded).toBeGreaterThan(500);
    expect(q).toBeCloseTo(0.5 * density * speed ** 3, 9);
    expect(q).toBeLessThan(120);
    // 任何高度都不超过上限
    for (let h = 0; h <= 400_000; h += 10_000) {
      const rho = atmosphereAt(h).density;
      expect(stagnationHeatFlux(rho, speed, 0.5)).toBeLessThanOrEqual(0.5 * rho * speed ** 3 * (1 + 1e-12));
    }
  });

  it('连续流与自由分子流两条曲线在 100–125 km 之间交接（7.8 km/s，头部半径 1 m）', () => {
    let crossover = 0;
    for (let h = 60_000; h <= 200_000; h += 1_000) {
      const rho = atmosphereAt(h).density;
      const continuum = SUTTON_GRAVES_EARTH * Math.sqrt(rho) * 7_800 ** 3;
      if (continuum > 0.5 * rho * 7_800 ** 3) {
        crossover = h;
        break;
      }
    }
    expect(crossover).toBeGreaterThan(100_000);
    expect(crossover).toBeLessThan(125_000);
  });

  it('真空、静止与无效输入时为零', () => {
    expect(stagnationHeatFlux(0, 7_800, 1)).toBe(0);
    expect(stagnationHeatFlux(1.2, 0, 1)).toBe(0);
    expect(stagnationHeatFlux(1.2, 100, 0)).toBe(0);
    expect(stagnationHeatFlux(NaN, 100, 1)).toBe(0);
    expect(stagnationHeatFlux(-1, 100, 1)).toBe(0);
  });
});

describe('热壁修正与辐射', () => {
  it('冷壁、高速时接近 1；壁面温度等于来流总温时为 0；更热时为负', () => {
    expect(hotWallFactor(300, 250, 7_500)).toBeGreaterThan(0.98);
    const speed = 1_000;
    const totalTemperature = 250 + (speed * speed) / (2 * AIR_SPECIFIC_HEAT);
    expect(hotWallFactor(totalTemperature, 250, speed)).toBeCloseTo(0, 12);
    expect(hotWallFactor(totalTemperature + 200, 250, speed)).toBeLessThan(0);
  });

  it('静止时壁面与气温相同则没有换热', () => {
    expect(hotWallFactor(288.15, 288.15, 0)).toBeCloseTo(0, 12);
  });

  it('空气定压比热约 1005 J/(kg·K)', () => {
    expect(AIR_SPECIFIC_HEAT).toBeGreaterThan(1_000);
    expect(AIR_SPECIFIC_HEAT).toBeLessThan(1_010);
  });

  it('辐射：ε·σ·(T⁴ − T_env⁴)；与环境同温时为零；辐射平衡温度是它的反函数', () => {
    expect(radiativeHeatFlux(0.85, 1_800, 0)).toBeCloseTo(0.85 * STEFAN_BOLTZMANN * 1_800 ** 4, 6);
    expect(radiativeHeatFlux(0.85, 250, 250)).toBe(0);
    expect(radiativeHeatFlux(0.85, 200, 250)).toBeLessThan(0);
    const t = radiativeEquilibriumTemperature(500_000, 0.85);
    expect(radiativeHeatFlux(0.85, t, 0)).toBeCloseTo(500_000, 4);
    expect(radiativeEquilibriumTemperature(0, 0.85)).toBe(0);
  });

  it('等效环境温度：低空为气温，高空不超过空间环境的代表值', () => {
    expect(environmentTemperature(288.15)).toBe(SPACE_SINK_TEMPERATURE);
    expect(environmentTemperature(216.65)).toBe(216.65);
    expect(environmentTemperature(1_000)).toBe(SPACE_SINK_TEMPERATURE);
  });
});

describe('热流在表面的分布', () => {
  const cosDeg = (deg: number) => Math.cos((deg * Math.PI) / 180);

  it('头部朝前：头部为驻点值，底部在尾流区，侧壁为顺流值', () => {
    expect(exposure('nose', 1)).toBe(1);
    expect(exposure('base', 1)).toBe(LEEWARD_FRACTION);
    expect(exposure('side', 1)).toBe(SIDEWALL_FRACTION);
  });

  it('尾部（防热大底）朝前：底部为驻点值，头部在尾流区', () => {
    expect(exposure('base', -1)).toBe(1);
    expect(exposure('nose', -1)).toBe(LEEWARD_FRACTION);
    expect(exposure('side', -1)).toBeCloseTo(SIDEWALL_FRACTION, 12);
  });

  it('横向来流：侧壁最热（圆柱驻点线），头部与底部都只有尾流区的水平', () => {
    expect(exposure('side', 0)).toBeCloseTo(CYLINDER_FRACTION, 12);
    expect(exposure('nose', 0)).toBe(LEEWARD_FRACTION);
    expect(exposure('base', 0)).toBe(LEEWARD_FRACTION);
  });

  it('随迎角连续、单调变化，取值始终在 (0, 1] 内', () => {
    let nose = exposure('nose', 1);
    let side = exposure('side', 1);
    for (let deg = 1; deg <= 180; deg++) {
      const n = exposure('nose', cosDeg(deg));
      const s = exposure('side', cosDeg(deg));
      const b = exposure('base', cosDeg(deg));
      expect(n).toBeLessThanOrEqual(nose + 1e-12);
      expect(Math.abs(n - nose)).toBeLessThan(0.03);
      if (deg <= 90) expect(s).toBeGreaterThanOrEqual(side - 1e-12);
      else expect(s).toBeLessThanOrEqual(side + 1e-12);
      for (const value of [n, s, b]) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      nose = n;
      side = s;
    }
  });

  it('余弦略超出 [−1, 1] 时不产生 NaN', () => {
    expect(exposure('side', 1.0000001)).toBe(SIDEWALL_FRACTION);
    expect(exposure('nose', -1.0000001)).toBe(LEEWARD_FRACTION);
  });
});

describe('集总热容模型', () => {
  it('没有热流、与环境同温时温度不变', () => {
    const state = createThermalZoneState(metal, 250);
    soak(metal, state, 0, 100);
    expect(state.surfaceTemperature).toBeCloseTo(250, 9);
    expect(state.interiorTemperature).toBeCloseTo(250, 9);
    expect(state.heatLoad).toBe(0);
    expect(state.failure).toBeNull();
  });

  it('初始升温速率 = q̇ / C_s', () => {
    const state = createThermalZoneState(metal, 250);
    stepThermalZone(metal, state, 40_000, 250, 7_000, 250, 0.02);
    const expected = (40_000 * hotWallFactor(250, 250, 7_000)) / metal.surfaceHeatCapacity;
    expect((state.surfaceTemperature - 250) / 0.02).toBeCloseTo(expected, 6);
  });

  it('恒定热流下趋于辐射平衡：对流传入 = 辐射散热（内部也热透之后）', () => {
    const robust: ThermalSurfaceProperties = { ...metal, maxInteriorTemperature: 2_000, maxSurfaceTemperature: 2_000 };
    const state = createThermalZoneState(robust, 250);
    soak(robust, state, 20_000, 6_000);
    expect(state.failure).toBeNull();
    // 平衡时表层与内部同温，传导为零
    expect(state.interiorTemperature).toBeCloseTo(state.surfaceTemperature, 0);
    expect(Math.abs(state.convectiveFlux - state.radiativeFlux) / state.radiativeFlux).toBeLessThan(1e-3);
    // 20 kW/m² 的辐射平衡温度约 800 K（热壁修正使实际略低）
    expect(state.surfaceTemperature).toBeGreaterThan(700);
    expect(state.surfaceTemperature).toBeLessThan(radiativeEquilibriumTemperature(20_000, 0.8) + 30);
  });

  it('能量守恒：传入 − 辐射 = 两个节点内能的增加', () => {
    const state = createThermalZoneState(metal, 250);
    const dt = 0.02;
    let absorbed = 0;
    let radiated = 0;
    for (let i = 0; i < 5_000; i++) {
      stepThermalZone(metal, state, 15_000 + 10_000 * Math.sin(i / 300), 250, 6_000, 250, dt);
      absorbed += state.convectiveFlux * dt;
      radiated += state.radiativeFlux * dt;
    }
    const stored = metal.surfaceHeatCapacity * (state.surfaceTemperature - 250) + metal.interiorHeatCapacity * (state.interiorTemperature - 250);
    expect(stored).toBeGreaterThan(1e5);
    expect(Math.abs(stored - (absorbed - radiated)) / stored).toBeLessThan(1e-9);
  });

  it('热量向内部传导：内部温度滞后于表面，移去热流后两者趋于一致并一起冷却', () => {
    const state = createThermalZoneState(metal, 250);
    soak(metal, state, 30_000, 60);
    expect(state.surfaceTemperature).toBeGreaterThan(state.interiorTemperature + 20);
    const peak = state.surfaceTemperature;
    soak(metal, state, 0, 2_000);
    expect(state.surfaceTemperature).toBeLessThan(peak);
    expect(Math.abs(state.surfaceTemperature - state.interiorTemperature)).toBeLessThan(5);
  });

  it('气流冷却：壁面比来流总温还热时对流热流为负', () => {
    const state = createThermalZoneState(metal, 800);
    stepThermalZone(metal, state, 50_000, 250, 300, 250, 0.02);
    expect(state.convectiveFlux).toBeLessThan(0);
    expect(state.surfaceTemperature).toBeLessThan(800);
    // 冷却不计入累积热载荷
    expect(state.heatLoad).toBe(0);
  });

  it('非烧蚀表面：超过最高工作温度即失效，之后状态不再变化', () => {
    const state = createThermalZoneState(metal, 250);
    soak(metal, state, 400_000, 60);
    expect(state.failure).toBe('surface');
    expect(state.surfaceTemperature).toBeGreaterThan(metal.maxSurfaceTemperature);
    const frozen = { ...state };
    expect(stepThermalZone(metal, state, 400_000, 250, 7_000, 250, 1)).toBeNull();
    expect(state).toEqual(frozen);
  });

  it('长时间中等热流：表面没有超限，但内部结构被热透而失效', () => {
    const insulated: ThermalSurfaceProperties = { ...metal, maxSurfaceTemperature: 1_500, maxInteriorTemperature: 450 };
    const state = createThermalZoneState(insulated, 250);
    soak(insulated, state, 25_000, 4_000);
    expect(state.failure).toBe('structure');
    expect(state.surfaceTemperature).toBeLessThan(insulated.maxSurfaceTemperature);
  });

  it('烧蚀：表面温度停在烧蚀温度，多余的热量按有效烧蚀热消耗烧蚀层', () => {
    const state = createThermalZoneState(ablative, 250);
    const flux = 800_000;
    soak(ablative, state, flux, 40);
    expect(state.failure).toBeNull();
    expect(state.surfaceTemperature).toBe(1_600);
    expect(state.ablationRate).toBeGreaterThan(0);
    // 稳态烧蚀速率 = (对流 − 辐射 − 传导) / H_abl（内部温度在一步内的变化使两者有极小的差别）
    const net = state.convectiveFlux - state.radiativeFlux - ablative.conductance * (1_600 - state.interiorTemperature);
    expect(state.ablationRate).toBeCloseTo(net / 2.5e7, 7);
    expect(ablatorFraction(ablative, state)).toBeLessThan(1);
    expect(ablatorFraction(ablative, state)).toBeGreaterThan(0.5);
  });

  it('烧蚀层的能量守恒：传入 = 辐射 + 内能增加 + 烧蚀带走', () => {
    const state = createThermalZoneState(ablative, 250);
    const dt = 0.02;
    let absorbed = 0;
    let radiated = 0;
    for (let i = 0; i < 3_000; i++) {
      stepThermalZone(ablative, state, 700_000, 250, 7_000, 250, dt);
      absorbed += state.convectiveFlux * dt;
      radiated += state.radiativeFlux * dt;
    }
    const stored =
      ablative.surfaceHeatCapacity * (state.surfaceTemperature - 250) + ablative.interiorHeatCapacity * (state.interiorTemperature - 250);
    const ablated = (5 - state.ablatorRemaining) * 2.5e7;
    expect(ablated).toBeGreaterThan(1e6);
    expect(Math.abs(absorbed - radiated - stored - ablated) / absorbed).toBeLessThan(1e-9);
  });

  it('热流低于烧蚀温度下的辐射能力时不消耗烧蚀层', () => {
    const state = createThermalZoneState(ablative, 250);
    // 1600 K 时的辐射约 316 kW/m²：200 kW/m² 的热流达不到烧蚀温度
    soak(ablative, state, 200_000, 300);
    expect(state.surfaceTemperature).toBeLessThan(1_600);
    expect(state.ablatorRemaining).toBe(5);
    expect(state.ablationRate).toBe(0);
  });

  it('烧蚀层耗尽即烧穿；烧蚀层越厚撑得越久', () => {
    const thin: ThermalSurfaceProperties = { ...ablative, ablator: { ...ablative.ablator!, arealMass: 1 } };
    const timeToFail = (props: ThermalSurfaceProperties): number => {
      const state = createThermalZoneState(props, 250);
      let t = 0;
      while (!state.failure && t < 2_000) {
        stepThermalZone(props, state, 1_500_000, 250, 7_500, 250, 0.02);
        t += 0.02;
      }
      expect(state.failure).toBe('burn-through');
      expect(state.ablatorRemaining).toBe(0);
      return t;
    };
    const thinTime = timeToFail(thin);
    const thickTime = timeToFail(ablative);
    expect(thickTime).toBeGreaterThan(3 * thinTime);
  });

  it('积分对步长不敏感，且大步长下保持稳定（自动细分子步）', () => {
    const run = (dt: number) => soak(metal, createThermalZoneState(metal, 250), 60_000, 40, dt);
    const fine = run(0.005);
    const game = run(0.02);
    const coarse = run(5);
    expect(game.surfaceTemperature).toBeCloseTo(fine.surfaceTemperature, 0);
    expect(Math.abs(coarse.surfaceTemperature - fine.surfaceTemperature)).toBeLessThan(15);
    expect(Number.isFinite(coarse.interiorTemperature)).toBe(true);

    // 极端：很薄的表层、很大的步长——不发散、不出现负温度
    const foil: ThermalSurfaceProperties = { ...metal, surfaceHeatCapacity: 200, maxSurfaceTemperature: 5_000, maxInteriorTemperature: 5_000 };
    const state = createThermalZoneState(foil, 250);
    for (let i = 0; i < 20; i++) stepThermalZone(foil, state, 300_000, 250, 7_000, 250, 30);
    expect(state.surfaceTemperature).toBeGreaterThan(250);
    expect(state.surfaceTemperature).toBeLessThan(radiativeEquilibriumTemperature(300_000, 0.8) + 50);
  });

  it('热裕度：未受热为 1，随温度升高或烧蚀层消耗而下降，失效后为 0', () => {
    const cold = createThermalZoneState(metal, 288);
    expect(thermalMargin(metal, cold, 288)).toBe(1);
    const warm = soak(metal, createThermalZoneState(metal, 288), 30_000, 30);
    const margin = thermalMargin(metal, warm, 288);
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThan(1);
    const failed = soak(metal, createThermalZoneState(metal, 288), 500_000, 60);
    expect(thermalMargin(metal, failed, 288)).toBe(0);

    const eroded = soak(ablative, createThermalZoneState(ablative, 288), 900_000, 60);
    expect(thermalMargin(ablative, eroded, 288)).toBeLessThanOrEqual(ablatorFraction(ablative, eroded));
  });
});
