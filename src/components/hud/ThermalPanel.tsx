import { useEffect, useRef } from 'react';
import type { ThermalHistory } from '@/game/telemetry/thermalHistory';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import { createTranslator, type Language } from '@/i18n/locale';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { formatHeatFlux, formatHeatLoad, formatNumber, formatTemperature } from '@/utils/format';
import { Panel } from '../ui/Panel';
import { riskLabel, thermalRisk, thermalZoneLabel } from './thermalLabels';

const CHART_WIDTH = 246;
const CHART_HEIGHT = 46;
const COLOR_FLUX = '#5fd4ff';
const COLOR_SURFACE = '#ffb347';
const COLOR_INTERIOR = '#93a3ba';
const COLOR_GRID = '#1c2e48';

/** 把温度刻度向上取到好看的数（K）。 */
const niceCeil = (value: number, step: number): number => Math.max(step, Math.ceil(value / step) * step);

/**
 * 画热流与温度随时间的变化（最近约 10 分钟）。
 * 两条纵轴各自归一化：热流（青色，左）与温度（橙色表面 / 灰色内部，右）。
 * @returns 曲线的满刻度值；没有数据时为 null
 */
const drawChart = (canvas: HTMLCanvasElement, history: ThermalHistory): { flux: number; temperature: number; span: number } | null => {
  // willReadFrequently 让这张小画布留在 CPU 上绘制。GPU 加速的 2D 画布在软件渲染（没有显卡）的环境里
  // 会与 WebGL 画面争用同一个光栅化线程，实测每隔几秒把主线程卡住数秒；这里的绘制量很小，CPU 绘制绰绰有余。
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== CHART_WIDTH * ratio || canvas.height !== CHART_HEIGHT * ratio) {
    canvas.width = CHART_WIDTH * ratio;
    canvas.height = CHART_HEIGHT * ratio;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, CHART_WIDTH, CHART_HEIGHT);

  // 网格
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const fraction of [0, 0.5, 1]) {
    const y = Math.round((CHART_HEIGHT - 1) * fraction) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(CHART_WIDTH, y);
  }
  ctx.stroke();

  const count = history.length;
  const first = history.at(0);
  const last = history.latest;
  if (count < 2 || !first || !last) return null;

  let maxFlux = 0;
  let maxTemperature = 0;
  for (let i = 0; i < count; i++) {
    const sample = history.at(i);
    if (!sample) continue;
    if (sample.heatFlux > maxFlux) maxFlux = sample.heatFlux;
    if (sample.surfaceTemperature > maxTemperature) maxTemperature = sample.surfaceTemperature;
  }
  const fluxScale = niceCeil(maxFlux, maxFlux > 2e5 ? 2e5 : 2e4);
  const minTemperature = 200;
  const temperatureScale = niceCeil(maxTemperature, 250);
  const span = Math.max(1, last.time - first.time);
  const x = (time: number): number => ((time - first.time) / span) * (CHART_WIDTH - 1);
  const y = (fraction: number): number => (CHART_HEIGHT - 2) * (1 - Math.max(0, Math.min(1, fraction))) + 1;

  const plot = (color: string, width: number, value: (index: number) => number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const sample = history.at(i);
      if (!sample) continue;
      const px = x(sample.time);
      const py = y(value(i));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  const temperatureFraction = (kelvin: number): number => (kelvin - minTemperature) / (temperatureScale - minTemperature);
  plot(COLOR_INTERIOR, 1, (i) => temperatureFraction(history.at(i)?.interiorTemperature ?? minTemperature));
  plot(COLOR_SURFACE, 1.5, (i) => temperatureFraction(history.at(i)?.surfaceTemperature ?? minTemperature));
  plot(COLOR_FLUX, 1.5, (i) => (history.at(i)?.heatFlux ?? 0) / fluxScale);
  return { flux: fluxScale, temperature: temperatureScale, span };
};

