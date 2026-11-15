/**
 * 表面材料的热学特性（集总热容模型的参数，单位面积）。
 *
 * 这些是为本游戏的两节点模型（表层 + 内部结构，见 physics/thermodynamics/thermalZone.ts）选取的
 * 代表性参数：量级取自同类真实材料与结构（铝合金贮箱壁、软木防热层、陶瓷隔热瓦、酚醛类烧蚀材料），
 * 但不是任何具体型号的实测数据。
 *
 *   表层面热容 C_s = ρ·c·δ：例如 4 mm 铝板 ≈ 2700 × 900 × 0.004 ≈ 9.7 kJ/(m²·K)
 *   传热系数   G = k/δ：金属壁很大（几百 W/(m²·K)），隔热层很小（几 W/(m²·K)）
 *
 * 烧蚀层的面密度是按本模型标定的设计参数：模型只追踪"可消耗的烧蚀层"，
 * 使近地轨道弹道再入消耗其中的一小部分、明显更快的再入把它耗尽（见 PHYSICS.md）。
 */
import type { ThermalSurfaceProperties } from '@/game/physics/thermodynamics/thermalZone';

/** 铝合金贮箱壁（外表面有涂层）。没有任何防热设计。 */
export const ALUMINUM_TANK_SKIN: ThermalSurfaceProperties = {
  material: '铝合金箱壁',
  emissivity: 0.8,
  surfaceHeatCapacity: 9_700,
  interiorHeatCapacity: 12_000,
  conductance: 400,
  maxSurfaceTemperature: 750,
  maxInteriorTemperature: 520,
  ablator: null,
};

/** 发动机舱：钢与铌合金喷管、隔热毯。比箱壁耐热，但同样不是为再入设计的。 */
export const ENGINE_SECTION: ThermalSurfaceProperties = {
  material: '发动机舱',
  emissivity: 0.7,
  surfaceHeatCapacity: 14_000,
  interiorHeatCapacity: 25_000,
  conductance: 60,
  maxSurfaceTemperature: 1_350,
  maxInteriorTemperature: 650,
  ablator: null,
};

/** 整流罩：复合材料壳体，外覆软木防热层，用来承受上升段的气动加热。 */
export const FAIRING_SHELL: ThermalSurfaceProperties = {
  material: '整流罩（软木防热层）',
  emissivity: 0.85,
  surfaceHeatCapacity: 5_500,
  interiorHeatCapacity: 9_000,
  conductance: 25,
  maxSurfaceTemperature: 900,
  maxInteriorTemperature: 450,
  ablator: null,
};

/**
 * 返回舱舱顶与侧壁：陶瓷隔热瓦 / 柔性隔热毡，承受背风面的中等热流。
 * 传热系数按 k/δ 估计：隔热瓦导热系数约 0.05–0.1 W/(m·K)、厚约 2–3 cm。
 * 配平再入时侧壁斜对来流、受热几分钟，这个量级才能保证内部结构留有足够的裕度。
 */
export const CAPSULE_BACKSHELL: ThermalSurfaceProperties = {
  material: '隔热瓦',
  emissivity: 0.85,
  surfaceHeatCapacity: 5_000,
  interiorHeatCapacity: 18_000,
  conductance: 4,
  maxSurfaceTemperature: 1_500,
  maxInteriorTemperature: 480,
  ablator: null,
};

/**
 * 返回舱的舱底结构：铝蜂窝承力板与薄隔热层，平时被防热大底盖着。
 * 抛掉大底后它直接暴露在外：只能承受伞降阶段的低速气流，承受不了任何再入加热。
 */
export const CAPSULE_AFT_STRUCTURE: ThermalSurfaceProperties = {
  material: '舱底结构（无防热）',
  emissivity: 0.8,
  surfaceHeatCapacity: 6_000,
  interiorHeatCapacity: 15_000,
  conductance: 30,
  maxSurfaceTemperature: 600,
  maxInteriorTemperature: 420,
  ablator: null,
};

/**
 * 烧蚀防热大底（近地轨道再入级别）。
 * @param arealMass 烧蚀层面密度 [kg/m²]
 */
export const ablativeHeatShield = (arealMass: number): ThermalSurfaceProperties => ({
  material: '烧蚀防热层',
  emissivity: 0.85,
  surfaceHeatCapacity: 6_000,
  // "内部"节点包含防热层的主体与承力结构：防热层本身很厚，热量要很久才能浸透
  interiorHeatCapacity: 60_000,
  conductance: 5,
  // 带烧蚀层时表面被钳制在烧蚀温度；这个值只在烧蚀层耗尽后才有意义
  maxSurfaceTemperature: 2_600,
  maxInteriorTemperature: 500,
  ablator: { temperature: 1_500, heatOfAblation: 2.8e7, arealMass },
});

/** 卫星本体：多层隔热与铝蜂窝板，内部是电子设备。只适合在整流罩保护下穿过大气层。 */
export const SATELLITE_BODY: ThermalSurfaceProperties = {
  material: '卫星本体',
  emissivity: 0.8,
  surfaceHeatCapacity: 2_500,
  interiorHeatCapacity: 8_000,
  conductance: 5,
  maxSurfaceTemperature: 520,
  maxInteriorTemperature: 350,
  ablator: null,
};
