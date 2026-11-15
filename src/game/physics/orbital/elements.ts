/**
 * 轨道根数（开普勒根数）与状态向量的互相转换。二体问题，中心天体为质点。
 *
 * 记号（经典根数）：
 *   a  半长轴            e  偏心率            i  轨道倾角
 *   Ω  升交点赤经        ω  近地点幅角        ν  真近点角
 * 另外保留半通径 p = h²/μ：它对椭圆、抛物线、双曲线都有限，作为描述轨道大小的主参数。
 *
 * 算法：Vallado, "Fundamentals of Astrodynamics and Applications" 的 RV2COE / COE2RV，
 * 角度一律用 atan2(sin, cos) 形式计算，避免 acos 在 0 与 π 附近的精度损失。
 *
 * 奇异情形的约定（保证"根数 → 状态向量"能够还原，且输出总是有限）：
 *   - 赤道轨道（i ≈ 0 或 π）：升交点无定义，取 Ω = 0，ω 改为近地点经度；
 *   - 圆轨道（e ≈ 0）：近地点无定义，取 ω = 0，ν 改为纬度幅角（自升交点量起）；
 *   - 圆赤道轨道：Ω = ω = 0，ν 改为真经度（自 +X 轴量起）。
 * 逆行赤道轨道的角度按"沿运动方向增加"计。
 *
 * 单位：长度 m，速度 m/s，角度 rad，时间 s。
 */
import { EARTH, TWO_PI } from '../constants';
import { type Vec3, cross, dot, length, vec3 } from '../math/vec3';

export type ConicKind = 'elliptic' | 'parabolic' | 'hyperbolic';

export interface OrbitalElements {
  readonly kind: ConicKind;
  /** 半长轴 a [m]。椭圆为正，双曲线为负，抛物线为 Infinity。 */
  readonly semiMajorAxis: number;
  /** 半通径 p = h²/μ [m]。 */
  readonly semiLatusRectum: number;
  /** 偏心率 e ≥ 0。 */
  readonly eccentricity: number;
  /** 轨道倾角 i ∈ [0, π]。 */
  readonly inclination: number;
  /** 升交点赤经 Ω ∈ [0, 2π)。 */
  readonly raan: number;
  /** 近地点幅角 ω ∈ [0, 2π)。 */
  readonly argumentOfPeriapsis: number;
  /** 真近点角 ν ∈ [0, 2π)。 */
  readonly trueAnomaly: number;
  /** 比机械能 ε = v²/2 − μ/r [J/kg]。 */
  readonly specificEnergy: number;
  /** 比角动量大小 h [m²/s]。 */
  readonly angularMomentum: number;
  /** 近地点地心距 r_p = p/(1+e) [m]。 */
  readonly periapsisRadius: number;
  /** 远地点地心距 r_a = p/(1−e) [m]；非椭圆轨道为 Infinity。 */
  readonly apoapsisRadius: number;
  /** 轨道周期 T = 2π√(a³/μ) [s]；非椭圆轨道为 Infinity。 */
  readonly period: number;
}

/** 偏心率小于该值视为圆轨道。 */
export const CIRCULAR_TOLERANCE = 1e-8;
/** 轨道面法向与地轴的夹角正弦小于该值视为赤道轨道。 */
export const EQUATORIAL_TOLERANCE = 1e-8;
/** |e − 1| 小于该值视为抛物线。 */
export const PARABOLIC_TOLERANCE = 1e-9;

/** 归一化到 [0, 2π)。极小的负数加 2π 后会舍入成恰好 2π，此时归零。 */
const wrap = (angle: number): number => {
  const a = angle % TWO_PI;
  const b = a < 0 ? a + TWO_PI : a;
  return b >= TWO_PI ? 0 : b;
};

