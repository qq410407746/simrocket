import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { designFromVehicle } from '@/data/designParts';
import { getVehicleOrDefault } from '@/data/vehicles';
const saved = new Map<string, string>();
beforeEach(() => {
  vi.resetModules(); saved.clear();
  const storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } };
  vi.stubGlobal('localStorage', storage); vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());
const draft = () => designFromVehicle(getVehicleOrDefault('meteor-s'), 'custom-test');
describe('图纸持久化', () => {
  it('刷新恢复自定义选择；任务仍强制规定型号', async () => {
    const { useDesignStore } = await import('./designStore');
    expect(useDesignStore.getState().save(draft())).toBe(true);
    const { useGameStore } = await import('./gameStore');
    useGameStore.getState().selectVehicle('custom-test');
    vi.resetModules();
    const { useGameStore: reloaded } = await import('./gameStore');
    expect(reloaded.getState().vehicleId).toBe('custom-test');
    reloaded.getState().startMission('first-orbit');
    expect(reloaded.getState().vehicleId).toBe('frontier-1');
  });
  it('存储配额失败不改内存或已有图纸，并明确提示', async () => {
    const { useDesignStore } = await import('./designStore');
    useDesignStore.getState().save(draft());
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(useDesignStore.getState().save({ ...draft(), name: '新名称' })).toBe(false);
    expect(useDesignStore.getState().designs[0]!.name).toBe(draft().name);
    expect(useDesignStore.getState().notice).toContain('保存失败');
  });
  it('坏文件、重复导入与同标识冲突不破坏现有设计', async () => {
    const { useDesignStore } = await import('./designStore');
    const state = useDesignStore.getState(); state.save(draft());
    expect(state.importBackup('{坏文件')).toBe(false);
    expect(state.importBackup(JSON.stringify({ version: 1, designs: [draft()] }))).toBe(true);
    expect(state.importBackup(JSON.stringify({ version: 1, designs: [{ ...draft(), name: '冲突' }] }))).toBe(false);
    expect(useDesignStore.getState().designs).toEqual([draft()]);
  });
  it('坏存档原文保留，未知物理参数不能进入解析', async () => {
    saved.set('orbital-frontier/designs', '{损坏');
    const { useDesignStore } = await import('./designStore');
    expect(useDesignStore.getState().designs).toEqual([]);
    expect(useDesignStore.getState().notice).toContain('损坏');
    expect(saved.get('orbital-frontier/designs')).toBe('{损坏');
  });
});
