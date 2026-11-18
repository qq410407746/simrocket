import { useEffect, useMemo, useState } from 'react';
import { sampleArchiveAt, type FlightArchive } from '@/game/storage/flightArchive';
import type { FlightEventKind } from '@/game/simulation/types';
import { loadArchive } from '@/storage/flightArchiveDb';
import { useI18n } from '@/i18n';
import type { Translator } from '@/i18n/locale';
import { dataText } from '@/i18n/dataText';
import { uiMessageText } from '@/i18n/messages';
import { formatDuration } from '@/utils/format';
import { LineChart, type ChartSeries } from '../ui/LineChart';

const EVENT_NAMES: Record<FlightEventKind, readonly [string, string]> = {
  ignition: ['点火', 'Ignition'], liftoff: ['起飞', 'Liftoff'], depleted: ['推进剂耗尽', 'Propellant depleted'],
  separation: ['分级', 'Staging'], fairing: ['抛整流罩', 'Fairing jettison'], 'heat-shield': ['抛防热大底', 'Heat shield jettison'],
  'payload-ignition': ['载荷发动机点火', 'Payload engine ignition'], 'drogue-deployed': ['减速伞展开', 'Drogue deployed'],
  'main-deployed': ['主伞展开', 'Main parachute deployed'], 'parachute-failed': ['降落伞失效', 'Parachute failed'],
  landed: ['着陆', 'Landed'], destroyed: ['损毁', 'Destroyed'],
};
const eventName = (kind: FlightEventKind, t: Translator): string => {
  const names = EVENT_NAMES[kind];
  return names ? t(names[0], names[1]) : kind;
};
function Playback({ archive }: { archive: FlightArchive }) {
  const { language, t } = useI18n();
  const first = archive.samples[0]?.time ?? 0;
  const last = archive.samples[archive.samples.length - 1]?.time ?? first;
  const [time, setTime] = useState(first);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(10);
  const reading = sampleArchiveAt(archive.samples, time);
  const done = time >= last;
  useEffect(() => {
    if (!playing || done) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = (now - previous) / 1000; previous = now;
      setTime((old) => Math.min(last, old + dt * rate));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, rate, last, done]);
  const curves = useMemo(() => {
    const definitions = [
      [t('高度', 'Altitude'), 'altitude', '#5fd4ff', 'm'], [t('地面速度', 'Surface speed'), 'speed', '#d7ff3c', 'm/s'],
      [t('过载', 'G-load'), 'gLoad', '#46df8b', 'g'], [t('热流', 'Heat flux'), 'heatFlux', '#ff9d3c', 'W/m²'],
    ] as const;
    const lines: ChartSeries[] = definitions.map(([label, key, color, unit]) => {
      const values = archive.samples.map((s) => s[key]);
      return { label, color, values, peak: `${Math.max(0, ...values).toFixed(1)} ${unit}` };
    });
    return { times: archive.samples.map((s) => s.time), lines };
  }, [archive, t]);
  if (!reading) return <p>{t('此条飞行尚无有效遥测采样，无法回看。', 'This flight has no valid telemetry samples to play back.')}</p>;
  return <div className="space-y-2" data-testid="archive-playback">
    <p className="font-semibold text-data">{dataText(archive.vehicleName, language)} · {t('遥测回看', 'Telemetry playback')}</p>
    <div className="relative">
      <LineChart times={curves.times} series={curves.lines} height={100} startLabel={`T+${formatDuration(first)}`} endLabel={`T+${formatDuration(last)}`} />
      {last > first && <span aria-hidden className="pointer-events-none absolute top-7 bottom-4 border-l border-white/70" style={{ left: `${100 * (time - first) / (last - first)}%` }} />}
    </div>
    <label className="block">{t('回看时刻', 'Playback time')} T+{formatDuration(time)}
      <input aria-label={t('遥测回看时刻', 'Telemetry playback time')} data-testid="archive-time" type="range" className="block w-full accent-data" min={first} max={last} step="any" disabled={last <= first} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
    </label>
    <div className="flex items-center gap-2">
      <button className="rounded border border-line px-2 py-1" disabled={last <= first} onClick={() => {
        if (done) { setTime(first); setPlaying(true); } else setPlaying(!playing);
      }}>{playing && !done ? t('暂停回看', 'Pause playback') : done ? t('从头回看', 'Replay from start') : t('播放回看', 'Play back')}</button>
      <select aria-label={t('回看速度', 'Playback speed')} className="bg-void text-ink" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
        {[1, 10, 100].map((n) => <option key={n} value={n}>{n}×</option>)}
      </select>
    </div>
    <dl className="readout grid grid-cols-2 gap-1 text-ink" data-testid="archive-reading">
      <div><dt>{t('高度', 'Altitude')}</dt><dd>{reading.altitude.toFixed(1)} m</dd></div>
      <div><dt>{t('地面速度', 'Surface speed')}</dt><dd>{reading.speed.toFixed(1)} m/s</dd></div>
      <div><dt>{t('过载', 'G-load')}</dt><dd>{reading.gLoad.toFixed(2)} g</dd></div>
      <div><dt>{t('动压', 'Dynamic pressure')}</dt><dd>{reading.dynamicPressure.toFixed(1)} Pa</dd></div>
      <div><dt>{t('热流', 'Heat flux')}</dt><dd>{reading.heatFlux.toFixed(1)} W/m²</dd></div>
    </dl>
    <details><summary className="cursor-pointer">{t('飞行事件', 'Flight events')} ({archive.events.length})</summary>
      <ol className="max-h-32 overflow-y-auto">{archive.events.map((e, i) => <li key={i}>T+{formatDuration(e.time)} · {eventName(e.kind, t)}{e.stageIndex >= 0 ? ` · ${t(`第${e.stageIndex + 1}级`, `Stage ${e.stageIndex + 1}`)}` : ''}</li>)}</ol>
    </details>
    <p className="text-ink-faint">{t(`${archive.samples.length}个采样点；曲线各自归一化，点间读数为线性估读。没有重演物理状态，不能由此继续飞行。峰值以日志统计为准。`, `${archive.samples.length} samples. Each curve is normalized separately and readings between samples are linear estimates. The physics state is not replayed, so the flight cannot be resumed from here. Peak values in the log statistics are authoritative.`)}</p>
    <button className="rounded border border-line px-2 py-1" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `${t('飞行遥测', 'flight-telemetry')}-${archive.id}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>{t('导出遥测数据', 'Export telemetry data')}</button>
  </div>;
}
export function ArchiveViewer({ id }: { id: string }) {
  const { language } = useI18n();
  const [result, setResult] = useState<{ archive: FlightArchive | null; message: string }>({ archive: null, message: '正在读取飞行曲线…' });
  useEffect(() => {
    let cancelled = false;
    void loadArchive(id).then((archive) => {
      if (!cancelled) setResult({ archive, message: archive ? '' : '此条日志没有保存的曲线（旧版本日志或保存时存储不可用）。' });
    }).catch((error: unknown) => { if (!cancelled) setResult({ archive: null, message: error instanceof Error ? error.message : '曲线读取失败' }); });
    return () => { cancelled = true; };
  }, [id]);
  return <div className="mt-2 rounded border border-line p-2 text-xs text-ink-dim" data-testid="archive-viewer">
    {result.message ? <p role="status">{uiMessageText(result.message, language)}</p> : result.archive && <Playback key={result.archive.id} archive={result.archive} />}
  </div>;
}
