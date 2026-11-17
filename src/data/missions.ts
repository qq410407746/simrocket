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
  summary: '用流星-S 探空火箭飞到 100 km 以上——国际公认的太空边界。',
  briefing: [
    '卡门线位于海拔 100 km。在这个高度，大气已经稀薄到机翼无法提供升力，飞行器只能靠速度维持高度——这里被当作太空的起点。',
    '流星-S 是单级探空火箭：竖直向上飞，发动机工作约两分钟后燃尽，之后靠惯性继续爬升到最高点，再落回地面。',
    '箭体没有任何回收手段；顶部的返回舱带有降落伞。燃尽后把返回舱分离出来，落到亚声速再开伞，就能把它完好地收回来（附加目标）。',
  ],
  vehicleId: 'meteor-s',
  siteId: 'jiuquan',
  start: 'pad',
  objectives: [
    { id: 'altitude', title: '最大高度达到 100 km', spec: { kind: 'reach-altitude', altitude: 100 * KM } },
    { id: 'recover', title: '回收返回舱（开伞着陆）', spec: { kind: 'land-capsule' }, optional: true },
  ],
  scoring: [
    { id: 'objectives', label: '突破卡门线', weight: 60, rule: { kind: 'objectives' }, note: '最大高度达到 100 km。' },
    {
      id: 'recover',
      label: '回收返回舱',
      weight: 25,
      rule: { kind: 'optional-objective', objectiveId: 'recover' },
      note: '燃尽后按 空格 分离返回舱，降到亚声速后按 G 开伞。',
    },
    {
      id: 'apex',
      label: '最大高度',
      weight: 15,
      rule: { kind: 'metric', metric: 'max-altitude', full: 250 * KM, zero: 100 * KM },
      note: '飞得越高越好：250 km 以上满分。保持竖直、全程满推力。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞，保持竖直（不要按姿态键），节流阀保持 100%。',
    '发动机工作约两分钟后燃尽。按 空格 分离返回舱。',
    '靠惯性继续上升，越过 100 km。可以用 . 加快时间。',
    '返回舱头朝上落回大气层，防热大底正好朝下。减速过程的过载可达十几个 g。',
    '降到约 10 km、提示"已降到亚声速"时按 G 开伞。',
  ],
  ascent: { kind: 'vertical' },
  requires: [],
};

