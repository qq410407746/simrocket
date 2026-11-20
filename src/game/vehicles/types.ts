/**
 * 飞行器定义（静态设计数据）与飞行器状态（随时间变化的数据）。
 *
 * 所有量使用 SI 单位。定义是不可变的"图纸"；状态由模拟器在每个物理步更新。
 * 渲染层根据同一份定义程序化生成三维模型，保证"看到的"与"算出来的"是同一枚火箭。
 */
import type { DragShape } from '../physics/aerodynamics/drag';
import type { AttitudeInput } from '../physics/attitude/attitude';
import type { AttitudeMode } from '../physics/attitude/pointing';
import type { Vec3 } from '../physics/math/vec3';
import type { EnginePerformanceParams } from '../physics/propulsion/engine';
import type { RigidBodyState } from '../physics/state/types';
import type { ThermalZoneId } from '../physics/thermodynamics/heating';
import type { ThermalFailure, ThermalSurfaceProperties } from '../physics/thermodynamics/thermalZone';

/** 发动机型号。 */
export interface EngineDefinition extends EnginePerformanceParams {
  readonly id: string;
  readonly name: string;
  /** 推进剂组合（仅用于显示与尾焰外观）。 */
  readonly propellant: 'kerolox' | 'alcolox' | 'hydrolox' | 'hypergolic';
  /** 最小节流系数 (0–1]；低于该值发动机无法稳定工作。 */
  readonly minThrottle: number;
  /** 推力矢量最大摆角 [rad]。阶段二姿态控制使用。 */
  readonly gimbalRange: number;
}

/** 圆柱段外形尺寸。 */
export interface CylinderGeometry {
  /** 直径 [m]。 */
  readonly diameter: number;
  /** 长度 [m]（沿箭体纵轴）。 */
  readonly length: number;
}

/**
 * 气动参数。阻力、升力随马赫数与迎角的变化见 physics/aerodynamics/drag.ts。
 * 气动力矩没有建模（姿态为简化的运动学模型）。
 */
export interface AeroDefinition {
  /** 参考面积 [m²]（最大横截面积）。 */
  readonly referenceArea: number;
  /**
   * 基准轴向阻力系数 C_d0 [-]，以参考面积为基准。
   * shape 为 'slender' 时是亚声速值，为 'blunt' 时是高超声速值。
   */
  readonly dragCoefficient: number;
  /** 外形类别，决定马赫数修正曲线。 */
  readonly shape: DragShape;
}

/** 推进级。 */
export interface StageDefinition {
  readonly id: string;
  readonly name: string;
  /** 干质量 [kg]：结构 + 发动机 + 级间段。 */
  readonly dryMass: number;
  /** 满载推进剂质量 [kg]。 */
  readonly propellantMass: number;
  readonly engine: EngineDefinition;
  readonly engineCount: number;
  readonly geometry: CylinderGeometry;
  readonly aero: AeroDefinition;
  /** 表面的热学特性：箱体侧壁，以及底部的发动机舱。 */
  readonly thermal: {
    readonly side: ThermalSurfaceProperties;
    readonly base: ThermalSurfaceProperties;
  };
  /**
   * 并联助推器组（例如联盟号的四个捆绑助推器）：
   * 绑在上面一级（芯级）的周围，底面与芯级底面齐平，与芯级同时点火、同时工作，可以先于芯级分离。
   * 此时 dryMass、propellantMass、engineCount 都是整组的合计；geometry、aero 描述单个助推器；
   * count 为助推器个数（决定外形、分离体个数，以及整组的迎风面积）。
   * 不填表示串联级：叠在下面一级的顶上，下面一级分离后才能点火。
   */
  readonly parallel?: { readonly count: number };
}

