import { LANDING_LIMITS } from '@/game/simulation/Simulation';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import {
  formatAngle,
  formatDistance,
  formatDuration,
  formatLatitude,
  formatLongitude,
  formatNumber,
  formatPressure,
  formatSpeed,
} from '@/utils/format';

/**
 * 飞行结束面板：结果、原因与本次飞行的统计数据。
 * 全部数值来自物理线程的记录，不做任何评分（任务评分属于阶段五）。
 */
export function FlightSummary() {
  const outcome = useSimStore((s) => s.outcome);
  const stats = useSimStore((s) => s.stats);
  const liftoffTime = useSimStore((s) => s.liftoffTime);
  const downrange = useSimStore((s) => s.telemetry?.downrange ?? 0);
  const returnToMenu = useGameStore((s) => s.returnToMenu);
  if (!outcome || !stats) return null;

  const landed = outcome.kind === 'landed';
  const horizontal = Math.sqrt(Math.max(0, outcome.impactSpeed ** 2 - outcome.verticalSpeed ** 2));
  // 损毁原因：指出超出了哪一项接地容限
  const reasons: string[] = [];
  if (!landed) {
    if (Math.abs(outcome.verticalSpeed) > LANDING_LIMITS.verticalSpeed) {
      reasons.push(`垂直速度 ${formatNumber(Math.abs(outcome.verticalSpeed), 1)} m/s，超过可承受的 ${LANDING_LIMITS.verticalSpeed} m/s`);
    }
    if (horizontal > LANDING_LIMITS.horizontalSpeed) {
      reasons.push(`水平速度 ${formatNumber(horizontal, 1)} m/s，超过可承受的 ${LANDING_LIMITS.horizontalSpeed} m/s`);
    }
    if (outcome.tilt > LANDING_LIMITS.tilt) {
      reasons.push(`接地时箭体倾斜 ${formatAngle(outcome.tilt)}°`);
    }
  }

  const maxAltitude = formatDistance(stats.maxAltitude);
  const range = formatDistance(downrange);
  const maxQ = formatPressure(stats.maxDynamicPressure);
  const rows: readonly (readonly [string, string])[] = [
    ['飞行时间', liftoffTime === null ? '—' : formatDuration(outcome.time - liftoffTime)],
    ['最大高度', `${maxAltitude.value} ${maxAltitude.unit}`],
    ['最大速度（相对地面）', `${formatSpeed(stats.maxSurfaceSpeed).value} m/s`],
    ['最大过载', `${formatNumber(stats.maxGLoad, 2)} g`],
    ['最大动压', `${maxQ.value} ${maxQ.unit}`],
    ['接地速度', `${formatSpeed(outcome.impactSpeed).value} m/s`],
    ['航程', `${range.value} ${range.unit}`],
    ['落点', `${formatLatitude(outcome.latitude)}，${formatLongitude(outcome.longitude)}`],
  ];

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4" data-testid="flight-summary">
      <section
        role="dialog"
        aria-label="飞行结果"
        className={`panel-frame pointer-events-auto w-full max-w-md rounded-xl p-5 backdrop-blur-md ${landed ? 'shadow-[0_0_0_1px_rgb(70_223_139/0.6)]' : 'shadow-[0_0_0_1px_rgb(255_93_93/0.6)]'}`}
      >
        <p className="text-[10px] tracking-[0.3em] text-ink-faint">飞行结束 · FLIGHT TERMINATED</p>
        <h2 className={`mt-1 text-[22px] font-bold tracking-wider ${landed ? 'text-ok' : 'text-danger'}`} data-testid="flight-outcome">
          {landed ? '已着陆' : '飞行器损毁'}
        </h2>
        {reasons.length > 0 && (
          <ul className="mt-2 list-disc pl-4 text-[12px] leading-relaxed text-ink-dim">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        {!landed && (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            降落伞与热防护尚未实现（阶段四），目前任何高速返回都会以撞击地面告终。
          </p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-line/60 pt-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-[10px] text-ink-faint">{label}</dt>
              <dd className="readout text-[13px] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => simRuntime.restart()}
            data-testid="summary-restart"
            className="flex-1 rounded-md border border-data bg-data/15 px-3 py-2 text-[13px] font-semibold tracking-widest text-data transition-colors hover:bg-data/25"
          >
            重新发射
          </button>
          <button
            type="button"
            onClick={() => {
              returnToMenu();
              simRuntime.restart();
            }}
            data-testid="summary-menu"
            className="rounded-md border border-line px-3 py-2 text-[13px] text-ink-dim transition-colors hover:border-data-dim hover:text-ink"
          >
            主菜单
          </button>
        </div>
      </section>
    </div>
  );
}
