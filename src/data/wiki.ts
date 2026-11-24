/**
 * 游戏内知识库（Wiki）：火箭方程、轨道要素、基础物理、宇宙速度，以及地球、月球、火星。
 *
 * - 每段文字都是 [中文, English] 两份。
 * - 文中凡是能由游戏代码算出来的数（宇宙速度、轨道速度、周期、霍曼转移、火箭的理想 Δv……）都在这里现算，
 *   使用与模拟器相同的常量和函数，不另抄一份数字；月球、火星的参数来自 `celestialBodies.ts`（附资料出处）。
 * - "游戏中"提示框说明游戏实际用了哪个模型、哪些没有建模。
 */
import { ATMOSPHERE_COMPOSITION, CELESTIAL_BODIES, EARTH_BODY, GRAVITATIONAL_CONSTANT, MARS_BODY, MARS_ORBIT, MOON_BODY, MOON_ORBIT, PARKING_ORBIT_ALTITUDE, type CelestialBody, circularOrbitAt, cosmicVelocities, derivedSurface, earthMarsTransfer, earthMoonTransfer } from '@/data/celestialBodies';
import { LAUNCH_SITES } from '@/data/launchSites';
import { ASTRO, DEG2RAD, EARTH, KARMAN_LINE_ALTITUDE, SEA_LEVEL, STANDARD_GRAVITY } from '@/game/physics/constants';
import { SYNCHRONOUS_RADIUS, combinedPlaneChange, hohmannTransfer } from '@/game/physics/orbital/advanced';
import { circularSpeed } from '@/game/physics/orbital/elements';
import { reachableInclination } from '@/game/physics/orbital/launch';
import { MIN_FLYBY_RADIUS } from '@/game/interplanetary/flyby';
import { type PlanetId, SUN_MU, findPlanet } from '@/game/interplanetary/planets';
import { formatNumber } from '@/utils/format';

/** 一段双语文字：[中文, English]。 */
export type Bilingual = readonly [zh: string, en: string];

export type WikiWidget = 'rocket-equation' | 'vehicle-deltav' | 'orbit-calculator' | 'voyager-tour';

export type WikiBlock =
  | { readonly kind: 'p'; readonly text: Bilingual }
  /** 公式本身两种语言共用（只含符号与数字），where 解释符号。 */
  | { readonly kind: 'formula'; readonly expr: string; readonly where?: Bilingual }
  | { readonly kind: 'list'; readonly items: readonly Bilingual[] }
  | { readonly kind: 'table'; readonly head: readonly Bilingual[]; readonly rows: readonly (readonly (string | Bilingual)[])[] }
  /** "游戏中"：游戏实际怎么算、哪些没有建模。 */
  | { readonly kind: 'game'; readonly text: Bilingual }
  | { readonly kind: 'widget'; readonly widget: WikiWidget };

export interface WikiSection {
  readonly heading: Bilingual;
  readonly blocks: readonly WikiBlock[];
}

export type WikiArticleId =
  | 'physics-basics'
  | 'rocket-equation'
  | 'orbital-elements'
  | 'cosmic-velocities'
  | 'earth'
  | 'moon'
  | 'mars'
  | 'gravity-assist'
  | 'voyager-grand-tour'
  | 'multi-revolution-lambert'
  | 'deep-space-maneuvers';

export type WikiCategory = 'theory' | 'bodies' | 'showcase';

export interface WikiArticle {
  readonly id: WikiArticleId;
  readonly category: WikiCategory;
  readonly title: Bilingual;
  readonly summary: Bilingual;
  readonly sections: readonly WikiSection[];
  readonly related: readonly WikiArticleId[];
  readonly sources: readonly string[];
}

const n = (x: number, digits = 0): string => formatNumber(x, digits);
const km = (metres: number, digits = 0): string => n(metres / 1000, digits);
const kms = (mps: number, digits = 2): string => n(mps / 1000, digits);
const days = (seconds: number, digits = 1): string => n(seconds / 86_400, digits);
const minutes = (seconds: number, digits = 1): string => n(seconds / 60, digits);

// ---------------------------------------------------------------------------
// 现算的数
// ---------------------------------------------------------------------------

const cosmic = cosmicVelocities();
const leo = circularOrbitAt(EARTH_BODY, PARKING_ORBIT_ALTITUDE);
const earthSurface = derivedSurface(EARTH_BODY);
const moonSurface = derivedSurface(MOON_BODY);
const marsSurface = derivedSurface(MARS_BODY);
const moonTransfer = earthMoonTransfer();
const marsTransfer = earthMarsTransfer();

/** 200 km 停泊轨道到地球静止轨道的霍曼转移，以及卡纳维拉尔角（28.5°）出发时在远地点合并消倾角。 */
const geoTransfer = hohmannTransfer(leo.radius, SYNCHRONOUS_RADIUS);
const capeLatitude = LAUNCH_SITES.find((s) => s.id === 'cape-canaveral')?.latitudeDeg ?? 28.5;
const gtoApogeeSpeed = Math.sqrt(EARTH.MU * (2 / SYNCHRONOUS_RADIUS - 2 / (leo.radius + SYNCHRONOUS_RADIUS)));
const geoSpeed = circularSpeed(SYNCHRONOUS_RADIUS);
const capeGeoArrival = combinedPlaneChange(gtoApogeeSpeed, geoSpeed, capeLatitude * DEG2RAD);

/** 火箭方程的例子：真空比冲 340 s 的单级火箭要提供 9.4 km/s。 */
const EXAMPLE_ISP = 340;
const EXAMPLE_DELTA_V = 9400;
const exampleRatio = Math.exp(EXAMPLE_DELTA_V / (EXAMPLE_ISP * STANDARD_GRAVITY));

const geoAltitude = SYNCHRONOUS_RADIUS - EARTH.EQUATORIAL_RADIUS;

/** 霍曼转移出发时火星领先地球的相位角 [°]：转移时间内火星走过的角度与 180° 之差。 */
const marsPhase = 180 - (360 * marsTransfer.time) / MARS_BODY.orbitalPeriod;

const bodyRows = (pick: (b: CelestialBody) => string): string[] => CELESTIAL_BODIES.map(pick);

const composition = (id: CelestialBody['id']): Bilingual[] =>
  ATMOSPHERE_COMPOSITION[id].map(([zh, en, percent]) => [`${zh} ${n(percent, percent < 1 ? 3 : 2)}%`, `${en} ${n(percent, percent < 1 ? 3 : 2)}%`]);

// ---------------------------------------------------------------------------
// 条目
// ---------------------------------------------------------------------------

