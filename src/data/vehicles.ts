/**
 * 飞行器目录：三种真实火箭。
 *
 * 数据来源（2026-11-20 查阅的英文维基百科条目，及其引用的用户手册）：
 *  - 水星-红石：Mercury-Redstone Launch Vehicle、PGM-11 Redstone、Mercury-Redstone 3（自由 7 号）、Project Mercury；
 *  - 联盟-2.1a / 联盟 MS：Soyuz-2（各级数据引自 Arianespace《Soyuz User's Manual》）、RD-107（含 RD-108）、
 *    RD-0110、Soyuz MS、Soyuz (spacecraft)、KTDU-80；
 *  - 宇宙神 V 401：Atlas V（引自《Atlas V Mission Planner's Guide》）、Common Core Booster、RD-180、
 *    Centaur (rocket stage)、RL10。
 *
 * 约定：
 *  - 发动机给出真空推力与真空比冲；喷管出口面积由资料中的海平面 / 真空推力差反推：A_e = (F_vac − F_SL) / p₀。
 *  - 级的干质量 = 资料中的满载质量 − 资料中的可用推进剂（因此包括残余推进剂、过氧化氢、增压气体等不参与燃烧的质量）。
 *  - 资料没有给出节流范围的发动机按"不可节流"处理（minThrottle = 1）。
 *  - 资料里查不到、需要估算的量，在旁边用"估算"注明，并说明依据。阻力系数、结构强度限值、防热层面密度、
 *    返回舱质心偏移等属于游戏物理模型的参数，资料中没有对应数值，全部为估算。
 *  - 发动机的 gimbalRange 目前没有被物理模型使用（姿态为简化模型），只作记录。
 *
 * 飞行性能（Δv、推重比）一律由 game/vehicles/analysis.ts 从这些参数计算得出，不在此处手写。
 */
import { DEG2RAD, SEA_LEVEL } from '@/game/physics/constants';
import type { EngineDefinition, LandingLimits, StageDefinition, StructuralLimits, VehicleDefinition } from '@/game/vehicles/types';
import {
  ALUMINUM_TANK_SKIN,
  CAPSULE_AFT_STRUCTURE,
  CAPSULE_BACKSHELL,
  ENGINE_SECTION,
  FAIRING_SHELL,
  SATELLITE_BODY,
  ablativeHeatShield,
} from './materials';

const circleArea = (diameter: number): number => (Math.PI * diameter * diameter) / 4;
const LBF = 4.448_221_615_260_5;
const LB = 0.453_592_37;
const FT = 0.3048;

/** 由资料中的海平面推力与真空推力反推喷管出口面积 [m²]。 */
const exitAreaFrom = (thrustVacuum: number, thrustSeaLevel: number): number => (thrustVacuum - thrustSeaLevel) / SEA_LEVEL.PRESSURE;

// ───────────────────────────── 发动机 ─────────────────────────────

/**
 * Rocketdyne A-7（水星-红石）。乙醇 / 液氧，定推力。
 * 资料：海平面推力 78,000 lbf、比冲 215 s、燃烧 143.5 s（Mercury-Redstone Launch Vehicle）。
 * 估算：资料没有给出真空性能，真空比冲取 235 s（醇氧发动机、低膨胀比喷管的典型值），由此得到真空推力与喷管面积。
 */
const A7_SEA_LEVEL_THRUST = 78_000 * LBF;
const A7_ISP_SEA_LEVEL = 215;
const A7_ISP_VACUUM = 235;
const A7_THRUST_VACUUM = (A7_SEA_LEVEL_THRUST * A7_ISP_VACUUM) / A7_ISP_SEA_LEVEL;
const A7: EngineDefinition = {
  id: 'a-7',
  name: 'A-7',
  propellant: 'alcolox',
  thrustVacuum: A7_THRUST_VACUUM,
  ispVacuum: A7_ISP_VACUUM,
  nozzleExitArea: exitAreaFrom(A7_THRUST_VACUUM, A7_SEA_LEVEL_THRUST),
  // 定推力发动机，靠燃气舵控制方向
  minThrottle: 1,
  gimbalRange: 0,
};

/** RD-107A（联盟号助推器，每个助推器一台：4 个主燃烧室 + 2 个游动发动机）。资料：SL 838.5 kN / 真空 1021.3 kN，比冲 262 / 319 s。 */
const RD_107A: EngineDefinition = {
  id: 'rd-107a',
  name: 'RD-107A',
  propellant: 'kerolox',
  thrustVacuum: 1_021.3e3,
  ispVacuum: 319,
  nozzleExitArea: exitAreaFrom(1_021.3e3, 838.5e3),
  minThrottle: 1,
  gimbalRange: 0,
};

