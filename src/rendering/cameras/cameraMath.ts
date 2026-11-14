/**
 * 摄像机位姿计算（纯函数，双精度，ECI）。
 *
 * 每种模式由三个参数（方位角、仰角、距离）加上当前帧的参考点决定，
 * 输出相机位置、注视点与"上"方向。模式切换时在两个位姿之间平滑过渡。
 */
import { EARTH } from '@/game/physics/constants';
import { enuBasisAt } from '@/game/physics/frames/frames';
import {
  type Vec3,
  UNIT_X,
  UNIT_Y,
  UNIT_Z,
  add,
  addScaled,
  angleBetween,
  cross,
  length,
  normalize,
  scale,
  sub,
  vec3,
} from '@/game/physics/math/vec3';

export type CameraModeId = 'chase' | 'free' | 'pad' | 'orbit';

export interface OrbitParams {
  /** 方位角 [rad]。 */
  azimuth: number;
  /** 仰角 [rad]。 */
  elevation: number;
  /** 距离 [m]。 */
  distance: number;
}

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly up: Vec3;
}

export interface CameraContext {
  /** 注视的飞行器参考点（箭体几何中心）[m, ECI]。 */
  readonly focus: Vec3;
  /** 发射场地面点 [m, ECI]。 */
  readonly site: Vec3;
  /**
   * 仅 orbit 模式：把地球显示在画面水平方向的偏移量（−1…1，NDC），
   * 主菜单用它给左侧面板让出空间。
   */
  readonly framingOffsetX?: number;
  /** 水平半视场角的正切（tan(fov_y/2)·aspect），配合 framingOffsetX 使用。 */
  readonly tanHalfFovX?: number;
}

const DEG = Math.PI / 180;