const PHYSICS_BASICS: WikiArticle = {
  id: 'physics-basics',
  category: 'theory',
  title: ['基础物理知识', 'Physics basics'],
  summary: ['牛顿定律、万有引力、推力与比冲、大气与动压——游戏里每一步计算的出发点。', 'Newton’s laws, gravitation, thrust and specific impulse, the atmosphere and dynamic pressure — the starting point of every calculation in the game.'],
  sections: [
    {
      heading: ['单位', 'Units'],
      blocks: [
        { kind: 'p', text: ['航天计算统一使用国际单位制：长度 m、时间 s、质量 kg、力 N（= kg·m/s²）、压力 Pa（= N/m²）。界面上显示的 km、t、kN 只是换算后的读数。', 'Spaceflight calculations use SI units: length in m, time in s, mass in kg, force in N (= kg·m/s²), pressure in Pa (= N/m²). The km, t and kN shown on screen are only converted readouts.'] },
        { kind: 'game', text: ['物理核心内部全部用 SI 单位，只在显示时换算。', 'The physics core works entirely in SI units and converts only for display.'] },
      ],
    },
    {
      heading: ['牛顿三定律', 'Newton’s three laws'],
      blocks: [
        {
          kind: 'list',
          items: [
            ['第一定律（惯性）：不受力的物体保持静止或匀速直线运动。关掉发动机的飞船会一直沿轨道滑行，不需要动力"维持"。', 'First law (inertia): a body with no net force stays at rest or moves in a straight line at constant speed. A spacecraft with its engines off keeps coasting along its orbit; no power is needed to “keep it going”.'],
            ['第二定律：合力等于质量乘加速度。', 'Second law: net force equals mass times acceleration.'],
            ['第三定律（作用与反作用）：火箭把燃气高速向后喷出，燃气对火箭产生向前的推力。火箭不需要"推空气"，在真空中照样工作，而且推力更大。', 'Third law (action and reaction): a rocket throws exhaust backwards at high speed and the exhaust pushes the rocket forwards. A rocket does not push on the air; it works in vacuum, and even produces more thrust there.'],
          ],
        },
        { kind: 'formula', expr: 'F = m · a', where: ['F 合力 [N]，m 质量 [kg]，a 加速度 [m/s²]', 'F net force [N], m mass [kg], a acceleration [m/s²]'] },
        { kind: 'p', text: ['动量守恒是第三定律的直接结果：两部分互相推开时，总动量不变。火箭分级、抛整流罩、释放卫星都遵守它。', 'Conservation of momentum follows directly from the third law: when two parts push apart, the total momentum is unchanged. Stage separation, fairing jettison and satellite release all obey it.'] },
        { kind: 'game', text: ['分离时，游戏给分离体和箭体一个相对速度（级间分离 1.5 m/s，联盟号助推器 2 m/s，卫星部署 0.5 m/s，均为估算），并按两者质量分配，使总动量守恒。', 'At separation the game gives the parts a relative speed (1.5 m/s between stages, 2 m/s for the Soyuz boosters, 0.5 m/s for satellite deployment, all estimates) and splits it by mass so total momentum is conserved.'] },
      ],
    },
    {
      heading: ['万有引力', 'Gravitation'],
      blocks: [
        { kind: 'formula', expr: 'F = G · M · m / r²        μ = G · M', where: [`G 万有引力常数 ${GRAVITATIONAL_CONSTANT.toExponential(4)} m³/(kg·s²)，M、m 两个物体的质量，r 两者质心的距离。μ 叫标准引力参数，地球的 μ = ${EARTH.MU.toExponential(9)} m³/s²`, `G is the gravitational constant ${GRAVITATIONAL_CONSTANT.toExponential(4)} m³/(kg·s²), M and m the two masses, r the distance between their centres. μ is the standard gravitational parameter; for Earth μ = ${EARTH.MU.toExponential(9)} m³/s²`] },
        { kind: 'p', text: ['天体的 μ 可以从卫星轨道直接测得，精度比单独的 G 和 M 高得多，所以轨道计算只用 μ。', 'A body’s μ can be measured directly from orbits of its satellites, far more precisely than G or M on their own, so orbital calculations use μ only.'] },
        { kind: 'formula', expr: 'g(h) = μ / (R + h)²', where: ['离地面 h 高处的重力加速度，R 为地球半径', 'gravitational acceleration at height h above a surface of radius R'] },
        {
          kind: 'table',
          head: [['高度', 'Altitude'], ['重力加速度', 'Gravity'], ['相对地面', 'Relative to surface']],
          rows: [0, 100_000, 200_000, 400_000, geoAltitude].map((h) => {
            const g = EARTH.MU / (EARTH.RADIUS + h) ** 2;
            return [`${km(h)} km`, `${n(g, 2)} m/s²`, `${n((100 * g) / earthSurface.gravity, 0)}%`];
          }),
        },
        { kind: 'p', text: [`在 ${km(PARKING_ORBIT_ALTITUDE)} km 的轨道上，重力还有地面的 ${n((100 * leo.gravity) / earthSurface.gravity, 0)}%。宇航员"失重"不是因为没有重力，而是飞船和人一起在自由落体——一直往下掉，却因为横向速度够快而总是掉不到地面。`, `In a ${km(PARKING_ORBIT_ALTITUDE)} km orbit gravity is still ${n((100 * leo.gravity) / earthSurface.gravity, 0)}% of its surface value. Astronauts are “weightless” not because gravity is absent but because they and the ship are in free fall together — always falling, but moving sideways fast enough to keep missing the ground.`] },
        { kind: 'p', text: [`标准重力 g₀ = ${STANDARD_GRAVITY} m/s² 是一个定义值，用来换算比冲和过载；用平均半径算出的引力加速度是 ${n(earthSurface.gravity, 2)} m/s²。地面实际重力随纬度在约 9.78–9.83 m/s² 之间变化（自转离心效应与地球扁率）。`, `Standard gravity g₀ = ${STANDARD_GRAVITY} m/s² is a defined value used to convert specific impulse and g-load; gravity computed from the mean radius is ${n(earthSurface.gravity, 2)} m/s². Actual surface gravity varies with latitude between about 9.78 and 9.83 m/s² (rotation and Earth’s flattening).`] },
        { kind: 'game', text: ['游戏把地球当作质点引力的球体，没有加入 J2 扁率摄动和月球、太阳的引力。', 'The game treats Earth as a spherical point-mass gravity source; J2 oblateness and lunar and solar gravity are not included.'] },
      ],
    },
    {
      heading: ['推力与比冲', 'Thrust and specific impulse'],
      blocks: [
        { kind: 'formula', expr: 'F = ṁ · vₑ + (pₑ − pₐ) · Aₑ', where: ['ṁ 推进剂质量流量 [kg/s]，vₑ 喷气速度，pₑ 喷口压力，pₐ 环境气压，Aₑ 喷口面积', 'ṁ propellant mass flow [kg/s], vₑ exhaust velocity, pₑ nozzle exit pressure, pₐ ambient pressure, Aₑ nozzle exit area'] },
        { kind: 'p', text: ['第二项说明：环境气压越低推力越大。所以同一台发动机在真空中的推力和比冲都比海平面高。', 'The second term means thrust grows as ambient pressure falls, so the same engine has higher thrust and specific impulse in vacuum than at sea level.'] },
        { kind: 'formula', expr: 'Isp = F / (ṁ · g₀)', where: ['比冲 [s]：单位重量推进剂产生的冲量，越大越省推进剂。乘以 g₀ 就是等效喷气速度', 'Specific impulse [s]: impulse per unit weight of propellant; higher means more efficient. Multiplied by g₀ it gives the effective exhaust velocity'] },
        {
          kind: 'table',
          head: [['推进剂', 'Propellants'], ['典型真空比冲', 'Typical vacuum Isp'], ['游戏中的例子', 'Example in the game']],
          rows: [
            [['酒精 / 液氧', 'Alcohol / LOX'], '≈ 235–250 s', ['水星-红石的 A-7', 'A-7 on Mercury-Redstone']],
            [['煤油 / 液氧', 'Kerosene / LOX'], '≈ 300–340 s', ['联盟号 RD-107A/108A、宇宙神V 的 RD-180', 'Soyuz RD-107A/108A, Atlas V RD-180']],
            [['液氢 / 液氧', 'Hydrogen / LOX'], '≈ 440–460 s', ['半人马座上面级 RL10C-1', 'Centaur upper stage RL10C-1']],
          ],
        },
        { kind: 'formula', expr: 'TWR = F / (m · g₀)', where: ['推重比：大于 1 才能离开发射台', 'Thrust-to-weight ratio: must exceed 1 to leave the pad'] },
        { kind: 'game', text: ['游戏的推力按上面的公式随高度（环境气压）变化；推重比、过载都以 g₀ 为单位。', 'In the game thrust follows the formula above as ambient pressure changes with altitude; TWR and g-load are expressed in units of g₀.'] },
      ],
    },
    {
      heading: ['大气、动压与气动加热', 'Atmosphere, dynamic pressure and heating'],
      blocks: [
        { kind: 'p', text: [`海平面标准大气：气压 ${n(SEA_LEVEL.PRESSURE)} Pa，密度 ${SEA_LEVEL.DENSITY} kg/m³，温度 ${SEA_LEVEL.TEMPERATURE} K。密度随高度大致按指数下降，每升高约 7–8 km 降到原来的 1/e。到 100 km（卡门线）只剩海平面的百万分之一左右。`, `Standard sea-level atmosphere: pressure ${n(SEA_LEVEL.PRESSURE)} Pa, density ${SEA_LEVEL.DENSITY} kg/m³, temperature ${SEA_LEVEL.TEMPERATURE} K. Density falls roughly exponentially, by a factor of e every 7–8 km or so. At 100 km (the Kármán line) only about a millionth of the sea-level density remains.`] },
        { kind: 'formula', expr: 'q = ½ · ρ · v²', where: ['动压 [Pa]：ρ 空气密度，v 相对空气的速度。阻力 D = q · C_D · A', 'Dynamic pressure [Pa]: ρ air density, v speed relative to the air. Drag D = q · C_D · A'] },
        { kind: 'p', text: ['上升时速度越来越快、空气越来越稀，动压先升后降，最高点叫 Max-Q，通常在十几千米高。火箭结构在这里受力最大，转弯过猛会解体。', 'During ascent speed rises while air thins, so dynamic pressure rises and then falls; the peak, Max-Q, usually occurs at 10–15 km altitude. Structural loads are highest there, and turning too hard can break the rocket apart.'] },
        { kind: 'formula', expr: 'q̇ ≈ k · √(ρ / Rₙ) · v³', where: ['驻点热流（Sutton–Graves 公式）：Rₙ 头部曲率半径，k ≈ 1.74×10⁻⁴（地球大气）。热流与速度的三次方成正比，所以再入比上升热得多', 'Stagnation-point heat flux (Sutton–Graves): Rₙ nose radius, k ≈ 1.74×10⁻⁴ for Earth’s air. Heat flux scales with the cube of speed, which is why reentry is far hotter than ascent'] },
        { kind: 'game', text: ['游戏的大气用美国标准大气 1976（到 1000 km），结构强度检查动压、过载与弯矩，再入加热用 Sutton–Graves 公式加防热层烧蚀模型。', 'The game uses the US Standard Atmosphere 1976 (to 1000 km), checks dynamic pressure, g-load and bending against structural limits, and models reentry heating with Sutton–Graves plus an ablative heat-shield model.'] },
      ],
    },
  ],
  related: ['rocket-equation', 'cosmic-velocities', 'earth'],
  sources: ['PHYSICS.md §4–§7, §18–§20', 'Wikipedia: Standard gravitational parameter; Gravitational constant (CODATA 2018)'],
};

