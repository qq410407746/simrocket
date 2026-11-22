import { describe, expect, it } from 'vitest';
import { EARTH, DEG2RAD, SIDEREAL_DAY } from '../constants';
import { vec3, length, sub } from '../math/vec3';
import { elementsFromState, stateFromElements } from './elements';
import { propagateKepler } from './kepler';
import { SYNCHRONOUS_RADIUS, hohmannTransfer, combinedPlaneChange, groundTrack, splitGroundTrack, synchronousDiagnostics, planManeuver, vacuumCoastWindow, ANALYTIC_MIN_ALTITUDE } from './advanced';
const state = (a: number, e = 0, i = 0, nu = 0) => stateFromElements({ semiLatusRectum: a * (1 - e * e), eccentricity: e, inclination: i, raan: 0, argumentOfPeriapsis: 0, trueAnomaly: nu });
describe('高级轨道计算', () => {
  it('200 km 至同步轨道的两次点火与转移时间符合活力方程，并实际到达目标圆轨道', () => {
    const r1 = EARTH.RADIUS + 200_000, r2 = SYNCHRONOUS_RADIUS;
    const transfer = hohmannTransfer(r1, r2);
    expect(transfer.departure).toBeGreaterThan(2400); expect(transfer.departure).toBeLessThan(2500);
    expect(transfer.arrival).toBeGreaterThan(1400); expect(transfer.arrival).toBeLessThan(1500);
    const initial = state(r1);
    const first = planManeuver(initial.position, initial.velocity, 0, { time: 0, prograde: transfer.departure, radial: 0, normal: 0 })!;
    const apo = propagateKepler(first.after.position, first.after.velocity, transfer.coastTime);
    expect(length(apo.position)).toBeCloseTo(r2, 3);
    const second = planManeuver(apo.position, apo.velocity, transfer.coastTime, { time: transfer.coastTime, prograde: transfer.arrival, radial: 0, normal: 0 })!;
    expect(elementsFromState(second.after.position, second.after.velocity).eccentricity).toBeLessThan(1e-10);
    expect(synchronousDiagnostics(second.after.position, second.after.velocity).geo).toBe(true);
  });
  it('合并倾角修正等于速度矢量之差，而非简单相加', () => {
    const angle = 28.5 * DEG2RAD;
    expect(combinedPlaneChange(1600, 3075, angle)).toBeCloseTo(length(sub(vec3(3075, 0, 0), vec3(1600 * Math.cos(angle), 1600 * Math.sin(angle), 0))), 10);
    expect(combinedPlaneChange(3000, 3000, angle)).toBeCloseTo(6000 * Math.sin(angle / 2), 10);
  });
  it('三个机动分量使用正交基，预览不会改动输入，非法节点被拒绝', () => {
    const initial = state(EARTH.RADIUS + 500_000, 0.02, 0.3, 1);
    const original = structuredClone(initial);
    const plan = planManeuver(initial.position, initial.velocity, 10, { time: 100, prograde: 100, radial: -200, normal: 50 })!;
    expect(length(plan.deltaVelocity)).toBeCloseTo(Math.hypot(100, 200, 50), 9);
    expect(initial).toEqual(original);
    expect(planManeuver(initial.position, initial.velocity, 10, { time: 9, prograde: 1, radial: 0, normal: 0 })).toBeNull();
    expect(planManeuver(initial.position, initial.velocity, 0, { time: 10, prograde: NaN, radial: 0, normal: 0 })).toBeNull();
  });
  it('同步不等于静止：倾斜、偏心、逆行、太阳日均不能冒充 GEO', () => {
    for (const initial of [state(SYNCHRONOUS_RADIUS, 0, 20 * DEG2RAD), state(SYNCHRONOUS_RADIUS, 0.1), state(SYNCHRONOUS_RADIUS, 0, Math.PI)]) {
      const result = synchronousDiagnostics(initial.position, initial.velocity);
      expect(result.gso).toBe(true); expect(result.geo).toBe(false);
      expect(result.longitudeSpan).toBeGreaterThan(0.01);
    }
    const solar = state(Math.cbrt(EARTH.MU * (86400 / (2 * Math.PI)) ** 2));
    expect(synchronousDiagnostics(solar.position, solar.velocity).gso).toBe(false);
  });
  it('地面轨迹按每个采样时刻旋转地球，GEO 经度不变，日期线断开', () => {
    const geo = state(SYNCHRONOUS_RADIUS);
    const points = groundTrack(geo.position, geo.velocity, 0, 0, SIDEREAL_DAY);
    expect(Math.max(...points.map((p) => Math.abs(p.longitude)))).toBeLessThan(1e-10);
    const polar = state(EARTH.RADIUS + 400_000, 0, Math.PI / 2);
    const track = groundTrack(polar.position, polar.velocity, 0, 0, elementsFromState(polar.position, polar.velocity).period);
    expect(Math.max(...track.map((p) => p.latitude))).toBeGreaterThan(89 * DEG2RAD);
    for (const line of splitGroundTrack(track)) for (let i = 1; i < line.length; i++) expect(Math.abs(line[i]!.longitude - line[i - 1]!.longitude)).toBeLessThanOrEqual(Math.PI);
  });
  it('GTO 解析滑行停在下一次下降穿越大气顶，绝不跨越整圈漏掉边界', () => {
    const rp = EARTH.RADIUS + 200_000, ra = SYNCHRONOUS_RADIUS;
    const initial = state((rp + ra) / 2, (ra - rp) / (ra + rp), 0.2, Math.PI);
    const window = vacuumCoastWindow(initial.position, initial.velocity);
    expect(window).toBeGreaterThan(1000);
    const end = propagateKepler(initial.position, initial.velocity, window);
    expect(length(end.position) - EARTH.RADIUS).toBeCloseTo(ANALYTIC_MIN_ALTITUDE, 3);
    expect(vacuumCoastWindow(state(rp).position, state(rp).velocity)).toBe(0);
    const high = state(SYNCHRONOUS_RADIUS);
    expect(vacuumCoastWindow(high.position, high.velocity)).toBe(Infinity);
  });
});
