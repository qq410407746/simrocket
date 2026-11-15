/**
 * 经典四阶龙格–库塔（RK4）积分器，用于平动运动方程
 *     ṙ = v ,   v̇ = a(t, r, v)
 *
 * 局部截断误差 O(dt⁵)，全局误差 O(dt⁴)。固定步长由调用方给定。
 * RK4 不是辛积分器：二体轨道的能量会有缓慢的长期漂移，量级随 dt⁴ 变化
 * （本项目的步长 0.02 s 下，近地轨道每圈的相对能量漂移远小于 10⁻¹⁰，见测试）。
 *
 * 实现上使用可变的标量分量并复用内部暂存对象：积分器处于物理循环的最内层，
 * 高时间倍率下每秒执行数万步，不能在每一步分配对象。
 */

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 加速度函数：给定时刻、位置、速度，把加速度写入 out。
 * 不得修改 r 与 v，也不得保留对它们的引用。
 */
export type AccelerationFn = (t: number, r: Readonly<MutableVec3>, v: Readonly<MutableVec3>, out: MutableVec3) => void;

const zero = (): MutableVec3 => ({ x: 0, y: 0, z: 0 });

export class Rk4Integrator {
  private readonly rTmp = zero();
  private readonly vTmp = zero();
  private readonly a1 = zero();
  private readonly a2 = zero();
  private readonly a3 = zero();
  private readonly a4 = zero();

  /** 把 (r, v) 从时刻 t 原地推进到 t + dt。 */
  step(r: MutableVec3, v: MutableVec3, t: number, dt: number, acceleration: AccelerationFn): void {
    const { rTmp, vTmp, a1, a2, a3, a4 } = this;
    const half = dt / 2;

    // k1
    acceleration(t, r, v, a1);

    // k2：ṙ = v + a1·dt/2
    rTmp.x = r.x + v.x * half;
    rTmp.y = r.y + v.y * half;
    rTmp.z = r.z + v.z * half;
    vTmp.x = v.x + a1.x * half;
    vTmp.y = v.y + a1.y * half;
    vTmp.z = v.z + a1.z * half;
    acceleration(t + half, rTmp, vTmp, a2);

    // k3：ṙ = v + a2·dt/2
    const k2rx = vTmp.x;
    const k2ry = vTmp.y;
    const k2rz = vTmp.z;
    rTmp.x = r.x + k2rx * half;
    rTmp.y = r.y + k2ry * half;
    rTmp.z = r.z + k2rz * half;
    vTmp.x = v.x + a2.x * half;
    vTmp.y = v.y + a2.y * half;
    vTmp.z = v.z + a2.z * half;
    acceleration(t + half, rTmp, vTmp, a3);

    // k4：ṙ = v + a3·dt
    const k3rx = vTmp.x;
    const k3ry = vTmp.y;
    const k3rz = vTmp.z;
    rTmp.x = r.x + k3rx * dt;
    rTmp.y = r.y + k3ry * dt;
    rTmp.z = r.z + k3rz * dt;
    vTmp.x = v.x + a3.x * dt;
    vTmp.y = v.y + a3.y * dt;
    vTmp.z = v.z + a3.z * dt;
    acceleration(t + dt, rTmp, vTmp, a4);

    const sixth = dt / 6;
    // r ← r + dt/6·(k1r + 2k2r + 2k3r + k4r)，其中 k1r = v，k4r = v + a3·dt（即 vTmp）
    const k1rx = v.x;
    const k1ry = v.y;
    const k1rz = v.z;
    r.x += sixth * (k1rx + 2 * k2rx + 2 * k3rx + vTmp.x);
    r.y += sixth * (k1ry + 2 * k2ry + 2 * k3ry + vTmp.y);
    r.z += sixth * (k1rz + 2 * k2rz + 2 * k3rz + vTmp.z);
    v.x += sixth * (a1.x + 2 * a2.x + 2 * a3.x + a4.x);
    v.y += sixth * (a1.y + 2 * a2.y + 2 * a3.y + a4.y);
    v.z += sixth * (a1.z + 2 * a2.z + 2 * a3.z + a4.z);
  }
}
