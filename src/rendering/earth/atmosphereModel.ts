/**
 * 视觉大气模型（单次散射）——仅用于渲染天空、大气边缘与光照颜色。
 *
 * 注意：这不是飞行物理使用的大气模型。气动力与气动加热所需的密度/压力模型
 * 位于 game/physics/atmosphere（阶段二实现），两者互不依赖。
 *
 * 模型：瑞利散射 + 米氏散射 + 臭氧吸收，指数密度分布。
 * 系数取自 Bruneton & Neyret (2008) 与 Hillaire (2020) 常用的地球大气参数。
 * 长度单位为 km（着色器内部同样使用 km，以保证 float32 下的数值范围合适）。
 */
import { EARTH } from '@/game/physics/constants';

export const ATMOSPHERE = {
  /** 行星半径 [km]。 */
  PLANET_RADIUS: EARTH.RADIUS / 1000,
  /** 视觉大气顶高度 [km]。80 km 处瑞利密度已降到海平面的 e⁻¹⁰。 */
  TOP_HEIGHT: 80,
  /** 瑞利标高 [km]。 */
  RAYLEIGH_SCALE_HEIGHT: 8,
  /** 米氏标高 [km]。 */
  MIE_SCALE_HEIGHT: 1.2,
  /** 瑞利散射系数（海平面）[1/km]，RGB ≈ 680 / 550 / 440 nm。 */
  RAYLEIGH_SCATTERING: [5.802e-3, 13.558e-3, 33.1e-3] as const,
  /** 米氏散射系数（海平面）[1/km]。 */
  MIE_SCATTERING: 3.996e-3,
  /** 米氏消光系数（散射 + 吸收）[1/km]。 */
  MIE_EXTINCTION: 4.44e-3,
  /** 米氏相函数不对称因子 g。 */
  MIE_ANISOTROPY: 0.8,
  /** 臭氧吸收系数（层中心）[1/km]。 */
  OZONE_ABSORPTION: [0.65e-3, 1.881e-3, 0.085e-3] as const,
  /** 臭氧层中心高度与半宽 [km]（三角形分布）。 */
  OZONE_CENTER: 25,
  OZONE_HALF_WIDTH: 15,
  /** 云层高度 [km]（无厚度的球壳）。 */
  CLOUD_HEIGHT: 6,
} as const;

/** 透射率查找表的参数化：u ↔ 太阳天顶角余弦 μ，v ↔ 高度（平方根映射，近地面分辨率更高）。 */
export const TRANSMITTANCE_LUT = {
  WIDTH: 256,
  HEIGHT: 64,
  /** μ 的下界。80 km 高度处地平线对应 μ ≈ −0.157，取 −0.2 可覆盖全部被照亮的情况。 */
  MU_MIN: -0.2,
} as const;

/** 数值积分步数。步长 ≈ 0.6 km（天顶方向），相对米氏标高 1.2 km 的中点法误差约 1%。 */
const INTEGRATION_STEPS = 128;

