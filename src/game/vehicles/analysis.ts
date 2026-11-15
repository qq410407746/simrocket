/**
 * 飞行器静态性能分析：质量、质心、推力、推重比、理想 Δv。
 * 全部是定义数据的纯函数，供模拟器、UI 与测试共用。
 */
import { SEA_LEVEL, STANDARD_GRAVITY } from '../physics/constants';
import { engineIsp, engineMassFlow, engineThrust, idealDeltaV } from '../physics/propulsion/engine';
import type { PayloadDefinition, StageDefinition, VehicleDefinition } from './types';

/** 载荷满载质量 [kg]，含整流罩（若有）。 */
export const payloadWetMass = (payload: PayloadDefinition, withFairing = true): number =>
  payload.dryMass + payload.propellantMass + (withFairing && payload.kind === 'satellite' ? payload.fairing.mass : 0);

/** 单级满载质量 [kg]。 */
export const stageWetMass = (stage: StageDefinition): number => stage.dryMass + stage.propellantMass;

/** 起飞总质量 [kg]。 */
export const liftoffMass = (vehicle: VehicleDefinition): number =>
  vehicle.stages.reduce((sum, s) => sum + stageWetMass(s), 0) + payloadWetMass(vehicle.payload);

/** 一级在环境压力 p 下的总推力 [N]（满推力）。 */
export const stageThrust = (stage: StageDefinition, ambientPressure: number, throttle = 1): number =>
  engineThrust(stage.engine, ambientPressure, throttle) * stage.engineCount;

/** 一级总质量流量 [kg/s]。 */
export const stageMassFlow = (stage: StageDefinition, throttle = 1): number =>
  engineMassFlow(stage.engine, throttle) * stage.engineCount;

/** 满推力燃烧时间 [s]。 */
export const stageBurnTime = (stage: StageDefinition): number => {
  const mdot = stageMassFlow(stage);
  return mdot > 0 ? stage.propellantMass / mdot : 0;
};

/**
 * 载荷罩上方组件的外形高度 [m]：飞船为舱体高度，卫星为整流罩高度。
 */
export const payloadStackHeight = (payload: PayloadDefinition): number =>
  payload.kind === 'satellite' ? payload.fairing.geometry.length : payload.geometry.length;

/** 载荷质心到载荷底面的高度 [m]：返回舱取设计值，卫星取几何中心。 */
export const payloadCenterOfMassHeight = (payload: PayloadDefinition): number =>
  payload.kind === 'capsule' ? payload.centerOfMass.height : payload.geometry.length / 2;

/** 防热大底的质心到舱底的高度 [m]（大底是贴着舱底的一个浅碟）。 */
export const heatShieldCenterHeight = (payload: PayloadDefinition): number => (payload.geometry.length * CAPSULE_PROFILE.shieldHeight) / 2;

/**
 * 返回舱的外形比例（半径以最大半径为单位，高度以舱体总高为单位）：
 * 防热大底占最下面一段，其上是略微收口的肩部，再往上是锥形侧壁，顶部是对接机构。
 * 渲染层按同一组比例生成模型，热模型用它算出侧壁的半锥角。
 */
export const CAPSULE_PROFILE = {
  /** 防热大底的高度。 */
  shieldHeight: 0.13,
  /** 锥形侧壁的起点（肩部）：高度与半径。 */
  shoulderHeight: 0.2,
  shoulderRadius: 0.985,
  /** 锥形侧壁的终点：高度与半径。 */
  topHeight: 0.86,
  topRadius: 0.44,
} as const;

/** 返回舱锥形侧壁的半锥角 [rad]（向舱顶收缩）。 */
export const capsuleSideAngle = (capsule: { readonly geometry: { readonly diameter: number; readonly length: number } }): number =>
  Math.atan2(
    ((CAPSULE_PROFILE.shoulderRadius - CAPSULE_PROFILE.topRadius) * capsule.geometry.diameter) / 2,
    (CAPSULE_PROFILE.topHeight - CAPSULE_PROFILE.shoulderHeight) * capsule.geometry.length,
  );

/** 飞行器总高度 [m]。 */
export const vehicleHeight = (vehicle: VehicleDefinition): number =>
  vehicle.stages.reduce((sum, s) => sum + s.geometry.length, 0) + payloadStackHeight(vehicle.payload);

/** 飞行器最大直径 [m]。 */
export const vehicleMaxDiameter = (vehicle: VehicleDefinition): number => {
  const p = vehicle.payload;
  const payloadDiameter = p.kind === 'satellite' ? p.fairing.geometry.diameter : p.geometry.diameter;
  return Math.max(payloadDiameter, ...vehicle.stages.map((s) => s.geometry.diameter));
};

export interface StagePerformance {
  readonly stageId: string;
  readonly stageName: string;
  /** 本级点火时的全箭质量 [kg]。 */
  readonly ignitionMass: number;
  /** 本级燃尽时的全箭质量 [kg]。 */
  readonly burnoutMass: number;
  /** 真空推力 [N]。 */
  readonly thrustVacuum: number;
  /** 海平面推力 [N]。 */
  readonly thrustSeaLevel: number;
  /** 真空比冲 [s]。 */
  readonly ispVacuum: number;
  /** 海平面比冲 [s]。 */
  readonly ispSeaLevel: number;
  /** 满推力燃烧时间 [s]。 */
  readonly burnTime: number;
  /** 理想 Δv（真空比冲）[m/s]。 */
  readonly deltaVVacuum: number;
  /** 点火时推重比（真空推力 / 点火质量·g₀）。 */
  readonly twrVacuumAtIgnition: number;
}