/** RD-108A（联盟号芯级：4 个主燃烧室 + 4 个游动发动机）。资料：SL 792.5 kN / 真空 990.2 kN，比冲 255 / 319 s。 */
const RD_108A: EngineDefinition = {
  id: 'rd-108a',
  name: 'RD-108A',
  propellant: 'kerolox',
  thrustVacuum: 990.2e3,
  ispVacuum: 319,
  nozzleExitArea: exitAreaFrom(990.2e3, 792.5e3),
  minThrottle: 1,
  gimbalRange: 0,
};

/**
 * RD-0110（联盟-2.1a 第三级）。资料：真空推力 298.03 kN，真空比冲 325 s。
 * 估算：资料没有海平面推力，喷管出口面积取 1.0 m²（只影响在稠密大气中点火时的推力，第三级在 40 km 以上才点火）。
 */
const RD_0110: EngineDefinition = {
  id: 'rd-0110',
  name: 'RD-0110',
  propellant: 'kerolox',
  thrustVacuum: 298.03e3,
  ispVacuum: 325,
  nozzleExitArea: 1.0,
  minThrottle: 1,
  gimbalRange: 0,
};

/**
 * KTDU-80 主发动机（联盟 MS 服务舱）。四氧化二氮 / 偏二甲肼，挤压式。资料：推力 2.95 kN，比冲 302 s，摆动 5°。
 * 估算：喷管出口面积取 0.05 m²（只在真空中工作，不影响结果）。
 */
const KTDU_80: EngineDefinition = {
  id: 'ktdu-80',
  name: 'KTDU-80',
  propellant: 'hypergolic',
  thrustVacuum: 2.95e3,
  ispVacuum: 302,
  nozzleExitArea: 0.05,
  minThrottle: 1,
  gimbalRange: 5 * DEG2RAD,
};

/** RD-180（宇宙神 V 一级）。资料：SL 3827 kN / 真空 4152 kN，比冲 311 / 338 s，节流范围 47–100%。 */
const RD_180: EngineDefinition = {
  id: 'rd-180',
  name: 'RD-180',
  propellant: 'kerolox',
  thrustVacuum: 4_152e3,
  ispVacuum: 338,
  nozzleExitArea: exitAreaFrom(4_152e3, 3_827e3),
  minThrottle: 0.47,
  gimbalRange: 0,
};

/**
 * RL10C-1（单发半人马座）。液氢 / 液氧。资料：真空推力 101.8 kN，比冲 449.7 s，发动机直径 1.45 m。
 * 资料没有给出节流能力（RL10 条目里的深度节流指 CECE 验证机），按不可节流处理。
 * 喷管出口面积取直径 1.45 m 的圆面积（发动机最大直径即喷管出口）。
 */
const RL10C_1: EngineDefinition = {
  id: 'rl10c-1',
  name: 'RL10C-1',
  propellant: 'hydrolox',
  thrustVacuum: 101.8e3,
  ispVacuum: 449.7,
  nozzleExitArea: circleArea(1.45),
  minThrottle: 1,
  gimbalRange: 0,
};

// ───────────────────────────── 结构、防热与回收 ─────────────────────────────

/** 推进级的表面：铝合金箱壁 + 底部发动机舱。 */
const STAGE_THERMAL: StageDefinition['thermal'] = { side: ALUMINUM_TANK_SKIN, base: ENGINE_SECTION };

/**
 * 运载火箭组合体的结构限制（估算：资料没有给出）。
 * 最大动压与 q·sin α 的限值相当于：在约 40 kPa 的最大动压区，迎角不能超过 5° 左右。
 */
const LAUNCHER_STRUCTURE: StructuralLimits = { maxGLoad: 10, maxDynamicPressure: 80_000, maxBendingLoad: 3_500 };

/** 返回舱接地可承受的条件（估算）。 */
const CAPSULE_LANDING: LandingLimits = { verticalSpeed: 10, horizontalSpeed: 8, tilt: 45 * DEG2RAD };

/** 细长箭体的基准阻力系数（估算）。 */
const SLENDER_CD = 0.3;

// ───────────────────────────── 水星-红石 ─────────────────────────────

