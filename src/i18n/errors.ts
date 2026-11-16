import { createTranslator, type Language } from './locale';

/** Known worker/host diagnostics are translated at the UI boundary, not in physics. */
const ENGLISH_DIAGNOSTICS: readonly (readonly [string, string])[] = [
  ['物理线程错误：', 'Physics worker error: '],
  ['未知错误', 'Unknown error'],
  ['物理状态出现无效数值（t = ', 'Invalid physics state (t = '],
  [' s），模拟已停止。', ' s). Simulation stopped.'],
  ['不支持的时间倍率：', 'Unsupported time warp: '],
  ['dt 必须为正数，收到 ', 'dt must be positive; received '],
  ['历元儒略日无效', 'Invalid epoch Julian date'],
  ['飞行器至少需要一个推进级', 'A vehicle must have at least one propulsion stage'],
  ['初始飞行状态含无效数值', 'Initial flight state contains invalid numbers'],
  ['初始位置位于地面以下', 'Initial position is below ground'],
  ['maxStepsPerAdvance 必须 ≥ 1', 'maxStepsPerAdvance must be ≥ 1'],
];

export const simulationErrorText = (message: string | null, language: Language): string => {
  if (message === null) return createTranslator(language)('未知错误', 'Unknown error');
  if (language === 'zh') return message;
  // Preserve unrecognized runtime/driver details so diagnostics remain useful.
  return ENGLISH_DIAGNOSTICS.reduce((text, [original, english]) => text.replaceAll(original, english), message);
};
