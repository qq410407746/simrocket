export type Tone = 'data' | 'ok' | 'warn' | 'danger' | 'plain';

const TONE_CLASS: Record<Tone, string> = {
  data: 'text-data',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  plain: 'text-ink',
};

interface ReadoutProps {
  /** 中文名称。 */
  label: string;
  /** 英文缩写（仪表代号）。 */
  code?: string;
  value: string;
  unit?: string;
  tone?: Tone;
  /**
   * 该仪表所依赖的物理模型尚未实现时，填写计划实现的阶段（如 "阶段四"）。
   * 此时显示"—"并标注阶段，而不是显示占位数值。
   */
  pending?: string;
  testId?: string;
}

/** 单个数值读数。 */
export function Readout({ label, code, value, unit, tone = 'data', pending, testId }: ReadoutProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]" data-testid={testId}>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className={`truncate text-[12px] ${pending ? 'text-ink-faint' : 'text-ink-dim'}`}>{label}</span>
        {code && <span className="text-[9px] tracking-wider text-ink-faint uppercase">{code}</span>}
      </div>
      {pending ? (
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="readout text-[13px] text-ink-faint">—</span>
          <span className="rounded-sm border border-line px-1 text-[9px] text-ink-faint">{pending}</span>
        </span>
      ) : (
        <span className="flex items-baseline gap-1 whitespace-nowrap">
          <span className={`readout text-[14px] font-medium ${TONE_CLASS[tone]}`} data-role="value">
            {value}
          </span>
          {unit && <span className="w-7 text-left text-[10px] text-ink-faint">{unit}</span>}
        </span>
      )}
    </div>
  );
}
