/** 玩家可选择的机动草案：只计算节点，绝不自动执行。 */
import { EARTH, TWO_PI } from '../constants';
import { type Vec3, cross, dot, isFiniteVec3, length, normalize, scale } from '../math/vec3';
import { elementsFromState, meanAnomalyFromTrue, meanMotion, perifocalBasis } from './elements';
import { propagateKepler } from './kepler';
import { nodeForVelocity, SYNCHRONOUS_RADIUS, type ManeuverNode } from './advanced';
export type ManeuverPreset = 'gto' | 'equatorial' | 'circular' | 'synchronous';
export const suggestManeuver = (r: Vec3, v: Vec3, now: number, preset: ManeuverPreset): ManeuverNode | null => {
  const el = elementsFromState(r, v);
  if (el.kind !== 'elliptic' || el.periapsisRadius < EARTH.RADIUS) return null;
  const currentM = meanAnomalyFromTrue(el.eccentricity, el.trueAnomaly), n = meanMotion(el);
  const timeAt = (nu: number) => {
    let dt = ((meanAnomalyFromTrue(el.eccentricity, (nu + TWO_PI) % TWO_PI) - currentM + TWO_PI) % TWO_PI) / n;
    if (dt < 600) dt += el.period;
    return dt;
  };
  let dt: number;
  if (preset === 'gto' || preset === 'equatorial') {
    const candidates = [timeAt(-el.argumentOfPeriapsis), timeAt(Math.PI - el.argumentOfPeriapsis)];
    dt = preset === 'gto' ? Math.min(...candidates) : candidates.sort((a,b) => length(propagateKepler(r,v,b).position) - length(propagateKepler(r,v,a).position))[0]!;
  } else dt = timeAt(Math.PI);
  const at = propagateKepler(r, v, dt), radius = length(at.position);
  const normal = normalize(cross(r,v));
  const tangent = normalize(cross(preset === 'equatorial' ? {x:0,y:0,z:1} : normal, at.position));
  let speed = Math.sqrt(EARTH.MU / radius);
  if (preset === 'gto' || preset === 'synchronous') speed = Math.sqrt(EARTH.MU * (2 / radius - 2 / (radius + SYNCHRONOUS_RADIUS)));
  return nodeForVelocity(at, now + dt, scale(tangent,speed));
};

/** 双击轨道上的空间位置，取其轨道平面投影，选择下一次到达该点的时刻。 */
export const nodeAtPosition = (r: Vec3, v: Vec3, now: number, point: Vec3): ManeuverNode | null => {
  if (!isFiniteVec3(point) || !Number.isFinite(now)) return null;
  const el = elementsFromState(r, v);
  if (el.kind !== 'elliptic' || el.periapsisRadius <= EARTH.RADIUS) return null;
  const basis = perifocalBasis(el);
  const nu = (Math.atan2(dot(point, basis.q), dot(point, basis.p)) + TWO_PI) % TWO_PI;
  let dt = ((meanAnomalyFromTrue(el.eccentricity, nu) - meanAnomalyFromTrue(el.eccentricity, el.trueAnomaly) + TWO_PI) % TWO_PI) / meanMotion(el);
  if (dt < 1) dt += el.period;
  return { time: now + dt, prograde: 0, radial: 0, normal: 0 };
};
