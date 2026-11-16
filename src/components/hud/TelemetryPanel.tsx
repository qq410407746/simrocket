import { useSimStore } from '@/stores/simStore';
import { useI18n } from '@/i18n';
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

const ORBIT_CLASS_LABEL: Record<OrbitClass, { text: [string, string]; tone: string; hint: [string, string] }> = {
  suborbital: {
    text: ['亚轨道', 'Suborbital'],
    tone: 'text-warn',
    hint: ['近地点在地面以下：不继续加速就会落回地面', 'Periapsis is below ground: accelerate further or fall back to Earth'],
  },
  atmospheric: {
    text: ['近地点在大气层内', 'Atmospheric periapsis'],
    tone: 'text-warn',
    hint: ['近地点低于 100 km：会再入大气层', 'Periapsis below 100 km: atmospheric reentry ahead'],
  },
  orbit: {
    text: ['在轨', 'In orbit'],
    tone: 'text-ok',
    hint: ['近地点高于 100 km。低于约 160 km 时阻力仍然明显，轨道会逐渐衰减', 'Periapsis above 100 km. Drag is still significant below about 160 km and the orbit will decay'],
  },
  escape: {
    text: ['逃逸轨道', 'Escape trajectory'],
    tone: 'text-data',
    hint: ['速度超过逃逸速度：不再返回地球', 'Above escape speed: no return to Earth'],
  },
};

/**
 * 轨道读数：由当前位置与速度得到的密切轨道（二体，不含推力与阻力）。
 * 只在自由飞行中给出；在大气层内飞行时它只是瞬时参考。
 */
function OrbitSection({ orbit }: { orbit: OrbitTelemetry | null }) {
  const { t } = useI18n();
  if (!orbit) {
    return (
      <>
        <SectionLabel note={t('起飞后显示', 'After liftoff')}>{t('轨道', 'Orbit')}</SectionLabel>
        <Readout label={t('远地点', 'Apoapsis')} code="Ap" value="—" unit="km" tone="plain" />
        <Readout label={t('近地点', 'Periapsis')} code="Pe" value="—" unit="km" tone="plain" />
      </>
    );
  }
  const status = ORBIT_CLASS_LABEL[orbit.classification];
  const apoapsis = formatApsis(orbit.apoapsisAltitude);
  const periapsis = formatApsis(orbit.periapsisAltitude);
  const periapsisTone: Tone = orbit.classification === 'orbit' || orbit.classification === 'escape' ? 'ok' : 'warn';
  return (
    <>
      <SectionLabel>{t('轨道', 'Orbit')}</SectionLabel>
      <div className={`mb-1 text-[11px] ${status.tone}`} title={t(...status.hint)} data-testid="orbit-status">
        {t(...status.text)}
      </div>
      <Readout label={t('远地点', 'Apoapsis')} code="Ap" value={apoapsis.value} unit={apoapsis.unit} testId="readout-apoapsis" />
      <Readout label={t('近地点', 'Periapsis')} code="Pe" value={periapsis.value} unit={periapsis.unit} tone={periapsisTone} testId="readout-periapsis" />
      <Readout label={t('到远地点', 'To apoapsis')} code="tAp" value={formatCountdown(orbit.timeToApoapsis)} tone="plain" />
      <Readout label={t('到近地点', 'To periapsis')} code="tPe" value={formatCountdown(orbit.timeToPeriapsis)} tone="plain" />
      <div className="flex items-baseline justify-between gap-3 py-[3px]">
        <span className="text-[12px] text-ink-dim">
          {t('倾角', 'Incl.')} <span className="text-[9px] tracking-wider text-ink-faint">I</span> {t('· 偏心率', '· Ecc.')} <span className="text-[9px] tracking-wider text-ink-faint">E</span>
        </span>
        <span className="readout text-[13px] text-ink">
          <span data-testid="readout-inclination">{formatAngle(orbit.inclination, 2)}</span>°{' · '}
          <span data-testid="readout-eccentricity">{formatNumber(orbit.eccentricity, 4)}</span>
        </span>
      </div>
      <Readout label={t('周期', 'Period')} code="T" value={Number.isFinite(orbit.period) ? formatCountdown(orbit.period) : '∞'} tone="plain" testId="readout-period" />
    </>
  );
}

