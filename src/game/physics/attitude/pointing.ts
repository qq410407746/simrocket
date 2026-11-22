/**
 * 自动指向：把箭体头部保持在某个轨道参考方向上。
 *
 * 这是建立在简化姿态模型之上的比例控制器：根据头部与目标方向的夹角给出角速度指令，
 * 再经过与手动操纵相同的一阶响应。它不是真实的姿态控制系统（没有力矩与执行机构）。
 *
 * 参考方向（r、v 为惯性系中的位置与速度）：
 *   顺行 / 逆行      ±v̂_ref
 *   法向 / 反法向    ±ĥ ，h = r × v（轨道面法向，与角动量同向为"法向"）
 *   径向外 / 径向内  ±(v̂ × ĥ)（在轨道面内垂直于速度，指向远离 / 朝向地球的一侧）
 *
 * 顺行/逆行使用的速度 v_ref：低空用相对地面（随地球共转的大气）的速度——上升段希望头部对准来流；
 * 高空用惯性速度——轨道机动希望沿轨道速度方向加速。切换高度为 SURFACE_REFERENCE_ALTITUDE。
 *
 * 配平再入（'trim'）：返回舱的防热大底朝前，但舱体轴线偏离来流一个配平迎角 α_t（由质心的横向偏移决定，
 * 见 physics/aerodynamics/trim.ts），偏转所在的平面由倾侧角 σ 决定：
 *   v̂ 为相对大气的速度方向，û 为垂直于 v̂、偏向天顶的方向，ŵ = v̂ × û（向右）
 *   升力方向 l̂ = cos σ·û + sin σ·ŵ      （σ = 0 升力向上，σ > 0 向右倾侧，σ = 180° 升力向下）
 *   头部方向 n̂ = −cos α_t·v̂ + sin α_t·l̂
 */
import { EARTH } from '../constants';
import { airRelativeVelocityEci, frameToBody } from '../frames/frames';
import type { Quat } from '../math/quat';
import { type Vec3, ZERO, cross, dot, length, negate, normalize, scale, sub, vec3 } from '../math/vec3';
import type { AttitudeControlParams } from './attitude';

export type AttitudeMode = 'manual' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radial-out' | 'radial-in' | 'trim' | 'maneuver';

export const ATTITUDE_MODES: readonly AttitudeMode[] = [
  'manual',
  'prograde',
  'retrograde',
  'normal',
  'antinormal',
  'radial-out',
  'radial-in',
  'trim',
  'maneuver',
];

export const isAttitudeMode = (value: unknown): value is AttitudeMode =>
  typeof value === 'string' && (ATTITUDE_MODES as readonly string[]).includes(value);

/** 低于该高度 [m] 时"顺行"以相对地面的速度为准，否则以惯性（轨道）速度为准。 */
export const SURFACE_REFERENCE_ALTITUDE = 50_000;

/** 速度小于该值 [m/s] 时方向没有意义，不给出指向。 */
const MIN_REFERENCE_SPEED = 0.5;

/** 自动指向的比例增益 [1/s]：角速度指令 = 增益 × 角度误差（不超过最大角速度）。 */
export const POINTING_GAIN = 1.0;
/** 角度误差小于该值 [rad] 时不再修正（约 0.003°）。 */
const POINTING_DEADBAND = 5e-5;

/** 当前高度下"顺行"所参照的速度（惯性系中表达）。 */
export const referenceVelocity = (r: Vec3, v: Vec3): Vec3 =>
  length(r) - EARTH.RADIUS < SURFACE_REFERENCE_ALTITUDE ? airRelativeVelocityEci(r, v) : v;

/** 配平再入的姿态参数。 */
export interface TrimAttitude {
  /** 配平迎角 α_t [rad]：舱体轴线偏离"防热大底正对来流"的角度。 */
  readonly angle: number;
  /** 倾侧角 σ [rad]：升力方向绕速度方向转过的角度；0 为升力向上，正值向右。 */
  readonly bank: number;
}

const NO_TRIM: TrimAttitude = Object.freeze({ angle: 0, bank: 0 });

/**
 * 配平再入的头部方向（惯性系单位向量）：防热大底朝前、轴线偏离来流 angle、升力方向由 bank 决定。
 * 相对大气的速度过小时返回 null；速度沿竖直方向时"向上"没有定义，退化为正对来流（没有升力）。
 */
