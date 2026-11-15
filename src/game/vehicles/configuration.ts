/**
 * 飞行器"当前构型"相关的计算：哪些级还连接着、哪台发动机在工作、当前的气动外形与剩余 Δv。
 * 全部是定义数据 + 构型状态的纯函数，模拟器与界面共用。
 */
import type { AeroProperties } from '../physics/aerodynamics/drag';
import { trimAngleOfAttack } from '../physics/aerodynamics/trim';
import { DEG2RAD } from '../physics/constants';
import { idealDeltaV } from '../physics/propulsion/engine';
import type { ThermalZoneId } from '../physics/thermodynamics/heating';
import type { ThermalSurfaceProperties } from '../physics/thermodynamics/thermalZone';
import { type MassProperties, capsuleSideAngle, computeMassProperties, payloadStackHeight } from './analysis';
import type {
  EngineDefinition,
  LandingLimits,
  ParachuteDefinition,
  StageDefinition,
  StageState,
  StructuralLimits,
  VehicleDefinition,
} from './types';

/** 构型状态：各级的连接情况与推进剂余量。 */
export interface ConfigurationState {
  readonly stages: readonly StageState[];
  readonly payloadPropellantMass: number;
  readonly fairingAttached: boolean;
  /** 防热大底是否仍在；缺省视为仍在。 */
  readonly heatShieldAttached?: boolean;
}

