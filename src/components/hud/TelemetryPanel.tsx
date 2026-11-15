import { useSimStore } from '@/stores/simStore';
import {
  formatAngle,
  formatApsis,
  formatCountdown,
  formatDistance,
  formatLatitude,
  formatLongitude,
  formatNumber,
  formatPressure,
  formatSpeed,
} from '@/utils/format';
import type { OrbitClass, OrbitTelemetry } from '@/game/telemetry/telemetry';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout, type Tone } from '../ui/Readout';

const ORBIT_CLASS_LABEL: Record<OrbitClass, { text: string; tone: string; hint: string }> = {
  suborbital: {
    text: '亚轨道',
    tone: 'text-warn',
    hint: '近地点在地面以下：不继续加速就会落回地面',
  },
  atmospheric: {
    text: '近地点在大气层内',
    tone: 'text-warn',
    hint: '近地点低于 100 km：会再入大气层',
  },
  orbit: {
    text: '在轨',
    tone: 'text-ok',
    hint: '近地点高于 100 km。低于约 160 km 时阻力仍然明显，轨道会逐渐衰减',
  },
  escape: {
    text: '逃逸轨道',
    tone: 'text-data',
    hint: '速度超过逃逸速度：不再返回地球',
  },
};

/**
 * 轨道读数：由当前位置与速度得到的密切轨道（二体，不含推力与阻力）。
 * 只在自由飞行中给出；在大气层内飞行时它只是瞬时参考。
 */
function OrbitSection({ orbit }: { orbit: OrbitTelemetry | null }) {
  if (!orbit) {
    return (
      <>
        <SectionLabel note="起飞后显示">轨道</SectionLabel>
        <Readout label="远地点" code="Ap" value="—" unit="km" tone="plain" />
        <Readout label="近地点" code="Pe" value="—" unit="km" tone="plain" />
      </>
    );
  }
  const status = ORBIT_CLASS_LABEL[orbit.classification];
  const apoapsis = formatApsis(orbit.apoapsisAltitude);
  const periapsis = formatApsis(orbit.periapsisAltitude);
  const periapsisTone: Tone = orbit.classification === 'orbit' || orbit.classification === 'escape' ? 'ok' : 'warn';
  return (
    <>
      <SectionLabel>轨道</SectionLabel>
      <div className={`mb-1 text-[11px] ${status.tone}`} title={status.hint} data-testid="orbit-status">
        {status.text}
      </div>
      <Readout label="远地点" code="Ap" value={apoapsis.value} unit={apoapsis.unit} testId="readout-apoapsis" />
      <Readout label="近地点" code="Pe" value={periapsis.value} unit={periapsis.unit} tone={periapsisTone} testId="readout-periapsis" />
      <Readout label="到远地点" code="tAp" value={formatCountdown(orbit.timeToApoapsis)} tone="plain" />
      <Readout label="到近地点" code="tPe" value={formatCountdown(orbit.timeToPeriapsis)} tone="plain" />
      <div className="flex items-baseline justify-between gap-3 py-[3px]">
        <span className="text-[12px] text-ink-dim">
          倾角 <span className="text-[9px] tracking-wider text-ink-faint">I</span> · 偏心率 <span className="text-[9px] tracking-wider text-ink-faint">E</span>
        </span>
        <span className="readout text-[13px] text-ink">
          <span data-testid="readout-inclination">{formatAngle(orbit.inclination, 2)}</span>°{' · '}
          <span data-testid="readout-eccentricity">{formatNumber(orbit.eccentricity, 4)}</span>
        </span>
      </div>
      <Readout label="周期" code="T" value={Number.isFinite(orbit.period) ? formatCountdown(orbit.period) : '∞'} tone="plain" testId="readout-period" />
    </>
  );
}

/** 过载读数的颜色：超过 4 g 提醒（载人任务通常把持续过载限制在 4–5 g 以内）；接近结构限值时为红色。 */
const gTone = (g: number, limit: number): Tone => (g > 0.85 * limit ? 'danger' : g > 4 ? 'warn' : 'ok');