const SUBORBITAL_HOP: MissionDefinition = {
  id: 'suborbital-hop',
  title: '亚轨道飞行与回收',
  category: 'suborbital',
  summary: '飞一条抛物线弹道：越过 120 km，落到下游几百公里外，返回舱必须安全着陆。',
  briefing: [
    '亚轨道飞行不追求留在太空，而是飞一条又高又远的弹道：爬升途中向东倾斜，火箭一边爬升一边获得水平速度，最后落在发射场的下游。',
    '倾斜的时机很重要。火箭刚起飞时速度很慢，稍微一歪，重力就会把轨迹迅速压平，结果在稠密大气里越飞越快、动压过大而解体。等速度到 300 m/s 再倾斜，同样的角度对轨迹的影响小得多。',
    '倾斜带来一个新问题：下落时速度方向一直在变，返回舱不会自己保持大底朝前。分离后开启逆行保持，让防热大底始终对着来流。',
    '倾斜得越多，弹道越平：飞得更远、再入更缓和，但最大高度更低——倾斜超过约 20° 就到不了 120 km。',
  ],
  vehicleId: 'meteor-s',
  siteId: 'jiuquan',
  start: 'pad',
  objectives: [
    { id: 'altitude', title: '最大高度达到 120 km', spec: { kind: 'reach-altitude', altitude: 120 * KM } },
    { id: 'land', title: '返回舱安全着陆', spec: { kind: 'land-capsule' } },
  ],
  scoring: [
    { id: 'objectives', label: '完成飞行并回收', weight: 50, rule: { kind: 'objectives' }, note: '越过 120 km，返回舱开伞着陆。' },
    {
      id: 'range',
      label: '航程',
      weight: 20,
      rule: { kind: 'metric', metric: 'downrange', full: 500 * KM, zero: 100 * KM },
      note: '落点离发射场越远越好：500 km 以上满分。倾斜 15° 左右飞得最远。',
    },
    {
      id: 'g',
      label: '再入过载',
      weight: 15,
      rule: { kind: 'metric', metric: 'max-g', full: 10, zero: 20 },
      note: '全程最大过载不超过 10 g 满分。弹道平一些，再入就缓和一些。',
    },
    {
      id: 'landing',
      label: '着陆速度',
      weight: 15,
      rule: { kind: 'metric', metric: 'landing-speed', full: 7.5, zero: 10 },
      note: '7.5 m/s 以下满分：主伞张开后按 H 抛掉防热大底，可以落得更慢。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞，先保持竖直。',
    '速度达到 300 m/s（约起飞后 40 秒）时，按住 D 向东倾斜 10–15°（俯仰读数 75–80°），松开后按 R 开启顺行保持。',
    '发动机燃尽后按 空格 分离返回舱，再按 T 开启逆行保持：防热大底朝前。',
    '越过最高点后落回大气层。保持逆行保持，直到减速结束。',
    '提示"已降到亚声速"时按 G 开伞；主伞张开后可以按 H 抛掉防热大底。',
  ],
  ascent: { kind: 'kick', speed: 300, minAngleDeg: 10, maxAngleDeg: 15 },
  requires: ['karman-line'],
};

const FIRST_ORBIT: MissionDefinition = {
  id: 'first-orbit',
  title: '首次入轨',
  category: 'orbital',
  summary: '驾驶边疆一号进入近地轨道：近地点 150 km 以上，远地点不超过 600 km。',
  briefing: [
    '入轨的关键不是高度，而是水平速度：在 200 km 高度需要约 7.8 km/s 的水平速度，才能"一直往下掉却总也掉不到地面"。',
    '所以火箭不能一直竖直飞。起飞后先向东倾斜一个很小的角度，让重力把轨迹慢慢压弯（重力转弯）；飞出稠密大气后，上面级几乎水平地加速到轨道速度。',
    '向东发射可以白得地球自转的 400 多米每秒。轨道近地点升到 150 km 以上、发动机关机后保持 10 秒，任务确认完成。',
    '这是一艘载人飞船：过载也是评分项。一级快烧完时火箭很轻，满推力的过载超过 6 g，适当收小节流可以让乘员好受一些。',
  ],
  vehicleId: 'frontier-1',
  siteId: 'cape-canaveral',
  start: 'pad',
  objectives: [{ id: 'orbit', title: '进入近地轨道（150–600 km）', spec: { kind: 'orbit', ...LOW_EARTH_ORBIT } }],
  scoring: [
    { id: 'objectives', label: '入轨', weight: 50, rule: { kind: 'objectives' }, note: '近地点 ≥ 150 km、远地点 ≤ 600 km，关机后保持 10 秒。' },
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
      weight: 15,
      rule: { kind: 'metric', metric: 'delta-v-margin', full: 3_000, zero: 1_500 },
      note: '入轨时剩余 Δv 3.0 km/s 以上满分。转弯恰到好处、不绕远路，剩得就多。',
    },
    {
      id: 'g',
      label: '乘员过载',
      weight: 15,
      rule: { kind: 'metric', metric: 'max-g', full: 5, zero: 7.5 },
      note: '全程最大过载不超过 5 g 满分。一级燃尽前用 ↓ 收小节流。',
    },
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 60 m/s 后，按住 D 向东倾斜 2–3°（俯仰读数 87–88°），松开。',
    '约 5 秒后按 R 开启顺行保持：火箭沿速度方向飞行，重力自然把轨迹压弯。',
    '一级快烧完时过载升到 6 g 以上：用 ↓ 收小节流可以降低过载。烧完后按 空格 分离并点燃二级。',
    '按 R 回到手动。用俯仰角管理垂直速度：爬得太快就压低头部，开始下降就抬高，让它在 200 km 附近降到 0。',
    '近地点读数升到 150 km 以上时按 X 关机。保持 10 秒，轨道确认。',
  ],
  requires: ['suborbital-hop'],
};