/** 发射前的满载构型。 */
export const initialConfiguration = (vehicle: VehicleDefinition): ConfigurationState => ({
  stages: vehicle.stages.map((s) => ({ propellantMass: s.propellantMass, attached: true })),
  payloadPropellantMass: vehicle.payload.propellantMass,
  fairingAttached: vehicle.payload.kind === 'satellite',
  heatShieldAttached: vehicle.payload.kind === 'capsule',
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
    heatShieldAttached: config.heatShieldAttached,
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

/** 抛掉防热大底后，底部热区的归属标记。 */
export const BARE_CAPSULE_BASE = 'payload-bare';

/** 一个热区当前的归属与参数。 */
export interface ThermalZoneSetup {
  readonly zone: ThermalZoneId;
  /** 承担该热区的部件：'fairing'、'payload'、'payload-bare'（抛掉大底后的舱底）或 'stage-<下标>'。归属变化时该热区的热状态要重新开始。 */
  readonly owner: string;
  /** 计算驻点热流用的曲率半径 [m]。 */
  readonly radius: number;
  readonly surface: ThermalSurfaceProperties;
  /** 侧壁的半锥角 [rad]（向头部收缩为正）；圆柱形侧壁与其余热区不填（视为 0）。 */
  readonly slope?: number;
}

/**
 * 当前构型的三个热区（头部、侧壁、底部）分别由哪个部件、哪种材料承担。
 *
 *  - 头部：整流罩（若还在），否则是载荷的顶部（返回舱舱顶 / 卫星本体）；
 *  - 侧壁：仍带着推进级时取最低连接级的箱壁（各级材料相同，也是最薄弱的）；只剩载荷时取载荷侧壁；
 *  - 底部：最低连接级的发动机舱；只剩返回舱时是防热大底，大底抛掉后是露出来的舱底结构。
 *
 * 曲率半径：侧壁取箱体半径；推进级底部是平的钝面，取箱体直径作为等效半径。
 * 返回舱单独飞行时侧壁是锥面：大底朝前且迎角小于半锥角时，侧壁躲在大底的背风区里（见 heating.ts）。
 */
export const configurationThermalZones = (vehicle: VehicleDefinition, config: ConfigurationState): readonly ThermalZoneSetup[] => {
  const { payload } = vehicle;
  const index = lowestAttachedStage(config);
  const stage = vehicle.stages[index];

  const nose: ThermalZoneSetup =
    payload.kind === 'satellite'
      ? config.fairingAttached
        ? { zone: 'nose', owner: 'fairing', radius: payload.fairing.noseRadius, surface: payload.fairing.thermal }
        : { zone: 'nose', owner: 'payload', radius: payload.geometry.diameter / 2, surface: payload.thermal }
      : { zone: 'nose', owner: 'payload', radius: payload.apexRadius, surface: payload.thermal.apex };

  if (stage) {
    const owner = `stage-${index}`;
    return [
      nose,
      { zone: 'side', owner, radius: stage.geometry.diameter / 2, surface: stage.thermal.side },
      { zone: 'base', owner, radius: stage.geometry.diameter, surface: stage.thermal.base },
    ];
  }
  if (payload.kind === 'capsule') {
    const base: ThermalZoneSetup =
      config.heatShieldAttached === false
        ? { zone: 'base', owner: BARE_CAPSULE_BASE, radius: payload.heatShield.noseRadius, surface: payload.thermal.aft }
        : { zone: 'base', owner: 'payload', radius: payload.heatShield.noseRadius, surface: payload.heatShield.surface };
    return [
      nose,
      { zone: 'side', owner: 'payload', radius: payload.geometry.diameter / 2, surface: payload.thermal.side, slope: capsuleSideAngle(payload) },
      base,
    ];
  }
  const radius = payload.geometry.diameter / 2;
  return [
    nose,
    { zone: 'side', owner: 'payload', radius, surface: payload.thermal },
    { zone: 'base', owner: 'payload', radius, surface: payload.thermal },
  ];
};

/** 当前构型的结构强度限制：带着推进级时用组合体的限值，只剩载荷时用载荷自身的。 */
export const configurationStructure = (vehicle: VehicleDefinition, config: ConfigurationState): StructuralLimits =>
  lowestAttachedStage(config) < vehicle.stages.length ? vehicle.structure : vehicle.payload.structure;

/** 当前构型可用的降落伞：只有与所有推进级分离后的返回舱才能开伞。 */
export const configurationParachute = (vehicle: VehicleDefinition, config: ConfigurationState): ParachuteDefinition | null =>
  lowestAttachedStage(config) >= vehicle.stages.length && vehicle.payload.kind === 'capsule' ? vehicle.payload.parachute : null;

/** 没有着陆装置的飞行器（火箭箭体、卫星）可承受的接地条件：容限很小。 */
export const DEFAULT_LANDING_LIMITS: LandingLimits = { verticalSpeed: 4, horizontalSpeed: 2, tilt: 15 * DEG2RAD };

/** 当前构型可承受的接地条件：单独的返回舱用它自己的限值，其余用默认值。 */
export const configurationLandingLimits = (vehicle: VehicleDefinition, config: ConfigurationState): LandingLimits =>
  lowestAttachedStage(config) >= vehicle.stages.length && vehicle.payload.kind === 'capsule'
    ? vehicle.payload.landing
    : DEFAULT_LANDING_LIMITS;

/** 是否只剩返回舱（所有推进级都已分离）。 */
export const isCapsuleAlone = (vehicle: VehicleDefinition, config: ConfigurationState): boolean =>
  lowestAttachedStage(config) >= vehicle.stages.length && vehicle.payload.kind === 'capsule';

/**
 * 当前构型的配平迎角 [rad]：只有单独飞行的返回舱、且质心有横向偏移时不为 0。
 * 质心的轴向位置取设计值（不随大底是否抛掉而变——抛大底发生在开伞之后，配平已无意义）。
 */
export const configurationTrimAngle = (vehicle: VehicleDefinition, config: ConfigurationState): number => {
  const { payload } = vehicle;
  if (payload.kind !== 'capsule' || !isCapsuleAlone(vehicle, config)) return 0;
  return trimAngleOfAttack({
    noseRadius: payload.heatShield.noseRadius,
    baseRadius: payload.geometry.diameter / 2,
    centerOfMassHeight: payload.centerOfMass.height,
    centerOfMassOffset: payload.centerOfMass.lateralOffset,
  });
};

/** 现在能否抛掉防热大底：只有单独飞行、大底还在的返回舱可以（带着推进级时大底被挡在里面）。 */
export const canJettisonHeatShield = (vehicle: VehicleDefinition, config: ConfigurationState): boolean =>
  isCapsuleAlone(vehicle, config) && config.heatShieldAttached !== false;
