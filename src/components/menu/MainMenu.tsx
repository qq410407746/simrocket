import { useMemo } from 'react';
import { LAUNCH_SITES, getLaunchSiteOrDefault } from '@/data/launchSites';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { ORBIT_START_ALTITUDE, canStartInOrbit } from '@/game/simulation/startConditions';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { useI18n } from '@/i18n';
import { dataText } from '@/i18n/dataText';
import { useCareerStore } from '@/stores/careerStore';
import { type GraphicsQuality, type MenuTab, type StartMode, useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { formatMass, formatNumber } from '@/utils/format';
import { useDesignStore, resolveVehicle, useVehicleDefinition } from '@/stores/designStore';
import { DesignWorkshop } from './DesignWorkshop';
import { LogbookMenu } from './LogbookMenu';
import { MissionBriefing, MissionList } from './MissionMenu';

const QUALITY_LABEL: Record<GraphicsQuality, readonly [string, string]> = { low: ['低', 'Low'], medium: ['中', 'Medium'], high: ['高', 'High'] };

const TABS: readonly { readonly tab: MenuTab; readonly label: readonly [string, string]; readonly hint: readonly [string, string] }[] = [
  { tab: 'missions', label: ['任务', 'Missions'], hint: ['按顺序完成任务：每个任务规定火箭、发射场与目标，飞完给出评分', 'Complete missions in sequence, each with a vehicle, launch site, objectives and score.'] },
  { tab: 'sandbox', label: ['自由飞行', 'Free flight'], hint: ['自己选择火箭、发射场与出发点，没有目标与评分', 'Choose your vehicle, launch site and starting point. No objectives or scoring.'] },
  { tab: 'design', label: ['火箭设计', '火箭设计'], hint: ['组装、保存与试飞自定义火箭', '组装、保存与试飞自定义火箭'] },
  { tab: 'logbook', label: ['飞行记录', 'Logbook'], hint: ['最近的飞行与成绩', 'Recent flights and results'] },
];

function VehicleCard({ vehicle, selected, onSelect }: { vehicle: VehicleDefinition; selected: boolean; onSelect: () => void }) {
  const { language, t } = useI18n();
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
          {language === 'en' ? vehicle.name : vehicle.nameZh}
          {language === 'zh' && <span className="ml-2 text-[11px] font-normal tracking-wider text-data-dim">{vehicle.name}</span>}
        </span>
        <span className="text-[10px] text-ink-faint">{dataText(vehicle.role, language)}</span>
      </div>
      <dl className="readout mt-1 grid grid-cols-4 gap-x-2 text-[11px]">
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">{t('级数', 'Stages')}</dt>
          <dd className="text-ink-dim">{vehicle.stages.length}</dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">{t('高度', 'Height')}</dt>
          <dd className="text-ink-dim">{formatNumber(perf.height, 1)} m</dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">{t('起飞质量', 'Liftoff mass')}</dt>
          <dd className="text-ink-dim">
            {mass.value} {mass.unit}
          </dd>
        </div>
        <div>
          <dt className="text-[9px] tracking-wider text-ink-faint">{t('理想 Δv', 'Ideal Δv')}</dt>
          <dd className="text-data">{formatNumber(perf.totalDeltaVVacuum / 1000, 2)} km/s</dd>
        </div>
      </dl>
    </button>
  );
}