const CREW_RETURN: MissionDefinition = {
  id: 'crew-return',
  title: '载人飞船返回',
  category: 'return',
  summary: '从 200 km 轨道出发：离轨、再入大气层、开伞，把飞船安全带回地面。',
  briefing: [
    '飞船已经在 200 km 的圆轨道上。返回分四步：逆行点火降低近地点（离轨）、分离推进级、让防热大底朝前穿过大气层、开伞着陆。',
    '再入时飞船以 7.8 km/s 撞进大气层，动能几乎全部变成热。只有烧蚀防热大底能承受——舱顶、侧壁朝前都会烧毁，带着推进级再入也会烧毁。',
    '白鹭号的质心偏离对称轴 11 cm：再入时它会配平在约 20° 的迎角上，产生升力。"配平再入"模式下升力向上，过载只有约 3 g；逆行保持则是没有升力的弹道式再入，约 8 g。',
    '乘员过载是主要的评分项。主伞张开后还可以抛掉防热大底，让着陆更轻。',
  ],
  vehicleId: 'frontier-1',
  siteId: 'cape-canaveral',
  start: 'orbit',
  objectives: [{ id: 'land', title: '返回舱安全着陆', spec: { kind: 'land-capsule' } }],
  scoring: [
    { id: 'objectives', label: '安全返回', weight: 50, rule: { kind: 'objectives' }, note: '返回舱开伞着陆。' },
    {
      id: 'g',
      label: '乘员过载',
      weight: 25,
      rule: { kind: 'metric', metric: 'max-g', full: 5, zero: 8 },
      note: '全程最大过载不超过 5 g 满分：按 Y 配平再入，保持升力向上（开伞冲击约 4–5 g）。弹道式再入约 8 g，这一项得不到分。',
    },
    {
      id: 'shield',
      label: '防热大底余量',
      weight: 15,
      rule: { kind: 'metric', metric: 'ablator-remaining', full: 0.85, zero: 0.3 },
      note: '烧蚀层剩余 85% 以上满分。再入越缓和，烧蚀越少。',
    },
    {
      id: 'landing',
      label: '着陆速度',
      weight: 10,
      rule: { kind: 'metric', metric: 'landing-speed', full: 7.6, zero: 10 },
      note: '7.6 m/s 以下满分：主伞张开后按 H 抛掉防热大底。',
    },
  ],
  flightPlan: [
    '按 T 开启逆行保持，等箭体调头（可以用 . 加快时间）。',
    '按 空格 启动二级，按 Z 点火，直到近地点降到 0–50 km，按 X 关机。',
    '按 空格 分离二级。按 Y 改为配平再入（升力向上，约 3 g），或保持逆行（弹道式，约 8 g）。',
    '用 . 加快时间滑行到大气层。再入期间保持姿态，留意右侧的热防护面板。',
    '提示"已降到亚声速"时按 G 开伞；主伞张开后按 H 抛掉防热大底。',
  ],
  requires: ['first-orbit'],
};

