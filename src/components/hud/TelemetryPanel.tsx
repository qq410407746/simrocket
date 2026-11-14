import { useSimStore } from '@/stores/simStore';
import { formatDistance, formatLatitude, formatLongitude, formatNumber, formatSpeed } from '@/utils/format';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout } from '../ui/Readout';

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

  return (
    <Panel title="飞行遥测" code="Telemetry" className="w-64" testId="telemetry-panel">
      <SectionLabel>位置与速度</SectionLabel>
      <Readout label="高度" code="ALT" value={altitude.value} unit={altitude.unit} testId="readout-altitude" />
      <Readout label="地面速度" code="SPD" value={surfaceSpeed.value} unit={surfaceSpeed.unit} testId="readout-surface-speed" />
      <Readout label="垂直速度" code="V/S" value={verticalSpeed.value} unit={verticalSpeed.unit} />
      <Readout label="水平速度" code="H/S" value={horizontalSpeed.value} unit={horizontalSpeed.unit} />
      <Readout label="惯性速度" code="ORB" value={inertialSpeed.value} unit={inertialSpeed.unit} testId="readout-inertial-speed" />
      <Readout label="纬度" code="LAT" value={formatLatitude(t.latitude)} tone="plain" testId="readout-latitude" />
      <Readout label="经度" code="LON" value={formatLongitude(t.longitude)} tone="plain" testId="readout-longitude" />

      <SectionLabel>受力</SectionLabel>
      <Readout label="过载" code="G" value={formatNumber(t.gLoad, 2)} unit="g" tone={t.gLoad > 6 ? 'danger' : t.gLoad > 4 ? 'warn' : 'ok'} testId="readout-gload" />
      <Readout label="当地重力" code="g" value={formatNumber(t.localGravity, 3)} unit="m/s²" tone="plain" />

      <SectionLabel>气动与热</SectionLabel>
      <Readout label="动压" code="Q" value="" pending="阶段二" />
      <Readout label="马赫数" code="M" value="" pending="阶段二" />
      <Readout label="气动热流" code="q̇" value="" pending="阶段四" />
      <Readout label="表面温度" code="Tw" value="" pending="阶段四" />
      <Readout label="热防护" code="TPS" value="" pending="阶段四" />

      <SectionLabel>轨道</SectionLabel>
      <Readout label="远地点" code="Ap" value="" pending="阶段三" />
      <Readout label="近地点" code="Pe" value="" pending="阶段三" />
      <Readout label="倾角" code="i" value="" pending="阶段三" />
    </Panel>
  );
}
