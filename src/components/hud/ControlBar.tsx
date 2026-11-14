import { getVehicleOrDefault } from '@/data/vehicles';
import { TIME_WARP_LEVELS } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { CAMERA_MODES, type CameraMode, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { HudButton } from '../ui/HudButton';

const CAMERA_LABEL: Record<CameraMode, { text: string; hint: string }> = {
  chase: { text: '跟随', hint: '跟随火箭，画面以当地水平面为基准（快捷键 1）' },
  free: { text: '自由', hint: '环绕火箭自由旋转，画面以惯性空间为基准（快捷键 2）' },
  pad: { text: '发射台', hint: '发射场地面跟踪机位（快捷键 3）' },
  orbit: { text: '轨道', hint: '环绕地球的远景视角（快捷键 4）' },
  map: { text: '地图', hint: '轨道地图：当前轨道、预测轨迹、远/近地点（快捷键 M 或 5）' },
};

/** 时间控制：暂停与时间倍率。超过当前物理状态允许上限的档位不可选。 */
function TimeControls() {
  const paused = useSimStore((s) => s.paused);
  const timeWarp = useSimStore((s) => s.timeWarp);
  const maxTimeWarp = useSimStore((s) => s.maxTimeWarp);
  const simRate = useSimStore((s) => s.simRate);
  const lagging = !paused && simRate < timeWarp * 0.95;

  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="time-controls">
      <span className="mr-1 text-[10px] tracking-[0.16em] text-ink-faint">时间</span>
      <HudButton
        active={paused}
        onClick={() => simRuntime.setPaused(!paused)}
        title="暂停 / 继续（快捷键 P）"
        testId="pause-button"
        ariaLabel={paused ? '继续' : '暂停'}
      >
        {paused ? '▶' : '❚❚'}
      </HudButton>
      {TIME_WARP_LEVELS.map((warp) => {
        const allowed = warp <= maxTimeWarp;
        return (
          <HudButton
            key={warp}
            active={!paused && timeWarp === warp}
            disabled={!allowed}
            onClick={() => {
              simRuntime.setTimeWarp(warp);
              if (paused) simRuntime.setPaused(false);
            }}
            title={
              allowed
                ? '时间倍率（快捷键 , 与 .）'
                : `当前最高 ${maxTimeWarp}×：发动机工作或操纵时限 5×，稠密大气内限 10×`
            }
            testId={`warp-${warp}`}
          >
            {warp}×
          </HudButton>
        );
      })}
      {lagging && (
        <span className="ml-1 text-[10px] text-warn" title="计算跟不上指令倍率，显示的是实际速率">
          实际 {simRate.toFixed(0)}×
        </span>
      )}
    </div>
  );
}

interface StageAction {
  label: string;
  hint: string;
  enabled: boolean;
  tone: 'go' | 'normal';
}

/** 「空格」键当前会执行什么。 */
const stageAction = (t: Telemetry | null, vehicle: VehicleDefinition): StageAction => {
  if (!t) return { label: '点火', hint: '', enabled: false, tone: 'normal' };
  if (t.phase === 'prelaunch') {
    return t.ignited
      ? { label: '已点火', hint: '发动机已启用；推力超过重量时自动离开发射台', enabled: false, tone: 'normal' }
      : { label: '点火起飞', hint: '发动机点火（空格）', enabled: true, tone: 'go' };
  }
  if (t.phase !== 'flight') return { label: '飞行结束', hint: '', enabled: false, tone: 'normal' };
  const stage = vehicle.stages[t.activeStageIndex];
  if (stage && !t.ignited && (t.stagePropellant[t.activeStageIndex] ?? 0) > 0) {
    return { label: `启动${stage.name}`, hint: `启用${stage.name}发动机（空格）；推力大小由节流阀决定`, enabled: true, tone: 'go' };
  }
  if (stage) {
    const next = vehicle.stages[t.activeStageIndex + 1];
    return {
      label: `分离${stage.name}`,
      hint: next ? `分离${stage.name}并点燃${next.name}（空格）` : `分离${stage.name}（空格）`,
      enabled: true,
      tone: (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0 ? 'go' : 'normal',
    };
  }
  if (vehicle.payload.engine && !t.ignited && t.payloadPropellant > 0) {
    return { label: '飞船点火', hint: '启用飞船自带的轨道机动发动机（空格）', enabled: true, tone: 'normal' };
  }
  return { label: '无后续分级', hint: '', enabled: false, tone: 'normal' };
};

/** 飞行控制：点火/分级、节流阀、抛整流罩。姿态由键盘控制（见导航球下方的键位说明）。 */
function FlightControls() {
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const t = useSimStore((s) => s.telemetry);
  const action = stageAction(t, vehicle);
  const active = t?.phase === 'prelaunch' || t?.phase === 'flight';
  const throttle = t?.throttle ?? 1;
  const hasFairing = vehicle.payload.kind === 'satellite';

  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-2 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="flight-controls">
      <HudButton
        disabled={!action.enabled}
        onClick={() => simRuntime.stage()}
        title={action.hint}
        testId="stage-button"
        className={action.enabled && action.tone === 'go' ? '!border-ok !text-ok hover:!bg-ok/15' : ''}
      >
        {action.label}
      </HudButton>

      <div className="flex items-center gap-1.5" title="节流阀（↑ / ↓ 调节，Z 满推力，X 关机）">
        <span className="text-[10px] tracking-[0.16em] text-ink-faint">节流</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(throttle * 100)}
          disabled={!active}
          onChange={(e) => simRuntime.setThrottle(Number(e.target.value) / 100)}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label="节流阀"
          data-testid="throttle-slider"
          className="pointer-events-auto h-1.5 w-28 cursor-pointer accent-data disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="readout w-9 text-right text-[12px] text-data" data-testid="throttle-value">
          {Math.round(throttle * 100)}%
        </span>
      </div>
      <HudButton disabled={!active} onClick={() => simRuntime.setThrottle(1)} title="满推力（Z）" testId="throttle-full">
        满
      </HudButton>
      <HudButton disabled={!active} onClick={() => simRuntime.setThrottle(0)} title="关机：节流阀归零（X）" testId="throttle-cut">
        关机
      </HudButton>
      {hasFairing && (
        <HudButton
          disabled={t?.phase !== 'flight' || !t.fairingAttached}
          onClick={() => simRuntime.jettisonFairing()}
          title="抛整流罩（F）。通常在飞出稠密大气后进行"
          testId="fairing-button"
        >
          {t?.fairingAttached === false ? '已抛罩' : '抛罩'}
        </HudButton>
      )}
    </div>
  );
}

/** 摄像机模式切换。 */
function CameraControls() {
  const cameraMode = useGameStore((s) => s.cameraMode);
  const setCameraMode = useGameStore((s) => s.setCameraMode);
  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="camera-controls">
      <span className="mr-1 text-[10px] tracking-[0.16em] text-ink-faint">视角</span>
      {CAMERA_MODES.map((mode) => (
        <HudButton key={mode} active={cameraMode === mode} onClick={() => setCameraMode(mode)} title={CAMERA_LABEL[mode].hint} testId={`camera-${mode}`}>
          {CAMERA_LABEL[mode].text}
        </HudButton>
      ))}
    </div>
  );
}

/** 底部控制条。 */
export function ControlBar() {
  return (
    <footer className="flex flex-wrap items-end justify-between gap-3">
      <TimeControls />
      <FlightControls />
      <CameraControls />
    </footer>
  );
}
