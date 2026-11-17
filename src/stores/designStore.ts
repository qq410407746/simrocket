import { useMemo } from 'react';
import { create } from 'zustand';
import { DESIGN_PARTS } from '@/data/designParts';
import { findVehicle, getVehicleOrDefault } from '@/data/vehicles';
import { compileDesign, DESIGN_BACKUP_LIMIT, DESIGN_LIMIT, parseDesign, parseDesignBackup, type RocketDesign } from '@/game/vehicles/design';

export const DESIGN_STORAGE_KEY = 'orbital-frontier/designs';
const readLibrary = (): { designs: readonly RocketDesign[]; notice: string } => {
  if (typeof window === 'undefined') return { designs: [], notice: '' };
  try {
    const text = localStorage.getItem(DESIGN_STORAGE_KEY);
    if (!text) return { designs: [], notice: '' };
    const designs = text.length <= DESIGN_BACKUP_LIMIT ? parseDesignBackup(JSON.parse(text), DESIGN_PARTS) : null;
    return designs ? { designs, notice: '' } : { designs: [], notice: '图纸存档无法读取，原始数据未覆盖。请先导出原文件或恢复备份。' };
  } catch { return { designs: [], notice: '本地存储不可用或图纸已损坏，无法读取已保存图纸。' }; }
};
interface DesignState {
  designs: readonly RocketDesign[];
  notice: string;
  save: (design: RocketDesign) => boolean;
  remove: (id: string) => boolean;
  importBackup: (text: string) => boolean;
}
export const useDesignStore = create<DesignState>((set, get) => {
  const persist = (designs: readonly RocketDesign[], notice: string): boolean => {
    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify({ version: 1, designs }));
      set({ designs, notice });
      return true;
    } catch { set({ notice: '保存失败：浏览器存储不可用或空间不足。现有图纸未改变，请导出备份。' }); return false; }
  };
  return {
    ...readLibrary(),
    save: (value) => {
      const d = parseDesign(value, DESIGN_PARTS);
      if (!d || !compileDesign(d, DESIGN_PARTS).vehicle) { set({ notice: '图纸无效，未保存。' }); return false; }
      const old = get().designs;
      const exists = old.some((item) => item.id === d.id);
      if (!exists && old.length >= DESIGN_LIMIT) { set({ notice: `最多保存${DESIGN_LIMIT}份图纸，请先备份并删除不需要的图纸。` }); return false; }
      return persist(exists ? old.map((item) => item.id === d.id ? d : item) : [...old, d], '图纸已保存，可在自由飞行中选择。');
    },
    remove: (id) => persist(get().designs.filter((d) => d.id !== id), '图纸已删除。'),
    importBackup: (text) => {
      try {
        const imported = text.length <= DESIGN_BACKUP_LIMIT ? parseDesignBackup(JSON.parse(text), DESIGN_PARTS) : null;
        if (!imported) throw new Error('无效图纸');
        // 同标识但内容不同则拒绝，防止导入悄悄覆盖现有设计。
        const old = get().designs;
        if (imported.some((d) => old.some((other) => other.id === d.id && JSON.stringify(other) !== JSON.stringify(d)))) {
          set({ notice: '导入中存在与已有图纸同标识但内容不同的设计；未导入，请先处理冲突。' }); return false;
        }
        const merged = [...old, ...imported.filter((d) => !old.some((other) => other.id === d.id))];
        if (merged.length > DESIGN_LIMIT) throw new Error('容量超限');
        return persist(merged, '图纸备份已导入。');
      } catch { set({ notice: '备份无效、版本不支持或超过容量，现有图纸未改变。' }); return false; }
    },
  };
});
export const resolveVehicle = (id: string, designs = useDesignStore.getState().designs) =>
  findVehicle(id) ?? compileDesign(designs.find((d) => d.id === id), DESIGN_PARTS).vehicle ?? getVehicleOrDefault(id);
export const hasVehicle = (id: string): boolean => !!findVehicle(id) || useDesignStore.getState().designs.some((d) => d.id === id);
export function useVehicleDefinition(id: string) {
  const designs = useDesignStore((state) => state.designs);
  return useMemo(() => resolveVehicle(id, designs), [id, designs]);
}
