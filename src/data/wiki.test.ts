/**
 * 知识库：条目结构完整、双语齐全，文中现算的数与公认值一致。
 */
import { describe, expect, it } from 'vitest';
import { CELESTIAL_BODIES, MARS_BODY, MOON_BODY, cosmicVelocities, derivedSurface } from './celestialBodies';
import { type Bilingual, type WikiBlock, WIKI_ARTICLES, WIKI_FIGURES, findWikiArticle, isWikiArticleId } from './wiki';
import { VOYAGER_ROUTES } from './voyagerReference';
import { evaluateRoute } from '@/game/interplanetary/mga';
import { VOYAGER } from '@/game/interplanetary/testing/horizons';

const HAN = /\p{Script=Han}/u;

const textsOf = (block: WikiBlock): Bilingual[] => {
  switch (block.kind) {
    case 'p':
    case 'game':
      return [block.text];
    case 'formula':
      return block.where ? [block.where] : [];
    case 'list':
      return [...block.items];
    case 'table':
      return [...block.head, ...block.rows.flat().filter((cell): cell is Bilingual => typeof cell !== 'string')];
    case 'widget':
      return [];
  }
};

describe('知识库条目', () => {
  it('包含要求的主题（含"轨道之星"四条），id 唯一，相关条目都存在', () => {
    expect(WIKI_ARTICLES.map((a) => a.id)).toEqual([
      'physics-basics',
      'rocket-equation',
      'orbital-elements',
      'cosmic-velocities',
      'earth',
      'moon',
      'mars',
      'gravity-assist',
      'voyager-grand-tour',
      'multi-revolution-lambert',
      'deep-space-maneuvers',
    ]);
    expect(WIKI_ARTICLES.filter((a) => a.category === 'showcase')).toHaveLength(4);
    for (const article of WIKI_ARTICLES) {
      expect(isWikiArticleId(article.id)).toBe(true);
      expect(article.sections.length).toBeGreaterThan(0);
      expect(article.sources.length).toBeGreaterThan(0);
      for (const id of article.related) {
        expect(findWikiArticle(id)).toBeDefined();
        expect(id).not.toBe(article.id);
      }
    }
    expect(isWikiArticleId('nope')).toBe(false);
  });

  it('每段文字都有中英两份：中文含汉字，英文不含汉字；公式、来源、表格里的纯数值也不含汉字', () => {
    for (const article of WIKI_ARTICLES) {
      const pairs: Bilingual[] = [article.title, article.summary];
      const shared: string[] = [...article.sources];
      for (const section of article.sections) {
        pairs.push(section.heading);
        for (const block of section.blocks) {
          pairs.push(...textsOf(block));
          if (block.kind === 'formula') shared.push(block.expr);
          if (block.kind === 'table') shared.push(...block.rows.flat().filter((cell): cell is string => typeof cell === 'string'));
        }
      }
      for (const [zh, en] of pairs) {
        expect(en, `${article.id}: ${zh}`).not.toMatch(HAN);
        // 表头的空单元格两边都为空
        if (zh !== '') expect(zh).toMatch(HAN);
        expect(en.length > 0).toBe(zh.length > 0);
        // 现算的数不能是 NaN / Infinity
        expect(`${zh}${en}`).not.toMatch(/NaN|Infinity|— ?(km|m\/s|%|°|d|h|min|Pa)\b/);
      }
      for (const text of shared) {
        expect(text, article.id).not.toMatch(HAN);
        expect(text).not.toMatch(/NaN|Infinity/);
      }
    }
  });
});

