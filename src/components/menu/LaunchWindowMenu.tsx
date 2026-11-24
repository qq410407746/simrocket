import { useEffect, useRef, useState } from 'react';
import { DESTINATIONS, findPlanet } from '@/game/interplanetary/planets';
import { type ArrivalMode, CAPTURE_APOAPSIS_RADII, type Transfer, flightTimeRange } from '@/game/interplanetary/transfer';
import { type PorkchopGrid, WINDOW_MARGIN } from '@/game/interplanetary/windows';
import { RAD2DEG } from '@/game/physics/constants';
import { unixMsFromJulianDate } from '@/game/physics/ephemeris/time';
import { useI18n } from '@/i18n';
import { FIRST_YEAR, LAST_YEAR, PARKING_ALTITUDE, SEARCH_SPANS, useLaunchWindowStore } from '@/stores/launchWindowStore';
import { formatNumber } from '@/utils/format';

/** 儒略日 → "2026-10-31"（UTC）。 */
export const formatDate = (jd: number): string => new Date(unixMsFromJulianDate(jd)).toISOString().slice(0, 10);

const kms = (mps: number, digits = 2) => formatNumber(mps / 1000, digits);

/** 飞行时间：一年以内用天，更长用年。 */
const useDuration = () => {
  const { t } = useI18n();
  return (days: number, years = days >= 730) => (!years ? t(`${formatNumber(days, 0)} 天`, `${formatNumber(days, 0)} days`) : t(`${formatNumber(days / 365.25, 1)} 年`, `${formatNumber(days / 365.25, 1)} years`));
};

const ARRIVAL_LABEL: Record<ArrivalMode, readonly [string, string, string, string]> = {
  flyby: ['飞掠', 'Flyby', '到达后不减速，只算出发 Δv', 'No braking at arrival; only departure Δv counts'],
  capture: ['大椭圆捕获轨道', 'Elliptical capture', `近星点低轨道、远星点 ${CAPTURE_APOAPSIS_RADII} 倍行星半径，真实任务常用的入轨方式`, `Low periapsis, apoapsis at ${CAPTURE_APOAPSIS_RADII} planet radii — how real missions usually arrive`],
  circular: ['低圆轨道', 'Low circular orbit', '到达后一次减速直接进入低圆轨道（最费推进剂）', 'Brake straight into a low circular orbit (most propellant)'],
};

const button = (active: boolean) =>
  `rounded border px-2 py-1 text-[11.5px] transition-colors ${active ? 'border-data bg-data/10 text-data' : 'border-line text-ink-dim hover:border-data-dim hover:text-ink'}`;

function Heading({ children }: { children: string }) {
  return <h2 className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{children}</h2>;
}