const ORBITAL_FLIGHT: MissionDefinition = {
  id: 'orbital-flight',
  title: '载人轨道飞行',
  category: 'return',
  summary: '完整的载人任务：从发射台起飞、进入近地轨道，再离轨返回并安全着陆。',
  briefing: [
    '把前面学到的全部连起来：发射、重力转弯、分级、入轨，在轨道上确认之后，再离轨、再入、开伞着陆。',
    '入轨后二级里还剩不少推进剂，足够用来离轨。离轨点火的位置决定落点：点火后飞船还要飞大约小半圈才进入大气层。',
    '这是一次载人飞行，从起飞到着陆的最大过载都计入评分——上升段记得收节流，返回时用配平再入。',
  ],
  vehicleId: 'frontier-1',
  siteId: 'cape-canaveral',
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
      rule: { kind: 'metric', metric: 'max-g', full: 5, zero: 8 },
      note: '全程最大过载不超过 5 g 满分：上升段收节流，返回时配平再入。',
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
      rule: { kind: 'metric', metric: 'ablator-remaining', full: 0.85, zero: 0.3 },
      note: '烧蚀层剩余 85% 以上满分。',
    },
    {
      id: 'landing',
      label: '着陆速度',
      weight: 10,
      rule: { kind: 'metric', metric: 'landing-speed', full: 7.6, zero: 10 },
      note: '7.6 m/s 以下满分：主伞张开后按 H 抛掉防热大底。',
    },
  ],
  flightPlan: [
    '按"首次入轨"的方法入轨：向东倾斜 2–3° → 顺行保持 → 分级 → 用俯仰角管理垂直速度 → 近地点 150 km 以上关机。',
    '轨道确认后，按 T 逆行保持，调头后按 Z 点火，把近地点降到 0–50 km，按 X 关机。',
    '按 空格 分离二级，按 Y 配平再入。',
    '再入、减速；提示"已降到亚声速"时按 G 开伞，主伞张开后按 H 抛掉防热大底。',
  ],
  requires: ['crew-return'],
};

const ORBIT_QUALITY_ITEMS = (marginFull: number, marginZero: number): MissionDefinition['scoring'] => [
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
    note: `入轨时剩余 Δv ${(marginFull / 1000).toFixed(1)} km/s 以上满分。`,
  },
  {
    id: 'g',
    label: '乘员过载',
    weight: 10,
    rule: { kind: 'metric', metric: 'max-g', full: 5, zero: 7.5 },
    note: '全程最大过载不超过 5 g 满分。一级燃尽前用 ↓ 收小节流。',
  },
];

const INCLINED_ORBIT: MissionDefinition = {
  id: 'inclined-orbit',
  title: '指定倾角轨道',
  category: 'orbital',
  summary: '进入倾角 51.6° 的近地轨道：发射方位角不再是正东。',
  briefing: [
    '轨道倾角是轨道面与赤道面的夹角。从纬度 φ 的发射场以方位角 β 发射，得到的倾角满足 cos i = cos φ · sin β：向正东发射时倾角最小，等于发射场纬度；要更大的倾角，就得偏向北（或南）发射。',
    '从卡纳维拉尔角（28.5°N）进入 51.6° 的轨道，惯性方位角约 45°。扣除地球自转带来的向东速度，箭体相对地面要飞向约 43°——东北方向。',
    '键盘只能按出八个方向：同时按 W 和 D 是正东北（45°）。只靠这一下得到的倾角约 47°，还差几度——上面级飞行时要盯着倾角读数，让航向再往北偏一些。越早修正越省：速度越大，改变轨道面越费推进剂（入轨后每度约 140 m/s）。',
    '箭体不会自己滚转去对准飞行方向，所以斜着飞的时候按键也是"斜"的：W + D 压低头部，S + A 抬高，W + A 让航向偏北，S + D 让航向偏东。',
  ],
  vehicleId: 'frontier-1',
  siteId: 'cape-canaveral',
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
      note: '与 51.6° 相差 0.3° 以内满分。上面级飞行时盯着倾角读数，用 W + A / S + D 修正航向。',
    },
    ...ORBIT_QUALITY_ITEMS(2_900, 1_500),
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 60 m/s 后，同时按住 W 和 D 向东北倾斜约 2°（俯仰读数 88°，航向约 045°），松开。',
    '约 5 秒后按 R 开启顺行保持，等一级烧完；按 空格 分级，再按 R 回到手动。',
    '用 W + D 压低头部、S + A 抬高头部，管理垂直速度（方法与"首次入轨"相同）。',
    '同时留意左侧的倾角读数：小于 51.6° 就点按 W + A 让航向偏北，大于就点按 S + D。差得多就多偏一些，接近了就回正。',
    '近地点升到 150 km 以上、倾角在 51.6° ± 2° 以内时按 X 关机，保持 10 秒。',
  ],
  launch: { inclination: 51.6 * DEG2RAD, direction: 'ascending' },
  requires: ['first-orbit'],
};

