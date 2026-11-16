import { describe, expect, it } from 'vitest';
import { createTranslator, isLanguage } from './locale';

describe('bilingual text selection', () => {
  it('selects complete strings without changing numbers, units or key bindings', () => {
    const zh = createTranslator('zh');
    const en = createTranslator('en');
    expect(zh('按 空格 点火起飞', 'Press Space to launch')).toBe('按 空格 点火起飞');
    expect(en('按 空格 点火起飞', 'Press Space to launch')).toBe('Press Space to launch');
    expect(en('近地点 150 km', 'Periapsis 150 km')).toBe('Periapsis 150 km');
    expect(createTranslator('en')).toBe(en);
  });

  it('accepts only supported saved language values', () => {
    expect(isLanguage('zh')).toBe(true);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});
