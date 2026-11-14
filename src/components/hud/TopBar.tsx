import { julianDateAt } from '@/game/physics/ephemeris/time';
import type { FlightPhase } from '@/game/vehicles/types';
import { useGameStore } from '@/stores/gameStore';
import { usePerfStore } from '@/stores/perfStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { formatDuration, formatUtc } from '@/utils/format';
import { HudButton } from '../ui/HudButton';

const PHASE_LABEL: Record<FlightPhase, { text: string; code: string; tone: string }> = {
  prelaunch: { text: '发射台待命', code: 'PRE-LAUNCH', tone: 'border-data/60 text-data' },
  flight: { text: '飞行中', code: 'FLIGHT', tone: 'border-ok/60 text-ok' },
  landed: { text: '已着陆', code: 'LANDED', tone: 'border-ok/60 text-ok' },
  destroyed: { text: '飞行器损毁', code: 'LOSS OF VEHICLE', tone: 'border-danger/60 text-danger' },
};

/** 顶部状态栏：任务阶段、任务时钟、UTC、实测性能。 */
export function TopBar() {
  const telemetry = useSimStore((s) => s.telemetry);
  const epoch = useSimStore((s) => s.epochJulianDate);
  const execution = useSimStore((s) => s.execution);
  const fps = usePerfStore((s) => s.fps);
  const returnToMenu = useGameStore((s) => s.returnToMenu);

  const phase = PHASE_LABEL[telemetry?.phase ?? 'prelaunch'];
  const simTime = telemetry?.simTime ?? 0;
  const prelaunch = (telemetry?.phase ?? 'prelaunch') === 'prelaunch';

  return (
    <header className="panel-frame pointer-events-auto flex h-12 items-center justify-between gap-4 rounded-lg px-4 backdrop-blur-md" data-testid="top-bar">
      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-bold tracking-[0.22em] text-ink">ORBITAL FRONTIER</span>
          <span className="text-[11px] tracking-widest text-data-dim">轨道边疆</span>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] ${phase.tone}`} data-testid="flight-phase">
          {phase.text}
          <span className="ml-2 text-[9px] tracking-[0.18em] opacity-70">{phase.code}</span>
        </span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2" title="任务时间从起飞瞬间开始计时（起飞动力学在阶段二实现）">
          <span className="text-[10px] tracking-[0.18em] text-ink-faint">MET</span>
          <span className="readout text-[20px] font-semibold text-ink" data-testid="mission-clock">
            {prelaunch ? 'T− 00:00:00' : `T+ ${formatDuration(simTime)}`}
          </span>
          {prelaunch && <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">HOLD · 待命</span>}
        </div>
        <div className="hidden flex-col items-end leading-tight lg:flex">
          <span className="readout text-[12px] text-ink-dim" data-testid="utc-clock">
            {epoch === null ? '—' : formatUtc(julianDateAt(epoch, simTime))}
          </span>
          <span className="readout text-[10px] text-ink-faint" data-testid="sim-elapsed">
            模拟历时 {formatDuration(simTime)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="hidden flex-col items-end leading-tight md:flex" title="实测帧率；物理计算位置">
          <span className="readout text-[12px] text-ink-dim" data-testid="fps">
            {fps > 0 ? `${fps.toFixed(0)} FPS` : '— FPS'}
          </span>
          <span className="text-[10px] text-ink-faint">
            物理：{execution === 'worker' ? 'Web Worker' : execution === 'main-thread' ? '主线程（降级）' : '—'}
          </span>
        </div>
        <HudButton
          onClick={() => {
            const { config } = simRuntime;
            returnToMenu();
            // 回到主菜单时把模拟复位到发射台初始状态。
            if (config) simRuntime.start(config);
          }}
          testId="menu-button"
        >
          主菜单
        </HudButton>
      </div>
    </header>
  );
}