/** 过载读数的颜色：超过 4 g 提醒（载人任务通常把持续过载限制在 4–5 g 以内）；接近结构限值时为红色。 */
const gTone = (g: number, limit: number): Tone => (g > 0.85 * limit ? 'danger' : g > 4 ? 'warn' : 'ok');

/** 动压与横向气动载荷读数的颜色：按当前构型结构限值的比例。 */
const loadTone = (value: number, limit: number, normal: Tone): Tone => (value > 0.85 * limit ? 'danger' : value > 0.5 * limit ? 'warn' : normal);

/** 左侧飞行遥测面板。 */
export function TelemetryPanel() {
  const { t: tr } = useI18n();
  const t = useSimStore((s) => s.telemetry);
  if (!t) {
    return (
      <Panel title={tr('飞行遥测', 'Flight data')} code="Telemetry" className="w-64" testId="telemetry-panel">
        <p className="animate-pulse-soft text-[12px] text-ink-faint">{tr('等待物理线程数据…', 'Waiting for physics data…')}</p>
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
    <Panel title={tr('飞行遥测', 'Flight data')} code="Telemetry" className="w-64" testId="telemetry-panel">
      <SectionLabel>{tr('位置与速度', 'Position & speed')}</SectionLabel>
      <Readout label={tr('高度', 'Altitude')} code="ALT" value={altitude.value} unit={altitude.unit} testId="readout-altitude" />
      <Readout label={tr('地面速度', 'Surface speed')} code="SPD" value={surfaceSpeed.value} unit={surfaceSpeed.unit} testId="readout-surface-speed" />
      <Readout
        label={tr('垂直速度', 'Vert. speed')}
        code="V/S"
        value={verticalSpeed.value}
        unit={verticalSpeed.unit}
        tone={t.verticalSpeed < -1 ? 'warn' : 'data'}
        testId="readout-vertical-speed"
      />
      <Readout label={tr('水平速度', 'Horiz. speed')} code="H/S" value={horizontalSpeed.value} unit={horizontalSpeed.unit} />
      <Readout label={tr('惯性速度', 'Orbit speed')} code="ORB" value={inertialSpeed.value} unit={inertialSpeed.unit} testId="readout-inertial-speed" />
      <Readout label={tr('航程', 'Downrange')} code="DR" value={downrange.value} unit={downrange.unit} tone="plain" testId="readout-downrange" />
      <div className="flex items-baseline justify-between gap-3 py-[3px]">
        <span className="text-[12px] text-ink-dim">{tr('星下点', 'Subpoint')}</span>
        <span className="readout text-[13px] text-ink">
          <span data-testid="readout-latitude">{formatLatitude(t.latitude)}</span> <span data-testid="readout-longitude">{formatLongitude(t.longitude)}</span>
        </span>
      </div>

      <OrbitSection orbit={t.orbit} />

      <SectionLabel>{tr('受力与气动', 'Loads & aero')}</SectionLabel>
      <Readout
        label={tr('过载', 'G-load')}
        code="G"
        value={formatNumber(t.gLoad, 2)}
        unit="g"
        tone={gTone(t.gLoad, t.structure.maxGLoad)}
        testId="readout-gload"
      />
      <Readout
        label={tr('动压', 'Dyn. pressure')}
        code="Q"
        value={dynamicPressure.value}
        unit={dynamicPressure.unit}
        tone={loadTone(t.dynamicPressure, t.structure.maxDynamicPressure, 'data')}
        testId="readout-dynamic-pressure"
      />
      <Readout label={tr('马赫数', 'Mach')} code="M" value={inAir ? formatNumber(t.mach, 2) : '—'} tone="plain" testId="readout-mach" />
      <Readout
        label={tr('迎角', 'AoA')}
        code="AoA"
        value={inAir ? formatAngle(t.angleOfAttack) : '—'}
        unit="°"
        tone={inAir ? loadTone(t.bendingLoad, t.structure.maxBendingLoad, 'plain') : 'plain'}
      />
      <Readout
        label={tr('升阻比', 'Lift/drag')}
        code="L/D"
        value={inAir && t.drag > 1 ? formatNumber(t.liftToDrag, 2) : '—'}
        tone="plain"
        testId="readout-lift-to-drag"
      />
    </Panel>
  );
}