const ROCKET_EQUATION: WikiArticle = {
  id: 'rocket-equation',
  category: 'theory',
  title: ['火箭方程基础', 'The rocket equation'],
  summary: ['齐奥尔科夫斯基火箭方程：火箭能获得多少速度增量，为什么要分级。', 'The Tsiolkovsky rocket equation: how much velocity change a rocket can gain, and why rockets have stages.'],
  sections: [
    {
      heading: ['方程', 'The equation'],
      blocks: [
        { kind: 'formula', expr: 'Δv = Isp · g₀ · ln(m₀ / m_f) = vₑ · ln(m₀ / m_f)', where: ['Δv 速度增量，Isp 比冲 [s]，g₀ = 9.80665 m/s²，m₀ 点火时质量，m_f 关机时质量（推进剂烧掉后）。m₀/m_f 叫质量比', 'Δv velocity change, Isp specific impulse [s], g₀ = 9.80665 m/s², m₀ mass at ignition, m_f mass at cutoff (after the propellant is burned). m₀/m_f is the mass ratio'] },
        { kind: 'p', text: ['1903 年由齐奥尔科夫斯基发表。它只依赖两件事：发动机有多高效（比冲），以及推进剂占火箭质量的比例（质量比）。与推力大小、燃烧多快都无关。', 'Published by Tsiolkovsky in 1903. It depends on only two things: how efficient the engine is (specific impulse) and what fraction of the rocket is propellant (mass ratio). It does not depend on thrust or burn rate.'] },
      ],
    },
    {
      heading: ['推导', 'Derivation'],
      blocks: [
        { kind: 'p', text: ['设火箭质量 m、速度 v，在 dt 时间内以相对速度 vₑ 向后喷出质量 −dm 的燃气。没有外力时动量守恒：', 'Let the rocket have mass m and speed v, and in time dt eject a mass −dm of exhaust backwards at relative speed vₑ. With no external force, momentum is conserved:'] },
        { kind: 'formula', expr: 'm · dv = −vₑ · dm   ⇒   ∫ dv = −vₑ ∫ dm / m   ⇒   Δv = vₑ · ln(m₀ / m_f)' },
        { kind: 'p', text: ['对数意味着收益递减：质量比从 2 增加到 4，Δv 只多 ln 2 倍的喷气速度，而不是翻倍。', 'The logarithm means diminishing returns: raising the mass ratio from 2 to 4 adds only vₑ·ln 2 of Δv; it does not double it.'] },
      ],
    },
    {
      heading: ['为什么要分级', 'Why rockets use stages'],
      blocks: [
        { kind: 'p', text: [`进入近地轨道一般需要约 9.3–10 km/s 的 Δv（轨道速度加上重力损失和气动损失）。用真空比冲 ${EXAMPLE_ISP} s 的发动机提供 ${kms(EXAMPLE_DELTA_V, 1)} km/s，质量比要 ${n(exampleRatio, 1)}，也就是火箭 ${n(100 * (1 - 1 / exampleRatio), 0)}% 的质量都得是推进剂，剩下的 ${n(100 / exampleRatio, 0)}% 还要装下发动机、贮箱、结构和载荷，几乎做不到。`, `Reaching low Earth orbit typically needs about 9.3–10 km/s of Δv (orbital speed plus gravity and drag losses). Getting ${kms(EXAMPLE_DELTA_V, 1)} km/s from an engine with a vacuum Isp of ${EXAMPLE_ISP} s takes a mass ratio of ${n(exampleRatio, 1)}: ${n(100 * (1 - 1 / exampleRatio), 0)}% of the rocket must be propellant, leaving ${n(100 / exampleRatio, 0)}% for engines, tanks, structure and payload — practically impossible.`] },
        { kind: 'p', text: ['分级就是把烧空的贮箱和发动机扔掉，后面的级不用再带着它们加速。每一级各自用火箭方程计算，总 Δv 是各级之和。', 'Staging throws away empty tanks and engines so later stages no longer have to accelerate them. Each stage is computed with the rocket equation on its own, and the total Δv is the sum.'] },
        { kind: 'formula', expr: 'Δv_total = Σ Ispᵢ · g₀ · ln(m₀ᵢ / m_fᵢ)' },
        { kind: 'p', text: ['并联助推器（如联盟号的四个助推器）和芯级同时工作。这一段用两者合成的比冲；助推器烧完被抛掉以后，芯级再用剩下的推进剂单独计算一段。', 'Parallel boosters (such as the four Soyuz boosters) burn together with the core. That phase uses the combined specific impulse of both; after the boosters burn out and are dropped, the core’s remaining propellant is computed as a second phase.'] },
      ],
    },
    {
      heading: ['损失', 'Losses'],
      blocks: [
        {
          kind: 'list',
          items: [
            ['重力损失：竖直上升时，一部分推力只是在抵抗重力。推重比越低、上升越慢，损失越大，通常有 1–1.5 km/s。', 'Gravity loss: while climbing, part of the thrust only fights gravity. The lower the thrust-to-weight ratio and the slower the climb, the larger the loss — typically 1–1.5 km/s.'],
            ['气动损失：在稠密大气中受到的阻力，大型火箭一般只有一两百 m/s。', 'Drag loss: air resistance in the lower atmosphere, usually only one or two hundred m/s for a large rocket.'],
            ['转向损失：推力方向与速度方向不一致时损失的部分。', 'Steering loss: the part wasted when thrust is not aligned with velocity.'],
            [`地球自转是"免费"的速度：赤道向东发射可以得到 ${n(earthSurface.equatorSpeed, 0)} m/s，纬度 φ 处是这个值乘 cos φ。`, `Earth’s rotation is “free” speed: launching east from the equator gives ${n(earthSurface.equatorSpeed, 0)} m/s; at latitude φ multiply by cos φ.`],
          ],
        },
      ],
    },
    {
      heading: ['计算器', 'Calculator'],
      blocks: [{ kind: 'widget', widget: 'rocket-equation' }],
    },
    {
      heading: ['游戏中火箭的理想 Δv', 'Ideal Δv of the game’s rockets'],
      blocks: [
        { kind: 'widget', widget: 'vehicle-deltav' },
        { kind: 'game', text: ['菜单和设计室里的"理想 Δv"就是逐级用火箭方程、按真空比冲算出的总和，没有扣除重力、气动和转向损失；实际飞到轨道要比它少得多。飞行中 HUD 的剩余 Δv 也是同样算法。', 'The “ideal Δv” in the menu and workshop is the stage-by-stage rocket-equation sum using vacuum Isp, with no gravity, drag or steering losses; the speed actually reached in orbit is far lower. The remaining Δv on the flight HUD uses the same method.'] },
      ],
    },
  ],
  related: ['physics-basics', 'cosmic-velocities', 'orbital-elements'],
  sources: ['PHYSICS.md §7–§8, §12', 'Wikipedia: Tsiolkovsky rocket equation'],
};

const reachable = LAUNCH_SITES.map((site) => {
  const min = reachableInclination(site.latitudeDeg * DEG2RAD).min / DEG2RAD;
  return [[site.nameZh, site.name] as Bilingual, `${n(Math.abs(site.latitudeDeg), 1)}°`, `${n(min, 1)}°`, `${n(earthSurface.equatorSpeed * Math.cos(site.latitudeDeg * DEG2RAD), 0)} m/s`];
});

const ORBITAL_ELEMENTS: WikiArticle = {
  id: 'orbital-elements',
  category: 'theory',
  title: ['轨道力学要素', 'Orbital elements'],
  summary: ['六个轨道根数、近地点与远地点、活力公式、轨道周期、霍曼转移与倾角。', 'The six orbital elements, periapsis and apoapsis, the vis-viva equation, orbital period, Hohmann transfers and inclination.'],
  sections: [
    {
      heading: ['轨道是圆锥曲线', 'Orbits are conic sections'],
      blocks: [
        { kind: 'p', text: ['只考虑一个中心天体的引力时（二体问题），飞船的轨迹是一条圆锥曲线：圆、椭圆、抛物线或双曲线。关机后飞船沿这条曲线滑行，不再需要推进剂。', 'With only one central body’s gravity (the two-body problem), a spacecraft follows a conic section: circle, ellipse, parabola or hyperbola. After engine cutoff it coasts along that curve with no propellant needed.'] },
        { kind: 'formula', expr: 'ε = v²/2 − μ/r = −μ / (2a)', where: ['比机械能：ε < 0 椭圆（被束缚），ε = 0 抛物线（刚好逃逸），ε > 0 双曲线', 'Specific orbital energy: ε < 0 ellipse (bound), ε = 0 parabola (just escaping), ε > 0 hyperbola'] },
      ],
    },
    {
      heading: ['六个轨道根数', 'The six orbital elements'],
      blocks: [
        {
          kind: 'table',
          head: [['符号', 'Symbol'], ['名称', 'Name'], ['含义', 'Meaning']],
          rows: [
            ['a', ['半长轴', 'Semi-major axis'], ['椭圆的大小；决定轨道周期和能量', 'Size of the ellipse; sets the period and energy']],
            ['e', ['偏心率', 'Eccentricity'], ['椭圆的扁度：0 是圆，接近 1 越扁', 'Shape: 0 is a circle, closer to 1 is more elongated']],
            ['i', ['轨道倾角', 'Inclination'], ['轨道面与赤道面的夹角：0° 赤道轨道，90° 极地轨道，大于 90° 逆行', 'Tilt of the orbit plane from the equator: 0° equatorial, 90° polar, above 90° retrograde']],
            ['Ω', ['升交点赤经', 'Right ascension of the ascending node'], ['飞船由南向北穿过赤道的位置（相对春分点方向）', 'Where the craft crosses the equator heading north, measured from the vernal equinox']],
            ['ω', ['近地点幅角', 'Argument of periapsis'], ['近地点在轨道面里离升交点多远（角度）', 'Angle from the ascending node to periapsis within the orbit plane']],
            ['ν', ['真近点角', 'True anomaly'], ['飞船此刻在轨道上的位置，从近地点量起', 'Where the craft is now, measured from periapsis']],
          ],
        },
        { kind: 'p', text: ['前两个决定轨道的大小和形状，中间三个决定轨道在空间里的朝向，最后一个确定飞船在轨道上的位置。', 'The first two set the orbit’s size and shape, the next three its orientation in space, and the last the craft’s position along it.'] },
        { kind: 'formula', expr: 'r_p = a · (1 − e)        r_a = a · (1 + e)', where: ['近地点、远地点到地心的距离。HUD 上显示的"近地点 / 远地点高度"还要减去地球半径', 'Periapsis and apoapsis distances from Earth’s centre. The periapsis/apoapsis altitudes on the HUD subtract Earth’s radius'] },
      ],
    },
    {
      heading: ['速度与周期', 'Speed and period'],
      blocks: [
        { kind: 'formula', expr: 'v² = μ · (2/r − 1/a)', where: ['活力公式（vis-viva）：已知距离 r 和半长轴 a，就能算出那一点的速度', 'The vis-viva equation: speed at distance r on an orbit with semi-major axis a'] },
        { kind: 'formula', expr: 'T = 2π · √(a³ / μ)', where: ['轨道周期（开普勒第三定律）：只取决于半长轴', 'Orbital period (Kepler’s third law): depends only on the semi-major axis'] },
        { kind: 'p', text: [`例：${km(PARKING_ORBIT_ALTITUDE)} km 圆轨道速度 ${n(leo.speed, 0)} m/s，周期 ${minutes(leo.period)} 分钟。周期等于一个恒星日（${n(EARTH_BODY.siderealDay, 0)} s）的圆轨道半径是 ${km(SYNCHRONOUS_RADIUS)} km，在赤道上空约 ${km(geoAltitude)} km——这就是地球静止轨道（GEO）。`, `Example: a ${km(PARKING_ORBIT_ALTITUDE)} km circular orbit has a speed of ${n(leo.speed, 0)} m/s and a period of ${minutes(leo.period)} minutes. A circular orbit whose period equals one sidereal day (${n(EARTH_BODY.siderealDay, 0)} s) has a radius of ${km(SYNCHRONOUS_RADIUS)} km, about ${km(geoAltitude)} km above the equator — geostationary orbit (GEO).`] },
        { kind: 'widget', widget: 'orbit-calculator' },
      ],
    },
    {
      heading: ['怎样改变轨道', 'Changing an orbit'],
      blocks: [
        {
          kind: 'list',
          items: [
            ['顺向（沿速度方向）加速：抬高轨道的另一端。在近地点加速抬高远地点，在远地点加速抬高近地点。', 'Prograde (along the velocity): raises the opposite side of the orbit. Burning at periapsis raises apoapsis; burning at apoapsis raises periapsis.'],
            ['逆向减速：降低另一端。返回时在远离着陆场的一侧减速，让近地点落进大气层。', 'Retrograde: lowers the opposite side. To come home, burn retrograde on the far side so periapsis drops into the atmosphere.'],
            ['法向 / 反法向（垂直于轨道面）：改变倾角，在升交点或降交点做最省。', 'Normal / anti-normal (perpendicular to the orbit plane): changes inclination; cheapest at the ascending or descending node.'],
            ['径向：主要转动椭圆的朝向，效率低，很少单独使用。', 'Radial: mostly rotates the ellipse; inefficient and rarely used alone.'],
          ],
        },
        { kind: 'p', text: ['霍曼转移是两个共面圆轨道之间最省推进剂的双脉冲方法：先加速进入一个近地点与远地点分别接触两个圆的椭圆，飞半圈后在远地点再加速圆化。', 'A Hohmann transfer is the most propellant-efficient two-burn route between two coplanar circular orbits: burn into an ellipse that touches both circles, coast half an orbit, then burn again at apoapsis to circularise.'] },
        {
          kind: 'table',
          head: [[`从 ${km(PARKING_ORBIT_ALTITUDE)} km 到地球静止轨道`, `${km(PARKING_ORBIT_ALTITUDE)} km → GEO`], ['速度增量 Δv', 'Δv']],
          rows: [
            [['第一次点火（进入转移轨道 GTO）', 'First burn (into GTO)'], `${n(geoTransfer.departure, 0)} m/s`],
            [['第二次点火（赤道发射，只圆化）', 'Second burn (equatorial launch, circularise only)'], `${n(geoTransfer.arrival, 0)} m/s`],
            [[`第二次点火（从卡纳维拉尔角 ${n(capeLatitude, 1)}° 出发，同时消掉倾角）`, `Second burn (from Cape Canaveral at ${n(capeLatitude, 1)}°, also removing inclination)`], `${n(capeGeoArrival, 0)} m/s`],
            [['滑行时间', 'Coast time'], `${n(geoTransfer.coastTime / 3600, 2)} h`],
          ],
        },
        { kind: 'p', text: ['改变倾角很贵：速度为 v 的轨道转过角度 θ 需要 2v·sin(θ/2)。所以倾角修正放在速度最慢的远地点，并和圆化合成一次点火。', 'Plane changes are expensive: turning an orbit of speed v through angle θ costs 2v·sin(θ/2). So the correction is made at apoapsis, where the craft is slowest, combined with the circularisation burn.'] },
      ],
    },
    {
      heading: ['发射纬度与倾角', 'Launch latitude and inclination'],
      blocks: [
        { kind: 'formula', expr: 'cos i = cos φ · sin A', where: ['i 轨道倾角，φ 发射场纬度，A 发射方位角（从正北顺时针量）。正东发射（A = 90°）得到最小倾角 i = φ', 'i inclination, φ launch-site latitude, A launch azimuth (clockwise from north). Launching due east (A = 90°) gives the minimum inclination i = φ'] },
        { kind: 'table', head: [['发射场', 'Launch site'], ['纬度', 'Latitude'], ['直接入轨的最小倾角', 'Minimum direct inclination'], ['向东发射的自转速度', 'Rotation boost due east']], rows: reachable },
        { kind: 'game', text: ['游戏用二体开普勒轨道计算 HUD 上的轨道根数和预测轨迹，没有 J2 摄动，所以轨道面不会进动；地面轨迹计入地球自转。任务里的理论发射方位角也按上面的公式并扣除了地球自转。', 'The game computes the HUD’s orbital elements and predicted path from two-body Kepler orbits with no J2 perturbation, so orbit planes do not precess; ground tracks include Earth’s rotation. Mission launch azimuths use the formula above with Earth’s rotation accounted for.'] },
      ],
    },
  ],
  related: ['cosmic-velocities', 'rocket-equation', 'earth'],
  sources: ['PHYSICS.md §14, §17.1, §25', 'Wikipedia: Orbital elements; Vis-viva equation; Hohmann transfer orbit'],
};

