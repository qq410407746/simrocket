/**
 * 测试用上升段"驾驶员"：只通过公开的控制指令（姿态输入、节流、分级）操纵模拟器，
 * 用于在自动化测试中验证"从发射台到入轨"的完整物理链路。
 *
 * 它不是游戏内的自动驾驶功能（那属于后续阶段），但制导逻辑是通用的：
 *   1. 垂直上升，直到相对地面速度达到 kickSpeed；
 *   2. 程序转弯：向东倾斜 kickAngle，保持到速度矢量跟上；
 *   3. 重力转弯：头部对准相对来流方向（零迎角），直到飞出稠密大气；
 *   4. 闭环制导：选取俯仰角 θ 使垂直方向的加速度把垂直速度引向目标剖面
 *        sin θ = (g_eff + a_v*) / a_T ，g_eff = μ/r² − v_h²/r
 *      其中 a_v* = (v_v* − v_v)/τ₂，v_v* = (h_target − h)/τ₁。
 *      这种写法对推重比小于 1 的上面级同样成立（一边保持高度一边加速）。
 *
 * 仅支持向正东发射（偏航通道控制东向倾角）。
 */
import { DEG2RAD, EARTH, STANDARD_GRAVITY } from '../../physics/constants';
import { airRelativeVelocityEci, altitudeOf, enuBasisAt, toEnu } from '../../physics/frames/frames';
import { rotate } from '../../physics/math/quat';
import { cross, dot, length, vec3 } from '../../physics/math/vec3';
import type { Simulation } from '../Simulation';

export interface AscentPilotOptions {
  /** 目标圆轨道高度 [m]。 */
  readonly targetAltitude: number;
  /** 程序转弯的倾斜角 [°]。 */
  readonly kickAngleDeg: number;
  /** 开始程序转弯时的相对地面速度 [m/s]。 */
  readonly kickSpeed?: number;
  /** 过载上限 [g]；超过时收节流（缺省不限制）。 */
  readonly maxG?: number;
  /** 最后一级点火后是否抛整流罩（缺省为是）。 */
  readonly jettisonFairing?: boolean;
}

export type AscentStatus = 'ascending' | 'orbit' | 'out-of-propellant' | 'ended';

/** 由状态向量计算近地点与远地点高度 [m]（二体问题）。 */
export const apsides = (sim: Simulation): { periapsis: number; apoapsis: number } => {
  const { position, velocity } = sim.getVehicleState().body;
  const r = length(position);
  const v = length(velocity);
  const energy = (v * v) / 2 - EARTH.MU / r;
  const h = length(cross(position, velocity));
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (EARTH.MU * EARTH.MU)));
  if (energy >= 0) return { periapsis: (h * h) / EARTH.MU / (1 + e) - EARTH.RADIUS, apoapsis: Infinity };
  const a = -EARTH.MU / (2 * energy);
  return { periapsis: a * (1 - e) - EARTH.RADIUS, apoapsis: a * (1 + e) - EARTH.RADIUS };
};

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export class AscentPilot {
  private phase: 'vertical' | 'kick' | 'gravity-turn' | 'closed-loop' = 'vertical';
  private readonly sim: Simulation;
  private readonly options: Required<AscentPilotOptions>;

  constructor(sim: Simulation, options: AscentPilotOptions) {
    this.sim = sim;
    this.options = { kickSpeed: 55, maxG: Infinity, jettisonFairing: true, ...options };
  }

  /** 在每个物理步之前调用。 */
  update(): AscentStatus {
    const { sim, options } = this;
    if (sim.flightPhase === 'prelaunch') {
      if (!sim.getVehicleState().ignited) sim.stage();
      return 'ascending';
    }
    if (sim.flightPhase !== 'flight') return 'ended';

    const state = sim.getVehicleState();
    const { position, velocity, attitude } = state.body;
    const basis = enuBasisAt(position);
    const altitude = altitudeOf(position);
    const airVelocity = toEnu(airRelativeVelocityEci(position, velocity), basis);
    const airspeed = length(airVelocity);
    const nose = toEnu(rotate(attitude, vec3(1, 0, 0)), basis);
    /** 带符号的东向倾角 [rad]：0 为竖直，+90° 为水平朝东。 */
    const tilt = Math.atan2(nose.x, nose.z);
    /** 速度矢量的东向倾角 [rad]。 */
    const velocityTilt = airspeed > 1 ? Math.atan2(airVelocity.x, airVelocity.z) : 0;

    // —— 分级与入轨判定 ——
    const stageCount = sim.vehicle.stages.length;
    const active = state.activeStageIndex;
    if (active < stageCount && state.stages[active]?.propellantMass === 0) {
      if (active === stageCount - 1) return 'out-of-propellant';
      sim.stage();
      sim.setThrottle(1);
      if (options.jettisonFairing && state.fairingAttached) sim.jettisonFairing();
      return 'ascending';
    }
    if (apsides(sim).periapsis >= options.targetAltitude - 15_000) {
      sim.setThrottle(0);
      sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
      return 'orbit';
    }

    // —— 制导：目标东向倾角 ——
    let targetTilt: number;
    if (this.phase === 'vertical') {
      targetTilt = 0;
      if (airspeed >= options.kickSpeed) this.phase = 'kick';
    } else if (this.phase === 'kick') {
      targetTilt = options.kickAngleDeg * DEG2RAD;
      if (velocityTilt >= targetTilt * 0.98) this.phase = 'gravity-turn';
    } else if (this.phase === 'gravity-turn') {
      targetTilt = velocityTilt;
      if (altitude > 40_000) this.phase = 'closed-loop';
    } else {
      const r = length(position);
      const vertical = dot(velocity, basis.up);
      const horizontalSq = dot(velocity, velocity) - vertical * vertical;
      const gEffective = EARTH.MU / (r * r) - horizontalSq / r;
      const thrustAccel = Math.max(0.1, state.flight.thrust / state.mass);
      const verticalTarget = clamp((options.targetAltitude - altitude) / 70, -150, 900);
      const accelTarget = (verticalTarget - vertical) / 25;
      const pitch = Math.asin(clamp((gEffective + accelTarget) / thrustAccel, -0.35, 0.95));
      // 不让指令姿态相对当前速度方向突变过大（刚进入闭环段时仍有残余动压）
      targetTilt = Math.PI / 2 - pitch;
    }

    const error = targetTilt - tilt;
    sim.setAttitudeInput({ pitch: 0, yaw: clamp(error / (1.5 * DEG2RAD), -1, 1), roll: 0 });

    // —— 过载限制 ——
    if (Number.isFinite(options.maxG)) {
      const g = length(state.specificForce) / STANDARD_GRAVITY;
      if (g > options.maxG) sim.setThrottle(Math.max(0.4, state.throttle - 0.01));
    }
    return 'ascending';
  }

  /** 连续飞行直到入轨、推进剂耗尽、飞行结束或超时。 */
  fly(timeout = 2000): AscentStatus {
    while (this.sim.time < timeout) {
      const status = this.update();
      if (status !== 'ascending') return status;
      this.sim.step();
    }
    return 'ascending';
  }
}