/** 动压与横向气动载荷读数的颜色：按当前构型结构限值的比例。 */
const loadTone = (value: number, limit: number, normal: Tone): Tone => (value > 0.85 * limit ? 'danger' : value > 0.5 * limit ? 'warn' : normal);

/** 左侧飞行遥测面板。 */
export function TelemetryPanel() {
  const t = useSimStore((s) => s.telemetry);
  if (!t) {
    return (
      <Panel title="飞行遥测" code="Telemetry" className="w-64" testId="telemetry-panel">
        <p className="animate-pulse-soft text-[12px] text-ink-faint">等待物理线程数据…</p>
      </Panel>
    );
  }

  const altitude = formatDistance(t.altitude);
  const surfaceSpeed = formatSpeed(t.surfaceSpeed);
  const verticalSpeed = formatSpeed(t.verticalSpeed);
  const horizontalSpeed = formatSpeed(t.horizontalSpeed);
  const inertialSpeed = formatSpeed(t.inertialSpeed);
  const downrange = formatDistance(t.downrange);
  const dynamicPressure = formatPressure(t.dynamicPressure);
  // 空气极其稀薄时马赫数与迎角没有实际意义（连续介质假设失效）
  const inAir = t.airDensity > 1e-7 && t.surfaceSpeed > 1;

  return (
    <Panel title="飞行遥测" code="Telemetry" className="w-64" testId="telemetry-panel">
      <SectionLabel>位置与速度</SectionLabel>
      <Readout label="高度" code="ALT" value={altitude.value} unit={altitude.unit} testId="readout-altitude" />
      <Readout label="地面速度" code="SPD" value={surfaceSpeed.value} unit={surfaceSpeed.unit} testId="readout-surface-speed" />
      <Readout
        label="垂直速度"
        code="V/S"
        value={verticalSpeed.value}
        unit={verticalSpeed.unit}
        tone={t.verticalSpeed < -1 ? 'warn' : 'data'}
        testId="readout-vertical-speed"
      />
      <Readout label="水平速度" code="H/S" value={horizontalSpeed.value} unit={horizontalSpeed.unit} />
      <Readout label="惯性速度" code="ORB" value={inertialSpeed.value} unit={inertialSpeed.unit} testId="readout-inertial-speed" />
      <Readout label="航程" code="DR" value={downrange.value} unit={downrange.unit} tone="plain" testId="readout-downrange" />
      <div className="flex items-baseline justify-between gap-3 py-[3px]">
        <span className="text-[12px] text-ink-dim">星下点</span>
        <span className="readout text-[13px] text-ink">
          <span data-testid="readout-latitude">{formatLatitude(t.latitude)}</span> <span data-testid="readout-longitude">{formatLongitude(t.longitude)}</span>
        </span>
      </div>

      <OrbitSection orbit={t.orbit} />

      <SectionLabel>受力与气动</SectionLabel>
      <Readout
        label="过载"
        code="G"
        value={formatNumber(t.gLoad, 2)}
        unit="g"
        tone={gTone(t.gLoad, t.structure.maxGLoad)}
        testId="readout-gload"
      />
      <Readout
        label="动压"
        code="Q"
        value={dynamicPressure.value}
        unit={dynamicPressure.unit}
        tone={loadTone(t.dynamicPressure, t.structure.maxDynamicPressure, 'data')}
        testId="readout-dynamic-pressure"
      />
      <Readout label="马赫数" code="M" value={inAir ? formatNumber(t.mach, 2) : '—'} tone="plain" testId="readout-mach" />
      <Readout
        label="迎角"
        code="AoA"
        value={inAir ? formatAngle(t.angleOfAttack) : '—'}
        unit="°"
        tone={inAir ? loadTone(t.bendingLoad, t.structure.maxBendingLoad, 'plain') : 'plain'}
      />
      <Readout
        label="升阻比"
        code="L/D"
        value={inAir && t.drag > 1 ? formatNumber(t.liftToDrag, 2) : '—'}
        tone="plain"
        testId="readout-lift-to-drag"
      />
    </Panel>
  );
}
