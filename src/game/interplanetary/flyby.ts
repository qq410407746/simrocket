/**
 * 借力飞越（引力弹弓）的拼接圆锥模型。
 *
 * 在行星引力范围里，飞船沿双曲线飞过，相对行星的剩余速度 v∞ 大小不变、方向转过 δ：
 *   单侧偏转 asin(1/e)，e = 1 + rₚ·v∞²/μ，总偏转 δ = asin(1/e₁) + asin(1/e₂)
 * 进入与离开的 v∞ 由前后两段兰伯特轨道决定，一般不完全相等：
 *   1. 先求近星点半径 rₚ，使两侧偏转之和等于所需的 δ；
 *   2. 在近星点点一次火，把速度从 √(v_in² + 2μ/rₚ) 变成 √(v_out² + 2μ/rₚ)（"有动力飞越"）；
 *   3. 如果所需 rₚ 小于允许的最低飞越半径，就按最低半径飞，剩下的偏转用额外的点火补上
 *      （近似为把离开速度转过剩余角度：2·v_out·sin(Δδ/2)），并标记为"太低"。
 * 只用于规划：不考虑飞越时的大气、辐射带、行星自转与精确的 B 平面瞄准。
 */
import { type Vec3, angleBetween, length } from '../physics/math/vec3';
import { type PlanetId, findPlanet } from './planets';

/**
 * 最低飞越半径（从行星中心量起）。本游戏的约定：
 * 类地行星在表面以上 200–300 km；木星 4 倍半径（辐射带；旅行者 1 号约 4.9 倍）；
 * 土星 2.3 倍（主环外缘）；天王星 2.1 倍（环外）；海王星 1.1 倍（旅行者 2 号约 1.2 倍）。
 */
export const MIN_FLYBY_RADIUS: Record<PlanetId, number> = {
  mercury: findPlanet('mercury').equatorialRadius + 200_000,
  venus: findPlanet('venus').equatorialRadius + 300_000,
  earth: findPlanet('earth').equatorialRadius + 300_000,
  mars: findPlanet('mars').equatorialRadius + 200_000,
  jupiter: 4 * findPlanet('jupiter').equatorialRadius,
  saturn: 2.3 * findPlanet('saturn').equatorialRadius,
  uranus: 2.1 * findPlanet('uranus').equatorialRadius,
  neptune: 1.1 * findPlanet('neptune').equatorialRadius,
};

export interface FlybyResult {
  readonly vInfIn: number;
  readonly vInfOut: number;
  /** 需要的偏转角 [rad]。 */
  readonly turnAngle: number;
  /** 近星点半径 [m]。 */
  readonly periapsisRadius: number;
  /** 近星点高度 [m]。 */
  readonly altitude: number;
  /** 近星点点火 [m/s]（进出 v∞ 不等时）。 */
  readonly poweredDeltaV: number;
  /** 飞得不够低、偏转不够时补的点火 [m/s]。 */
  readonly turnDeficitDeltaV: number;
  readonly deltaV: number;
  /** 所需近星点不低于最低飞越半径。 */
  readonly feasible: boolean;
}

const halfTurn = (rp: number, vInf: number, mu: number) => Math.asin(1 / (1 + (rp * vInf * vInf) / mu));

/** 很远的飞越（几乎不偏转）时 rₚ 的上限 [m]，避免数值发散。 */
const MAX_PERIAPSIS = 1e12;

export const flyby = (body: PlanetId, vIn: Vec3, vOut: Vec3): FlybyResult => {
  const planet = findPlanet(body);
  const mu = planet.mu;
  const rMin = MIN_FLYBY_RADIUS[body];
  const a = length(vIn);
  const b = length(vOut);
  const delta = angleBetween(vIn, vOut);
  const turnAt = (rp: number) => halfTurn(rp, a, mu) + halfTurn(rp, b, mu);

  let rp: number;
  let deficit = 0;
  const maxTurn = turnAt(rMin);
  if (delta >= maxTurn) {
    rp = rMin;
    deficit = 2 * b * Math.sin((delta - maxTurn) / 2);
  } else if (turnAt(MAX_PERIAPSIS) >= delta) {
    rp = MAX_PERIAPSIS;
  } else {
    // 偏转角随 rₚ 单调减小：在对数尺度上二分
    let lo = Math.log(rMin);
    let hi = Math.log(MAX_PERIAPSIS);
    // ln rₚ 的区间缩到 1e-10（rₚ 相对误差 1e-10）即停，约 37 次；原来固定 80 次
    for (let i = 0; i < 80 && hi - lo > 1e-10; i++) {
      const mid = (lo + hi) / 2;
      if (turnAt(Math.exp(mid)) > delta) lo = mid;
      else hi = mid;
    }
    rp = Math.exp((lo + hi) / 2);
  }
  const powered = Math.abs(Math.sqrt(b * b + (2 * mu) / rp) - Math.sqrt(a * a + (2 * mu) / rp));
  return {
    vInfIn: a,
    vInfOut: b,
    turnAngle: delta,
    periapsisRadius: rp,
    altitude: rp - planet.equatorialRadius,
    poweredDeltaV: powered,
    turnDeficitDeltaV: deficit,
    deltaV: powered + deficit,
    feasible: deficit === 0,
  };
};
