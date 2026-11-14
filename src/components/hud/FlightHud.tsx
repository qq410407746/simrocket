import { ControlBar } from './ControlBar';
import { TelemetryPanel } from './TelemetryPanel';
import { TopBar } from './TopBar';
import { useFlightHotkeys } from './useFlightHotkeys';
import { VehiclePanel } from './VehiclePanel';

/** 飞行主界面：顶部状态栏、左右仪表面板、底部控制条。中间留给三维画面。 */
export function FlightHud() {
  useFlightHotkeys();
  return (
    <div className="flex h-full flex-col gap-3 p-3" data-testid="flight-hud">
      <TopBar />
      <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
        <div className="scroll-thin pointer-events-auto max-h-full overflow-y-auto rounded-lg">
          <TelemetryPanel />
        </div>
        <div className="scroll-thin pointer-events-auto max-h-full overflow-y-auto rounded-lg">
          <VehiclePanel />
        </div>
      </div>
      <ControlBar />
    </div>
  );
}
