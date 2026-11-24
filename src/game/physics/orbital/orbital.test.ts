import { describe, expect, it } from 'vitest';
import { DEG2RAD, EARTH, RAD2DEG, SIDEREAL_DAY, TWO_PI } from '../constants';
import { type AccelerationFn, type MutableVec3, Rk4Integrator } from '../integration/rk4';
import { type Vec3, cross, distance, dot, length, scale, vec3 } from '../math/vec3';
import { TWO_BODY_ACCURACY } from './accuracy';
import {
  circularSpeed,
  elementsFromState,
  escapeSpeed,
  meanAnomalyFromTrue,
  perifocalBasis,
  positionAtTrueAnomaly,
  radiusAtTrueAnomaly,
  stateFromElements,
  timeToApoapsis,
  timeToPeriapsis,
  trueAnomalyAtRadius,
} from './elements';
import { propagateKepler, stumpffC, stumpffS } from './kepler';
import { sampleConic } from './sampling';

const MU = EARTH.MU;

/** 近地点在 +X 轴上、给定倾角的轨道在近地点处的状态。 */
const periapsisState = (periapsisAltitude: number, apoapsisAltitude: number, inclinationDeg: number) => {
  const rp = EARTH.RADIUS + periapsisAltitude;
  const ra = EARTH.RADIUS + apoapsisAltitude;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU * (2 / rp - 1 / a));
  const inc = inclinationDeg * DEG2RAD;
  return {
    rp,
    ra,
    a,
    period: TWO_PI * Math.sqrt(a ** 3 / MU),
    position: vec3(rp, 0, 0),
    velocity: vec3(0, vp * Math.cos(inc), vp * Math.sin(inc)),
  };
};

const energyOf = (r: Vec3, v: Vec3): number => dot(v, v) / 2 - MU / length(r);

describe('状态向量 → 轨道根数：教科书算例', () => {
  it('Vallado 例 2-5（大偏心率、近极轨）', () => {
    const el = elementsFromState(
      vec3(6524.834e3, 6862.875e3, 6448.296e3),
      vec3(4901.327, 5533.756, -1976.341),
      398600.4418e9,
    );
    expect(el.kind).toBe('elliptic');
    expect(el.semiLatusRectum / 1e3).toBeCloseTo(11067.79, 1);
    expect(el.semiMajorAxis / 1e3).toBeCloseTo(36127.34, 1);
    expect(el.eccentricity).toBeCloseTo(0.832853, 6);
    expect(el.inclination * RAD2DEG).toBeCloseTo(87.87, 2);
    expect(el.raan * RAD2DEG).toBeCloseTo(227.898, 2);
    expect(el.argumentOfPeriapsis * RAD2DEG).toBeCloseTo(53.38, 2);
    expect(el.trueAnomaly * RAD2DEG).toBeCloseTo(92.335, 3);
  });

  it('Curtis 例 4.3（逆行轨道）', () => {
    const el = elementsFromState(vec3(-6045e3, -3490e3, 2500e3), vec3(-3457, 6618, 2533), 398600e9);
    expect(el.angularMomentum / 1e6).toBeCloseTo(58310, -1);
    expect(el.inclination * RAD2DEG).toBeCloseTo(153.2, 1);
    expect(el.raan * RAD2DEG).toBeCloseTo(255.3, 1);
    expect(el.eccentricity).toBeCloseTo(0.1712, 4);
    expect(el.argumentOfPeriapsis * RAD2DEG).toBeCloseTo(20.07, 2);
    expect(el.trueAnomaly * RAD2DEG).toBeCloseTo(28.45, 2);
    expect(el.periapsisRadius / 1e3).toBeCloseTo(7284, -1);
    expect(el.apoapsisRadius / 1e3).toBeCloseTo(10293, -1);
    expect(el.period / 3600).toBeCloseTo(2.278, 2);
  });
});

