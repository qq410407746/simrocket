import { useMemo } from 'react';
import { LAUNCH_SITES, getLaunchSiteOrDefault } from '@/data/launchSites';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { type GraphicsQuality, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { formatMass, formatNumber } from '@/utils/format';

const QUALITY_LABEL: Record<GraphicsQuality, string> = { low: '低', medium: '中', high: '高' };

function VehicleCard({ vehicle, selected, onSelect }: { vehicle: VehicleDefinition; selected: boolean; onSelect: () => void }) {
  const perf = useMemo(() => analyzeVehicle(vehicle), [vehicle]);
  const mass = formatMass(perf.liftoffMass);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`vehicle-${vehicle.id}`}
      className={`w-full rounded-md border px-3 py-1.5 text-left transition-colors ${
        selected ? 'border-data bg-data/10 shadow-[0_0_18px_rgb(95_212_255/0.18)]' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-ink">
          {vehicle.nameZh}
          <span className="ml-2 text-[11px] font-normal tracking-wider text-data-dim">{vehicle.name}</span>
        </span>
        <span className="text-[10px] text-ink-faint">{vehicle.role}</span>
      </div>
      <dl className="readout mt-1 grid grid-cols-4 gap-x-2 text-[11px]">
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">级数</dt>
          <dd className="text-ink-dim">{vehicle.stages.length}</dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">高度</dt>
          <dd className="text-ink-dim">{formatNumber(perf.height, 1)} m</dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">起飞质量</dt>
          <dd className="text-ink-dim">
            {mass.value} {mass.unit}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">理想 Δv</dt>
          <dd className="text-data">{formatNumber(perf.totalDeltaVVacuum / 1000, 2)} km/s</dd>
        </div>
      </dl>
    </button>
  );
}

/** 主菜单：选择火箭与发射场，进入发射台。背景是实时渲染的地球。 */
export function MainMenu() {
  const vehicleId = useGameStore((s) => s.vehicleId);
  const siteId = useGameStore((s) => s.siteId);
  const quality = useGameStore((s) => s.quality);
  const selectVehicle = useGameStore((s) => s.selectVehicle);
  const selectSite = useGameStore((s) => s.selectSite);
  const setQuality = useGameStore((s) => s.setQuality);
  const enterFlight = useGameStore((s) => s.enterFlight);

  const vehicle = getVehicleOrDefault(vehicleId);
  const site = getLaunchSiteOrDefault(siteId);

  return (
    <div className="flex h-full items-stretch p-4 sm:p-6" data-testid="main-menu">
      <div className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[440px] flex-col gap-3 overflow-y-auto rounded-xl px-5 py-4 backdrop-blur-md">
        <header>
          <p className="text-[10px] tracking-[0.3em] text-data-dim">航天飞行模拟 · SPACEFLIGHT SIMULATION</p>
          <h1 className="mt-1 text-[30px] leading-none font-bold tracking-[0.12em] text-ink">ORBITAL FRONTIER</h1>
          <p className="mt-1.5 text-[18px] tracking-[0.5em] text-data">轨道边疆</p>
          <p className="mt-2.5 text-[12px] leading-relaxed text-ink-dim">
            从地球表面出发，以真实的轨道动力学、空气动力学与热物理为基础，完成发射、入轨与再入返回。
          </p>
        </header>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">选择火箭</h2>
          <div className="flex flex-col gap-2">
            {VEHICLE_CATALOG.map((v) => (
              <VehicleCard key={v.id} vehicle={v} selected={v.id === vehicleId} onSelect={() => selectVehicle(v.id)} />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{vehicle.description}</p>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">选择发射场</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {LAUNCH_SITES.map((s) => {
              const selected = s.id === siteId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSite(s.id)}
                  aria-pressed={selected}
                  data-testid={`site-${s.id}`}
                  className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                    selected ? 'border-data bg-data/10' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
                  }`}
                >
                  <div className="text-[12px] text-ink">{s.nameZh}</div>
                  <div className="readout text-[10px] text-ink-faint">
                    {Math.abs(s.latitudeDeg).toFixed(1)}°{s.latitudeDeg >= 0 ? 'N' : 'S'}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
            <span className="text-ink">{site.region}</span> — {site.note}
          </p>
        </section>

        <button
          type="button"
          onClick={() => {
            simRuntime.setTimeWarp(1);
            simRuntime.setPaused(false);
            enterFlight();
          }}
          data-testid="enter-flight"
          className="rounded-md border border-data bg-data/15 px-4 py-2.5 text-[15px] font-semibold tracking-[0.3em] text-data transition-colors hover:bg-data/25"
        >
          进入发射台
        </button>

        <footer className="mt-auto flex flex-col gap-2 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-faint">画质</span>
            <div className="flex gap-1">
              {(Object.keys(QUALITY_LABEL) as GraphicsQuality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  aria-pressed={quality === q}
                  data-testid={`quality-${q}`}
                  className={`rounded border px-2.5 py-0.5 text-[11px] transition-colors ${
                    quality === q ? 'border-data text-data' : 'border-line text-ink-dim hover:border-data-dim'
                  }`}
                >
                  {QUALITY_LABEL[q]}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-ink-faint">
            开发阶段 2 / 7 · 可以点火起飞、分级并尝试入轨。轨道参数显示与轨道地图属于阶段三，降落伞与热防护属于阶段四。
          </p>
        </footer>
      </div>
    </div>
  );
}
