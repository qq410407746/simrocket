/**
 * 钝头返回舱的配平迎角：由质心的横向偏移决定。
 *
 * 真实的返回舱（阿波罗、联盟、神舟）把质心布置得偏离对称轴一小段距离。再入时它不需要任何操纵，
 * 就会稳定在一个非零的迎角上（配平迎角），防热大底斜对着来流，于是产生升力（升阻比约 0.3）。
 * 升力的方向只能靠整舱绕速度方向滚转（改变倾侧角）来控制。
 *
 * 【模型】牛顿流近似下的球冠形防热大底：
 *   表面压力 p = K·(û·n̂)²，方向沿当地法线、指向球心（û 为来流的来向，n̂ 为外法线）。
 *   每个面元的压力都通过球心，所以合力必然通过球心（曲率中心）。
 *   球冠半角 θ_c（sin θ_c = R_b / R_n）、迎角 α（大底轴线与来向的夹角）且整个球冠迎风（α + θ_c ≤ 90°）时，
 *   对球冠积分得到合力偏离大底轴线的角度 δ：
 *
 *       tan δ = 2·sin α·cos α·sin²θ_c / ( 2·cos²α·(1 + cos²θ_c) + sin²α·sin²θ_c )
 *
 *   升阻比 L/D = tan(α − δ)。大底越平（θ_c 越小），δ 越小：合力几乎沿轴线。
 *
 * 【配平条件】合力对质心没有力矩 ⇔ 合力同时通过质心：
 *
 *       tan δ(α_trim) = z_cg / (R_n − x_cg)
 *
 *   x_cg 为质心到大底顶点的轴向距离，z_cg 为质心偏离轴线的距离。升力指向质心偏移的那一侧。
 *
 * 【适用范围——如实说明】
 *  - 只计入球冠上的压力：迎角不超过锥形侧壁的半锥角时侧壁处于背风区，这个近似成立；
 *  - 牛顿流只适用于高超声速；跨声速、亚声速的配平迎角不同（这时降落伞已经接管）；
 *  - 本游戏的姿态是运动学模型，没有气动力矩：这里只用来算出"配平迎角是多少"，
 *    由"配平保持"指向模式把舱体保持在这个迎角上（见 physics/attitude/pointing.ts），
 *    而不是由力矩自然收敛。振荡与阻尼没有模拟。
 *  - 飞行中的气动力仍由 drag.ts 的轴向力/法向力系数模型给出，与这里的牛顿流合力并不完全相同
 *    （20° 迎角时两者的升阻比分别约为 0.30 与 0.32）。
 */

export interface TrimGeometry {
  /** 防热大底球冠的曲率半径 R_n [m]。 */
  readonly noseRadius: number;
  /** 球冠边缘的半径 R_b [m]（返回舱最大半径）。 */
  readonly baseRadius: number;
  /** 质心到大底顶点的轴向距离 x_cg [m]。 */
  readonly centerOfMassHeight: number;
  /** 质心偏离对称轴的距离 z_cg [m]。 */
  readonly centerOfMassOffset: number;
}

/** 球冠半角 θ_c [rad]：sin θ_c = R_b / R_n。 */
export const capHalfAngle = (noseRadius: number, baseRadius: number): number =>
  noseRadius > 0 ? Math.asin(Math.max(0, Math.min(1, baseRadius / noseRadius))) : Math.PI / 2;

/**
 * 牛顿流下球冠的合力偏离大底轴线的角度 δ [rad]。
 * @param alpha 大底轴线与来流来向的夹角 [rad]，要求 0 ≤ α ≤ 90° − θ_c
 * @param halfAngle 球冠半角 θ_c [rad]
 */
export const newtonianCapForceAngle = (alpha: number, halfAngle: number): number => {
  const sinA = Math.sin(alpha);
  const cosA = Math.cos(alpha);
  const s2 = Math.sin(halfAngle) ** 2;
  const c2 = 1 - s2;
  return Math.atan2(2 * sinA * cosA * s2, 2 * cosA * cosA * (1 + c2) + sinA * sinA * s2);
};

/** 牛顿流下球冠的升阻比 tan(α − δ)。 */
export const newtonianCapLiftToDrag = (alpha: number, halfAngle: number): number =>
  Math.tan(alpha - newtonianCapForceAngle(alpha, halfAngle));

/** 模型适用的最大迎角 [rad]：整个球冠仍然迎风。 */
export const maxTrimAngle = (halfAngle: number): number => Math.max(0, Math.PI / 2 - halfAngle);

/**
 * 配平迎角 [rad]：大底轴线偏离来流方向的角度。质心在轴线上时为 0（弹道式再入，没有升力）。
 * 质心偏移大到超出模型适用范围时，返回适用范围的上限。
 */
export const trimAngleOfAttack = (geometry: TrimGeometry): number => {
  const arm = geometry.noseRadius - geometry.centerOfMassHeight;
  if (!(geometry.centerOfMassOffset > 0) || !(arm > 0)) return 0;
  const halfAngle = capHalfAngle(geometry.noseRadius, geometry.baseRadius);
  const target = Math.atan2(geometry.centerOfMassOffset, arm);
  // δ(α) 在适用范围内单调递增：二分求解 δ(α) = target
  let lo = 0;
  let hi = maxTrimAngle(halfAngle);
  if (newtonianCapForceAngle(hi, halfAngle) <= target) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (newtonianCapForceAngle(mid, halfAngle) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
