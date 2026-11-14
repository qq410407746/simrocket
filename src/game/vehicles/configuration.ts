/**
 * 飞行器"当前构型"相关的计算：哪些级还连接着、哪台发动机在工作、当前的气动外形与剩余 Δv。
 * 全部是定义数据 + 构型状态的纯函数，模拟器与界面共用。
 */
import type { AeroProperties } from '../physics/aerodynamics/drag';
import { idealDeltaV } from '../physics/propulsion/engine';
import { type MassProperties, computeMassProperties, payloadStackHeight } from './analysis';
import type { EngineDefinition, StageDefinition, StageState, VehicleDefinition } from './types';

/** 构型状态：各级的连接情况与推进剂余量。 */
export interface ConfigurationState {
  readonly stages: readonly StageState[];
  readonly payloadPropellantMass: number;
  readonly fairingAttached: boolean;
}

/** 发射前的满载构型。 */
export const initialConfiguration = (vehicle: VehicleDefinition): ConfigurationState => ({
  stages: vehicle.stages.map((s) => ({ propellantMass: s.propellantMass, attached: true })),
  payloadPropellantMass: vehicle.payload.propellantMass,
  fairingAttached: vehicle.payload.kind === 'satellite',
});

/** 仍连接的最低一级的下标；全部分离后返回 stages.length。 */
export const lowestAttachedStage = (config: ConfigurationState): number => {
  const index = config.stages.findIndex((s) => s.attached);
  return index === -1 ? config.stages.length : index;
};

/** 当前构型的总质量与质心高度（高度基准为最低连接级的底面）。 */
export const configurationMassProperties = (vehicle: VehicleDefinition, config: ConfigurationState): MassProperties =>
  computeMassProperties(vehicle, {
    stagePropellant: config.stages.map((s) => s.propellantMass),
    stageAttached: config.stages.map((s) => s.attached),
    payloadPropellant: config.payloadPropellantMass,
    fairingAttached: config.fairingAttached,
  });

/** 当前构型的总高度 [m]。 */
export const stackHeight = (vehicle: VehicleDefinition, config: ConfigurationState): number => {
  let height = 0;
  vehicle.stages.forEach((stage, i) => {
    if (config.stages[i]?.attached) height += stage.geometry.length;
  });
  const { payload } = vehicle;
  return height + (payload.kind === 'satellite' && !config.fairingAttached ? payload.geometry.length : payloadStackHeight(payload));
};

/** 当前可用的推进单元。 */
export interface ActivePropulsion {
  /** 'stage'：某一推进级；'payload'：载荷自带发动机。 */
  readonly source: 'stage' | 'payload';
  /** 推进级下标（source 为 'payload' 时等于 stages.length）。 */
  readonly stageIndex: number;
  readonly engine: EngineDefinition;
  readonly engineCount: number;
  /** 该单元剩余推进剂 [kg]。 */
  readonly propellantMass: number;
}

/**
 * 当前由谁提供推力：仍连接的最低一级；各级都已分离时为载荷自带发动机（若有）。
 * 串联构型下，上面的级被下面的级挡住，不能提前点火。
 */
export const activePropulsion = (vehicle: VehicleDefinition, config: ConfigurationState): ActivePropulsion | null => {
  const index = lowestAttachedStage(config);
  const stage = vehicle.stages[index];
  if (stage) {
    return {
      source: 'stage',
      stageIndex: index,
      engine: stage.engine,
      engineCount: stage.engineCount,
      propellantMass: config.stages[index]?.propellantMass ?? 0,
    };
  }
  const { payload } = vehicle;
  if (!payload.engine || payload.engineCount <= 0) return null;
  return {
    source: 'payload',
    stageIndex: vehicle.stages.length,
    engine: payload.engine,
    engineCount: payload.engineCount,
    propellantMass: config.payloadPropellantMass,
  };
};

/**
 * 当前构型的气动特性。
 *  - 仍带有推进级时：细长体，基准阻力系数取最低连接级的值；
 *  - 只剩载荷时：使用载荷自身的气动参数。
 *  参考面积取所有连接部件中最大的横截面；侧向面积为各部件 直径 × 长度 之和。
 */
export const configurationAero = (vehicle: VehicleDefinition, config: ConfigurationState): AeroProperties => {
  const { payload } = vehicle;
  const lowest = vehicle.stages[lowestAttachedStage(config)];
  const fairing = payload.kind === 'satellite' && config.fairingAttached ? payload.fairing : null;

  let referenceArea = fairing ? (Math.PI * fairing.geometry.diameter ** 2) / 4 : payload.aero.referenceArea;
  let lateralArea = fairing
    ? fairing.geometry.diameter * fairing.geometry.length
    : payload.geometry.diameter * payload.geometry.length;
  vehicle.stages.forEach((stage, i) => {
    if (!config.stages[i]?.attached) return;
    referenceArea = Math.max(referenceArea, stage.aero.referenceArea);
    lateralArea += stage.geometry.diameter * stage.geometry.length;
  });

  const source = lowest ? lowest.aero : payload.aero;
  return {
    referenceArea,
    baseDragCoefficient: source.dragCoefficient,
    shape: source.shape,
    lateralArea,
  };
};

/**
 * 当前构型的剩余理想 Δv [m/s]（真空比冲，齐奥尔科夫斯基方程）。
 * 约定：自下而上依次燃尽并抛掉各级；若整流罩仍在且上方还有推进级，则在当前最低级分离时一并抛掉。
 */
export const remainingDeltaV = (vehicle: VehicleDefinition, config: ConfigurationState): number => {
  const { payload } = vehicle;
  let mass = configurationMassProperties(vehicle, config).mass;
  let fairingMass = payload.kind === 'satellite' && config.fairingAttached ? payload.fairing.mass : 0;
  let deltaV = 0;
  const first = lowestAttachedStage(config);
  for (let i = first; i < vehicle.stages.length; i++) {
    const stage = vehicle.stages[i] as StageDefinition;
    const state = config.stages[i];
    if (!state?.attached) continue;
    deltaV += idealDeltaV(stage.engine.ispVacuum, mass, mass - state.propellantMass);
    mass -= stage.dryMass + state.propellantMass;
    if (fairingMass > 0 && i < vehicle.stages.length - 1) {
      mass -= fairingMass;
      fairingMass = 0;
    }
  }
  if (payload.engine && config.payloadPropellantMass > 0) {
    deltaV += idealDeltaV(payload.engine.ispVacuum, mass, mass - config.payloadPropellantMass);
  }
  return deltaV;
};

/** 单独一级（分离后的箭体）的质量与质心高度（相对该级底面）。 */
export const stageAloneMassProperties = (stage: StageDefinition, propellantMass: number): MassProperties => {
  const propellant = Math.max(0, Math.min(stage.propellantMass, propellantMass));
  const fill = stage.propellantMass > 0 ? propellant / stage.propellantMass : 0;
  const length = stage.geometry.length;
  const mass = stage.dryMass + propellant;
  return {
    mass,
    centerOfMassHeight: mass > 0 ? (stage.dryMass * (length / 2) + propellant * ((fill * length) / 2)) / mass : length / 2,
  };
};
