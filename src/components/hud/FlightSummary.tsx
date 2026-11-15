import { useMemo } from 'react';
import { MISSION_CATALOG, findMission } from '@/data/missions';
import { nextMission, progressOf } from '@/game/missions/career';
import type { MissionDefinition, MissionScore, MissionState } from '@/game/missions/types';
import { RAD2DEG } from '@/game/physics/constants';
import type { FlightOutcome, FlightStats } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import { useCareerStore } from '@/stores/careerStore';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import {
  formatDistance,
  formatDuration,
  formatHeatFlux,
  formatLatitude,
  formatLongitude,
  formatNumber,
  formatPressure,
  formatSpeed,
  formatTemperature,
} from '@/utils/format';
import { type ChartSeries, LineChart } from '../ui/LineChart';
import { GRADE_TONE, OBJECTIVE_MARK, metricText, missionFailureText } from './missionLabels';
import { describeOutcome, failureTitle, thermalZoneLabel } from './thermalLabels';

/** 结果面板里的统计数据。 */
const statRows = (
  stats: FlightStats,
  telemetry: Telemetry,
  outcome: FlightOutcome | null,
  mission: MissionState | null,
  liftoffTime: number | null,
): readonly (readonly [string, string])[] => {
  const maxAltitude = formatDistance(stats.maxAltitude);
  const range = formatDistance(telemetry.downrange);
  const maxQ = formatPressure(stats.maxDynamicPressure);
  const maxFlux = formatHeatFlux(stats.maxHeatFlux);
  const rows: (readonly [string, string])[] = [
    // 飞行已经结束时取结束时刻（之后模拟时间仍在走），否则取当前的任务时间
    ['飞行时间', liftoffTime === null ? '—' : formatDuration(Math.max(0, (outcome ? outcome.time : telemetry.simTime) - liftoffTime))],
    ['最大高度', `${maxAltitude.value} ${maxAltitude.unit}`],
    ['最大速度（相对地面）', `${formatSpeed(stats.maxSurfaceSpeed).value} m/s`],
    ['最大过载', `${formatNumber(stats.maxGLoad, 2)} g`],
    ['最大动压', `${maxQ.value} ${maxQ.unit}`],
    ['最大热流', `${maxFlux.value} ${maxFlux.unit}`],
    ['最高表面温度', `${formatTemperature(stats.maxSurfaceTemperature)} °C`],
  ];
  const orbit = mission?.confirmedOrbit;
  if (orbit) {
    rows.push(['确认的轨道', `${formatNumber(orbit.periapsisAltitude / 1000, 0)} × ${formatNumber(orbit.apoapsisAltitude / 1000, 0)} km`]);
    rows.push(['轨道倾角', `${formatNumber(orbit.inclination * RAD2DEG, 2)}°`]);
    rows.push(['入轨时剩余 Δv', `${formatNumber(orbit.remainingDeltaV, 0)} m/s`]);
  }
  if (outcome) {
    const airborne = outcome.kind !== 'landed' && outcome.cause !== 'impact' && outcome.cause !== null;
    rows.push([airborne ? '解体时速度' : '接地速度', `${formatSpeed(outcome.impactSpeed).value} m/s`]);
    rows.push(['航程', `${range.value} ${range.unit}`]);
    rows.push([airborne ? '解体点（星下点）' : '落点', `${formatLatitude(outcome.latitude)}，${formatLongitude(outcome.longitude)}`]);
  }
  return rows;
};

