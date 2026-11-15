import { describe, expect, it } from 'vitest';
import type { FlightOutcome } from '@/game/simulation/types';
import type { LandingLimits, StructuralLimits } from '@/game/vehicles/types';
import { PARACHUTE_LABEL, RISK_LABEL, describeOutcome, failureTitle, thermalRisk, thermalZoneLabel } from './thermalLabels';

const landing: LandingLimits = { verticalSpeed: 10, horizontalSpeed: 8, tilt: Math.PI / 4 };
const structure: StructuralLimits = { maxGLoad: 14, maxDynamicPressure: 150_000, maxBendingLoad: Infinity };
const base: FlightOutcome = {
  kind: 'destroyed',
  cause: 'impact',
  thermalZone: null,
  time: 900,
  altitude: 0,
  impactSpeed: 120,
  verticalSpeed: -119,
  tilt: 0.1,
  latitude: 0.1,
  longitude: -0.5,
};
const context = { landing, structure, zoneLabel: null, zoneMaterial: null, parachute: 'stowed' as const };

describe('热区名称', () => {
  it('带整流罩时头部是整流罩；只剩返回舱时底部是防热大底', () => {
    expect(thermalZoneLabel({ zone: 'nose', owner: 'fairing', ablative: false })).toBe('整流罩');
    expect(thermalZoneLabel({ zone: 'nose', owner: 'payload', ablative: false })).toBe('头部');
    expect(thermalZoneLabel({ zone: 'side', owner: 'stage-1', ablative: false })).toBe('侧壁');
    expect(thermalZoneLabel({ zone: 'base', owner: 'stage-1', ablative: false })).toBe('底部');
    expect(thermalZoneLabel({ zone: 'base', owner: 'payload', ablative: true })).toBe('防热大底');
  });
});

describe('失效风险等级', () => {
  it('随热裕度下降：正常 → 注意 → 危险；已失效单列', () => {
    expect(thermalRisk(1, false)).toBe('nominal');
    expect(thermalRisk(0.41, false)).toBe('nominal');
    expect(thermalRisk(0.39, false)).toBe('caution');
    expect(thermalRisk(0.14, false)).toBe('warning');
    expect(thermalRisk(0.9, true)).toBe('failed');
    expect(RISK_LABEL.nominal.text).toBe('正常');
    expect(RISK_LABEL.failed.text).toBe('已失效');
    expect(PARACHUTE_LABEL.drogue).toBe('减速伞');
  });
});

describe('飞行结果说明', () => {
  it('安全着陆没有原因说明', () => {
    expect(describeOutcome({ ...base, kind: 'landed', cause: null, impactSpeed: 8, verticalSpeed: -8 }, context)).toEqual([]);
    expect(failureTitle(null)).toBe('');
  });

  it('撞击：指出超出的接地容限，以及降落伞的状态', () => {
    const noChute = describeOutcome(base, context);
    expect(noChute[0]).toBe('接地时垂直速度 119.0 m/s，超过可承受的 10 m/s。');
    expect(noChute).toContain('降落伞没有打开：降到亚声速后按 G 开伞。');
    expect(describeOutcome(base, { ...context, parachute: 'lost' }).join('')).toContain('降落伞在开伞时损毁');
    expect(describeOutcome(base, { ...context, parachute: 'drogue' }).join('')).toContain('开伞高度太低');
    expect(describeOutcome(base, { ...context, parachute: 'none' }).join('')).toContain('这个构型没有降落伞');
    // 水平速度与倾斜
    const sideways = describeOutcome({ ...base, impactSpeed: 30, verticalSpeed: -5, tilt: 1.2 }, { ...context, parachute: 'main' });
    expect(sideways).toHaveLength(2);
    expect(sideways[0]).toContain('水平速度 29.6 m/s');
    expect(sideways[1]).toContain('倾斜');
    expect(failureTitle('impact')).toBe('撞击地面');
  });

  it('热失效：说明高度、速度、部位与材料，并给出避免的办法', () => {
    const airborne = { ...base, altitude: 83_800, impactSpeed: 7_360 };
    const surface = describeOutcome(
      { ...airborne, cause: 'thermal-surface', thermalZone: 'nose' },
      { ...context, zoneLabel: '头部', zoneMaterial: '隔热瓦' },
    );
    expect(surface[0]).toBe('在 83.8 km 高度、7,360 m/s 时，头部（隔热瓦）的表面温度超过了材料的最高工作温度。');
    expect(surface[1]).toContain('逆行保持');
    const burn = describeOutcome({ ...airborne, cause: 'burn-through', thermalZone: 'base' }, { ...context, zoneLabel: '防热大底', zoneMaterial: '烧蚀防热层' });
    expect(burn[0]).toContain('防热大底的烧蚀层被耗尽');
    const soak = describeOutcome({ ...airborne, cause: 'thermal-structure', thermalZone: 'base' }, { ...context, zoneLabel: '防热大底', zoneMaterial: '烧蚀防热层' });
    expect(soak.join('')).toContain('再入角太浅');
    expect(failureTitle('burn-through')).toBe('防热层烧穿');
  });

  it('结构失效：给出被超过的限值', () => {
    const airborne = { ...base, altitude: 39_100, impactSpeed: 5_626 };
    expect(describeOutcome({ ...airborne, cause: 'overload' }, context)[0]).toBe('在 39.1 km 高度、5,626 m/s 时，过载超过了结构限值 14 g。');
    expect(describeOutcome({ ...airborne, cause: 'overload' }, context)[1]).toContain('再入角过陡');
    expect(describeOutcome({ ...airborne, cause: 'dynamic-pressure' }, context)[0]).toContain('动压超过了结构限值 150 kPa');
    expect(describeOutcome({ ...airborne, cause: 'bending' }, context)[0]).toContain('横向气动载荷把箭体折断');
    expect(failureTitle('overload')).toBe('过载解体');
  });
});