describe('轨道根数：基本性质', () => {
  it('圆轨道速度、逃逸速度', () => {
    // 400 km：7.669 km/s；地球同步轨道半径：3.0747 km/s
    expect(circularSpeed(EARTH.RADIUS + 400_000)).toBeCloseTo(7672.6, 0);
    expect(circularSpeed(42_164_000)).toBeCloseTo(3074.7, 0);
    expect(escapeSpeed(EARTH.RADIUS) / 1000).toBeCloseTo(11.186, 2);
    expect(escapeSpeed(7e6) / circularSpeed(7e6)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('圆轨道周期：400 km 约 92.4 分钟；同步轨道半径处等于恒星日', () => {
    const leo = periapsisState(400_000, 400_000, 51.6);
    expect(elementsFromState(leo.position, leo.velocity).period / 60).toBeCloseTo(92.4, 1);
    const rGeo = Math.cbrt((MU * SIDEREAL_DAY ** 2) / (4 * Math.PI ** 2));
    const geo = elementsFromState(vec3(rGeo, 0, 0), vec3(0, circularSpeed(rGeo), 0));
    expect(geo.period).toBeCloseTo(SIDEREAL_DAY, 3);
  });

  it('近地点、远地点、半长轴、偏心率与构造值一致', () => {
    const o = periapsisState(200_000, 35_786_000, 28.5);
    const el = elementsFromState(o.position, o.velocity);
    expect(el.periapsisRadius).toBeCloseTo(o.rp, 3);
    expect(el.apoapsisRadius).toBeCloseTo(o.ra, 2);
    expect(el.semiMajorAxis).toBeCloseTo(o.a, 2);
    expect(el.eccentricity).toBeCloseTo((o.ra - o.rp) / (o.ra + o.rp), 12);
    expect(el.inclination * RAD2DEG).toBeCloseTo(28.5, 10);
    expect(el.trueAnomaly).toBeCloseTo(0, 9);
    expect(el.period).toBeCloseTo(o.period, 4);
  });

  it('倾角：向东发射时等于纬度；逆行轨道大于 90°；极轨为 90°', () => {
    const r = vec3(7e6 * Math.cos(0.5), 0, 7e6 * Math.sin(0.5));
    const east = vec3(0, 1, 0);
    expect(elementsFromState(r, scale(east, 7500)).inclination).toBeCloseTo(0.5, 12);
    expect(elementsFromState(r, scale(east, -7500)).inclination).toBeCloseTo(Math.PI - 0.5, 12);
    expect(elementsFromState(vec3(7e6, 0, 0), vec3(0, 0, 7500)).inclination * RAD2DEG).toBeCloseTo(90, 12);
  });

  it('能量与角动量：ε = −μ/2a，h² = μp', () => {
    const o = periapsisState(300_000, 5_000_000, 63.4);
    const el = elementsFromState(o.position, o.velocity);
    expect(el.specificEnergy).toBeCloseTo(-MU / (2 * el.semiMajorAxis), 3);
    expect(el.angularMomentum ** 2 / MU).toBeCloseTo(el.semiLatusRectum, 3);
    expect(el.angularMomentum).toBeCloseTo(length(cross(o.position, o.velocity)), 3);
  });
});

describe('轨道根数 ↔ 状态向量往返', () => {
  // 一组覆盖顺行/逆行、各种偏心率与方位的状态
  const states: readonly (readonly [string, Vec3, Vec3])[] = [
    ['近地椭圆', vec3(6.8e6, 1.2e6, -2.1e6), vec3(-1500, 7200, 2100)],
    ['大椭圆', vec3(-2.0e7, 1.5e7, 6e6), vec3(-1200, -2600, 900)],
    ['逆行', vec3(7.1e6, -3e5, 1e6), vec3(600, -7400, -800)],
    ['近极轨', vec3(1e6, 2e6, 6.9e6), vec3(7300, -400, -900)],
    ['双曲线', vec3(7e6, 0, 1e6), vec3(2000, 11500, 3000)],
    ['双曲线（飞离中）', vec3(-3e7, 4e7, 1e7), vec3(-4000, 5200, 1500)],
  ];

  it.each(states)('%s', (_name, r, v) => {
    const el = elementsFromState(r, v);
    const back = stateFromElements(el);
    expect(distance(back.position, r) / length(r)).toBeLessThan(1e-12);
    expect(distance(back.velocity, v) / length(v)).toBeLessThan(1e-12);
    for (const value of Object.values(el)) if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
  });

  it('双曲线：半长轴为负，没有远地点与周期', () => {
    const el = elementsFromState(vec3(7e6, 0, 1e6), vec3(2000, 11500, 3000));
    expect(el.kind).toBe('hyperbolic');
    expect(el.eccentricity).toBeGreaterThan(1);
    expect(el.semiMajorAxis).toBeLessThan(0);
    expect(el.apoapsisRadius).toBe(Infinity);
    expect(el.period).toBe(Infinity);
    expect(el.periapsisRadius).toBeGreaterThan(0);
  });

  it('抛物线：恰好以逃逸速度运动', () => {
    const r = vec3(7e6, 0, 0);
    const el = elementsFromState(r, vec3(0, escapeSpeed(7e6), 0));
    expect(el.kind).toBe('parabolic');
    expect(el.semiMajorAxis).toBe(Infinity);
    expect(el.periapsisRadius).toBeCloseTo(7e6, 1);
    const back = stateFromElements(el);
    expect(distance(back.position, r)).toBeLessThan(1e-3);
  });
});

describe('奇异情形：圆轨道与赤道轨道', () => {
  const roundTrip = (r: Vec3, v: Vec3) => {
    const el = elementsFromState(r, v);
    const back = stateFromElements(el);
    expect(distance(back.position, r)).toBeLessThan(1e-3);
    expect(distance(back.velocity, v)).toBeLessThan(1e-6);
    for (const value of Object.values(el)) if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
    return el;
  };

  it('倾斜圆轨道：ω = 0，ν 为纬度幅角', () => {
    const radius = 7e6;
    const speed = circularSpeed(radius);
    const inc = 51.6 * DEG2RAD;
    // 升交点在 +X；自升交点起转过 70° 的位置
    const u = 70 * DEG2RAD;
    const pHat = vec3(1, 0, 0);
    const qHat = vec3(0, Math.cos(inc), Math.sin(inc));
    const r = vec3(radius * Math.cos(u), radius * Math.sin(u) * qHat.y, radius * Math.sin(u) * qHat.z);
    const v = vec3(-speed * Math.sin(u) * pHat.x, speed * Math.cos(u) * qHat.y, speed * Math.cos(u) * qHat.z);
    const el = roundTrip(r, v);
    expect(el.eccentricity).toBeLessThan(1e-9);
    expect(el.argumentOfPeriapsis).toBe(0);
    expect(el.raan).toBeCloseTo(0, 9);
    expect(el.trueAnomaly * RAD2DEG).toBeCloseTo(70, 6);
  });

  it('赤道椭圆轨道：Ω = 0，ω 为近地点经度', () => {
    // 近地点在经度 40° 方向
    const lon = 40 * DEG2RAD;
    const rp = 7e6;
    const vp = Math.sqrt(MU * (2 / rp - 1 / 9e6));
    const r = vec3(rp * Math.cos(lon), rp * Math.sin(lon), 0);
    const v = vec3(-vp * Math.sin(lon), vp * Math.cos(lon), 0);
    const el = roundTrip(r, v);
    expect(el.inclination).toBeCloseTo(0, 12);
    expect(el.raan).toBe(0);
    expect(el.argumentOfPeriapsis * RAD2DEG).toBeCloseTo(40, 6);
    expect(el.trueAnomaly).toBeLessThan(TWO_PI);
    // 位于近地点：ν ≈ 0（或数值上略小于 2π）
    expect(Math.min(el.trueAnomaly, TWO_PI - el.trueAnomaly)).toBeLessThan(1e-6);
  });

  it('角度始终落在 [0, 2π) 内（含极小负角的舍入情形）', () => {
    for (const lon of [0, 1e-17, -1e-17, 3, -3]) {
      const el = elementsFromState(
        vec3(7e6 * Math.cos(lon), 7e6 * Math.sin(lon), 0),
        vec3(-8000 * Math.sin(lon), 8000 * Math.cos(lon), 0),
      );
      for (const angle of [el.raan, el.argumentOfPeriapsis, el.trueAnomaly]) {
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(TWO_PI);
      }
    }
  });

  it('逆行赤道椭圆轨道', () => {
    const lon = 40 * DEG2RAD;
    const rp = 7e6;
    const vp = Math.sqrt(MU * (2 / rp - 1 / 9e6));
    const el = roundTrip(vec3(rp * Math.cos(lon), rp * Math.sin(lon), 0), vec3(vp * Math.sin(lon), -vp * Math.cos(lon), 0));
    expect(el.inclination).toBeCloseTo(Math.PI, 12);
  });

  it('圆赤道轨道（地球静止轨道）：Ω = ω = 0，ν 为真经度', () => {
    const rGeo = 42_164_000;
    const lon = 110 * DEG2RAD;
    const speed = circularSpeed(rGeo);
    const el = roundTrip(
      vec3(rGeo * Math.cos(lon), rGeo * Math.sin(lon), 0),
      vec3(-speed * Math.sin(lon), speed * Math.cos(lon), 0),
    );
    expect(el.raan).toBe(0);
    expect(el.argumentOfPeriapsis).toBe(0);
    expect(el.trueAnomaly * RAD2DEG).toBeCloseTo(110, 6);
    expect(el.periapsisRadius).toBeCloseTo(rGeo, 0);
    expect(el.apoapsisRadius).toBeCloseTo(rGeo, 0);
  });

  it('发射台上的状态（随地球自转）：数值有限，近地点在地下', () => {
    const r = vec3(EARTH.RADIUS * Math.cos(0.5), 0, EARTH.RADIUS * Math.sin(0.5));
    const v = cross(vec3(0, 0, EARTH.ROTATION_RATE), r);
    const el = elementsFromState(r, v);
    expect(el.kind).toBe('elliptic');
    expect(el.apoapsisRadius).toBeCloseTo(EARTH.RADIUS, -1);
    expect(el.periapsisRadius).toBeLessThan(100_000);
    for (const value of Object.values(el)) if (typeof value === 'number') expect(Number.isNaN(value)).toBe(false);
  });
});

describe('轨道上的位置与时间', () => {
  const o = periapsisState(300_000, 2_000_000, 40);
  const el = elementsFromState(o.position, o.velocity);

  it('ν = 0 为近地点，ν = π 为远地点', () => {
    expect(radiusAtTrueAnomaly(el, 0)).toBeCloseTo(o.rp, 3);
    expect(radiusAtTrueAnomaly(el, Math.PI)).toBeCloseTo(o.ra, 3);
    const basis = perifocalBasis(el);
    expect(distance(positionAtTrueAnomaly(el, basis, 0), o.position)).toBeLessThan(1e-3);
    // 轨道面法向与角动量方向一致
    const h = cross(o.position, o.velocity);
    expect(dot(basis.w, scale(h, 1 / length(h)))).toBeCloseTo(1, 12);
  });

  it('在近地点：到远地点半个周期，到下一次近地点一个周期', () => {
    expect(timeToApoapsis(el)).toBeCloseTo(o.period / 2, 3);
    // 恰在近地点时"下一次"可以是 0 或一个整周期（数值上二者都合理）
    const tp = timeToPeriapsis(el)!;
    expect(Math.min(tp, Math.abs(tp - o.period))).toBeLessThan(1e-2);
  });

  it('到拱点的时间与解析传播一致', () => {
    const later = propagateKepler(o.position, o.velocity, 1000);
    const elLater = elementsFromState(later.position, later.velocity);
    expect(timeToApoapsis(elLater)).toBeCloseTo(o.period / 2 - 1000, 2);
    expect(timeToPeriapsis(elLater)).toBeCloseTo(o.period - 1000, 2);
    // 过了远地点之后，下一次远地点在将近一个周期之后
    const past = propagateKepler(o.position, o.velocity, o.period / 2 + 500);
    expect(timeToApoapsis(elementsFromState(past.position, past.velocity))).toBeCloseTo(o.period - 500, 2);
  });

  it('平近点角：近地点为 0，远地点为 π，随时间线性增长', () => {
    expect(meanAnomalyFromTrue(el.eccentricity, 0)).toBeCloseTo(0, 12);
    expect(meanAnomalyFromTrue(el.eccentricity, Math.PI)).toBeCloseTo(Math.PI, 12);
    const quarter = propagateKepler(o.position, o.velocity, o.period / 4);
    const m = meanAnomalyFromTrue(el.eccentricity, elementsFromState(quarter.position, quarter.velocity).trueAnomaly);
    expect(m).toBeCloseTo(Math.PI / 2, 8);
  });

  it('双曲线：飞向近地点时有到近地点的时间，飞离后没有；没有远地点', () => {
    const inbound = elementsFromState(vec3(-3e7, -4e7, 0), vec3(5200, 4000, 0));
    expect(inbound.kind).toBe('hyperbolic');
    const t = timeToPeriapsis(inbound);
    expect(t).not.toBeNull();
    const atPeriapsis = propagateKepler(vec3(-3e7, -4e7, 0), vec3(5200, 4000, 0), t!);
    expect(length(atPeriapsis.position)).toBeCloseTo(inbound.periapsisRadius, -1);
    const outbound = propagateKepler(vec3(-3e7, -4e7, 0), vec3(5200, 4000, 0), t! + 3600);
    const elOut = elementsFromState(outbound.position, outbound.velocity);
    expect(timeToPeriapsis(elOut)).toBeNull();
    expect(timeToApoapsis(elOut)).toBeNull();
  });

  it('轨道与给定地心距的交点', () => {
    const nu = trueAnomalyAtRadius(el, EARTH.RADIUS + 1_000_000)!;
    expect(radiusAtTrueAnomaly(el, nu)).toBeCloseTo(EARTH.RADIUS + 1_000_000, 3);
    expect(trueAnomalyAtRadius(el, o.ra + 1)).toBeNull();
    expect(trueAnomalyAtRadius(el, o.rp - 1)).toBeNull();
  });
});

describe('Stumpff 函数', () => {
  it('已知值与零点附近的连续性', () => {
    expect(stumpffC(0)).toBeCloseTo(0.5, 15);
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 15);
    expect(stumpffC(Math.PI ** 2)).toBeCloseTo(2 / Math.PI ** 2, 14);
    expect(stumpffC(4 * Math.PI ** 2)).toBeCloseTo(0, 14);
    expect(stumpffS(Math.PI ** 2)).toBeCloseTo(1 / Math.PI ** 2, 14);
    for (const z of [1e-2, -1e-2]) {
      // 级数与闭式在切换点两侧一致：差值只应来自函数本身的斜率（|C'| ≈ 1/24，|S'| ≈ 1/120）
      const dz = Math.abs(z) * 2e-9;
      expect(Math.abs(stumpffC(z * (1 + 1e-9)) - stumpffC(z * (1 - 1e-9)))).toBeLessThan(dz / 24 + 1e-13);
      expect(Math.abs(stumpffS(z * (1 + 1e-9)) - stumpffS(z * (1 - 1e-9)))).toBeLessThan(dz / 120 + 1e-13);
    }
    // 级数与闭式在同一点的值一致
    expect(stumpffC(5e-3)).toBeCloseTo((1 - Math.cos(Math.sqrt(5e-3))) / 5e-3, 12);
    expect(stumpffS(-5e-3)).toBeCloseTo((Math.sinh(Math.sqrt(5e-3)) - Math.sqrt(5e-3)) / Math.sqrt(5e-3) ** 3, 12);
    // 双曲分支
    expect(stumpffC(-4)).toBeCloseTo((Math.cosh(2) - 1) / 4, 14);
    expect(stumpffS(-4)).toBeCloseTo((Math.sinh(2) - 2) / 8, 14);
  });
});

describe('开普勒解析传播', () => {
  it('回归：双曲线、时间跨度短于渐近初值适用范围时也收敛（旅行者 2 号土星—天王星段的日心状态）', () => {
    // 修复前对数初值与 t 反号，单侧加倍发散成 Infinity
    const mu = 1.32712440042e20;
    const r0 = vec3(-7.9e11, 1.1e11, 3.0e10);
    const v0 = vec3(-2.6e3, -1.94e4, 1.0e2);
    const alpha = 2 / length(r0) - dot(v0, v0) / mu;
    expect(alpha).toBeLessThan(0);
    const energy = (r: Vec3, v: Vec3) => dot(v, v) / 2 - mu / length(r);
    const h0 = cross(r0, v0);
    for (const dt of [1e3, 8.4e5, 1e7, 6.7e7]) {
      const s = propagateKepler(r0, v0, dt, mu);
      expect(Number.isFinite(s.position.x) && Number.isFinite(s.velocity.y)).toBe(true);
      expect(Math.abs(energy(s.position, s.velocity) - energy(r0, v0)) / Math.abs(energy(r0, v0))).toBeLessThan(1e-9);
      expect(distance(cross(s.position, s.velocity), h0) / length(h0)).toBeLessThan(1e-9);
      const back = propagateKepler(s.position, s.velocity, -dt, mu);
      expect(distance(back.position, r0) / length(r0)).toBeLessThan(1e-9);
    }
  });

  it('Curtis 例 3.7：60 分钟后的位置与速度', () => {
    const k = propagateKepler(vec3(7000e3, -12124e3, 0), vec3(2667.9, 4621.0, 0), 3600, 398600e9);
    expect(k.position.x / 1e3).toBeCloseTo(-3297.77, 1);
    expect(k.position.y / 1e3).toBeCloseTo(7413.4, 1);
    expect(k.velocity.x / 1e3).toBeCloseTo(-8.2976, 3);
    expect(k.velocity.y / 1e3).toBeCloseTo(-0.96404, 3);
  });

  it('圆轨道：四分之一周期转过 90°，一个周期回到原处', () => {
    const o = periapsisState(500_000, 500_000, 0);
    const quarter = propagateKepler(o.position, o.velocity, o.period / 4);
    expect(distance(quarter.position, vec3(0, o.rp, 0))).toBeLessThan(1e-3);
    const full = propagateKepler(o.position, o.velocity, o.period);
    expect(distance(full.position, o.position)).toBeLessThan(1e-3);
  });

  it('守恒量：能量与角动量在任意时间跨度后不变', () => {
    const r0 = vec3(6.8e6, 1.2e6, -2.1e6);
    const v0 = vec3(-1500, 7200, 2100);
    const e0 = energyOf(r0, v0);
    const h0 = cross(r0, v0);
    for (const dt of [1, 600, 5_000, 86_400, 30 * 86_400, -7_200]) {
      const k = propagateKepler(r0, v0, dt);
      expect(Math.abs(energyOf(k.position, k.velocity) - e0) / Math.abs(e0)).toBeLessThan(1e-11);
      expect(distance(cross(k.position, k.velocity), h0) / length(h0)).toBeLessThan(1e-11);
    }
  });

  it('正向再反向传播回到初始状态（椭圆、双曲线、抛物线）', () => {
    const cases: readonly (readonly [Vec3, Vec3])[] = [
      [vec3(7e6, 1e6, -2e6), vec3(-1000, 7000, 3000)],
      [vec3(7e6, 0, 1e6), vec3(2000, 11500, 3000)],
      [vec3(7e6, 0, 0), vec3(0, escapeSpeed(7e6), 0)],
    ];
    for (const [r0, v0] of cases) {
      const forward = propagateKepler(r0, v0, 12_345.678);
      const back = propagateKepler(forward.position, forward.velocity, -12_345.678);
      expect(distance(back.position, r0)).toBeLessThan(1e-4);
      expect(distance(back.velocity, v0)).toBeLessThan(1e-7);
    }
  });

  it('多圈传播：100.25 个周期与 0.25 个周期结果相同', () => {
    const o = periapsisState(400_000, 1_500_000, 30);
    const a = propagateKepler(o.position, o.velocity, 0.25 * o.period);
    const b = propagateKepler(o.position, o.velocity, 100.25 * o.period);
    expect(distance(a.position, b.position)).toBeLessThan(0.1);
  });

  it('双曲线轨道：飞离后速度趋近双曲线剩余速度 v∞ = √(2ε)', () => {
    const r0 = vec3(7e6, 0, 0);
    const v0 = vec3(0, 12_500, 0);
    const far = propagateKepler(r0, v0, 30 * 86_400);
    const vInfinity = Math.sqrt(2 * energyOf(r0, v0));
    expect(length(far.position)).toBeGreaterThan(1e10);
    // 活力公式：v² = v∞² + 2μ/r；30 天后与 v∞ 只差几 m/s
    expect(length(far.velocity)).toBeCloseTo(Math.sqrt(vInfinity ** 2 + (2 * MU) / length(far.position)), 6);
    expect(length(far.velocity) - vInfinity).toBeGreaterThan(0);
    expect(length(far.velocity) - vInfinity).toBeLessThan(5);
  });

  it('退化输入不产生 NaN', () => {
    const r0 = vec3(7e6, 0, 0);
    const v0 = vec3(0, 7500, 0);
    expect(propagateKepler(r0, v0, 0).position).toBe(r0);
    expect(propagateKepler(r0, v0, NaN).position).toBe(r0);
    expect(propagateKepler(vec3(0, 0, 0), v0, 100).velocity).toBe(v0);
    // 径向轨道（角动量为零）：数值仍然有限
    const radial = propagateKepler(vec3(8e6, 0, 0), vec3(1000, 0, 0), 60);
    expect(Number.isFinite(radial.position.x + radial.velocity.x)).toBe(true);
    expect(radial.position.x).toBeGreaterThan(8e6);
  });
});

describe('数值误差标准：RK4（0.02 s）对比二体解析解', () => {
  const twoBody: AccelerationFn = (_t, r, _v, out) => {
    const d = Math.hypot(r.x, r.y, r.z);
    const k = -MU / (d * d * d);
    out.x = r.x * k;
    out.y = r.y * k;
    out.z = r.z * k;
  };

  const integrate = (r0: Vec3, v0: Vec3, duration: number) => {
    const r: MutableVec3 = { ...r0 };
    const v: MutableVec3 = { ...v0 };
    const rk4 = new Rk4Integrator();
    const dt = 0.02;
    const steps = Math.round(duration / dt);
    for (let i = 0; i < steps; i++) rk4.step(r, v, i * dt, dt, twoBody);
    return { position: vec3(r.x, r.y, r.z), velocity: vec3(v.x, v.y, v.z), elapsed: steps * dt };
  };

  it.each([
    ['圆轨道 200 km', 200_000, 200_000, 51.6],
    ['椭圆轨道 300 × 800 km', 300_000, 800_000, 28.5],
  ])('近地轨道（%s）：1 圈与 10 圈的位置误差、能量、角动量、拱点', (_name, hp, ha, inc) => {
    const o = periapsisState(hp, ha, inc);
    const e0 = energyOf(o.position, o.velocity);
    const h0 = length(cross(o.position, o.velocity));

    const one = integrate(o.position, o.velocity, o.period);
    const exactOne = propagateKepler(o.position, o.velocity, one.elapsed);
    expect(distance(one.position, exactOne.position)).toBeLessThan(TWO_BODY_ACCURACY.leoPositionErrorOneOrbit);
    expect(Math.abs(energyOf(one.position, one.velocity) - e0) / Math.abs(e0)).toBeLessThan(TWO_BODY_ACCURACY.energyDriftPerOrbit);
    expect(Math.abs(length(cross(one.position, one.velocity)) - h0) / h0).toBeLessThan(TWO_BODY_ACCURACY.angularMomentumDriftPerOrbit);

    const ten = integrate(o.position, o.velocity, 10 * o.period);
    const exactTen = propagateKepler(o.position, o.velocity, ten.elapsed);
    expect(distance(ten.position, exactTen.position)).toBeLessThan(TWO_BODY_ACCURACY.leoPositionErrorTenOrbits);
    const el = elementsFromState(ten.position, ten.velocity);
    expect(Math.abs(el.periapsisRadius - o.rp)).toBeLessThan(TWO_BODY_ACCURACY.leoApsisDriftTenOrbits);
    expect(Math.abs(el.apoapsisRadius - o.ra)).toBeLessThan(TWO_BODY_ACCURACY.leoApsisDriftTenOrbits);
  });

  it('地球同步转移轨道：1 圈的位置误差与能量漂移', () => {
    const o = periapsisState(200_000, 35_786_000, 28.5);
    const e0 = energyOf(o.position, o.velocity);
    const one = integrate(o.position, o.velocity, o.period);
    const exact = propagateKepler(o.position, o.velocity, one.elapsed);
    expect(distance(one.position, exact.position)).toBeLessThan(TWO_BODY_ACCURACY.gtoPositionErrorOneOrbit);
    expect(Math.abs(energyOf(one.position, one.velocity) - e0) / Math.abs(e0)).toBeLessThan(TWO_BODY_ACCURACY.energyDriftPerOrbit);
  });
});

describe('轨道曲线采样', () => {
  const radiusAt = (points: Float64Array, i: number): number => Math.hypot(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
  const R = EARTH.RADIUS;

  it('闭合椭圆：首尾重合，所有点满足轨道方程并位于轨道面内', () => {
    const o = periapsisState(300_000, 20_000_000, 40);
    const el = elementsFromState(o.position, o.velocity);
    const { points, count, closed } = sampleConic(el, 180, R, Infinity);
    expect(closed).toBe(true);
    expect(count).toBe(181);
    const h = cross(o.position, o.velocity);
    let minR = Infinity;
    let maxR = 0;
    for (let i = 0; i < count; i++) {
      const point = vec3(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
      const r = length(point);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      // 位于轨道面内
      expect(Math.abs(dot(point, h)) / (r * length(h))).toBeLessThan(1e-12);
      // 能量守恒给出的活力公式在每个点成立：到两焦点距离之和 = 2a
      const focus2 = scale(positionAtTrueAnomaly(el, perifocalBasis(el), 0), -(2 * el.semiMajorAxis * el.eccentricity) / o.rp);
      expect(r + distance(point, focus2)).toBeCloseTo(2 * el.semiMajorAxis, 2);
    }
    expect(minR).toBeCloseTo(o.rp, 3);
    expect(maxR).toBeCloseTo(o.ra, 2);
    expect(distance(vec3(points[0]!, points[1]!, points[2]!), o.position)).toBeLessThan(1e-3);
    expect(radiusAt(points, 0)).toBeCloseTo(radiusAt(points, count - 1), 6);
  });

  it('亚轨道：只画地面以上经过远地点的弧段，两端落在地面上', () => {
    // 远地点 300 km、近地点在地下
    const ra = R + 300_000;
    const el = elementsFromState(vec3(ra, 0, 0), vec3(0, 5_000, 2_000));
    expect(el.periapsisRadius).toBeLessThan(R);
    const { points, count, closed } = sampleConic(el, 120, R, Infinity);
    expect(closed).toBe(false);
    expect(radiusAt(points, 0)).toBeCloseTo(R, 2);
    expect(radiusAt(points, count - 1)).toBeCloseTo(R, 2);
    let maxR = 0;
    for (let i = 0; i < count; i++) {
      expect(radiusAt(points, i)).toBeGreaterThanOrEqual(R - 1e-3);
      maxR = Math.max(maxR, radiusAt(points, i));
    }
    expect(maxR).toBeCloseTo(ra, 0);
  });

  it('双曲线：从近地点两侧延伸到最大距离；近地点在地下时只画飞离的一支', () => {
    const el = elementsFromState(vec3(7e6, 0, 0), vec3(0, 12_500, 0));
    const limit = 30 * R;
    const open = sampleConic(el, 100, R, limit);
    expect(open.closed).toBe(false);
    expect(radiusAt(open.points, 0)).toBeCloseTo(limit, 0);
    expect(radiusAt(open.points, open.count - 1)).toBeCloseTo(limit, 0);
    let minR = Infinity;
    for (let i = 0; i < open.count; i++) minR = Math.min(minR, radiusAt(open.points, i));
    expect(minR).toBeCloseTo(el.periapsisRadius, -2);

    const grazing = elementsFromState(vec3(R + 100_000, 0, 0), vec3(9_000, 9_000, 0));
    expect(grazing.kind).toBe('hyperbolic');
    expect(grazing.periapsisRadius).toBeLessThan(R);
    const branch = sampleConic(grazing, 100, R, limit);
    expect(radiusAt(branch.points, 0)).toBeCloseTo(R, 0);
    for (let i = 1; i < branch.count; i++) expect(radiusAt(branch.points, i)).toBeGreaterThan(radiusAt(branch.points, i - 1));
  });

  it('抛物线与极扁椭圆被最大距离截断；没有可画部分时返回空', () => {
    const parabola = elementsFromState(vec3(7e6, 0, 0), vec3(0, escapeSpeed(7e6), 0));
    const sampled = sampleConic(parabola, 60, R, 20 * R);
    expect(sampled.count).toBe(61);
    expect(radiusAt(sampled.points, 0)).toBeCloseTo(20 * R, -1);

    const o = periapsisState(300_000, 400_000_000, 10);
    const clipped = sampleConic(elementsFromState(o.position, o.velocity), 60, R, 50 * R);
    expect(clipped.closed).toBe(false);
    for (let i = 0; i < clipped.count; i++) expect(radiusAt(clipped.points, i)).toBeLessThanOrEqual(50 * R + 1);

    // 整条轨道都在地面以下（例如发射台上的状态几乎如此）或都在最大距离之外
    const pad = elementsFromState(vec3(R, 0, 0), vec3(0, 400, 0));
    expect(sampleConic(pad, 60, R + 1, Infinity).count).toBe(0);
    expect(sampleConic(elementsFromState(o.position, o.velocity), 60, R, R).count).toBe(0);
  });
});
