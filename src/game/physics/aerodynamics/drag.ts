/**
 * 气动阻力模型。
 *
 * 基础公式：F_d = ½·ρ·v²·C_d·A = q·(C_d·A)，方向与相对大气速度相反。
 *   v 必须是相对于（随地球共转的）大气的速度，见 frames.airRelativeVelocityEci。
 *
 * 本模块提供"有效阻力面积" C_d·A [m²] 随马赫数与迎角的变化：
 *
 *   C_d·A = C_A(M)·A_ref·cos²α + C_cross·A_lat·sin²α
 *
 *  - 轴向项：C_A(M) = C_d0 × 马赫数修正曲线，A_ref 为最大横截面积。
 *  - 横流项：箭体侧向来流时按圆柱横流阻力估算，C_cross ≈ 1.2（亚临界雷诺数圆柱），
 *    A_lat 为侧向投影面积（直径 × 长度）。
 *  - α 为迎角：箭体纵轴与相对来流方向的夹角。
 *
 * 马赫数修正曲线是典型外形的工程经验曲线（不是某一具体型号的风洞数据）：
 *  - 'slender'：细长运载火箭。以亚声速值为基准；跨声速（M ≈ 1.05–1.2）出现阻力峰，
 *    约为亚声速的 1.9 倍；高超声速回落到约 0.75 倍。
 *  - 'blunt'：钝头返回舱。以高超声速值为基准（牛顿流理论下近似为常数）；
 *    亚声速约为其 0.62 倍。
 *
 * 限制（如实说明）：
 *  - 只有阻力，没有升力与气动力矩（阶段四加入升力；姿态为简化模型，不受气动力矩影响）。
 *  - 不区分"头部朝前"与"尾部朝前"（cos²α 对 α 与 180°−α 相同）。
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

/**
 * 有效阻力面积 C_d·A [m²]。
 * @param cosAlpha 迎角余弦：箭体纵轴单位向量与相对来流速度单位向量的点积
 */
export const dragArea = (aero: AeroProperties, mach: number, cosAlpha: number): number => {
  const cos2 = Math.min(1, cosAlpha * cosAlpha);
  const axial = aero.baseDragCoefficient * dragMachFactor(aero.shape, mach) * aero.referenceArea;
  return axial * cos2 + CROSS_FLOW_DRAG_COEFFICIENT * aero.lateralArea * (1 - cos2);
};

/** 动压 q = ½·ρ·v² [Pa]。 */
export const dynamicPressure = (density: number, speed: number): number => 0.5 * density * speed * speed;
