/**
 * 知识库条目的 id（与 wiki.ts 的 WIKI_ARTICLES 顺序一致，由单元测试保证）。
 * 单独放在这里：游戏状态只需要 id 来校验存档，不必把全部条目内容打进首屏的主包。
 */
export const WIKI_ARTICLE_IDS = [
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
] as const;

export type WikiArticleId = (typeof WIKI_ARTICLE_IDS)[number];

export const DEFAULT_WIKI_ARTICLE: WikiArticleId = 'rocket-equation';

export const isWikiArticleId = (id: unknown): id is WikiArticleId => typeof id === 'string' && (WIKI_ARTICLE_IDS as readonly string[]).includes(id);
