import { useMemo } from 'react';
import { getVehicleOrDefault } from '@/data/vehicles';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatAngle, formatForce, formatMass, formatNumber } from '@/utils/format';
import { Meter } from '../ui/Meter';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout } from '../ui/Readout';

/** 右侧飞行器状态面板：质量、推进、各级推进剂、姿态。 */
export function VehiclePanel() {
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const t = useSimStore((s) => s.telemetry);
  const performance = useMemo(() => analyzeVehicle(vehicle), [vehicle]);

  const mass = formatMass(t?.mass ?? performance.liftoffMass);
  // 发动机关机时推力为 0；点火后的实际推力由阶段二的推进模型给出。
  const thrust = formatForce(0);
  const firstStage = performance.stages[0];
  const seaLevelThrust = formatForce(firstStage?.thrustSeaLevel ?? 0);

  return (
    <Panel title={vehicle.nameZh} code={vehicle.name} className="w-68" testId="vehicle-panel">
      <SectionLabel>推进</SectionLabel>
      <Readout label="发动机" code="ENG" value={t?.enginesOn ? '工作' : '关机'} tone={t?.enginesOn ? 'ok' : 'plain'} testId="readout-engine" />
      <Readout label="推力" code="THR" value={thrust.value} unit={thrust.unit} />
      <Readout label="节流阀" code="TVL" value={formatNumber((t?.throttle ?? 0) * 100, 0)} unit="%" />
      <Readout label="总质量" code="MASS" value={mass.value} unit={mass.unit} tone="plain" testId="readout-mass" />
      <Readout label="额定起飞推力" code="SL" value={seaLevelThrust.value} unit={seaLevelThrust.unit} tone="plain" />
      <Readout
        label="起飞推重比"
        code="TWR"
        value={formatNumber(performance.liftoffTwr, 2)}
        tone={performance.liftoffTwr > 1.15 ? 'ok' : 'warn'}
        testId="readout-twr"
      />

      <SectionLabel note="自上而下">分级与推进剂</SectionLabel>
      <ul className="flex flex-col gap-2">
        <li className="rounded border border-line/60 px-2 py-1.5">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-ink">{vehicle.payload.name}</span>
            <span className="readout text-[11px] text-ink-dim">
              {formatMass(vehicle.payload.dryMass + (t?.payloadPropellant ?? vehicle.payload.propellantMass)).value}{' '}
              {formatMass(vehicle.payload.dryMass + vehicle.payload.propellantMass).unit}
            </span>
          </div>
          {vehicle.payload.propellantMass > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <Meter fraction={(t?.payloadPropellant ?? vehicle.payload.propellantMass) / vehicle.payload.propellantMass} tone="ok" />
              <span className="readout w-16 text-right text-[10px] text-ink-faint">Δv {formatNumber(performance.payloadDeltaV, 0)}</span>
            </div>
          )}
        </li>
        {[...vehicle.stages].reverse().map((stage, reversedIndex) => {
          const index = vehicle.stages.length - 1 - reversedIndex;
          const remaining = t?.stagePropellant[index] ?? stage.propellantMass;
          const fraction = stage.propellantMass > 0 ? remaining / stage.propellantMass : 0;
          const active = (t?.activeStageIndex ?? 0) === index;
          const perf = performance.stages[index];
          return (
            <li key={stage.id} className={`rounded border px-2 py-1.5 ${active ? 'border-data/60 bg-data/5' : 'border-line/60'}`} data-testid={`stage-${index}`}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className={active ? 'text-data' : 'text-ink'}>
                  {stage.name}
                  <span className="ml-1.5 text-[10px] text-ink-faint">
                    {stage.engineCount}× {stage.engine.name}
                  </span>
                </span>
                <span className="readout text-[11px] text-ink-dim">{formatNumber(fraction * 100, 1)}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Meter fraction={fraction} tone={fraction < 0.1 ? 'danger' : fraction < 0.25 ? 'warn' : 'data'} />
                <span className="readout w-16 text-right text-[10px] text-ink-faint">Δv {formatNumber(perf?.deltaVVacuum ?? 0, 0)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-baseline justify-between text-[11px] text-ink-dim" title="齐奥尔科夫斯基方程、真空比冲；不含重力损失与阻力损失">
        <span>理想 Δv 合计（真空）</span>
        <span className="readout text-[13px] text-data" data-testid="readout-total-dv">
          {formatNumber(performance.totalDeltaVVacuum, 0)} <span className="text-[10px] text-ink-faint">m/s</span>
        </span>
      </div>

      <SectionLabel>姿态</SectionLabel>
      <Readout label="俯仰" code="PITCH" value={formatAngle(t?.pitch ?? null)} unit="°" testId="readout-pitch" />
      <Readout label="航向" code="HDG" value={formatAngle(t?.heading ?? null)} unit="°" />
    </Panel>
  );
}