const COSMIC_VELOCITIES: WikiArticle = {
  id: 'cosmic-velocities',
  category: 'theory',
  title: ['第一、第二、第三宇宙速度', 'The three cosmic velocities'],
  summary: [`环绕地球 ${kms(cosmic.first, 1)} km/s、脱离地球 ${kms(cosmic.second, 1)} km/s、飞出太阳系 ${kms(cosmic.third, 1)} km/s 是怎么来的。`, `Where ${kms(cosmic.first, 1)} km/s to orbit Earth, ${kms(cosmic.second, 1)} km/s to escape it and ${kms(cosmic.third, 1)} km/s to leave the Solar System come from.`],
  sections: [
    {
      heading: ['第一宇宙速度：环绕速度', 'First cosmic velocity: orbital speed'],
      blocks: [
        { kind: 'formula', expr: `v₁ = √(μ / R) = ${n(cosmic.first, 0)} m/s`, where: [`R 取地球平均半径 ${km(EARTH.RADIUS)} km`, `R is Earth’s mean radius, ${km(EARTH.RADIUS)} km`] },
        { kind: 'p', text: ['贴着地面做圆周运动、重力刚好提供向心力所需的速度。它是最小的发射速度，也是最大的环绕速度：轨道越高，圆轨道速度越小。', 'The speed at which gravity exactly provides the centripetal force for a circle skimming the surface. It is the minimum launch speed and also the maximum orbital speed: the higher the orbit, the slower the circular speed.'] },
        { kind: 'p', text: [`实际上贴地飞行会被大气烧毁，真实的近地轨道在 200 km 以上：${km(PARKING_ORBIT_ALTITUDE)} km 圆轨道速度是 ${n(leo.speed, 0)} m/s。火箭要提供的 Δv 远大于这个数，因为还要付出重力损失和气动损失，也要把飞船举到轨道高度。`, `In reality the atmosphere would destroy anything at ground level, so real low orbits are above 200 km: a ${km(PARKING_ORBIT_ALTITUDE)} km circular orbit is ${n(leo.speed, 0)} m/s. The Δv a rocket must deliver is far larger, because it also pays gravity and drag losses and must lift the craft to orbital altitude.`] },
      ],
    },
    {
      heading: ['第二宇宙速度：逃逸速度', 'Second cosmic velocity: escape speed'],
      blocks: [
        { kind: 'formula', expr: `v₂ = √(2μ / R) = √2 · v₁ = ${n(cosmic.second, 0)} m/s` },
        { kind: 'p', text: ['动能刚好等于把物体从地面移到无穷远所需的引力势能（比机械能等于 0），轨道变成抛物线，不再回来。它与飞行方向无关（只要不撞上地面）。', 'Kinetic energy exactly equals the gravitational energy needed to reach infinity (specific energy is zero); the path becomes a parabola and never returns. Direction does not matter, as long as the path does not hit the ground.'] },
        { kind: 'p', text: [`从 ${km(PARKING_ORBIT_ALTITUDE)} km 停泊轨道出发，当地逃逸速度是 ${n(leo.escapeSpeed, 0)} m/s，只需要在轨道速度上再加 ${n(leo.escapeSpeed - leo.speed, 0)} m/s。1959 年苏联的月球 1 号是第一个达到逃逸速度的人造物体。`, `From a ${km(PARKING_ORBIT_ALTITUDE)} km parking orbit the local escape speed is ${n(leo.escapeSpeed, 0)} m/s, only ${n(leo.escapeSpeed - leo.speed, 0)} m/s more than orbital speed. The Soviet Luna 1 in 1959 was the first human-made object to reach escape velocity.`] },
      ],
    },
    {
      heading: ['第三宇宙速度：脱离太阳系', 'Third cosmic velocity: leaving the Solar System'],
      blocks: [
        { kind: 'p', text: [`在地球轨道处脱离太阳需要 ${kms(cosmic.solarEscapeAtEarth, 1)} km/s（日心速度）。地球本身已经以 ${kms(cosmic.earthOrbitSpeed, 2)} km/s 绕太阳运动，顺着地球公转方向出发，飞船在远离地球之后还要剩下 v∞ = ${kms(cosmic.excess, 2)} km/s。`, `Escaping the Sun from Earth’s distance takes ${kms(cosmic.solarEscapeAtEarth, 1)} km/s (heliocentric). Earth already moves at ${kms(cosmic.earthOrbitSpeed, 2)} km/s around the Sun, so departing along Earth’s motion the craft must still have v∞ = ${kms(cosmic.excess, 2)} km/s once it is far from Earth.`] },
        { kind: 'formula', expr: `v₃ = √(v∞² + v₂²) = √(${kms(cosmic.excess, 2)}² + ${kms(cosmic.second, 2)}²) ≈ ${kms(cosmic.third, 2)} km/s`, where: ['先用能量相加：从地面出发要同时付出脱离地球的能量和剩余速度 v∞ 的动能。地球公转按圆轨道近似', 'Energies add: leaving from the ground must pay both Earth’s escape energy and the kinetic energy of the leftover v∞. Earth’s orbit is approximated as a circle'] },
        { kind: 'p', text: ['教科书常写 16.7 km/s，与上面的近似一致。实际任务还会借助行星引力弹弓，旅行者号就是这样获得了离开太阳系的速度。', 'Textbooks often quote 16.7 km/s, consistent with this approximation. Real missions also use planetary gravity assists; that is how the Voyager probes gained enough speed to leave the Solar System.'] },
      ],
    },
    {
      heading: ['三个天体对比', 'Comparing three bodies'],
      blocks: [
        {
          kind: 'table',
          head: [['', ''], ['地球', 'Earth'], ['月球', 'Moon'], ['火星', 'Mars']],
          rows: [
            [['表面重力', 'Surface gravity'], ...bodyRows((b) => `${n(derivedSurface(b).gravity, 2)} m/s²`)],
            [['第一宇宙速度', 'First cosmic velocity'], ...bodyRows((b) => `${kms(derivedSurface(b).circularSpeed)} km/s`)],
            [['第二宇宙速度', 'Second cosmic velocity'], ...bodyRows((b) => `${kms(derivedSurface(b).escapeSpeed)} km/s`)],
            [['近地 100 km 圆轨道周期', 'Period of a 100 km circular orbit'], ...bodyRows((b) => `${minutes(circularOrbitAt(b, 100_000).period, 0)} min`)],
          ],
        },
        { kind: 'p', text: ['表中数值都由各天体的 μ 和平均半径算出，忽略大气和自转。月球的逃逸速度只有地球的约五分之一，阿波罗登月舱的上升级很小就能飞回月球轨道。', 'All values are computed from each body’s μ and mean radius, ignoring atmosphere and rotation. The Moon’s escape speed is about a fifth of Earth’s, which is why the small Apollo ascent stage could return to lunar orbit.'] },
      ],
    },
  ],
  related: ['orbital-elements', 'rocket-equation', 'moon', 'mars'],
  sources: ['Wikipedia: Escape velocity; Standard gravitational parameter (μ☉ = 1.32712440042×10²⁰ m³/s²)'],
};

