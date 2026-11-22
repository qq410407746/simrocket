/** 高级轨道任务的纯计算。单位：m、s、m/s、rad。预览脉冲不修改真实状态。 */
import { DEG2RAD, EARTH, SIDEREAL_DAY, TWO_PI } from '../constants';
import { earthRotationAngle, eciToEcef, ecefToGeodetic } from '../frames/frames';
import { type Vec3, add, scale, cross, dot, length, normalize, isFiniteVec3 } from '../math/vec3';
import { elementsFromState, meanAnomalyFromTrue, meanMotion, trueAnomalyAtRadius } from './elements';
import { propagateKepler, type KeplerState } from './kepler';

export const SYNCHRONOUS_RADIUS = Math.cbrt(EARTH.MU / EARTH.ROTATION_RATE ** 2);
/** 与现有大气模型上界一致；不把稀薄大气当作真空。 */
export const ANALYTIC_MIN_ALTITUDE = 1_000_000;
/** 游戏验收容差，不是自然常数。经度摆幅按一个恒星日采样计算。 */
export const GEO_LIMITS = { periodError: 120, eccentricity: 0.002, inclination: 0.2 * DEG2RAD, longitudeSpan: 1 * DEG2RAD } as const;
export const TRACK_SEGMENTS = 180;
export interface ManeuverNode {
  readonly time: number;
  readonly prograde: number;
  readonly radial: number;
  readonly normal: number;
}
export interface ManeuverPlan {
  readonly node: ManeuverNode;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly deltaVelocity: Vec3;
  readonly after: KeplerState;
}
export const validNode = (node: ManeuverNode): boolean =>
  [node.time, node.prograde, node.radial, node.normal].every(Number.isFinite) && node.time >= 0 &&
  Math.hypot(node.prograde, node.radial, node.normal) <= 30_000;

export const maneuverBasis = (r: Vec3, v: Vec3) => {
  if (!isFiniteVec3(r) || !isFiniteVec3(v) || length(v) < 0.5 || length(cross(r, v)) < 1) return null;
  const prograde = normalize(v);
  const normal = normalize(cross(r, v));
  return { prograde, radial: normalize(cross(prograde, normal)), normal };
};
export const planManeuver = (r: Vec3, v: Vec3, now: number, node: ManeuverNode): ManeuverPlan | null => {
  if (!Number.isFinite(now) || !validNode(node) || node.time < now || length(r) <= EARTH.RADIUS) return null;
  const at = propagateKepler(r, v, node.time - now);
  const basis = maneuverBasis(at.position, at.velocity);
  if (!basis || !isFiniteVec3(at.position) || length(at.position) <= EARTH.RADIUS) return null;
  const deltaVelocity = add(add(scale(basis.prograde, node.prograde), scale(basis.radial, node.radial)), scale(basis.normal, node.normal));
  const after = { position: at.position, velocity: add(at.velocity, deltaVelocity) };
  return { node, ...at, deltaVelocity, after };
};

/** 同平面圆轨道之间的霍曼转移。升轨与降轨均保留点火的正负号。 */
export const hohmannTransfer = (r1: number, r2: number) => {
  if (![r1, r2].every((r) => Number.isFinite(r) && r > EARTH.RADIUS)) throw new Error('转移轨道半径必须有限且在地面以上');
  const a = (r1 + r2) / 2;
  return {
    departure: Math.sqrt(EARTH.MU * (2 / r1 - 1 / a)) - Math.sqrt(EARTH.MU / r1),
    arrival: Math.sqrt(EARTH.MU / r2) - Math.sqrt(EARTH.MU * (2 / r2 - 1 / a)),
    coastTime: Math.PI * Math.sqrt(a ** 3 / EARTH.MU),
  };
};
/** 在交点同时变速和改变轨道面，角度由调用者根据交点几何给出。 */
export const combinedPlaneChange = (before: number, after: number, angle: number): number =>
  Math.hypot(after * Math.cos(angle) - before, after * Math.sin(angle));

