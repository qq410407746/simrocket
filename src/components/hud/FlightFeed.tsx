import { getVehicleOrDefault } from '@/data/vehicles';
import type { FlightEvent } from '@/game/simulation/types';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatDuration } from '@/utils/format';
import { flightHint } from './flightHints';

const stageName = (vehicle: VehicleDefinition, index: number): string => vehicle.stages[index]?.name ?? '';

/** 事件 → 界面文字。 */
export const describeEvent = (event: FlightEvent, vehicle: VehicleDefinition): string => {
  switch (event.kind) {
    case 'ignition':
      return `${stageName(vehicle, event.stageIndex)}发动机点火`;
    case 'liftoff':
      return '起飞';
    case 'depleted':
      return event.stageIndex < vehicle.stages.length ? `${stageName(vehicle, event.stageIndex)}推进剂耗尽` : '飞船推进剂耗尽';
    case 'separation':
      return `${stageName(vehicle, event.stageIndex)}分离`;
    case 'fairing':
      return '整流罩分离';
    case 'payload-ignition':
      return '飞船发动机点火';
    case 'drogue-deployed':
      return '减速伞张开';
    case 'main-deployed':
      return '主伞张开';
    case 'parachute-failed':
      return '降落伞被撕毁';
    case 'landed':
      return '着陆';
    case 'destroyed':
      return '飞行器损毁';
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

/** 屏幕上方居中的操作提示与最近的飞行事件。 */
export function FlightFeed() {
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const telemetry = useSimStore((s) => s.telemetry);
  const events = useSimStore((s) => s.events);
  const liftoffTime = useSimStore((s) => s.liftoffTime);
  const mapMode = useGameStore((s) => s.cameraMode === 'map');
  const hint = flightHint(telemetry, vehicle);
  const recent = events.slice(-4);

  return (
    // 地图视角下左上角是地图图例（宽 15rem）：提示与事件记录让到它的右边
    <div className={`pointer-events-none flex w-full flex-col items-center gap-2 ${mapMode ? 'pl-[15.75rem]' : ''}`}>
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
                <span className={TONE[event.kind] ?? 'text-ink'}>{describeEvent(event, vehicle)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
