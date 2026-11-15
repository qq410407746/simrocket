import { Component, type ReactNode, useEffect, useMemo } from 'react';
import { FlightHud } from '@/components/hud/FlightHud';
import { MainMenu } from '@/components/menu/MainMenu';
import { LoadingOverlay, SimErrorBanner, WebGLUnsupported } from '@/components/ui/Overlays';
import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { findMission } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { SceneRoot } from '@/rendering/SceneRoot';
import { useGameStore } from '@/stores/gameStore';
import { createSimulationConfig, simRuntime } from '@/stores/simRuntime';

const detectWebGL2 = (): boolean => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
};

/** 三维场景出错时（例如显卡驱动问题导致上下文创建失败）显示说明，而不是白屏。 */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[scene]', error);
  }

  override render(): ReactNode {
    return this.state.failed ? <WebGLUnsupported /> : this.props.children;
  }
}

/**
 * 应用根组件。分层：
 *   底层  三维场景（SceneRoot，始终存在；主菜单与飞行界面共用同一个场景）
 *   上层  DOM 界面（主菜单 / 飞行 HUD），默认不拦截指针事件，只有面板本身可交互
 */
export function App() {
  const screen = useGameStore((s) => s.screen);
  const vehicleId = useGameStore((s) => s.vehicleId);
  const siteId = useGameStore((s) => s.siteId);
  const startMode = useGameStore((s) => s.startMode);
  const missionId = useGameStore((s) => s.missionId);
  const launchSerial = useGameStore((s) => s.launchSerial);
  const webgl = useMemo(detectWebGL2, []);

  // 玩家选择的火箭、发射场或出发点变化、或开始一个任务时，以新配置重新开始模拟。
  // launchSerial 只用来触发重新开始：同一个任务再飞一次时其余依赖都没有变。
  useEffect(() => {
    simRuntime.start(createSimulationConfig(getVehicleOrDefault(vehicleId), getLaunchSiteOrDefault(siteId), startMode), {
      siteId,
      start: startMode,
      mission: findMission(missionId) ?? null,
    });
  }, [vehicleId, siteId, startMode, missionId, launchSerial]);

  useEffect(() => () => simRuntime.stop(), []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black" data-screen={screen}>
      {webgl ? (
        <SceneErrorBoundary>
          <SceneRoot />
        </SceneErrorBoundary>
      ) : (
        <WebGLUnsupported />
      )}
      <div className="pointer-events-none absolute inset-0">{screen === 'menu' ? <MainMenu /> : <FlightHud />}</div>
      <LoadingOverlay />
      <SimErrorBanner />
    </div>
  );
}
