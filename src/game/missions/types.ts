/**
 * 任务系统的数据类型：任务定义（静态内容）、任务状态（随飞行推进）与评分结果。
 *
 * 任务系统是纯逻辑：它只读取物理线程给出的遥测、统计与飞行结果，从不修改物理状态，
 * 也不依赖 React 或渲染层。全部量使用 SI 单位。
 */
import type { LaunchDirection } from '../physics/orbital/launch';

/** 对轨道的要求（高度为海拔高度 [m]，角度为弧度）。 */
export interface OrbitRequirement {
  /** 近地点不低于该高度。 */
  readonly minPeriapsis: number;
  readonly minApoapsis?: number;
  readonly maxPeriapsis?: number;
  /** 远地点不高于该高度。 */
  readonly maxApoapsis: number;
  /** 倾角要求：目标值 ± 容差。不填则不限倾角。 */
  readonly inclination?: { readonly target: number; readonly tolerance: number };
}

/**
 * 目标的判定条件。
 *  - reach-altitude  飞行中达到过给定的海拔高度；
 *  - orbit           发动机关机后，轨道连续 ORBIT_CONFIRM_TIME 满足要求（稳定在轨，而不是点火过程中的瞬时读数）；
 *  - land-capsule    返回舱（已与所有推进级分离）以可承受的速度着陆。
 */
export type ObjectiveSpec =
  | { readonly kind: 'reach-altitude'; readonly altitude: number }
  | ({ readonly kind: 'orbit' } & OrbitRequirement)
  | { readonly kind: 'land-capsule' }
  | { readonly kind: 'deploy-satellite' }
  | { readonly kind: 'synchronous'; readonly stationary: boolean; readonly deployed?: boolean };

export interface ObjectiveDefinition {
  readonly id: string;
  readonly title: string;
  readonly spec: ObjectiveSpec;
  /** 附加目标：不影响任务成败，只影响评分。 */
  readonly optional?: boolean;
}

/** 评分用到的飞行指标。 */
export type MetricId =
  /** 全程最大过载 [g]。 */
  | 'max-g'
  /** 轨道确认时远地点与近地点的高度差 [m]。 */
  | 'orbit-spread'
  /** 轨道确认时倾角与目标值的偏差 [rad]。 */
  | 'inclination-error'
  /** 轨道确认时剩余的理想 Δv [m/s]。 */
  | 'delta-v-margin'
  /** 着陆时的垂直速度大小 [m/s]。 */
  | 'landing-speed'
  /** 防热大底烧蚀层的最小剩余比例 [0, 1]。 */
  | 'ablator-remaining'
  /** 全程最大高度 [m]。 */
  | 'max-altitude'
  /** 落点到发射场的地面距离 [m]。 */
  | 'downrange'
  | 'period-error'
  | 'longitude-span';

/**
 * 评分规则。
 *  - objectives          主要目标全部完成即得满分；
 *  - optional-objective  某个附加目标完成即得满分；
 *  - metric              指标值在 zero 处得 0 分、在 full 处得满分，其间线性；
 *                        full < zero 表示越小越好（过载、偏差），full > zero 表示越大越好（余量、高度）。
 *                        指标不存在（例如没有着陆就没有着陆速度）时得 0 分。
 */
export type ScoreRule =
  | { readonly kind: 'objectives' }
  | { readonly kind: 'optional-objective'; readonly objectiveId: string }
  | { readonly kind: 'metric'; readonly metric: MetricId; readonly full: number; readonly zero: number };

export interface ScoreItemDefinition {
  readonly id: string;
  readonly label: string;
  /** 该项的满分。一个任务各项满分之和为 100。 */
  readonly weight: number;
  readonly rule: ScoreRule;
  /** 给玩家的说明：这一项考察什么、怎样拿到满分。 */
  readonly note: string;
}

export type MissionCategory = 'suborbital' | 'orbital' | 'return' | 'advanced';

