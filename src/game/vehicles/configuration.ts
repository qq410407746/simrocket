/**
 * 飞行器"当前构型"相关的计算：哪些级还连接着、哪台发动机在工作、当前的气动外形与剩余 Δv。
 * 全部是定义数据 + 构型状态的纯函数，模拟器与界面共用。
 */
import type { AeroProperties } from '../physics/aerodynamics/drag';
import { trimAngleOfAttack } from '../physics/aerodynamics/trim';
import { DEG2RAD, STANDARD_GRAVITY } from '../physics/constants';
import { idealDeltaV } from '../physics/propulsion/engine';
import type { ThermalZoneId } from '../physics/thermodynamics/heating';
import type { ThermalSurfaceProperties } from '../physics/thermodynamics/thermalZone';
import { type MassProperties, capsuleSideAngle, computeMassProperties, parallelPhase, payloadStackHeight, stackLength } from './analysis';
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
    if (config.stages[i]?.attached) height += stackLength(stage);
  });
  const { payload } = vehicle;
  return height + (payload.kind === 'satellite' && !config.fairingAttached ? payload.geometry.length : payloadStackHeight(payload));
};

/** 是否为并联助推器组（绑在上面一级周围、与它同时工作）。 */
export const isParallelStage = (stage: StageDefinition | undefined): boolean => (stage?.parallel?.count ?? 0) > 0;

/** 一个推进单元：某一级（或载荷）的发动机与剩余推进剂。 */
export interface PropulsionUnit {
  /** 推进级下标；载荷发动机为 stages.length。 */
  readonly stageIndex: number;
  readonly engine: EngineDefinition;
  readonly engineCount: number;
  readonly propellantMass: number;
}

/** 当前可用的推进单元。 */
export interface ActivePropulsion {
  /** 'stage'：某一推进级；'payload'：载荷自带发动机。 */
  readonly source: 'stage' | 'payload';
  /** 推进级下标（source 为 'payload' 时等于 stages.length）；并联构型为助推器组的下标。 */
  readonly stageIndex: number;
  /**
   * 当前工作的发动机。只有一个推进单元时就是该级的发动机；
   * 并联构型（助推器 + 芯级）为各单元的合成：推力与喷管出口面积相加，比冲按总推力 / 总质量流量折算。
   */
  readonly engine: EngineDefinition;
  readonly engineCount: number;
  /** 所有单元剩余推进剂之和 [kg]。 */
  readonly propellantMass: number;
  /** 同时工作的推进单元（串联构型只有一个）。各单元按自己的质量流量消耗自己的推进剂。 */
  readonly units: readonly PropulsionUnit[];
}

const stageUnit = (vehicle: VehicleDefinition, config: ConfigurationState, index: number): PropulsionUnit => {
  const stage = vehicle.stages[index] as StageDefinition;
  return { stageIndex: index, engine: stage.engine, engineCount: stage.engineCount, propellantMass: config.stages[index]?.propellantMass ?? 0 };
};

/**
 * 几个同时工作的推进单元合成一台等效发动机（engineCount = 1）：
 *   F_vac = Σ F_i·n_i，A_e = Σ A_i·n_i（环境压力损失 p·A_e 因此正确相加），
 *   ṁ = Σ F_i·n_i /(g₀·Isp_i)，等效 Isp = F_vac /(g₀·ṁ)。
 * 节流：同一个指令作用于所有单元，最低节流取各单元中最高的那个；摆动范围取最小的。
 */
export const combineEngines = (units: readonly PropulsionUnit[]): EngineDefinition => {
  let thrust = 0;
  let exitArea = 0;
  let weightFlow = 0;
  let minThrottle = 0;
  let gimbal = Infinity;
  for (const u of units) {
    thrust += u.engine.thrustVacuum * u.engineCount;
    exitArea += u.engine.nozzleExitArea * u.engineCount;
    weightFlow += (u.engine.thrustVacuum * u.engineCount) / u.engine.ispVacuum;
    minThrottle = Math.max(minThrottle, u.engine.minThrottle);
    gimbal = Math.min(gimbal, u.engine.gimbalRange);
  }
  const first = units[0] as PropulsionUnit;
  return {
    id: units.map((u) => u.engine.id).join('+'),
    name: units.map((u) => (u.engineCount > 1 ? `${u.engine.name} ×${u.engineCount}` : u.engine.name)).join(' + '),
    propellant: first.engine.propellant,
    thrustVacuum: thrust,
    ispVacuum: weightFlow > 0 ? thrust / weightFlow : first.engine.ispVacuum,
    nozzleExitArea: exitArea,
    minThrottle,
    gimbalRange: Number.isFinite(gimbal) ? gimbal : 0,
  };
};