/** 防热大底：返回舱底部的钝头防热结构。 */
export interface HeatShieldDefinition {
  /** 球冠的曲率半径 R_n [m]（决定驻点热流：半径越大热流越低）。 */
  readonly noseRadius: number;
  /** 防热材料的热学特性（通常带烧蚀层）。 */
  readonly surface: ThermalSurfaceProperties;
  /** 大底的质量 [kg]（烧蚀层 + 承力结构），已包含在返回舱干质量里。抛掉大底时飞行器减去这部分质量。 */
  readonly mass: number;
}

/**
 * 结构强度限制。任何一项被超过，飞行器即在空中解体。
 * 这些是整体性的工程限值，不是逐部件的应力分析。
 */
export interface StructuralLimits {
  /** 最大过载 [g]：比力（除引力外的合力 / 质量）的大小。 */
  readonly maxGLoad: number;
  /** 最大动压 [Pa]。 */
  readonly maxDynamicPressure: number;
  /**
   * 最大横向气动载荷 q·sin α [Pa]：细长箭体带迎角飞行时的弯曲载荷。
   * 对来流方向不敏感的外形（返回舱）为 Infinity。
   */
  readonly maxBendingLoad: number;
}

/** 可承受的接地条件。 */
export interface LandingLimits {
  /** 最大垂直速度 [m/s]。 */
  readonly verticalSpeed: number;
  /** 最大水平速度 [m/s]。 */
  readonly horizontalSpeed: number;
  /** 纵轴偏离竖直方向的最大角度 [rad]。 */
  readonly tilt: number;
}

/**
 * 降落伞系统：减速伞 + 主伞，一次开伞指令后自动按顺序工作。
 * 阻力面积是 C_d·A（已含阻力系数）。
 */
export interface ParachuteDefinition {
  /** 减速伞完全张开后的阻力面积 [m²]。 */
  readonly drogueDragArea: number;
  /** 主伞完全张开后的阻力面积 [m²]。 */
  readonly mainDragArea: number;
  /** 允许开伞的最大动压 [Pa] 与最大马赫数；超出时伞被撕毁。 */
  readonly maxDeployDynamicPressure: number;
  readonly maxDeployMach: number;
  /** 减速伞张满后，动压降到该值以下时主伞打开 [Pa]。 */
  readonly mainDeployDynamicPressure: number;
  /** 减速伞与主伞的充气时间 [s]（主伞收口分级充气的总时间）。 */
  readonly drogueInflationTime: number;
  readonly mainInflationTime: number;
}

interface PayloadBase {
  readonly id: string;
  readonly name: string;
  /** 干质量 [kg]。 */
  readonly dryMass: number;
  /** 自带推进剂质量 [kg]（无动力载荷为 0）。 */
  readonly propellantMass: number;
  /** 自带发动机（轨道机动/离轨）；无动力载荷为 null。 */
  readonly engine: EngineDefinition | null;
  readonly engineCount: number;
  readonly aero: AeroDefinition;
  /** 载荷单独飞行时的结构强度限制。 */
  readonly structure: StructuralLimits;
}

/** 返回舱：钝头锥体 + 底部防热大底。 */
export interface CapsuleDefinition extends PayloadBase {
  readonly kind: 'capsule';
  /** 最大直径（防热大底处）[m] 与总高度 [m]。 */
  readonly geometry: CylinderGeometry;
  readonly heatShield: HeatShieldDefinition;
  /**
   * 质心位置：到舱底（防热大底顶点）的轴向距离 [m]，以及偏离对称轴的横向距离 [m]。
   * 横向偏移使返回舱在再入时配平于一个非零迎角并产生升力（见 physics/aerodynamics/trim.ts）；
   * 为 0 时是弹道式返回舱。
   */
  readonly centerOfMass: {
    readonly height: number;
    readonly lateralOffset: number;
  };
  /** 舱顶的曲率半径 [m]。 */
  readonly apexRadius: number;
  /** 舱顶、侧壁（背风面防热层），以及抛掉防热大底后露出的舱底结构的热学特性。 */
  readonly thermal: {
    readonly apex: ThermalSurfaceProperties;
    readonly side: ThermalSurfaceProperties;
    readonly aft: ThermalSurfaceProperties;
  };
  /** 降落伞；没有则为 null。 */
  readonly parachute: ParachuteDefinition | null;
  /** 返回舱单独接地时可承受的条件。 */
  readonly landing: LandingLimits;
}

