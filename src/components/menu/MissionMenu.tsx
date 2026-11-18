import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { MISSION_CATALOG, findMission } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { completedCount, isMissionUnlocked, progressOf } from '@/game/missions/career';
import { comboLabel, launchGuidance } from '@/game/missions/guidance';
import type { MissionDefinition } from '@/game/missions/types';
import { DEG2RAD } from '@/game/physics/constants';
import { ORBIT_START_ALTITUDE } from '@/game/simulation/startConditions';
import { useI18n } from '@/i18n';
import { localizeMission } from '@/i18n/catalog';
import { useCareerStore } from '@/stores/careerStore';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { CATEGORY_LABEL, GRADE_TONE } from '../hud/missionLabels';

const padDegrees = (value: number): string => String(Math.round(value) % 360).padStart(3, '0');
const CATEGORY_EN = { suborbital: 'Suborbital', orbital: 'Low Earth orbit', return: 'Return', advanced: 'Advanced orbit' };

/** 任务列表：按目录顺序排列，显示解锁与完成情况。 */
export function MissionList() {
  const { language, t } = useI18n();
  const selectedId = useGameStore((s) => s.selectedMissionId);
  const selectMission = useGameStore((s) => s.selectMission);
  const progress = useCareerStore((s) => s.progress);
  const unlockAll = useCareerStore((s) => s.unlockAll);

  return (
    <section data-testid="mission-list">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('任务', 'Missions')}</h2>
        <span className="readout text-[10px] text-ink-faint" data-testid="mission-progress">
          {t('已完成', 'Completed')} {completedCount(MISSION_CATALOG, progress)} / {MISSION_CATALOG.length}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {MISSION_CATALOG.map((definition, index) => {
          const mission = localizeMission(definition, language);
          const record = progressOf(progress, definition.id);
          const unlocked = isMissionUnlocked(definition, progress, unlockAll);
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
                    {t(CATEGORY_LABEL[mission.category], CATEGORY_EN[mission.category])} · {t(vehicle.nameZh, vehicle.name)} · {t(site.nameZh, site.name)}
                    {mission.start === 'orbit' ? t(' · 从轨道出发', ' · Orbital start') : ''}
                  </span>
                </span>
                {record.completed && record.bestGrade ? (
                  <span className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className={`text-[18px] leading-none font-bold ${GRADE_TONE[record.bestGrade]}`}>{record.bestGrade}</span>
                    <span className="readout text-[10px] text-ink-faint">{record.bestScore}</span>
                  </span>
                ) : (
                  <span className={`text-[10px] whitespace-nowrap ${unlocked ? 'text-data-dim' : 'text-ink-faint'}`}>{unlocked ? t('未完成', 'Incomplete') : t('未解锁', 'Locked')}</span>
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
  const { t } = useI18n();
  if (!mission.launch) return null;
  const site = getLaunchSiteOrDefault(mission.siteId);
  const guidance = launchGuidance(mission, site.latitudeDeg * DEG2RAD);
  return (
    <p className="rounded border border-line/70 bg-void/40 px-2 py-1 text-[11px] leading-relaxed text-ink-dim" data-testid="launch-note">
      {t('理论发射方位角', 'Theoretical launch azimuth')} <span className="readout text-data">{padDegrees(guidance.azimuthDeg)}°</span>{t('（已扣除地球自转）。起飞倾斜按', ' (Earth’s rotation accounted for). Initial tilt:')}{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.lower)}</kbd>{t(`（航向 ${padDegrees(guidance.keyHeadingDeg)}°）；飞行中增大倾角按`, ` (heading ${padDegrees(guidance.keyHeadingDeg)}°); during flight, increase inclination with`)}{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.increaseInclination)}</kbd>{t('，减小按', ', decrease with')}{' '}
      <kbd className="readout rounded-sm border border-line bg-raised px-1 text-ink">{comboLabel(guidance.decreaseInclination)}</kbd>{t('。', '.')}
    </p>
  );
}

/** 任务简报：背景、目标、评分项、飞行步骤，以及"开始任务"。 */
export function MissionBriefing() {
  const { language, t } = useI18n();
  const selectedId = useGameStore((s) => s.selectedMissionId);
  const startMission = useGameStore((s) => s.startMission);
  const progress = useCareerStore((s) => s.progress);
  const unlockAll = useCareerStore((s) => s.unlockAll);
  const definition = findMission(selectedId) ?? (MISSION_CATALOG[0] as MissionDefinition);
  const mission = localizeMission(definition, language);
  const vehicle = getVehicleOrDefault(mission.vehicleId);
  const site = getLaunchSiteOrDefault(mission.siteId);
  const record = progressOf(progress, mission.id);
  const unlocked = isMissionUnlocked(definition, progress, unlockAll);
  const missing = definition.requires.filter((id) => !progressOf(progress, id).completed).map((id) => {
    const required = findMission(id);
    return required ? localizeMission(required, language).title : id;
  });

  return (
    <div
      className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[500px] flex-col gap-2.5 overflow-y-auto rounded-xl px-5 py-3.5 backdrop-blur-md"
      data-testid="mission-briefing"
    >
      <header>
        <p className="text-[10px] tracking-[0.2em] text-data-dim">
          {t('任务简报', 'Mission briefing')} · {t(CATEGORY_LABEL[mission.category], CATEGORY_EN[mission.category])} · {t(vehicle.nameZh, vehicle.name)} · {t(site.nameZh, site.name)}
          {mission.start === 'orbit' ? t(` · 从 ${ORBIT_START_ALTITUDE / 1000} km 轨道出发`, ` · Start in a ${ORBIT_START_ALTITUDE / 1000} km orbit`) : ''}
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
        <Heading>{t('目标', 'Objectives')}</Heading>
        <ul className="flex flex-col gap-0.5 text-[12px] text-ink" data-testid="briefing-objectives">
          {mission.objectives.map((objective) => (
            <li key={objective.id} className="flex items-baseline gap-1.5">
              <span className="text-data-dim">○</span>
              <span>
                {objective.title}
                {objective.optional ? <span className="text-ink-faint">{t('（附加目标）', ' (optional objective)')}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Heading>{t('评分（满分 100）', 'Scoring (out of 100)')}</Heading>
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
        <p className="mt-1 text-[10px] text-ink-faint">{t('评级：S ≥ 90，A ≥ 80，B ≥ 65，其余为 C。评分只统计成功完成的飞行。', 'Grades: S ≥ 90, A ≥ 80, B ≥ 65; otherwise C. Only successful flights are scored.')}</p>
      </section>

      <section>
        <Heading>{t('飞行步骤', 'Flight plan')}</Heading>
        <ol className="list-decimal pl-4 text-[11.5px] leading-relaxed text-ink-dim" data-testid="briefing-plan">
          {mission.flightPlan.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-1 text-[10px] text-ink-faint">{t('飞行中点击屏幕上方的任务名可以再次查看这些步骤。', 'During flight, click the mission title at the top of the screen to review these steps.')}</p>
      </section>

      <LaunchNote mission={definition} />

      <div className="mt-auto flex flex-col gap-1.5 pt-1">
        {record.attempts > 0 && (
          <p className="text-[11px] text-ink-dim" data-testid="briefing-record">
            {record.completed && record.bestGrade ? (
              <>
                {t('最好成绩', 'Best result')} <span className={`font-bold ${GRADE_TONE[record.bestGrade]}`}>{record.bestGrade}</span>{' '}
                <span className="readout text-ink">{record.bestScore}</span>{t(' 分', ' points')}
              </>
            ) : (
              t('尚未完成', 'Not yet completed')
            )}
            <span className="text-ink-faint">{t(` · 已飞 ${record.attempts} 次`, ` · ${record.attempts} ${record.attempts === 1 ? 'flight' : 'flights'}`)}</span>
          </p>
        )}
        <button
          type="button"
          disabled={!unlocked}
          onClick={() => {
            simRuntime.setTimeWarp(1);
            simRuntime.setPaused(false);
            startMission(definition.id);
          }}
          data-testid="start-mission"
          className="rounded-md border border-data bg-data/15 px-4 py-2.5 text-[15px] font-semibold tracking-[0.3em] text-data transition-colors hover:bg-data/25 disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-[12px] disabled:tracking-normal disabled:text-ink-faint"
        >
          {unlocked ? t('开始任务', 'Start mission') : t(`需要先完成：${missing.join('、')}`, `Complete first: ${missing.join(', ')}`)}
        </button>
      </div>
    </div>
  );
}
