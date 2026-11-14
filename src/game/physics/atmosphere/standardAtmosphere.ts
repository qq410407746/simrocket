/**
 * 物理大气模型：美国标准大气 1976（U.S. Standard Atmosphere, 1976）。
 *
 * 0–86 km：七层线性温度剖面 + 流体静力学方程的解析解（USSA76 第一部分，完整实现）。
 *   位势高度 H = r₀·z / (r₀ + z)
 *   T = T_b + L·(H − H_b)
 *   L ≠ 0:  p = p_b·(T_b / T)^(g₀·M / (R*·L))
 *   L = 0:  p = p_b·exp(−g₀·M·(H − H_b) / (R*·T_b))
 *   ρ = p·M / (R*·T) ,  a = √(γ·R*·T / M)
 *
 * 86–1000 km：对 USSA76 表列值（温度线性、压力与密度对数线性）插值，即分层指数大气。
 *   这一段不求解 USSA76 第二部分的组分扩散方程，而是直接使用其结果表。
 *
 * 1000 km 以上：密度与压力取 0。
 *
 * 单位：高度 m（几何高度，相对平均海平面），温度 K，压力 Pa，密度 kg/m³，声速 m/s。
 *
 * 适用范围与限制：
 *  - 这是全球年平均的"标准日"，不含天气、季节、纬度、太阳活动的影响
 *    （真实的热层密度随太阳活动可变化一个数量级）。
 *  - 86 km 以上平均分子量随高度下降，这里的声速仍按海平面分子量计算，只是近似值；
 *    该高度以上气体已不满足连续介质假设，马赫数仅作参考。
 *  - 大气随地球刚性共转，没有风。
 */
import { SEA_LEVEL, STANDARD_GRAVITY } from '../constants';

/** 通用气体常数 [J/(mol·K)]（USSA76 采用值）。 */
const R_STAR = 8.31432;
/** 海平面平均摩尔质量 [kg/mol]。 */
const MOLAR_MASS = 0.0289644;
/** 比热比。 */
const GAMMA = 1.4;
/** USSA76 位势高度换算使用的地球半径 [m]。 */
const GEOPOTENTIAL_RADIUS = 6_356_766;
/** 干空气气体常数 [J/(kg·K)]。 */
export const AIR_GAS_CONSTANT = R_STAR / MOLAR_MASS;

/** 解析段与表列段的分界：几何高度 86 km。 */
const UPPER_BASE_ALTITUDE = 86_000;
/** 大气模型上界 [m]。 */
export const ATMOSPHERE_TOP = 1_000_000;
/** 模型接受的最低高度 [m]（防止异常输入外推出不合理的数值）。 */
const MIN_ALTITUDE = -2_000;

interface Layer {
  /** 层底位势高度 [m]。 */
  readonly h: number;
  /** 层底温度 [K]。 */
  readonly t: number;
  /** 温度梯度 [K/m]。 */
  readonly lapse: number;
  /** 层底压力 [Pa]（由下一层递推得到）。 */
  readonly p: number;
}

const LAYER_DEFINITIONS: readonly (readonly [number, number])[] = [
  // [层底位势高度 m, 温度梯度 K/m]
  [0, -0.0065],
  [11_000, 0],
  [20_000, 0.001],
  [32_000, 0.0028],
  [47_000, 0],
  [51_000, -0.0028],
  [71_000, -0.002],
];

const GMR = (STANDARD_GRAVITY * MOLAR_MASS) / R_STAR;

const pressureInLayer = (layer: Layer, h: number): number => {
  const dh = h - layer.h;
  if (layer.lapse === 0) return layer.p * Math.exp((-GMR * dh) / layer.t);
  return layer.p * Math.pow(layer.t / (layer.t + layer.lapse * dh), GMR / layer.lapse);
};

/** 各层层底的温度与压力由海平面值逐层递推（不手写中间数值，避免录入错误）。 */
const LAYERS: readonly Layer[] = (() => {
  const layers: Layer[] = [];
  let t: number = SEA_LEVEL.TEMPERATURE;
  let p: number = SEA_LEVEL.PRESSURE;
  LAYER_DEFINITIONS.forEach(([h, lapse], i) => {
    const prev = layers[i - 1];
    if (prev) {
      p = pressureInLayer(prev, h);
      t = prev.t + prev.lapse * (h - prev.h);
    }
    layers.push({ h, t, lapse, p });
  });
  return layers;
})();

