/**
 * 物理回归测试用的参考构型（虚构火箭，不出现在游戏里）。
 *
 * 游戏目录已改用真实火箭（见 data/vehicles.ts）。这三种虚构火箭保留下来，
 * 是因为大量物理测试（再入、配平、分级、轨道传播……）的断言是按它们的参数推导与校验的；
 * 用固定的参考构型可以让物理模型的回归测试不随游戏内容调整而变化。
 *
 * 参数取自同类真实运载器的典型量级
 * （煤油/液氧燃气发生器循环发动机、氢氧上面级等），以保证物理上自洽。
 * 飞行性能（Δv、推重比）一律由 game/vehicles/analysis.ts 从这些参数计算得出，不在此处手写。
 *
 * 气动参数为典型量级的工程估计（气动力模型见 physics/aerodynamics/drag.ts）；
 * 表面材料见 data/materials.ts；结构强度限制、降落伞参数同样是典型量级的设计值。
 */
import { DEG2RAD } from '@/game/physics/constants';
import type { EngineDefinition, LandingLimits, StageDefinition, StructuralLimits, VehicleDefinition } from '@/game/vehicles/types';
import {
  ALUMINUM_TANK_SKIN,
  CAPSULE_AFT_STRUCTURE,
  CAPSULE_BACKSHELL,
  ENGINE_SECTION,
  FAIRING_SHELL,
  SATELLITE_BODY,
  ablativeHeatShield,
} from '../materials';

const circleArea = (diameter: number): number => (Math.PI * diameter * diameter) / 4;

// ───────────────────────────── 发动机 ─────────────────────────────

/** 煤油/液氧，海平面型。海平面推力 ≈ 814 kN，海平面比冲 ≈ 285 s（由推力方程导出）。 */
const EMBER_1A: EngineDefinition = {
  id: 'ember-1a',
  name: 'Ember-1A',
  propellant: 'kerolox',
  thrustVacuum: 900e3,
  ispVacuum: 315,
  nozzleExitArea: 0.85,
  minThrottle: 0.4,
  gimbalRange: 5 * DEG2RAD,
};

/** 煤油/液氧，真空型（大膨胀比喷管）。 */
const EMBER_1V: EngineDefinition = {
  id: 'ember-1v',
  name: 'Ember-1V',
  propellant: 'kerolox',
  thrustVacuum: 950e3,
  ispVacuum: 346,
  nozzleExitArea: 6.5,
  minThrottle: 0.4,
  gimbalRange: 4 * DEG2RAD,
};

/** 小型煤油/液氧发动机，用于亚轨道探空火箭。 */
const SPARK_2: EngineDefinition = {
  id: 'spark-2',
  name: 'Spark-2',
  propellant: 'kerolox',
  thrustVacuum: 250e3,
  ispVacuum: 295,
  nozzleExitArea: 0.3,
  minThrottle: 0.5,
  gimbalRange: 5 * DEG2RAD,
};

/** 氢氧膨胀循环上面级发动机。 */
const AURORA_H: EngineDefinition = {
  id: 'aurora-h',
  name: 'Aurora-H',
  propellant: 'hydrolox',
  thrustVacuum: 110e3,
  ispVacuum: 452,
  nozzleExitArea: 3.5,
  minThrottle: 1,
  gimbalRange: 4 * DEG2RAD,
};

/** 飞船轨道机动发动机（自燃推进剂，可多次启动）。 */
const WREN_OMS: EngineDefinition = {
  id: 'wren-oms',
  name: 'Wren OMS',
  propellant: 'hypergolic',
  thrustVacuum: 7.5e3,
  ispVacuum: 300,
  nozzleExitArea: 0.03,
  minThrottle: 1,
  gimbalRange: 0,
};

// ───────────────────────────── 结构、防热与回收 ─────────────────────────────

/** 推进级的表面：铝合金箱壁 + 底部发动机舱。 */
const STAGE_THERMAL: StageDefinition['thermal'] = { side: ALUMINUM_TANK_SKIN, base: ENGINE_SECTION };

/**
 * 中型运载火箭组合体的结构限制。
 * 最大动压与 q·sin α 的限值相当于：在约 40 kPa 的最大动压区，迎角不能超过 5° 左右。
 */