export const trimDirection = (r: Vec3, v: Vec3, trim: TrimAttitude): Vec3 | null => {
  const air = airRelativeVelocityEci(r, v);
  const speed = length(air);
  if (speed < MIN_REFERENCE_SPEED) return null;
  const forward = scale(air, 1 / speed);
  const up = normalize(r);
  const upPerp = sub(up, scale(forward, dot(up, forward)));
  const norm = length(upPerp);
  if (norm < 1e-4 || trim.angle === 0) return negate(forward);
  const liftUp = scale(upPerp, 1 / norm);
  const right = cross(forward, liftUp);
  const cosBank = Math.cos(trim.bank);
  const sinBank = Math.sin(trim.bank);
  const cosTrim = Math.cos(trim.angle);
  const sinTrim = Math.sin(trim.angle);
  return normalize(
    vec3(
      -cosTrim * forward.x + sinTrim * (cosBank * liftUp.x + sinBank * right.x),
      -cosTrim * forward.y + sinTrim * (cosBank * liftUp.y + sinBank * right.y),
      -cosTrim * forward.z + sinTrim * (cosBank * liftUp.z + sinBank * right.z),
    ),
  );
};

/**
 * 给定指向模式下的目标方向（惯性系单位向量）。
 * 'manual' 模式、或参考方向没有定义（速度过小、径向运动使轨道面无定义）时返回 null。
 * @param trim 'trim' 模式使用的配平迎角与倾侧角
 */
export const pointingDirection = (mode: AttitudeMode, r: Vec3, v: Vec3, trim: TrimAttitude = NO_TRIM): Vec3 | null => {
  if (mode === 'manual' || mode === 'maneuver') return null;
  if (mode === 'trim') return trimDirection(r, v, trim);
  if (mode === 'prograde' || mode === 'retrograde') {
    const reference = referenceVelocity(r, v);
    if (length(reference) < MIN_REFERENCE_SPEED) return null;
    const prograde = normalize(reference);
    return mode === 'prograde' ? prograde : negate(prograde);
  }
  const h = cross(r, v);
  if (length(h) < 1e-3 * length(r)) return null;
  const normal = normalize(h);
  if (mode === 'normal') return normal;
  if (mode === 'antinormal') return negate(normal);
  const radialOut = normalize(cross(v, normal));
  return mode === 'radial-out' ? radialOut : negate(radialOut);
};

/**
 * 目标方向自身的转动角速度 [rad/s]（惯性系），由相邻两步的目标方向差分得到：ω ≈ (d₀ × d₁)/Δt。
 * 用作前馈：纯比例控制跟踪一个持续转动的目标会有 角速度/增益 的稳态滞后
 * （例如重力转弯时速度方向以约 1°/s 转动，滞后约 1°）。
 * 相邻两步方向突变（参考系切换、模式切换）时差分没有意义，返回零。
 */
export const targetAngularVelocity = (previous: Vec3, current: Vec3, dt: number, maxRate: number): Vec3 => {
  if (!(dt > 0)) return ZERO;
  const rate = scale(cross(previous, current), 1 / dt);
  return length(rate) <= maxRate ? rate : ZERO;
};

/**
 * 把头部转向目标方向所需的机体系角速度指令 [rad/s]。
 *   ω = 转轴·min(ω_max, 增益 × 夹角) + 目标方向的角速度（前馈）
 * 转轴为 头部 × 目标（最短路径）；合成后的大小不超过 ω_max；不主动产生滚转。
 */
export const steeringRateCommand = (
  attitude: Quat,
  nose: Vec3,
  target: Vec3,
  params: AttitudeControlParams,
  targetRate: Vec3 = ZERO,
): Vec3 => {
  const axis = cross(nose, target);
  const sine = length(axis);
  const angle = Math.atan2(sine, dot(nose, target));
  let correction: Vec3 = ZERO;
  if (angle >= POINTING_DEADBAND) {
    const rate = Math.min(params.maxPitchYawRate, POINTING_GAIN * angle);
    // 头部与目标几乎反向时转轴没有定义：任取一个垂直于头部的轴（机体 +Y）开始转
    if (sine < 1e-9) return vec3(0, rate, 0);
    correction = scale(axis, rate / sine);
  }
  const total = vec3(correction.x + targetRate.x, correction.y + targetRate.y, correction.z + targetRate.z);
  const magnitude = length(total);
  if (magnitude === 0) return ZERO;
  const limited = magnitude > params.maxPitchYawRate ? scale(total, params.maxPitchYawRate / magnitude) : total;
  return frameToBody(attitude, limited);
};
