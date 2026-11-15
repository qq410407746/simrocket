import { julianDateAt } from '@/game/physics/ephemeris/time';
import type { Telemetry } from '@/game/telemetry/telemetry';
import { useGameStore } from '@/stores/gameStore';
import { usePerfStore } from '@/stores/perfStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { formatDuration, formatMissionTime, formatUtc } from '@/utils/format';
import { HudButton } from '../ui/HudButton';

/** 参考驻点热流超过该值 [W/m²] 时，界面把无动力下降称为"再入"。 */
const REENTRY_HEAT_FLUX = 50_000;

interface PhaseLabel {
  text: string;
  code: string;
  tone: string;
}

/** 由遥测状态得出界面上显示的飞行阶段。 */
const phaseLabel = (t: Telemetry | null): PhaseLabel => {
  if (!t || t.phase === 'prelaunch') {
    return t?.ignited
      ? { text: '发动机已点火', code: 'IGNITION', tone: 'border-warn/70 text-warn' }
      : { text: '发射台待命', code: 'PRE-LAUNCH', tone: 'border-data/60 text-data' };
  }
  if (t.phase === 'landed') return { text: '已着陆', code: 'LANDED', tone: 'border-ok/60 text-ok' };
  if (t.phase === 'destroyed') return { text: '飞行器损毁', code: 'LOSS OF VEHICLE', tone: 'border-danger/70 text-danger' };
  if (t.thrust > 0) return { text: '动力飞行', code: 'POWERED FLIGHT', tone: 'border-ok/60 text-ok' };
  if (t.parachute.phase === 'drogue' || t.parachute.phase === 'main') return { text: '伞降', code: 'PARACHUTE DESCENT', tone: 'border-ok/60 text-ok' };
  // 再入：无动力、正在下降，且气动加热已经明显，或仍在以超声速穿过大气层
  if (t.verticalSpeed < 0 && (t.referenceHeatFlux > REENTRY_HEAT_FLUX || (t.altitude < 90_000 && t.mach > 1.2 && t.airDensity > 0))) {
    return { text: '再入大气层', code: 'REENTRY', tone: 'border-warn/70 text-warn' };
  }
  if (t.verticalSpeed < -5 && t.altitude < 40_000) return { text: '下降', code: 'DESCENT', tone: 'border-data/60 text-data' };
  if (t.orbit?.classification === 'orbit') return { text: '在轨滑行', code: 'ON ORBIT', tone: 'border-ok/60 text-ok' };
  if (t.orbit?.classification === 'escape') return { text: '逃逸轨道', code: 'ESCAPE', tone: 'border-data/60 text-data' };
  return { text: '无动力滑行', code: 'COAST', tone: 'border-data/60 text-data' };
};

/** 顶部状态栏：任务阶段、任务时钟、UTC、实测性能。 */
export function TopBar() {
  const telemetry = useSimStore((s) => s.telemetry);
  const epoch = useSimStore((s) => s.epochJulianDate);
  const execution = useSimStore((s) => s.execution);
  const fps = usePerfStore((s) => s.fps);
  const returnToMenu = useGameStore((s) => s.returnToMenu);

  const phase = phaseLabel(telemetry);
  const simTime = telemetry?.simTime ?? 0;
  const missionTime = telemetry?.missionTime ?? null;

  return (
    <header className="panel-frame pointer-events-auto flex h-12 items-center justify-between gap-4 rounded-lg px-4 backdrop-blur-md" data-testid="top-bar">
      <div className="flex items-center gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-bold tracking-[0.22em] text-ink">ORBITAL FRONTIER</span>
          <span className="hidden text-[11px] tracking-widest text-data-dim xl:inline">轨道边疆</span>
        </div>
        <span className={`rounded border px-2 py-0.5 text-[11px] whitespace-nowrap ${phase.tone}`} data-testid="flight-phase">
          {phase.text}
          <span className="ml-2 hidden text-[9px] tracking-[0.18em] opacity-70 lg:inline">{phase.code}</span>
        </span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2" title="任务时间：自起飞瞬间开始计时">
          <span className="text-[10px] tracking-[0.18em] text-ink-faint">MET</span>
          <span className="readout text-[20px] font-semibold text-ink" data-testid="mission-clock">
            {formatMissionTime(missionTime)}
          </span>
          {missionTime === null && (
            <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-warn">HOLD · 待命</span>
          )}
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

      <div className="flex items-center gap-3">
        <div className="hidden flex-col items-end leading-tight md:flex" title="实测帧率；物理计算位置">
          <span className="readout text-[12px] text-ink-dim" data-testid="fps">
            {fps > 0 ? `${fps.toFixed(0)} FPS` : '— FPS'}
          </span>
          <span className="text-[10px] text-ink-faint">
            物理：{execution === 'worker' ? 'Web Worker' : execution === 'main-thread' ? '主线程（降级）' : '—'}
          </span>
        </div>
        <HudButton onClick={() => simRuntime.restart()} title="回到发射台，重新开始本次飞行" testId="restart-button">
          重新发射
        </HudButton>
        <HudButton
          onClick={() => {
            returnToMenu();
            // 回到主菜单时把模拟复位到发射台初始状态。
            simRuntime.restart();
          }}
          testId="menu-button"
        >
          主菜单
        </HudButton>
      </div>
    </header>
  );
}