/** 左侧：目的地、搜索条件与窗口列表。 */
export function LaunchWindowSetup() {
  const { language, t } = useI18n();
  const duration = useDuration();
  const s = useLaunchWindowStore();
  const compute = useLaunchWindowStore((state) => state.compute);
  useEffect(() => compute(), [compute]);
  const defaultRange = flightTimeRange(s.target);
  const maxFlight = s.maxFlightDays ?? defaultRange.max;
  const flightInYears = defaultRange.max > 730;
  const [draft, setDraft] = useState<string | null>(null);
  const shownMax = draft ?? formatNumber(flightInYears ? maxFlight / 365.25 : maxFlight, flightInYears ? 1 : 0).replaceAll(',', '');

  return (
    <section className="flex flex-col gap-2.5" data-testid="launch-window-setup">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        {t(
          `从 ${PARKING_ALTITUDE / 1000} km 地球停泊轨道出发，直接飞往目标行星（不借力飞越）。按真实行星位置搜索最省 Δv 的发射日期。`,
          `Departing from a ${PARKING_ALTITUDE / 1000} km Earth parking orbit and flying directly to the target (no gravity assists). Searches real planetary positions for the lowest-Δv launch dates.`,
        )}
      </p>
      <div>
        <Heading>{t('目的地', 'Destination')}</Heading>
        <div className="grid grid-cols-4 gap-1">
          {DESTINATIONS.map((id) => {
            const planet = findPlanet(id);
            return (
              <button key={id} type="button" onClick={() => { setDraft(null); s.setTarget(id); }} aria-pressed={s.target === id} data-testid={`lw-target-${id}`} className={button(s.target === id)}>
                {language === 'en' ? planet.name : planet.nameZh}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-ink-faint">
          {t('从哪一年开始搜索', 'Search from year')}
          <input
            type="number"
            min={FIRST_YEAR}
            max={LAST_YEAR}
            value={s.startYear}
            onChange={(e) => s.setStartYear(Number(e.target.value))}
            data-testid="lw-start-year"
            className="readout rounded border border-line bg-void/60 px-1.5 py-0.5 text-[12px] text-ink focus:border-data focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-0.5 text-[10px] text-ink-faint">
          {t('搜索年数', 'Years to search')}
          <div className="flex gap-1">
            {SEARCH_SPANS.map((span) => (
              <button key={span} type="button" onClick={() => s.setSpan(span)} aria-pressed={s.span === span} data-testid={`lw-span-${span}`} className={`flex-1 ${button(s.span === span)}`}>
                {span}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Heading>{t('到达后', 'On arrival')}</Heading>
        <div className="flex flex-col gap-1">
          {(Object.keys(ARRIVAL_LABEL) as ArrivalMode[]).map((mode) => {
            const [zh, en, noteZh, noteEn] = ARRIVAL_LABEL[mode];
            return (
              <button key={mode} type="button" onClick={() => s.setArrival(mode)} aria-pressed={s.arrival === mode} data-testid={`lw-arrival-${mode}`} className={`text-left ${button(s.arrival === mode)}`}>
                <span className="font-semibold">{t(zh, en)}</span>
                <span className="ml-1.5 text-[10px] text-ink-faint">{t(noteZh, noteEn)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <label className="flex items-center justify-between gap-2 text-[10.5px] text-ink-faint">
        <span>
          {t('最长飞行时间', 'Longest flight time')} ({flightInYears ? t('年', 'years') : t('天', 'days')})
        </span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step="any"
            value={shownMax}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null) {
                const value = Number(draft) * (flightInYears ? 365.25 : 1);
                if (Number.isFinite(value) && value > defaultRange.min) s.setMaxFlightDays(value);
                setDraft(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            data-testid="lw-max-flight"
            className="readout w-20 rounded border border-line bg-void/60 px-1.5 py-0.5 text-right text-[12px] text-ink focus:border-data focus:outline-none"
          />
          {s.maxFlightDays !== null && (
            <button type="button" onClick={() => { setDraft(null); s.setMaxFlightDays(null); }} className="text-[10px] text-data-dim hover:text-data" data-testid="lw-max-flight-reset">
              {t('默认', 'Default')}
            </button>
          )}
        </span>
      </label>

      <div data-testid="lw-window-list">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('发射窗口', 'Launch windows')}</h2>
          <span className="readout text-[10px] text-ink-faint" data-testid="lw-status">
            {s.busy || !s.result ? t('计算中…', 'Computing…') : t(`${s.result.windows.length} 个`, `${s.result.windows.length} found`)}
          </span>
        </div>
        {s.result && !s.busy && s.result.windows.length === 0 && <p className="text-[11px] text-ink-dim">{t('这段时间里没有找到窗口，试试延长搜索年数。', 'No window in this period; try searching more years.')}</p>}
        <ol className="flex flex-col gap-1">
          {s.result?.windows.map((w, i) => {
            const selected = i === s.selectedWindow;
            return (
              <li key={w.best.departureJd}>
                <button
                  type="button"
                  onClick={() => s.selectWindow(i)}
                  aria-pressed={selected}
                  data-testid={`lw-window-${i}`}
                  className={`readout grid w-full grid-cols-[1fr_auto] items-baseline gap-x-2 rounded-md border px-2.5 py-1 text-left text-[11.5px] transition-colors ${
                    selected ? 'border-data bg-data/10' : 'border-line bg-panel/40 hover:border-data-dim'
                  } ${s.busy ? 'opacity-50' : ''}`}
                >
                  <span className="text-ink">
                    {formatDate(w.best.departureJd)} → {formatDate(w.best.arrivalJd)}
                  </span>
                  <span className="text-data">{kms(w.best.totalDeltaV)} km/s</span>
                  <span className="text-[10px] text-ink-faint">{duration(w.best.arrivalJd - w.best.departureJd)}</span>
                  <span className="text-[10px] text-ink-faint">{w.atFlightLimit ? t('贴着时间上限', 'at time limit') : ''}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Row({ label, value, testId, hint }: { label: string; value: string; testId?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/40 py-0.5">
      <dt className="text-[11px] text-ink-dim" title={hint}>
        {label}
      </dt>
      <dd className="readout text-[12px] text-ink" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function TransferTable({ transfer, prefix }: { transfer: Transfer; prefix: string }) {
  const { t } = useI18n();
  const duration = useDuration();
  const target = useLaunchWindowStore((s) => s.target);
  const arrival = useLaunchWindowStore((s) => s.arrival);
  const dla = transfer.declination * RAD2DEG;
  return (
    <dl className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
      <div>
        <Row label={t('发射日期', 'Launch date')} value={formatDate(transfer.departureJd)} testId={`${prefix}-departure`} />
        <Row label={t('到达日期', 'Arrival date')} value={formatDate(transfer.arrivalJd)} testId={`${prefix}-arrival`} />
        <Row label={t('飞行时间', 'Flight time')} value={duration(transfer.arrivalJd - transfer.departureJd)} testId={`${prefix}-tof`} />
        <Row label={t('日心转移角', 'Heliocentric transfer angle')} value={`${formatNumber(transfer.transferAngle * RAD2DEG, 0)}°`} />
        <Row label="C3" value={`${formatNumber(transfer.c3 / 1e6, 1)} km²/s²`} testId={`${prefix}-c3`} hint={t('出发剩余速度的平方，运载火箭手册用它表示能送多重', 'Departure excess speed squared; launch vehicle manuals quote payload against it')} />
        <Row label={t('出发渐近线赤纬', 'Departure declination (DLA)')} value={`${formatNumber(dla, 1)}°`} testId={`${prefix}-dla`} hint={t('停泊轨道倾角至少要这么大', 'The parking orbit must be inclined at least this much')} />
      </div>
      <div>
        <Row label={t('出发剩余速度 v∞', 'Departure v∞')} value={`${kms(transfer.departureVInf)} km/s`} />
        <Row label={t('离开停泊轨道 Δv', 'Δv from parking orbit')} value={`${kms(transfer.departureDeltaV)} km/s`} testId={`${prefix}-dv-departure`} />
        <Row label={t('到达剩余速度 v∞', 'Arrival v∞')} value={`${kms(transfer.arrivalVInf)} km/s`} testId={`${prefix}-vinf-arrival`} />
        <Row label={arrival === 'flyby' ? t('入轨 Δv（飞掠不需要）', 'Capture Δv (none for flyby)') : t('入轨 Δv', 'Capture Δv')} value={`${kms(transfer.captureDeltaV)} km/s`} testId={`${prefix}-dv-capture`} />
        <div className="flex items-baseline justify-between gap-2 py-1">
          <dt className="text-[12px] font-semibold text-ink">{t('总 Δv', 'Total Δv')}</dt>
          <dd className="readout text-[16px] font-semibold text-data" data-testid={`${prefix}-dv-total`}>
            {kms(transfer.totalDeltaV)} km/s
          </dd>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-faint">
          {target === 'mercury'
            ? t('直飞水星非常费推进剂，真实任务（信使号、贝皮科伦坡号）都靠多次行星借力。', 'Flying straight to Mercury is very costly; real missions (MESSENGER, BepiColombo) relied on repeated planetary flybys.')
            : ''}
        </p>
      </div>
    </dl>
  );
}

/** 猪排图配色：最省的格子最亮，越费越暗，超过上限不画（与背景融合）。 */
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const lerpColor = (t: number): string => {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i]!;
  const b = RAMP[i + 1]!;
  const channel = (k: number) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f);
  return `rgb(${channel(1)},${channel(3)},${channel(5)})`;
};

/** 颜色覆盖的 Δv 范围：最优值往上 3 km/s（内行星）或 4 km/s（外行星）。 */
const colorSpan = (grid: PorkchopGrid) => (grid.flightDays[grid.flightDays.length - 1]! > 730 ? 4000 : 3000);
const CONTOUR_STEP = 500;

function Porkchop({ grid, best, picked }: { grid: PorkchopGrid; best: Transfer; picked: Transfer | null }) {
  const { t } = useI18n();
  const duration = useDuration();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pick = useLaunchWindowStore((s) => s.pick);
  const [hover, setHover] = useState<{ x: number; y: number; col: number; row: number } | null>(null);
  const cols = grid.departures.length;
  const rows = grid.flightDays.length;
  const span = colorSpan(grid);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const cw = width / cols;
    const ch = height / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = grid.values[j * cols + i]!;
        if (!(v - grid.min <= span)) continue;
        ctx.fillStyle = lerpColor((v - grid.min) / span);
        // 飞行时间向上增大：第 0 行画在最下面
        ctx.fillRect(Math.floor(i * cw), Math.floor(height - (j + 1) * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
    // 等值线：相邻格子跨过 500 m/s 的整数倍处画细线
    ctx.fillStyle = 'rgba(2,4,10,0.55)';
    const level = (v: number) => (Number.isFinite(v) && v - grid.min <= span ? Math.floor(v / CONTOUR_STEP) : -1);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const l = level(grid.values[j * cols + i]!);
        if (l < 0) continue;
        if (i + 1 < cols && level(grid.values[j * cols + i + 1]!) !== l) ctx.fillRect(Math.floor((i + 1) * cw) - 1, Math.floor(height - (j + 1) * ch), 1.5, Math.ceil(ch));
        if (j + 1 < rows && level(grid.values[(j + 1) * cols + i]!) !== l) ctx.fillRect(Math.floor(i * cw), Math.floor(height - (j + 1) * ch) - 1, Math.ceil(cw), 1.5);
      }
    }
  }, [grid, cols, rows, span]);

  const x0 = grid.departures[0]!;
  const x1 = grid.departures[cols - 1]!;
  const y0 = grid.flightDays[0]!;
  const y1 = grid.flightDays[rows - 1]!;
  const pos = (jd: number, days: number) => ({ left: `${((jd - x0) / (x1 - x0)) * 100}%`, top: `${(1 - (days - y0) / (y1 - y0)) * 100}%` });
  const cellAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const col = Math.min(cols - 1, Math.max(0, Math.round(fx * (cols - 1))));
    const row = Math.min(rows - 1, Math.max(0, Math.round((1 - fy) * (rows - 1))));
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, col, row };
  };
  const hoverValue = hover ? grid.values[hover.row * cols + hover.col]! : Number.NaN;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="flex flex-col gap-1" data-testid="lw-porkchop">
      <figcaption className="text-[11px] text-ink-dim">
        {t('猪排图：横轴出发日期、纵轴飞行时间，颜色越亮总 Δv 越小；细线每 0.5 km/s 一条。点击图上任一点查看那条轨道。', 'Porkchop plot: launch date across, flight time up; brighter means less total Δv; contours every 0.5 km/s. Click anywhere to inspect that trajectory.')}
      </figcaption>
      <div className="flex gap-1.5">
        <div className="readout flex w-12 shrink-0 flex-col justify-between py-0.5 text-right text-[9.5px] text-ink-faint">
          {[...ticks].reverse().map((f) => (
            <span key={f}>{duration(y0 + (y1 - y0) * f, y1 > 730)}</span>
          ))}
        </div>
        <div
          className="relative h-[260px] flex-1 cursor-crosshair rounded border border-line/70 bg-void/70"
          onMouseMove={(e) => setHover(cellAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const c = cellAt(e);
            pick(grid.departures[c.col]!, grid.flightDays[c.row]!);
          }}
          data-testid="lw-porkchop-area"
        >
          <canvas ref={canvasRef} width={cols * 6} height={rows * 4} className="absolute inset-0 h-full w-full rounded" />
          <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-void bg-ink" style={pos(best.departureJd, best.arrivalJd - best.departureJd)} title={t('最优', 'Optimum')} />
          {picked && <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-warn" style={pos(picked.departureJd, picked.arrivalJd - picked.departureJd)} />}
          {hover && (
            <div
              className="readout pointer-events-none absolute z-10 rounded border border-line bg-panel/95 px-2 py-1 text-[10.5px] whitespace-nowrap text-ink shadow-lg"
              style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12, transform: hover.x > 260 ? 'translateX(calc(-100% - 24px))' : undefined }}
              data-testid="lw-porkchop-tooltip"
            >
              <div>
                {t('出发', 'Launch')} {formatDate(grid.departures[hover.col]!)}
              </div>
              <div>
                {t('飞行', 'Flight')} {duration(grid.flightDays[hover.row]!)}
              </div>
              <div className="text-data">Δv {Number.isFinite(hoverValue) ? `${kms(hoverValue)} km/s` : t('无解', 'no solution')}</div>
            </div>
          )}
        </div>
      </div>
      <div className="readout ml-[3.375rem] flex justify-between text-[9.5px] text-ink-faint">
        {ticks.map((f) => (
          <span key={f}>{formatDate(x0 + (x1 - x0) * f)}</span>
        ))}
      </div>
      <div className="ml-[3.375rem] flex items-center gap-2 text-[10px] text-ink-faint">
        <span>{t('总 Δv', 'Total Δv')}</span>
        <span className="readout">{kms(grid.min)}</span>
        <span className="h-2 flex-1 rounded-sm" style={{ background: `linear-gradient(90deg, ${RAMP.join(',')})` }} />
        <span className="readout">
          {kms(grid.min + span)} km/s
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-void bg-ink" />
          {t('最优', 'Optimum')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rotate-45 border-2 border-warn" />
          {t('选中', 'Selected')}
        </span>
      </div>
    </figure>
  );
}

/** 右侧：当前窗口的最优轨道、猪排图与点选的轨道。 */
export function LaunchWindowDetail() {
  const { language, t } = useI18n();
  const s = useLaunchWindowStore();
  const planet = findPlanet(s.target);
  const window = s.result?.windows[s.selectedWindow];
  return (
    <article className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[640px] flex-col gap-2.5 overflow-y-auto rounded-xl px-5 py-3.5 backdrop-blur-md" data-testid="launch-window-detail">
      <header>
        <p className="text-[10px] tracking-[0.2em] text-data-dim">{t('发射窗口计算器', 'Launch window calculator')} · {t('地球', 'Earth')} → {language === 'en' ? planet.name : planet.nameZh}</p>
        <h2 className="mt-1 text-[20px] leading-tight font-bold tracking-wider text-ink" data-testid="lw-title">
          {window ? t(`${formatDate(window.best.departureJd)} 发射窗口`, `Launch window of ${formatDate(window.best.departureJd)}`) : t('发射窗口', 'Launch window')}
        </h2>
        {window && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-data" data-testid="lw-window-range">
            {t(
              `总 Δv 不超过最优值 ${WINDOW_MARGIN / 1000} km/s 的发射日期：${formatDate(window.openJd)} 至 ${formatDate(window.closeJd)}`,
              `Launch dates within ${WINDOW_MARGIN / 1000} km/s of the optimum: ${formatDate(window.openJd)} to ${formatDate(window.closeJd)}`,
            )}
          </p>
        )}
      </header>
      {!window && <p className="text-[12px] text-ink-dim">{s.busy || !s.result ? t('计算中…', 'Computing…') : t('请在左侧选择一个窗口。', 'Choose a window on the left.')}</p>}
      {window && (
        <>
          <section>
            <h3 className="mb-1 text-[12px] font-semibold tracking-wider text-ink">{t('最优轨道', 'Optimal trajectory')}</h3>
            <TransferTable transfer={window.best} prefix="lw-best" />
            {window.atFlightLimit && (
              <p className="mt-1 rounded border border-warn/50 bg-warn/5 px-2 py-1 text-[10.5px] text-warn" data-testid="lw-limit-note">
                {t('最优解贴着最长飞行时间：放宽时间上限还能更省，但要飞得更久。', 'The optimum sits at the longest flight time allowed: a longer limit would save more Δv but take longer.')}
              </p>
            )}
          </section>
          {s.grid && <Porkchop grid={s.grid} best={window.best} picked={s.picked} />}
          {s.picked && (
            <section data-testid="lw-picked">
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-[12px] font-semibold tracking-wider text-warn">{t('选中的轨道', 'Selected trajectory')}</h3>
                <button type="button" onClick={s.clearPick} className="text-[10.5px] text-data-dim hover:text-data">
                  {t('清除', 'Clear')}
                </button>
              </div>
              <TransferTable transfer={s.picked} prefix="lw-picked" />
            </section>
          )}
        </>
      )}
      <footer className="flex flex-col gap-1 border-t border-line/60 pt-2 text-[10px] leading-relaxed text-ink-faint">
        <p>
          {t(
            '模型：行星位置用 JPL 近似星历（开普勒根数及其长期变化率）；日心段解兰伯特问题；出发与到达按拼接圆锥、瞬时点火计算。只算直接转移，不含借力飞越、深空机动和发射场限制；用于选窗口，不能用于精确导航。',
            'Model: planet positions from JPL approximate ephemerides (Keplerian elements and secular rates); the heliocentric leg solves Lambert’s problem; departure and arrival use patched conics with impulsive burns. Direct transfers only — no gravity assists, deep-space maneuvers or launch-site constraints. Good for choosing windows, not for precise navigation.',
          )}
        </p>
        <p data-testid="lw-ephemeris">
          {s.result?.options.table === 'table2'
            ? t('本次搜索超出 1800–2050 年，使用精度较低的 Table 2（公元前 3000 年至公元 3000 年）。', 'This search extends beyond 1800–2050, so the lower-accuracy Table 2 (3000 BC – AD 3000) is used.')
            : t('本次搜索在 1800–2050 年内，使用 Table 1。', 'This search lies within 1800–2050 and uses Table 1.')}{' '}
          {t('资料：JPL Solar System Dynamics "Approximate Positions of the Planets"（Standish & Williams）；行星半径来自 JPL 行星物理参数，引力参数来自维基百科。', 'Sources: JPL Solar System Dynamics “Approximate Positions of the Planets” (Standish & Williams); planet radii from JPL physical parameters; gravitational parameters from Wikipedia.')}
        </p>
      </footer>
    </article>
  );
}
