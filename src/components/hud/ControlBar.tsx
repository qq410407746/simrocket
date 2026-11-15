import { getVehicleOrDefault } from '@/data/vehicles';
import { TIME_WARP_LEVELS } from '@/game/simulation/types';
import type { Telemetry } from '@/game/telemetry/telemetry';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import { createTranslator, type Language } from '@/i18n/locale';
import { CAMERA_MODES, type CameraMode, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { HudButton } from '../ui/HudButton';

const CAMERA_LABEL: Record<CameraMode, { text: [string, string]; hint: [string, string] }> = {
  chase: { text: ['跟随', 'Chase'], hint: ['跟随火箭，画面以当地水平面为基准（快捷键 1）', 'Follow the rocket relative to the local horizon (1)'] },
  free: { text: ['自由', 'Free'], hint: ['环绕火箭自由旋转，画面以惯性空间为基准（快捷键 2）', 'Rotate freely around the rocket in inertial space (2)'] },
  pad: { text: ['发射台', 'Pad'], hint: ['发射场地面跟踪机位（快捷键 3）', 'Ground tracking camera at the launch site (3)'] },
  orbit: { text: ['轨道', 'Orbit'], hint: ['环绕地球的远景视角（快捷键 4）', 'Distant view around Earth (4)'] },
  map: { text: ['地图', 'Map'], hint: ['轨道地图：当前轨道、预测轨迹、远/近地点（快捷键 M 或 5）', 'Orbit map: current orbit, predicted path, apoapsis and periapsis (M or 5)'] },
};

/** 时间控制：暂停与时间倍率。超过当前物理状态允许上限的档位不可选。 */
function TimeControls() {
  const { t } = useI18n();
  const paused = useSimStore((s) => s.paused);
  const timeWarp = useSimStore((s) => s.timeWarp);
  const maxTimeWarp = useSimStore((s) => s.maxTimeWarp);
  const simRate = useSimStore((s) => s.simRate);
  const lagging = !paused && simRate < timeWarp * 0.95;

  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="time-controls">
      <span className="mr-1 text-[10px] tracking-[0.16em] text-ink-faint">{t('时间', 'Time')}</span>
      <HudButton
        active={paused}
        onClick={() => simRuntime.setPaused(!paused)}
        title={t('暂停 / 继续（快捷键 P）', 'Pause / resume (P)')}
        testId="pause-button"
        ariaLabel={paused ? t('继续', 'Resume') : t('暂停', 'Pause')}
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
                ? t('时间倍率（快捷键 , 与 .）', 'Time warp (, and .)')
                : t(`当前最高 ${maxTimeWarp}×：发动机工作或操纵时限 5×，稠密大气内限 10×`, `Current limit: ${maxTimeWarp}×. Engines or steering: 5×; dense atmosphere: 10×`)
            }
            testId={`warp-${warp}`}
          >
            {warp}×
          </HudButton>
        );
      })}
      {lagging && (
        <span className="ml-1 text-[10px] text-warn" title={t('计算跟不上指令倍率，显示的是实际速率', 'Simulation cannot keep up with the requested warp; showing the actual rate')}>
          {t('实际', 'Actual')} {simRate.toFixed(0)}×
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
const stageAction = (t: Telemetry | null, vehicle: VehicleDefinition, language: Language): StageAction => {
  const tr = createTranslator(language);
  if (!t) return { label: tr('点火', 'Ignite'), hint: '', enabled: false, tone: 'normal' };
  if (t.phase === 'prelaunch') {
    return t.ignited
      ? { label: tr('已点火', 'Ignited'), hint: tr('发动机已启用；推力超过重量时自动离开发射台', 'Engines enabled; liftoff is automatic when thrust exceeds weight'), enabled: false, tone: 'normal' }
      : { label: tr('点火起飞', 'Liftoff'), hint: tr('发动机点火（空格）', 'Ignite engines (Space)'), enabled: true, tone: 'go' };
  }
  if (t.phase !== 'flight') return { label: tr('飞行结束', 'Flight ended'), hint: '', enabled: false, tone: 'normal' };
  const stage = vehicle.stages[t.activeStageIndex];
  if (stage && !t.ignited && (t.stagePropellant[t.activeStageIndex] ?? 0) > 0) {
    const name = dataText(stage.name, language);
    return { label: tr(`启动${stage.name}`, `Start ${name}`), hint: tr(`启用${stage.name}发动机（空格）；推力大小由节流阀决定`, `Enable ${name} engines (Space); thrust is set by the throttle`), enabled: true, tone: 'go' };
  }
  if (stage) {
    const next = vehicle.stages[t.activeStageIndex + 1];
    const name = dataText(stage.name, language);
    return {
      label: tr(`分离${stage.name}`, `Separate ${name}`),
      hint: next ? tr(`分离${stage.name}并点燃${next.name}（空格）`, `Separate ${name} and ignite ${dataText(next.name, language)} (Space)`) : tr(`分离${stage.name}（空格）`, `Separate ${name} (Space)`),
      enabled: true,
      tone: (t.stagePropellant[t.activeStageIndex] ?? 0) <= 0 ? 'go' : 'normal',
    };
  }
  if (vehicle.payload.engine && !t.ignited && t.payloadPropellant > 0) {
    return { label: tr('飞船点火', 'Ignite craft'), hint: tr('启用飞船自带的轨道机动发动机（空格）', 'Enable the spacecraft orbital maneuvering engines (Space)'), enabled: true, tone: 'normal' };
  }
  return { label: tr('无后续分级', 'No stages left'), hint: '', enabled: false, tone: 'normal' };
};

/** 飞行控制：点火/分级、节流阀、抛整流罩、开伞、抛防热大底。姿态由键盘控制（见导航球下方的键位说明）。 */
function FlightControls() {
  const { language, t: tr } = useI18n();
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const t = useSimStore((s) => s.telemetry);
  const action = stageAction(t, vehicle, language);
  const active = t?.phase === 'prelaunch' || t?.phase === 'flight';
  const throttle = t?.throttle ?? 1;
  const hasFairing = vehicle.payload.kind === 'satellite';
  const hasParachute = vehicle.payload.kind === 'capsule' && vehicle.payload.parachute !== null;
  const chute = t?.parachute.phase ?? 'none';
  const limits = t?.parachuteLimits ?? null;
  // 开伞条件：亚声速且动压在限值内；否则伞会被撕毁
  const chuteSafe = !!t && !!limits && t.dynamicPressure <= limits.dynamicPressure && t.mach <= limits.mach;
  const chuteLabel = chute === 'drogue' ? tr('减速伞', 'Drogue') : chute === 'main' ? tr('主伞', 'Main chute') : chute === 'lost' ? tr('伞已毁', 'Chute lost') : tr('开伞', 'Chute');
  const chuteHint =
    chute === 'none'
      ? tr('只有与推进级分离后的返回舱可以开伞', 'Only a capsule separated from its propulsion stages can deploy a parachute')
      : chute === 'stowed'
        ? chuteSafe
          ? tr('开伞（G）：先放减速伞，动压降低后主伞自动打开', 'Deploy chute (G): drogue first; the main chute opens automatically as dynamic pressure falls')
          : tr(`开伞（G）。现在开伞会被撕毁：要求马赫数 ≤ ${limits?.mach ?? '—'}、动压 ≤ ${((limits?.dynamicPressure ?? 0) / 1000).toFixed(0)} kPa`, `Deploy chute (G). Deploying now will tear it apart: requires Mach ≤ ${limits?.mach ?? '—'} and dynamic pressure ≤ ${((limits?.dynamicPressure ?? 0) / 1000).toFixed(0)} kPa`)
        : chute === 'drogue'
          ? tr('减速伞工作中；动压降低后主伞自动打开', 'Drogue deployed; the main chute opens automatically as dynamic pressure falls')
          : chute === 'main'
            ? tr('主伞已打开', 'Main chute deployed')
            : tr('降落伞已损毁', 'Parachute destroyed');

  const isCapsule = vehicle.payload.kind === 'capsule';
  const shieldAttached = t?.heatShieldAttached ?? isCapsule;
  const canJettisonShield = t?.canJettisonHeatShield ?? false;
  // 抛大底的时机：主伞已经张开（再入加热早已结束）
  const shieldTiming = chute === 'main';
  const shieldHint = !shieldAttached
    ? tr('防热大底已抛掉', 'Heat shield jettisoned')
    : !canJettisonShield
      ? tr('只有与推进级分离后的返回舱可以抛防热大底', 'Only a capsule separated from its propulsion stages can jettison the heat shield')
      : shieldTiming
        ? tr('抛掉防热大底（H）：减轻质量，伞降速度更低', 'Jettison heat shield (H): less mass and a slower parachute descent')
        : tr('抛掉防热大底（H）。警告：再入结束前抛掉大底，舱底会被烧毁——通常在主伞张开后进行', 'Jettison heat shield (H). Warning: doing this before reentry ends will burn through the capsule base; normally wait for the main chute');

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

      <div className="flex items-center gap-1.5" title={tr('节流阀（↑ / ↓ 调节，Z 满推力，X 关机）', 'Throttle (↑ / ↓ adjust, Z full thrust, X cut engines)')}>
        <span className="text-[10px] tracking-[0.16em] text-ink-faint">{tr('节流', 'Throttle')}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(throttle * 100)}
          disabled={!active}
          onChange={(e) => simRuntime.setThrottle(Number(e.target.value) / 100)}
          onPointerUp={(e) => e.currentTarget.blur()}
          aria-label={tr('节流阀', 'Throttle')}
          data-testid="throttle-slider"
          className="pointer-events-auto h-1.5 w-28 cursor-pointer accent-data disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="readout w-9 text-right text-[12px] text-data" data-testid="throttle-value">
          {Math.round(throttle * 100)}%
        </span>
      </div>
      <HudButton disabled={!active} onClick={() => simRuntime.setThrottle(1)} title={tr('满推力（Z）', 'Full thrust (Z)')} testId="throttle-full">
        {tr('满', 'Full')}
      </HudButton>
      <HudButton disabled={!active} onClick={() => simRuntime.setThrottle(0)} title={tr('关机：节流阀归零（X）', 'Cut engines: zero throttle (X)')} testId="throttle-cut">
        {tr('关机', 'Cut')}
      </HudButton>
      {hasFairing && (
        <HudButton
          disabled={t?.phase !== 'flight' || !t.fairingAttached}
          onClick={() => simRuntime.jettisonFairing()}
          title={tr('抛整流罩（F）。通常在飞出稠密大气后进行', 'Jettison fairing (F). Normally done above the dense atmosphere')}
          testId="fairing-button"
        >
          {t?.fairingAttached === false ? tr('已抛罩', 'Fairing off') : tr('抛罩', 'Fairing')}
        </HudButton>
      )}
      {hasParachute && (
        <HudButton
          disabled={t?.phase !== 'flight' || chute !== 'stowed'}
          active={chute === 'drogue' || chute === 'main'}
          onClick={() => simRuntime.deployParachute()}
          title={chuteHint}
          testId="parachute-button"
          className={chute === 'stowed' && chuteSafe && t.altitude < 12_000 ? '!border-ok !text-ok hover:!bg-ok/15' : chute === 'lost' ? '!text-danger' : ''}
        >
          {chuteLabel}
        </HudButton>
      )}
      {isCapsule && (
        <HudButton
          disabled={!canJettisonShield}
          onClick={() => simRuntime.jettisonHeatShield()}
          title={shieldHint}
          testId="heat-shield-button"
          className={canJettisonShield && shieldTiming ? '!border-ok !text-ok hover:!bg-ok/15' : ''}
        >
          {shieldAttached ? tr('抛大底', 'Shield') : tr('已抛大底', 'Shield off')}
        </HudButton>
      )}
    </div>
  );
}

/** 摄像机模式切换。 */
function CameraControls() {
  const { t } = useI18n();
  const cameraMode = useGameStore((s) => s.cameraMode);
  const setCameraMode = useGameStore((s) => s.setCameraMode);
  return (
    <div className="panel-frame pointer-events-auto flex items-center gap-1.5 rounded-lg px-2.5 py-2 backdrop-blur-md" data-testid="camera-controls">
      <span className="mr-1 text-[10px] tracking-[0.16em] text-ink-faint">{t('视角', 'View')}</span>
      {CAMERA_MODES.map((mode) => (
        <HudButton key={mode} active={cameraMode === mode} onClick={() => setCameraMode(mode)} title={t(...CAMERA_LABEL[mode].hint)} testId={`camera-${mode}`}>
          {t(...CAMERA_LABEL[mode].text)}
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
