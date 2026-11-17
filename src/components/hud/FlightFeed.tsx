import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { findMission } from '@/data/missions';
import { useVehicleDefinition } from '@/stores/designStore';
import { DEG2RAD } from '@/game/physics/constants';
import type { FlightEvent } from '@/game/simulation/types';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import { type Language, createTranslator } from '@/i18n/locale';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatDuration } from '@/utils/format';
import { missionFlightHint } from './missionHints';
import { MissionStrip } from './MissionStrip';

const stageName = (vehicle: VehicleDefinition, index: number, language: Language = 'zh'): string => dataText(vehicle.stages[index]?.name ?? '', language);

/** 事件 → 界面文字。 */
export const describeEvent = (event: FlightEvent, vehicle: VehicleDefinition, language: Language = 'zh'): string => {
  const t = createTranslator(language);
  switch (event.kind) {
    case 'ignition':
      return t(`${stageName(vehicle, event.stageIndex, language)}发动机点火`, `${stageName(vehicle, event.stageIndex, language)} engine ignition`);
    case 'liftoff':
      return t('起飞', 'Liftoff');
    case 'depleted':
      return event.stageIndex < vehicle.stages.length ? t(`${stageName(vehicle, event.stageIndex, language)}推进剂耗尽`, `${stageName(vehicle, event.stageIndex, language)} propellant depleted`) : t('飞船推进剂耗尽', 'Spacecraft propellant depleted');
    case 'separation':
      return t(`${stageName(vehicle, event.stageIndex, language)}分离`, `${stageName(vehicle, event.stageIndex, language)} separated`);
    case 'fairing':
      return t('整流罩分离', 'Fairing separated');
    case 'heat-shield':
      return t('防热大底分离', 'Heat shield separated');
    case 'payload-ignition':
      return t('飞船发动机点火', 'Spacecraft engine ignition');
    case 'drogue-deployed':
      return t('减速伞张开', 'Drogue parachute deployed');
    case 'main-deployed':
      return t('主伞张开', 'Main parachute deployed');
    case 'parachute-failed':
      return t('降落伞被撕毁', 'Parachute torn apart');
    case 'landed':
      return t('着陆', 'Landing');
    case 'destroyed':
      return t('飞行器损毁', 'Vehicle destroyed');
  }
};

const TONE: Partial<Record<FlightEvent['kind'], string>> = {
  liftoff: 'text-ok',
  landed: 'text-ok',
  destroyed: 'text-danger',
  depleted: 'text-warn',
  'drogue-deployed': 'text-ok',
  'main-deployed': 'text-ok',
  'parachute-failed': 'text-danger',
};

/** 屏幕上方居中的任务条、操作提示与最近的飞行事件。 */
export function FlightFeed() {
  const { language } = useI18n();
  const vehicle = useVehicleDefinition(useGameStore((s) => s.vehicleId));
  const site = getLaunchSiteOrDefault(useGameStore((s) => s.siteId));
  const telemetry = useSimStore((s) => s.telemetry);
  const events = useSimStore((s) => s.events);
  const liftoffTime = useSimStore((s) => s.liftoffTime);
  const mission = findMission(useSimStore((s) => s.missionId)) ?? null;
  const missionState = useSimStore((s) => s.mission);
  const mapMode = useGameStore((s) => s.cameraMode === 'map');
  const hint = missionFlightHint(telemetry, vehicle, mission, missionState, site.latitudeDeg * DEG2RAD, language);
  const recent = events.slice(-4);

  return (
    // 地图视角下左上角是地图图例（宽 15rem）：提示与事件记录让到它的右边
    <div className={`pointer-events-none flex w-full flex-col items-center gap-2 ${mapMode ? 'pl-[15.75rem]' : ''}`}>
      <MissionStrip />
      {hint && (
        <div
          className={`panel-frame max-w-full rounded-md px-3 py-1 text-center text-[12px] leading-snug backdrop-blur-md ${hint.tone === 'warn' ? 'text-warn' : 'text-data'}`}
          data-testid="flight-hint"
        >
          {hint.text}
        </div>
      )}
      {recent.length > 0 && (
        <ol className="flex flex-col items-center gap-0.5" data-testid="event-log">
          {recent.map((event, i) => {
            const met = liftoffTime === null ? null : event.time - liftoffTime;
            return (
              <li
                key={`${event.kind}-${event.time}-${event.stageIndex}`}
                className="readout rounded bg-void/55 px-2 text-[11px]"
                style={{ opacity: 0.45 + (0.55 * (i + 1)) / recent.length }}
              >
                <span className="text-ink-faint">{met === null || met < 0 ? 'T−' : `T+${formatDuration(met)}`}</span>{' '}
                <span className={TONE[event.kind] ?? 'text-ink'}>{describeEvent(event, vehicle, language)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
