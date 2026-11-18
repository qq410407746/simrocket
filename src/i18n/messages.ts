/**
 * English text for status notices and storage errors produced outside React
 * (design library, flight archive, design compiler). Stores keep the canonical
 * Chinese message; translation happens only at the UI boundary.
 */
import type { Language } from './locale';

const EXACT: Readonly<Record<string, string>> = {
  // Design library (designStore)
  '图纸存档无法读取，原始数据未覆盖。请先导出原文件或恢复备份。': 'The design library could not be read; the original data was not overwritten. Export the raw file or restore a backup first.',
  '本地存储不可用或图纸已损坏，无法读取已保存图纸。': 'Local storage is unavailable or the designs are corrupted; saved designs could not be read.',
  '保存失败：浏览器存储不可用或空间不足。现有图纸未改变，请导出备份。': 'Save failed: browser storage is unavailable or full. Existing designs are unchanged; please export a backup.',
  '图纸无效，未保存。': 'Invalid design; not saved.',
  '图纸已保存，可在自由飞行中选择。': 'Design saved. It can now be selected in Free flight.',
  '图纸已删除。': 'Design deleted.',
  '导入中存在与已有图纸同标识但内容不同的设计；未导入，请先处理冲突。': 'The backup contains a design with the same ID as an existing one but different content. Nothing was imported; resolve the conflict first.',
  '图纸备份已导入。': 'Design backup imported.',
  '备份无效、版本不支持或超过容量，现有图纸未改变。': 'The backup is invalid, of an unsupported version, or over capacity. Existing designs are unchanged.',
  '已建立新副本，尚未保存。': 'Created a new copy; not saved yet.',
  '已载入图纸，修改后请保存。': 'Design loaded. Save after making changes.',
  '文件超过64 KB，未导入。': 'The file exceeds 64 KB; nothing was imported.',
  '无法读取文件，未导入。': 'The file could not be read; nothing was imported.',
  // Design compiler (game/vehicles/design.ts)
  '图纸格式无效，或引用了不存在的模块。': 'Invalid design format, or it references a module that does not exist.',
  '模块接口直径不同；尚未提供转接结构，请选择接口相同的推进级与载荷。': 'Module interface diameters differ. Adapter structures are not available yet; choose stages and a payload with the same interface.',
  '海平面推重比不超过1，满推力也无法从发射台起飞。': 'Sea-level thrust-to-weight ratio is 1 or less: the rocket cannot lift off even at full thrust.',
  '四级构型尚无任务驾驶基准，请通过自由飞行验证。': 'Four-stage configurations have no piloting benchmark yet; verify them in Free flight.',
  // Flight archive (archiveStore / flightArchiveDb)
  '正在保存飞行曲线…': 'Saving flight curves…',
  '飞行曲线已保存到当前浏览器。': 'Flight curves saved in this browser.',
  '飞行曲线已清空。': 'Flight curves cleared.',
  '飞行曲线未能清空，请重试清除。': 'Flight curves could not be cleared; please retry.',
  '此浏览器不支持IndexedDB': 'This browser does not support IndexedDB',
  '存储打开超时，请关闭占用旧版本存档的其它标签页': 'Opening storage timed out; close other tabs that hold an older version of the archive',
  '无法打开飞行曲线存储': 'Unable to open flight curve storage',
  '飞行曲线数据无效': 'Invalid flight curve data',
  '曲线保存失败，可能是存储空间不足': 'Failed to save curves; storage may be full',
  '曲线保存失败': 'Failed to save curves',
  '此条曲线存档已损坏，无法回看': 'This curve archive is corrupted and cannot be played back',
  '读取飞行曲线失败': 'Failed to read flight curves',
  '清除飞行曲线失败': 'Failed to clear flight curves',
  '曲线读取失败': 'Failed to read curves',
  '正在读取飞行曲线…': 'Loading flight curves…',
  '此条日志没有保存的曲线（旧版本日志或保存时存储不可用）。': 'No curves were saved for this log entry (an older log, or storage was unavailable when it was saved).',
};

const PATTERNS: readonly (readonly [RegExp, (...groups: string[]) => string])[] = [
  [/^最多保存(\d+)份图纸，请先备份并删除不需要的图纸。$/, (n) => `Up to ${n} designs can be saved. Back up and delete designs you no longer need first.`],
  [/^(.+)；日志摘要仍独立保存。$/, (reason) => `${uiMessageText(reason, 'en')}; the log summary is still saved separately.`],
];

export function uiMessageText(message: string, language: Language): string {
  if (language === 'zh' || message === '') return message;
  const exact = EXACT[message];
  if (exact !== undefined) return exact;
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(message);
    if (match) return render(...match.slice(1));
  }
  return message;
}