/** 由位置与速度（同一惯性系）计算轨道根数。 */
export const elementsFromState = (r: Vec3, v: Vec3, mu: number = EARTH.MU): OrbitalElements => {
  const rMag = length(r);
  const v2 = dot(v, v);
  const rv = dot(r, v);
  const h = cross(r, v);
  const hMag = length(h);
  const energy = v2 / 2 - mu / rMag;

  // 偏心率矢量：指向近地点，大小为 e
  const k = v2 - mu / rMag;
  const eVec = vec3((k * r.x - rv * v.x) / mu, (k * r.y - rv * v.y) / mu, (k * r.z - rv * v.z) / mu);
  const e = length(eVec);
  const p = (hMag * hMag) / mu;

  const kind: ConicKind = Math.abs(e - 1) < PARABOLIC_TOLERANCE ? 'parabolic' : e < 1 ? 'elliptic' : 'hyperbolic';
  const a = kind === 'parabolic' ? Infinity : -mu / (2 * energy);

  const hHat = hMag > 0 ? vec3(h.x / hMag, h.y / hMag, h.z / hMag) : vec3(0, 0, 1);
  const inclination = Math.acos(Math.max(-1, Math.min(1, hHat.z)));
  // 升交线方向 n = ẑ × h
  const n = vec3(-h.y, h.x, 0);
  const nMag = length(n);
  const equatorial = nMag <= EQUATORIAL_TOLERANCE * hMag;
  const circular = e < CIRCULAR_TOLERANCE;
  const sense = hHat.z >= 0 ? 1 : -1;

  let raan = 0;
  let argp = 0;
  let nu: number;
  if (!equatorial) {
    raan = wrap(Math.atan2(n.y, n.x));
    if (!circular) {
      argp = wrap(Math.atan2(dot(hHat, cross(n, eVec)), dot(n, eVec)));
      nu = wrap(Math.atan2(dot(hHat, cross(eVec, r)), dot(eVec, r)));
    } else {
      // 纬度幅角：自升交点沿运动方向到当前位置
      nu = wrap(Math.atan2(dot(hHat, cross(n, r)), dot(n, r)));
    }
  } else if (!circular) {
    // 近地点经度
    argp = wrap(Math.atan2(eVec.y * sense, eVec.x));
    nu = wrap(Math.atan2(dot(hHat, cross(eVec, r)), dot(eVec, r)));
  } else {
    // 真经度
    nu = wrap(Math.atan2(r.y * sense, r.x));
  }

  return {
    kind,
    semiMajorAxis: a,
    semiLatusRectum: p,
    eccentricity: e,
    inclination,
    raan,
    argumentOfPeriapsis: argp,
    trueAnomaly: nu,
    specificEnergy: energy,
    angularMomentum: hMag,
    periapsisRadius: p / (1 + e),
    apoapsisRadius: kind === 'elliptic' ? p / (1 - e) : Infinity,
    period: kind === 'elliptic' ? TWO_PI * Math.sqrt((a * a * a) / mu) : Infinity,
  };
};

/** 轨道面内的正交基：P̂ 指向近地点，Q̂ 在轨道面内沿运动方向超前 P̂ 90°，Ŵ 为轨道面法向。 */
export interface PerifocalBasis {
  readonly p: Vec3;
  readonly q: Vec3;
  readonly w: Vec3;
}

/** 由 Ω、i、ω 构造近焦点坐标系的基向量（在惯性系中表达）：R = Rz(Ω)·Rx(i)·Rz(ω)。 */
export const perifocalBasis = (el: Pick<OrbitalElements, 'raan' | 'inclination' | 'argumentOfPeriapsis'>): PerifocalBasis => {
  const cO = Math.cos(el.raan);
  const sO = Math.sin(el.raan);
  const ci = Math.cos(el.inclination);
  const si = Math.sin(el.inclination);
  const cw = Math.cos(el.argumentOfPeriapsis);
  const sw = Math.sin(el.argumentOfPeriapsis);
  return {
    p: vec3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si),
    q: vec3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si),
    w: vec3(sO * si, -cO * si, ci),
  };
};

/** 真近点角 ν 处的地心距 r = p / (1 + e·cos ν)。分母不为正（双曲线渐近线之外）时返回 Infinity。 */
export const radiusAtTrueAnomaly = (el: Pick<OrbitalElements, 'semiLatusRectum' | 'eccentricity'>, nu: number): number => {
  const denominator = 1 + el.eccentricity * Math.cos(nu);
  return denominator > 1e-12 ? el.semiLatusRectum / denominator : Infinity;
};

/** 轨道上真近点角 ν 处的位置（惯性系）。basis 可预先算好以便批量采样。 */
export const positionAtTrueAnomaly = (
  el: Pick<OrbitalElements, 'semiLatusRectum' | 'eccentricity'>,
  basis: PerifocalBasis,
  nu: number,
): Vec3 => {
  const r = radiusAtTrueAnomaly(el, nu);
  const c = r * Math.cos(nu);
  const s = r * Math.sin(nu);
  return vec3(c * basis.p.x + s * basis.q.x, c * basis.p.y + s * basis.q.y, c * basis.p.z + s * basis.q.z);
};

