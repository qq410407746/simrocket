import { useState } from 'react';
import { findMission } from '@/data/missions';
import { useSimStore } from '@/stores/simStore';
import { OBJECTIVE_MARK, objectiveProgress } from './missionLabels';

/**
 * 飞行中的任务条：任务名、各目标的完成情况与当前读数。点击任务名展开飞行步骤（教学提示）。
 * 自由飞行时不显示。
 */
export function MissionStrip() {
  const missionId = useSimStore((s) => s.missionId);
  const state = useSimStore((s) => s.mission);
  const telemetry = useSimStore((s) => s.telemetry);
  const stats = useSimStore((s) => s.stats);
  const [open, setOpen] = useState(false);
  const mission = findMission(missionId);
  if (!mission || !state) return null;

  const statusTone = state.status === 'success' ? 'text-ok' : state.status === 'failed' ? 'text-danger' : 'text-ink';
  return (
    <div
      className="panel-frame pointer-events-auto flex max-w-full flex-col items-center gap-1 rounded-md px-3 py-1 text-[12px] backdrop-blur-md"
      data-testid="mission-strip"
      data-status={state.status}
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.currentTarget.blur();
            setOpen((value) => !value);
          }}
          aria-expanded={open}
          title="显示 / 隐藏这次任务的飞行步骤"
          data-testid="mission-title"
          className={`rounded border border-line px-1.5 text-[11px] leading-5 font-semibold tracking-wider whitespace-nowrap transition-colors hover:border-data-dim ${statusTone}`}
        >
          任务 · {mission.title}
          {state.status === 'success' ? ' · 已完成' : state.status === 'failed' ? ' · 失败' : ''}
          <span className="ml-1 text-ink-faint">{open ? '▴' : '▾'}</span>
        </button>
        {mission.objectives.map((objective, i) => {
          const status = state.objectives[i]?.status ?? 'pending';
          const mark = OBJECTIVE_MARK[status];
          const progress = objectiveProgress(objective.spec, status, telemetry, stats, state);
          return (
            <span key={objective.id} className="flex items-baseline gap-1 whitespace-nowrap" data-testid={`objective-${objective.id}`} data-status={status}>
              <span className={`font-semibold ${mark.tone}`}>{mark.mark}</span>
              <span className={status === 'pending' ? 'text-ink' : mark.tone}>
                {objective.title}
                {objective.optional ? <span className="text-ink-faint">（附加）</span> : null}
              </span>
              {progress && <span className="readout text-[11px] text-data">{progress}</span>}
            </span>
          );
        })}
      </div>
      {open && (
        <ol className="max-w-[640px] list-decimal pb-1 pl-5 text-left text-[11px] leading-relaxed text-ink-dim" data-testid="mission-plan">
          {mission.flightPlan.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