const bodyTable = (body: CelestialBody, extra: readonly (readonly [Bilingual, string | Bilingual])[] = []): WikiBlock => ({
  kind: 'table',
  head: [['参数', 'Quantity'], ['数值', 'Value']],
  rows: [
    [['质量', 'Mass'], `${body.mass.toExponential(4)} kg`],
    [['标准引力参数 μ', 'Gravitational parameter μ'], `${body.mu.toExponential(6)} m³/s²`],
    [['平均半径', 'Mean radius'], `${km(body.meanRadius, 1)} km`],
    [['赤道半径', 'Equatorial radius'], `${km(body.equatorialRadius, 1)} km`],
    [['平均密度', 'Mean density'], `${n(body.density, 0)} kg/m³`],
    [['表面重力', 'Surface gravity'], `${n(body.surfaceGravity, 3)} m/s² (${n(body.surfaceGravity / STANDARD_GRAVITY, 3)} g₀)`],
    [['逃逸速度', 'Escape velocity'], `${kms(body.escapeVelocity, 2)} km/s`],
    [['恒星自转周期', 'Sidereal rotation period'], body.siderealDay < 2 * 86_400 ? `${n(body.siderealDay / 3600, 3)} h` : `${days(body.siderealDay, 2)} d`],
    [['自转轴倾角', 'Axial tilt'], `${n(body.axialTilt, 2)}°`],
    ...extra,
  ],
});

const EARTH_ARTICLE: WikiArticle = {
  id: 'earth',
  category: 'bodies',
  title: ['地球', 'Earth'],
  summary: ['我们的发射基地：大小、引力、自转、大气层，以及游戏里的地球模型。', 'Our launch base: size, gravity, rotation, atmosphere — and the Earth model in the game.'],
  sections: [
    {
      heading: ['基本数据', 'Key figures'],
      blocks: [
        bodyTable(EARTH_BODY, [
          [['公转半长轴', 'Orbital semi-major axis'], `${n(EARTH_BODY.semiMajorAxis / 1e9, 2)}×10⁶ km (1 AU)`],
          [['公转速度（平均）', 'Mean orbital speed'], `${kms(cosmic.earthOrbitSpeed, 2)} km/s`],
          [['公转周期', 'Orbital period'], `${days(EARTH_BODY.orbitalPeriod, 3)} d`],
          [['赤道自转线速度', 'Equatorial rotation speed'], `${n(earthSurface.equatorSpeed, 0)} m/s`],
          [['海平面气压', 'Sea-level pressure'], `${n(EARTH_BODY.surfacePressure)} Pa`],
        ]),
        { kind: 'p', text: [`恒星日（相对恒星自转一周）是 ${n(EARTH_BODY.siderealDay, 0)} s，约 23 小时 56 分 4 秒，比太阳日短约 4 分钟：地球每天还沿公转轨道走了约 1°，要多转一点太阳才回到同一位置。地球静止轨道卫星的周期等于恒星日，而不是 24 小时。`, `A sidereal day (one rotation relative to the stars) is ${n(EARTH_BODY.siderealDay, 0)} s, about 23 h 56 min 4 s, some 4 minutes shorter than a solar day: Earth also moves about 1° along its orbit each day, so it must turn a little further for the Sun to return to the same place. Geostationary satellites have a period of one sidereal day, not 24 hours.`] },
      ],
    },
    {
      heading: ['大气层', 'Atmosphere'],
      blocks: [
        { kind: 'list', items: composition('earth') },
        {
          kind: 'list',
          items: [
            ['对流层：地面到约 8–15 km，天气现象都在这里，温度随高度下降。', 'Troposphere: ground to about 8–15 km, where weather happens; temperature falls with height.'],
            ['平流层：到约 50 km，含臭氧层，温度回升。', 'Stratosphere: to about 50 km, contains the ozone layer; temperature rises again.'],
            ['中间层：到约 85 km，温度最低，流星在这里燃烧。', 'Mesosphere: to about 85 km, the coldest layer, where meteors burn up.'],
            ['热层：85 km 以上，极其稀薄，国际空间站在约 400 km 处，仍有微弱的阻力。', 'Thermosphere: above 85 km, extremely thin; the International Space Station flies at about 400 km and still feels slight drag.'],
          ],
        },
        { kind: 'p', text: [`卡门线（${km(KARMAN_LINE_ALTITUDE)} km）是国际航空联合会（FAI）采用的太空边界：在这个高度，靠空气升力飞行需要的速度已经接近轨道速度。`, `The Kármán line (${km(KARMAN_LINE_ALTITUDE)} km) is the edge of space used by the FAI: at that height an aircraft would need nearly orbital speed to fly on aerodynamic lift.`] },
      ],
    },
    {
      heading: ['为什么向东发射', 'Why launch east'],
      blocks: [
        { kind: 'p', text: [`地球自西向东转，赤道上的地面以 ${n(earthSurface.equatorSpeed, 0)} m/s 运动。向东发射，火箭在起飞前就"白得"这部分速度；纬度越高得到的越少。向西发射（逆行轨道）则要额外补上两倍这个值。`, `Earth spins west to east; the ground at the equator moves at ${n(earthSurface.equatorSpeed, 0)} m/s. Launching east, the rocket gets that speed for free before liftoff — less at higher latitudes. Launching west (a retrograde orbit) costs twice that amount extra.`] },
        { kind: 'p', text: ['这也是为什么发射场多建在低纬度、东边是海的地方：既能多借自转速度，残骸和失败的火箭也会落在海里。', 'That is why launch sites are often at low latitudes with open sea to the east: more rotation speed, and spent stages or failed rockets fall into the ocean.'] },
      ],
    },
    {
      heading: ['游戏中的地球', 'Earth in the game'],
      blocks: [
        { kind: 'game', text: [`物理上的地球是半径 ${km(EARTH.RADIUS)} km 的球体（平均半径，"海平面"），引力是质点引力 μ = ${EARTH.MU.toExponential(9)} m³/s²，自转角速度 ${EARTH.ROTATION_RATE.toExponential(6)} rad/s，大气用美国标准大气 1976。没有扁率（J2 已在常量里预留但未使用）、地形和风。地球影像、云层和昼夜只是渲染，不影响物理。`, `Physically the Earth is a sphere of radius ${km(EARTH.RADIUS)} km (mean radius, “sea level”), with point-mass gravity μ = ${EARTH.MU.toExponential(9)} m³/s², rotation rate ${EARTH.ROTATION_RATE.toExponential(6)} rad/s and the US Standard Atmosphere 1976. There is no flattening (J2 is defined but unused), terrain or wind. The Earth imagery, clouds and day–night cycle are rendering only and do not affect physics.`] },
      ],
    },
  ],
  related: ['moon', 'mars', 'physics-basics', 'orbital-elements'],
  sources: ['Wikipedia: Earth (infobox: NASA Earth fact sheet, IERS, WGS-84)', 'src/game/physics/constants.ts'],
};

