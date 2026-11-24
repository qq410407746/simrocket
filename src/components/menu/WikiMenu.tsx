import { useMemo, useState } from 'react';
import { CELESTIAL_BODIES, type BodyId, circularOrbitAt, findBody } from '@/data/celestialBodies';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { type Bilingual, type WikiArticle, type WikiBlock, type WikiCategory, type WikiWidget, WIKI_ARTICLES, WIKI_CATEGORY_LABEL, findWikiArticle } from '@/data/wiki';
import { idealDeltaV } from '@/game/physics/propulsion/engine';
import { analyzeVehicle } from '@/game/vehicles/analysis';
import { useI18n } from '@/i18n';
import type { Language } from '@/i18n/locale';
import { useGameStore } from '@/stores/gameStore';
import { formatMass, formatNumber } from '@/utils/format';

const pick = (text: Bilingual, language: Language): string => (language === 'en' ? text[1] : text[0]);

const CATEGORIES: readonly WikiCategory[] = ['theory', 'bodies'];

/** 知识库目录：按"原理 / 天体"分组。 */
export function WikiIndex() {
  const { language, t } = useI18n();
  const selected = useGameStore((s) => s.wikiArticleId);
  const select = useGameStore((s) => s.selectWikiArticle);
  return (
    <section data-testid="wiki-index" className="flex flex-col gap-2.5">
      {CATEGORIES.map((category) => (
        <div key={category}>
          <h2 className="mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-ink-faint">{pick(WIKI_CATEGORY_LABEL[category], language)}</h2>
          <ul className="flex flex-col gap-1.5">
            {WIKI_ARTICLES.filter((a) => a.category === category).map((article) => {
              const active = article.id === selected;
              return (
                <li key={article.id}>
                  <button
                    type="button"
                    onClick={() => select(article.id)}
                    aria-pressed={active}
                    data-testid={`wiki-${article.id}`}
                    className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                      active ? 'border-data bg-data/10 shadow-[0_0_18px_rgb(95_212_255/0.18)]' : 'border-line bg-panel/40 hover:border-data-dim hover:bg-raised/70'
                    }`}
                  >
                    <span className="block text-[13px] font-semibold text-ink">{pick(article.title, language)}</span>
                    <span className="block text-[10.5px] leading-snug text-ink-faint">{pick(article.summary, language)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <p className="text-[10px] leading-relaxed text-ink-faint">
        {t('文中的数值由游戏使用的同一套常量和公式现算；月球、火星的资料来自维基百科（附出处）。', 'Figures are computed live from the same constants and formulas the game uses; Moon and Mars data come from Wikipedia (sources listed).')}
      </p>
    </section>
  );
}

const inputClass = 'readout w-full rounded border border-line bg-void/60 px-1.5 py-0.5 text-[12px] text-ink focus:border-data focus:outline-none';

function NumberField({ label, unit, value, onChange, testId, min = 0 }: { label: string; unit: string; value: string; onChange: (v: string) => void; testId: string; min?: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-ink-faint">
      <span>
        {label} <span className="text-ink-faint/80">[{unit}]</span>
      </span>
      <input type="number" inputMode="decimal" min={min} step="any" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} className={inputClass} />
    </label>
  );
}

const parse = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

function RocketEquationCalculator() {
  const { t } = useI18n();
  const [isp, setIsp] = useState('320');
  const [m0, setM0] = useState('300');
  const [mf, setMf] = useState('100');
  const ispValue = parse(isp);
  const initial = parse(m0);
  const final = parse(mf);
  const valid = ispValue > 0 && initial > 0 && final > 0 && final <= initial;
  const dv = valid ? idealDeltaV(ispValue, initial, final) : Number.NaN;
  return (
    <div className="rounded-md border border-line/80 bg-void/40 p-2.5" data-testid="rocket-equation-calculator">
      <div className="grid grid-cols-3 gap-2">
        <NumberField label={t('比冲', 'Isp')} unit="s" value={isp} onChange={setIsp} testId="rocket-eq-isp" />
        <NumberField label={t('点火时质量 m₀', 'Initial mass m₀')} unit="t" value={m0} onChange={setM0} testId="rocket-eq-m0" />
        <NumberField label={t('关机时质量 m_f', 'Final mass m_f')} unit="t" value={mf} onChange={setMf} testId="rocket-eq-mf" />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-dim">
        {t('质量比', 'Mass ratio')} <span className="readout text-ink">{valid ? formatNumber(initial / final, 2) : '—'}</span>
        {' · '}
        {t('推进剂占比', 'Propellant fraction')} <span className="readout text-ink">{valid ? `${formatNumber(100 * (1 - final / initial), 1)}%` : '—'}</span>
        {' · '}Δv <span className="readout text-[14px] font-semibold text-data" data-testid="rocket-eq-result">{valid ? `${formatNumber(dv, 0)} m/s` : '—'}</span>
      </p>
      {!valid && <p className="mt-1 text-[10.5px] text-warn">{t('请输入正数，且关机时质量不大于点火时质量。', 'Enter positive numbers, with the final mass no larger than the initial mass.')}</p>}
    </div>
  );
}

function VehicleDeltaVTable() {
  const { language, t } = useI18n();
  const rows = useMemo(() => VEHICLE_CATALOG.map((vehicle) => ({ vehicle, perf: analyzeVehicle(vehicle) })), []);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]" data-testid="wiki-vehicle-table">
        <thead>
          <tr className="text-left text-[10px] tracking-wider text-ink-faint">
            <th className="py-1 pr-2 font-normal">{t('火箭', 'Vehicle')}</th>
            <th className="py-1 pr-2 font-normal">{t('级数', 'Stages')}</th>
            <th className="py-1 pr-2 font-normal">{t('起飞质量', 'Liftoff mass')}</th>
            <th className="py-1 pr-2 font-normal">{t('起飞推重比', 'Liftoff TWR')}</th>
            <th className="py-1 font-normal">{t('理想 Δv（真空）', 'Ideal Δv (vacuum)')}</th>
          </tr>
        </thead>
        <tbody className="readout">
          {rows.map(({ vehicle, perf }) => {
            const mass = formatMass(perf.liftoffMass);
            return (
              <tr key={vehicle.id} className="border-t border-line/50 text-ink-dim">
                <td className="py-1 pr-2 text-ink">{language === 'en' ? vehicle.name : vehicle.nameZh}</td>
                <td className="py-1 pr-2">{vehicle.stages.length}</td>
                <td className="py-1 pr-2">
                  {mass.value} {mass.unit}
                </td>
                <td className="py-1 pr-2">{formatNumber(perf.liftoffTwr, 2)}</td>
                <td className="py-1 text-data">{formatNumber(perf.totalDeltaVVacuum, 0)} m/s</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrbitCalculator() {
  const { language, t } = useI18n();
  const [bodyId, setBodyId] = useState<BodyId>('earth');
  const [altitude, setAltitude] = useState('200');
  const body = findBody(bodyId);
  const h = parse(altitude);
  const valid = Number.isFinite(h) && h >= 0;
  const orbit = valid ? circularOrbitAt(body, h * 1000) : null;
  const cell = (label: string, value: string, testId: string) => (
    <div>
      <dt className="text-[9.5px] tracking-wider text-ink-faint">{label}</dt>
      <dd className="readout text-[12.5px] text-data" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
  return (
    <div className="rounded-md border border-line/80 bg-void/40 p-2.5" data-testid="orbit-calculator">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1" role="group" aria-label={t('天体', 'Body')}>
          {CELESTIAL_BODIES.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBodyId(b.id)}
              aria-pressed={b.id === bodyId}
              data-testid={`orbit-body-${b.id}`}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${b.id === bodyId ? 'border-data bg-data/10 text-data' : 'border-line text-ink-dim hover:border-data-dim'}`}
            >
              {language === 'en' ? b.name : b.nameZh}
            </button>
          ))}
        </div>
        <div className="w-32">
          <NumberField label={t('圆轨道高度', 'Orbit altitude')} unit="km" value={altitude} onChange={setAltitude} testId="orbit-altitude" />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        {cell(t('轨道速度', 'Orbital speed'), orbit ? `${formatNumber(orbit.speed, 0)} m/s` : '—', 'orbit-speed')}
        {cell(t('周期', 'Period'), orbit ? `${formatNumber(orbit.period / 60, 1)} min` : '—', 'orbit-period')}
        {cell(t('当地逃逸速度', 'Local escape speed'), orbit ? `${formatNumber(orbit.escapeSpeed, 0)} m/s` : '—', 'orbit-escape')}
        {cell(t('当地重力', 'Local gravity'), orbit ? `${formatNumber(orbit.gravity, 2)} m/s²` : '—', 'orbit-gravity')}
      </dl>
      <p className="mt-1.5 text-[10px] text-ink-faint">{t('按平均半径、二体引力计算，不考虑大气阻力。', 'Two-body gravity from the mean radius; atmospheric drag is ignored.')}</p>
    </div>
  );
}

const WIDGETS: Record<WikiWidget, () => React.JSX.Element> = {
  'rocket-equation': RocketEquationCalculator,
  'vehicle-deltav': VehicleDeltaVTable,
  'orbit-calculator': OrbitCalculator,
};

function Block({ block, language }: { block: WikiBlock; language: Language }) {
  const { t } = useI18n();
  switch (block.kind) {
    case 'p':
      return <p>{pick(block.text, language)}</p>;
    case 'formula':
      return (
        <figure className="rounded-md border border-line/70 bg-void/50 px-3 py-2" data-testid="wiki-formula">
          <div className="readout overflow-x-auto text-[14px] whitespace-nowrap text-data">{block.expr}</div>
          {block.where && <figcaption className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">{pick(block.where, language)}</figcaption>}
        </figure>
      );
    case 'list':
      return (
        <ul className="ml-4 flex list-disc flex-col gap-1 marker:text-data-dim">
          {block.items.map((item) => (
            <li key={item[0]}>{pick(item, language)}</li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] tracking-wider text-ink-faint">
                {block.head.map((cell, i) => (
                  <th key={i} className="py-1 pr-2 font-normal">
                    {pick(cell, language)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-t border-line/50 align-top">
                  {row.map((cell, c) => (
                    <td key={c} className={`py-1 pr-2 ${c === 0 ? 'text-ink' : 'readout text-ink-dim'}`}>
                      {typeof cell === 'string' ? cell : pick(cell, language)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'game':
      return (
        <p className="rounded-md border border-data-dim/50 bg-data/5 px-2.5 py-1.5 text-[11px]" data-testid="wiki-game-note">
          <span className="mr-1.5 font-semibold tracking-wider text-data">{t('游戏中', 'In the game')}</span>
          {pick(block.text, language)}
        </p>
      );
    case 'widget': {
      const Widget = WIDGETS[block.widget];
      return <Widget />;
    }
  }
}

function ArticleBody({ article }: { article: WikiArticle }) {
  const { language, t } = useI18n();
  const select = useGameStore((s) => s.selectWikiArticle);
  return (
    <>
      <header>
        <p className="text-[10px] tracking-[0.2em] text-data-dim">
          {t('知识库', 'Wiki')} · {pick(WIKI_CATEGORY_LABEL[article.category], language)}
        </p>
        <h2 className="mt-1 text-[20px] leading-tight font-bold tracking-wider text-ink" data-testid="wiki-title">
          {pick(article.title, language)}
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-data">{pick(article.summary, language)}</p>
      </header>
      {article.sections.map((section) => (
        <section key={section.heading[0]} className="flex flex-col gap-2 text-[11.5px] leading-relaxed text-ink-dim">
          <h3 className="border-b border-line/60 pb-0.5 text-[13px] font-semibold tracking-wider text-ink">{pick(section.heading, language)}</h3>
          {section.blocks.map((block, i) => (
            <Block key={i} block={block} language={language} />
          ))}
        </section>
      ))}
      <footer className="flex flex-col gap-2 border-t border-line/60 pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] tracking-wider text-ink-faint">{t('相关条目', 'Related')}</span>
          {article.related.map((id) => {
            const related = findWikiArticle(id);
            if (!related) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                data-testid={`wiki-related-${id}`}
                className="rounded border border-line px-2 py-0.5 text-[11px] text-data-dim transition-colors hover:border-data hover:text-data"
              >
                {pick(related.title, language)}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] leading-relaxed text-ink-faint" data-testid="wiki-sources">
          {t('资料来源：', 'Sources: ')}
          {article.sources.join(language === 'en' ? '; ' : '；')}
        </p>
      </footer>
    </>
  );
}

/** 知识库正文：显示目录里选中的条目。 */
export function WikiArticleView() {
  const id = useGameStore((s) => s.wikiArticleId);
  const article = findWikiArticle(id) ?? (WIKI_ARTICLES[0] as WikiArticle);
  return (
    <article
      key={article.id}
      className="panel-frame scroll-thin pointer-events-auto flex w-full max-w-[600px] flex-col gap-3 overflow-y-auto rounded-xl px-5 py-3.5 backdrop-blur-md"
      data-testid="wiki-article"
    >
      <ArticleBody article={article} />
    </article>
  );
}