/** 由轨道根数计算位置与速度（COE2RV）。 */
export const stateFromElements = (
  el: Pick<OrbitalElements, 'semiLatusRectum' | 'eccentricity' | 'inclination' | 'raan' | 'argumentOfPeriapsis' | 'trueAnomaly'>,
  mu: number = EARTH.MU,
): { position: Vec3; velocity: Vec3 } => {
  const basis = perifocalBasis(el);
  const cosNu = Math.cos(el.trueAnomaly);
  const sinNu = Math.sin(el.trueAnomaly);
  const speed = Math.sqrt(mu / el.semiLatusRectum);
  const vp = -speed * sinNu;
  const vq = speed * (el.eccentricity + cosNu);
  return {
    position: positionAtTrueAnomaly(el, basis, el.trueAnomaly),
    velocity: vec3(vp * basis.p.x + vq * basis.q.x, vp * basis.p.y + vq * basis.q.y, vp * basis.p.z + vq * basis.q.z),
  };
};

/**
 * 真近点角 → 平近点角 M（椭圆）或双曲平近点角（双曲线）。
 *   椭圆：  tan(E/2) = √((1−e)/(1+e))·tan(ν/2) ，M = E − e·sin E ，M ∈ [0, 2π)
 *   双曲线：tanh(F/2) = √((e−1)/(e+1))·tan(ν/2)，M = e·sinh F − F（近地点前为负）
 *   抛物线：Barker 方程 M = D + D³/3，D = tan(ν/2)
 */
export const meanAnomalyFromTrue = (eccentricity: number, nu: number): number => {
  const e = eccentricity;
  if (Math.abs(e - 1) < PARABOLIC_TOLERANCE) {
    const d = Math.tan(nu / 2);
    return d + (d * d * d) / 3;
  }
  if (e < 1) {
    const eccentricAnomaly = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    return wrap(eccentricAnomaly - e * Math.sin(eccentricAnomaly));
  }
  // 双曲线：ν 取 (−π, π) 内的等价值
  const signed = nu > Math.PI ? nu - TWO_PI : nu;
  const t = Math.sqrt((e - 1) / (e + 1)) * Math.tan(signed / 2);
  const f = 2 * Math.atanh(Math.max(-0.999999999999, Math.min(0.999999999999, t)));
  return e * Math.sinh(f) - f;
};

/** 平均角速度 n [rad/s]：椭圆 √(μ/a³)，双曲线 √(μ/|a|³)，抛物线 2√(μ/p³)。 */
export const meanMotion = (el: Pick<OrbitalElements, 'kind' | 'semiMajorAxis' | 'semiLatusRectum'>, mu: number = EARTH.MU): number =>
  el.kind === 'parabolic'
    ? 2 * Math.sqrt(mu / el.semiLatusRectum ** 3)
    : Math.sqrt(mu / Math.abs(el.semiMajorAxis) ** 3);

/**
 * 到下一次经过近地点的时间 [s]。
 * 椭圆轨道总有下一次；开放轨道若已飞过近地点则不会再回来，返回 null。
 */
export const timeToPeriapsis = (el: OrbitalElements, mu: number = EARTH.MU): number | null => {
  const m = meanAnomalyFromTrue(el.eccentricity, el.trueAnomaly);
  const n = meanMotion(el, mu);
  if (el.kind === 'elliptic') return wrap(TWO_PI - m) / n;
  return m < 0 ? -m / n : null;
};

/** 到下一次经过远地点的时间 [s]；非椭圆轨道没有远地点，返回 null。 */
export const timeToApoapsis = (el: OrbitalElements, mu: number = EARTH.MU): number | null => {
  if (el.kind !== 'elliptic') return null;
  const m = meanAnomalyFromTrue(el.eccentricity, el.trueAnomaly);
  return wrap(Math.PI - m) / meanMotion(el, mu);
};

/**
 * 轨道与给定地心距的交点处的真近点角 ν ∈ [0, π]（上升段；下降段为 2π − ν）。
 * 轨道达不到该地心距时返回 null。
 */
export const trueAnomalyAtRadius = (el: Pick<OrbitalElements, 'semiLatusRectum' | 'eccentricity'>, radius: number): number | null => {
  if (el.eccentricity < 1e-12) return null;
  const cosNu = (el.semiLatusRectum / radius - 1) / el.eccentricity;
  return cosNu < -1 || cosNu > 1 ? null : Math.acos(cosNu);
};

/** 给定地心距处的圆轨道速度 √(μ/r) [m/s]。 */
export const circularSpeed = (radius: number, mu: number = EARTH.MU): number => Math.sqrt(mu / radius);

/** 给定地心距处的逃逸速度 √(2μ/r) [m/s]。 */
export const escapeSpeed = (radius: number, mu: number = EARTH.MU): number => Math.sqrt((2 * mu) / radius);
