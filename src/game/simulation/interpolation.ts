/**
 * 快照缓冲与渲染时间插值。
 *
 * 物理以固定步长推进并以约 60 Hz 发布快照；渲染以显示器刷新率运行。
 * 两者之间通过"渲染时钟 + 快照插值"解耦：
 *   - RenderClock 维护一个连续的渲染用模拟时间，略微落后于最新快照；
 *   - SnapshotBuffer 在相邻两个快照之间插值出该时刻的运动状态。
 * 插值只读快照，永远不会修改物理状态。
 */
import { propagateKepler } from '../physics/orbital/kepler';
import { type Quat, slerp } from '../physics/math/quat';
import { type Vec3, addScaled, vec3 } from '../physics/math/vec3';
import type { DebrisState, SimSnapshot } from './types';

/** 插值得到的运动状态（ECI）。 */
export interface InterpolatedMotion {
  readonly simTime: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly attitude: Quat;
}

/** 某一渲染时刻的完整采样：飞行器运动 + 与之一致的离散状态 + 分离体。 */
export interface RenderSample {
  readonly motion: InterpolatedMotion;
  /**
   * 离散状态（构型、发动机状态等）的来源快照。
   * 运动状态与它保持一致：若两个快照之间发生了分级，则整体取后一个快照的构型。
   */
  readonly state: SimSnapshot;
  readonly debris: readonly DebrisState[];
}

/**
 * 三次 Hermite 插值：利用两端的位置与速度，位置误差为 O(h⁴)。
 * 对匀速圆周运动（发射台随地球自转、圆轨道），60 Hz 快照下误差远小于 1 mm。
 */
export const hermitePosition = (p0: Vec3, v0: Vec3, p1: Vec3, v1: Vec3, h: number, s: number): Vec3 => {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = (s3 - 2 * s2 + s) * h;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = (s3 - s2) * h;
  return vec3(
    h00 * p0.x + h10 * v0.x + h01 * p1.x + h11 * v1.x,
    h00 * p0.y + h10 * v0.y + h01 * p1.y + h11 * v1.y,
    h00 * p0.z + h10 * v0.z + h01 * p1.z + h11 * v1.z,
  );
};

/** Hermite 曲线的导数，即插值速度。 */
export const hermiteVelocity = (p0: Vec3, v0: Vec3, p1: Vec3, v1: Vec3, h: number, s: number): Vec3 => {
  const s2 = s * s;
  const d00 = (6 * s2 - 6 * s) / h;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -d00;
  const d11 = 3 * s2 - 2 * s;
  return vec3(
    d00 * p0.x + d10 * v0.x + d01 * p1.x + d11 * v1.x,
    d00 * p0.y + d10 * v0.y + d01 * p1.y + d11 * v1.y,
    d00 * p0.z + d10 * v0.z + d01 * p1.z + d11 * v1.z,
  );
};

/**
 * 两个快照之间飞行器的"状态点"是否不连续：分级、抛罩或抛大底会使质心在箭体内的位置突变，
 * 飞行阶段切换（起飞、接地）也会改变运动规律。跨越这种不连续做插值会让模型瞬间滑动几十米。
 */
export const hasDiscontinuity = (a: SimSnapshot, b: SimSnapshot): boolean =>
  a.vehicle.activeStageIndex !== b.vehicle.activeStageIndex ||
  a.vehicle.fairingAttached !== b.vehicle.fairingAttached ||
  a.vehicle.heatShieldAttached !== b.vehicle.heatShieldAttached ||
  (a.vehicle.phase !== b.vehicle.phase && b.vehicle.phase !== 'flight');

/** 在两个快照之间插值；t 超出区间时按端点速度线性外推。 */
export const interpolateMotion = (a: SimSnapshot, b: SimSnapshot, t: number): InterpolatedMotion => {
  const h = b.simTime - a.simTime;
  const bodyA = a.vehicle.body;
  const bodyB = b.vehicle.body;
  if (!(h > 0)) {
    return { simTime: t, position: bodyB.position, velocity: bodyB.velocity, attitude: bodyB.attitude };
  }
  if (hasDiscontinuity(a, b)) {
    // 不跨越不连续点插值：整段都按后一个快照的状态（沿其速度）反推。
    return {
      simTime: t,
      position: addScaled(bodyB.position, bodyB.velocity, t - b.simTime),
      velocity: bodyB.velocity,
      attitude: bodyB.attitude,
    };
  }
  const s = (t - a.simTime) / h;
  if (b.analyticCoast && b.analyticSince != null && b.analyticSince <= a.simTime && a.vehicle.flight.thrust === 0 && s >= 0 && s <= 1) {
    return { simTime: t, ...propagateKepler(bodyA.position, bodyA.velocity, t - a.simTime), attitude: slerp(bodyA.attitude, bodyB.attitude, s) };
  }
  if (s <= 0) {
    return {
      simTime: t,
      position: addScaled(bodyA.position, bodyA.velocity, t - a.simTime),
      velocity: bodyA.velocity,
      attitude: bodyA.attitude,
    };
  }
  if (s >= 1) {
    return {
      simTime: t,
      position: addScaled(bodyB.position, bodyB.velocity, t - b.simTime),
      velocity: bodyB.velocity,
      attitude: bodyB.attitude,
    };
  }
  return {
    simTime: t,
    position: hermitePosition(bodyA.position, bodyA.velocity, bodyB.position, bodyB.velocity, h, s),
    velocity: hermiteVelocity(bodyA.position, bodyA.velocity, bodyB.position, bodyB.velocity, h, s),
    attitude: slerp(bodyA.attitude, bodyB.attitude, s),
  };
};