/** 任务定义。 */
export interface MissionDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: MissionCategory;
  /** 一句话简介（任务列表中显示）。 */
  readonly summary: string;
  /** 任务简报：背景与要点，每个元素一段。 */
  readonly briefing: readonly string[];
  /** 使用的飞行器与发射场（任务模式下固定）。 */
  readonly vehicleId: string;
  readonly siteId: string;
  /** 从发射台出发，还是直接从 200 km 近地轨道出发。 */
  readonly start: 'pad' | 'orbit';
  readonly objectives: readonly ObjectiveDefinition[];
  readonly scoring: readonly ScoreItemDefinition[];
  /** 飞行步骤（教学提示）：按顺序列出这次任务怎么飞。 */
  readonly flightPlan: readonly string[];
  /** 发射方向引导：目标倾角 [rad] 与向北 / 向南发射。不填表示向正东发射。 */
  readonly launch?: { readonly inclination: number; readonly direction: LaunchDirection };
  /**
   * 上升段的飞法（教学提示用）。不填表示标准的重力转弯：约 60 m/s 时倾斜 2–3°。
   *  - vertical  全程竖直；
   *  - kick      速度达到 speed [m/s] 时倾斜 minAngleDeg–maxAngleDeg [°]。
   */
  readonly ascent?:
    | { readonly kind: 'vertical' }
    | { readonly kind: 'kick'; readonly speed: number; readonly minAngleDeg: number; readonly maxAngleDeg: number };
  /** 解锁条件：这些任务全部完成后才能开始本任务。 */
  readonly requires: readonly string[];
}

export type ObjectiveStatus = 'pending' | 'done' | 'failed';

export interface ObjectiveState {
  readonly id: string;
  readonly status: ObjectiveStatus;
  /** 完成或失败时的模拟时间 [s]；尚未结束时为 null。 */
  readonly resolvedAt: number | null;
}

/**
 * 任务状态。
 *  - active   仍有目标没有结论；
 *  - success  所有主要目标都已完成（附加目标也都有了结论）；
 *  - failed   至少一个主要目标已经无法完成。
 */
export type MissionStatus = 'active' | 'success' | 'failed';

/**
 * 任务失败的原因。
 *  - destroyed          飞行器损毁；
 *  - flight-ended       飞行结束（着陆）时还有主要目标没有完成；
 *  - out-of-propellant  停在一条不满足要求的稳定轨道上，推进剂已经耗尽。
 */
export type MissionFailure = 'destroyed' | 'flight-ended' | 'out-of-propellant';

/** 轨道确认瞬间记录下来的轨道与余量。 */
export interface ConfirmedOrbit {
  readonly apoapsisAltitude: number;
  readonly periapsisAltitude: number;
  readonly inclination: number;
  readonly eccentricity: number;
  readonly period: number;
  /** 当时剩余的理想 Δv [m/s]。 */
  readonly remainingDeltaV: number;
}

export interface MissionState {
  readonly status: MissionStatus;
  readonly objectives: readonly ObjectiveState[];
  readonly failure: MissionFailure | null;
  /** 任务有结论（成功或失败）时的模拟时间 [s]。 */
  readonly endedAt: number | null;
  /** 轨道连续满足要求的起始模拟时间 [s]；当前不满足时为 null。 */
  readonly orbitHoldSince: number | null;
  readonly orbitObjectiveId?: string;
  /** 轨道目标确认时的轨道；没有轨道目标或尚未确认时为 null。 */
  readonly confirmedOrbit: ConfirmedOrbit | null;
  /** 防热大底烧蚀层出现过的最小剩余比例；飞行器没有（或从未露出）防热大底时为 null。 */
  readonly minAblatorFraction: number | null;
}

/** 评分用的指标值；不存在的指标为 null。 */
export type MissionMetrics = Readonly<Record<MetricId, number | null>>;

export interface ScoreItemResult {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  /** 得分比例 [0, 1] 与得分。 */
  readonly fraction: number;
  readonly points: number;
  /** 对应的指标及其数值（规则不是指标类时为 null）。 */
  readonly metric: MetricId | null;
  readonly value: number | null;
  readonly note: string;
}

/** 评级：S ≥ 90，A ≥ 80，B ≥ 65，C < 65；任务失败为 F。 */
export type MissionGrade = 'S' | 'A' | 'B' | 'C' | 'F';

export interface MissionScore {
  /** 总分 [0, 100]（四舍五入到整数）；任务失败时为 0。 */
  readonly total: number;
  readonly grade: MissionGrade;
  readonly items: readonly ScoreItemResult[];
}
