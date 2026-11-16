import { describe, expect, it } from 'vitest';
import { simulationErrorText } from './errors';

const cases = [
  ['物理线程错误：未知错误', 'Physics worker error: Unknown error'],
  ['物理线程错误：NetworkError', 'Physics worker error: NetworkError'],
  ['物理状态出现无效数值（t = 12.5 s），模拟已停止。', 'Invalid physics state (t = 12.5 s). Simulation stopped.'],
  ['不支持的时间倍率：42', 'Unsupported time warp: 42'],
  ['Simulation: dt 必须为正数，收到 -1', 'Simulation: dt must be positive; received -1'],
  ['Simulation: 历元儒略日无效', 'Simulation: Invalid epoch Julian date'],
  ['Simulation: 飞行器至少需要一个推进级', 'Simulation: A vehicle must have at least one propulsion stage'],
  ['Simulation: 初始飞行状态含无效数值', 'Simulation: Initial flight state contains invalid numbers'],
  ['Simulation: 初始位置位于地面以下', 'Simulation: Initial position is below ground'],
  ['FixedStepClock: maxStepsPerAdvance 必须 ≥ 1', 'FixedStepClock: maxStepsPerAdvance must be ≥ 1'],
] as const;

describe('simulation error presentation', () => {
  it.each(cases)('translates known diagnostic %s without losing its values', (original, english) => {
    expect(simulationErrorText(original, 'en')).toBe(english);
    expect(simulationErrorText(original, 'zh')).toBe(original);
  });

  it('provides a localized fallback and preserves unknown diagnostic details', () => {
    expect(simulationErrorText(null, 'en')).toBe('Unknown error');
    expect(simulationErrorText(null, 'zh')).toBe('未知错误');
    expect(simulationErrorText('Unexpected driver error', 'en')).toBe('Unexpected driver error');
  });
});
