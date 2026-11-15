/**
 * 热防护与失效原因的显示文字（纯函数，便于测试）。
 */
import type { FailureCause, FlightOutcome } from '@/game/simulation/types';
import type { LandingLimits, ParachutePhase, StructuralLimits, ThermalZoneTelemetry } from '@/game/vehicles/types';
import { formatAngle, formatNumber } from '@/utils/format';

/** 热区的名称：只剩返回舱时，底部就是防热大底、头部就是舱顶。 */
export const thermalZoneLabel = (zone: Pick<ThermalZoneTelemetry, 'zone' | 'owner' | 'ablative'>): string => {
  if (zone.zone === 'side') return '侧壁';
  if (zone.zone === 'nose') return zone.owner === 'fairing' ? '整流罩' : '头部';
  return zone.ablative ? '防热大底' : '底部';
};

export type RiskLevel = 'nominal' | 'caution' | 'warning' | 'failed';

/** 由热裕度给出的失效风险等级。 */
export const thermalRisk = (margin: number, failed: boolean): RiskLevel =>
  failed ? 'failed' : margin < 0.15 ? 'warning' : margin < 0.4 ? 'caution' : 'nominal';

export const RISK_LABEL: Record<RiskLevel, { text: string; tone: string }> = {
  nominal: { text: '正常', tone: 'text-ok' },
  caution: { text: '注意', tone: 'text-warn' },
  warning: { text: '危险', tone: 'text-danger' },
  failed: { text: '已失效', tone: 'text-danger' },
};

export const PARACHUTE_LABEL: Record<ParachutePhase, string> = {
  none: '无',
  stowed: '待命',
  drogue: '减速伞',
  main: '主伞',
  lost: '已损毁',
};

const CAUSE_TITLE: Record<FailureCause, string> = {
  impact: '撞击地面',
  'thermal-surface': '表面过热',
  'burn-through': '防热层烧穿',
  'thermal-structure': '结构过热',
  overload: '过载解体',
  'dynamic-pressure': '动压过大解体',
  bending: '气动载荷折断',
};

/** 损毁原因的简短标题。 */
export const failureTitle = (cause: FailureCause | null): string => (cause ? CAUSE_TITLE[cause] : '');

interface OutcomeContext {
  /** 结束时的构型可承受的接地条件与结构限值。 */
  readonly landing: LandingLimits;
  readonly structure: StructuralLimits;
  /** 失效热区的名称与材料（热失效时）。 */
  readonly zoneLabel: string | null;
  readonly zoneMaterial: string | null;
  readonly parachute: ParachutePhase;
}

/**
 * 飞行结果的原因说明：每条都是一句完整的话，指出具体超出了哪一项限制、怎样可以避免。
 * 安全着陆时返回空数组。
 */
export const describeOutcome = (outcome: FlightOutcome, context: OutcomeContext): string[] => {
  if (outcome.kind === 'landed') return [];
  const altitude = `${formatNumber(outcome.altitude / 1000, 1)} km`;
  const speed = `${formatNumber(outcome.impactSpeed, 0)} m/s`;
  const zone = context.zoneLabel ?? '表面';
  switch (outcome.cause) {
    case 'thermal-surface':
      return [
        `在 ${altitude} 高度、${speed} 时，${zone}（${context.zoneMaterial ?? '无防热设计'}）的表面温度超过了材料的最高工作温度。`,
        '只有返回舱的防热大底能承受再入加热：再入前分离推进级，并让大底朝前（逆行保持）。',
      ];
    case 'burn-through':
      return [
        `在 ${altitude} 高度、${speed} 时，${zone}的烧蚀层被耗尽。`,
        '再入速度越高、受热时间越长，烧蚀层消耗越多：这块防热大底承受不了这样的再入条件。',
      ];
    case 'thermal-structure':
      return [`在 ${altitude} 高度，热量浸透了${zone}，内部结构温度超过限值。`, '受热时间过长：再入角太浅，或在高层大气里停留太久。'];
    case 'overload':
      return [
        `在 ${altitude} 高度、${speed} 时，过载超过了结构限值 ${formatNumber(context.structure.maxGLoad, 0)} g。`,
        '再入角过陡：减速集中在很短的时间里。离轨点火不要过量，让轨迹更平缓地进入大气层。',
      ];
    case 'dynamic-pressure':
      return [
        `在 ${altitude} 高度、${speed} 时，动压超过了结构限值 ${formatNumber(context.structure.maxDynamicPressure / 1000, 0)} kPa。`,
        '在稠密大气里飞得太快：火箭箭体不是为高速返回设计的。',
      ];
    case 'bending':
      return [
        `在 ${altitude} 高度、${speed} 时，带迎角飞行的横向气动载荷把箭体折断了。`,
        '动压大的时候让头部贴着速度方向（顺行保持）；需要转弯时等飞出稠密大气。',
      ];
    case 'impact':
    case null: {
      const reasons: string[] = [];
      const horizontal = Math.sqrt(Math.max(0, outcome.impactSpeed ** 2 - outcome.verticalSpeed ** 2));
      const { landing } = context;
      if (Math.abs(outcome.verticalSpeed) > landing.verticalSpeed) {
        reasons.push(`接地时垂直速度 ${formatNumber(Math.abs(outcome.verticalSpeed), 1)} m/s，超过可承受的 ${landing.verticalSpeed} m/s。`);
      }
      if (horizontal > landing.horizontalSpeed) {
        reasons.push(`接地时水平速度 ${formatNumber(horizontal, 1)} m/s，超过可承受的 ${landing.horizontalSpeed} m/s。`);
      }
      if (outcome.tilt > landing.tilt) reasons.push(`接地时纵轴倾斜 ${formatAngle(outcome.tilt)}°。`);
      if (context.parachute === 'stowed') reasons.push('降落伞没有打开：降到亚声速后按 G 开伞。');
      else if (context.parachute === 'lost') reasons.push('降落伞在开伞时损毁：要等速度降到亚声速、动压足够低再开伞。');
      else if (context.parachute === 'drogue') reasons.push('只有减速伞张开，主伞还没来得及打开：开伞高度太低。');
      else if (context.parachute === 'none') reasons.push('这个构型没有降落伞：只有与推进级分离后的返回舱可以开伞着陆。');
      return reasons;
    }
  }
};
