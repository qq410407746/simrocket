/**
 * 发射场地面补丁着色器。
 *
 * 行星着色器在近地面时受贴图分辨率限制（约 10 km/像素），因此在发射场周围叠加一块
 * 以发射场为原点建模的球冠网格（顶点坐标数值很小，没有精度问题），提供近景细节：
 * 程序化地表纹理、混凝土发射坪、导流槽与道路。
 * 光照、大气透视与色调映射与行星着色器使用同一组公式，边缘渐隐到行星表面。
 *
 * 局部坐标：x 东，y 天，z 南，单位 m。
 */
import { ATMOSPHERE_CHUNK } from './shaderChunks';

export const groundVertexShader = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;                       // 相机在原点，因此也是"相机到片元"的向量 [m]
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const groundFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2D;

varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vWorld;

uniform sampler2D uDayMap;
uniform sampler2D uWaterMap;
uniform vec2 uSiteUv;
uniform vec3 uSunDir;
uniform float uPixelAngle;
uniform float uPatchRadius;
uniform float uOpacity;
uniform float uPadRadius;       // 混凝土发射坪半径 [m]

${ATMOSPHERE_CHUNK}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// 某一尺度的细节在其波长小于约 2 个像素时淡出，避免远处闪烁。
float detailFade(float wavelength, float metresPerPixel) {
  return 1.0 - smoothstep(0.2, 0.6, metresPerPixel / wavelength);
}

void main() {
  vec2 xz = vLocal.xz;
  float dist = length(xz);
  float viewDist = length(vWorld);
  float mpp = viewDist * uPixelAngle;       // 每像素对应的地面尺度 [m]

  // 地表基色：地球贴图在发射场处的颜色与"陆地"色调混合。贴图分辨率约 10 km/纹素，
  // 滨海发射场所在纹素常常是海水颜色，因此按水域掩膜提高陆地色调的比例。
  vec3 texel = textureLod(uDayMap, uSiteUv, 0.0).rgb;
  float waterHere = textureLod(uWaterMap, uSiteUv, 0.0).r;
  float patchiness = valueNoise(xz / 1700.0 + 5.0);
  vec3 land = mix(vec3(0.075, 0.115, 0.050), vec3(0.200, 0.175, 0.115), smoothstep(0.45, 0.80, patchiness));
  vec3 base = mix(texel, land, 0.5 + 0.4 * waterHere);
  float n = (valueNoise(xz / 420.0) - 0.5) * 0.40;
  n += (valueNoise(xz / 61.0 + 17.0) - 0.5) * 0.24 * detailFade(61.0, mpp);
  n += (valueNoise(xz / 8.3 + 41.0) - 0.5) * 0.18 * detailFade(8.3, mpp);
  n += (valueNoise(xz / 1.1 + 73.0) - 0.5) * 0.12 * detailFade(1.1, mpp);
  vec3 albedo = base * (1.0 + n);

  float aa = max(mpp, 0.02);

  // 通往发射坪的道路（向南）
  float road = (1.0 - smoothstep(6.5 - aa, 6.5 + aa, abs(xz.x))) * step(0.0, xz.y) * (1.0 - smoothstep(2600.0, 3000.0, xz.y));
  albedo = mix(albedo, vec3(0.055, 0.056, 0.06) * (1.0 + 0.5 * n), road);

  // 混凝土发射坪：带分块缝
  float pad = 1.0 - smoothstep(uPadRadius - aa, uPadRadius + aa, dist);
  vec2 slab = abs(fract(xz / 7.5) - 0.5);
  float joint = (1.0 - smoothstep(0.0, 0.012 + aa / 7.5, min(slab.x, slab.y))) * detailFade(1.2, mpp);
  vec3 concrete = vec3(0.215, 0.215, 0.205) * (1.0 + 0.45 * n) * (1.0 - 0.4 * joint);
  albedo = mix(albedo, concrete, pad);

  // 导流槽（自火箭正下方向北延伸）
  float trench = (1.0 - smoothstep(4.5 - aa, 4.5 + aa, abs(xz.x)))
               * (1.0 - smoothstep(2.0 - aa, 2.0 + aa, xz.y))
               * smoothstep(-uPadRadius * 0.82 - aa, -uPadRadius * 0.82 + aa, xz.y);
  albedo = mix(albedo, vec3(0.035, 0.034, 0.033), trench * pad);

  // 光照：与行星着色器相同的漫反射 + 天空光模型
  vec3 nrm = normalize(vNormalW);
  float mu0 = dot(nrm, uSunDir);
  vec3 tSun = sunTransmittance(0.0, mu0);
  vec3 radiance = albedo / PI * uSunIntensity * (tSun * max(mu0, 0.0) + skyAmbient(mu0));

  // 大气透视：近地面水平路径上密度近似为常数时的解析积分
  vec3 viewDir = vWorld / max(viewDist, 1e-3);
  float cosSun = dot(viewDir, uSunDir);
  float dKm = viewDist / 1000.0;
  vec3 ext = BETA_R + vec3(BETA_M_EXT);
  vec3 tView = exp(-ext * dKm);
  vec3 source = phaseRayleigh(cosSun) * BETA_R + phaseMie(cosSun) * vec3(BETA_M);
  vec3 inscatter = uSunIntensity * tSun * source * (vec3(1.0) - tView) / ext;
  radiance = radiance * tView + inscatter;

  float edge = 1.0 - smoothstep(uPatchRadius * 0.55, uPatchRadius, dist);
  gl_FragColor = vec4(tonemap(radiance), edge * uOpacity);
  #include <colorspace_fragment>
}
`;
