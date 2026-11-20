/** English display text for existing content; the physics catalog remains unchanged. */
import type { Language } from './locale';

const ENGLISH: Readonly<Record<string, string>> = {
  '流星-S': 'Meteor-S',
  '边疆一号': 'Frontier-1',
  '天顶三号': 'Zenith-3',
  '亚轨道': 'Suborbital',
  '近地轨道 · 载人': 'LEO · Crew',
  '地球同步转移轨道 · 货运': 'GTO · Cargo',
  '单级液体探空火箭，搭载小型返回舱。用于突破卡门线与亚轨道飞行训练。': 'A single-stage liquid-fueled sounding rocket carrying a small return capsule. Built for Kármán line and suborbital flight training.',
  '两级煤油/液氧中型运载火箭，搭载"白鹭号"载人飞船。近地轨道任务的主力构型。': 'A two-stage kerosene/LOX medium-lift rocket carrying the Egret crew spacecraft. The workhorse for low Earth orbit missions.',
  '三级运载火箭：煤油/液氧一、二级加氢氧上面级，整流罩内搭载通信卫星。面向 GTO / GEO 任务。': 'A three-stage launcher with kerosene/LOX first and second stages and a hydrogen/LOX upper stage. Carries a communications satellite under its fairing for GTO / GEO missions.',
  '芯级': 'Core stage',
  '一级': 'Stage 1',
  '二级': 'Stage 2',
  '三级（氢氧上面级）': 'Stage 3 (hydrolox)',
  '白鹭-S 返回舱': 'Egret-S capsule',
  '白鹭号飞船': 'Egret spacecraft',
  'Relay-7 通信卫星': 'Relay-7 communications satellite',
  '卡纳维拉尔角': 'Cape Canaveral',
  '文昌': 'Wenchang',
  '库鲁': 'Kourou',
  '酒泉': 'Jiuquan',
  '拜科努尔': 'Baikonur',
  '范登堡': 'Vandenberg',
  '北美 · 佛罗里达': 'North America · Florida',
  '亚洲 · 海南': 'Asia · Hainan',
  '南美 · 法属圭亚那': 'South America · French Guiana',
  '亚洲 · 戈壁': 'Asia · Gobi Desert',
  '中亚 · 哈萨克草原': 'Central Asia · Kazakh Steppe',
  '北美 · 加利福尼亚': 'North America · California',
  '向东发射飞越大西洋，直接入轨倾角约 28.5°。': 'Launch east over the Atlantic for a direct orbital inclination of about 28.5°.',
  '低纬度滨海发射场，适合地球同步转移轨道任务。': 'A low-latitude coastal launch site suited to geostationary transfer orbit missions.',
  '近赤道发射场，能最大限度利用地球自转速度。': 'A near-equatorial site that makes the most of Earth’s rotational speed.',
  '内陆中纬度发射场（真实海拔约 1000 m）。': 'An inland mid-latitude site (actual elevation about 1,000 m).',
  '高纬度内陆发射场，直接入轨倾角不低于约 46°。': 'A high-latitude inland site with a minimum direct orbital inclination of about 46°.',
  '向南发射飞越太平洋，适合极地轨道与太阳同步轨道。': 'Launch south over the Pacific for polar and Sun-synchronous orbits.',
  '铝合金箱壁': 'Aluminum tank skin',
  '发动机舱': 'Engine section',
  '整流罩（软木防热层）': 'Fairing (cork insulation)',
  '隔热瓦': 'Thermal tiles',
  '舱底结构（无防热）': 'Aft structure (unprotected)',
  '烧蚀防热层': 'Ablative heat shield',
  '卫星本体': 'Satellite body',
  '自定义火箭': 'Custom rocket',
  '水星-红石': 'Mercury-Redstone',
  '联盟-2.1a': 'Soyuz-2.1a',
  '宇宙神V 401': 'Atlas V 401',
  '亚轨道 · 载人': 'Suborbital · Crew',
  '美国第一枚载人火箭：单级红石火箭搭载水星飞船。1961 年"自由 7 号"由它送上 187 km 高的亚轨道。': 'America’s first crewed rocket: a single-stage Redstone carrying a Mercury spacecraft. In 1961 it sent Freedom 7 on a suborbital flight to 187 km.',
  '俄罗斯联盟-2.1a：四个捆绑助推器与芯级同时点火，第三级入轨，搭载三人座联盟 MS 飞船。': 'Russia’s Soyuz-2.1a: four strap-on boosters ignite together with the core stage, and the third stage reaches orbit with the three-seat Soyuz MS spacecraft.',
  '美国宇宙神 V 401：RD-180 芯级（可节流到 47%）加氢氧半人马座上面级，4 m 整流罩内搭载通信卫星。': 'The American Atlas V 401: an RD-180 core stage (throttleable to 47%) and a hydrolox Centaur upper stage, with a communications satellite under a 4 m fairing.',
  '红石箭体': 'Redstone booster',
  '助推器（B/V/G/D）': 'Boosters (B/V/G/D)',
  '芯级（A）': 'Core stage (A)',
  '第三级（I）': 'Third stage (I)',
  '服务舱与轨道舱': 'Service and orbital modules',
  '通用芯级': 'Common Core Booster',
  '半人马座上面级': 'Centaur upper stage',
  '水星飞船': 'Mercury spacecraft',
  '联盟 MS 返回舱': 'Soyuz MS descent module',
  '由现有完整模块组成的火箭。理想性能不保证入轨，实际飞行受气动、热与结构限制。': 'A rocket assembled from existing complete modules. Ideal performance does not guarantee orbit; real flight is limited by aerodynamics, heating and structure.',
};

/** Rocket designer module labels ("流星-S·芯级") and custom stage names ("第2级（…）"). */
const composed = (text: string): string | null => {
  const stage = /^第(\d+)级（(.+)）$/.exec(text);
  if (stage) return `Stage ${stage[1]} (${translate(stage[2]!)})`;
  if (text.includes('·')) {
    const parts = text.split('·');
    if (parts.every((part) => ENGLISH[part] !== undefined)) return parts.map((part) => ENGLISH[part]).join(' · ');
  }
  return null;
};

const translate = (text: string): string => ENGLISH[text] ?? composed(text) ?? text;

export const dataText = (text: string, language: Language): string => language === 'en' ? translate(text) : text;
