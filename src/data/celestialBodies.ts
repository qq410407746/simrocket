/**
 * 知识库用的天体参考数据（地球、月球、火星、太阳）。
 *
 * 只给知识库页面显示与推导用，模拟器不读这里：游戏的地球参数仍以 `game/physics/constants.ts` 为唯一来源，
 * 地球条目里的引力参数、半径、自转角速度直接取自那里，保证知识库与游戏一致。
 * 月球、火星目前不在模拟中。
 *
 * 数据来源：英文维基百科 Earth / Moon / Mars / Standard gravitational parameter / Escape velocity 条目的信息框与表格
 * （2026-11-21 查阅；这些条目再引用 NASA NSSDC 行星概况、IERS、JPL 等资料）。
 */
import { ASTRO, EARTH } from '@/game/physics/constants';
import { circularSpeed, escapeSpeed } from '@/game/physics/orbital/elements';

export type BodyId = 'earth' | 'moon' | 'mars';

export interface CelestialBody {
  readonly id: BodyId;
  readonly nameZh: string;
  readonly name: string;
  /** 标准引力参数 μ = GM [m³/s²]。 */
  readonly mu: number;
  /** 质量 [kg]。 */
  readonly mass: number;
  /** 平均半径 [m]。 */
  readonly meanRadius: number;
  /** 赤道半径 [m]。 */
  readonly equatorialRadius: number;
  /** 平均密度 [kg/m³]。 */
  readonly density: number;
  /** 资料给出的表面重力 [m/s²]。 */
  readonly surfaceGravity: number;
  /** 资料给出的逃逸速度 [m/s]。 */
  readonly escapeVelocity: number;
  /** 恒星自转周期 [s]。 */
  readonly siderealDay: number;
  /** 太阳日（一昼夜）[s]。 */
  readonly solarDay: number;
  /** 自转轴倾角 [°]（相对自身公转轨道面）。 */
  readonly axialTilt: number;
  /** 绕中心天体公转的半长轴 [m]（地球、火星绕太阳；月球绕地球）。 */
  readonly semiMajorAxis: number;
  readonly eccentricity: number;
  /** 公转（恒星）周期 [s]。 */
  readonly orbitalPeriod: number;
  /** 表面平均气压 [Pa]。 */
  readonly surfacePressure: number;
}

const DAY = ASTRO.SECONDS_PER_DAY;

/** 万有引力常数 G [m³/(kg·s²)]（CODATA 2018）。只用于知识库的说明，模拟器全部使用 μ。 */
export const GRAVITATIONAL_CONSTANT = 6.6743e-11;

/** 太阳的标准引力参数 [m³/s²]。 */
export const SUN_MU = 1.32712440042e20;

export const EARTH_BODY: CelestialBody = {
  id: 'earth',
  nameZh: '地球',
  name: 'Earth',
  mu: EARTH.MU,
  mass: 5.97217e24,
  meanRadius: EARTH.RADIUS,
  equatorialRadius: EARTH.EQUATORIAL_RADIUS,
  density: 5513,
  surfaceGravity: 9.80665,
  escapeVelocity: 11_186,
  siderealDay: (2 * Math.PI) / EARTH.ROTATION_RATE,
  solarDay: DAY,
  axialTilt: 23.4392811,
  semiMajorAxis: 149_598_023e3,
  eccentricity: 0.0167086,
  orbitalPeriod: 365.256363004 * DAY,
  surfacePressure: 101_325,
};

export const MOON_BODY: CelestialBody = {
  id: 'moon',
  nameZh: '月球',
  name: 'Moon',
  mu: 4.902800118e12,
  mass: 7.346e22,
  meanRadius: 1_737_400,
  equatorialRadius: 1_738_100,
  density: 3344,
  surfaceGravity: 1.622,
  escapeVelocity: 2380,
  siderealDay: 27.321661 * DAY,
  solarDay: 29.530589 * DAY,
  axialTilt: 6.687,
  semiMajorAxis: 384_399e3,
  eccentricity: 0.0549,
  orbitalPeriod: 27.321661 * DAY,
  // 白天约 1e-7 Pa，夜间约 1e-10 Pa：几乎是真空
  surfacePressure: 1e-7,
};

export const MARS_BODY: CelestialBody = {
  id: 'mars',
  nameZh: '火星',
  name: 'Mars',
  mu: 4.282837e13,
  mass: 6.4171e23,
  meanRadius: 3_389_500,
  equatorialRadius: 3_396_200,
  density: 3933.5,
  surfaceGravity: 3.72076,
  escapeVelocity: 5027,
  siderealDay: 1.025957 * DAY,
  solarDay: 1.02749125 * DAY,
  axialTilt: 25.19,
  semiMajorAxis: 227_939_366e3,
  eccentricity: 0.0934,
  orbitalPeriod: 686.98 * DAY,
  surfacePressure: 636,
};

export const CELESTIAL_BODIES: readonly CelestialBody[] = [EARTH_BODY, MOON_BODY, MARS_BODY];

export const findBody = (id: BodyId): CelestialBody => CELESTIAL_BODIES.find((b) => b.id === id) ?? EARTH_BODY;

