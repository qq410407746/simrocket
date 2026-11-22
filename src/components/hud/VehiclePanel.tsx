import { useMemo } from 'react';
import { useVehicleDefinition } from '@/stores/designStore';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import { useGameStore } from '@/stores/gameStore';
import { useSimStore } from '@/stores/simStore';
import { formatForce, formatMass, formatNumber } from '@/utils/format';
import { Meter } from '../ui/Meter';
import { Panel, SectionLabel } from '../ui/Panel';
import { Readout } from '../ui/Readout';

/** 右侧飞行器状态面板：推进、质量、各级推进剂。（俯仰与航向显示在导航球下方。） */
export function VehiclePanel() {
  const { language, t: tr } = useI18n();
  const vehicle = useVehicleDefinition(useGameStore((s) => s.vehicleId));
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
    <Panel title={language === 'zh' ? vehicle.nameZh : vehicle.name} code={language === 'zh' ? vehicle.name : undefined} className="w-68" testId="vehicle-panel">
      <SectionLabel>{tr('推进', 'Propulsion')}</SectionLabel>
      <Readout
        label={tr('发动机', 'Engine')}
        code="ENG"
        value={burning ? tr('工作', 'Running') : t?.ignited ? tr('待机', 'Standby') : tr('关机', 'Off')}
        tone={burning ? 'ok' : t?.ignited ? 'warn' : 'plain'}
        testId="readout-engine"
      />
      <Readout label={tr('推力', 'Thrust')} code="THR" value={thrust.value} unit={thrust.unit} tone={burning ? 'ok' : 'data'} testId="readout-thrust" />
      <Readout
        label={tr('节流阀', 'Throttle')}
        code="TVL"
        value={`${formatNumber(throttle * 100, 0)}${clamped ? ` → ${formatNumber(effective * 100, 0)}` : ''}`}
        unit="%"
        tone={clamped ? 'warn' : 'data'}
        testId="readout-throttle"
      />
      <Readout
        label={burning ? tr('推重比', 'TWR') : tr('起飞推重比', 'Liftoff TWR')}
        code="TWR"
        value={formatNumber(burning ? (t?.thrustToWeight ?? 0) : performance.liftoffTwr, 2)}
        tone={(burning ? (t?.thrustToWeight ?? 0) : performance.liftoffTwr) > 1 ? 'ok' : 'warn'}
        testId="readout-twr"
      />
      <Readout label={tr('总质量', 'Total mass')} code="MASS" value={mass.value} unit={mass.unit} tone="plain" testId="readout-mass" />
      <Readout label={tr('剩余 Δv', 'Remaining Δv')} code="ΔV" value={formatNumber(remainingDeltaV, 0)} unit="m/s" testId="readout-total-dv" />

      <SectionLabel note={tr('自上而下', 'Top to bottom')}>{tr('分级与推进剂', 'Stages & fuel')}</SectionLabel>
      <ul className="flex flex-col gap-1.5">
        <li className={`rounded border px-2 py-1.5 ${payloadOnly ? 'border-data/60 bg-data/5' : 'border-line/60'}`} data-testid="payload-row">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]">
            <span className={payloadOnly ? 'text-data' : 'text-ink'}>
              {dataText(vehicle.payload.name, language)}
              {vehicle.payload.kind === 'satellite' && (
                <span className={`ml-1.5 text-[10px] ${t?.fairingAttached === false ? 'text-ink-faint' : 'text-ink-dim'}`}>
                  {t?.fairingAttached === false ? tr('整流罩已抛', 'Fairing off') : tr('整流罩内', 'In fairing')}
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
              className={`rounded border px-2 ${attached ? 'py-1.5' : 'py-0.5 opacity-45'} ${active ? 'border-data/60 bg-data/5' : 'border-line/60'}`}
              data-testid={`stage-${index}`}
              data-attached={attached}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]">
                <span className={active ? 'text-data' : 'text-ink'}>
                  {dataText(stage.name, language)}
                  <span className="ml-1.5 text-[10px] text-ink-faint">
                    {stage.engineCount}× {stage.engine.name}
                  </span>
                </span>
                <span className="readout text-[11px] text-ink-dim">{attached ? `${formatNumber(fraction * 100, 1)}%` : tr('已分离', 'Separated')}</span>
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
    </Panel>
  );
}