const MOON_ARTICLE: WikiArticle = {
  id: 'moon',
  category: 'bodies',
  title: ['月球', 'The Moon'],
  summary: ['地球唯一的天然卫星：低重力、没有大气、潮汐锁定，地月转移要多少 Δv。', 'Earth’s only natural satellite: low gravity, no atmosphere, tidally locked — and how much Δv it takes to get there.'],
  sections: [
    {
      heading: ['基本数据', 'Key figures'],
      blocks: [
        bodyTable(MOON_BODY, [
          [['到地球的平均距离（半长轴）', 'Mean distance from Earth (semi-major axis)'], `${km(MOON_BODY.semiMajorAxis)} km`],
          [['轨道偏心率', 'Orbital eccentricity'], n(MOON_BODY.eccentricity, 4)],
          [['轨道倾角（相对黄道）', 'Inclination to the ecliptic'], `${n(MOON_ORBIT.inclinationToEcliptic, 3)}°`],
          [['公转周期（恒星月）', 'Orbital period (sidereal month)'], `${days(MOON_BODY.orbitalPeriod, 2)} d`],
          [['朔望月', 'Synodic month'], `${days(MOON_ORBIT.synodicMonth, 2)} d`],
          [['表面气压', 'Surface pressure'], ['白天约 10⁻⁷ Pa（几乎真空）', 'About 10⁻⁷ Pa by day (near vacuum)']],
        ]),
      ],
    },
    {
      heading: ['潮汐锁定', 'Tidal locking'],
      blocks: [
        { kind: 'p', text: ['月球自转一周的时间正好等于绕地球公转一周，所以总是同一面朝向地球。月球的一个白天（从日出到下一次日出）长达约 29.5 个地球日。', 'The Moon turns once on its axis in exactly the time it takes to orbit Earth, so the same face always points at us. One lunar day, sunrise to sunrise, lasts about 29.5 Earth days.'] },
      ],
    },
    {
      heading: ['在月球上飞行', 'Flying at the Moon'],
      blocks: [
        { kind: 'p', text: [`表面重力 ${n(moonSurface.gravity, 2)} m/s²，约为地球的六分之一；贴地圆轨道速度只有 ${n(moonSurface.circularSpeed, 0)} m/s，逃逸速度 ${n(moonSurface.escapeSpeed, 0)} m/s。`, `Surface gravity is ${n(moonSurface.gravity, 2)} m/s², about one sixth of Earth’s; a circular orbit skimming the surface is only ${n(moonSurface.circularSpeed, 0)} m/s and escape speed is ${n(moonSurface.escapeSpeed, 0)} m/s.`] },
        { kind: 'p', text: ['没有大气意味着两件事：不能用降落伞或气动减速，着陆全靠发动机反推；但也没有气动阻力和加热，轨道可以非常低，起飞时也不用担心动压。', 'No atmosphere means two things: parachutes and aerobraking are impossible, so landing relies entirely on rocket braking; but there is also no drag or heating, orbits can be very low, and ascent has no dynamic-pressure limit.'] },
      ],
    },
    {
      heading: ['怎样去月球', 'Getting to the Moon'],
      blocks: [
        { kind: 'p', text: [`只考虑地球引力，从 ${km(PARKING_ORBIT_ALTITUDE)} km 停泊轨道霍曼转移到月球轨道距离，第一次点火（地月转移，TLI）约 ${n(moonTransfer.departure, 0)} m/s，滑行约 ${days(moonTransfer.time, 1)} 天。到达后还要减速才能被月球捕获进入环月轨道，再减速才能着陆。`, `Considering only Earth’s gravity, a Hohmann transfer from a ${km(PARKING_ORBIT_ALTITUDE)} km parking orbit out to the Moon’s distance needs about ${n(moonTransfer.departure, 0)} m/s for the first burn (trans-lunar injection, TLI) and coasts for about ${days(moonTransfer.time, 1)} days. On arrival the craft must brake to be captured into lunar orbit, and brake again to land.`] },
        { kind: 'p', text: ['这只是数量级估算：真实轨道还要算月球自己的引力和月球的运动。阿波罗飞船走的是比霍曼转移更快的轨道，约 3 天到达。1969 年 7 月阿波罗 11 号首次载人登月。', 'This is only an order-of-magnitude estimate; real trajectories include the Moon’s own gravity and motion. The Apollo spacecraft flew a faster path than a Hohmann transfer and arrived in about 3 days. Apollo 11 made the first crewed landing in July 1969.'] },
        { kind: 'game', text: ['游戏目前没有月球：物理中只有地球的引力，月球、地月转移和登月都尚未实现。', 'The Moon is not in the game yet: physics includes only Earth’s gravity, and the Moon, lunar transfers and landings are not implemented.'] },
      ],
    },
  ],
  related: ['earth', 'mars', 'cosmic-velocities', 'orbital-elements'],
  sources: ['Wikipedia: Moon (infobox: NASA NSSDC Moon fact sheet; Wieczorek et al. 2006)', 'Wikipedia: Standard gravitational parameter (Park et al. 2021)'],
};

const MARS_ARTICLE: WikiArticle = {
  id: 'mars',
  category: 'bodies',
  title: ['火星', 'Mars'],
  summary: ['红色星球：稀薄的二氧化碳大气、比地球稍长的一天、每 26 个月一次的发射窗口。', 'The Red Planet: a thin carbon-dioxide atmosphere, a day slightly longer than Earth’s, and a launch window every 26 months.'],
  sections: [
    {
      heading: ['基本数据', 'Key figures'],
      blocks: [
        bodyTable(MARS_BODY, [
          [['公转半长轴', 'Orbital semi-major axis'], `${n(MARS_BODY.semiMajorAxis / 1e9, 1)}×10⁶ km`],
          [['轨道偏心率', 'Orbital eccentricity'], n(MARS_BODY.eccentricity, 4)],
          [['轨道倾角（相对黄道）', 'Inclination to the ecliptic'], `${n(MARS_ORBIT.inclinationToEcliptic, 2)}°`],
          [['公转周期', 'Orbital period'], `${days(MARS_BODY.orbitalPeriod, 2)} d`],
          [['太阳日（一个"火星日" sol）', 'Solar day (sol)'], `${n(MARS_BODY.solarDay / 3600, 3)} h`],
          [['表面平均气压', 'Mean surface pressure'], `${n(MARS_BODY.surfacePressure)} Pa`],
          [['会合周期', 'Synodic period'], `${days(MARS_ORBIT.synodicPeriod, 0)} d`],
        ]),
        { kind: 'p', text: ['火星有两颗很小的卫星：火卫一（福波斯）和火卫二（得摩斯）。自转轴倾角与地球接近，所以也有四季，但一年约是地球的 1.88 倍。', 'Mars has two small moons, Phobos and Deimos. Its axial tilt is close to Earth’s, so it has seasons too, but its year is about 1.88 Earth years.'] },
      ],
    },
    {
      heading: ['大气', 'Atmosphere'],
      blocks: [
        { kind: 'list', items: composition('mars') },
        { kind: 'p', text: [`表面气压只有约 ${n(MARS_BODY.surfacePressure)} Pa，不到地球海平面的 1%。这层大气足够让再入的探测器剧烈加热，需要防热罩；却又太稀薄，单靠降落伞减不到安全速度，最后一段要靠反推发动机（或气囊、空中吊车）。`, `Surface pressure is only about ${n(MARS_BODY.surfacePressure)} Pa, under 1% of Earth’s sea level. That is thick enough to heat an entering probe fiercely, so a heat shield is required, yet too thin for parachutes alone to slow it to a safe speed; the final descent uses rockets (or airbags, or a sky crane).`] },
      ],
    },
    {
      heading: ['怎样去火星', 'Getting to Mars'],
      blocks: [
        { kind: 'p', text: [`把地球和火星当成共面圆轨道，日心霍曼转移需要离开地球时剩余 v∞ ≈ ${kms(marsTransfer.departure, 2)} km/s，飞行约 ${days(marsTransfer.time, 0)} 天。从 ${km(PARKING_ORBIT_ALTITUDE)} km 停泊轨道出发需要约 ${kms(marsTransfer.fromLeo, 2)} km/s 的 Δv。到达火星时相对火星还有约 ${kms(marsTransfer.arrival, 2)} km/s 的剩余速度，要减速入轨或直接再入。`, `Treating Earth and Mars as coplanar circular orbits, a heliocentric Hohmann transfer needs v∞ ≈ ${kms(marsTransfer.departure, 2)} km/s on leaving Earth and takes about ${days(marsTransfer.time, 0)} days. From a ${km(PARKING_ORBIT_ALTITUDE)} km parking orbit that is about ${kms(marsTransfer.fromLeo, 2)} km/s of Δv. On arrival the craft still has about ${kms(marsTransfer.arrival, 2)} km/s relative to Mars, to be shed by an orbit-insertion burn or by direct entry.`] },
        { kind: 'p', text: [`霍曼转移要求出发时火星在地球前方约 ${n(marsPhase, 0)}°，这种相对位置每个会合周期（约 ${days(MARS_ORBIT.synodicPeriod, 0)} 天，约 26 个月）才出现一次，这就是火星发射窗口。火星轨道偏心率较大，每个窗口的实际 Δv 和飞行时间都不一样。`, `A Hohmann transfer requires Mars to be about ${n(marsPhase, 0)}° ahead of Earth at departure. That alignment recurs once per synodic period (about ${days(MARS_ORBIT.synodicPeriod, 0)} days, roughly 26 months) — the Mars launch window. Because Mars’s orbit is fairly eccentric, the real Δv and flight time differ from window to window.`] },
        { kind: 'game', text: ['游戏目前不能飞往火星：物理中只有地球的引力。以上数值是按圆轨道霍曼转移估算的；主菜单的"发射窗口"按真实行星位置计算每个窗口的具体日期、Δv 和到达时间。', 'Mars flights are not in the game yet; physics includes only Earth’s gravity. The figures above are circular-orbit Hohmann estimates; the main menu’s “Launch windows” computes actual dates, Δv and arrival times for each window from real planetary positions.'] },
      ],
    },
  ],
  related: ['earth', 'moon', 'cosmic-velocities', 'orbital-elements'],
  sources: ['Wikipedia: Mars (infobox: NASA Mars fact sheet; Seidelmann 2007; Konopliv 2011; Hirt 2012)', `Wikipedia: Standard gravitational parameter (MGM2011; μ☉ = 1.32712440042×10²⁰ m³/s²)`],
};


// ---------------------------------------------------------------------------
// 轨道之星：借力飞越、旅行者号大巡游、多圈兰伯特解与共振轨道、深空机动
// ---------------------------------------------------------------------------

/** 在最低飞越高度、给定 v∞ 时，一次飞越能转过的最大角度 [rad] 与日心速度的最大改变量 [m/s]。 */
const flybyLimit = (body: PlanetId, vInf: number) => {
  const rp = MIN_FLYBY_RADIUS[body];
  const turn = 2 * Math.asin(1 / (1 + (rp * vInf * vInf) / findPlanet(body).mu));
  return { rp, turn, gain: 2 * vInf * Math.sin(turn / 2) };
};
const FLYBY_EXAMPLES = [
  ['venus', 5000],
  ['earth', 9000],
  ['jupiter', 8000],
] as const;

/** 共振轨道：周期为 n 年的日心椭圆的半长轴 [au]。 */
const resonantSemiMajorAxis = (years: number) => Math.cbrt(years * years);
const twoYearOrbit = resonantSemiMajorAxis(2);
/** 2 年周期、近日点在地球轨道（1 au）的椭圆：远日点 [au] 与在地球轨道处相对地球的速度 [m/s]。 */
const twoYearAphelion = 2 * twoYearOrbit - 1;
const twoYearVInf = (() => {
  const r = ASTRO.AU;
  const a = twoYearOrbit * ASTRO.AU;
  return Math.sqrt(SUN_MU * (2 / r - 1 / a)) - Math.sqrt(SUN_MU / r);
})();