const MAX_BUFFERED_SNAPSHOTS = 16;

export class SnapshotBuffer {
  private snapshots: SimSnapshot[] = [];
  private latestArrivalMs = 0;

  /** 存入新快照。若模拟时间倒退（重新初始化），清空旧数据。 */
  push(snapshot: SimSnapshot, arrivalMs: number): void {
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && (snapshot.simTime < last.simTime || snapshot.seq < last.seq)) this.snapshots = [];
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_BUFFERED_SNAPSHOTS) this.snapshots.shift();
    this.latestArrivalMs = arrivalMs;
  }

  clear(): void {
    this.snapshots = [];
  }

  get latest(): SimSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  /** 最新快照到达主线程的墙钟时刻 [ms]。 */
  get latestArrival(): number {
    return this.latestArrivalMs;
  }

  /** 找到包围模拟时间 t 的两个相邻快照；缓冲为空时返回 null。 */
  private bracket(t: number): readonly [SimSnapshot, SimSnapshot] | null {
    const n = this.snapshots.length;
    const last = this.snapshots[n - 1];
    if (!last) return null;
    if (n === 1 || t >= last.simTime) return [this.snapshots[n - 2] ?? last, last];
    for (let i = n - 2; i >= 0; i--) {
      const a = this.snapshots[i] as SimSnapshot;
      if (t >= a.simTime) return [a, this.snapshots[i + 1] as SimSnapshot];
    }
    const first = this.snapshots[0] as SimSnapshot;
    return [first, this.snapshots[1] ?? first];
  }

  /** 取模拟时间 t 处的插值运动状态；缓冲为空时返回 null。 */
  sample(t: number): InterpolatedMotion | null {
    const pair = this.bracket(t);
    return pair ? interpolateMotion(pair[0], pair[1], t) : null;
  }

  /** 取模拟时间 t 处用于渲染的完整采样（运动 + 离散状态 + 分离体）。 */
  sampleForRender(t: number): RenderSample | null {
    const pair = this.bracket(t);
    if (!pair) return null;
    const [a, b] = pair;
    return { motion: interpolateMotion(a, b, t), state: b, debris: interpolateDebris(a, b, t) };
  }
}

/**
 * 分离体插值：按 id 在两个快照间配对做 Hermite 插值；
 * 只出现在后一个快照中的（刚分离的）按其速度反推，保证与飞行器在同一时刻对齐。
 */
export const interpolateDebris = (a: SimSnapshot, b: SimSnapshot, t: number): DebrisState[] => {
  const h = b.simTime - a.simTime;
  const s = h > 0 ? (t - a.simTime) / h : 1;
  return b.debris.map((db) => {
    const da = h > 0 && s > 0 && s < 1 ? a.debris.find((d) => d.id === db.id) : undefined;
    if (!da) return { ...db, position: addScaled(db.position, db.velocity, t - b.simTime) };
    return {
      ...db,
      position: hermitePosition(da.position, da.velocity, db.position, db.velocity, h, s),
      velocity: hermiteVelocity(da.position, da.velocity, db.position, db.velocity, h, s),
      attitude: slerp(da.attitude, db.attitude, s),
    };
  });
};

/** 渲染时钟落后于最新快照的墙钟时间 [s]：约 1.5 个快照间隔，保证通常处于插值而非外推。 */
export const RENDER_DELAY = 0.025;
/** 误差修正的时间常数 [s]。 */
const CORRECTION_TIME = 0.25;
/** 误差超过该墙钟时间当量 [s] 时直接跳变（如切换倍率、重新初始化）。 */
const SNAP_THRESHOLD = 0.5;

/**
 * 渲染时钟：以实际模拟速率连续推进，并平滑地向"最新快照时间 − 延迟"收敛。
 */
export class RenderClock {
  private time = 0;
  private initialized = false;

  reset(): void {
    this.initialized = false;
  }

  /**
   * @param wallDt 距上一渲染帧的墙钟时间 [s]
   * @param latest 最新快照
   * @param sinceArrival 最新快照到达后经过的墙钟时间 [s]
   * @returns 本帧应渲染的模拟时间 [s]
   */
  update(wallDt: number, latest: SimSnapshot, sinceArrival: number): number {
    const rate = latest.simRate;
    // 快照到达后模拟仍在继续推进，按速率估计"此刻"的模拟时间，再减去渲染延迟。
    const target = latest.simTime + (Math.min(Math.max(sinceArrival, 0), 0.1) - RENDER_DELAY) * rate;
    if (!this.initialized) {
      this.time = target;
      this.initialized = true;
      return this.time;
    }
    this.time += Math.max(0, wallDt) * rate;
    const error = target - this.time;
    if (Math.abs(error) > SNAP_THRESHOLD * Math.max(1, rate)) {
      this.time = target;
    } else {
      this.time += error * Math.min(1, Math.max(0, wallDt) / CORRECTION_TIME);
    }
    return this.time;
  }
}