/**
 * 水星-红石：1961 年 5 月 5 日"自由 7 号"（MR-3）把艾伦·谢泼德送上亚轨道。
 * 资料：起飞质量 66,000 lb，直径 5.83 ft，A-7 燃烧 143.5 s。
 * 推进剂 = 海平面质量流量 × 燃烧时间（资料没有给出水星-红石的贮箱容量）。
 * 返回舱：发射质量 4,040 lb，着陆质量 2,316 lb。游戏里返回舱取着陆质量；其余约 780 kg
 * （逃逸塔、制动火箭包等，游戏中不单独建模）计入箭体——逃逸塔在关机后 2 s 抛掉，与箭体分离时间几乎相同。
 */
const MR_LIFTOFF_MASS = 66_000 * LB;
const MR_PROPELLANT = (A7_SEA_LEVEL_THRUST / (A7_ISP_SEA_LEVEL * 9.806_65)) * 143.5;
const MERCURY_LANDING_MASS = 2_316 * LB;
const MERCURY_DIAMETER = 1.89; // 估算：所查资料没有给出舱底直径，取常见公开值 74.5 in
const MERCURY_REDSTONE: VehicleDefinition = {
  id: 'mercury-redstone',
  name: 'Mercury-Redstone',
  nameZh: '水星-红石',
  role: '亚轨道 · 载人',
  description: '美国第一枚载人火箭：单级红石火箭搭载水星飞船。1961 年"自由 7 号"由它送上 187 km 高的亚轨道。',
  stages: [
    {
      id: 'mercury-redstone-booster',
      name: '红石箭体',
      dryMass: MR_LIFTOFF_MASS - MR_PROPELLANT - MERCURY_LANDING_MASS,
      propellantMass: MR_PROPELLANT,
      engine: A7,
      engineCount: 1,
      // 直径为资料值；长度为估算（资料只给出含逃逸塔的全长 83.38 ft）
      geometry: { diameter: 5.83 * FT, length: 18 },
      aero: { referenceArea: circleArea(5.83 * FT), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'capsule',
    id: 'mercury',
    name: '水星飞船',
    dryMass: MERCURY_LANDING_MASS,
    propellantMass: 0,
    engine: null,
    engineCount: 0,
    // 舱体高度为估算
    geometry: { diameter: MERCURY_DIAMETER, length: 2.9 },
    aero: { referenceArea: circleArea(MERCURY_DIAMETER), dragCoefficient: 1.3, shape: 'blunt' },
    // 估算：自由 7 号再入过载约 11 g，结构限值留有裕度
    structure: { maxGLoad: 20, maxDynamicPressure: 150_000, maxBendingLoad: Infinity },
    // 玻璃纤维层烧蚀防热罩；面密度、质量、曲率半径为估算
    heatShield: { noseRadius: 2.2, surface: ablativeHeatShield(1.5), mass: 140 },
    // 水星飞船为弹道式返回舱，质心在轴线上（估算：质心高度）
    centerOfMass: { height: 0.8, lateralOffset: 0 },
    apexRadius: 0.3,
    thermal: { apex: CAPSULE_BACKSHELL, side: CAPSULE_BACKSHELL, aft: CAPSULE_AFT_STRUCTURE },
    // 由 MR-3 的实测下降速度反推（资料：22,000 ft 开减速伞，下降速度降到 365 ft/s；10,000 ft 开主伞，降到 30 ft/s）。
    // 主伞开伞动压：减速伞下 10,000 ft 处的动压约 3.8 kPa，取 4.5 kPa（游戏按动压而不是高度触发主伞）
    parachute: {
      drogueDragArea: 2.7,
      mainDragArea: 200,
      maxDeployDynamicPressure: 12_000,
      maxDeployMach: 0.9,
      mainDeployDynamicPressure: 4_500,
      drogueInflationTime: 2,
      mainInflationTime: 8,
    },
    // 估算：水星飞船溅落在海面上，着陆气囊（防热罩下放 4 ft）缓冲冲击，可承受的垂直速度取 12 m/s
    landing: { ...CAPSULE_LANDING, verticalSpeed: 12 },
  },
  // 估算：短粗单级箭体
  structure: { maxGLoad: 12, maxDynamicPressure: 100_000, maxBendingLoad: 6_000 },
};

// ───────────────────────────── 联盟-2.1a ─────────────────────────────

/**
 * 联盟-2.1a + 联盟 MS 载人飞船（拜科努尔）。
 * 资料（各级）：助推器 ×4：长 19.6 m、直径 2.68 m、满载 44,413 kg，液氧 27,900 kg + 煤油 11,260 kg，燃烧 118 s；
 * 芯级：长 27.1 m、直径 2.95 m、满载 99,765 kg，液氧 63,800 kg + 煤油 26,300 kg，燃烧 286 s；
 * 第三级：长 6.7 m、直径 2.66 m、满载 27,755 kg，液氧 17,800 kg + 煤油 7,600 kg，燃烧 250 s。
 * 资料（飞船）：总质量 7,080 kg；轨道舱 1,350 kg；返回舱 2,950 kg、长 2.24 m、直径 2.17 m；
 * 服务舱 2,900 kg（含可用推进剂 800 kg）、直径 2.72 m。
 *
 * 游戏里的处理：服务舱与轨道舱合成飞船的"第四级"（KTDU-80 主发动机负责离轨制动），返回舱是载荷。
 * 真实飞船里轨道舱在返回舱上面，这里为了用串联模型而把它与服务舱放在一起，只影响外形与质心，不影响质量。
 * 发射时罩住飞船的头部整流罩与逃逸塔没有建模（资料给出的起飞质量 312 t 与各级之和吻合，未单列它们的质量）。
 */
const SOYUZ_BOOSTER_PROPELLANT = 27_900 + 11_260;
const SOYUZ_CORE_PROPELLANT = 63_800 + 26_300;
const SOYUZ_THIRD_PROPELLANT = 17_800 + 7_600;
const SOYUZ_2_1A: VehicleDefinition = {
  id: 'soyuz-2-1a',
  name: 'Soyuz-2.1a',
  nameZh: '联盟-2.1a',
  role: '近地轨道 · 载人',
  description: '俄罗斯联盟-2.1a：四个捆绑助推器与芯级同时点火，第三级入轨，搭载三人座联盟 MS 飞船。',
  stages: [
    {
      id: 'soyuz-2-1a-boosters',
      name: '助推器（B/V/G/D）',
      dryMass: 4 * (44_413 - SOYUZ_BOOSTER_PROPELLANT),
      propellantMass: 4 * SOYUZ_BOOSTER_PROPELLANT,
      engine: RD_107A,
      engineCount: 4,
      geometry: { diameter: 2.68, length: 19.6 },
      aero: { referenceArea: circleArea(2.68), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
      parallel: { count: 4 },
    },
    {
      id: 'soyuz-2-1a-core',
      name: '芯级（A）',
      dryMass: 99_765 - SOYUZ_CORE_PROPELLANT,
      propellantMass: SOYUZ_CORE_PROPELLANT,
      engine: RD_108A,
      engineCount: 1,
      geometry: { diameter: 2.95, length: 27.1 },
      aero: { referenceArea: circleArea(2.95), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'soyuz-2-1a-block-i',
      name: '第三级（I）',
      dryMass: 27_755 - SOYUZ_THIRD_PROPELLANT,
      propellantMass: SOYUZ_THIRD_PROPELLANT,
      engine: RD_0110,
      engineCount: 1,
      geometry: { diameter: 2.66, length: 6.7 },
      aero: { referenceArea: circleArea(2.66), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'soyuz-ms-service',
      name: '服务舱与轨道舱',
      dryMass: 2_900 - 800 + 1_350,
      propellantMass: 800,
      engine: KTDU_80,
      engineCount: 1,
      // 直径为服务舱资料值；长度 = 服务舱 2.26 m + 轨道舱 2.98 m
      geometry: { diameter: 2.72, length: 2.26 + 2.98 },
      aero: { referenceArea: circleArea(2.72), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'capsule',
    id: 'soyuz-ms-descent',
    name: '联盟 MS 返回舱',
    dryMass: 2_950,
    propellantMass: 0,
    engine: null,
    engineCount: 0,
    geometry: { diameter: 2.17, length: 2.24 },
    aero: { referenceArea: circleArea(2.17), dragCoefficient: 1.3, shape: 'blunt' },
    // 估算：载人返回舱可承受约 14 g
    structure: { maxGLoad: 14, maxDynamicPressure: 150_000, maxBendingLoad: Infinity },
    // 资料：21–28 mm 厚的玻璃-酚醛烧蚀层。面密度、质量、曲率半径为估算
    heatShield: { noseRadius: 2.4, surface: ablativeHeatShield(4), mass: 300 },
    // 估算：联盟号返回舱靠质心偏移实现约 0.25–0.3 的升阻比（半弹道式再入），资料没有给出偏移量。
    // 取 5.6 cm：按牛顿流球冠模型配平迎角约 17°，升阻比约 0.27
    centerOfMass: { height: 0.8, lateralOffset: 0.056 },
    apexRadius: 0.4,
    thermal: { apex: CAPSULE_BACKSHELL, side: CAPSULE_BACKSHELL, aft: CAPSULE_AFT_STRUCTURE },
    // 估算：资料没有给出伞面积。主伞按约 7 m/s 的下降速度设定；着陆前 1 m 点火的软着陆发动机没有建模
    parachute: {
      drogueDragArea: 24,
      mainDragArea: 950,
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

// ───────────────────────────── 宇宙神 V 401 ─────────────────────────────

/**
 * 宇宙神 V 401：通用芯级（RD-180）+ 单发半人马座 III，4 m 级整流罩，无固体助推器。
 * 资料：通用芯级长 32.46 m、直径 3.81 m、干质量 21,054 kg、推进剂 284,089 kg；
 * 半人马座 III 长 12.68 m、直径 3.05 m、推进剂 20,830 kg、干质量 2,247 kg（单发）；
 * 整流罩直径 4.2 m，有 9 / 10 / 11 m 三种长度；401 的 GTO 运力 4,750 kg。
 * 估算：资料没有整流罩质量，取 2,100 kg（10 m 长型号）。
 */
const ATLAS_V_401: VehicleDefinition = {
  id: 'atlas-v-401',
  name: 'Atlas V 401',
  nameZh: '宇宙神V 401',
  role: '地球同步转移轨道 · 货运',
  description: '美国宇宙神 V 401：RD-180 芯级（可节流到 47%）加氢氧半人马座上面级，4 m 整流罩内搭载通信卫星。',
  stages: [
    {
      id: 'atlas-v-ccb',
      name: '通用芯级',
      dryMass: 21_054,
      propellantMass: 284_089,
      engine: RD_180,
      engineCount: 1,
      geometry: { diameter: 3.81, length: 32.46 },
      aero: { referenceArea: circleArea(3.81), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
    {
      id: 'atlas-v-centaur',
      name: '半人马座上面级',
      dryMass: 2_247,
      propellantMass: 20_830,
      engine: RL10C_1,
      engineCount: 1,
      geometry: { diameter: 3.05, length: 12.68 },
      aero: { referenceArea: circleArea(3.05), dragCoefficient: SLENDER_CD, shape: 'slender' },
      thermal: STAGE_THERMAL,
    },
  ],
  payload: {
    kind: 'satellite',
    id: 'relay-7',
    name: 'Relay-7 通信卫星',
    // 虚构卫星。质量按宇宙神 V 401 + 半人马座直接送入 GEO 的能力设定（卫星本身没有远地点发动机），见 PHYSICS.md
    dryMass: 1_800,
    propellantMass: 0,
    engine: null,
    engineCount: 0,
    geometry: { diameter: 2.6, length: 4.2 },
    aero: { referenceArea: circleArea(2.6), dragCoefficient: 2.2, shape: 'blunt' },
    // 卫星：展开机构与电池板不能承受气动载荷（估算）
    structure: { maxGLoad: 10, maxDynamicPressure: 3_000, maxBendingLoad: Infinity },
    thermal: SATELLITE_BODY,
    fairing: {
      mass: 2_100,
      geometry: { diameter: 4.2, length: 10 },
      noseRadius: 0.9,
      thermal: FAIRING_SHELL,
    },
  },
  structure: LAUNCHER_STRUCTURE,
};

export const VEHICLE_CATALOG: readonly VehicleDefinition[] = [MERCURY_REDSTONE, SOYUZ_2_1A, ATLAS_V_401];

export const DEFAULT_VEHICLE_ID = SOYUZ_2_1A.id;

export const findVehicle = (id: string): VehicleDefinition | undefined =>
  VEHICLE_CATALOG.find((v) => v.id === id);

/** 按 id 取飞行器；id 无效时回退到默认飞行器（例如旧存档引用了已删除的型号）。 */
export const getVehicleOrDefault = (id: string): VehicleDefinition =>
  findVehicle(id) ?? (findVehicle(DEFAULT_VEHICLE_ID) as VehicleDefinition);