const GRAVITY_ASSIST: WikiArticle = {
  id: 'gravity-assist',
  category: 'showcase',
  title: ['借力飞越', 'Gravity assists'],
  summary: ['不花推进剂改变速度：飞船掠过行星时借走它的一点公转速度。', 'Changing speed without propellant: a spacecraft passing a planet borrows a little of its orbital motion.'],
  sections: [
    {
      heading: ['原理', 'How it works'],
      blocks: [
        { kind: 'p', text: ['站在行星上看，飞船沿双曲线飞过：进来和离开时相对行星的剩余速度 v∞ 大小相同，只是方向转了一个角度 δ。行星自己在绕太阳运动，把这两个速度分别加上行星的公转速度，飞船相对太阳的速度大小就变了——可以变快，也可以变慢。', 'Seen from the planet, the spacecraft follows a hyperbola: its excess speed v∞ relative to the planet is the same coming in and going out; only its direction turns by an angle δ. The planet itself is moving around the Sun, so adding the planet’s orbital velocity to both, the spacecraft’s speed relative to the Sun changes — it can go up or down.'] },
        { kind: 'formula', expr: 'δ = 2 · asin( 1 / (1 + rₚ · v∞² / μ) )        |Δv☉| = 2 · v∞ · sin(δ / 2)', where: ['rₚ 近星点距离（离行星中心），μ 行星的引力参数。飞得越近、v∞ 越小，转得越多；日心速度的改变量最多是 2·v∞·sin(δ/2)', 'rₚ periapsis distance from the planet’s centre, μ the planet’s gravitational parameter. Closer passes and lower v∞ turn more; the heliocentric velocity changes by at most 2·v∞·sin(δ/2)'] },
        { kind: 'p', text: ['能量并不是凭空来的：飞船得到的动能来自行星的公转，但行星质量太大，它的轨道变化小到测不出来。从行星前方掠过会减速（去水星、金星常用），从后方掠过会加速（去木星以外常用）。', 'The energy is not free: it comes from the planet’s orbital motion, but the planet is so massive that its change in orbit is immeasurably small. Passing in front of the planet slows the spacecraft (useful for Mercury and Venus); passing behind it speeds the spacecraft up (useful beyond Jupiter).'] },
      ],
    },
    {
      heading: ['一次飞越能借多少', 'How much one flyby can give'],
      blocks: [
        {
          kind: 'table',
          head: [['行星', 'Planet'], ['剩余速度 v∞', 'v∞'], ['最低飞越距离', 'Minimum flyby distance'], ['最大偏转', 'Maximum turn'], ['最大日心速度改变', 'Maximum heliocentric change']],
          rows: FLYBY_EXAMPLES.map(([body, vInf]) => {
            const f = flybyLimit(body, vInf);
            const planet = findPlanet(body);
            return [[planet.nameZh, planet.name] as Bilingual, `${kms(vInf, 1)} km/s`, `${n(f.rp / planet.equatorialRadius, 2)} R`, `${n(f.turn / DEG2RAD, 0)}°`, `${kms(f.gain, 1)} km/s`];
          }),
        },
        { kind: 'p', text: ['木星质量最大，一次飞越就能让飞船的日心速度改变好几 km/s——这相当于一枚大型上面级的全部能力。', 'Jupiter, the most massive planet, can change a spacecraft’s heliocentric speed by several km/s in a single pass — the whole capability of a large upper stage.'] },
      ],
    },
    {
      heading: ['真实任务的路线', 'Routes of real missions'],
      blocks: [
        {
          kind: 'table',
          head: [['任务', 'Mission'], ['路线', 'Route'], ['关键日期', 'Key dates']],
          rows: [
            [['旅行者 2 号', 'Voyager 2'], ['地球 → 木星 → 土星 → 天王星 → 海王星', 'Earth → Jupiter → Saturn → Uranus → Neptune'], '1977-08-20 → 1979-07 → 1981-08 → 1986-01 → 1989-08'],
            [['伽利略号', 'Galileo'], ['地球 → 金星 → 地球 → 地球 → 木星（VEEGA）', 'Earth → Venus → Earth → Earth → Jupiter (VEEGA)'], '1989-10-18 → 1990-02-10 → 1990-12-08 → 1992-12-08 → 1995-12-07'],
            [['卡西尼号', 'Cassini'], ['地球 → 金星 → 金星 → 地球 → 木星 → 土星', 'Earth → Venus → Venus → Earth → Jupiter → Saturn'], '1997-10-15 → 1998-04-26 → 1999-06-24 → 1999-08-18 → 2000-12-30 → 2004-07-01'],
            [['信使号', 'MESSENGER'], ['地球 → 地球 → 金星 → 金星 → 水星 ×3 → 入轨', 'Earth → Earth → Venus → Venus → Mercury ×3 → orbit'], '2004-08-03 → 2005-08-02 → 2006-10-24 → 2007-06-05 → 2008-01-14 / 2008-10-06 / 2009-09-29 → 2011-03-18'],
            [['朱诺号', 'Juno'], ['地球 → 深空机动 → 地球 → 木星', 'Earth → deep-space maneuvers → Earth → Jupiter'], '2011-08-05 → 2012-08/09 → 2013-10-09 → 2016-07-05'],
          ],
        },
        { kind: 'p', text: ['伽利略号、卡西尼号、信使号、朱诺号都连续飞越同一颗行星，或在两次飞越之间点火——这就是下面两个条目要讲的多圈兰伯特解（共振轨道）和深空机动。', 'Galileo, Cassini, MESSENGER and Juno all flew past the same planet twice in a row, or fired their engines between flybys — the multi-revolution Lambert solutions (resonant orbits) and deep-space maneuvers explained in the next two articles.'] },
        { kind: 'game', text: ['主菜单的"发射窗口"可以计算借力路线：每段是零圈兰伯特轨道，每次飞越按拼接圆锥计算，进出 v∞ 不等时在近星点补一次点火。用旅行者号的真实日期核对，偏转角相差 0.0–0.4°（见"旅行者号的大巡游"）。连续飞越同一颗行星和深空机动不在计算范围内。', 'The main menu’s “Launch windows” computes gravity-assist routes: each leg is a zero-revolution Lambert arc, each flyby uses patched conics, and any v∞ mismatch is made up by a periapsis burn. Checked against Voyager’s real dates, turn angles agree within 0.0–0.4° (see “Voyager’s Grand Tour”). Consecutive flybys of the same planet and deep-space maneuvers are not computed.'] },
      ],
    },
  ],
  related: ['voyager-grand-tour', 'multi-revolution-lambert', 'deep-space-maneuvers', 'orbital-elements'],
  sources: ['Wikipedia: Gravity assist; Galileo project; Timeline of Cassini–Huygens; MESSENGER; Juno (spacecraft)', 'JPL Horizons (Voyager 1/2 encounter geometry)'],
};

const VOYAGER_GRAND_TOUR: WikiArticle = {
  id: 'voyager-grand-tour',
  category: 'showcase',
  title: ['旅行者号的大巡游', 'Voyager’s Grand Tour'],
  summary: ['1977 年发射的两艘飞船，靠一连串借力飞越走遍外太阳系。', 'Two spacecraft launched in 1977 that toured the outer Solar System on a chain of gravity assists.'],
  sections: [
    {
      heading: ['一次难得的排列', 'A rare alignment'],
      blocks: [
        { kind: 'p', text: ['20 世纪 70 年代末，木星、土星、天王星、海王星恰好排在太阳同一侧，一艘飞船可以借前一颗行星的引力飞向下一颗。旅行者 2 号于 1977-08-20 发射，依次飞越木星、土星、天王星、海王星，是至今唯一到访过天王星和海王星的飞船；旅行者 1 号于 1977-09-05 发射，飞越木星、土星后离开黄道面。', 'In the late 1970s Jupiter, Saturn, Uranus and Neptune happened to line up on the same side of the Sun, so a spacecraft could use each planet to fly on to the next. Voyager 2, launched on 1977-08-20, flew past Jupiter, Saturn, Uranus and Neptune and is still the only spacecraft to have visited Uranus and Neptune; Voyager 1, launched on 1977-09-05, flew past Jupiter and Saturn and then left the ecliptic plane.'] },
      ],
    },
    {
      heading: ['本游戏的模型 vs 真实轨迹', 'This game’s model vs the real trajectory'],
      blocks: [
        { kind: 'p', text: ['下面用真实的发射日和最接近时刻，在本游戏的计算器里重算这条路线：每段解兰伯特问题，每次飞越按拼接圆锥求偏转角和近星点距离，再与 JPL Horizons 中旅行者号的真实轨迹对比。', 'Below, the route is recomputed with this game’s calculator from the real launch dates and closest-approach times: each leg solves Lambert’s problem and each flyby’s turn angle and periapsis distance come from patched conics, compared with Voyager’s real trajectory in JPL Horizons.'] },
        { kind: 'widget', widget: 'voyager-tour' },
        { kind: 'p', text: ['几乎不需要补点火（几十 m/s 以内），说明真实的大巡游基本就是一连串不点火的飞越；真实飞船途中只做过小的轨道修正。', 'Hardly any extra burn is needed (tens of m/s at most): the real Grand Tour was essentially a chain of unpowered flybys, with only small trajectory corrections along the way.'] },
      ],
    },
  ],
  related: ['gravity-assist', 'multi-revolution-lambert', 'deep-space-maneuvers'],
  sources: ['JPL Horizons (Voyager 1 = -31, Voyager 2 = -32; DE441)', 'Wikipedia: Gravity assist'],
};

