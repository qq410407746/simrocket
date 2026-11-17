import { useEffect, useMemo, useState } from 'react';
import { sampleArchiveAt, type FlightArchive } from '@/game/storage/flightArchive';
import type { FlightEventKind } from '@/game/simulation/types';
import { loadArchive } from '@/storage/flightArchiveDb';
import { formatDuration } from '@/utils/format';
import { LineChart, type ChartSeries } from '../ui/LineChart';

const EVENT_NAMES: Record<FlightEventKind, string> = {
  ignition: '点火', liftoff: '起飞', depleted: '推进剂耗尽', separation: '分级', fairing: '抛整流罩',
  'heat-shield': '抛防热大底', 'payload-ignition': '载荷发动机点火', 'drogue-deployed': '减速伞展开',
  'main-deployed': '主伞展开', 'parachute-failed': '降落伞失效', landed: '着陆', destroyed: '损毁',
};
function Playback({ archive }: { archive: FlightArchive }) {
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
      ['高度', 'altitude', '#5fd4ff', 'm'], ['地面速度', 'speed', '#d7ff3c', 'm/s'],
      ['过载', 'gLoad', '#46df8b', 'g'], ['热流', 'heatFlux', '#ff9d3c', 'W/m²'],
    ] as const;
    const lines: ChartSeries[] = definitions.map(([label, key, color, unit]) => {
      const values = archive.samples.map((s) => s[key]);
      return { label, color, values, peak: `${Math.max(0, ...values).toFixed(1)} ${unit}` };
    });
    return { times: archive.samples.map((s) => s.time), lines };
  }, [archive]);
  if (!reading) return <p>此条飞行尚无有效遥测采样，无法回看。</p>;
  return <div className="space-y-2" data-testid="archive-playback">
    <p className="font-semibold text-data">{archive.vehicleName} · 遥测回看</p>
    <div className="relative">
      <LineChart times={curves.times} series={curves.lines} height={100} startLabel={`T+${formatDuration(first)}`} endLabel={`T+${formatDuration(last)}`} />
      {last > first && <span aria-hidden className="pointer-events-none absolute top-7 bottom-4 border-l border-white/70" style={{ left: `${100 * (time - first) / (last - first)}%` }} />}
    </div>
    <label className="block">回看时刻 T+{formatDuration(time)}
      <input aria-label="遥测回看时刻" data-testid="archive-time" type="range" className="block w-full accent-data" min={first} max={last} step="any" disabled={last <= first} value={time} onChange={(e) => { setPlaying(false); setTime(Number(e.target.value)); }} />
    </label>
    <div className="flex items-center gap-2">
      <button className="rounded border border-line px-2 py-1" disabled={last <= first} onClick={() => {
        if (done) { setTime(first); setPlaying(true); } else setPlaying(!playing);
      }}>{playing && !done ? '暂停回看' : done ? '从头回看' : '播放回看'}</button>
      <select aria-label="回看速度" className="bg-void text-ink" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
        {[1, 10, 100].map((n) => <option key={n} value={n}>{n}×</option>)}
      </select>
    </div>
    <dl className="readout grid grid-cols-2 gap-1 text-ink" data-testid="archive-reading">
      <div><dt>高度</dt><dd>{reading.altitude.toFixed(1)} m</dd></div>
      <div><dt>地面速度</dt><dd>{reading.speed.toFixed(1)} m/s</dd></div>
      <div><dt>过载</dt><dd>{reading.gLoad.toFixed(2)} g</dd></div>
      <div><dt>动压</dt><dd>{reading.dynamicPressure.toFixed(1)} Pa</dd></div>
      <div><dt>热流</dt><dd>{reading.heatFlux.toFixed(1)} W/m²</dd></div>
    </dl>
    <details><summary className="cursor-pointer">飞行事件（{archive.events.length}）</summary>
      <ol className="max-h-32 overflow-y-auto">{archive.events.map((e, i) => <li key={i}>T+{formatDuration(e.time)} · {EVENT_NAMES[e.kind]}{e.stageIndex >= 0 ? ` · 第${e.stageIndex + 1}级` : ''}</li>)}</ol>
    </details>
    <p className="text-ink-faint">{archive.samples.length}个采样点；曲线各自归一化，点间读数为线性估读。没有重演物理状态，不能由此继续飞行。峰值以日志统计为准。</p>
    <button className="rounded border border-line px-2 py-1" onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `飞行遥测-${archive.id}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>导出遥测数据</button>
  </div>;
}
export function ArchiveViewer({ id }: { id: string }) {
  const [result, setResult] = useState<{ archive: FlightArchive | null; message: string }>({ archive: null, message: '正在读取飞行曲线…' });
  useEffect(() => {
    let cancelled = false;
    void loadArchive(id).then((archive) => {
      if (!cancelled) setResult({ archive, message: archive ? '' : '此条日志没有保存的曲线（旧版本日志或保存时存储不可用）。' });
    }).catch((error: unknown) => { if (!cancelled) setResult({ archive: null, message: error instanceof Error ? error.message : '曲线读取失败' }); });
    return () => { cancelled = true; };
  }, [id]);
  return <div className="mt-2 rounded border border-line p-2 text-xs text-ink-dim" data-testid="archive-viewer">
    {result.message ? <p role="status">{result.message}</p> : result.archive && <Playback key={result.archive.id} archive={result.archive} />}
  </div>;
}
