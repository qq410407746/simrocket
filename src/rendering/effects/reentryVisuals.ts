/**
 * 再入视觉效果的"物理量 → 外观"映射（纯函数，可测试）。
 *
 * 这些函数只决定画面上的亮度、颜色与尺寸，不参与任何物理计算。
 * 输入全部来自物理线程的状态：参考驻点热流（由密度与速度算出）、表面温度、降落伞阻力面积。
 * 因此效果不会"只看高度"触发：在高空慢速飞行、或在真空里高速飞行时都没有辉光。
 */

/** 参考驻点热流（1 m 曲率半径）低于该值 [W/m²] 时完全没有辉光。 */
export const PLASMA_ONSET_FLUX = 30_000;
/** 达到该值 [W/m²] 时辉光达到最大强度。 */
export const PLASMA_FULL_FLUX = 1_500_000;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smoothstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * 等离子体辉光强度 [0, 1]：对热流取对数后平滑过渡。
 * 热流跨越两个数量级（30 kW/m² → 1.5 MW/m²），对数刻度使辉光在整个再入过程中逐渐增强，而不是突然出现。
 */
export const plasmaIntensity = (referenceHeatFlux: number): number => {
  if (!(referenceHeatFlux > PLASMA_ONSET_FLUX)) return 0;
  return smoothstep(Math.log(referenceHeatFlux / PLASMA_ONSET_FLUX) / Math.log(PLASMA_FULL_FLUX / PLASMA_ONSET_FLUX));
};

export type Rgb = readonly [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const PLASMA_DIM: Rgb = [1.0, 0.28, 0.08];
const PLASMA_MID: Rgb = [1.0, 0.62, 0.3];
const PLASMA_HOT: Rgb = [1.0, 0.9, 0.82];

/** 辉光颜色（线性 RGB）：弱时暗红橙，中等时橙黄，最强时接近暖白色。 */
export const plasmaColor = (intensity: number): Rgb => {
  const t = clamp01(intensity);
  return t < 0.6 ? mix(PLASMA_DIM, PLASMA_MID, t / 0.6) : mix(PLASMA_MID, PLASMA_HOT, (t - 0.6) / 0.4);
};

/** 表面开始发出可见光的温度 [K]（暗红色，德雷珀点附近）。 */
export const INCANDESCENCE_ONSET = 800;

/**
 * 高温表面的自发光颜色（线性 RGB，可大于 1）。
 * 约 800 K 开始呈暗红，1300 K 橙红，1800 K 以上橙黄发亮——黑体辐射颜色随温度变化的定性近似，不是普朗克谱的积分。
 */
export const incandescence = (temperature: number): Rgb => {
  if (!(temperature > INCANDESCENCE_ONSET)) return [0, 0, 0];
  const t = clamp01((temperature - INCANDESCENCE_ONSET) / 1_400);
  const brightness = 0.25 + 2.75 * t;
  return [brightness * t ** 0.5, brightness * 0.4 * t ** 1.4, brightness * 0.08 * t ** 3];
};

/** 伞衣的阻力系数（半球形伞衣的典型值）：阻力面积 = 0.8 × 投影面积。 */
export const CANOPY_DRAG_COEFFICIENT = 0.8;

/** 由当前阻力面积 C_d·A [m²] 反算伞衣的投影半径 [m]。 */
export const canopyRadius = (dragArea: number): number =>
  dragArea > 0 ? Math.sqrt(dragArea / (CANOPY_DRAG_COEFFICIENT * Math.PI)) : 0;