/** 时间窗的显示文字；语言切换不改变历史采样或绘图频率。 */
export const thermalHistorySpanLabel = (span: number, language: Language = 'zh'): string => {
  const t = createTranslator(language);
  return span >= 120
    ? t(`最近 ${formatNumber(span / 60, 0)} 分钟`, `Last ${formatNumber(span / 60, 0)} min`)
    : t(`最近 ${formatNumber(span, 0)} 秒`, `Last ${formatNumber(span, 0)} s`);
};

/** 热流与温度的时间历程曲线。 */
function ThermalChart() {
  const { language, t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const fluxLabel = useRef<HTMLSpanElement>(null);
  const temperatureLabel = useRef<HTMLSpanElement>(null);
  const spanLabel = useRef<HTMLSpanElement>(null);
  // 遥测约 10 Hz 更新一次，以它为节拍检查；只有出现新的采样点（约每模拟秒一个）时才真正重画
  const simTime = useSimStore((s) => s.telemetry?.simTime ?? 0);
  const drawn = useRef<{ time: number; length: number; scale: ReturnType<typeof drawChart> }>({ time: Number.NaN, length: -1, scale: null });

  useEffect(() => {
    if (!canvas.current) return;
    const history = simRuntime.thermalHistory;
    const latest = history.latest?.time ?? Number.NaN;
    if (!Object.is(drawn.current.time, latest) || drawn.current.length !== history.length) {
      drawn.current = { time: latest, length: history.length, scale: drawChart(canvas.current, history) };
    }
    const scale = drawn.current.scale;
    if (fluxLabel.current) {
      const flux = scale ? formatHeatFlux(scale.flux) : null;
      fluxLabel.current.textContent = flux ? `${flux.value} ${flux.unit}` : '';
    }
    if (temperatureLabel.current) temperatureLabel.current.textContent = scale ? `${formatTemperature(scale.temperature)} °C` : '';
    if (spanLabel.current) {
      spanLabel.current.textContent = scale ? thermalHistorySpanLabel(scale.span, language) : '';
    }
  }, [simTime, language]);

  return (
    <div className="mt-1.5" data-testid="thermal-chart">
      <div className="flex items-baseline justify-between text-[9px]">
        <span className="text-data">
          {t('热流', 'Flux')} <span className="readout" ref={fluxLabel} />
        </span>
        <span className="text-ink-faint" ref={spanLabel} />
        <span className="text-warn" title={t('橙色：表面温度；灰色：内部温度', 'Orange: surface temperature; gray: interior temperature')}>
          {t('温度', 'Temp')} <span className="readout" ref={temperatureLabel} />
        </span>
      </div>
      <canvas
        ref={canvas}
        style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}
        className="mt-px block rounded-sm bg-void/40"
        role="img"
        aria-label={t('热流（青色）、表面温度（橙色）与内部温度（灰色）随时间变化的曲线', 'Heat flux (cyan), surface temperature (orange) and interior temperature (gray) over time')}
      />
    </div>
  );
}

const BAR_TONE = { nominal: 'bg-data', caution: 'bg-warn', warning: 'bg-danger', failed: 'bg-danger' } as const;