/** 卫星：位于可抛整流罩内。 */
export interface SatelliteDefinition extends PayloadBase {
  readonly kind: 'satellite';
  /** 卫星本体包络尺寸。 */
  readonly geometry: CylinderGeometry;
  /** 卫星本体表面的热学特性（没有防热设计）。 */
  readonly thermal: ThermalSurfaceProperties;
  readonly fairing: {
    /** 整流罩质量 [kg]（两瓣合计）。 */
    readonly mass: number;
    readonly geometry: CylinderGeometry;
    /** 罩尖的曲率半径 [m]。 */
    readonly noseRadius: number;
    readonly thermal: ThermalSurfaceProperties;
  };
}

export type PayloadDefinition = CapsuleDefinition | SatelliteDefinition;

/** 完整飞行器。 */
export interface VehicleDefinition {
  readonly id: string;
  readonly name: string;
  readonly nameZh: string;
  readonly description: string;
  /** 设计用途（显示用）。 */
  readonly role: string;
  /** 推进级，自下而上：stages[0] 最先工作。 */
  readonly stages: readonly StageDefinition[];
  /** 位于最顶端的有效载荷。 */
  readonly payload: PayloadDefinition;
  /** 带着推进级的组合体的结构强度限制。 */
  readonly structure: StructuralLimits;
}

/** 单级的动态状态。 */
export interface StageState {
  /** 剩余推进剂质量 [kg]。 */
  readonly propellantMass: number;
  /** 是否仍与飞行器连接。 */
  readonly attached: boolean;
}

/**
 * 飞行阶段。
 *  - prelaunch  在发射台上（被牵制机构固定，可能已点火但推力不足以起飞）
 *  - flight     自由飞行（有动力或滑行）
 *  - landed     以可承受的速度接地，飞行结束
 *  - destroyed  飞行器损毁，飞行结束
 */
export type FlightPhase = 'prelaunch' | 'flight' | 'landed' | 'destroyed';

/**
 * 当前时刻的受力与环境诊断量（由模拟器在每个物理步末计算，不是积分状态）。
 */
export interface FlightDiagnostics {
  /** 当前总推力 [N]（已计入环境压力损失）。 */
  readonly thrust: number;
  /** 发动机实际节流系数；未工作时为 0。 */
  readonly effectiveThrottle: number;
  /** 推进剂质量流量 [kg/s]。 */
  readonly massFlow: number;
  /** 环境压力 [Pa]。 */
  readonly ambientPressure: number;
  /** 大气密度 [kg/m³]。 */
  readonly airDensity: number;
  /** 相对大气的速度大小 [m/s]。 */
  readonly airspeed: number;
  /** 马赫数（86 km 以上仅作参考）。 */
  readonly mach: number;
  /** 动压 q = ½ρv² [Pa]。 */
  readonly dynamicPressure: number;
  /** 气动阻力大小 [N]（含降落伞）。 */
  readonly drag: number;
  /** 气动升力大小 [N]。 */
  readonly lift: number;
  /** 迎角 [rad]：箭体纵轴与相对来流方向的夹角，范围 [0, π]。 */
  readonly angleOfAttack: number;
  /** 横向气动载荷 q·sin α [Pa]。 */
  readonly bendingLoad: number;
  /** 参考驻点热流 [W/m²]：以 1 m 曲率半径计算的冷壁驻点对流热流（衡量加热环境的强弱，与外形无关）。 */
  readonly referenceHeatFlux: number;
}