const LAUNCHER_STRUCTURE: StructuralLimits = { maxGLoad: 10, maxDynamicPressure: 80_000, maxBendingLoad: 3_500 };

/** 返回舱在降落伞下接地（溅落或着陆缓冲）可承受的条件。 */
const CAPSULE_LANDING: LandingLimits = { verticalSpeed: 10, horizontalSpeed: 8, tilt: 45 * DEG2RAD };

// ───────────────────────────── 飞行器 ─────────────────────────────

/** 单级亚轨道火箭 + 小型返回舱。 */
const METEOR_S: VehicleDefinition = {
  id: 'meteor-s',
  name: 'Meteor-S',
  nameZh: '流星-S',
  role: '亚轨道',
  description: '单级液体探空火箭，搭载小型返回舱。用于突破卡门线与亚轨道飞行训练。',
  stages: [
    {
      id: 'meteor-s-1',
      name: '芯级',
      dryMass: 2_600,
      propellantMass: 10_500,
      engine: SPARK_2,
      engineCount: 1,
      geometry: { diameter: 2.2, length: 13 },
      aero: { referenceArea: circleArea(2.2), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'capsule',
    id: 'egret-s',
    name: '白鹭-S 返回舱',
    dryMass: 1_800,
    propellantMass: 0,
    engine: null,
    engineCount: 0,
    geometry: { diameter: 2.2, length: 2.3 },
    aero: { referenceArea: circleArea(2.2), dragCoefficient: 1.3, shape: 'blunt' },
    // 无人返回舱：结构强度裕度大，能承受亚轨道弹道近乎垂直再入的十几个 g
    structure: { maxGLoad: 25, maxDynamicPressure: 200_000, maxBendingLoad: Infinity },
    // 亚轨道再入的热载荷很小：薄烧蚀层即可
    heatShield: { noseRadius: 2.6, surface: ablativeHeatShield(0.6), mass: 150 },
    // 质心在对称轴上：弹道式返回舱，没有升力（亚轨道近乎垂直的再入也用不上升力）
    centerOfMass: { height: 0.75, lateralOffset: 0 },
    apexRadius: 0.35,
    thermal: { apex: CAPSULE_BACKSHELL, side: CAPSULE_BACKSHELL, aft: CAPSULE_AFT_STRUCTURE },
    parachute: {
      drogueDragArea: 14,
      mainDragArea: 480,
      maxDeployDynamicPressure: 12_000,
      maxDeployMach: 0.9,
      mainDeployDynamicPressure: 1_500,
      drogueInflationTime: 2,
      mainInflationTime: 10,
    },
    landing: CAPSULE_LANDING,
  },
  // 探空火箭：箭体短粗、结构强
  structure: { maxGLoad: 12, maxDynamicPressure: 120_000, maxBendingLoad: 8_000 },
};

/** 两级中型运载火箭 + 载人飞船。 */
const FRONTIER_1: VehicleDefinition = {
  id: 'frontier-1',
  name: 'Frontier-1',
  nameZh: '边疆一号',
  role: '近地轨道 · 载人',
  description: '两级煤油/液氧中型运载火箭，搭载"白鹭号"载人飞船。近地轨道任务的主力构型。',
  stages: [
    {
      id: 'frontier-1-s1',
      name: '一级',
      dryMass: 25_000,
      propellantMass: 400_000,
      engine: EMBER_1A,
      engineCount: 9,
      geometry: { diameter: 3.8, length: 40 },
      aero: { referenceArea: circleArea(3.8), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'frontier-1-s2',
      name: '二级',
      dryMass: 4_500,
      propellantMass: 95_000,
      engine: EMBER_1V,
      engineCount: 1,
      geometry: { diameter: 3.8, length: 12 },
      aero: { referenceArea: circleArea(3.8), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'capsule',
    id: 'egret',
    name: '白鹭号飞船',
    dryMass: 6_500,
    propellantMass: 1_200,
    engine: WREN_OMS,
    engineCount: 4,
    geometry: { diameter: 3.8, length: 3.9 },
    aero: { referenceArea: circleArea(3.8), dragCoefficient: 1.3, shape: 'blunt' },
    // 载人飞船：结构可承受约 14 g（弹道再入约 8–9 g；更陡的再入会超限）
    structure: { maxGLoad: 14, maxDynamicPressure: 150_000, maxBendingLoad: Infinity },
    // 近地轨道再入级别的防热大底（质量约占返回舱的 10%）
    heatShield: { noseRadius: 4.6, surface: ablativeHeatShield(4), mass: 650 },
    // 质心偏离对称轴 11 cm：再入时配平在约 20° 迎角，升阻比约 0.3（半弹道式 / 升力式再入）
    centerOfMass: { height: 1.3, lateralOffset: 0.11 },
    apexRadius: 0.5,
    thermal: { apex: CAPSULE_BACKSHELL, side: CAPSULE_BACKSHELL, aft: CAPSULE_AFT_STRUCTURE },
    parachute: {
      drogueDragArea: 60,
      mainDragArea: 2_000,
      maxDeployDynamicPressure: 12_000,
      maxDeployMach: 0.9,
      mainDeployDynamicPressure: 1_500,
      drogueInflationTime: 2,
      mainInflationTime: 12,
    },
    landing: CAPSULE_LANDING,
  },
  structure: LAUNCHER_STRUCTURE,
};

/** 三级运载火箭 + 整流罩 + 通信卫星，面向 GTO/GEO 任务。 */
const ZENITH_3: VehicleDefinition = {
  id: 'zenith-3',
  name: 'Zenith-3',
  nameZh: '天顶三号',
  role: '地球同步转移轨道 · 货运',
  description: '三级运载火箭：煤油/液氧一、二级加氢氧上面级，整流罩内搭载通信卫星。面向 GTO / GEO 任务。',
  stages: [
    {
      id: 'zenith-3-s1',
      name: '一级',
      dryMass: 30_000,
      propellantMass: 430_000,
      engine: EMBER_1A,
      engineCount: 9,
      geometry: { diameter: 4.2, length: 37 },
      aero: { referenceArea: circleArea(4.2), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'zenith-3-s2',
      name: '二级',
      dryMass: 6_000,
      propellantMass: 110_000,
      engine: EMBER_1V,
      engineCount: 1,
      geometry: { diameter: 4.2, length: 11.5 },
      aero: { referenceArea: circleArea(4.2), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'zenith-3-s3',
      name: '三级（氢氧上面级）',
      dryMass: 2_800,
      propellantMass: 22_000,
      engine: AURORA_H,
      engineCount: 1,
      geometry: { diameter: 4.2, length: 9 },
      aero: { referenceArea: circleArea(4.2), dragCoefficient: 0.3, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'satellite',
    id: 'relay-7',
    name: 'Relay-7 通信卫星',
    dryMass: 4_500,
    propellantMass: 0,
    engine: null,
    engineCount: 0,
    geometry: { diameter: 2.6, length: 4.2 },
    aero: { referenceArea: circleArea(2.6), dragCoefficient: 2.2, shape: 'blunt' },
    // 卫星：展开机构与电池板不能承受气动载荷
    structure: { maxGLoad: 10, maxDynamicPressure: 3_000, maxBendingLoad: Infinity },
    thermal: SATELLITE_BODY,
    fairing: {
      mass: 1_900,
      geometry: { diameter: 4.6, length: 11 },
      noseRadius: 0.9,
      thermal: FAIRING_SHELL,
    },
  },
  structure: LAUNCHER_STRUCTURE,
};

export const REFERENCE_VEHICLES = { 'meteor-s': METEOR_S, 'frontier-1': FRONTIER_1, 'zenith-3': ZENITH_3 } as const;

export type ReferenceVehicleId = keyof typeof REFERENCE_VEHICLES;

/** 取一个参考构型（仅供测试）。 */
export const referenceVehicle = (id: ReferenceVehicleId): VehicleDefinition => REFERENCE_VEHICLES[id];

/** 按字符串取参考构型；未知 id 直接报错（测试里写错 id 应当立刻暴露）。 */
export const referenceVehicleById = (id: string): VehicleDefinition => {
  const vehicle = (REFERENCE_VEHICLES as Readonly<Record<string, VehicleDefinition>>)[id];
  if (!vehicle) throw new Error(`unknown reference vehicle: ${id}`);
  return vehicle;
};