export interface VehiclePerformance {
  readonly liftoffMass: number;
  /** 起飞推重比：一级海平面推力 /（起飞质量·g₀）。 */
  readonly liftoffTwr: number;
  readonly stages: readonly StagePerformance[];
  /** 载荷自带发动机的理想 Δv [m/s]。 */
  readonly payloadDeltaV: number;
  /** 各推进级真空理想 Δv 之和 + 载荷 Δv [m/s]。 */
  readonly totalDeltaVVacuum: number;
  readonly height: number;
}

/**
 * 逐级性能分析。
 *
 * 假设：串联分级；每级燃尽后整级抛掉；整流罩在第一级分离后抛掉
 * （即只计入第一级的点火/燃尽质量）。这是 Δv 预算的常用估算约定，
 * 实际抛罩时机在阶段二由飞行状态决定。
 */
export const analyzeVehicle = (vehicle: VehicleDefinition): VehiclePerformance => {
  const { stages, payload } = vehicle;
  const total = liftoffMass(vehicle);
  const fairingMass = payload.kind === 'satellite' ? payload.fairing.mass : 0;

  const perStage: StagePerformance[] = [];
  let massAbove = total;
  stages.forEach((stage, i) => {
    // 第一级携带整流罩；第二级点火前整流罩已分离。
    const ignitionMass = massAbove - (i === 1 ? fairingMass : 0);
    const burnoutMass = ignitionMass - stage.propellantMass;
    const thrustVacuum = stageThrust(stage, 0);
    perStage.push({
      stageId: stage.id,
      stageName: stage.name,
      ignitionMass,
      burnoutMass,
      thrustVacuum,
      thrustSeaLevel: stageThrust(stage, SEA_LEVEL.PRESSURE),
      ispVacuum: stage.engine.ispVacuum,
      ispSeaLevel: engineIsp(stage.engine, SEA_LEVEL.PRESSURE),
      burnTime: stageBurnTime(stage),
      deltaVVacuum: idealDeltaV(stage.engine.ispVacuum, ignitionMass, burnoutMass),
      twrVacuumAtIgnition: thrustVacuum / (ignitionMass * STANDARD_GRAVITY),
    });
    massAbove = ignitionMass - stageWetMass(stage);
  });

  const payloadDeltaV = payload.engine
    ? idealDeltaV(payload.engine.ispVacuum, payload.dryMass + payload.propellantMass, payload.dryMass)
    : 0;

  const first = perStage[0];
  return {
    liftoffMass: total,
    liftoffTwr: first ? first.thrustSeaLevel / (total * STANDARD_GRAVITY) : 0,
    stages: perStage,
    payloadDeltaV,
    totalDeltaVVacuum: perStage.reduce((sum, s) => sum + s.deltaVVacuum, 0) + payloadDeltaV,
    height: vehicleHeight(vehicle),
  };
};

/** 质量特性：总质量与质心位置。 */
export interface MassProperties {
  /** 总质量 [kg]。 */
  readonly mass: number;
  /** 质心距飞行器底端的高度 [m]（沿机体 +X）。 */
  readonly centerOfMassHeight: number;
}

export interface MassPropertiesInput {
  /** 各级剩余推进剂 [kg]，与 definition.stages 对应。 */
  readonly stagePropellant: readonly number[];
  /** 各级是否仍连接。 */
  readonly stageAttached: readonly boolean[];
  readonly payloadPropellant: number;
  readonly fairingAttached: boolean;
  /** 防热大底是否仍在；缺省为是。 */
  readonly heatShieldAttached?: boolean;
}

/**
 * 计算当前构型的总质量与质心高度。
 *
 * 模型：每个部件视为沿纵轴均匀分布的质量——
 *  - 级的干质量：位于该级几何中心；
 *  - 级的推进剂：贮箱占满整级长度，推进剂沉在底部，质心在液柱中点（长度随余量线性缩短）；
 *  - 返回舱：位于其设计质心；抛掉防热大底后减去大底的质量（质心相应上移）；
 *  - 卫星与整流罩：位于各自几何中心。
 * 这是一维近似，足以给出质心随推进剂消耗的移动趋势；转动惯量在阶段二加入。
 *
 * "底端"指当前仍连接的最低一级的底面，因此分级后高度基准会随之改变。
 */
export const computeMassProperties = (vehicle: VehicleDefinition, input: MassPropertiesInput): MassProperties => {
  let mass = 0;
  let moment = 0;
  let base = 0;

  vehicle.stages.forEach((stage, i) => {
    if (!input.stageAttached[i]) return;
    const len = stage.geometry.length;
    const propellant = Math.max(0, Math.min(stage.propellantMass, input.stagePropellant[i] ?? 0));
    const fill = stage.propellantMass > 0 ? propellant / stage.propellantMass : 0;
    mass += stage.dryMass + propellant;
    moment += stage.dryMass * (base + len / 2) + propellant * (base + (fill * len) / 2);
    base += len;
  });

  const { payload } = vehicle;
  let payloadMass = payload.dryMass + Math.max(0, input.payloadPropellant);
  let payloadMoment = payloadMass * payloadCenterOfMassHeight(payload);
  if (payload.kind === 'capsule' && input.heatShieldAttached === false) {
    payloadMass -= payload.heatShield.mass;
    payloadMoment -= payload.heatShield.mass * heatShieldCenterHeight(payload);
  }
  mass += payloadMass;
  moment += payloadMass * base + payloadMoment;

  if (payload.kind === 'satellite' && input.fairingAttached) {
    mass += payload.fairing.mass;
    moment += payload.fairing.mass * (base + payload.fairing.geometry.length / 2);
  }

  return { mass, centerOfMassHeight: mass > 0 ? moment / mass : 0 };
};
