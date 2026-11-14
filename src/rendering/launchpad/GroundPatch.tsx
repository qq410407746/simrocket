import { useFrame } from '@react-three/fiber';
import { useMemo } from 'react';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, ShaderMaterial, Vector2, Vector3 } from 'three';
import { EARTH } from '@/game/physics/constants';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciToRender } from '../core/renderSpace';
import { getTransmittanceLut, useEarthTextures } from '../earth/earthTextures';
import { groundFragmentShader, groundVertexShader } from '../earth/groundShader';
import { EXPOSURE, SUN_INTENSITY } from '../earth/shaderChunks';

/** 地面补丁半径 [m]。 */
export const PATCH_RADIUS = 9000;
const RINGS = 56;
const SEGMENTS = 128;

/**
 * 以发射场为原点的球冠网格（局部坐标：x 东、y 天、z 南）。
 * 顶点坐标在 CPU 上用双精度按球面公式计算，量级只有几千米，float32 精度约 1 mm。
 * 环间距向外按幂律增大：发射台附近网格最密。
 */
const buildPatchGeometry = (): BufferGeometry => {
  const R = EARTH.RADIUS;
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 1, 0];
  for (let k = 1; k <= RINGS; k++) {
    const arc = PATCH_RADIUS * Math.pow(k / RINGS, 2.4);
    const alpha = arc / R;
    const horizontal = R * Math.sin(alpha);
    const drop = -2 * R * Math.sin(alpha / 2) ** 2; // R(cos α − 1)，小角度下数值稳定
    for (let j = 0; j < SEGMENTS; j++) {
      const phi = (j / SEGMENTS) * Math.PI * 2; // 自北向东的方位角
      const sx = Math.sin(phi);
      const cz = -Math.cos(phi);
      positions.push(horizontal * sx, drop, horizontal * cz);
      normals.push(Math.sin(alpha) * sx, Math.cos(alpha), Math.sin(alpha) * cz);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) indices.push(0, 1 + ((j + 1) % SEGMENTS), 1 + j);
  for (let k = 1; k < RINGS; k++) {
    const inner = 1 + (k - 1) * SEGMENTS;
    const outer = 1 + k * SEGMENTS;
    for (let j = 0; j < SEGMENTS; j++) {
      const j1 = (j + 1) % SEGMENTS;
      indices.push(inner + j, inner + j1, outer + j, inner + j1, outer + j1, outer + j);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface GroundPatchProps {
  /** 发射场纬度、经度 [rad]。 */
  latitude: number;
  longitude: number;
  /** 混凝土发射坪半径 [m]。 */
  padRadius: number;
}

export function GroundPatch({ latitude, longitude, padRadius }: GroundPatchProps) {
  const textures = useEarthTextures();
  const geometry = useMemo(buildPatchGeometry, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: groundVertexShader,
        fragmentShader: groundFragmentShader,
        uniforms: {
          uDayMap: { value: textures.day },
          uWaterMap: { value: textures.water },
          uSiteUv: { value: new Vector2(0.5, 0.5) },
          uSunDir: { value: new Vector3(0, 1, 0) },
          uPixelAngle: { value: 0.001 },
          uPatchRadius: { value: PATCH_RADIUS },
          uOpacity: { value: 1 },
          uPadRadius: { value: 60 },
          uTransmittanceLut: { value: getTransmittanceLut() },
          uSunIntensity: { value: SUN_INTENSITY },
          uExposure: { value: EXPOSURE },
        },
        transparent: true,
        side: DoubleSide,
      }),
    [textures],
  );

  useFrame(() => {
    const u = material.uniforms;
    (u.uSiteUv!.value as Vector2).set(longitude / (2 * Math.PI) + 0.5, latitude / Math.PI + 0.5);
    u.uPadRadius!.value = padRadius;
    if (!frameState.valid) return;
    eciToRender(frameState.sunDirection, u.uSunDir!.value as Vector3);
    u.uPixelAngle!.value = frameState.pixelAngle;
    // 高空时补丁退出，交给行星着色器（补丁的基色是常数，从高处看会像一块色斑）。
    u.uOpacity!.value = 1 - smoothstep(12_000, 40_000, frameState.cameraAltitude);
  }, FRAME_PRIORITY.SCENE);

  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}