/** 自由飞行：选择火箭、发射场与出发点。 */
function SandboxSetup() {
  const { language, t } = useI18n();
  const vehicleId = useGameStore((s) => s.vehicleId);
  const siteId = useGameStore((s) => s.siteId);
  const selectVehicle = useGameStore((s) => s.selectVehicle);
  const selectSite = useGameStore((s) => s.selectSite);
  const enterFlight = useGameStore((s) => s.enterFlight);
  const startMode = useGameStore((s) => s.startMode);
  const setStartMode = useGameStore((s) => s.setStartMode);

  const vehicle = useVehicleDefinition(vehicleId);
  const designs = useDesignStore((state) => state.designs);
  const site = getLaunchSiteOrDefault(siteId);
  const orbitAvailable = canStartInOrbit(vehicle);
  const effectiveStart: StartMode = startMode === 'orbit' && orbitAvailable ? 'orbit' : 'pad';

  return (
    <>
      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('选择火箭', 'Select vehicle')}</h2>
        <div className="flex flex-col gap-2">
          {[...VEHICLE_CATALOG, ...designs.map((d) => resolveVehicle(d.id, designs))].map((v) => (
            <VehicleCard key={v.id} vehicle={v} selected={v.id === vehicleId} onSelect={() => selectVehicle(v.id)} />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{dataText(vehicle.description, language)}</p>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('选择发射场', 'Select launch site')}</h2>
        <div className={`grid gap-1 ${language === 'en' ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
                <span className="text-[12px] whitespace-nowrap text-ink">{language === 'en' ? s.name : s.nameZh}</span>
                <span className="readout text-[9.5px] whitespace-nowrap text-ink-faint">
                  {Math.abs(s.latitudeDeg).toFixed(1)}°{s.latitudeDeg >= 0 ? 'N' : 'S'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          <span className="text-ink">{dataText(site.region, language)}</span> — {dataText(site.note, language)}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{t('出发点', 'Starting point')}</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              ['pad', t('发射台', 'Launchpad'), t('从地面发射', 'Launch from the ground')],
              ['orbit', t(`近地轨道 ${ORBIT_START_ALTITUDE / 1000} km`, `Low Earth orbit ${ORBIT_START_ALTITUDE / 1000} km`), orbitAvailable ? t('跳过上升段，练习轨道机动', 'Skip ascent and practice orbital maneuvers') : t('该火箭无法入轨', 'This vehicle cannot reach orbit')],
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
        {effectiveStart === 'orbit' ? t('进入轨道', 'Enter orbit') : t('进入发射台', 'Enter launchpad')}
      </button>
    </>
  );
}

/**
 * 主菜单：任务（列表 + 简报）、自由飞行（选择火箭与发射场）、飞行记录。背景是实时渲染的地球。
 */
export function MainMenu() {
  const { language, t } = useI18n();
  const setLanguage = useGameStore((s) => s.setLanguage);
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] tracking-[0.12em] text-data-dim">{t('航天飞行模拟', 'SPACEFLIGHT SIMULATION')}</p>
            <div className="flex items-center gap-1" role="group" aria-label={t('语言', 'Language')}>
              <span className="mr-1 text-[10px] text-ink-faint">{t('语言', 'Language')}</span>
              {(['zh', 'en'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  lang={value === 'zh' ? 'zh-CN' : 'en'}
                  onClick={() => setLanguage(value)}
                  aria-pressed={language === value}
                  data-testid={`language-${value}`}
                  className={`rounded border px-2 py-1 text-[11px] transition-colors ${language === value ? 'border-data bg-data/10 text-data' : 'border-line text-ink-dim hover:border-data-dim'}`}
                >
                  {value === 'zh' ? '简体中文' : 'English'}
                </button>
              ))}
            </div>
          </div>
          <h1 className="mt-1 text-[26px] leading-none font-bold tracking-[0.12em] text-ink">ORBITAL FRONTIER</h1>
          <p className="mt-1 text-[15px] tracking-[0.5em] text-data">{t('轨道边疆', 'Launch · Orbit · Return')}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{t('以真实的轨道动力学与空气动力学为基础：发射、入轨、轨道机动、再入。', 'Launch, reach orbit, maneuver and reenter — powered by orbital mechanics and aerodynamics.')}</p>
        </header>

        <nav className="grid grid-cols-2 gap-1" role="tablist" aria-label={t('主菜单', 'Main menu')}>
          {TABS.map((entry) => {
            const selected = tab === entry.tab;
            return (
              <button
                key={entry.tab}
                type="button"
                role="tab"
                aria-selected={selected}
                title={t(...entry.hint)}
                onClick={() => setTab(entry.tab)}
                data-testid={`tab-${entry.tab}`}
                className={`rounded-md border px-2 py-1.5 text-[13px] tracking-widest transition-colors ${
                  selected ? 'border-data bg-data/15 font-semibold text-data' : 'border-line text-ink-dim hover:border-data-dim hover:text-ink'
                }`}
              >
                {t(...entry.label)}
              </button>
            );
          })}
        </nav>

        {tab === 'missions' && <MissionList />}
        {tab === 'sandbox' && <SandboxSetup />}
        {tab === 'logbook' && <LogbookMenu />}
        {tab === 'design' && <DesignWorkshop />}

        <footer data-testid="menu-settings" className="mt-auto flex shrink-0 flex-col gap-2 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-faint">{t('画质', 'Graphics')}</span>
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
                  {t(...QUALITY_LABEL[q])}
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between text-[11px] text-ink-faint" title={t('忽略解锁顺序，直接开放全部任务', 'Make all missions available regardless of progression')}>
            <span>{t('解锁全部任务', 'Unlock all missions')}</span>
            <input
              type="checkbox"
              checked={unlockAll}
              onChange={(e) => setUnlockAll(e.target.checked)}
              data-testid="unlock-all"
              className="h-3.5 w-3.5 cursor-pointer accent-data"
            />
          </label>
          <p className="text-[10px] leading-relaxed text-ink-faint">
            {t('开发阶段 7 / 7 · 八个任务，含同步通信卫星部署。火箭设计与存档完善中。', 'Development phase 7 / 7 · Eight missions including GEO satellite deployment. Rocket design and saved-flight features are in development.')}
          </p>
        </footer>
      </div>
      {tab === 'missions' && <MissionBriefing />}
    </div>
  );
}
