import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  stored.clear();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => vi.unstubAllGlobals());

describe('language preference', () => {
  it('keeps Chinese as the default for new and existing players', async () => {
    const { useGameStore } = await import('./gameStore');
    expect(useGameStore.getState()).toMatchObject({ language: 'zh' });
  });

  it('persists English and restores it without altering vehicle or mission choices', async () => {
    const { useGameStore } = await import('./gameStore');
    const before = useGameStore.getState();
    before.setLanguage('en');
    expect(useGameStore.getState()).toMatchObject({
      language: 'en', vehicleId: before.vehicleId, selectedMissionId: before.selectedMissionId,
      launchSerial: before.launchSerial, missionId: before.missionId,
    });
    const save = JSON.parse(stored.get('orbital-frontier/game') ?? '{}');
    expect(save.state.language).toBe('en');
    vi.resetModules();
    const reloaded = await import('./gameStore');
    expect(reloaded.useGameStore.getState().language).toBe('en');
    expect(reloaded.useGameStore.getState().screen).toBe('menu');
  });

  it.each([{}, { language: 'fr' }, { language: null }])('preserves v1 saves with absent or unsupported language: %j', async (saved) => {
    stored.set('orbital-frontier/game', JSON.stringify({ version: 1, state: { ...saved, vehicleId: 'meteor-s', quality: 'low' } }));
    const { useGameStore } = await import('./gameStore');
    expect(useGameStore.getState()).toMatchObject({ language: 'zh', vehicleId: 'meteor-s', quality: 'low' });
  });
});
