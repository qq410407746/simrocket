import { findLaunchSite } from '@/data/launchSites';
import { findMission } from '@/data/missions';
import { findVehicle } from '@/data/vehicles';
import { useI18n } from '@/i18n';
import { localizeMission } from '@/i18n/catalog';
import { useCareerStore } from '@/stores/careerStore';
import { formatDuration, formatNumber } from '@/utils/format';
import { GRADE_TONE, logDate, logOrbit, logResult } from '../hud/missionLabels';

/** 飞行记录：最近的飞行，每次一条摘要（最新的在前）。 */
export function LogbookMenu() {
  const { language, t } = useI18n();
  const logbook = useCareerStore((s) => s.logbook);
  const resetCareer = useCareerStore((s) => s.resetCareer);

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="logbook">
      <div className="mb-1.5 flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('飞行记录', 'Flight log')}</h2>
        <span className="readout text-[10px] text-ink-faint">{t(`${logbook.length} 条`, `${logbook.length} ${logbook.length === 1 ? 'entry' : 'entries'}`)}</span>
      </div>
      {logbook.length === 0 ? (
        <p className="rounded-md border border-line/60 bg-panel/40 px-3 py-4 text-center text-[12px] leading-relaxed text-ink-dim" data-testid="logbook-empty">
          {t('还没有飞行记录。', 'No flights recorded yet.')}
          <br />
          {t('每次飞行结束（着陆、损毁，或任务有了结论）都会在这里留下一条。', 'Each flight leaves a record here when it ends (landing, destruction or a mission result).')}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {logbook.map((entry) => {
            const definition = findMission(entry.missionId);
            const mission = definition ? localizeMission(definition, language) : null;
            const vehicle = findVehicle(entry.vehicleId);
            const site = findLaunchSite(entry.siteId);
            const result = logResult(entry, language);
            const orbit = logOrbit(entry.orbit);
            return (
              <li key={entry.id} className="rounded-md border border-line bg-panel/40 px-2.5 py-1.5" data-testid="logbook-entry" data-result={entry.result}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{mission ? mission.title : t('自由飞行', 'Free flight')}</span>
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className={`text-[11px] ${result.tone}`}>{result.text}</span>
                    {entry.grade && entry.score !== null && (
                      <>
                        <span className={`text-[14px] leading-none font-bold ${GRADE_TONE[entry.grade]}`}>{entry.grade}</span>
                        <span className="readout text-[10px] text-ink-faint">{entry.score}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="readout mt-0.5 flex flex-wrap gap-x-2.5 text-[10px] text-ink-faint">
                  <span>{logDate(entry.date)}</span>
                  <span>
                    {vehicle ? t(vehicle.nameZh, vehicle.name) : entry.vehicleId} · {site ? t(site.nameZh, site.name) : '—'}
                    {entry.start === 'orbit' ? t(' · 轨道出发', ' · Orbital start') : ''}
                  </span>
                  <span>T+{formatDuration(entry.duration)}</span>
                </div>
                <div className="readout mt-0.5 flex flex-wrap gap-x-2.5 text-[10.5px] text-ink-dim">
                  <span>{t('最高', 'Peak altitude')} {formatNumber(entry.maxAltitude / 1000, 0)} km</span>
                  <span>{formatNumber(entry.maxGLoad, 1)} g</span>
                  {orbit ? <span className="text-data-dim">{orbit}</span> : <span>{t('航程', 'Range')} {formatNumber(entry.downrange / 1000, 0)} km</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t('清空全部任务进度与飞行记录？此操作无法撤销。', 'Clear all mission progress and flight records? This cannot be undone.'))) resetCareer();
        }}
        data-testid="reset-career"
        className="mt-3 self-start rounded border border-line px-2 py-0.5 text-[10px] text-ink-faint transition-colors hover:border-danger hover:text-danger"
      >
        {t('清空任务进度与飞行记录', 'Clear mission progress and flight log')}
      </button>
    </section>
  );
}
