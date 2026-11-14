import { ControlBar } from './ControlBar';
import { FlightFeed } from './FlightFeed';
import { FlightSummary } from './FlightSummary';
import { MapOverlay } from './MapOverlay';
import { NavBall } from './NavBall';
import { TelemetryPanel } from './TelemetryPanel';
import { TopBar } from './TopBar';
import { useFlightControls } from './useFlightControls';
import { VehiclePanel } from './VehiclePanel';

/**
 * 飞行主界面：顶部状态栏、左右仪表面板、中下方导航球、底部控制条。
 * 中间区域不拦截指针事件，留给三维画面的视角拖拽。
 */
export function FlightHud() {
  useFlightControls();
  return (
    <div className="relative flex h-full flex-col gap-3 p-3" data-testid="flight-hud">
      <TopBar />
      <div className="flex min-h-0 flex-1 items-stretch justify-between gap-3">
        <div className="scroll-thin pointer-events-auto max-h-full self-start overflow-y-auto rounded-lg">
          <TelemetryPanel />
        </div>
        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col items-center justify-between">
          <FlightFeed />
          <div className="absolute top-0 left-0">
            <MapOverlay />
          </div>
          <NavBall />
        </div>
        <div className="scroll-thin pointer-events-auto max-h-full self-start overflow-y-auto rounded-lg">
          <VehiclePanel />
        </div>
      </div>
      <ControlBar />
      <FlightSummary />
    </div>
  );
}