describe('知识库里现算的数', () => {
  it('三个宇宙速度：7.9、11.2、16.7 km/s', () => {
    const v = cosmicVelocities();
    expect(v.first / 1000).toBeCloseTo(7.91, 2);
    expect(v.second / 1000).toBeCloseTo(11.19, 2);
    expect(v.third / 1000).toBeGreaterThan(16.6);
    expect(v.third / 1000).toBeLessThan(16.7);
    // 资料：在地球轨道处脱离太阳 42.1 km/s，地球平均公转速度 29.78 km/s
    expect(v.solarEscapeAtEarth / 1000).toBeCloseTo(42.1, 1);
    expect(v.earthOrbitSpeed / 1000).toBeCloseTo(29.78, 2);
  });

  it('由 μ 和平均半径推导的表面重力、逃逸速度与资料一致', () => {
    for (const body of CELESTIAL_BODIES) {
      const derived = derivedSurface(body);
      // 资料中的表面重力含自转与非球形的影响，相差不到 0.5%
      expect(Math.abs(derived.gravity - body.surfaceGravity) / body.surfaceGravity).toBeLessThan(0.005);
      expect(Math.abs(derived.escapeSpeed - body.escapeVelocity) / body.escapeVelocity).toBeLessThan(0.002);
      // μ 与质量相互一致（G = 6.6743e-11）
      expect(Math.abs(body.mu / body.mass - 6.6743e-11) / 6.6743e-11).toBeLessThan(0.002);
    }
    expect(derivedSurface(MOON_BODY).gravity).toBeCloseTo(1.62, 2);
    expect(derivedSurface(MARS_BODY).escapeSpeed / 1000).toBeCloseTo(5.03, 2);
  });

  it('近地轨道、静止轨道、转移轨道的数量级正确', () => {
    const f = WIKI_FIGURES;
    expect(f.leo.speed).toBeCloseTo(7788, 0);
    expect(f.leo.period / 60).toBeCloseTo(88.4, 1);
    expect(f.geoAltitude / 1000).toBeCloseTo(35_786, 0);
    // 200 km → GEO：约 2.45 + 1.48 km/s；从 28.5° 出发的远地点合并机动约 1.8 km/s
    expect(f.geoTransfer.departure).toBeGreaterThan(2400);
    expect(f.geoTransfer.departure).toBeLessThan(2500);
    expect(f.geoTransfer.arrival).toBeGreaterThan(1400);
    expect(f.geoTransfer.arrival).toBeLessThan(1500);
    expect(f.capeGeoArrival).toBeGreaterThan(1750);
    expect(f.capeGeoArrival).toBeLessThan(1850);
    // 地月转移约 3.1 km/s、5 天；地火霍曼约 259 天、相位角约 44°
    expect(f.moonTransfer.departure).toBeGreaterThan(3050);
    expect(f.moonTransfer.departure).toBeLessThan(3200);
    expect(f.moonTransfer.time / 86_400).toBeCloseTo(5, 0);
    expect(f.marsTransfer.time / 86_400).toBeCloseTo(259, 0);
    expect(f.marsPhase).toBeGreaterThan(43);
    expect(f.marsPhase).toBeLessThan(45);
    expect(f.marsTransfer.fromLeo).toBeGreaterThan(3500);
    expect(f.marsTransfer.fromLeo).toBeLessThan(3700);
    // 单级入轨的例子：Isp 340 s、9.4 km/s → 质量比约 16.8
    expect(f.exampleRatio).toBeCloseTo(16.8, 1);
  });
});

describe('轨道之星：旅行者号参考数据', () => {
  it('与 JPL Horizons 基准文件一致，本模型重算的偏转角相差 < 1°', () => {
    for (const route of VOYAGER_ROUTES) {
      const fixture = VOYAGER[route.id].encounters as Record<string, { closestApproachJd: number; closestApproachKm: number }>;
      for (const e of route.encounters) {
        expect(e.jd).toBeCloseTo(fixture[e.body]!.closestApproachJd, 5);
        expect(e.closestKm).toBe(fixture[e.body]!.closestApproachKm);
      }
      const sequence = ['earth', ...route.encounters.map((e) => e.body)] as const;
      const s = evaluateRoute(sequence, [route.launchJd, ...route.encounters.map((e) => e.jd)], { parkingAltitude: 200_000, arrival: 'flyby', captureAltitude: 0, table: 'table1' })!;
      s.flybys.forEach((f, i) => {
        const turn = route.encounters[i]!.turnDeg!;
        expect(Math.abs((f.flyby.turnAngle * 180) / Math.PI - turn)).toBeLessThan(1);
      });
      expect(route.encounters[route.encounters.length - 1]!.turnDeg).toBeNull();
    }
  });
});