export interface GroundPoint { readonly time: number; readonly latitude: number; readonly longitude: number }
export const groundTrack = (r: Vec3, v: Vec3, now: number, epochAngle: number, duration: number, segments = TRACK_SEGMENTS): GroundPoint[] => {
  if (![now, epochAngle, duration, segments].every(Number.isFinite) || duration <= 0 || segments < 1 || segments > 4096 || !maneuverBasis(r, v)) return [];
  const points: GroundPoint[] = [];
  const count = Math.floor(segments);
  for (let i = 0; i <= count; i++) {
    const dt = duration * i / count;
    const state = propagateKepler(r, v, dt);
    if (!isFiniteVec3(state.position) || length(state.position) < EARTH.RADIUS) break;
    const geo = ecefToGeodetic(eciToEcef(state.position, earthRotationAngle(epochAngle, now + dt)));
    points.push({ time: now + dt, latitude: geo.latitude, longitude: geo.longitude });
  }
  return points;
};
export const splitGroundTrack = (points: readonly GroundPoint[]): GroundPoint[][] => {
  const lines: GroundPoint[][] = [];
  for (const point of points) {
    const line = lines.at(-1);
    const previous = line?.at(-1);
    if (!line || (previous && Math.abs(point.longitude - previous.longitude) > Math.PI)) lines.push([point]);
    else line.push(point);
  }
  return lines;
};

export const synchronousDiagnostics = (r: Vec3, v: Vec3) => {
  const orbit = elementsFromState(r, v);
  const periodError = Math.abs(orbit.period - SIDEREAL_DAY);
  const gso = orbit.kind === 'elliptic' && periodError <= GEO_LIMITS.periodError;
  let longitudeSpan: number | null = null;
  if (gso) {
    const points = groundTrack(r, v, 0, 0, SIDEREAL_DAY);
    let unwrapped = 0, min = 0, max = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!, b = points[i]!;
      unwrapped += Math.atan2(Math.sin(b.longitude - a.longitude), Math.cos(b.longitude - a.longitude));
      min = Math.min(min, unwrapped); max = Math.max(max, unwrapped);
    }
    longitudeSpan = points.length === TRACK_SEGMENTS + 1 ? max - min : null;
  }
  return {
    gso, periodError: Number.isFinite(periodError) ? periodError : null, longitudeSpan,
    geo: gso && orbit.eccentricity <= GEO_LIMITS.eccentricity && orbit.inclination <= GEO_LIMITS.inclination &&
      longitudeSpan !== null && longitudeSpan <= GEO_LIMITS.longitudeSpan,
  };
};

/** 下一次下降穿越大气顶的时间；安全椭圆无边界。非椭圆保守地禁用批量传播。 */
export const vacuumCoastWindow = (r: Vec3, v: Vec3): number => {
  if (!maneuverBasis(r, v) || length(r) <= EARTH.RADIUS + ANALYTIC_MIN_ALTITUDE) return 0;
  const orbit = elementsFromState(r, v);
  if (orbit.kind !== 'elliptic') return 0;
  if (orbit.periapsisRadius > EARTH.RADIUS + ANALYTIC_MIN_ALTITUDE) return Infinity;
  const crossing = trueAnomalyAtRadius(orbit, EARTH.RADIUS + ANALYTIC_MIN_ALTITUDE);
  if (crossing === null) return 0;
  const targetM = meanAnomalyFromTrue(orbit.eccentricity, TWO_PI - crossing);
  const nowM = meanAnomalyFromTrue(orbit.eccentricity, orbit.trueAnomaly);
  return ((targetM - nowM + TWO_PI) % TWO_PI) / meanMotion(orbit);
};

/** 将惯性系速度差投影到节点的三个正交分量。 */
export const nodeForVelocity = (at: KeplerState, time: number, target: Vec3): ManeuverNode | null => {
  const basis = maneuverBasis(at.position, at.velocity);
  if (!basis) return null;
  const dv = add(target, scale(at.velocity, -1));
  return { time, prograde: dot(dv, basis.prograde), radial: dot(dv, basis.radial), normal: dot(dv, basis.normal) };
};
