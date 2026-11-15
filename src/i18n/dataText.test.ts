import { describe, expect, it } from 'vitest';
import { LAUNCH_SITES } from '@/data/launchSites';
import { VEHICLE_CATALOG } from '@/data/vehicles';
import { dataText } from './dataText';

const content = [
  ...LAUNCH_SITES.flatMap((site) => [site.nameZh, site.region, site.note]),
  ...VEHICLE_CATALOG.flatMap((vehicle) => [
    vehicle.nameZh, vehicle.role, vehicle.description, vehicle.payload.name,
    ...vehicle.stages.map((stage) => stage.name),
    ...vehicle.stages.flatMap((stage) => [stage.thermal.side.material, stage.thermal.base.material]),
  ]),
  '整流罩（软木防热层）', '隔热瓦', '舱底结构（无防热）', '烧蚀防热层', '卫星本体',
];

describe('localized catalog metadata', () => {
  it('covers every vehicle, stage, launch site and thermal material in English', () => {
    for (const text of content) {
      expect(dataText(text, 'en'), text).not.toMatch(/\p{Script=Han}/u);
      expect(dataText(text, 'zh')).toBe(text);
    }
  });

  it('preserves unknown names and identifiers rather than modifying simulation data', () => {
    expect(dataText('Ember-1A', 'en')).toBe('Ember-1A');
    expect(dataText('future-vehicle-id', 'zh')).toBe('future-vehicle-id');
  });
});