const POLAR_ORBIT: MissionDefinition = {
  id: 'polar-orbit',
  title: '极地轨道',
  category: 'orbital',
  summary: '从范登堡向南发射，进入倾角 90° 的极地轨道。',
  briefing: [
    '极地轨道经过南北两极上空。地球在轨道下面自转，卫星每一圈看到的都是不同的经度，几天就能扫过整个地球表面——对地观测卫星因此都用这类轨道。',
    '范登堡在加州海岸，向南是开阔的太平洋。进入 90° 的轨道，惯性速度要指向正南；但火箭起飞时带着发射场随地球自转的 380 m/s 向东速度，必须把它抵消掉，所以箭体要略微偏西——理论航向约 183°。',
    '只按 S 向正南倾斜、之后不做修正，得到的倾角约 84°：那 380 m/s 的向东速度一直留在轨道里。上面级飞行时要让航向再往西偏一些，直到倾角读数接近 90°。',
    '极地轨道完全用不上地球自转，还要倒贴一点去抵消它：同一枚火箭能送上极地轨道的载荷比向东发射少得多。这里表现为入轨时剩余的 Δv 比向东发射少约 400 m/s。',
  ],
  vehicleId: 'frontier-1',
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
    ...ORBIT_QUALITY_ITEMS(2_600, 1_300),
  ],
  flightPlan: [
    '按 空格 点火起飞。速度达到约 60 m/s 后，按住 S 向南倾斜 2–3°（俯仰读数 87–88°，航向约 180°），松开。',
    '约 5 秒后按 R 开启顺行保持，等一级烧完；按 空格 分级，再按 R 回到手动。',
    '向南飞行时 S 压低头部、W 抬高头部，管理垂直速度（方法与"首次入轨"相同）。',
    '同时留意倾角读数：小于 90° 说明还带着向东的速度，点按 A 让航向偏西；大于 90° 就点按 D。',
    '近地点升到 150 km 以上、倾角在 90° ± 3° 以内时按 X 关机，保持 10 秒。',
  ],
  launch: { inclination: 90 * DEG2RAD, direction: 'descending' },
  requires: ['inclined-orbit'],
};

const GEO_DEPLOYMENT: MissionDefinition = {
  id: 'geo-deployment', title: '轨道边疆：同步通信卫星', category: 'advanced',
  summary: '天顶三号：停泊轨道 → GTO → 远地点圆化与倾角修正 → 卫星部署。',
  briefing: ['从库鲁向东发射，将通信卫星送入地球静止轨道。', '使用地图里的机动规划器。节点是瞬时点火预览，真实发动机需要燃烧时间；分配燃烧中心在节点附近，关机后按轨道读数修正。', 'GEO 需要周期接近恒星日、低偏心率、低倾角以及未来一个恒星日星下点经度基本不动。只有周期符合要求的 GSO 还不够。', '当前火箭参数与旧任务评分保持不变。卫星没有发动机，部署前务必完成轨道修正。'],
  vehicleId: 'zenith-3', siteId: 'kourou', start: 'pad',
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
  flightPlan: ['向东发射，约60 m/s时倾斜1°，用顺行保持完成重力转弯；逐级分离并抛罩。', '上面级用俯仰控制垂直速度，近地点达到150 km后关机，等待停泊轨道确认。', '打开地图，生成 GTO 注入节点。指向机动方向，在节点前半个预计燃烧时间点火；余量接近0时核对远地点，偏低则用顺行补推至约35793 km后关机。', '清除旧节点，生成赤道圆化节点。在远地点附近的赤道交点将速度改为赤道圆轨道速度。', '关机后核对同步诊断；按需要用圆化、同步高度与倾角修正节点精修。', 'GEO 目标完成后部署卫星，等待部署后 GEO 确认。'],
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
