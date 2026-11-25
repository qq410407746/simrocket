/**
 * 气动加热：驻点对流热流的工程估算。
 *
 * 高速飞行时的气动加热主要不是"摩擦生热"：来流在头部激波后被强烈压缩、减速，动能转化为气体的内能，
 * 高温激波层再通过边界层把热量传给壁面。传给壁面的只是来流能量通量的一小部分（对钝头体通常是百分之几）。
 *
 * 1. 冷壁驻点对流热流（Sutton–Graves 关系）：
 *
 *        q̇_SG = k·√(ρ / R_n)·v³            k = 1.7415×10⁻⁴ kg^½/m （地球大气）
 *
 *    适用范围：高超声速（大致 v > 2 km/s）、连续流、层流驻点。来源：Sutton & Graves, NASA TR R-376 (1971)。
 *
 * 2. 稀薄流上限。Sutton–Graves 正比于 √ρ，密度趋于零时它会超过来流本身携带的能量通量 ½ρv³——
 *    这在物理上不可能。自由分子流中壁面最多吸收全部入射动能（能量适应系数取 1）：
 *
 *        q̇_冷壁 = min(q̇_SG, ½·ρ·v³)
 *
 *    两条曲线在约 100–120 km 高度相交，以上由自由分子流上限控制（200 km 轨道上约 60 W/m²，
 *    而不加上限的 Sutton–Graves 会给出约 1 kW/m²）。这是两种极限之间最简单的衔接，不是过渡流的精确解。
 *
 * 3. 热壁修正。对流换热由总焓与壁面焓之差驱动：
 *
 *        q̇_对流 = q̇_冷壁·(1 − h_w / h_0)，  h_0 = c_p·T_∞ + v²/2，  h_w = c_p·T_w
 *
 *    壁面越热，传入的热量越少；壁面比来流的恢复温度还热时该项为负，即气流反过来冷却壁面。
 *    这样同一个公式覆盖了上升段（低速、壁面接近环境温度）与再入段，低速时自然趋于零
 *    （q̇_冷壁 ∝ v³，且 h_0 → h_∞）。c_p 取常数（量热完全气体），高焓下真实气体效应未计入。
 *
 * 没有建模（如实说明）：
 *  - 激波层辐射加热：再入速度超过约 9–10 km/s（月球返回量级）时才显著；近地轨道再入可以忽略，
 *    地球同步转移轨道返回（约 10.3 km/s）时会低估热流一到两成；
 *  - 湍流转捩、催化壁效应、烧蚀产物对边界层的阻塞（后者在烧蚀模型中以"有效烧蚀热"的形式笼统计入）；
 *  - 飞行器表面的热流分布：见 exposure()，按部位与迎角给出相对驻点值的比例。
 */
import { AIR_GAS_CONSTANT } from '../atmosphere/standardAtmosphere';

/** Sutton–Graves 常数（地球大气）[kg^½/m]。 */
export const SUTTON_GRAVES_EARTH = 1.7415e-4;

/** 斯特藩–玻尔兹曼常数 [W/(m²·K⁴)]。 */
export const STEFAN_BOLTZMANN = 5.670374419e-8;

/** 空气定压比热 c_p = γR/(γ−1) [J/(kg·K)]，γ = 1.4。 */
export const AIR_SPECIFIC_HEAT = (1.4 * AIR_GAS_CONSTANT) / 0.4;

/** 空间环境的等效辐射温度上限 [K]：没有太阳辐照与地球红外的模型，取一个代表性的常数。 */
export const SPACE_SINK_TEMPERATURE = 270;

/**
 * 冷壁驻点对流热流 [W/m²]：Sutton–Graves，并以自由分子流的入射能量通量为上限。
 * @param density 大气密度 [kg/m³]
 * @param speed 相对大气的速度 [m/s]
 * @param noseRadius 驻点处的曲率半径 [m]
 */
export const stagnationHeatFlux = (density: number, speed: number, noseRadius: number): number => {
  if (!(density > 0) || !(speed > 0) || !(noseRadius > 0)) return 0;
  const v3 = speed * speed * speed;
  const continuum = SUTTON_GRAVES_EARTH * Math.sqrt(density / noseRadius) * v3;
  const freeMolecular = 0.5 * density * v3;
  return Math.min(continuum, freeMolecular);
};

/**
 * 热壁修正系数 (1 − h_w/h_0)，无量纲。壁面温度等于来流总温时为 0，更热时为负。
 * @param wallTemperature 壁面温度 [K]
 * @param ambientTemperature 来流静温 [K]
 * @param speed 相对大气的速度 [m/s]
 */
