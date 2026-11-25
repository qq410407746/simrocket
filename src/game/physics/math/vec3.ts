/**
 * 三维向量（双精度、不可变、函数式）。
 *
 * 物理层自带的最小数学库，故意不依赖 Three.js：
 *  - Three 的 Vector3 是可变对象，容易在物理代码里产生隐蔽的别名 bug；
 *  - 物理层需要在 Web Worker 与 Node 测试环境中独立运行。
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = Object.freeze(vec3(0, 0, 0));
export const UNIT_X: Vec3 = Object.freeze(vec3(1, 0, 0));
export const UNIT_Y: Vec3 = Object.freeze(vec3(0, 1, 0));
export const UNIT_Z: Vec3 = Object.freeze(vec3(0, 0, 1));

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const negate = (a: Vec3): Vec3 => vec3(-a.x, -a.y, -a.z);

/** a + b·s */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 =>
  vec3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
/**
 * 长度与距离用 √(x² + y² + z²) 而不是 Math.hypot：hypot 为了防止中间值溢出做了缩放，在 V8 里慢好几倍，
 * 是物理步进与轨道计算里最常调用的函数之一。本项目的量级最大约 1e13 m（平方 1e26），远不会溢出（double 上限 1e308）。
 */
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const distance = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * 归一化。零向量没有方向，返回 fallback（默认 +X）而不是 NaN，
 * 以保证无效状态不会沿数据流扩散。
 */
export const normalize = (a: Vec3, fallback: Vec3 = UNIT_X): Vec3 => {
  const len = length(a);
  return len > 0 && Number.isFinite(len) ? scale(a, 1 / len) : fallback;
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** 两向量夹角 [rad]，范围 [0, π]。使用 atan2 形式，在小角度和接近 π 时都保持精度。 */
export const angleBetween = (a: Vec3, b: Vec3): number => Math.atan2(length(cross(a, b)), dot(a, b));

/** 去掉 a 在单位向量 n 方向上的分量（投影到与 n 垂直的平面）。 */
export const rejectFrom = (a: Vec3, n: Vec3): Vec3 => addScaled(a, n, -dot(a, n));

export const isFiniteVec3 = (a: Vec3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** 绕 Z 轴旋转 angle [rad]（右手定则，正角度为从 +X 转向 +Y）。 */
export const rotateZ = (a: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec3(c * a.x - s * a.y, s * a.x + c * a.y, a.z);
};