const MULTI_REV_LAMBERT: WikiArticle = {
  id: 'multi-revolution-lambert',
  category: 'showcase',
  title: ['多圈兰伯特解与共振轨道', 'Multi-revolution Lambert solutions and resonant orbits'],
  summary: ['同样的起点、终点和飞行时间，飞船也可以先绕太阳转几圈再到——伽利略号的"地球—地球"两年就是这样飞的。', 'With the same start, end and flight time, a spacecraft can also loop around the Sun a few times first — that is how Galileo spent two years between its Earth flybys.'] ,
  sections: [
    {
      heading: ['兰伯特问题有不止一个解', 'Lambert’s problem has more than one answer'],
      blocks: [
        { kind: 'p', text: ['兰伯特问题：已知两点位置和飞行时间 Δt，求连接它们的轨道。最直接的解是"零圈"——不绕中心天体整圈就到达。但如果 Δt 足够长，飞船还可以先绕 N 整圈再到达终点：对每个 N ≥ 1，只要 Δt 不短于这一圈数所需的最短时间，就有两条椭圆（一条周期较短、一条较长）满足要求。', 'Lambert’s problem: given two positions and a flight time Δt, find the orbit connecting them. The most direct answer is the “zero-revolution” arc that arrives without a full loop. But if Δt is long enough, the spacecraft can also complete N full revolutions first: for each N ≥ 1, provided Δt is at least the minimum for that many loops, two ellipses (one shorter-period, one longer) fit.'] },
        { kind: 'formula', expr: 'N = 0 ⇒ 1     N ≥ 1 ⇒ 0 / 2     Σ ≤ 2·N_max + 1', where: ['解的个数：零圈 1 个；每个 N ≥ 1 有 0 或 2 个；总数不超过 2·N_max + 1。再乘以方向（顺行/逆行）。求多圈解需要专门的算法（例如 Izzo 2015），在每个 N 上分别找两个分支', 'Number of solutions: one with zero revolutions; zero or two for each N ≥ 1; at most 2·N_max + 1 in total. Multiply by direction (prograde/retrograde). Multi-revolution solutions need dedicated algorithms (e.g. Izzo 2015) that search both branches for each N'] },
      ],
    },
    {
      heading: ['共振轨道：回到同一颗行星', 'Resonant orbits: coming back to the same planet'],
      blocks: [
        { kind: 'p', text: ['要连续两次飞越同一颗行星，飞船必须在一段时间后回到行星所在的位置。最简单的办法是让飞船的日心轨道周期与行星成整数比，比如行星转 2 圈时飞船转 1 圈（2:1 共振）。这时起点和终点是同一颗行星，零圈兰伯特解根本不存在，只能用多圈解。', 'To fly past the same planet twice in a row, the spacecraft must return to where the planet is some time later. The simplest way is a heliocentric orbit whose period is a whole-number ratio of the planet’s — for example the planet goes round twice while the spacecraft goes round once (2:1 resonance). Start and end are then the same planet, so no zero-revolution Lambert arc exists; only multi-revolution solutions do.'] },
        { kind: 'p', text: [`伽利略号 1990-12-08 第一次飞越地球后，进入周期 2 年的日心轨道，1992-12-08 正好回到地球第二次飞越，然后飞向木星。周期 2 年的轨道半长轴是 ${n(twoYearOrbit, 3)} au；若近日点在地球轨道上，远日点约 ${n(twoYearAphelion, 2)} au，在地球处相对地球要多出约 ${kms(twoYearVInf, 1)} km/s——第一次地球飞越加上金星飞越给的正是这部分速度。第二次飞越不再增加能量，只把方向转向木星。`, `After its first Earth flyby on 1990-12-08, Galileo entered a heliocentric orbit with a two-year period and returned to Earth exactly on 1992-12-08 for its second flyby, then headed for Jupiter. A two-year orbit has a semi-major axis of ${n(twoYearOrbit, 3)} au; with perihelion at Earth’s orbit its aphelion is about ${n(twoYearAphelion, 2)} au, and at Earth it moves about ${kms(twoYearVInf, 1)} km/s faster than Earth — the speed the Venus flyby and first Earth flyby provided. The second flyby added no energy; it only turned the path toward Jupiter.`] },
        { kind: 'p', text: ['信使号三次飞越水星、卡西尼号两次飞越金星，用的也是与行星周期接近整数比的轨道，再配合深空机动微调。', 'MESSENGER’s three Mercury flybys and Cassini’s two Venus flybys likewise used orbits close to whole-number period ratios with the planet, trimmed by deep-space maneuvers.'] },
        { kind: 'game', text: ['游戏的发射窗口计算器只求零圈兰伯特解，因此不允许连续两次飞越同一颗行星；像"地球—金星—地球—木星"这样的路线在游戏里算出来需要额外点火约 2.5 km/s，而真实的伽利略号靠地球—地球的两年共振段省掉了这部分。这是有意保留的简化：多圈解和共振轨道只在这里介绍。', 'The game’s launch-window calculator solves only zero-revolution Lambert arcs, so consecutive flybys of the same planet are not allowed; a route like Earth–Venus–Earth–Jupiter needs an extra burn of about 2.5 km/s in the game, which the real Galileo avoided with its two-year Earth–Earth resonant leg. This simplification is deliberate: multi-revolution solutions and resonant orbits are explained here only.'] },
      ],
    },
  ],
  related: ['gravity-assist', 'deep-space-maneuvers', 'orbital-elements'],
  sources: ['Wikipedia: Lambert’s problem; Galileo project (Venus 1990-02-10, Earth 1990-12-08 and 1992-12-08, Jupiter 1995-12-07); MESSENGER; Timeline of Cassini–Huygens', 'D. Izzo, “Revisiting Lambert’s problem”, Celestial Mechanics and Dynamical Astronomy 121 (2015)'],
};

const DEEP_SPACE_MANEUVERS: WikiArticle = {
  id: 'deep-space-maneuvers',
  category: 'showcase',
  title: ['深空机动', 'Deep-space maneuvers'],
  summary: ['在两次飞越之间、远离任何行星的地方点一次火，改出更好的下一次飞越。', 'A burn far from any planet, between two flybys, to set up a better next encounter.'],
  sections: [
    {
      heading: ['为什么要在半路点火', 'Why burn halfway'],
      blocks: [
        { kind: 'p', text: ['纯粹的借力路线里，每一段都是一条固定的兰伯特轨道，飞到下一颗行星时的 v∞ 和方向完全由日期决定，常常对不上下一次飞越的需要。在两段之间加一次深空机动（DSM），轨道就多了一个可以调节的"折点"：花一点推进剂，换来下一次飞越更大的 v∞ 或更合适的方向，总账上反而更省。', 'In a pure gravity-assist route each leg is a fixed Lambert arc, so the v∞ and direction at the next planet are dictated by the dates and often do not suit the next flyby. Adding a deep-space maneuver (DSM) between legs gives the path an adjustable “kink”: a little propellant buys a larger or better-aimed v∞ at the next flyby, and the total often comes out cheaper.'] },
        { kind: 'p', text: ['最典型的是"ΔV-EGA"（深空机动 + 地球借力）：先发射到周期约 2 年的日心轨道，在远日点附近点火压低近日点，绕回地球时相对地球的 v∞ 大大增加，再借地球飞向外行星。这比直接用火箭把 C3 提高同样多要省。', 'The classic is “ΔV-EGA” (deep-space maneuver plus Earth gravity assist): launch into a heliocentric orbit of about two years, burn near aphelion to lower perihelion, so the spacecraft returns to Earth with a much larger v∞, then use Earth to head for the outer planets. This is cheaper than having the rocket raise C3 by the same amount directly.'] },
      ],
    },
    {
      heading: ['真实例子', 'Real examples'],
      blocks: [
        {
          kind: 'table',
          head: [['任务', 'Mission'], ['机动', 'Maneuver'], ['作用', 'Purpose']],
          rows: [
            [['朱诺号', 'Juno'], ['2012 年 8 月和 9 月两次，在火星轨道外的远日点附近', 'Two burns in August and September 2012, near aphelion beyond Mars’s orbit'], ['2013-10-09 以 559 km 高度飞越地球，再飞向木星；2016-07-05 入轨时点火减速 542 m/s', 'Set up the 559 km Earth flyby on 2013-10-09 toward Jupiter; orbit insertion on 2016-07-05 slowed it by 542 m/s']],
            [['卡西尼号', 'Cassini'], ['1998-12-03 主发动机工作 90 分钟，减速约 450 m/s', '1998-12-03: 90-minute main-engine burn, slowing it by about 450 m/s'], ['两次金星飞越之间，把飞船送上 1999-06-24 第二次金星飞越的路线', 'Between the two Venus flybys, putting it on course for the second on 1999-06-24']],
            [['伽利略号', 'Galileo'], ['1990 年 4 月和 5 月两次轨道修正，共约 35 m/s', 'Two course corrections in April and May 1990, about 35 m/s in total'], ['金星飞越之后，瞄准 1990-12-08 的地球飞越', 'After the Venus flyby, aiming for the 1990-12-08 Earth flyby']],
          ],
        },
        { kind: 'game', text: ['游戏的发射窗口计算器不含深空机动：每段从一颗行星直接飞到下一颗，飞越中的不匹配只在近星点用一次点火补上。这是有意保留的简化；深空机动只在这里介绍。', 'The game’s launch-window calculator has no deep-space maneuvers: each leg flies straight from one planet to the next, and any mismatch is made up by a single burn at periapsis. This simplification is deliberate; deep-space maneuvers are explained here only.'] },
      ],
    },
  ],
  related: ['gravity-assist', 'multi-revolution-lambert', 'rocket-equation'],
  sources: ['Wikipedia: Juno (spacecraft); Timeline of Cassini–Huygens; Galileo project'],
};

export const WIKI_ARTICLES: readonly WikiArticle[] = [
  PHYSICS_BASICS,
  ROCKET_EQUATION,
  ORBITAL_ELEMENTS,
  COSMIC_VELOCITIES,
  EARTH_ARTICLE,
  MOON_ARTICLE,
  MARS_ARTICLE,
  GRAVITY_ASSIST,
  VOYAGER_GRAND_TOUR,
  MULTI_REV_LAMBERT,
  DEEP_SPACE_MANEUVERS,
];

export const DEFAULT_WIKI_ARTICLE: WikiArticleId = 'rocket-equation';

export const findWikiArticle = (id: string): WikiArticle | undefined => WIKI_ARTICLES.find((a) => a.id === id);

export const isWikiArticleId = (id: unknown): id is WikiArticleId => typeof id === 'string' && WIKI_ARTICLES.some((a) => a.id === id);

export const WIKI_CATEGORY_LABEL: Record<WikiCategory, Bilingual> = {
  theory: ['原理', 'Principles'],
  bodies: ['天体', 'Celestial bodies'],
  showcase: ['轨道之星', 'Orbit showcase'],
};

// 单独导出：测试用来核对文中引用的数
export const WIKI_FIGURES = { cosmic, leo, moonSurface, marsSurface, moonTransfer, marsTransfer, geoTransfer, capeGeoArrival, exampleRatio, geoAltitude, marsPhase } as const;
