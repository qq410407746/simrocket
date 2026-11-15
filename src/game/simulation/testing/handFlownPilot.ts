/**
 * 测试用"手动飞行"驾驶员：模拟一个照着界面提示操作的玩家，用来验证
 * "玩家可以通过操作火箭进入稳定的近地轨道"这条验收标准，而不仅仅是"闭环制导律可以入轨"。
 *
 * 与 AscentPilot 的区别在于它故意很粗糙：
 *  - 只读取仪表上显示的量（遥测：高度、速度、垂直速度、俯仰角、近地点、各级推进剂），每 0.1 s 读一次
 *    （界面的刷新率）；
 *  - 只使用键盘能做到的操作：按住/松开姿态键（满偏的角速度指令）、R 顺行保持、空格分级、F 抛罩、X 关机；
 *  - 上面级飞行时，每隔 decisionInterval 秒才看一次仪表，并且只把目标俯仰角改动一个固定的台阶（默认 5°）。
 *
 * 流程（与 README"第一次入轨"一节相同）：
 *   1. 点火，竖直上升到 60 m/s；
 *   2. 按住 D 向东倾斜 kickAngle，松开；
 *   3. 等 5 s，按 R 开启顺行保持——大气层内的重力转弯交给它（零迎角）；
 *   4. 每一级耗尽时按空格分级。第一次分级后回到手动，此后只调俯仰角：
 *        期望垂直速度 = (目标高度 − 当前高度) / 60 s
 *        实际垂直速度比它小 25 m/s 以上 → 抬头一个台阶；大 25 m/s 以上 → 低头一个台阶；
 *   5. 近地点读数达到目标（默认 150 km）时关机。
 *
 * 起飞倾斜的方向由 kickHeadingDeg 给出，并取整到键盘能按出来的八个方向之一
 * （D 向东、W 向北、W + D 向东北……）。之后压低 / 抬高头部用的是同一组键及其反向。
 *
 * 给出目标倾角时，上面级飞行中还会用与之垂直的那组键修正航向（"倾角差多少，就把航向偏多少"）：
 *   每次看仪表，按 倾角偏差 / 0.25° 取整得到想要的航向偏移（以"点按次数"计，最多 8 次），
 *   与当前已有的偏移比较，点按一次（按住 0.3 s，约 2.4–3.4°）向它靠近一步。偏差消失后航向自然回正。
 *
 * 它不是游戏内的自动驾驶功能。
 */
import { type KeyCombo, comboForHeading, leftOfCombo } from '../../missions/guidance';
import { RAD2DEG } from '../../physics/constants';
import { type Telemetry, deriveTelemetry } from '../../telemetry/telemetry';
import type { Simulation } from '../Simulation';
import { buildSnapshot } from '../snapshot';
import type { SimulationConfig } from '../types';

export interface HandFlownOptions {
  /** 上面级飞行时瞄准的高度 [m]。 */
  readonly targetAltitude: number;
  /** 起飞后倾斜的角度 [°]。 */
  readonly kickAngleDeg: number;
  /** 倾斜的方向（航向，从正北起顺时针）[°]；缺省 90 即正东。取整到 45° 的倍数（键盘的八个方向）。 */
  readonly kickHeadingDeg?: number;
  /** 上面级飞行时两次调整俯仰角之间的间隔 [s]。 */
  readonly decisionInterval?: number;
  /** 每次调整俯仰角的台阶 [°]。 */
  readonly pitchStepDeg?: number;
  /** 近地点达到该高度时关机 [m]。 */
  readonly cutoffPeriapsis?: number;
  /**
   * 目标倾角 [rad] 与使倾角增大的转向。给出时，上面级飞行中用航向修正把倾角拉向目标。
   * 向北飞（升段）时左偏增大倾角，向南飞（降段）时右偏增大倾角。
   */
  readonly inclination?: { readonly target: number; readonly increase: 'left' | 'right' };
}

export type HandFlownStatus = 'ascending' | 'orbit' | 'out-of-propellant' | 'ended';

/** 界面遥测的刷新间隔，以物理步计（0.1 s）。 */
const HUD_REFRESH_STEPS = 5;
/** 航向修正：每点按一次按住的界面刷新周期数（0.3 s）、每 0.25° 倾角偏差对应一次点按、最多累积的点按次数。 */
const YAW_TAP_TICKS = 3;
const INCLINATION_PER_TAP_DEG = 0.25;
const MAX_YAW_TAPS = 8;

export class HandFlownPilot {
  private phase: 'vertical' | 'kick' | 'settle' | 'prograde-hold' | 'manual' = 'vertical';
  private phaseStart = 0;
  private pitchTarget = 90;
  private nextDecision = 0;
  private steps = 0;
  /** 压低头部用的按键组合（俯仰 / 偏航各为 −1、0 或 1）；抬高头部用它的反向。 */
  private readonly kickKeys: KeyCombo;
  /** 航向左偏用的按键组合。 */
  private readonly leftKeys: KeyCombo;
  /** 当前累积的航向偏移（点按次数，左偏为正）、正在进行的点按方向与剩余周期。 */
  private yawTaps = 0;
  private tapDirection = 0;
  private tapTicks = 0;
  private readonly sim: Simulation;
  private readonly config: SimulationConfig;
  private readonly options: Required<Omit<HandFlownOptions, 'inclination'>> & Pick<HandFlownOptions, 'inclination'>;

  /** 飞行中见到的最大动压 [Pa] 与最大过载 [g]（按界面刷新率采样）。 */
  maxDynamicPressure = 0;
  maxGLoad = 0;