export interface ModeLimits {
  readonly minElevation: number;
  readonly maxElevation: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export const MODE_LIMITS: Record<CameraModeId, ModeLimits> = {
  chase: { minElevation: -85 * DEG, maxElevation: 88 * DEG, minDistance: 12, maxDistance: 50_000 },
  free: { minElevation: -88 * DEG, maxElevation: 88 * DEG, minDistance: 12, maxDistance: 50_000 },
  pad: { minElevation: 0.15 * DEG, maxElevation: 70 * DEG, minDistance: 50, maxDistance: 6_000 },
  orbit: {
    minElevation: -88 * DEG,
    maxElevation: 88 * DEG,
    minDistance: EARTH.RADIUS * 1.06,
    maxDistance: EARTH.RADIUS * 40,
  },
};

/** 相机离地最小高度 [m]，防止钻入地面。 */
export const MIN_CAMERA_CLEARANCE = 1.5;

export const clampParams = (mode: CameraModeId, p: OrbitParams): OrbitParams => {
  const l = MODE_LIMITS[mode];
  return {
    azimuth: p.azimuth,
    elevation: Math.min(l.maxElevation, Math.max(l.minElevation, p.elevation)),
    distance: Math.min(l.maxDistance, Math.max(l.minDistance, p.distance)),
  };
};

/** 把位置抬到地面以上至少 clearance 米。 */
export const clampAboveGround = (p: Vec3, clearance = MIN_CAMERA_CLEARANCE): Vec3 => {
  const r = length(p);
  const minR = EARTH.RADIUS + clearance;
  if (r >= minR) return p;
  return r > 0 ? scale(p, minR / r) : vec3(minR, 0, 0);
};

/** 由方位角/仰角在给定正交基（"前"基准、"右"、"上"）中合成单位方向。 */
const directionFrom = (azimuth: number, elevation: number, ref: Vec3, side: Vec3, up: Vec3): Vec3 => {
  const ce = Math.cos(elevation);
  const a = ce * Math.cos(azimuth);
  const b = ce * Math.sin(azimuth);
  const c = Math.sin(elevation);
  return vec3(
    ref.x * a + side.x * b + up.x * c,
    ref.y * a + side.y * b + up.y * c,
    ref.z * a + side.z * b + up.z * c,
  );
};

/** 计算指定模式的相机位姿。 */
export const computeCameraPose = (mode: CameraModeId, params: OrbitParams, ctx: CameraContext): CameraPose => {
  const p = clampParams(mode, params);
  switch (mode) {
    case 'chase': {
      // 当地水平系：方位角自正北向东，仰角相对水平面；画面"上"为当地天向。
      const { east, north, up } = enuBasisAt(ctx.focus);
      const dir = directionFrom(p.azimuth, p.elevation, north, east, up);
      return { position: clampAboveGround(addScaled(ctx.focus, dir, p.distance)), target: ctx.focus, up };
    }
    case 'free': {
      // 惯性系：方位角在赤道面内自 +X 向 +Y，画面"上"为地球北极方向。不随地球自转。
      const dir = directionFrom(p.azimuth, p.elevation, UNIT_X, UNIT_Y, UNIT_Z);
      return { position: clampAboveGround(addScaled(ctx.focus, dir, p.distance)), target: ctx.focus, up: UNIT_Z };
    }
    case 'pad': {
      // 固定在发射场地面附近的跟踪摄像机：位置随地球自转，镜头始终对准飞行器。
      const { east, north, up } = enuBasisAt(ctx.site);
      const dir = directionFrom(p.azimuth, p.elevation, north, east, up);
      const position = clampAboveGround(addScaled(ctx.site, dir, p.distance));
      return { position, target: ctx.focus, up: normalize(position, up) };
    }
    case 'orbit': {
      // 以地心为中心的环绕视角（惯性系，北向上）。
      const dir = directionFrom(p.azimuth, p.elevation, UNIT_X, UNIT_Y, UNIT_Z);
      const position = scale(dir, p.distance);
      const offset = ctx.framingOffsetX ?? 0;
      if (offset === 0 || !ctx.tanHalfFovX) return { position, target: vec3(0, 0, 0), up: UNIT_Z };
      // 把注视点沿画面水平方向平移，使地心出现在 NDC x = offset 处。
      const right = normalize(cross(scale(dir, -1), UNIT_Z), UNIT_Y);
      return { position, target: scale(right, -offset * ctx.tanHalfFovX * p.distance), up: UNIT_Z };
    }
  }
};

/** 单位方向的球面插值。 */
const slerpDirection = (a: Vec3, b: Vec3, s: number): Vec3 => {
  const angle = angleBetween(a, b);
  if (angle < 1e-6) return normalize(add(scale(a, 1 - s), scale(b, s)), a);
  if (Math.PI - angle < 1e-4) {
    // 几乎反向：绕任意垂直轴走半圈。
    const axis = normalize(cross(a, Math.abs(a.z) < 0.9 ? UNIT_Z : UNIT_X));
    const perp = cross(axis, a);
    const theta = angle * s;
    return add(scale(a, Math.cos(theta)), scale(perp, Math.sin(theta)));
  }
  const sinAngle = Math.sin(angle);
  return add(scale(a, Math.sin((1 - s) * angle) / sinAngle), scale(b, Math.sin(s * angle) / sinAngle));
};

/**
 * 在两个位姿之间过渡。相对锚点（飞行器）在"方向"上做球面插值、在"距离"上做对数插值，
 * 因此从 100 m 的近景拉到 20000 km 的轨道视角时，缩放速度在观感上是均匀的。
 * 注视点与"上"方向做线性插值。
 */
export const blendPoses = (from: CameraPose, to: CameraPose, anchor: Vec3, s: number): CameraPose => {
  if (s <= 0) return from;
  if (s >= 1) return to;
  const offsetA = sub(from.position, anchor);
  const offsetB = sub(to.position, anchor);
  const distA = Math.max(length(offsetA), 1e-3);
  const distB = Math.max(length(offsetB), 1e-3);
  const dir = slerpDirection(scale(offsetA, 1 / distA), scale(offsetB, 1 / distB), s);
  const dist = Math.exp(Math.log(distA) * (1 - s) + Math.log(distB) * s);
  // 注视点同样相对锚点按对数距离过渡，避免远距离时注视点线性漂移造成的画面甩动。
  const target = add(scale(from.target, 1 - s), scale(to.target, s));
  return {
    position: clampAboveGround(addScaled(anchor, dir, dist)),
    target,
    up: normalize(add(scale(from.up, 1 - s), scale(to.up, s)), to.up),
  };
};

/** 缓入缓出（smootherstep）。 */
export const easeInOut = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** 当地水平系中由方位角（自北向东）与仰角给出的单位方向（ECI）。 */
export const horizonDirection = (azimuth: number, elevation: number, at: Vec3): Vec3 => {
  const { east, north, up } = enuBasisAt(at);
  return directionFrom(azimuth, elevation, north, east, up);
};

/** 由"从锚点指向相机"的方向反算 free / orbit 模式（惯性系）的方位角与仰角。 */
export const inertialAnglesFromDirection = (dir: Vec3): { azimuth: number; elevation: number } => {
  const d = normalize(dir);
  return { azimuth: Math.atan2(d.y, d.x), elevation: Math.asin(Math.max(-1, Math.min(1, d.z))) };
};
