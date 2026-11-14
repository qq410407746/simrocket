/**
 * 飞行器目录。
 *
 * 这些是为本游戏原创设计的虚构火箭，参数取自同类真实运载器的典型量级
 * （煤油/液氧燃气发生器循环发动机、氢氧上面级等），以保证物理上自洽。
 * 飞行性能（Δv、推重比）一律由 game/vehicles/analysis.ts 从这些参数计算得出，不在此处手写。
 *
 * 气动参数为典型量级的工程估计（阻力模型见 physics/aerodynamics/drag.ts）；
 * 热防护参数尚无模型消费（阶段四）。
 */
import { DEG2RAD } from '@/game/physics/constants';
import type { EngineDefinition, VehicleDefinition } from '@/game/vehicles/types';

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
    heatShield: {
      noseRadius: 2.6,
      emissivity: 0.85,
      maxSurfaceTemperature: 1_900,
      ablatorMass: 90,
      heatOfAblation: 2.5e7,
    },
  },
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
    heatShield: {
      noseRadius: 4.6,
      emissivity: 0.85,
      maxSurfaceTemperature: 3_000,
      ablatorMass: 550,
      heatOfAblation: 2.8e7,
    },
  },
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
    fairing: {
      mass: 1_900,
      geometry: { diameter: 4.6, length: 11 },
    },
  },
};

export const VEHICLE_CATALOG: readonly VehicleDefinition[] = [METEOR_S, FRONTIER_1, ZENITH_3];

export const DEFAULT_VEHICLE_ID = FRONTIER_1.id;

export const findVehicle = (id: string): VehicleDefinition | undefined =>
  VEHICLE_CATALOG.find((v) => v.id === id);

/** 按 id 取飞行器；id 无效时回退到默认飞行器（例如旧存档引用了已删除的型号）。 */
export const getVehicleOrDefault = (id: string): VehicleDefinition =>
  findVehicle(id) ?? (findVehicle(DEFAULT_VEHICLE_ID) as VehicleDefinition);