  constructor(sim: Simulation, config: SimulationConfig, options: HandFlownOptions) {
    this.sim = sim;
    this.config = config;
    this.options = { decisionInterval: 3, pitchStepDeg: 5, cutoffPeriapsis: 150_000, kickHeadingDeg: 90, ...options };
    // 发射台上 W（俯仰 +1）向北、D（偏航 +1）向东
    this.kickKeys = comboForHeading(this.options.kickHeadingDeg);
    this.leftKeys = leftOfCombo(this.kickKeys);
  }

  /** 玩家在界面上看到的遥测。 */
  readHud(): Telemetry {
    return deriveTelemetry(buildSnapshot(this.sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), this.config);
  }

  /** 在每个物理步之前调用。 */
  update(): HandFlownStatus {
    const { sim, options } = this;
    if (sim.flightPhase === 'prelaunch') {
      if (!sim.getVehicleState().ignited) sim.stage();
      return 'ascending';
    }
    if (sim.flightPhase !== 'flight') return 'ended';
    if (this.steps++ % HUD_REFRESH_STEPS !== 0) return 'ascending';

    const t = this.readHud();
    const pitch = t.pitch * RAD2DEG;
    this.maxDynamicPressure = Math.max(this.maxDynamicPressure, t.dynamicPressure);
    this.maxGLoad = Math.max(this.maxGLoad, t.gLoad);

    // —— 空格：当前级耗尽就分级 ——
    const stageCount = sim.vehicle.stages.length;
    const active = t.activeStageIndex;
    if (active < stageCount && (t.stagePropellant[active] ?? 0) === 0) {
      if (active === stageCount - 1) {
        sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
        return 'out-of-propellant';
      }
      sim.stage();
      if (this.phase !== 'manual') {
        // 回到手动：从当前俯仰角（取整到台阶）开始
        sim.setAttitudeMode('manual');
        this.phase = 'manual';
        this.pitchTarget = Math.round(pitch / options.pitchStepDeg) * options.pitchStepDeg;
        this.nextDecision = sim.time + options.decisionInterval;
      }
      return 'ascending';
    }
    // —— F：出了大气层就抛整流罩 ——
    if (t.fairingAttached && t.altitude > 100_000) sim.jettisonFairing();
    // —— X：近地点读数达到目标就关机 ——
    if (t.orbit && t.orbit.periapsisAltitude >= options.cutoffPeriapsis) {
      sim.setThrottle(0);
      sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
      return 'orbit';
    }

    switch (this.phase) {
      case 'vertical':
        if (t.surfaceSpeed >= 60) {
          this.phase = 'kick';
          sim.setAttitudeInput({ pitch: this.kickKeys.pitch, yaw: this.kickKeys.yaw, roll: 0 });
        }
        break;
      case 'kick':
        if (pitch <= 90 - options.kickAngleDeg) {
          sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
          this.phase = 'settle';
          this.phaseStart = sim.time;
        }
        break;
      case 'settle':
        if (sim.time - this.phaseStart >= 5) {
          sim.setAttitudeMode('prograde');
          this.phase = 'prograde-hold';
        }
        break;
      case 'prograde-hold':
        break;
      case 'manual': {
        if (sim.time >= this.nextDecision) {
          this.nextDecision = sim.time + options.decisionInterval;
          const wanted = Math.max(-100, Math.min(600, (options.targetAltitude - t.altitude) / 60));
          const error = wanted - t.verticalSpeed;
          if (error > 25) this.pitchTarget += options.pitchStepDeg;
          else if (error < -25) this.pitchTarget -= options.pitchStepDeg;
          this.pitchTarget = Math.max(-10, Math.min(50, this.pitchTarget));
          // 航向修正：倾角差多少，就把航向偏多少（一次点按靠近一步）
          const steer = options.inclination;
          if (steer && t.orbit && this.tapTicks === 0) {
            const errorDeg = (steer.target - t.orbit.inclination) * RAD2DEG;
            const wanted = Math.max(-MAX_YAW_TAPS, Math.min(MAX_YAW_TAPS, Math.round(errorDeg / INCLINATION_PER_TAP_DEG))) * (steer.increase === 'left' ? 1 : -1);
            if (wanted !== this.yawTaps) {
              this.tapDirection = wanted > this.yawTaps ? 1 : -1;
              this.yawTaps += this.tapDirection;
              this.tapTicks = YAW_TAP_TICKS;
            }
          }
        }
        // 按住起飞时那组键（或其反向），直到导航球的俯仰读数到位（±1°）。向东飞行时 D（偏航 +1）使头部压低
        const excess = pitch - this.pitchTarget;
        const direction = excess > 1 ? 1 : excess < -1 ? -1 : 0;
        const turn = this.tapTicks > 0 ? this.tapDirection : 0;
        if (this.tapTicks > 0) this.tapTicks -= 1;
        sim.setAttitudeInput({
          pitch: direction * this.kickKeys.pitch + turn * this.leftKeys.pitch,
          yaw: direction * this.kickKeys.yaw + turn * this.leftKeys.yaw,
          roll: 0,
        });
        break;
      }
    }
    return 'ascending';
  }

  /** 连续飞行直到入轨、推进剂耗尽、飞行结束或超时。 */
  fly(timeout = 2000): HandFlownStatus {
    while (this.sim.time < timeout) {
      const status = this.update();
      if (status !== 'ascending') return status;
      this.sim.step();
    }
    return 'ascending';
  }
}
