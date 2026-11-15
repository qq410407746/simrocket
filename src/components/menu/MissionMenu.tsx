import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { MISSION_CATALOG, findMission } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { completedCount, isMissionUnlocked, progressOf } from '@/game/missions/career';
import { comboLabel, launchGuidance } from '@/game/missions/guidance';
import type { MissionDefinition } from '@/game/missions/types';
import { DEG2RAD } from '@/game/physics/constants';
import { ORBIT_START_ALTITUDE } from '@/game/simulation/startConditions';
import { useCareerStore } from '@/stores/careerStore';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { CATEGORY_LABEL, GRADE_TONE } from '../hud/missionLabels';

const padDegrees = (value: number): string => String(Math.round(value) % 360).padStart(3, '0');

/** 任务列表：按目录顺序排列，显示解锁与完成情况。 */
export function MissionList() {
  const selectedId = useGameStore((s) => s.selectedMissionId);
  const selectMission = useGameStore((s) => s.selectMission);
  const progress = useCareerStore((s) => s.progress);
  const unlockAll = useCareerStore((s) => s.unlockAll);

  return (
    <section data-testid="mission-list">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint">任务</h2>
        <span className="readout text-[10px] text-ink-faint" data-testid="mission-progress">
          已完成 {completedCount(MISSION_CATALOG, progress)} / {MISSION_CATALOG.length}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {MISSION_CATALOG.map((mission, index) => {
          const record = progressOf(progress, mission.id);
          const unlocked = isMissionUnlocked(mission, progress, unlockAll);
          const selected = mission.id === selectedId;
          const vehicle = getVehicleOrDefault(mission.vehicleId);
          const site = getLaunchSiteOrDefault(mission.siteId);
          return (
            <li key={mission.id}>
              <button
                type="button"
                onClick={() => selectMission(mission.id)}
                aria-pressed={selected}
                data-testid={`mission-${mission.id}`}
                data-state={record.completed ? 'completed' : unlocked ? 'open' : 'locked'}
                className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                  selected ? 'border-data bg-data/10 shadow-[0_0_18px_rgb(95_212_255/0.18)]' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
                } ${unlocked ? '' : 'opacity-55'}`}
              >
                <span className="readout w-4 text-center text-[12px] text-ink-faint">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{mission.title}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {CATEGORY_LABEL[mission.category]} · {vehicle.nameZh} · {site.nameZh}
                    {mission.start === 'orbit' ? ' · 从轨道出发' : ''}
                  </span>
                </span>
                {record.completed && record.bestGrade ? (
                  <span className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className={`text-[18px] leading-none font-bold ${GRADE_TONE[record.bestGrade]}`}>{record.bestGrade}</span>
                    <span className="readout text-[10px] text-ink-faint">{record.bestScore}</span>
                  </span>
                ) : (
                  <span className={`text-[10px] whitespace-nowrap ${unlocked ? 'text-data-dim' : 'text-ink-faint'}`}>{unlocked ? '未完成' : '未解锁'}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Heading({ children }: { children: string }) {
  return <h3 className="mb-1 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{children}</h3>;
}

/** 发射方向的说明：只有不是向正东发射的任务才显示。 */
function LaunchNote({ mission }: { mission: MissionDefinition }) {
  if (!mission.launch) return null;
  const site = getLaunchSiteOrDefault(mission.siteId);
  const guidance = launchGuidance(mission, site.latitudeDeg * DEG2RAD);
  return (
    <p className="rounded border border-line/70 bg-void/40 px-2 py-1 text-[11px] leading-relaxed text-ink-dim" data-testid="launch-note">
      理论发射方位角 <span className="readout text-data">{padDegrees(guidance.azimuthDeg)}°</span>（已扣除地球自转）。起飞倾斜按{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.lower)}</kbd>（航向 {padDegrees(guidance.keyHeadingDeg)}°）；飞行中增大倾角按{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.increaseInclination)}</kbd>，减小按{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.decreaseInclination)}</kbd>。
    </p>
  );
}

/** 任务简报：背景、目标、评分项、飞行步骤，以及"开始任务"。 */
export function MissionBriefing() {
  const selectedId = useGameStore((s) => s.selectedMissionId);
  const startMission = useGameStore((s) => s.startMission);
  const progress = useCareerStore((s) => s.progress);
  const unlockAll = useCareerStore((s) => s.unlockAll);
  const mission = findMission(selectedId) ?? (MISSION_CATALOG[0] as MissionDefinition);
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = getLaunchSiteOrDefault(mission.siteId);
  const record = progressOf(progress, mission.id);
  const unlocked = isMissionUnlocked(mission, progress, unlockAll);
  const missing = mission.requires.filter((id) => !progressOf(progress, id).completed).map((id) => findMission(id)?.title ?? id);

  return (
    <div
      className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[500px] flex-col gap-2.5 overflow-y-auto rounded-xl px-5 py-3.5 backdrop-blur-md"
      data-testid="mission-briefing"
    >
      <header>
        <p className="text-[10px] tracking-[0.2em] text-data-dim">
          任务简报 · {CATEGORY_LABEL[mission.category]} · {vehicle.nameZh} · {site.nameZh}
          {mission.start === 'orbit' ? ` · 从 ${ORBIT_START_ALTITUDE / 1000} km 轨道出发` : ''}
        </p>
        <h2 className="mt-1 text-[20px] leading-tight font-bold tracking-wider text-ink" data-testid="briefing-title">
          {mission.title}
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-data">{mission.summary}</p>
      </header>

      <section className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-ink-dim">
        {mission.briefing.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>

      <section>
        <Heading>目标</Heading>
        <ul className="flex flex-col gap-0.5 text-[12px] text-ink" data-testid="briefing-objectives">
          {mission.objectives.map((objective) => (
            <li key={objective.id} className="flex items-baseline gap-1.5">
              <span className="text-data-dim">○</span>
              <span>
                {objective.title}
                {objective.optional ? <span className="text-ink-faint">（附加目标）</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Heading>评分（满分 100）</Heading>
        <table className="w-full text-[11px]" data-testid="briefing-scoring">
          <tbody>
            {mission.scoring.map((item) => (
              <tr key={item.id} className="border-b border-line/30 align-baseline">
                <td className="py-0.5 pr-2 whitespace-nowrap text-ink">{item.label}</td>
                <td className="readout py-0.5 pr-2 text-right text-data">{item.weight}</td>
                <td className="py-0.5 leading-snug text-ink-dim">{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-ink-faint">评级：S ≥ 90，A ≥ 80，B ≥ 65，其余为 C。评分只统计成功完成的飞行。</p>
      </section>

      <section>
        <Heading>飞行步骤</Heading>
        <ol className="list-decimal pl-4 text-[11.5px] leading-relaxed text-ink-dim" data-testid="briefing-plan">
          {mission.flightPlan.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-1 text-[10px] text-ink-faint">飞行中点击屏幕上方的任务名可以再次查看这些步骤。</p>
      </section>

      <LaunchNote mission={mission} />

      <div className="mt-auto flex flex-col gap-1.5 pt-1">
        {record.attempts > 0 && (
          <p className="text-[11px] text-ink-dim" data-testid="briefing-record">
            {record.completed && record.bestGrade ? (
              <>
                最好成绩 <span className={`font-bold ${GRADE_TONE[record.bestGrade]}`}>{record.bestGrade}</span>{' '}
                <span className="readout text-ink">{record.bestScore}</span> 分
              </>
            ) : (
              '尚未完成'
            )}
            <span className="text-ink-faint"> · 已飞 {record.attempts} 次</span>
          </p>
        )}
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => {
            simRuntime.setTimeWarp(1);
            simRuntime.setPaused(false);
            startMission(mission.id);
          }}
          data-testid="start-mission"
          className="rounded-md border border-data bg-data/15 px-4 py-2.5 text-[15px] font-semibold tracking-[0.3em] text-data transition-colors hover:bg-data/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-[12px] disabled:tracking-normal disabled:text-ink-faint"
        >
          {unlocked ? '开始任务' : `需要先完成：${missing.join('、')}`}
        </button>
      </div>
    </div>
  );
}