/** USSA76 表列值：[几何高度 km, 温度 K, 压力 Pa, 密度 kg/m³]。 */
const UPPER_TABLE: readonly (readonly [number, number, number, number])[] = [
  [86, 186.87, 3.7338e-1, 6.958e-6],
  [90, 186.87, 1.8359e-1, 3.416e-6],
  [100, 195.08, 3.2011e-2, 5.604e-7],
  [110, 240.0, 7.1042e-3, 9.708e-8],
  [120, 360.0, 2.5382e-3, 2.222e-8],
  [130, 469.27, 1.2505e-3, 8.152e-9],
  [140, 559.63, 7.2028e-4, 3.831e-9],
  [150, 634.39, 4.5422e-4, 2.076e-9],
  [160, 696.29, 3.0395e-4, 1.233e-9],
  [180, 790.07, 1.5271e-4, 5.194e-10],
  [200, 854.56, 8.4736e-5, 2.541e-10],
  [250, 941.33, 2.4767e-5, 6.073e-11],
  [300, 976.01, 8.7704e-6, 1.916e-11],
  [350, 990.06, 3.4498e-6, 7.014e-12],
  [400, 995.83, 1.4518e-6, 2.803e-12],
  [450, 998.22, 6.4468e-7, 1.184e-12],
  [500, 999.24, 3.0236e-7, 5.215e-13],
  [600, 999.85, 8.2130e-8, 1.137e-13],
  [700, 999.97, 3.1908e-8, 3.070e-14],
  [800, 999.99, 1.7036e-8, 1.136e-14],
  [900, 1000.0, 1.0873e-8, 5.759e-15],
  [1000, 1000.0, 7.5138e-9, 3.561e-15],
];

export interface AtmosphereSample {
  /** 密度 ρ [kg/m³]。 */
  density: number;
  /** 压力 p [Pa]。 */
  pressure: number;
  /** 温度 T [K]。 */
  temperature: number;
  /** 声速 a [m/s]。 */
  speedOfSound: number;
}

const speedOfSoundAt = (temperature: number): number => Math.sqrt(GAMMA * AIR_GAS_CONSTANT * temperature);

/** 解析段（0–86 km）。 */
const sampleLower = (altitude: number, out: AtmosphereSample): void => {
  const h = (GEOPOTENTIAL_RADIUS * altitude) / (GEOPOTENTIAL_RADIUS + altitude);
  let layer = LAYERS[0] as Layer;
  for (let i = LAYERS.length - 1; i > 0; i--) {
    const candidate = LAYERS[i] as Layer;
    if (h >= candidate.h) {
      layer = candidate;
      break;
    }
  }
  const temperature = layer.t + layer.lapse * (h - layer.h);
  const pressure = pressureInLayer(layer, h);
  out.temperature = temperature;
  out.pressure = pressure;
  out.density = pressure / (AIR_GAS_CONSTANT * temperature);
  out.speedOfSound = speedOfSoundAt(temperature);
};

/** 表列段的节点（SI 单位）。第一个节点取解析段在 86 km 处的值，保证两段连续。 */
const UPPER_NODES: readonly { z: number; t: number; lnP: number; lnRho: number }[] = (() => {
  const base: AtmosphereSample = { density: 0, pressure: 0, temperature: 0, speedOfSound: 0 };
  sampleLower(UPPER_BASE_ALTITUDE, base);
  return UPPER_TABLE.map(([km, t, p, rho], i) =>
    i === 0
      ? { z: km * 1000, t: base.temperature, lnP: Math.log(base.pressure), lnRho: Math.log(base.density) }
      : { z: km * 1000, t, lnP: Math.log(p), lnRho: Math.log(rho) },
  );
})();

/**
 * 给定几何高度处的大气状态，写入 out（不分配内存，供积分器内层循环使用）。
 */
export const sampleAtmosphere = (altitude: number, out: AtmosphereSample): AtmosphereSample => {
  if (!(altitude < ATMOSPHERE_TOP)) {
    // 含 altitude ≥ 上界与 NaN 两种情况：按真空处理。
    out.density = 0;
    out.pressure = 0;
    out.temperature = 1000;
    out.speedOfSound = speedOfSoundAt(1000);
    return out;
  }
  if (altitude < UPPER_BASE_ALTITUDE) {
    sampleLower(Math.max(altitude, MIN_ALTITUDE), out);
    return out;
  }
  let i = UPPER_NODES.length - 2;
  while (i > 0 && altitude < (UPPER_NODES[i] as { z: number }).z) i--;
  const a = UPPER_NODES[i] as (typeof UPPER_NODES)[number];
  const b = UPPER_NODES[i + 1] as (typeof UPPER_NODES)[number];
  const s = (altitude - a.z) / (b.z - a.z);
  out.temperature = a.t + (b.t - a.t) * s;
  out.pressure = Math.exp(a.lnP + (b.lnP - a.lnP) * s);
  out.density = Math.exp(a.lnRho + (b.lnRho - a.lnRho) * s);
  out.speedOfSound = speedOfSoundAt(out.temperature);
  return out;
};

/** 给定几何高度处的大气状态（返回新对象；非性能敏感场合使用）。 */
export const atmosphereAt = (altitude: number): AtmosphereSample =>
  sampleAtmosphere(altitude, { density: 0, pressure: 0, temperature: 0, speedOfSound: 0 });
