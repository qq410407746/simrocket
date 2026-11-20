import { SYNCHRONOUS_RADIUS } from '@/game/physics/orbital/advanced';
import { EARTH } from '@/game/physics/constants';
/**
 * 任务目录。
 *
 * 每个任务规定飞行器、发射场、出发点、目标与评分项。目标的判定见 game/missions/tracker.ts，
 * 评分见 game/missions/scoring.ts。评分线是参照测试驾驶员的实测飞行（missions.test.ts）选取的：
 * 照着提示粗糙地飞一遍能拿到 B–A，要拿 S 需要把轨道、过载或落点控制得更好。
 *
 * 目录的顺序就是建议的游玩顺序；requires 给出解锁关系。
 */
import { DEG2RAD } from '@/game/physics/constants';
import type { MissionDefinition, OrbitRequirement } from '@/game/missions/types';

const KM = 1_000;

/** 近地轨道任务的通用要求：近地点 150 km 以上（阻力足够小，轨道不会很快衰减），远地点不超过 600 km。 */
const LOW_EARTH_ORBIT: OrbitRequirement = { minPeriapsis: 150 * KM, maxApoapsis: 600 * KM };

const KARMAN_LINE: MissionDefinition = {
  id: 'karman-line',
  title: '突破卡门线',
  category: 'suborbital',
  summary: '用水星-红石火箭把水星飞船送过 100 km——国际公认的太空边界。',
  briefing: [
    '卡门线位于海拔 100 km。在这个高度，大气已经稀薄到机翼无法提供升力，飞行器只能靠速度维持高度——这里被当作太空的起点。',
    '水星-红石是单级火箭：A-7 发动机推力固定、不能节流，工作约 143 秒后关机，之后飞船靠惯性继续爬升到最高点，再落回地面。1961 年的"自由 7 号"就是这样飞到了 187 km。',
    '箭体没有任何回收手段；顶部的水星飞船带有降落伞。关机后把飞船分离出来，落到亚声速再开伞，就能把它完好地收回来（附加目标）。',
  ],
  vehicleId: 'mercury-redstone',
  siteId: 'cape-canaveral',
  start: 'pad',
  objectives: [
    { id: 'altitude', title: '最大高度达到 100 km', spec: { kind: 'reach-altitude', altitude: 100 * KM } },
    { id: 'recover', title: '回收水星飞船（开伞着陆）', spec: { kind: 'land-capsule' }, optional: true },
  ],
  scoring: [
    { id: 'objectives', label: '突破卡门线', weight: 60, rule: { kind: 'objectives' }, note: '最大高度达到 100 km。' },
    {
      id: 'recover',
      label: '回收飞船',
      weight: 25,
      rule: { kind: 'optional-objective', objectiveId: 'recover' },
      note: '关机后按 空格 分离飞船，降到亚声速后按 G 开伞。',
    },
    {
      id: 'apex',
      label: '最大高度',
      weight: 15,
      rule: { kind: 'metric', metric: 'max-altitude', full: 250 * KM, zero: 100 * KM },
      note: '飞得越高越好：250 km 以上满分。全程保持竖直。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞，保持竖直（不要按姿态键）。A-7 发动机推力固定，不用管节流阀。',
    '发动机工作约 143 秒后关机。按 空格 分离水星飞船。',
    '靠惯性继续上升，越过 100 km。可以用 . 加快时间。',
    '飞船头朝上落回大气层，防热罩正好朝下。减速过程的过载可达十几个 g。',
    '降到约 10 km、提示"已降到亚声速"时按 G 开伞。',
  ],
  ascent: { kind: 'vertical' },
  requires: [],
};

const SUBORBITAL_HOP: MissionDefinition = {
  id: 'suborbital-hop',
  title: '亚轨道飞行与回收',
  category: 'suborbital',
  summary: '重飞"自由 7 号"：越过 120 km，落到下游约 500 km 外，飞船必须安全溅落。',
  briefing: [
    '1961 年 5 月 5 日，艾伦·谢泼德乘"自由 7 号"飞了一条亚轨道弹道：最高 187 km，落在 487 km 外的大西洋上。亚轨道飞行不追求留在太空，而是爬升途中向东倾斜，一边爬升一边获得水平速度，最后落在发射场的下游。',
    '倾斜的时机很重要。火箭刚起飞时速度很慢，稍微一歪，重力就会把轨迹迅速压平。等速度到 300 m/s 再倾斜，同样的角度对轨迹的影响小得多。但也不能倾斜过头：在稠密大气里迎着来流歪得太多，细长的箭体会被横向气动载荷折断。',
    '下落时速度方向一直在变，飞船不会自己保持防热罩朝前。分离后开启逆行保持，让防热罩始终对着来流。',
    '倾斜得越多，弹道越平：飞得更远、再入更缓和，但最大高度更低。',
  ],
  vehicleId: 'mercury-redstone',
  siteId: 'cape-canaveral',
  start: 'pad',
  objectives: [
    { id: 'altitude', title: '最大高度达到 120 km', spec: { kind: 'reach-altitude', altitude: 120 * KM } },
    { id: 'land', title: '水星飞船安全溅落', spec: { kind: 'land-capsule' } },
  ],
  scoring: [
    { id: 'objectives', label: '完成飞行并回收', weight: 50, rule: { kind: 'objectives' }, note: '越过 120 km，飞船开伞溅落。' },
    {
      id: 'range',
      label: '航程',
      weight: 20,
      rule: { kind: 'metric', metric: 'downrange', full: 450 * KM, zero: 100 * KM },
      note: '落点离发射场越远越好：450 km 以上满分（自由 7 号是 487 km）。倾斜 15° 左右飞得最远。',
    },
    {
      id: 'g',
      label: '再入过载',
      weight: 15,
      rule: { kind: 'metric', metric: 'max-g', full: 12, zero: 20 },
      note: '全程最大过载不超过 12 g 满分（自由 7 号再入约 11 g）。弹道平一些，再入就缓和一些。',
    },
    {
      id: 'landing',
      label: '溅落速度',
      weight: 15,
      rule: { kind: 'metric', metric: 'landing-speed', full: 8.8, zero: 11 },
      note: '8.8 m/s 以下满分。水星飞船主伞下的下降速度约 9 m/s（自由 7 号实测 30 ft/s）；主伞张开后按 H 抛掉防热罩可以再慢一点。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞，先保持竖直。',
    '速度达到 300 m/s（约起飞后 50 秒）时，按住 D 向东倾斜 10–15°（俯仰读数 75–80°），松开后按 R 开启顺行保持。',
    '发动机关机后按 空格 分离飞船，再按 T 开启逆行保持：防热罩朝前。',
    '越过最高点后落回大气层。保持逆行保持，直到减速结束。',
    '提示"已降到亚声速"时按 G 开伞；主伞张开后可以按 H 抛掉防热罩。',
  ],
  ascent: { kind: 'kick', speed: 300, minAngleDeg: 10, maxAngleDeg: 15 },
  requires: ['karman-line'],
};

const FIRST_ORBIT: MissionDefinition = {
  id: 'first-orbit',
  title: '首次入轨',
  category: 'orbital',
  summary: '驾驶联盟-2.1a 从拜科努尔进入近地轨道：近地点 150 km 以上，远地点不超过 600 km。',
  briefing: [
    '入轨的关键不是高度，而是水平速度：在 200 km 高度需要约 7.8 km/s 的水平速度，才能"一直往下掉却总也掉不到地面"。',
    '所以火箭不能一直竖直飞。起飞后先向东倾斜一个很小的角度，让重力把轨迹慢慢压弯（重力转弯）；飞出稠密大气后，上面级几乎水平地加速到轨道速度。',
    '联盟号起飞时四个助推器和芯级同时工作。约两分钟后助推器烧完，抛掉它们，芯级继续工作；芯级烧完后第三级接力入轨。拜科努尔在北纬 45.9°，向东发射得到的轨道倾角就是 45.9°。',
    '联盟号的余量很小：送一艘 7 t 的载人飞船入轨，第三级几乎要烧光。转弯太猛或太缓都会绕远路；万一差一点，飞船服务舱的主发动机还能补上几十米每秒。',
  ],
  vehicleId: 'soyuz-2-1a',
  siteId: 'baikonur',
  start: 'pad',
  objectives: [{ id: 'orbit', title: '进入近地轨道（150–600 km）', spec: { kind: 'orbit', ...LOW_EARTH_ORBIT } }],
  scoring: [
    { id: 'objectives', label: '入轨', weight: 55, rule: { kind: 'objectives' }, note: '近地点 ≥ 150 km、远地点 ≤ 600 km，关机后保持 10 秒。' },
    {
      id: 'circular',
      label: '轨道圆度',
      weight: 20,
      rule: { kind: 'metric', metric: 'orbit-spread', full: 20 * KM, zero: 300 * KM },
      note: '远地点与近地点相差 20 km 以内满分。上面级飞行时把垂直速度控制在 0 附近。',
    },
    {
      id: 'margin',
      label: '推进剂余量',
      weight: 25,
      rule: { kind: 'metric', metric: 'delta-v-margin', full: 330, zero: 100 },
      note: '入轨时剩余 Δv 330 m/s 以上满分（相当于只靠三级入轨、没动用飞船的推进剂）。转弯恰到好处、不绕远路，剩得就多。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 60 m/s 后，按住 D 向东倾斜 2–3°（俯仰读数 87–88°），松开。',
    '约 5 秒后按 R 开启顺行保持：火箭沿速度方向飞行，重力自然把轨迹压弯。',
    '约 2 分钟时四个助推器烧完：按 空格 抛掉它们，芯级继续工作。按 R 回到手动。',
    '用俯仰角管理垂直速度：爬得太快就压低头部，开始下降就抬高，让它在 200 km 附近降到 0。芯级烧完后按 空格 分离并点燃第三级。',
    '近地点读数升到 150 km 以上时按 X 关机。保持 10 秒，轨道确认。第三级烧完还差一点的话，按 空格 抛掉第三级、点燃服务舱主发动机补足。',
  ],
  requires: ['suborbital-hop'],
};

const CREW_RETURN: MissionDefinition = {
  id: 'crew-return',
  title: '载人飞船返回',
  category: 'return',
  summary: '联盟 MS 从 200 km 轨道出发：离轨、再入大气层、开伞，把乘员安全带回地面。',
  briefing: [
    '飞船已经在 200 km 的圆轨道上。返回分四步：用服务舱的主发动机逆行点火降低近地点（离轨）、抛掉服务舱与轨道舱、让返回舱的防热大底朝前穿过大气层、开伞着陆。',
    '再入时返回舱以 7.8 km/s 撞进大气层，动能几乎全部变成热。只有烧蚀防热大底能承受——舱顶、侧壁朝前都会烧毁，带着服务舱再入也会烧毁。',
    '联盟号返回舱的质心偏离对称轴：再入时它会配平在约 17° 的迎角上，升阻比约 0.27（质心偏移量是估算值）。"配平再入"模式下升力向上，过载约 4–5 g；逆行保持则是没有升力的弹道式再入，约 8 g——真实的联盟号在制导故障时也会转入这种弹道式再入。',
    'KTDU-80 主发动机推力只有 2.95 kN：离轨点火要烧一两分钟。乘员过载是主要的评分项。',
  ],
  vehicleId: 'soyuz-2-1a',
  siteId: 'baikonur',
  start: 'orbit',
  objectives: [{ id: 'land', title: '返回舱安全着陆', spec: { kind: 'land-capsule' } }],
  scoring: [
    { id: 'objectives', label: '安全返回', weight: 50, rule: { kind: 'objectives' }, note: '返回舱开伞着陆。' },
    {
      id: 'g',
      label: '乘员过载',
      weight: 25,
      rule: { kind: 'metric', metric: 'max-g', full: 5.5, zero: 8.5 },
      note: '全程最大过载不超过 5.5 g 满分：按 Y 配平再入，保持升力向上。弹道式再入约 8 g，这一项几乎得不到分。',
    },
    {
      id: 'shield',
      label: '防热大底余量',
      weight: 15,
      rule: { kind: 'metric', metric: 'ablator-remaining', full: 0.6, zero: 0.2 },
      note: '烧蚀层剩余 60% 以上满分。再入越缓和，烧蚀越少。',
    },
    {
      id: 'landing',
      label: '着陆速度',
      weight: 10,
      rule: { kind: 'metric', metric: 'landing-speed', full: 7, zero: 10 },
      note: '7 m/s 以下满分：主伞张开后按 H 抛掉防热大底。（真实的联盟号在离地 1 m 时点燃软着陆发动机，游戏里没有建模。）',
    },
  ],
  flightPlan: [
    '按 T 开启逆行保持，等飞船调头（可以用 . 加快时间）。',
    '按 空格 启动服务舱主发动机，按 Z 点火，直到近地点降到 0–50 km，按 X 关机。',
    '按 空格 抛掉服务舱与轨道舱。按 Y 改为配平再入（升力向上，约 4–5 g），或保持逆行（弹道式，约 8 g）。',
    '用 . 加快时间滑行到大气层。再入期间保持姿态，留意右侧的热防护面板。',
    '提示"已降到亚声速"时按 G 开伞；主伞张开后按 H 抛掉防热大底。',
  ],
  requires: ['first-orbit'],
};

const ORBITAL_FLIGHT: MissionDefinition = {
  id: 'orbital-flight',
  title: '载人轨道飞行',
  category: 'return',
  summary: '完整的联盟号载人任务：从拜科努尔起飞、进入近地轨道，再离轨返回并安全着陆。',
  briefing: [
    '把前面学到的全部连起来：发射、重力转弯、抛助推器、分级、入轨，在轨道上确认之后，再离轨、再入、开伞着陆。',
    '离轨靠飞船服务舱里的 800 kg 推进剂。上升段如果动用了它补足入轨速度，留给离轨的就少了——好在离轨只需要几十米每秒。离轨点火的位置决定落点：点火后飞船还要飞大约小半圈才进入大气层。',
    '这是一次载人飞行，从起飞到着陆的最大过载都计入评分。联盟号的发动机不能节流，上升段约 4.4 g；返回时用配平再入把过载压住。',
  ],
  vehicleId: 'soyuz-2-1a',
  siteId: 'baikonur',
  start: 'pad',
  objectives: [
    { id: 'orbit', title: '进入近地轨道（150–600 km）', spec: { kind: 'orbit', ...LOW_EARTH_ORBIT } },
    { id: 'land', title: '返回舱安全着陆', spec: { kind: 'land-capsule' } },
  ],
  scoring: [
    { id: 'objectives', label: '入轨并安全返回', weight: 50, rule: { kind: 'objectives' }, note: '先入轨并确认，再让返回舱开伞着陆。' },
    {
      id: 'g',
      label: '乘员过载',
      weight: 20,
      rule: { kind: 'metric', metric: 'max-g', full: 5.5, zero: 8.5 },
      note: '全程最大过载不超过 5.5 g 满分：返回时配平再入。',
    },
    {
      id: 'circular',
      label: '轨道圆度',
      weight: 10,
      rule: { kind: 'metric', metric: 'orbit-spread', full: 20 * KM, zero: 300 * KM },
      note: '轨道确认时远地点与近地点相差 20 km 以内满分。',
    },
    {
      id: 'shield',
      label: '防热大底余量',
      weight: 10,
      rule: { kind: 'metric', metric: 'ablator-remaining', full: 0.6, zero: 0.2 },
      note: '烧蚀层剩余 60% 以上满分。',
    },
    {
      id: 'landing',
      label: '着陆速度',
      weight: 10,
      rule: { kind: 'metric', metric: 'landing-speed', full: 7, zero: 10 },
      note: '7 m/s 以下满分：主伞张开后按 H 抛掉防热大底。',
    },
  ],
  flightPlan: [
    '按"首次入轨"的方法入轨：向东倾斜 2–3° → 顺行保持 → 抛助推器 → 用俯仰角管理垂直速度 → 分级 → 近地点 150 km 以上关机。',
    '轨道确认后，按 空格 抛掉第三级（如果还在），按 T 逆行保持，调头后按 Z 点燃服务舱主发动机，把近地点降到 0–50 km，按 X 关机。',
    '按 空格 抛掉服务舱与轨道舱，按 Y 配平再入。',
    '再入、减速；提示"已降到亚声速"时按 G 开伞，主伞张开后按 H 抛掉防热大底。',
  ],
  requires: ['crew-return'],
};

const ORBIT_QUALITY_ITEMS = (
  marginFull: number,
  marginZero: number,
  g: { readonly label: string; readonly full: number; readonly zero: number; readonly note: string },
): MissionDefinition['scoring'] => [
  {
    id: 'circular',
    label: '轨道圆度',
    weight: 10,
    rule: { kind: 'metric', metric: 'orbit-spread', full: 20 * KM, zero: 300 * KM },
    note: '远地点与近地点相差 20 km 以内满分。',
  },
  {
    id: 'margin',
    label: '推进剂余量',
    weight: 15,
    rule: { kind: 'metric', metric: 'delta-v-margin', full: marginFull, zero: marginZero },
    note: `入轨时剩余 Δv ${marginFull >= 1000 ? `${(marginFull / 1000).toFixed(1)} km/s` : `${marginFull} m/s`} 以上满分。`,
  },
  { id: 'g', label: g.label, weight: 10, rule: { kind: 'metric', metric: 'max-g', full: g.full, zero: g.zero }, note: g.note },
];

const INCLINED_ORBIT: MissionDefinition = {
  id: 'inclined-orbit',
  title: '指定倾角轨道',
  category: 'orbital',
  summary: '进入国际空间站所在的 51.6° 倾角轨道：发射方位角不再是正东。',
  briefing: [
    '轨道倾角是轨道面与赤道面的夹角。从纬度 φ 的发射场以方位角 β 发射，得到的倾角满足 cos i = cos φ · sin β：向正东发射时倾角最小，等于发射场纬度；要更大的倾角，就得偏向北（或南）发射。',
    '国际空间站的轨道倾角是 51.6°，联盟号从拜科努尔（45.9°N）飞往空间站。惯性方位角约 60°；扣除地球自转带来的向东速度，箭体相对地面要飞向约 062°——东偏北。',
    '键盘只能按出八个方向：D 是正东（090°），W + D 是东北（045°），都差得很远。按住 D 向东倾斜的同时间断地点按 W（大约一半的时间），让导航球的航向读数停在 060–065°。上面级飞行时再盯着倾角读数微调。',
    '越早对准越省：速度越大，改变轨道面越费推进剂（入轨后每度约 140 m/s）。而联盟号的余量只有一两百米每秒——起飞时方向没对准，后面很难补回来。',
  ],
  vehicleId: 'soyuz-2-1a',
  siteId: 'baikonur',
  start: 'pad',
  objectives: [
    {
      id: 'orbit',
      title: '进入倾角 51.6° ± 2° 的近地轨道',
      spec: { kind: 'orbit', ...LOW_EARTH_ORBIT, inclination: { target: 51.6 * DEG2RAD, tolerance: 2 * DEG2RAD } },
    },
  ],
  scoring: [
    { id: 'objectives', label: '进入目标轨道', weight: 40, rule: { kind: 'objectives' }, note: '近地点 ≥ 150 km、远地点 ≤ 600 km、倾角 51.6° ± 2°。' },
    {
      id: 'inclination',
      label: '倾角精度',
      weight: 25,
      rule: { kind: 'metric', metric: 'inclination-error', full: 0.3 * DEG2RAD, zero: 2 * DEG2RAD },
      note: '与 51.6° 相差 0.3° 以内满分。上面级飞行时盯着倾角读数，用 W / S 修正航向。',
    },
    ...ORBIT_QUALITY_ITEMS(250, 0, {
      label: '乘员过载',
      full: 4.5,
      zero: 6,
      note: '全程最大过载不超过 4.5 g 满分。联盟号的发动机不能节流，正常飞行约 4.4 g。',
    }),
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 60 m/s 后按住 D 向东倾斜，同时间断地点按 W，倾斜到 2–3°（俯仰读数 87–88°）时航向读数应在 060–065°，松开。',
    '约 5 秒后按 R 开启顺行保持。助推器烧完后按 空格 抛掉，再按 R 回到手动。',
    '用 D 压低头部、A 抬高头部，管理垂直速度（方法与"首次入轨"相同）；芯级烧完后按 空格 分级。',
    '同时留意左侧的倾角读数：小于 51.6° 就点按 W 让航向偏北，大于就点按 S。差得多就多偏一些，接近了就回正。',
    '近地点升到 150 km 以上、倾角在 51.6° ± 2° 以内时按 X 关机，保持 10 秒。',
  ],
  launch: { inclination: 51.6 * DEG2RAD, direction: 'ascending' },
  requires: ['first-orbit'],
};

const POLAR_ORBIT: MissionDefinition = {
  id: 'polar-orbit',
  title: '极地轨道',
  category: 'orbital',
  summary: '宇宙神V 401 从范登堡向南发射，把一颗卫星送进倾角 90° 的极地轨道。',
  briefing: [
    '极地轨道经过南北两极上空。地球在轨道下面自转，卫星每一圈看到的都是不同的经度，几天就能扫过整个地球表面——对地观测卫星因此都用这类轨道。宇宙神 V 401 就从范登堡把"陆地卫星"（Landsat）这样的卫星送上过极地附近的太阳同步轨道。',
    '范登堡在加州海岸，向南是开阔的太平洋。进入 90° 的轨道，惯性速度要指向正南；但火箭起飞时带着发射场随地球自转的 380 m/s 向东速度，必须把它抵消掉，所以箭体要略微偏西——理论航向约 183°。只按 S 向正南倾斜、之后不做修正，那 380 m/s 的向东速度会一直留在轨道里。',
    '宇宙神 V 401 起飞推重比只有约 1.2：倾斜要晚、要轻（约 100 m/s 时 1.5°），否则重力会把轨迹压得太平，在稠密大气里动压过大而解体。它的 RD-180 发动机可以节流到 47%：芯级快烧完时火箭很轻，满推力的过载超过 9 g，收小节流可以保护卫星。',
    '极地轨道完全用不上地球自转，还要倒贴一点去抵消它：同一枚火箭能送上极地轨道的载荷比向东发射少。',
  ],
  vehicleId: 'atlas-v-401',
  siteId: 'vandenberg',
  start: 'pad',
  objectives: [
    {
      id: 'orbit',
      title: '进入倾角 90° ± 3° 的近地轨道',
      spec: { kind: 'orbit', ...LOW_EARTH_ORBIT, inclination: { target: 90 * DEG2RAD, tolerance: 3 * DEG2RAD } },
    },
  ],
  scoring: [
    { id: 'objectives', label: '进入极地轨道', weight: 40, rule: { kind: 'objectives' }, note: '近地点 ≥ 150 km、远地点 ≤ 600 km、倾角 90° ± 3°。' },
    {
      id: 'inclination',
      label: '倾角精度',
      weight: 25,
      rule: { kind: 'metric', metric: 'inclination-error', full: 0.3 * DEG2RAD, zero: 3 * DEG2RAD },
      note: '与 90° 相差 0.3° 以内满分。上面级飞行时盯着倾角读数，用 A / D 修正航向。',
    },
    ...ORBIT_QUALITY_ITEMS(3_800, 2_800, {
      label: '最大过载',
      full: 5,
      zero: 9,
      note: '全程最大过载不超过 5 g 满分。芯级末段用 ↓ 收小节流（RD-180 最低 47%）。',
    }),
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 100 m/s 后，按住 S 向南倾斜约 1.5°（俯仰读数 88.5°，航向约 180°），松开。倾斜太少弹道会飞得太高，远地点超过 600 km。',
    '约 5 秒后按 R 开启顺行保持。芯级快烧完时过载升到 5 g 以上：用 ↓ 收小节流。烧完后按 空格 分级，再按 R 回到手动。',
    '向南飞行时 S 压低头部、W 抬高头部，管理垂直速度（方法与"首次入轨"相同）。出了大气层按 F 抛整流罩。',
    '同时留意倾角读数：小于 90° 说明还带着向东的速度，点按 A 让航向偏西；大于 90° 就点按 D。',
    '近地点升到 150 km 以上、倾角在 90° ± 3° 以内时按 X 关机，保持 10 秒。',
  ],
  ascent: { kind: 'kick', speed: 100, minAngleDeg: 1.5, maxAngleDeg: 2 },
  launch: { inclination: 90 * DEG2RAD, direction: 'descending' },
  requires: ['inclined-orbit'],
};

const GEO_DEPLOYMENT: MissionDefinition = {
  id: 'geo-deployment', title: '轨道边疆：同步通信卫星', category: 'advanced',
  summary: '宇宙神V 401：停泊轨道 → GTO → 远地点圆化与倾角修正 → 卫星部署。',
  briefing: [
    '从卡纳维拉尔角向东发射，用半人马座上面级把通信卫星直接送入地球静止轨道。',
    '使用地图里的机动规划器。节点是瞬时点火预览，真实发动机需要燃烧时间；分配燃烧中心在节点附近，关机后按轨道读数修正。',
    'GEO 需要周期接近恒星日、低偏心率、低倾角以及未来一个恒星日星下点经度基本不动。只有周期符合要求的 GSO 还不够。卡纳维拉尔角在北纬 28.5°，停泊轨道的倾角约 28.5°，要在远地点把它一并消掉，这一步比圆化本身还费推进剂。',
    '卫星没有发动机，部署前务必完成轨道修正。这颗 1.8 t 的卫星是虚构的，质量按宇宙神 V 401 加半人马座能直接送入 GEO 的能力设定（真实的同步卫星一般自带远地点发动机，火箭只负责送到 GTO）。',
  ],
  vehicleId: 'atlas-v-401', siteId: 'cape-canaveral', start: 'pad',
  objectives: [
    { id:'parking', title:'建立停泊轨道', spec:{kind:'orbit',minPeriapsis:150000,maxApoapsis:600000} },
    { id:'gto', title:'完成同步转移轨道注入', spec:{kind:'orbit',minPeriapsis:100000,maxPeriapsis:1000000,minApoapsis:SYNCHRONOUS_RADIUS-EARTH.RADIUS-1000000,maxApoapsis:SYNCHRONOUS_RADIUS-EARTH.RADIUS+1000000} },
    { id:'geo', title:'圆化并修正为地球静止轨道', spec:{kind:'synchronous',stationary:true} },
    { id:'deploy', title:'部署通信卫星', spec:{kind:'deploy-satellite'} },
    { id:'confirm', title:'确认部署后的 GEO', spec:{kind:'synchronous',stationary:true,deployed:true} },
  ],
  scoring: [
    {id:'objectives',label:'完整轨道任务',weight:70,rule:{kind:'objectives'},note:'完成全部五个步骤。'},
    {id:'period',label:'周期精度',weight:15,rule:{kind:'metric',metric:'period-error',full:10,zero:120},note:'与恒星日相差10秒以内满分。'},
    {id:'longitude',label:'星下点稳定性',weight:15,rule:{kind:'metric',metric:'longitude-span',full:0.1*DEG2RAD,zero:1*DEG2RAD},note:'未来一个恒星日经度摆幅0.1°以内满分。'},
  ],
  flightPlan: ['向东发射，约 100 m/s 时倾斜 1°，用顺行保持完成重力转弯；芯级末段收节流把过载压在 5 g 以下，分级并抛罩。', '上面级用俯仰控制垂直速度，近地点达到150 km后关机，等待停泊轨道确认。', '打开地图，生成 GTO 注入节点。指向机动方向，在节点前半个预计燃烧时间点火；余量接近0时核对远地点，偏低则用顺行补推至约35793 km后关机。', '清除旧节点，生成赤道圆化节点。在远地点附近的赤道交点将速度改为赤道圆轨道速度，同时消掉约 28.5° 的倾角。', '关机后核对同步诊断；按需要用圆化、同步高度与倾角修正节点精修。', 'GEO 目标完成后部署卫星，等待部署后 GEO 确认。'],
  ascent: { kind: 'kick', speed: 100, minAngleDeg: 1, maxAngleDeg: 1.5 },
  requires: ['first-orbit'],
};

export const MISSION_CATALOG: readonly MissionDefinition[] = [
  KARMAN_LINE,
  SUBORBITAL_HOP,
  FIRST_ORBIT,
  CREW_RETURN,
  ORBITAL_FLIGHT,
  INCLINED_ORBIT,
  POLAR_ORBIT,
  GEO_DEPLOYMENT,
];

export const findMission = (id: string | null | undefined): MissionDefinition | undefined =>
  id ? MISSION_CATALOG.find((mission) => mission.id === id) : undefined;