/** 一个热区的遥测。 */
export interface ThermalZoneTelemetry {
  readonly zone: ThermalZoneId;
  /** 该热区当前由哪个部件承担（'fairing' / 'payload' / 'stage-<下标>'）。 */
  readonly owner: string;
  /** 材料名称（显示用）。 */
  readonly material: string;
  /** 表面温度、内部结构温度 [K]。 */
  readonly surfaceTemperature: number;
  readonly interiorTemperature: number;
  /** 表面与内部的温度限值 [K]。带烧蚀层时表面限值即烧蚀温度。 */
  readonly surfaceLimit: number;
  readonly interiorLimit: number;
  /** 传入表面的对流热流（热壁）[W/m²]，可为负。 */
  readonly heatFlux: number;
  /** 累积热载荷 [J/m²]。 */
  readonly heatLoad: number;
  /** 是否带烧蚀层，及其剩余比例 [0, 1]（不带时为 1）。 */
  readonly ablative: boolean;
  readonly ablatorFraction: number;
  /** 热裕度 [0, 1]：0 表示到达失效限值。 */
  readonly margin: number;
  readonly failure: ThermalFailure | null;
}

/**
 * 降落伞状态。
 *  - none     该构型没有降落伞（或返回舱尚未与推进级分离）
 *  - stowed   收拢，尚未开伞
 *  - drogue   减速伞工作中
 *  - main     主伞已打开（可能仍在充气）
 *  - lost     开伞条件超限，伞已被撕毁
 */
export type ParachutePhase = 'none' | 'stowed' | 'drogue' | 'main' | 'lost';

export interface ParachuteState {
  readonly phase: ParachutePhase;
  /** 当前的降落伞阻力面积 C_d·A [m²]。 */
  readonly dragArea: number;
}

/** 飞行器动态状态（模拟器的权威状态）。 */
export interface VehicleState {
  readonly body: RigidBodyState;
  /** 与 definition.stages 一一对应。 */
  readonly stages: readonly StageState[];
  /** 载荷自带推进剂剩余量 [kg]。 */
  readonly payloadPropellantMass: number;
  /** 整流罩是否仍在（无整流罩的飞行器恒为 false）。 */
  readonly fairingAttached: boolean;
  /** 防热大底是否仍在（没有防热大底的飞行器恒为 false）。 */
  readonly heatShieldAttached: boolean;
  /** 当前工作级在 definition.stages 中的下标；全部分离后等于 stages.length（只剩载荷）。 */
  readonly activeStageIndex: number;
  /** 节流指令 [0, 1]。0 表示关机；介于 0 与发动机最小节流之间时按最小节流工作。 */
  readonly throttle: number;
  /** 当前工作级的发动机是否已启用（点火指令已下达）。实际是否产生推力见 flight.thrust。 */
  readonly ignited: boolean;
  /** 当前的姿态操纵输入。 */
  readonly attitudeInput: AttitudeInput;
  /** 自动指向模式；'manual' 为手动（无输入时保持当前惯性姿态）。 */
  readonly attitudeMode: AttitudeMode;
  /** 当前构型的配平迎角 [rad]（质心横向偏移决定）；不是单独的返回舱、或质心在轴线上时为 0。 */
  readonly trimAngle: number;
  /** 配平再入的倾侧角 [rad]，范围 (−π, π]：0 为升力向上，正值向右倾侧。 */
  readonly bankAngle: number;
  readonly phase: FlightPhase;
  /** 当前总质量 [kg]。 */
  readonly mass: number;
  /** 质心到飞行器底端的距离 [m]（沿机体 +X）。 */
  readonly centerOfMassHeight: number;
  /**
   * 比力（"加速度计读数"）[m/s²]，ECI 轴上表达：除引力外所有力的合力除以质量。
   * 过载 = |specificForce| / g₀。在发射台上它等于支撑力/质量。
   */
  readonly specificForce: Vec3;
  readonly flight: FlightDiagnostics;
  /** 三个热区（头部、侧壁、底部）的热状态。 */
  readonly thermal: readonly ThermalZoneTelemetry[];
  readonly parachute: ParachuteState;
}
