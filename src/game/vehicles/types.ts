/**
 * 飞行器定义（静态设计数据）与飞行器状态（随时间变化的数据）。
 *
 * 所有量使用 SI 单位。定义是不可变的"图纸"；状态由模拟器在每个物理步更新。
 * 渲染层根据同一份定义程序化生成三维模型，保证"看到的"与"算出来的"是同一枚火箭。
 */
import type { DragShape } from '../physics/aerodynamics/drag';
import type { AttitudeInput } from '../physics/attitude/attitude';
import type { Vec3 } from '../physics/math/vec3';
import type { EnginePerformanceParams } from '../physics/propulsion/engine';
import type { RigidBodyState } from '../physics/state/types';

/** 发动机型号。 */
export interface EngineDefinition extends EnginePerformanceParams {
  readonly id: string;
  readonly name: string;
  /** 推进剂组合（仅用于显示与尾焰外观）。 */
  readonly propellant: 'kerolox' | 'hydrolox' | 'hypergolic';
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
 * 气动参数。阻力随马赫数与迎角的变化见 physics/aerodynamics/drag.ts。
 * 升力与气动力矩尚未建模（阶段四）。
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
}

/**
 * 热防护系统参数（阶段四"气动加热"使用；阶段一仅定义数据，尚无模型消费）。
 */
export interface HeatShieldDefinition {
  /** 头部（驻点）曲率半径 R_n [m]。 */
  readonly noseRadius: number;
  /** 表面发射率 ε [-]。 */
  readonly emissivity: number;
  /** 最高允许表面温度 [K]。 */
  readonly maxSurfaceTemperature: number;
  /** 烧蚀材料质量 [kg]。 */
  readonly ablatorMass: number;
  /** 有效烧蚀热 [J/kg]。 */
  readonly heatOfAblation: number;
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
}

/** 返回舱：钝头锥体 + 底部防热大底。 */
export interface CapsuleDefinition extends PayloadBase {
  readonly kind: 'capsule';
  /** 最大直径（防热大底处）[m] 与总高度 [m]。 */
  readonly geometry: CylinderGeometry;
  readonly heatShield: HeatShieldDefinition;
}

/** 卫星：位于可抛整流罩内。 */
export interface SatelliteDefinition extends PayloadBase {
  readonly kind: 'satellite';
  /** 卫星本体包络尺寸。 */
  readonly geometry: CylinderGeometry;
  readonly fairing: {
    /** 整流罩质量 [kg]（两瓣合计）。 */
    readonly mass: number;
    readonly geometry: CylinderGeometry;
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
  /** 气动阻力大小 [N]。 */
  readonly drag: number;
  /** 迎角 [rad]：箭体纵轴与相对来流方向的夹角，范围 [0, π]。 */
  readonly angleOfAttack: number;
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
  /** 当前工作级在 definition.stages 中的下标；全部分离后等于 stages.length（只剩载荷）。 */
  readonly activeStageIndex: number;
  /** 节流指令 [0, 1]。0 表示关机；介于 0 与发动机最小节流之间时按最小节流工作。 */
  readonly throttle: number;
  /** 当前工作级的发动机是否已启用（点火指令已下达）。实际是否产生推力见 flight.thrust。 */
  readonly ignited: boolean;
  /** 当前的姿态操纵输入。 */
  readonly attitudeInput: AttitudeInput;
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
}