/** 月球的轨道倾角（相对黄道）[°] 与会合周期（朔望月）[s]。 */
export const MOON_ORBIT = { inclinationToEcliptic: 5.145, synodicMonth: 29.530589 * DAY } as const;

/** 火星：会合周期（两次冲日的间隔，也是地火发射窗口的间隔）[s]、轨道倾角（相对黄道）[°]。 */
export const MARS_ORBIT = { synodicPeriod: 779.94 * DAY, inclinationToEcliptic: 1.85 } as const;

/** 大气成分（体积分数，%），按资料原样列出主要成分。 */
export const ATMOSPHERE_COMPOSITION: Record<BodyId, readonly (readonly [zh: string, en: string, percent: number])[]> = {
  earth: [
    ['氮气', 'Nitrogen', 78.084],
    ['氧气', 'Oxygen', 20.946],
    ['氩', 'Argon', 0.934],
    ['二氧化碳', 'Carbon dioxide', 0.043],
  ],
  moon: [],
  mars: [
    ['二氧化碳', 'Carbon dioxide', 95.97],
    ['氩', 'Argon', 1.93],
    ['氮气', 'Nitrogen', 1.89],
    ['氧气', 'Oxygen', 0.146],
    ['一氧化碳', 'Carbon monoxide', 0.0557],
  ],
};

/** 由 μ 与平均半径推导的量：表面重力、贴地圆轨道速度（第一宇宙速度）、逃逸速度（第二宇宙速度）。 */
export const derivedSurface = (body: CelestialBody) => ({
  gravity: body.mu / body.meanRadius ** 2,
  circularSpeed: circularSpeed(body.meanRadius, body.mu),
  escapeSpeed: escapeSpeed(body.meanRadius, body.mu),
  /** 赤道自转线速度 [m/s]。 */
  equatorSpeed: (2 * Math.PI * body.equatorialRadius) / body.siderealDay,
});

/** 圆轨道：高度 h 处的速度、周期、逃逸速度。 */
export const circularOrbitAt = (body: CelestialBody, altitude: number) => {
  const r = body.meanRadius + altitude;
  return {
    radius: r,
    speed: circularSpeed(r, body.mu),
    period: 2 * Math.PI * Math.sqrt(r ** 3 / body.mu),
    escapeSpeed: escapeSpeed(r, body.mu),
    gravity: body.mu / r ** 2,
  };
};

/**
 * 三个宇宙速度（地球表面，按平均半径、忽略大气与自转）。
 * 第三宇宙速度：在地球公转速度方向上出发，日心逃逸所需的剩余速度 v∞ = √(2μ☉/r) − v地，
 * 再叠加脱离地球引力所需的能量：v₃ = √(v∞² + v₂²)。地球公转按圆轨道近似。
 */
export const cosmicVelocities = () => {
  const r = EARTH_BODY.meanRadius;
  const first = circularSpeed(r, EARTH.MU);
  const second = escapeSpeed(r, EARTH.MU);
  const earthOrbitSpeed = circularSpeed(EARTH_BODY.semiMajorAxis, SUN_MU);
  const solarEscapeAtEarth = escapeSpeed(EARTH_BODY.semiMajorAxis, SUN_MU);
  const excess = solarEscapeAtEarth - earthOrbitSpeed;
  return { first, second, third: Math.hypot(excess, second), earthOrbitSpeed, solarEscapeAtEarth, excess };
};

/**
 * 两个圆轨道之间的霍曼转移（同一中心天体、共面）。
 * 返回出发与到达时的速度增量与转移时间（半个椭圆周期）。
 */
export const hohmann = (mu: number, r1: number, r2: number) => {
  const a = (r1 + r2) / 2;
  return {
    departure: Math.sqrt(mu * (2 / r1 - 1 / a)) - Math.sqrt(mu / r1),
    arrival: Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / a)),
    time: Math.PI * Math.sqrt(a ** 3 / mu),
  };
};

/** 停泊轨道高度 [m]：知识库里"从近地轨道出发"的估算都用这个高度。 */
export const PARKING_ORBIT_ALTITUDE = 200_000;

/**
 * 地月转移的粗略估算：只考虑地球引力，从 200 km 圆轨道霍曼转移到月球轨道半径。
 * 真实的地月转移（TLI）还受月球引力影响，这里只给数量级。
 */
export const earthMoonTransfer = () => {
  const r1 = EARTH_BODY.meanRadius + PARKING_ORBIT_ALTITUDE;
  return hohmann(EARTH.MU, r1, MOON_BODY.semiMajorAxis);
};

/**
 * 地火转移的粗略估算：两颗行星按共面圆轨道（半长轴）处理，日心霍曼转移；
 * 从 200 km 地球停泊轨道出发所需的 Δv = √(v∞² + v逃²) − v圆。
 */
export const earthMarsTransfer = () => {
  const helio = hohmann(SUN_MU, EARTH_BODY.semiMajorAxis, MARS_BODY.semiMajorAxis);
  const leo = circularOrbitAt(EARTH_BODY, PARKING_ORBIT_ALTITUDE);
  const fromLeo = Math.sqrt(helio.departure ** 2 + leo.escapeSpeed ** 2) - leo.speed;
  return { ...helio, fromLeo };
};