/**
 * 当前由谁提供推力：仍连接的最低一级；它是并联助推器组时，上面的芯级同时工作。
 * 各级都已分离时为载荷自带发动机（若有）。串联构型下，上面的级被下面的级挡住，不能提前点火。
 */
export const activePropulsion = (vehicle: VehicleDefinition, config: ConfigurationState): ActivePropulsion | null => {
  const index = lowestAttachedStage(config);
  const stage = vehicle.stages[index];
  if (stage) {
    const units = [stageUnit(vehicle, config, index)];
    if (isParallelStage(stage) && vehicle.stages[index + 1] && config.stages[index + 1]?.attached) units.push(stageUnit(vehicle, config, index + 1));
    const propellantMass = units.reduce((sum, u) => sum + u.propellantMass, 0);
    if (units.length === 1) {
      return { source: 'stage', stageIndex: index, engine: stage.engine, engineCount: stage.engineCount, propellantMass, units };
    }
    const fueled = units.filter((u) => u.propellantMass > 0);
    return { source: 'stage', stageIndex: index, engine: combineEngines(fueled.length > 0 ? fueled : units), engineCount: 1, propellantMass, units };
  }
  const { payload } = vehicle;
  if (!payload.engine || payload.engineCount <= 0) return null;
  const unit: PropulsionUnit = {
    stageIndex: vehicle.stages.length,
    engine: payload.engine,
    engineCount: payload.engineCount,
    propellantMass: config.payloadPropellantMass,
  };
  return { source: 'payload', stageIndex: unit.stageIndex, engine: unit.engine, engineCount: unit.engineCount, propellantMass: unit.propellantMass, units: [unit] };
};

/** 单元在节流 throttle 下的质量流量 [kg/s]。 */
export const unitMassFlow = (unit: PropulsionUnit, throttle: number): number =>
  (throttle * unit.engine.thrustVacuum * unit.engineCount) / (STANDARD_GRAVITY * unit.engine.ispVacuum);

/** 在节流 throttle 下，第一个推进单元烧完所需的时间 [s]；没有推进剂时为 0。 */
export const timeToFirstDepletion = (propulsion: ActivePropulsion, throttle: number): number => {
  let time = Infinity;
  for (const u of propulsion.units) {
    if (u.propellantMass <= 0) continue;
    const flow = unitMassFlow(u, throttle);
    if (flow > 0) time = Math.min(time, u.propellantMass / flow);
  }
  return Number.isFinite(time) ? time : 0;
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
  // 并联助推器组：迎风面积与侧向面积按个数累加到芯级上
  let strapOnArea = 0;
  vehicle.stages.forEach((stage, i) => {
    if (!config.stages[i]?.attached) return;
    const count = stage.parallel?.count ?? 1;
    lateralArea += count * stage.geometry.diameter * stage.geometry.length;
    if (isParallelStage(stage)) {
      strapOnArea += count * stage.aero.referenceArea;
      return;
    }
    referenceArea = Math.max(referenceArea, stage.aero.referenceArea + strapOnArea);
    strapOnArea = 0;
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
  /** 并联段里芯级已经烧掉的推进剂 [kg]。 */
  let preburned = 0;
  for (let i = first; i < vehicle.stages.length; i++) {
    const stage = vehicle.stages[i] as StageDefinition;
    const state = config.stages[i];
    if (!state?.attached) continue;
    const core = vehicle.stages[i + 1];
    const coreState = config.stages[i + 1];
    if (isParallelStage(stage) && core && coreState?.attached) {
      // 助推器与芯级同时烧到其中一个耗尽（合成比冲），然后抛掉助推器
      const phase = parallelPhase(stage, core, state.propellantMass, coreState.propellantMass);
      const burned = phase.burnedBooster + phase.burnedCore;
      deltaV += idealDeltaV(phase.ispVacuum, mass, mass - burned);
      mass -= burned + stage.dryMass + (state.propellantMass - phase.burnedBooster);
      preburned = phase.burnedCore;
      continue;
    }
    const propellant = Math.max(0, state.propellantMass - preburned);
    preburned = 0;
    deltaV += idealDeltaV(stage.engine.ispVacuum, mass, mass - propellant);
    mass -= stage.dryMass + propellant;
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
