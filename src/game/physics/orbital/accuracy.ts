/**
 * 二体问题的数值误差标准（预先定义，由 orbital.test.ts 验证）。
 *
 * 条件：无推力、无阻力、质点引力；RK4 固定步长 0.02 s（游戏实际使用的步长）；
 * 参照物是通用变量开普勒方程的解析解（kepler.ts）。
 *
 * 实测值比这些上限小 2–3 个数量级（近地轨道一圈约 10⁻⁶ m，10 圈约 10⁻⁵ m，
 * GTO 一圈约 10⁻⁴ m，能量相对漂移约 10⁻¹³），上限留出余量以容纳不同平台的浮点舍入差异。
 */
export const TWO_BODY_ACCURACY = {
  /** 近地轨道飞行 1 圈后，位置相对解析解的偏差上限 [m]。 */
  leoPositionErrorOneOrbit: 1e-3,
  /** 近地轨道飞行 10 圈后的位置偏差上限 [m]。 */
  leoPositionErrorTenOrbits: 1e-2,
  /** 地球同步转移轨道（200 km × 35786 km）飞行 1 圈后的位置偏差上限 [m]。 */
  gtoPositionErrorOneOrbit: 1e-2,
  /** 每圈比机械能的相对漂移上限。 */
  energyDriftPerOrbit: 1e-11,
  /** 每圈比角动量的相对漂移上限。 */
  angularMomentumDriftPerOrbit: 1e-11,
  /** 近地轨道 10 圈后近地点/远地点高度的漂移上限 [m]。 */
  leoApsisDriftTenOrbits: 1e-3,
} as const;