/** 四个主读数之一：上方是名称与单位，下方是数值。 */
function Cell({ label, unit, value, tone, testId }: { label: string; unit: string; value: string; tone: string; testId: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[9px] text-ink-faint">
        {label} <span className="opacity-80">{unit}</span>
      </dt>
      <dd className={`readout text-[14px] leading-tight font-medium ${tone}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 热防护监控面板：受热最强的热区的热流、表面/内部温度与累积热载荷，三个热区各自的温度与余量，
 * 整体的失效风险，以及热流与温度的时间曲线。全部读数来自物理线程的热模型（physics/thermodynamics）。
 */
export function ThermalPanel() {
  const { language, t: tr } = useI18n();
  const t = useSimStore((s) => s.telemetry);
  if (!t || t.thermal.length === 0) return null;

  const critical = t.thermal[t.criticalZone] ?? t.thermal[0];
  if (!critical) return null;
  // 受热最强的热区（对流热流最大）；没有任何加热时取最危险的那个
  const hottest = t.thermal.reduce((best, zone) => (zone.heatFlux > best.heatFlux ? zone : best), critical);
  const subject = hottest.heatFlux > 1_000 ? hottest : critical;
  const risk = thermalRisk(critical.margin, critical.failure !== null);
  const riskInfo = riskLabel(risk, language);
  const flux = formatHeatFlux(Math.max(0, subject.heatFlux));
  const interiorUsed = (subject.interiorTemperature - 288) / Math.max(1, subject.interiorLimit - 288);

  return (
    <Panel title={tr('热防护', 'Thermal protection')} code={language === 'zh' ? 'Thermal' : undefined} className="w-68" testId="thermal-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[11px]">
        <span className="text-ink-dim">
          {subject.heatFlux > 1_000 ? tr('受热最强', 'Hottest') : tr('监测部位', 'Monitoring')} <span className="text-ink" data-testid="thermal-subject">{thermalZoneLabel(subject, language)}</span>
        </span>
        <span className={`font-semibold ${riskInfo.tone}`} data-testid="thermal-risk" title={tr('按热裕度最小的部位评定', 'Based on the zone with the smallest thermal margin')}>
          {risk === 'nominal' ? riskInfo.text : `${thermalZoneLabel(critical, language)} ${riskInfo.text}`}
        </span>
      </div>

      <dl className="mt-1.5 grid grid-cols-4 gap-x-2">
        <Cell label={tr('热流', 'Flux')} unit={flux.unit} value={flux.value} tone="text-data" testId="readout-heat-flux" />
        <Cell label={tr('表面', 'Surface')} unit="°C" value={formatTemperature(subject.surfaceTemperature)} tone="text-warn" testId="readout-surface-temperature" />
        <Cell
          label={tr('内部', 'Interior')}
          unit="°C"
          value={formatTemperature(subject.interiorTemperature)}
          tone={interiorUsed > 0.9 ? 'text-danger' : interiorUsed > 0.7 ? 'text-warn' : 'text-ink'}
          testId="readout-interior-temperature"
        />
        <Cell label={tr('累积', 'Load')} unit="MJ/m²" value={formatHeatLoad(subject.heatLoad)} tone="text-ink" testId="readout-heat-load" />
      </dl>

      <ul className="mt-2 flex flex-col gap-[3px] border-t border-line/60 pt-1.5">
        {t.thermal.map((zone) => {
          const zoneRisk = thermalRisk(zone.margin, zone.failure !== null);
          // 进度条：已用掉的热裕度（表面温度、内部温度、烧蚀层三者中最紧张的一项）
          const used = 1 - zone.margin;
          return (
            <li
              key={zone.zone}
              className="text-[11px] leading-tight"
              data-testid={`thermal-zone-${zone.zone}`}
              title={tr(`${zone.material}：表面限值 ${formatTemperature(zone.surfaceLimit)} °C，内部限值 ${formatTemperature(zone.interiorLimit)} °C`, `${dataText(zone.material, language)}: surface limit ${formatTemperature(zone.surfaceLimit)} °C; interior limit ${formatTemperature(zone.interiorLimit)} °C`)}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-1">
                <span className={zone === subject ? 'text-ink' : 'text-ink-dim'}>
                  {thermalZoneLabel(zone, language)}
                  <span className="ml-1.5 text-[9px] text-ink-faint">{dataText(zone.material, language)}</span>
                </span>
                <span className="readout text-[11px] text-ink-dim">
                  {formatTemperature(zone.surfaceTemperature)} °C
                  {zone.ablative && <span className="ml-1.5 text-data">{tr(`余 ${formatNumber(zone.ablatorFraction * 100, 0)}%`, `${formatNumber(zone.ablatorFraction * 100, 0)}% left`)}</span>}
                </span>
              </div>
              <div
                className="mt-px h-1 w-full overflow-hidden rounded-full bg-line/70"
                role="progressbar"
                aria-label={tr(`${thermalZoneLabel(zone)}热裕度已用`, `${thermalZoneLabel(zone, language)} thermal margin used`)}
                aria-valuenow={Math.round(used * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className={`h-full rounded-full ${BAR_TONE[zoneRisk]}`} style={{ width: `${Math.max(0, Math.min(1, used)) * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>

      <ThermalChart />
    </Panel>
  );
}
