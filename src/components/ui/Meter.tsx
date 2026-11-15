interface MeterProps {
  /** 0–1。 */
  fraction: number;
  tone?: 'data' | 'ok' | 'warn' | 'danger';
}

const BAR: Record<NonNullable<MeterProps['tone']>, string> = {
  data: 'bg-data',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

/** 水平进度条（推进剂余量等）。 */
export function Meter({ fraction, tone = 'data' }: MeterProps) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/70" role="progressbar" aria-valuenow={Math.round(f * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${f * 100}%` }} />
    </div>
  );
}