export const hotWallFactor = (wallTemperature: number, ambientTemperature: number, speed: number): number => {
  const totalEnthalpy = AIR_SPECIFIC_HEAT * ambientTemperature + 0.5 * speed * speed;
  if (!(totalEnthalpy > 0)) return 0;
  return 1 - (AIR_SPECIFIC_HEAT * wallTemperature) / totalEnthalpy;
};

/** 灰体表面的净辐射热流 ε·σ·(T_w⁴ − T_env⁴) [W/m²]（向外为正）。 */
export const radiativeHeatFlux = (emissivity: number, wallTemperature: number, environmentTemperature: number): number => {
  // 用乘法代替 ** 4（每个物理步每个热区都要算一次）
  const w2 = wallTemperature * wallTemperature;
  const e2 = environmentTemperature * environmentTemperature;
  return emissivity * STEFAN_BOLTZMANN * (w2 * w2 - e2 * e2);
};

/** 给定吸收热流时的辐射平衡温度 [K]（环境温度取 0 的近似，用于估算与测试）。 */
export const radiativeEquilibriumTemperature = (heatFlux: number, emissivity: number): number =>
  heatFlux > 0 && emissivity > 0 ? (heatFlux / (emissivity * STEFAN_BOLTZMANN)) ** 0.25 : 0;

/**
 * 表面辐射换热所面对的等效环境温度 [K]。
 * 稠密大气内取当地气温；高空（热层的气体动力学温度高达上千开，但气体极稀薄，不代表辐射环境）
 * 以 SPACE_SINK_TEMPERATURE 为上限。
 */
export const environmentTemperature = (ambientTemperature: number): number =>
  Math.min(Math.max(ambientTemperature, 0), SPACE_SINK_TEMPERATURE);

/** 飞行器表面的三个热区。 */
export type ThermalZoneId = 'nose' | 'side' | 'base';
export const THERMAL_ZONE_IDS: readonly ThermalZoneId[] = ['nose', 'side', 'base'];

/** 背风面（尾流区）的热流相对驻点值的比例。 */
export const LEEWARD_FRACTION = 0.03;
/** 来流顺着侧壁流过（零迎角）时，侧壁热流相对驻点值的比例。 */
export const SIDEWALL_FRACTION = 0.05;
/** 横向来流时，圆柱驻点线的热流相对同半径球头驻点值的比例（≈ 1/√2）。 */
export const CYLINDER_FRACTION = Math.SQRT1_2;
/** 侧壁背对来流的角度的正弦达到该值时，热流降到背风面的水平。 */
const SHADOW_DEPTH = 0.25;

/**
 * 某一热区的热流相对"以该区曲率半径计算的驻点热流"的比例 [0, 1]，由迎角决定。
 *
 *   头部：迎风时为 1，随 cos^1.5 α 下降，背风时降到 LEEWARD_FRACTION；
 *   底部：与头部相反（尾部朝前时为 1）——返回舱的防热大底就是它的"底部"；
 *   侧壁：取迎风一侧母线与来流的夹角 i（表面迎着来流为正）。圆柱侧壁 i = α；
 *         向头部收缩、半锥角为 θ 的锥形侧壁 i = α + θ——头部朝前时侧壁迎着来流，
 *         大底朝前（α → 180°）时 sin i = sin(α' − θ)，α' = 180° − α 为偏离"大底正对来流"的角度：
 *         α' 小于半锥角时侧壁整个躲在大底的背风区里。
 *           sin i ≥ 0：SIDEWALL_FRACTION → CYLINDER_FRACTION，随 sin^1.5 i 上升；
 *           sin i < 0：由 SIDEWALL_FRACTION 降到 LEEWARD_FRACTION。
 *
 * 指数 1.5 来自牛顿流近似下热流随表面倾角的典型变化，是工程估计。
 * @param cosAlpha 迎角余弦（头部朝前为 +1）
 * @param sideSlope 侧壁的半锥角 θ [rad]（向头部收缩为正；圆柱为 0）。只影响侧壁。
 */
export const exposure = (zone: ThermalZoneId, cosAlpha: number, sideSlope = 0): number => {
  const cos = Math.max(-1, Math.min(1, cosAlpha));
  if (zone === 'side') {
    const sin = Math.sqrt(1 - cos * cos);
    // sin(α + θ)
    const facing = sideSlope === 0 ? sin : sin * Math.cos(sideSlope) + cos * Math.sin(sideSlope);
    if (facing >= 0) return SIDEWALL_FRACTION + (CYLINDER_FRACTION - SIDEWALL_FRACTION) * facing * Math.sqrt(facing);
    return SIDEWALL_FRACTION - (SIDEWALL_FRACTION - LEEWARD_FRACTION) * Math.min(1, -facing / SHADOW_DEPTH);
  }
  const facing = Math.max(0, zone === 'nose' ? cos : -cos);
  return LEEWARD_FRACTION + (1 - LEEWARD_FRACTION) * facing * Math.sqrt(facing);
};
