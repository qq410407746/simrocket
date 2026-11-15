/**
 * 行星着色器与地面着色器共用的 GLSL 片段。
 * 物理参数从 atmosphereModel.ts 注入，保证 CPU 侧（查找表、光照颜色）与 GPU 侧使用同一组数值。
 */
import { ATMOSPHERE, TRANSMITTANCE_LUT } from './atmosphereModel';

const f = (x: number): string => {
  const s = x.toExponential(6);
  return s.includes('.') ? s : s.replace('e', '.0e');
};
const v3 = (a: readonly [number, number, number]): string => `vec3(${f(a[0])}, ${f(a[1])}, ${f(a[2])})`;

/** 太阳辐照度的渲染标度（任意单位）与曝光：两者共同决定画面亮度。 */
export const SUN_INTENSITY = 20;
export const EXPOSURE = 0.55;

export const ATMOSPHERE_CHUNK = /* glsl */ `
#define PI 3.141592653589793

const float RP = ${f(ATMOSPHERE.PLANET_RADIUS)};                       // 行星半径 [km]
const float H_TOP = ${f(ATMOSPHERE.TOP_HEIGHT)};                       // 大气顶高度 [km]
const float H_RAYLEIGH = ${f(ATMOSPHERE.RAYLEIGH_SCALE_HEIGHT)};
const float H_MIE = ${f(ATMOSPHERE.MIE_SCALE_HEIGHT)};
const vec3 BETA_R = ${v3(ATMOSPHERE.RAYLEIGH_SCATTERING)};             // [1/km]
const float BETA_M = ${f(ATMOSPHERE.MIE_SCATTERING)};
const float BETA_M_EXT = ${f(ATMOSPHERE.MIE_EXTINCTION)};
const vec3 BETA_O = ${v3(ATMOSPHERE.OZONE_ABSORPTION)};
const float OZONE_CENTER = ${f(ATMOSPHERE.OZONE_CENTER)};
const float OZONE_HALF_WIDTH = ${f(ATMOSPHERE.OZONE_HALF_WIDTH)};
const float MIE_G = ${f(ATMOSPHERE.MIE_ANISOTROPY)};
const float H_CLOUD = ${f(ATMOSPHERE.CLOUD_HEIGHT)};
const float LUT_MU_MIN = ${f(TRANSMITTANCE_LUT.MU_MIN)};

uniform sampler2D uTransmittanceLut;
uniform float uSunIntensity;
uniform float uExposure;

// 从高度 h [km] 处、太阳天顶角余弦为 mu 的方向到太阳的透射率（查表）。
vec3 sunTransmittance(float h, float mu) {
  vec2 uv = vec2((mu - LUT_MU_MIN) / (1.0 - LUT_MU_MIN), sqrt(clamp(h / H_TOP, 0.0, 1.0)));
  return texture2D(uTransmittanceLut, clamp(uv, 0.0, 1.0)).rgb;
}

float phaseRayleigh(float c) {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

// Cornette–Shanks 相函数
float phaseMie(float c) {
  float g2 = MIE_G * MIE_G;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * c, 1.5));
}

// 天空漫射光对地面的照度近似（单次散射模型缺少的多次散射/天空光补偿），以 uSunIntensity 为单位。
vec3 skyAmbient(float mu0) {
  return vec3(0.040, 0.066, 0.115) * smoothstep(-0.12, 0.30, mu0);
}

// 曝光 + 指数色调映射（输入为线性辐亮度）。
vec3 tonemap(vec3 radiance) {
  return vec3(1.0) - exp(-radiance * uExposure);
}
`;
