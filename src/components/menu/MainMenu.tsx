import { useMemo } from 'react';
import { LAUNCH_SITES, getLaunchSiteOrDefault } from '@/data/launchSites';
import { VEHICLE_CATALOG, getVehicleOrDefault } from '@/data/vehicles';
import { ORBIT_START_ALTITUDE, canStartInOrbit } from '@/game/simulation/startConditions';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useCareerStore } from '@/stores/careerStore';
import { type GraphicsQuality, type MenuTab, type StartMode, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { formatMass, formatNumber } from '@/utils/format';
import { LogbookMenu } from './LogbookMenu';
import { MissionBriefing, MissionList } from './MissionMenu';

const QUALITY_LABEL: Record<GraphicsQuality, string> = { low: '低', medium: '中', high: '高' };

const TABS: readonly { readonly tab: MenuTab; readonly label: string; readonly hint: string }[] = [
  { tab: 'missions', label: '任务', hint: '按顺序完成任务：每个任务规定火箭、发射场与目标，飞完给出评分' },
  { tab: 'sandbox', label: '自由飞行', hint: '自己选择火箭、发射场与出发点，没有目标与评分' },
  { tab: 'logbook', label: '飞行记录', hint: '最近的飞行与成绩' },
];

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

/** 自由飞行：选择火箭、发射场与出发点。 */
function SandboxSetup() {
  const vehicleId = useGameStore((s) => s.vehicleId);
  const siteId = useGameStore((s) => s.siteId);
  const selectVehicle = useGameStore((s) => s.selectVehicle);
  const selectSite = useGameStore((s) => s.selectSite);
  const enterFlight = useGameStore((s) => s.enterFlight);
  const startMode = useGameStore((s) => s.startMode);
  const setStartMode = useGameStore((s) => s.setStartMode);

  const vehicle = getVehicleOrDefault(vehicleId);
  const site = getLaunchSiteOrDefault(siteId);
  const orbitAvailable = canStartInOrbit(vehicle);
  const effectiveStart: StartMode = startMode === 'orbit' && orbitAvailable ? 'orbit' : 'pad';

  return (
    <>
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
        <div className="grid grid-cols-3 gap-1">
          {LAUNCH_SITES.map((s) => {
            const selected = s.id === siteId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSite(s.id)}
                aria-pressed={selected}
                data-testid={`site-${s.id}`}
                className={`flex items-baseline justify-between gap-1 rounded-md border px-1.5 py-1.5 text-left transition-colors ${
                  selected ? 'border-data bg-data/10' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
                }`}
              >
                <span className="text-[12px] whitespace-nowrap text-ink">{s.nameZh}</span>
                <span className="readout text-[9.5px] whitespace-nowrap text-ink-faint">
                  {Math.abs(s.latitudeDeg).toFixed(1)}°{s.latitudeDeg >= 0 ? 'N' : 'S'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          <span className="text-ink">{site.region}</span> — {site.note}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">出发点</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ['pad', '发射台', '从地面发射'],
              ['orbit', `近地轨道 ${ORBIT_START_ALTITUDE / 1000} km`, orbitAvailable ? '跳过上升段，练习轨道机动' : '该火箭无法入轨'],
            ] as const
          ).map(([mode, title, note]) => {
            const selected = effectiveStart === mode;
            const disabled = mode === 'orbit' && !orbitAvailable;
            return (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                onClick={() => setStartMode(mode)}
                aria-pressed={selected}
                data-testid={`start-${mode}`}
                className={`rounded-md border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  selected ? 'border-data bg-data/10' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
                }`}
              >
                <div className="text-[12px] text-ink">{title}</div>
                <div className="text-[10px] text-ink-faint">{note}</div>
              </button>
            );
          })}
        </div>
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
        {effectiveStart === 'orbit' ? '进入轨道' : '进入发射台'}
      </button>
    </>
  );
}

/**
 * 主菜单：任务（列表 + 简报）、自由飞行（选择火箭与发射场）、飞行记录。背景是实时渲染的地球。
 */
export function MainMenu() {
  const tab = useGameStore((s) => s.menuTab);
  const setTab = useGameStore((s) => s.setMenuTab);
  const quality = useGameStore((s) => s.quality);
  const setQuality = useGameStore((s) => s.setQuality);
  const unlockAll = useCareerStore((s) => s.unlockAll);
  const setUnlockAll = useCareerStore((s) => s.setUnlockAll);

  return (
    <div className="flex h-full items-stretch gap-3 p-4 sm:p-5" data-testid="main-menu">
      <div className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[440px] shrink-0 flex-col gap-2.5 overflow-y-auto rounded-xl px-5 py-3.5 backdrop-blur-md">
        <header>
          <p className="text-[10px] tracking-[0.3em] text-data-dim">航天飞行模拟 · SPACEFLIGHT SIMULATION</p>
          <h1 className="mt-1 text-[26px] leading-none font-bold tracking-[0.12em] text-ink">ORBITAL FRONTIER</h1>
          <p className="mt-1 text-[15px] tracking-[0.5em] text-data">轨道边疆</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">以真实的轨道动力学与空气动力学为基础：发射、入轨、轨道机动、再入。</p>
        </header>

        <nav className="grid grid-cols-3 gap-1" role="tablist" aria-label="主菜单">
          {TABS.map((entry) => {
            const selected = tab === entry.tab;
            return (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={selected}
                title={entry.hint}
                onClick={() => setTab(entry.tab)}
                data-testid={`tab-${entry.tab}`}
                className={`rounded-md border px-2 py-1.5 text-[13px] tracking-widest transition-colors ${
                  selected ? 'border-data bg-data/15 font-semibold text-data' : 'border-line text-ink-dim hover:border-data-dim hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>

        {tab === 'missions' && <MissionList />}
        {tab === 'sandbox' && <SandboxSetup />}
        {tab === 'logbook' && <LogbookMenu />}

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
          <label className="flex cursor-pointer items-center justify-between text-[11px] text-ink-faint" title="忽略解锁顺序，直接开放全部任务">
            <span>解锁全部任务</span>
            <input
              type="checkbox"
              checked={unlockAll}
              onChange={(e) => setUnlockAll(e.target.checked)}
              data-testid="unlock-all"
              className="h-3.5 w-3.5 cursor-pointer accent-data"
            />
          </label>
          <p className="text-[10px] leading-relaxed text-ink-faint">
            开发阶段 5 / 7 · 七个任务：亚轨道、入轨、指定倾角、极地轨道、载人返回；带评分、教学提示与飞行记录。高级轨道任务（GTO / GEO）属于阶段六。
          </p>
        </footer>
      </div>
      {tab === 'missions' && <MissionBriefing />}
    </div>
  );
}
