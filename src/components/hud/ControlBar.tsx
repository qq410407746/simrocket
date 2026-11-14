import { TIME_WARP_LEVELS } from '@/game/simulation/types';
import { CAMERA_MODES, type CameraMode, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { HudButton } from '../ui/HudButton';

const CAMERA_LABEL: Record<CameraMode, { text: string; hint: string }> = {
  chase: { text: '跟随', hint: '跟随火箭，画面以当地水平面为基准（快捷键 1）' },
  free: { text: '自由', hint: '环绕火箭自由旋转，画面以惯性空间为基准（快捷键 2）' },
  pad: { text: '发射台', hint: '发射场地面跟踪机位（快捷键 3）' },
  orbit: { text: '轨道', hint: '环绕地球的远景视角（快捷键 4）' },
};

/** 时间控制：暂停与时间倍率。 */
function TimeControls() {
  const paused = useSimStore((s) => s.paused);
  const timeWarp = useSimStore((s) => s.timeWarp);
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
      {TIME_WARP_LEVELS.map((warp) => (
        <HudButton
          key={warp}
          active={!paused && timeWarp === warp}
          onClick={() => {
            simRuntime.setTimeWarp(warp);
            if (paused) simRuntime.setPaused(false);
          }}
          title="时间倍率（快捷键 , 与 .）"
          testId={`warp-${warp}`}
        >
          {warp}×
        </HudButton>
      ))}
      {lagging && (
        <span className="ml-1 text-[10px] text-warn" title="计算跟不上指令倍率，显示的是实际速率">
          实际 {simRate.toFixed(0)}×
        </span>
      )}
    </div>
  );
}

/** 飞行控制：阶段一仅展示布局，全部禁用并标明实现阶段。 */
function FlightControls() {
  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="flight-controls">
      <span className="mr-1 text-[10px] tracking-[0.16em] text-ink-faint">飞行控制</span>
      <HudButton disabled title="发动机点火——推进与起飞动力学在阶段二实现" testId="ignite-button">
        点火
      </HudButton>
      <HudButton disabled title="火箭分级——阶段二实现">
        分级
      </HudButton>
      <HudButton disabled title="节流阀与姿态控制——阶段二实现">
        节流 / 姿态
      </HudButton>
      <span className="ml-1 rounded-sm border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">阶段二启用</span>
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
      <HudButton disabled title="轨道地图——阶段三实现">
        地图
      </HudButton>
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
