/**
 * 行星着色器：在一个全屏三角形上，对每个像素做"视线–球体"解析求交，
 * 一次性完成地表、云层、昼夜、海面高光与大气散射的着色。
 *
 * 为什么不用球体网格？
 *  - 网格顶点在 6371 km 量级上只有约 0.5 m 的 float32 精度，贴近地面时会明显抖动；
 *  - 网格是多边形近似，地平线/大气边缘在近距离下不是光滑圆弧；
 *  - 需要处理 0.1 m–10⁸ m 的深度范围。
 * 解析求交把所有大数相减放到 CPU 上用双精度完成（见 uCSurf / uCAtmo），
 * 着色器内只使用数值稳定的求根公式，因此从发射台到地球同步轨道都没有抖动与接缝。
 *
 * 长度单位：km。坐标系：渲染空间（相机在原点）。
 */
import { ATMOSPHERE_CHUNK } from './shaderChunks';

export const planetVertexShader = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const buildPlanetFragmentShader = (viewSteps: number): string => /* glsl */ `
precision highp float;
precision highp sampler2D;

#define VIEW_STEPS ${Math.max(4, Math.floor(viewSteps))}

varying vec2 vNdc;

uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uPixelAngle;      // 每像素对应的视角 [rad]
uniform float uPrincipalOffsetY; // 画面主点的竖直偏移（NDC）：相机正前方投影到屏幕上的位置
uniform float uNear;            // 相机近、远裁剪面 [m]，用于输出与网格对象一致的深度
uniform float uFar;

uniform vec3 uCamPos;           // 相机相对地心的位置 [km]
uniform float uCSurf;           // |cam|² − R_地表² [km²]（CPU 双精度计算）
uniform float uCCloud;          // |cam|² − R_云层²
uniform float uCAtmo;           // |cam|² − R_大气顶²
uniform vec3 uSunDir;
uniform mat3 uRenderToEcef;

uniform sampler2D uDayMap;
uniform sampler2D uNightMap;
uniform sampler2D uWaterMap;
uniform sampler2D uCloudMap;
uniform vec4 uTexelKm;          // 各贴图在赤道处每个纹素对应的地面距离 [km]：day, night, water, cloud

uniform float uCloudOpacity;
uniform float uCloudShift;      // 云层相对地表的经度漂移（圈）

${ATMOSPHERE_CHUNK}

// 解 t² + 2bt + c = 0（b = o·d，c = |o|² − R²）。返回 (t近, t远)；无交点时返回 (1, −1)。
// 使用 q = −(b + sign(b)·√Δ) 形式，避免两个相近大数相减造成的精度损失。
vec2 raySphere(float b, float c) {
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(disc);
  float q = b >= 0.0 ? -b - s : -b + s;
  if (q == 0.0) return vec2(0.0, 0.0);
  float t0 = q;
  float t1 = c / q;
  return t0 < t1 ? vec2(t0, t1) : vec2(t1, t0);
}

// 地固系单位方向 → 等距圆柱投影纹理坐标。
vec2 equirectUv(vec3 e) {
  return vec2(atan(e.y, e.x) / (2.0 * PI) + 0.5, asin(clamp(e.z, -1.0, 1.0)) / PI + 0.5);
}

// 由像素在地面上的覆盖尺寸直接计算 mip 级别。
// 不使用屏幕空间导数：等距圆柱投影在 ±180° 经线处不连续，导数会在那里产生一条接缝。
float lodFor(float footprintKm, float texelKm) {
  return log2(max(footprintKm / texelKm, 1e-4));
}

// ∫ exp(−h/H) 在一段路径上的平均值，假设 h 沿路径线性变化：
//   (e_A − e_B) / k ，其中 e = exp(−h/H)，k = (h_B − h_A)/H ；k → 0 时退化为 e_A。
float expSegment(float eA, float eB, float k) {
  return abs(k) < 1e-3 ? eA : (eA - eB) / k;
}

float ozoneDensity(float h) {
  return max(0.0, 1.0 - abs(h - OZONE_CENTER) / OZONE_HALF_WIDTH);
}

float cloudDensity(vec3 ecefDir, float footprintKm) {
  vec2 uv = equirectUv(ecefDir);
  uv.x += uCloudShift;
  float c = textureLod(uCloudMap, uv, lodFor(footprintKm, uTexelKm.w)).r;
  return smoothstep(0.06, 0.80, c);
}

void main() {
  vec3 d = normalize(
    uCamFwd + (vNdc.x * uAspect * uTanHalfFov) * uCamRight + ((vNdc.y - uPrincipalOffsetY) * uTanHalfFov) * uCamUp
  );
  float b = dot(uCamPos, d);
  float cosSun = dot(d, uSunDir);

  vec2 tAtmo = raySphere(b, uCAtmo);
  vec2 tSurf = raySphere(b, uCSurf);
  bool hitSurface = tSurf.y > 0.0;
  float tSurface = max(tSurf.x, 0.0);

  // ── 大气：沿视线积分单次散射 ───────────────────────────────────────────
  vec3 inscatter = vec3(0.0);
  vec3 viewT = vec3(1.0);
  if (tAtmo.y > 0.0) {
    float t0 = max(tAtmo.x, 0.0);
    float t1 = hitSurface ? tSurface : tAtmo.y;
    float ds = (t1 - t0) / float(VIEW_STEPS);
    vec3 od = vec3(0.0);        // 瑞利、米氏、臭氧的密度积分 [km]
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    float hA = max(length(uCamPos + d * t0) - RP, 0.0);
    vec2 eA = exp(-hA / vec2(H_RAYLEIGH, H_MIE));
    for (int i = 0; i < VIEW_STEPS; i++) {
      float tA = t0 + ds * float(i);
      float hB = max(length(uCamPos + d * (tA + ds)) - RP, 0.0);
      vec2 eB = exp(-hB / vec2(H_RAYLEIGH, H_MIE));
      // 每一段内按"高度随路径线性变化"解析积分指数密度（见 expSegment），
      // 比中点采样准确得多，也不需要用抖动来掩盖条带。
      vec2 k = (hB - hA) / vec2(H_RAYLEIGH, H_MIE);
      vec3 seg = ds * vec3(
        expSegment(eA.x, eB.x, k.x),
        expSegment(eA.y, eB.y, k.y),
        0.5 * (ozoneDensity(hA) + ozoneDensity(hB))
      );
      // 光源项（太阳透射率 × 视线透射率）变化平缓，在段中点取值。
      vec3 pm = uCamPos + d * (tA + 0.5 * ds);
      float rm = length(pm);
      vec3 tSun = sunTransmittance(max(rm - RP, 0.0), dot(pm, uSunDir) / rm);
      vec3 odMid = od + 0.5 * seg;
      vec3 tView = exp(-(BETA_R * odMid.x + BETA_M_EXT * odMid.y + BETA_O * odMid.z));
      sumR += seg.x * tSun * tView;
      sumM += seg.y * tSun * tView;
      od += seg;
      hA = hB;
      eA = eB;
    }
    viewT = exp(-(BETA_R * od.x + BETA_M_EXT * od.y + BETA_O * od.z));
    inscatter = uSunIntensity * (phaseRayleigh(cosSun) * BETA_R * sumR + phaseMie(cosSun) * BETA_M * sumM);
  }

  vec3 radiance;
  float alpha;

  if (hitSurface) {
    // ── 地表 ───────────────────────────────────────────────────────────
    vec3 p = uCamPos + d * tSurface;
    vec3 n = normalize(p);
    vec3 e = uRenderToEcef * n;
    vec2 uv = equirectUv(e);
    float cosView = max(dot(n, -d), 0.04);
    float footprint = tSurface * uPixelAngle / sqrt(cosView);

    vec3 albedo = textureLod(uDayMap, uv, lodFor(footprint, uTexelKm.x)).rgb;
    float water = textureLod(uWaterMap, uv, lodFor(footprint, uTexelKm.z)).r;
    float mu0 = dot(n, uSunDir);
    vec3 tSun = sunTransmittance(0.0, mu0);

    // 云在地面上的影子：从地面点沿太阳方向走到云层高度处采样。
    float shadow = 1.0;
    if (uCloudOpacity > 0.0 && mu0 > 0.0) {
      vec3 ps = p + uSunDir * (H_CLOUD / max(mu0, 0.12));
      shadow = 1.0 - 0.65 * uCloudOpacity * cloudDensity(uRenderToEcef * normalize(ps), footprint);
    }

    vec3 direct = tSun * max(mu0, 0.0) * shadow;
    vec3 surface = albedo / PI * uSunIntensity * (direct + skyAmbient(mu0));

    // 海面太阳耀斑（Blinn–Phong + Schlick 菲涅耳）
    vec3 halfVec = normalize(uSunDir - d);
    float nh = max(dot(n, halfVec), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-d, halfVec), 0.0), 5.0);
    surface += uSunIntensity * direct * water * fresnel * pow(nh, 420.0) * 5.0;

    // 夜面城市灯光
    vec3 night = textureLod(uNightMap, uv, lodFor(footprint, uTexelKm.y)).rgb;
    float lum = max(max(night.r, night.g), night.b);
    float nightSide = 1.0 - smoothstep(-0.18, 0.02, mu0);
    vec3 cityLights = night * smoothstep(0.03, 0.30, lum) * 1.8 * nightSide;

    // 云层（位于地表之上 H_CLOUD 的球壳；仅当相机在云层之上时绘制）
    float cloudAlpha = 0.0;
    vec3 cloudColor = vec3(0.0);
    if (uCloudOpacity > 0.0 && uCCloud > 0.0) {
      vec2 tCloud = raySphere(b, uCCloud);
      if (tCloud.y > 0.0 && tCloud.x > 0.0) {
        vec3 pc = uCamPos + d * tCloud.x;
        vec3 nc = normalize(pc);
        float muC = dot(nc, uSunDir);
        cloudAlpha = cloudDensity(uRenderToEcef * nc, footprint) * uCloudOpacity;
        vec3 cloudLight = sunTransmittance(H_CLOUD, muC) * (0.12 + 0.88 * max(muC, 0.0)) + skyAmbient(muC);
        cloudColor = vec3(0.86) / PI * uSunIntensity * cloudLight;
      }
    }

    surface = mix(surface + cityLights * (1.0 - 0.85 * cloudAlpha), cloudColor, cloudAlpha);
    radiance = surface * viewT + inscatter;
    alpha = 1.0;
  } else {
    // ── 天空 / 太空 ─────────────────────────────────────────────────────
    // 太阳圆面（角半径 0.267°）与光晕。小角度下用 sin 而非 cos 判定，float32 精度更好。
    float sinSun = length(cross(d, uSunDir));
    float disc = cosSun > 0.0 ? 1.0 - smoothstep(0.0042, 0.0051, sinSun) : 0.0;
    float glare = 0.30 * pow(max(cosSun, 0.0), 1800.0) + 0.012 * pow(max(cosSun, 0.0), 90.0);
    radiance = inscatter + viewT * uSunIntensity * (disc * 40.0 + glare * 4.0);
    alpha = 1.0 - dot(viewT, vec3(1.0 / 3.0));
  }

  // 深度：地表像素输出与透视投影一致的深度值，供轨道地图中的轨道曲线做遮挡测试
  // （只有在轨道地图模式下材质才开启深度写入）。非地表像素位于远裁剪面。
  float depth = 1.0;
  if (hitSurface) {
    float viewZ = max(tSurface * 1000.0 * dot(d, uCamFwd), uNear);
    float ndcZ = (uFar + uNear) / (uFar - uNear) - (2.0 * uFar * uNear) / ((uFar - uNear) * viewZ);
    depth = clamp(0.5 * ndcZ + 0.5, 0.0, 1.0);
  }
  gl_FragDepth = depth;

  gl_FragColor = vec4(tonemap(radiance), alpha);
  #include <colorspace_fragment>
}
`;
