import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, ShaderMaterial } from 'three';
import { dot, normalize } from '@/game/physics/math/vec3';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { starVisibility } from '../earth/atmosphereModel';

const STAR_COUNT = 7000;

/** 确定性伪随机数（mulberry32），保证每次运行星空一致。 */
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * 程序化星空（非真实星表——真实恒星位置在路线图中）。
 * 星等服从幂律分布（暗星远多于亮星），一部分恒星集中在一条倾斜的带上以模拟银河。
 * 恒星固定在惯性系中：地球自转时它们相对地面移动，相对轨道不动。
 */
const buildStars = () => {
  const rand = mulberry32(20260412);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);

  // 银道面法向（渲染空间中的一个倾斜方向）。
  const pole = [0.45, 0.47, 0.76];
  const poleLen = Math.hypot(pole[0]!, pole[1]!, pole[2]!);
  const px = pole[0]! / poleLen;
  const py = pole[1]! / poleLen;
  const pz = pole[2]! / poleLen;

  for (let i = 0; i < STAR_COUNT; i++) {
    // 球面均匀分布
    let z = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const rxy = Math.sqrt(1 - z * z);
    let x = rxy * Math.cos(phi);
    let y = rxy * Math.sin(phi);

    if (rand() < 0.45) {
      // 银河带：把点沿银极方向压扁后重新归一化
      const d = x * px + y * py + z * pz;
      const squash = 0.82 + 0.15 * rand();
      x -= px * d * squash;
      y -= py * d * squash;
      z -= pz * d * squash;
      const len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // 亮度：幂律分布
    const brightness = Math.pow(rand(), 5.5);
    sizes[i] = 0.9 + brightness * 2.8;
    const intensity = 0.28 + brightness * 0.9;

    // 颜色：按色温在橙—白—蓝之间取值
    const temp = rand();
    const r = temp < 0.5 ? 1.0 : 1.0 - (temp - 0.5) * 0.55;
    const g = temp < 0.5 ? 0.78 + temp * 0.44 : 1.0 - (temp - 0.5) * 0.25;
    const b = temp < 0.5 ? 0.55 + temp * 0.9 : 1.0;
    colors[i * 3] = r * intensity;
    colors[i * 3 + 1] = g * intensity;
    colors[i * 3 + 2] = b * intensity;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('size', new Float32BufferAttribute(sizes, 1));
  return geometry;
};

const vertexShader = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uPixelRatio;
void main() {
  vColor = color;
  // 只应用相机旋转：恒星在无穷远处。z 固定在深度范围中部，不受近/远裁剪面影响。
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, 0.0, clip.w);
  gl_PointSize = size * uPixelRatio;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
varying vec3 vColor;
uniform float uVisibility;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float falloff = smoothstep(1.0, 0.0, dot(p, p));
  gl_FragColor = vec4(vColor * falloff * falloff * uVisibility, 1.0);
  #include <colorspace_fragment>
}
`;

export function Starfield() {
  const geometry = useMemo(buildStars, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uVisibility: { value: 1 }, uPixelRatio: { value: 1 } },
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  useFrame(({ gl }) => {
    material.uniforms.uPixelRatio!.value = gl.getPixelRatio();
    if (!frameState.valid) return;
    const sunElevationSin = dot(normalize(frameState.cameraPosition), frameState.sunDirection);
    material.uniforms.uVisibility!.value = starVisibility(frameState.cameraAltitude, sunElevationSin);
  }, FRAME_PRIORITY.SCENE);

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-30} />;
}
