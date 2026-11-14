import { getVehicleOrDefault } from '@/data/vehicles';
import type { FlightEvent } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatDuration, formatNumber } from '@/utils/format';

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
};

/**
 * 根据当前物理状态给出一句操作提示（面向没有航天知识的玩家）。
 * 没有需要提示的情况时返回 null。
 */
export const flightHint = (t: Telemetry | null, vehicle: VehicleDefinition): { text: string; tone: 'info' | 'warn' } | null => {
  if (!t) return null;
  if (t.phase === 'prelaunch') {
    if (!t.ignited) return { text: '按 空格 点火起飞', tone: 'info' };
    if (t.throttle <= 0) return { text: '节流阀为 0：按 Z 或 ↑ 增大推力', tone: 'warn' };
    if (t.thrust > 0 && t.thrustToWeight <= 1) {
      return { text: `推力不足，无法离开发射台（推重比 ${formatNumber(t.thrustToWeight, 2)}）——增大节流`, tone: 'warn' };
    }
    return null;
  }
  if (t.phase !== 'flight') return null;
  const stage = vehicle.stages[t.activeStageIndex];
  if (stage && (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0) {
    return { text: `${stage.name}推进剂耗尽：按 空格 分离`, tone: 'warn' };
  }
  if (t.ignited && t.throttle <= 0 && stage) return { text: '发动机已关机：按 Z 或 ↑ 恢复推力', tone: 'info' };
  if (t.altitude < 20_000 && t.verticalSpeed < -20) return { text: '正在下降，高度不足', tone: 'warn' };
  if (t.dynamicPressure > 5_000 && t.angleOfAttack > 0.35) return { text: '动压较大时迎角过大：让头部靠近速度方向', tone: 'warn' };
  if (t.missionTime !== null && t.missionTime < 12 && t.pitch > 1.55) return { text: '速度达到约 60 m/s 后，按住 D 向东缓慢倾斜（重力转弯）', tone: 'info' };
  return null;
};

/** 屏幕上方居中的操作提示与最近的飞行事件。 */
export function FlightFeed() {
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const telemetry = useSimStore((s) => s.telemetry);
  const events = useSimStore((s) => s.events);
  const liftoffTime = useSimStore((s) => s.liftoffTime);
  const hint = flightHint(telemetry, vehicle);
  const recent = events.slice(-4);

  return (
    <div className="pointer-events-none flex flex-col items-center gap-2">
      {hint && (
        <div
          className={`panel-frame rounded-md px-3 py-1 text-[12px] backdrop-blur-md ${hint.tone === 'warn' ? 'text-warn' : 'text-data'}`}
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
