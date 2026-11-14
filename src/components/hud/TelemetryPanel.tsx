import { useSimStore } from '@/stores/simStore';
import {
  formatAngle,
  formatDistance,
  formatLatitude,
  formatLongitude,
  formatNumber,
  formatPressure,
  formatSpeed,
} from '@/utils/format';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout, type Tone } from '../ui/Readout';

/** 过载读数的颜色：载人任务通常把持续过载限制在 4–5 g 以内。 */
const gTone = (g: number): Tone => (g > 6 ? 'danger' : g > 4 ? 'warn' : 'ok');

/** 动压读数的颜色：典型运载火箭的最大动压为 30–40 kPa。 */
const qTone = (q: number): Tone => (q > 60_000 ? 'danger' : q > 40_000 ? 'warn' : 'data');

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
      <Readout label="垂直速度" code="V/S" value={verticalSpeed.value} unit={verticalSpeed.unit} tone={t.verticalSpeed < -1 ? 'warn' : 'data'} testId="readout-vertical-speed" />
      <Readout label="水平速度" code="H/S" value={horizontalSpeed.value} unit={horizontalSpeed.unit} />
      <Readout label="惯性速度" code="ORB" value={inertialSpeed.value} unit={inertialSpeed.unit} testId="readout-inertial-speed" />
      <Readout label="航程" code="DR" value={downrange.value} unit={downrange.unit} tone="plain" testId="readout-downrange" />
      <Readout label="纬度" code="LAT" value={formatLatitude(t.latitude)} tone="plain" testId="readout-latitude" />
      <Readout label="经度" code="LON" value={formatLongitude(t.longitude)} tone="plain" testId="readout-longitude" />

      <SectionLabel>受力与气动</SectionLabel>
      <Readout label="过载" code="G" value={formatNumber(t.gLoad, 2)} unit="g" tone={gTone(t.gLoad)} testId="readout-gload" />
      <Readout label="动压" code="Q" value={dynamicPressure.value} unit={dynamicPressure.unit} tone={qTone(t.dynamicPressure)} testId="readout-dynamic-pressure" />
      <Readout label="马赫数" code="M" value={inAir ? formatNumber(t.mach, 2) : '—'} tone="plain" testId="readout-mach" />
      <Readout label="迎角" code="AoA" value={inAir ? formatAngle(t.angleOfAttack) : '—'} unit="°" tone={inAir && t.dynamicPressure > 5_000 && t.angleOfAttack > 0.26 ? 'warn' : 'plain'} />
      <Readout label="当地重力" code="g" value={formatNumber(t.localGravity, 3)} unit="m/s²" tone="plain" />

      <SectionLabel>热防护</SectionLabel>
      <Readout label="气动热流" code="q̇" value="" pending="阶段四" />
      <Readout label="表面温度" code="Tw" value="" pending="阶段四" />

      <SectionLabel>轨道</SectionLabel>
      <Readout label="远地点" code="Ap" value="" pending="阶段三" />
      <Readout label="近地点" code="Pe" value="" pending="阶段三" />
      <Readout label="倾角" code="i" value="" pending="阶段三" />
    </Panel>
  );
}
