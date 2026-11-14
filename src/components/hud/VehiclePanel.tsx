import { useMemo } from 'react';
import { getVehicleOrDefault } from '@/data/vehicles';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatAngle, formatForce, formatMass, formatNumber } from '@/utils/format';
import { Meter } from '../ui/Meter';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout } from '../ui/Readout';

/** 右侧飞行器状态面板：推进、质量、各级推进剂、姿态。 */
export function VehiclePanel() {
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const t = useSimStore((s) => s.telemetry);
  const performance = useMemo(() => analyzeVehicle(vehicle), [vehicle]);

  const mass = formatMass(t?.mass ?? performance.liftoffMass);
  const thrust = formatForce(t?.thrust ?? 0);
  const burning = (t?.thrust ?? 0) > 0;
  const throttle = t?.throttle ?? 1;
  const effective = t?.effectiveThrottle ?? 0;
  // 节流指令低于发动机最小稳定推力时，实际按最小节流工作
  const clamped = burning && effective > throttle + 0.005;
  const remainingDeltaV = t?.remainingDeltaV ?? performance.totalDeltaVVacuum;
  const payloadOnly = t ? t.activeStageIndex >= vehicle.stages.length : false;

  return (
    <Panel title={vehicle.nameZh} code={vehicle.name} className="w-68" testId="vehicle-panel">
      <SectionLabel>推进</SectionLabel>
      <Readout
        label="发动机"
        code="ENG"
        value={burning ? '工作' : t?.ignited ? '待机' : '关机'}
        tone={burning ? 'ok' : t?.ignited ? 'warn' : 'plain'}
        testId="readout-engine"
      />
      <Readout label="推力" code="THR" value={thrust.value} unit={thrust.unit} tone={burning ? 'ok' : 'data'} testId="readout-thrust" />
      <Readout
        label="节流阀"
        code="TVL"
        value={`${formatNumber(throttle * 100, 0)}${clamped ? ` → ${formatNumber(effective * 100, 0)}` : ''}`}
        unit="%"
        tone={clamped ? 'warn' : 'data'}
        testId="readout-throttle"
      />
      <Readout
        label={burning ? '推重比' : '起飞推重比'}
        code="TWR"
        value={formatNumber(burning ? (t?.thrustToWeight ?? 0) : performance.liftoffTwr, 2)}
        tone={(burning ? (t?.thrustToWeight ?? 0) : performance.liftoffTwr) > 1 ? 'ok' : 'warn'}
        testId="readout-twr"
      />
      <Readout label="总质量" code="MASS" value={mass.value} unit={mass.unit} tone="plain" testId="readout-mass" />
      <Readout label="剩余 Δv" code="ΔV" value={formatNumber(remainingDeltaV, 0)} unit="m/s" testId="readout-total-dv" />

      <SectionLabel note="自上而下">分级与推进剂</SectionLabel>
      <ul className="flex flex-col gap-1.5">
        <li className={`rounded border px-2 py-1.5 ${payloadOnly ? 'border-data/60 bg-data/5' : 'border-line/60'}`} data-testid="payload-row">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className={payloadOnly ? 'text-data' : 'text-ink'}>
              {vehicle.payload.name}
              {vehicle.payload.kind === 'satellite' && (
                <span className={`ml-1.5 text-[10px] ${t?.fairingAttached === false ? 'text-ink-faint' : 'text-ink-dim'}`}>
                  {t?.fairingAttached === false ? '整流罩已抛' : '整流罩内'}
                </span>
              )}
            </span>
            <span className="readout text-[11px] text-ink-dim">
              {formatNumber(vehicle.payload.dryMass + (t?.payloadPropellant ?? vehicle.payload.propellantMass), 0)} kg
            </span>
          </div>
          {vehicle.payload.propellantMass > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <Meter fraction={(t?.payloadPropellant ?? vehicle.payload.propellantMass) / vehicle.payload.propellantMass} tone="ok" />
              <span className="readout w-12 text-right text-[10px] text-ink-faint">
                {formatNumber(((t?.payloadPropellant ?? vehicle.payload.propellantMass) / vehicle.payload.propellantMass) * 100, 0)}%
              </span>
            </div>
          )}
        </li>
        {[...vehicle.stages].reverse().map((stage, reversedIndex) => {
          const index = vehicle.stages.length - 1 - reversedIndex;
          const attached = t?.stageAttached[index] ?? true;
          const remaining = t?.stagePropellant[index] ?? stage.propellantMass;
          const fraction = stage.propellantMass > 0 ? remaining / stage.propellantMass : 0;
          const active = attached && (t?.activeStageIndex ?? 0) === index;
          return (
            <li
              key={stage.id}
              className={`rounded border px-2 py-1.5 ${active ? 'border-data/60 bg-data/5' : 'border-line/60'} ${attached ? '' : 'opacity-45'}`}
              data-testid={`stage-${index}`}
              data-attached={attached}
            >
              <div className="flex items-baseline justify-between text-[12px]">
                <span className={active ? 'text-data' : 'text-ink'}>
                  {stage.name}
                  <span className="ml-1.5 text-[10px] text-ink-faint">
                    {stage.engineCount}× {stage.engine.name}
                  </span>
                </span>
                <span className="readout text-[11px] text-ink-dim">{attached ? `${formatNumber(fraction * 100, 1)}%` : '已分离'}</span>
              </div>
              {attached && (
                <div className="mt-1">
                  <Meter fraction={fraction} tone={fraction < 0.1 ? 'danger' : fraction < 0.25 ? 'warn' : 'data'} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <SectionLabel>姿态</SectionLabel>
      <Readout label="俯仰" code="PITCH" value={formatAngle(t?.pitch ?? null)} unit="°" testId="readout-pitch" />
      <Readout label="航向" code="HDG" value={formatAngle(t?.heading ?? null)} unit="°" testId="readout-heading" />
    </Panel>
  );
}