/** 三种成分沿视线的"密度积分"[km]：瑞利、米氏、臭氧。光线被行星遮挡时返回 null。 */
export const densityIntegralsToSun = (
  heightKm: number,
  mu: number,
): { rayleigh: number; mie: number; ozone: number } | null => {
  const rp = ATMOSPHERE.PLANET_RADIUS;
  const ra = rp + ATMOSPHERE.TOP_HEIGHT;
  const r0 = rp + Math.max(0, heightKm);
  // 光线 r(t)² = r0² + 2·r0·μ·t + t²。若 μ < 0 且近心距 r0·√(1−μ²) < rp，则被行星遮挡。
  if (mu < 0 && r0 * r0 * (1 - mu * mu) < rp * rp) return null;
  if (r0 >= ra && mu >= 0) return { rayleigh: 0, mie: 0, ozone: 0 };

  const b = r0 * mu;
  const disc = b * b - r0 * r0 + ra * ra;
  if (disc <= 0) return { rayleigh: 0, mie: 0, ozone: 0 };
  const tExit = -b + Math.sqrt(disc);
  // 起点在大气层之上且朝下看时，先前进到进入大气层的位置。
  const tEnter = r0 > ra ? Math.max(0, -b - Math.sqrt(disc)) : 0;
  const dt = (tExit - tEnter) / INTEGRATION_STEPS;

  let rayleigh = 0;
  let mie = 0;
  let ozone = 0;
  for (let i = 0; i < INTEGRATION_STEPS; i++) {
    const t = tEnter + (i + 0.5) * dt;
    const h = Math.max(0, Math.sqrt(r0 * r0 + 2 * b * t + t * t) - rp);
    rayleigh += Math.exp(-h / ATMOSPHERE.RAYLEIGH_SCALE_HEIGHT);
    mie += Math.exp(-h / ATMOSPHERE.MIE_SCALE_HEIGHT);
    ozone += Math.max(0, 1 - Math.abs(h - ATMOSPHERE.OZONE_CENTER) / ATMOSPHERE.OZONE_HALF_WIDTH);
  }
  return { rayleigh: rayleigh * dt, mie: mie * dt, ozone: ozone * dt };
};

/**
 * 从高度 heightKm 处沿天顶角余弦为 mu 的方向看向太阳的大气透射率（RGB，0–1）。
 * 太阳被地球遮挡时为 (0, 0, 0)。
 */
export const sunTransmittance = (heightKm: number, mu: number): [number, number, number] => {
  const d = densityIntegralsToSun(heightKm, mu);
  if (!d) return [0, 0, 0];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const tau =
      (ATMOSPHERE.RAYLEIGH_SCATTERING[c] as number) * d.rayleigh +
      ATMOSPHERE.MIE_EXTINCTION * d.mie +
      (ATMOSPHERE.OZONE_ABSORPTION[c] as number) * d.ozone;
    out[c] = Math.exp(-tau);
  }
  return out;
};

/** 查找表坐标 → 物理参数。 */
export const lutMu = (u: number): number => TRANSMITTANCE_LUT.MU_MIN + u * (1 - TRANSMITTANCE_LUT.MU_MIN);
export const lutHeight = (v: number): number => ATMOSPHERE.TOP_HEIGHT * v * v;

/** 生成透射率查找表（RGBA，行优先，值域 0–1）。着色器用它代替逐像素的光线积分。 */
export const buildTransmittanceLutData = (): Float32Array => {
  const { WIDTH, HEIGHT } = TRANSMITTANCE_LUT;
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  for (let j = 0; j < HEIGHT; j++) {
    const h = lutHeight(j / (HEIGHT - 1));
    for (let i = 0; i < WIDTH; i++) {
      const [r, g, b] = sunTransmittance(h, lutMu(i / (WIDTH - 1)));
      const k = (j * WIDTH + i) * 4;
      data[k] = r;
      data[k + 1] = g;
      data[k + 2] = b;
      data[k + 3] = 1;
    }
  }
  return data;
};

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * 云层不透明度随相机高度的变化（细节层次策略，非物理）。
 * 云层是没有厚度的球壳；相机靠近或低于它时会穿帮，因此在 12–40 km 之间渐隐。
 */
export const cloudOpacityForAltitude = (cameraAltitudeM: number): number =>
  smoothstep(12_000, 40_000, cameraAltitudeM);

/**
 * 星空可见度（模拟人眼/相机曝光适应）：白天在稠密大气内看不到星星。
 * @param cameraAltitudeM 相机海拔 [m]
 * @param sunElevationSin 相机处太阳高度角的正弦
 */
export const starVisibility = (cameraAltitudeM: number, sunElevationSin: number): number => {
  const airAbove = Math.exp(-Math.max(0, cameraAltitudeM) / (ATMOSPHERE.RAYLEIGH_SCALE_HEIGHT * 1000));
  const daylight = smoothstep(-0.2, 0.05, sunElevationSin);
  return 1 - Math.min(1, airAbove * daylight * 1.6);
};
