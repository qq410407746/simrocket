/**
 * 热防护、返回与失效原因的显示文字（纯函数，便于测试）。
 */
import type { FailureCause, FlightOutcome } from '@/game/simulation/types';
import type { LandingLimits, ParachutePhase, StructuralLimits, ThermalZoneTelemetry } from '@/game/vehicles/types';
import { dataText } from '@/i18n/dataText';
import { type Language, createTranslator } from '@/i18n/locale';
import { formatAngle, formatNumber } from '@/utils/format';

/** 热区的名称：只剩返回舱时，底部就是防热大底、头部就是舱顶。 */
export const thermalZoneLabel = (zone: Pick<ThermalZoneTelemetry, 'zone' | 'owner' | 'ablative'>, language: Language = 'zh'): string => {
  const t = createTranslator(language);
  if (zone.zone === 'side') return t('侧壁', 'Sidewall');
  if (zone.zone === 'nose') return zone.owner === 'fairing' ? t('整流罩', 'Fairing') : t('头部', 'Nose');
  if (zone.owner === 'payload-bare') return t('舱底', 'Capsule base');
  return zone.ablative ? t('防热大底', 'Heat shield') : t('底部', 'Base');
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

/** 倾侧角的显示：带符号的角度 + 升力方向的文字说明（0° 升力向上，正值向右，±180° 升力向下）。 */
export const bankLabel = (bank: number, language: Language = 'zh'): string => {
  const t = createTranslator(language);
  const degrees = Math.round((bank * 180) / Math.PI);
  const magnitude = Math.abs(degrees);
  const side = magnitude < 3 || magnitude > 177 ? '' : degrees > 0 ? t('右', 'right') : t('左', 'left');
  const vertical = magnitude < 45 ? t('升力向上', 'lift up') : magnitude > 135 ? t('升力向下', 'lift down') : t('侧向', 'sideways');
  return `${degrees > 0 ? '+' : degrees < 0 ? '−' : ''}${magnitude}° ${vertical}${side ? t(`·偏${side}`, ` · ${side}`) : ''}`;
};

export const PARACHUTE_LABEL: Record<ParachutePhase, string> = {
  none: '无',
  stowed: '待命',
  drogue: '减速伞',
  main: '主伞',
  lost: '已损毁',
};

/** 兼容原有中文常量，按需取得本地化显示。 */
export const riskLabel = (risk: RiskLevel, language: Language = 'zh'): { text: string; tone: string } => ({
  ...RISK_LABEL[risk],
  text: createTranslator(language)(RISK_LABEL[risk].text, { nominal: 'Nominal', caution: 'Caution', warning: 'Danger', failed: 'Failed' }[risk]),
});

export const parachuteLabel = (phase: ParachutePhase, language: Language = 'zh'): string =>
  createTranslator(language)(PARACHUTE_LABEL[phase], { none: 'None', stowed: 'Stowed', drogue: 'Drogue', main: 'Main', lost: 'Destroyed' }[phase]);

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
export const failureTitle = (cause: FailureCause | null, language: Language = 'zh'): string => {
  if (!cause) return '';
  const english: Record<FailureCause, string> = {
    impact: 'Ground impact',
    'thermal-surface': 'Surface overheating',
    'burn-through': 'Heat shield burn-through',
    'thermal-structure': 'Structural overheating',
    overload: 'G-load breakup',
    'dynamic-pressure': 'Dynamic-pressure breakup',
    bending: 'Aerodynamic bending failure',
  };
  return createTranslator(language)(CAUSE_TITLE[cause], english[cause]);
};

interface OutcomeContext {
  /** 结束时的构型可承受的接地条件与结构限值。 */
  readonly landing: LandingLimits;
  readonly structure: StructuralLimits;
  /** 失效热区的名称与材料（热失效时）。 */
  readonly zoneLabel: string | null;
  readonly zoneMaterial: string | null;
  readonly parachute: ParachutePhase;
  /** 损毁时防热大底是否已经被抛掉（没有大底的飞行器为 false）。 */
  readonly heatShieldJettisoned?: boolean;
}

/**
 * 飞行结果的原因说明：每条都是一句完整的话，指出具体超出了哪一项限制、怎样可以避免。
 * 安全着陆时返回空数组。
 */
export const describeOutcome = (outcome: FlightOutcome, context: OutcomeContext, language: Language = 'zh'): string[] => {
  const t = createTranslator(language);
  if (outcome.kind === 'landed') return [];
  const altitude = `${formatNumber(outcome.altitude / 1000, 1)} km`;
  const speed = `${formatNumber(outcome.impactSpeed, 0)} m/s`;
  // Context may contain a saved Chinese label, not only one produced in this render.
  const zones: Record<string, string> = { 侧壁: 'Sidewall', 整流罩: 'Fairing', 头部: 'Nose', 舱底: 'Capsule base', 防热大底: 'Heat shield', 底部: 'Base', 表面: 'Surface' };
  const originalZone = context.zoneLabel ?? '表面';
  const zone = t(originalZone, zones[originalZone] ?? originalZone);
  const material = context.zoneMaterial !== null ? dataText(context.zoneMaterial, language) : t('无防热设计', 'no thermal protection');
  switch (outcome.cause) {
    case 'thermal-surface':
      if (context.heatShieldJettisoned) {
        return [
          t(`在 ${altitude} 高度、${speed} 时，${zone}（${material}）被气动加热烧毁。`, `At ${altitude} and ${speed}, ${zone} (${material}) was destroyed by aerodynamic heating.`),
          t('防热大底已经被抛掉，露出来的舱底结构没有任何防热能力。大底要等再入结束、主伞张开之后再抛。', 'The heat shield had been jettisoned, exposing capsule structure with no thermal protection. Wait until reentry is over and the main parachute is open before jettisoning it.'),
        ];
      }
      return [
        t(`在 ${altitude} 高度、${speed} 时，${zone}（${material}）的表面温度超过了材料的最高工作温度。`, `At ${altitude} and ${speed}, the surface of ${zone} (${material}) exceeded the material's maximum operating temperature.`),
        t('只有返回舱的防热大底能承受再入加热：再入前分离推进级，并让大底朝前（逆行保持）。', 'Only the capsule heat shield can withstand reentry heating: separate the propulsion stage before reentry and point the shield forward with retrograde hold.'),
      ];
    case 'burn-through':
      return [
        t(`在 ${altitude} 高度、${speed} 时，${zone}的烧蚀层被耗尽。`, `At ${altitude} and ${speed}, the ablative layer on ${zone} was exhausted.`),
        t('再入速度越高、受热时间越长，烧蚀层消耗越多：这块防热大底承受不了这样的再入条件。', 'Higher reentry speed and longer heating consume more ablator: this heat shield cannot withstand these reentry conditions.'),
      ];
    case 'thermal-structure':
      return [
        t(`在 ${altitude} 高度，热量浸透了${zone}，内部结构温度超过限值。`, `At ${altitude}, heat soaked through ${zone} and the internal structure exceeded its temperature limit.`),
        t('受热时间过长：再入角太浅，或在高层大气里停留太久。', 'Heating lasted too long: the reentry angle was too shallow, or the vehicle spent too long in the upper atmosphere.'),
      ];
    case 'overload':
      return [
        t(`在 ${altitude} 高度、${speed} 时，过载超过了结构限值 ${formatNumber(context.structure.maxGLoad, 0)} g。`, `At ${altitude} and ${speed}, G-load exceeded the structural limit of ${formatNumber(context.structure.maxGLoad, 0)} g.`),
        t('再入角过陡：减速集中在很短的时间里。离轨点火不要过量，让轨迹更平缓地进入大气层。', 'The reentry angle was too steep, concentrating deceleration into a short time. Use a smaller deorbit burn for a shallower atmospheric entry.'),
      ];
    case 'dynamic-pressure':
      return [
        t(`在 ${altitude} 高度、${speed} 时，动压超过了结构限值 ${formatNumber(context.structure.maxDynamicPressure / 1000, 0)} kPa。`, `At ${altitude} and ${speed}, dynamic pressure exceeded the structural limit of ${formatNumber(context.structure.maxDynamicPressure / 1000, 0)} kPa.`),
        t('在稠密大气里飞得太快：火箭箭体不是为高速返回设计的。', 'The vehicle was too fast in dense air: rocket stages are not designed for high-speed reentry.'),
      ];
    case 'bending':
      return [
        t(`在 ${altitude} 高度、${speed} 时，带迎角飞行的横向气动载荷把箭体折断了。`, `At ${altitude} and ${speed}, aerodynamic bending loads from flying at an angle of attack broke the rocket apart.`),
        t('动压大的时候让头部贴着速度方向（顺行保持）；需要转弯时等飞出稠密大气。', 'At high dynamic pressure, keep the nose aligned with the velocity using prograde hold. Wait until clear of dense air before making turns.'),
      ];
    case 'impact':
    case null: {
      const reasons: string[] = [];
      const horizontal = Math.sqrt(Math.max(0, outcome.impactSpeed ** 2 - outcome.verticalSpeed ** 2));
      const { landing } = context;
      if (Math.abs(outcome.verticalSpeed) > landing.verticalSpeed) {
        reasons.push(t(`接地时垂直速度 ${formatNumber(Math.abs(outcome.verticalSpeed), 1)} m/s，超过可承受的 ${landing.verticalSpeed} m/s。`, `Vertical touchdown speed was ${formatNumber(Math.abs(outcome.verticalSpeed), 1)} m/s, exceeding the ${landing.verticalSpeed} m/s limit.`));
      }
      if (horizontal > landing.horizontalSpeed) {
        reasons.push(t(`接地时水平速度 ${formatNumber(horizontal, 1)} m/s，超过可承受的 ${landing.horizontalSpeed} m/s。`, `Horizontal touchdown speed was ${formatNumber(horizontal, 1)} m/s, exceeding the ${landing.horizontalSpeed} m/s limit.`));
      }
      if (outcome.tilt > landing.tilt) reasons.push(t(`接地时纵轴倾斜 ${formatAngle(outcome.tilt)}°。`, `The vehicle had ${formatAngle(outcome.tilt)}° of tilt at touchdown.`));
      if (context.parachute === 'stowed') reasons.push(t('降落伞没有打开：降到亚声速后按 G 开伞。', 'The parachute was not deployed: press G once subsonic.'));
      else if (context.parachute === 'lost') reasons.push(t('降落伞在开伞时损毁：要等速度降到亚声速、动压足够低再开伞。', 'The parachute was destroyed on deployment: wait until subsonic with sufficiently low dynamic pressure.'));
      else if (context.parachute === 'drogue') reasons.push(t('只有减速伞张开，主伞还没来得及打开：开伞高度太低。', 'Only the drogue opened; the main parachute did not have time to deploy. Deployment altitude was too low.'));
      else if (context.parachute === 'none') reasons.push(t('这个构型没有降落伞：只有与推进级分离后的返回舱可以开伞着陆。', 'This configuration has no parachute: only a capsule separated from its propulsion stages can land under parachute.'));
      return reasons;
    }
  }
};
