import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ArchiveViewer } from '@/components/menu/ArchiveViewer';
import { DesignWorkshop } from '@/components/menu/DesignWorkshop';
import { DESIGN_PARTS, designFromVehicle } from '@/data/designParts';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { compileDesign } from '@/game/vehicles/design';
import { useGameStore } from '@/stores/gameStore';
import { dataText } from './dataText';
import { uiMessageText } from './messages';

vi.hoisted(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});

const HAN = /\p{Script=Han}/u;

const render = (element: Parameters<typeof renderToStaticMarkup>[0], language: 'zh' | 'en'): string => {
  useGameStore.setState({ language });
  Object.assign(useGameStore.getInitialState(), useGameStore.getState());
  return renderToStaticMarkup(element);
};

describe('阶段六、七新增界面的英文文本', () => {
  it('状态与存储提示都有英文，中文保持原样', () => {
    const messages = [
      '图纸已保存，可在自由飞行中选择。', '图纸无效，未保存。', '图纸备份已导入。',
      '备份无效、版本不支持或超过容量，现有图纸未改变。', '最多保存20份图纸，请先备份并删除不需要的图纸。',
      '正在保存飞行曲线…', '飞行曲线已保存到当前浏览器。', '曲线保存失败，可能是存储空间不足；日志摘要仍独立保存。',
      '此条曲线存档已损坏，无法回看', '正在读取飞行曲线…',
      '模块接口直径不同；尚未提供转接结构，请选择接口相同的推进级与载荷。', '海平面推重比不超过1，满推力也无法从发射台起飞。',
    ];
    for (const message of messages) {
      expect(uiMessageText(message, 'en'), message).not.toMatch(HAN);
      expect(uiMessageText(message, 'zh')).toBe(message);
    }
    expect(uiMessageText('最多保存20份图纸，请先备份并删除不需要的图纸。', 'en')).toContain('Up to 20 designs');
    // 未知的运行时信息原样保留，便于诊断。
    expect(uiMessageText('QuotaExceededError', 'en')).toBe('QuotaExceededError');
  });

  it('设计器模块名与自定义推进级名称可以翻译', () => {
    for (const part of DESIGN_PARTS.stages) expect(dataText(part.label, 'en'), part.label).not.toMatch(HAN);
    for (const part of DESIGN_PARTS.payloads) expect(dataText(part.payload.name, 'en'), part.payload.name).not.toMatch(HAN);
    const vehicle = compileDesign(designFromVehicle(VEHICLE_CATALOG[2]!, 'custom-test', 'Test'), DESIGN_PARTS).vehicle!;
    for (const stage of vehicle.stages) expect(dataText(stage.name, 'en'), stage.name).toMatch(/^Stage \d \(/);
    expect(dataText(vehicle.role, 'en')).toBe('Custom rocket');
    expect(dataText(vehicle.description, 'en')).not.toMatch(HAN);
  });

  it('火箭设计室在英文下没有中文，在中文下保持中文', () => {
    const english = render(createElement(DesignWorkshop), 'en');
    expect(english).toContain('Rocket design workshop');
    expect(english).toContain('variant');
    expect(english).not.toMatch(HAN);
    expect(render(createElement(DesignWorkshop), 'zh')).toContain('火箭设计室');
  });

  it('遥测回看的读取状态有英文', () => {
    const english = render(createElement(ArchiveViewer, { id: 'missing' }), 'en');
    expect(english).toContain('Loading flight curves');
    expect(english).not.toMatch(HAN);
  });
});
