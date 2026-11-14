/**
 * 固定步长时钟（累加器模式）。
 *
 * 把"墙钟时间 × 时间倍率"换算成应执行的整数个物理步。物理步长恒定，
 * 因此模拟结果与浏览器帧率、定时器抖动无关（确定性）。
 *
 * 过载保护：单次推进最多执行 maxStepsPerAdvance 步。超出的部分被丢弃
 * （模拟变慢而不是"死亡螺旋"），丢弃量如实上报，用于计算实际模拟速率。
 */

/** 单次推进接受的最大墙钟间隔 [s]。标签页被挂起后恢复时，避免一次性补算过长时间。 */
export const MAX_WALL_DT = 0.25;

export interface ClockAdvance {
  /** 本次应执行的物理步数。 */
  readonly steps: number;
  /** 本次请求推进的模拟时间 [s]。 */
  readonly requested: number;
  /** 因过载保护而丢弃的模拟时间 [s]。 */
  readonly dropped: number;
}

export class FixedStepClock {
  private accumulator = 0;
  readonly dt: number;
  readonly maxStepsPerAdvance: number;

  constructor(dt: number, maxStepsPerAdvance: number) {
    if (!(dt > 0)) throw new Error(`FixedStepClock: dt 必须为正数，收到 ${dt}`);
    if (!(maxStepsPerAdvance >= 1)) throw new Error('FixedStepClock: maxStepsPerAdvance 必须 ≥ 1');
    this.dt = dt;
    this.maxStepsPerAdvance = Math.floor(maxStepsPerAdvance);
  }

  advance(wallDt: number, timeWarp: number): ClockAdvance {
    if (!(wallDt > 0) || !(timeWarp > 0)) return { steps: 0, requested: 0, dropped: 0 };
    const requested = Math.min(wallDt, MAX_WALL_DT) * timeWarp;
    this.accumulator += requested;
    let steps = Math.floor(this.accumulator / this.dt);
    let dropped = 0;
    if (steps > this.maxStepsPerAdvance) {
      dropped = (steps - this.maxStepsPerAdvance) * this.dt;
      steps = this.maxStepsPerAdvance;
      this.accumulator -= dropped;
    }
    this.accumulator -= steps * this.dt;
    return { steps, requested, dropped };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
