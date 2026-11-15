/**
 * 测试用的"照着提示操作"的驾驶员：亚轨道飞行与返回。
 *
 * 与 HandFlownPilot 一样，它们只读界面上显示的遥测（10 Hz），只做键盘能做的操作
 * （空格、姿态键、R / T / Y、Z / X、G、H）。它们用来验证任务可以被完成、并给出评分线的参照，
 * 不是游戏内的自动驾驶功能。
 */
import { RAD2DEG } from '../../physics/constants';
import { type Telemetry, deriveTelemetry } from '../../telemetry/telemetry';
import type { Simulation } from '../Simulation';
import { buildSnapshot } from '../snapshot';
import type { SimulationConfig } from '../types';

/** 界面遥测的刷新间隔，以物理步计（0.1 s）。 */
const HUD_REFRESH_STEPS = 5;

const readHud = (sim: Simulation, config: SimulationConfig): Telemetry =>
  deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config);

export interface DescentOptions {
  /** 主伞张开后抛掉防热大底（H）。 */
  readonly jettisonShield?: boolean;
  /** 开伞高度上限 [m]：降到这个高度以下、且满足开伞条件时开伞。缺省 12 km（提示出现的高度）。 */
  readonly parachuteAltitude?: number;
}

/**
 * 伞降阶段的操作：满足开伞条件（下降中、亚声速、动压在限值内）就按 G；主伞张开后按需抛大底。
 * 与界面提示"已降到亚声速：按 G 开伞"的条件相同。
 */
const descend = (sim: Simulation, t: Telemetry, options: DescentOptions): void => {
  const limits = t.parachuteLimits;
  if (
    t.parachute.phase === 'stowed' &&
    limits &&
    t.verticalSpeed < 0 &&
    t.altitude < (options.parachuteAltitude ?? 12_000) &&
    t.mach <= limits.mach &&
    t.dynamicPressure <= limits.dynamicPressure
  ) {
    sim.deployParachute();
  }
  if (options.jettisonShield && t.parachute.phase === 'main' && t.canJettisonHeatShield) sim.jettisonHeatShield();
};

export interface SuborbitalOptions extends DescentOptions {
  /** 起飞后向东倾斜到的俯仰角偏差 [°]；0 表示全程竖直。 */
  readonly kickAngleDeg: number;
  /** 速度达到多少 [m/s] 时开始倾斜。缺省 60。 */
  readonly kickSpeed?: number;
}

/**
 * 亚轨道飞行（单级火箭 + 返回舱）：
 *   点火 → （可选）60 m/s 后按住 D 向东倾斜、按 R 顺行保持 → 燃尽后空格分离返回舱
 *   → 倾斜过的飞行按 T 逆行保持（防热大底朝前）→ 亚声速后开伞。
 */
export class SuborbitalPilot {
  private phase: 'vertical' | 'kick' | 'settle' | 'ascent' | 'capsule' = 'vertical';
  private phaseStart = 0;
  private steps = 0;
  private readonly sim: Simulation;
  private readonly config: SimulationConfig;
  private readonly options: SuborbitalOptions;

  constructor(sim: Simulation, config: SimulationConfig, options: SuborbitalOptions) {
    this.sim = sim;
    this.config = config;
    this.options = options;
  }

  /** 在每个物理步之前调用。 */
  update(): void {
    const { sim, options } = this;
    if (sim.flightPhase === 'prelaunch') {
      if (!sim.getVehicleState().ignited) sim.stage();
      return;
    }
    if (sim.flightPhase !== 'flight' || this.steps++ % HUD_REFRESH_STEPS !== 0) return;
    const t = readHud(sim, this.config);

    if (this.phase !== 'capsule' && (t.stagePropellant[t.activeStageIndex] ?? 0) === 0) {
      // 燃尽：分离返回舱；倾斜过的飞行改为逆行保持
      sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
      sim.stage();
      sim.setAttitudeMode(options.kickAngleDeg > 0 ? 'retrograde' : 'manual');
      this.phase = 'capsule';
      return;
    }
    switch (this.phase) {
      case 'vertical':
        if (options.kickAngleDeg > 0 && t.surfaceSpeed >= (options.kickSpeed ?? 60)) {
          this.phase = 'kick';
          sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
        }
        break;
      case 'kick':
        if (t.pitch * RAD2DEG <= 90 - options.kickAngleDeg) {
          sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
          this.phase = 'settle';
          this.phaseStart = sim.time;
        }
        break;
      case 'settle':
        if (sim.time - this.phaseStart >= 5) {
          sim.setAttitudeMode('prograde');
          this.phase = 'ascent';
        }
        break;
      case 'ascent':
        break;
      case 'capsule':
        descend(sim, t, options);
        break;
    }
  }
}

export interface ReturnOptions extends DescentOptions {
  /** 再入方式：'trim' 配平再入（Y，升力向上），'retrograde' 弹道式（保持逆行）。 */
  readonly entry: 'trim' | 'retrograde';
  /** 离轨点火把近地点降到这个高度 [m] 就关机。缺省 30 km。 */
  readonly targetPeriapsis?: number;
  /** 开启逆行保持后等多久 [s] 再点火（等箭体调头）。缺省 40 s。 */
  readonly flipTime?: number;
}

/**
 * 从轨道返回：T 逆行保持 → 等调头 → 空格启动发动机、Z 点火 → 近地点够低时 X 关机
 * → 空格分离推进级 → Y 配平再入（或保持逆行）→ 亚声速后 G 开伞 → （可选）H 抛大底。
 */
export class ReturnPilot {
  private phase: 'flip' | 'burn' | 'separate' | 'descent' = 'flip';
  private phaseStart: number | null = null;
  private steps = 0;
  private readonly sim: Simulation;
  private readonly config: SimulationConfig;
  private readonly options: ReturnOptions;

  constructor(sim: Simulation, config: SimulationConfig, options: ReturnOptions) {
    this.sim = sim;
    this.config = config;
    this.options = options;
  }

  /** 在每个物理步之前调用。 */
  update(): void {
    const { sim, options } = this;
    if (sim.flightPhase !== 'flight' || this.steps++ % HUD_REFRESH_STEPS !== 0) return;
    const t = readHud(sim, this.config);
    switch (this.phase) {
      case 'flip':
        if (this.phaseStart === null) {
          this.phaseStart = sim.time;
          sim.setThrottle(0);
          sim.setAttitudeMode('retrograde');
        } else if (sim.time - this.phaseStart >= (options.flipTime ?? 40)) {
          if (!t.ignited) sim.stage();
          sim.setThrottle(1);
          this.phase = 'burn';
        }
        break;
      case 'burn':
        if (t.orbit && t.orbit.periapsisAltitude <= (options.targetPeriapsis ?? 30_000)) {
          sim.setThrottle(0);
          this.phase = 'separate';
        }
        break;
      case 'separate':
        if (t.thrust === 0) {
          // 逐级分离，直到只剩返回舱
          if (t.stageAttached.some((attached) => attached)) sim.stage();
          else {
            if (options.entry === 'trim' && t.trimAngle > 0) sim.setAttitudeMode('trim');
            this.phase = 'descent';
          }
        }
        break;
      case 'descent':
        descend(sim, t, options);
        break;
    }
  }
}
