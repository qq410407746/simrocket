/**
 * 气动力模型：阻力与升力。
 *
 * 气动力在机体轴上分解为两个分量（α 为迎角：箭体纵轴与相对来流方向的夹角，0…180°）：
 *
 *   轴向力  F_A = q · C_A(M)·A_ref · cos α          沿箭体纵轴，阻碍沿轴向的运动
 *   法向力  F_N = q · C_N·A_lat · k(α) · sin α       垂直于纵轴，阻碍横向的运动
 *
 *  - C_A(M) = C_d0 × 马赫数修正曲线，A_ref 为最大横截面积；
 *  - C_N ≈ 1.2（亚临界雷诺数圆柱的横流阻力系数），A_lat 为侧向投影面积（直径 × 长度）；
 *  - k(α)：细长体取 1；钝头体取 sin²α——球冠形防热大底在小迎角下的法向力很小
 *    （压力合力几乎通过曲率中心），只有接近横向来流时才达到横流阻力的量级。
 *
 * 把这两个力投影到来流方向与其垂直方向，就得到阻力与升力：
 *
 *   阻力  D = F_A·cos α + F_N·sin α = q·(C_A·A_ref·cos²α + C_N·A_lat·k·sin²α)
 *   升力  L = F_N·cos α − F_A·sin α = q·sin α·cos α·(C_N·A_lat·k − C_A·A_ref)
 *
 * 升力位于"纵轴与来流"所在的平面内，正值指向头部相对速度方向偏向的那一侧。
 *  - 细长箭体（C_N·A_lat ≫ C_A·A_ref）：头部朝前、带迎角飞行时升力指向头部偏向的一侧，像一块升力很差的机翼；
 *  - 钝头返回舱大底朝前（α ≈ 160°）：轴向力占主导，升力同样指向头部（舱顶）偏向的一侧，
 *    升阻比约 0.3——与真实返回舱以配平迎角飞行时的数值相当。零迎角（α = 0 或 180°）时没有升力。
 *
 * 马赫数修正曲线是典型外形的工程经验曲线（不是某一具体型号的风洞数据）：
 *  - 'slender'：细长运载火箭。以亚声速值为基准；跨声速（M ≈ 1.05–1.2）出现阻力峰，
 *    约为亚声速的 1.9 倍；高超声速回落到约 0.75 倍。
 *  - 'blunt'：钝头返回舱。以高超声速值为基准（牛顿流理论下近似为常数）；
 *    亚声速约为其 0.62 倍。
 *
 * 限制（如实说明）：
 *  - 没有气动力矩：姿态是简化的运动学模型，飞行器不会自己配平到某个迎角，也不会气动失稳；
 *    迎角完全由玩家（或自动指向）给出的姿态决定。
 *  - 不区分"头部朝前"与"尾部朝前"的轴向阻力系数（cos²α 对 α 与 180°−α 相同）。
 *  - 不含稀薄气体效应、底部阻力随发动机工作状态的变化、雷诺数效应。
 */
export type DragShape = 'slender' | 'blunt';

/** 圆柱横流阻力系数。 */
export const CROSS_FLOW_DRAG_COEFFICIENT = 1.2;

/** [马赫数, 相对基准值的倍数]，按马赫数升序。 */
const MACH_CURVES: Record<DragShape, readonly (readonly [number, number])[]> = {
  slender: [
    [0, 1.0],
    [0.6, 1.0],
    [0.8, 1.15],
    [0.95, 1.6],
    [1.05, 1.9],
    [1.2, 1.85],
    [1.5, 1.55],
    [2.0, 1.3],
    [3.0, 1.05],
    [5.0, 0.85],
    [8.0, 0.78],
    [20.0, 0.75],
  ],
  blunt: [
    [0, 0.62],
    [0.5, 0.64],
    [0.8, 0.72],
    [1.0, 0.88],
    [1.2, 1.0],
    [1.5, 1.06],
    [2.0, 1.08],
    [3.0, 1.05],
    [5.0, 1.0],
    [20.0, 1.0],
  ],
};

/** 马赫数修正系数（分段线性插值；超出表格范围时取端点值）。 */
export const dragMachFactor = (shape: DragShape, mach: number): number => {
  const curve = MACH_CURVES[shape];
  const first = curve[0] as readonly [number, number];
  if (!(mach > first[0])) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const b = curve[i] as readonly [number, number];
    if (mach <= b[0]) {
      const a = curve[i - 1] as readonly [number, number];
      return a[1] + ((b[1] - a[1]) * (mach - a[0])) / (b[0] - a[0]);
    }
  }
  return (curve[curve.length - 1] as readonly [number, number])[1];
};

/** 当前构型的气动特性。 */
export interface AeroProperties {
  /** 参考面积（最大横截面积）[m²]。 */
  readonly referenceArea: number;
  /** 基准轴向阻力系数（'slender' 为亚声速值，'blunt' 为高超声速值）。 */
  readonly baseDragCoefficient: number;
  readonly shape: DragShape;
  /** 侧向投影面积 [m²]。 */
  readonly lateralArea: number;
}

/** 轴向力面积 C_A(M)·A_ref [m²]。 */
export const axialForceArea = (aero: AeroProperties, mach: number): number =>
  aero.baseDragCoefficient * dragMachFactor(aero.shape, mach) * aero.referenceArea;

/**
 * 法向力面积 C_N·A_lat·k(α) [m²]：法向力 F_N = q × 该面积 × sin α。
 * @param sinSquared sin²α
 */
export const normalForceArea = (aero: AeroProperties, sinSquared: number): number =>
  CROSS_FLOW_DRAG_COEFFICIENT * aero.lateralArea * (aero.shape === 'blunt' ? sinSquared : 1);

/**
 * 有效阻力面积 C_d·A [m²]：阻力 D = q × 该面积。
 * @param cosAlpha 迎角余弦：箭体纵轴单位向量与相对来流速度单位向量的点积
 */
export const dragArea = (aero: AeroProperties, mach: number, cosAlpha: number): number => {
  const cos2 = Math.min(1, cosAlpha * cosAlpha);
  const sin2 = 1 - cos2;
  return axialForceArea(aero, mach) * cos2 + normalForceArea(aero, sin2) * sin2;
};

/**
 * 有效升力面积 C_L·A [m²]：升力 L = q × 该面积。
 * 正值表示升力指向头部相对速度方向偏向的一侧（在纵轴与来流构成的平面内）。
 */
export const liftArea = (aero: AeroProperties, mach: number, cosAlpha: number): number => {
  const cos = Math.max(-1, Math.min(1, cosAlpha));
  const sin2 = 1 - cos * cos;
  return Math.sqrt(sin2) * cos * (normalForceArea(aero, sin2) - axialForceArea(aero, mach));
};

/** 动压 q = ½·ρ·v² [Pa]。 */
export const dynamicPressure = (density: number, speed: number): number => 0.5 * density * speed * speed;