/** 任务结果：评级、总分、各目标与各评分项。 */
function MissionResult({ mission, state, score }: { mission: MissionDefinition; state: MissionState; score: MissionScore }) {
  const best = useCareerStore((s) => progressOf(s.progress, mission.id));
  const success = state.status === 'success';
  return (
    <div data-testid="mission-result" data-status={state.status}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] tracking-[0.3em] text-ink-faint">{success ? '任务完成 · MISSION COMPLETE' : '任务失败 · MISSION FAILED'}</p>
          <h2 className={`mt-1 text-[22px] leading-tight font-bold tracking-wider ${success ? 'text-ok' : 'text-danger'}`} data-testid="mission-outcome">
            {mission.title}
          </h2>
          {!success && (
            <p className="mt-0.5 text-[12px] text-warn" data-testid="mission-failure">
              {missionFailureText(state.failure)}
            </p>
          )}
        </div>
        <div className="flex items-end gap-2 text-right" title="评级：S ≥ 90，A ≥ 80，B ≥ 65，其余为 C；任务失败为 F">
          <div className="leading-tight">
            <div className="readout text-[20px] font-semibold text-ink" data-testid="mission-score">
              {score.total}
              <span className="text-[12px] text-ink-faint"> / 100</span>
            </div>
            {best.completed && <div className="text-[10px] text-ink-faint">最好成绩 {best.bestScore}</div>}
          </div>
          <div className={`text-[44px] leading-none font-bold ${GRADE_TONE[score.grade]}`} data-testid="mission-grade">
            {score.grade}
          </div>
        </div>
      </div>

      <ul className="mt-2 flex flex-col gap-0.5 text-[12px]" data-testid="mission-objectives">
        {mission.objectives.map((objective, i) => {
          const status = state.objectives[i]?.status ?? 'pending';
          const mark = OBJECTIVE_MARK[status];
          return (
            <li key={objective.id} className="flex items-baseline gap-1.5" data-status={status}>
              <span className={`font-semibold ${mark.tone}`}>{mark.mark}</span>
              <span className={status === 'failed' ? 'text-ink-dim' : 'text-ink'}>
                {objective.title}
                {objective.optional ? <span className="text-ink-faint">（附加）</span> : null}
              </span>
            </li>
          );
        })}
      </ul>

      <table className="mt-2 w-full border-t border-line/60 text-[12px]" data-testid="mission-score-items">
        <tbody>
          {score.items.map((item) => (
            <tr key={item.id} className="border-b border-line/30" title={item.note}>
              <td className="py-1 pr-2 text-ink-dim">{item.label}</td>
              <td className="readout py-1 pr-2 text-right text-ink">{metricText(item.metric, item.value)}</td>
              <td className="readout w-[72px] py-1 text-right">
                <span className={item.fraction >= 0.999 ? 'text-ok' : item.fraction > 0 ? 'text-ink' : 'text-ink-faint'}>{formatNumber(item.points, 0)}</span>
                <span className="text-ink-faint"> / {item.weight}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 飞行记录曲线：高度与速度、过载与热流随任务时间的变化。 */
function FlightCharts({ revision }: { revision: string }) {
  const data = useMemo(() => {
    const samples = simRuntime.flightRecorder.samples;
    const peak = (values: readonly number[]): number => values.reduce((max, value) => (value > max ? value : max), 0);
    const altitude = samples.map((s) => s.altitude);
    const speed = samples.map((s) => s.speed);
    const gLoad = samples.map((s) => s.gLoad);
    const heatFlux = samples.map((s) => s.heatFlux);
    const trajectory: ChartSeries[] = [
      { label: '高度', color: '#5fd4ff', values: altitude, peak: `${formatNumber(peak(altitude) / 1000, 0)} km` },
      { label: '速度', color: '#d7ff3c', values: speed, peak: `${formatNumber(peak(speed), 0)} m/s` },
    ];
    const loads: ChartSeries[] = [
      { label: '过载', color: '#46df8b', values: gLoad, peak: `${formatNumber(peak(gLoad), 1)} g` },
      { label: '热流', color: '#ff9d3c', values: heatFlux, peak: `${formatNumber(peak(heatFlux) / 1000, 0)} kW/m²` },
    ];
    return { times: samples.map((s) => s.time), trajectory, loads };
    // revision 变化（飞行结束、任务有结论）时重新读取记录仪
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  if (data.times.length < 2) return null;
  const start = `T+${formatDuration(data.times[0] ?? 0)}`;
  const end = `T+${formatDuration(data.times[data.times.length - 1] ?? 0)}`;
  return (
    <div className="flex flex-col gap-2" data-testid="flight-charts">
      <LineChart times={data.times} series={data.trajectory} startLabel={start} endLabel={end} testId="chart-trajectory" />
      <LineChart times={data.times} series={data.loads} startLabel={start} endLabel={end} testId="chart-loads" />
      <p className="text-[10px] leading-snug text-ink-faint">
        各曲线按自己的最大值归一化；曲线由约 {data.times.length} 个采样点连成，精确的极值见上面的统计数据。
      </p>
    </div>
  );
}

/**
 * 结果面板：飞行结束（着陆 / 损毁）或任务有了结论时显示。
 * 任务飞行给出评级、总分与各评分项；自由飞行只给出结果、原因与统计数据。全部数值来自物理线程的记录。
 * 任务在飞行途中完成（例如入轨确认）时，可以关掉面板继续飞行。
 */
export function FlightSummary() {
  const outcome = useSimStore((s) => s.outcome);
  const stats = useSimStore((s) => s.stats);
  const telemetry = useSimStore((s) => s.telemetry);
  const liftoffTime = useSimStore((s) => s.liftoffTime);
  const missionId = useSimStore((s) => s.missionId);
  const missionState = useSimStore((s) => s.mission);
  const missionScore = useSimStore((s) => s.missionScore);
  const dismissed = useSimStore((s) => s.resultDismissed);
  const progress = useCareerStore((s) => s.progress);
  const unlockAll = useCareerStore((s) => s.unlockAll);
  const returnToMenu = useGameStore((s) => s.returnToMenu);
  const startMission = useGameStore((s) => s.startMission);

  const mission = findMission(missionId) ?? null;
  const missionEnded = mission !== null && missionState !== null && missionState.status !== 'active' && missionScore !== null;
  if (!stats || !telemetry) return null;
  if (!outcome && !(missionEnded && !dismissed)) return null;

  const landed = outcome?.kind === 'landed';
  const failedZone = outcome ? (telemetry.thermal.find((zone) => zone.zone === outcome.thermalZone) ?? null) : null;
  const reasons = outcome
    ? describeOutcome(outcome, {
        landing: telemetry.landingLimits,
        structure: telemetry.structure,
        zoneLabel: failedZone ? thermalZoneLabel(failedZone) : null,
        zoneMaterial: failedZone?.material ?? null,
        parachute: telemetry.parachute.phase,
        heatShieldJettisoned: failedZone?.owner === 'payload-bare',
      })
    : [];
  const rows = statRows(stats, telemetry, outcome, missionState, liftoffTime);
  const success = missionEnded && missionState.status === 'success';
  const next = mission && success ? nextMission(MISSION_CATALOG, progress, mission.id, unlockAll) : null;
  const tone = missionEnded ? (success ? 'ok' : 'danger') : landed ? 'ok' : 'danger';
  const revision = `${outcome?.time ?? ''}|${missionState?.status ?? ''}|${missionState?.endedAt ?? ''}`;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4" data-testid="flight-summary">
      <section
        role="dialog"
        aria-label={missionEnded ? '任务结果' : '飞行结果'}
        className={`panel-frame scroll-thin pointer-events-auto max-h-full w-full max-w-[760px] overflow-y-auto rounded-xl p-5 backdrop-blur-md ${
          tone === 'ok' ? 'shadow-[0_0_0_1px_rgb(70_223_139/0.6)]' : 'shadow-[0_0_0_1px_rgb(255_93_93/0.6)]'
        }`}
      >
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            {missionEnded && <MissionResult mission={mission} state={missionState} score={missionScore} />}
            {outcome ? (
              <div className={missionEnded ? 'border-t border-line/60 pt-2' : ''}>
                {!missionEnded && <p className="text-[10px] tracking-[0.3em] text-ink-faint">飞行结束 · FLIGHT TERMINATED</p>}
                <h3
                  className={`${missionEnded ? 'text-[14px]' : 'mt-1 text-[22px]'} font-bold tracking-wider ${landed ? 'text-ok' : 'text-danger'}`}
                  data-testid="flight-outcome"
                >
                  {landed ? '已着陆' : '飞行器损毁'}
                </h3>
                {!landed && outcome.cause && (
                  <p className="mt-0.5 text-[13px] font-semibold text-warn" data-testid="flight-cause">
                    {failureTitle(outcome.cause)}
                  </p>
                )}
                {landed && (
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                    以 {formatNumber(Math.abs(outcome.verticalSpeed), 1)} m/s 的速度接地，在可承受的范围内（{telemetry.landingLimits.verticalSpeed} m/s）。
                  </p>
                )}
                {reasons.length > 0 && (
                  <ul className="mt-2 list-disc pl-4 text-[12px] leading-relaxed text-ink-dim" data-testid="flight-reasons">
                    {reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-[12px] leading-relaxed text-ink-dim" data-testid="mission-continue-note">
                飞行仍在继续：可以关掉这个面板接着飞（轨道机动、返回地球），成绩已经记录。
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5" data-testid="flight-stats">
              {rows.map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-[10px] text-ink-faint">{label}</dt>
                  <dd className="readout text-[13px] text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <FlightCharts revision={revision} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {next && (
            <button
              type="button"
              onClick={() => startMission(next.id)}
              data-testid="summary-next"
              className="flex-1 rounded-md border border-ok bg-ok/15 px-3 py-2 text-[13px] font-semibold tracking-wider whitespace-nowrap text-ok transition-colors hover:bg-ok/25"
            >
              下一个任务：{next.title}
            </button>
          )}
          {!outcome && (
            <button
              type="button"
              onClick={() => useSimStore.setState({ resultDismissed: true })}
              data-testid="summary-continue"
              className="flex-1 rounded-md border border-data bg-data/15 px-3 py-2 text-[13px] font-semibold tracking-widest text-data transition-colors hover:bg-data/25"
            >
              继续飞行
            </button>
          )}
          <button
            type="button"
            onClick={() => simRuntime.restart()}
            data-testid="summary-restart"
            className={`rounded-md border px-3 py-2 text-[13px] transition-colors ${
              next || !outcome
                ? 'border-line text-ink-dim hover:border-data-dim hover:text-ink'
                : 'flex-1 border-data bg-data/15 font-semibold tracking-widest text-data hover:bg-data/25'
            }`}
          >
            {mission ? '再飞一次' : '重新发射'}
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
