/**
 * 行星数据：近似星历用的开普勒根数与变化率，以及做转移计算用的物理参数。
 *
 * 轨道根数来源：JPL Solar System Dynamics, "Approximate Positions of the Planets"
 * （E. M. Standish & J. G. Williams, 1992；https://ssd.jpl.nasa.gov/planets/approx_pos.html，2026-11-24 查阅）。
 * - Table 1：1800–2050 年有效，相对 J2000 平黄道与平春分点。
 * - Table 2a/2b：公元前 3000 年至公元 3000 年有效，精度较低；木星到海王星的平近点角要加 Table 2b 的修正项。
 * 地球一行是"地月质心"（EM Bary），转移计算把它当作地球的位置（相差约 4700 km，对行星际转移可以忽略）。
 *
 * 物理参数来源：
 * - 引力参数 μ：英文维基百科 Standard gravitational parameter 表（2026-11-21 查阅）。
 * - 半径：JPL "Planetary Physical Parameters"（https://ssd.jpl.nasa.gov/planets/phys_par.html，2026-11-24 查阅）。
 */

export type PlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

/** 六个根数：a [au]、e、I [°]、L 平黄经 [°]、ϖ 近日点黄经 [°]、Ω 升交点黄经 [°]。 */
export type ElementRow = readonly [a: number, e: number, I: number, L: number, varpi: number, node: number];

export interface ElementTable {
  /** J2000 时的根数。 */
  readonly epoch: ElementRow;
  /** 每儒略世纪的变化率。 */
  readonly rate: ElementRow;
  /** Table 2b 的平近点角修正 b、c、s、f（只有木星到海王星在 Table 2 里有）。 */
  readonly extra?: readonly [b: number, c: number, s: number, f: number];
}

export interface PlanetData {
  readonly id: PlanetId;
  readonly nameZh: string;
  readonly name: string;
  /** 标准引力参数 [m³/s²]。 */
  readonly mu: number;
  /** 赤道半径 [m]。 */
  readonly equatorialRadius: number;
  /** 平均半径 [m]。 */
  readonly meanRadius: number;
  /** 1800–2050 年的根数（Table 1）。 */
  readonly table1: ElementTable;
  /** 公元前 3000 年至公元 3000 年的根数（Table 2a + 2b）。 */
  readonly table2: ElementTable;
}

export const PLANETS: readonly PlanetData[] = [
  {
    id: 'mercury',
    nameZh: '水星',
    name: 'Mercury',
    mu: 2.2031870799e13,
    equatorialRadius: 2_440_530,
    meanRadius: 2_439_400,
    table1: {
      epoch: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
      rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    },
    table2: {
      epoch: [0.38709843, 0.20563661, 7.00559432, 252.25166724, 77.45771895, 48.33961819],
      rate: [0.0, 0.00002123, -0.00590158, 149472.67486623, 0.15940013, -0.12214182],
    },
  },
  {
    id: 'venus',
    nameZh: '金星',
    name: 'Venus',
    mu: 3.24858592e14,
    equatorialRadius: 6_051_800,
    meanRadius: 6_051_800,
    table1: {
      epoch: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
      rate: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
    },
    table2: {
      epoch: [0.72332102, 0.00676399, 3.39777545, 181.9797085, 131.76755713, 76.67261496],
      rate: [-0.00000026, -0.00005107, 0.00043494, 58517.8156026, 0.05679648, -0.27274174],
    },
  },
  {
    id: 'earth',
    nameZh: '地球',
    name: 'Earth',
    mu: 3.986004418e14,
    equatorialRadius: 6_378_137,
    meanRadius: 6_371_000,
    table1: {
      epoch: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
      rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    },
    table2: {
      epoch: [1.00000018, 0.01673163, -0.00054346, 100.46691572, 102.93005885, -5.11260389],
      rate: [-0.00000003, -0.00003661, -0.01337178, 35999.37306329, 0.3179526, -0.24123856],
    },
  },
  {
    id: 'mars',
    nameZh: '火星',
    name: 'Mars',
    mu: 4.282837e13,
    equatorialRadius: 3_396_190,
    meanRadius: 3_389_500,
    table1: {
      epoch: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    },
    table2: {
      epoch: [1.52371243, 0.09336511, 1.85181869, -4.56813164, -23.91744784, 49.71320984],
      rate: [0.00000097, 0.00009149, -0.00724757, 19140.29934243, 0.45223625, -0.26852431],
    },
  },
  {
    id: 'jupiter',
    nameZh: '木星',
    name: 'Jupiter',
    mu: 1.26686534e17,
    equatorialRadius: 71_492_000,
    meanRadius: 69_911_000,
    table1: {
      epoch: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    },
    table2: {
      epoch: [5.20248019, 0.0485359, 1.29861416, 34.33479152, 14.27495244, 100.29282654],
      rate: [-0.00002864, 0.00018026, -0.00322699, 3034.90371757, 0.18199196, 0.13024619],
      extra: [-0.00012452, 0.0606406, -0.35635438, 38.35125],
    },
  },
  {
    id: 'saturn',
    nameZh: '土星',
    name: 'Saturn',
    mu: 3.7931187e16,
    equatorialRadius: 60_268_000,
    meanRadius: 58_232_000,
    table1: {
      epoch: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      rate: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    },
    table2: {
      epoch: [9.54149883, 0.05550825, 2.49424102, 50.07571329, 92.86136063, 113.63998702],
      rate: [-0.00003065, -0.00032044, 0.00451969, 1222.11494724, 0.54179478, -0.25015002],
      extra: [0.00025899, -0.13434469, 0.87320147, 38.35125],
    },
  },
  {
    id: 'uranus',
    nameZh: '天王星',
    name: 'Uranus',
    mu: 5.793939e15,
    equatorialRadius: 25_559_000,
    meanRadius: 25_362_000,
    table1: {
      epoch: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
      rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    },
    table2: {
      epoch: [19.18797948, 0.0468574, 0.77298127, 314.20276625, 172.43404441, 73.96250215],
      rate: [-0.00020455, -0.0000155, -0.00180155, 428.49512595, 0.09266985, 0.05739699],
      extra: [0.00058331, -0.97731848, 0.17689245, 7.67025],
    },
  },
  {
    id: 'neptune',
    nameZh: '海王星',
    name: 'Neptune',
    mu: 6.836529e15,
    equatorialRadius: 24_764_000,
    meanRadius: 24_622_000,
    table1: {
      epoch: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
      rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    },
    table2: {
      epoch: [30.06952752, 0.00895439, 1.7700552, 304.22289287, 46.68158724, 131.78635853],
      rate: [0.00006447, 0.00000818, 0.000224, 218.46515314, 0.01009938, -0.00606302],
      extra: [-0.00041348, 0.68346318, -0.10162547, 7.67025],
    },
  },
];

export const findPlanet = (id: PlanetId): PlanetData => {
  const planet = PLANETS.find((p) => p.id === id);
  if (!planet) throw new Error(`未知行星：${id}`);
  return planet;
};

export const isPlanetId = (value: unknown): value is PlanetId => typeof value === 'string' && PLANETS.some((p) => p.id === value);

/** 可以作为目的地的行星（除地球外）。 */
export const DESTINATIONS: readonly PlanetId[] = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** 太阳的标准引力参数 [m³/s²]（维基百科 Standard gravitational parameter）。 */
export const SUN_MU = 1.32712440042e20;
