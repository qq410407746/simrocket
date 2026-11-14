import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, type Group, type PointLight, ShaderMaterial } from 'three';
import { SEA_LEVEL } from '@/game/physics/constants';
import type { EngineDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY } from '../core/frameState';
import type { PlumeExit } from './rocketLayout';

/**
 * 发动机尾焰（视觉效果，由物理状态驱动）。
 *
 * 输入只有两个物理量：推力水平（实际推力 / 真空额定推力）与环境压力。
 *  - 推力为 0 时完全不显示；
 *  - 环境压力越低，羽流越膨胀、越长、越稀薄（真空中欠膨胀羽流的定性特征）。
 * 这是基于经验的外观模型，不是羽流流场计算。
 */

const PLUME_COLORS: Record<EngineDefinition['propellant'], { core: string; edge: string; opacity: number }> = {
  // 煤油/液氧：富含碳烟，明亮的黄橙色
  kerolox: { core: '#fff3d0', edge: '#ff7a1a', opacity: 1 },
  // 氢氧：几乎透明的淡蓝色
  hydrolox: { core: '#e9f4ff', edge: '#5aa2ff', opacity: 0.45 },
  // 自燃推进剂：较暗的橙色
  hypergolic: { core: '#ffe9c8', edge: '#ff9a4a', opacity: 0.6 },
};

const vertexShader = /* glsl */ `
uniform float uSpread;
varying float vAlong;   // 0 喷口 → 1 尾端
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vAlong = 0.5 - position.y;                        // 几何体沿 Y 取 [−0.5, 0.5]，喷口在上
  vec3 p = position;
  // 羽流沿程扩张：半径 = 1 + uSpread·s^0.7
  float widen = 1.0 + uSpread * pow(vAlong, 0.7);
  p.xz *= widen;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uIntensity;
uniform float uTime;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewDir;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  // 视线与羽流表面越垂直（看穿中心）越亮：近似沿视线的光学厚度
  float facing = abs(dot(normalize(vNormalV), vViewDir));
  float body = pow(facing, 1.6);
  float fade = pow(1.0 - vAlong, 1.5) * smoothstep(0.0, 0.04, vAlong + 0.02);
  // 沿程的明暗起伏随时间向后流动（马赫盘/湍流的示意）
  float flicker = 0.85 + 0.15 * sin(vAlong * 34.0 - uTime * 42.0) * (0.6 + 0.4 * hash(floor(uTime * 30.0)));
  vec3 color = mix(uEdge, uCore, clamp(body * (1.0 - vAlong * 0.8), 0.0, 1.0));
  float alpha = body * fade * flicker * uIntensity;
  gl_FragColor = vec4(color * alpha, alpha);
  #include <colorspace_fragment>
}
`;

interface EnginePlumeProps {
  exits: readonly PlumeExit[];
  propellant: EngineDefinition['propellant'];
  /**
   * 每帧调用，返回当前的推力水平（0–1，相对真空额定推力）与环境压力 [Pa]。
   * 返回 null 表示该推进单元当前不是工作单元。
   */
  sample: () => { level: number; ambientPressure: number } | null;
}

export function EnginePlume({ exits, propellant, sample }: EnginePlumeProps) {
  const group = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  const palette = PLUME_COLORS[propellant];

  // 单位几何体：半径 1、长度 1，喷口端在 y = +0.5；按喷口尺寸缩放。
  const geometry = useMemo(() => new CylinderGeometry(1, 1, 1, 24, 12, true), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uCore: { value: new Color(palette.core) },
          uEdge: { value: new Color(palette.edge) },
          uIntensity: { value: 0 },
          uSpread: { value: 0.3 },
          uTime: { value: 0 },
        },
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [palette],
  );

  const meanRadius = exits.reduce((sum, e) => sum + e.radius, 0) / Math.max(1, exits.length);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const state = sample();
    const level = state ? Math.min(1, Math.max(0, state.level)) : 0;
    g.visible = level > 0.001;
    if (light.current) light.current.intensity = 0;
    if (!g.visible || !state) return;

    // 真空度：0 = 海平面，1 = 真空
    const vacuum = 1 - Math.min(1, Math.max(0, state.ambientPressure / SEA_LEVEL.PRESSURE));
    const length = (9 + 14 * vacuum) * (0.45 + 0.55 * level);
    const u = material.uniforms;
    u.uIntensity!.value = palette.opacity * (0.55 + 0.45 * level) * (1 - 0.55 * vacuum);
    u.uSpread!.value = 0.25 + 3.2 * vacuum;
    u.uTime!.value = clock.elapsedTime;
    for (let i = 0; i < g.children.length; i++) {
      const exit = exits[i];
      const mesh = g.children[i];
      if (!exit || !mesh || mesh === light.current) continue;
      const len = length * exit.radius;
      mesh.scale.set(exit.radius * 0.92, len, exit.radius * 0.92);
      mesh.position.set(exit.x, exit.y - len / 2, exit.z);
    }
    if (light.current) {
      // 尾焰对周围物体的照明：亮度随推力水平与发动机数量增加
      light.current.intensity = level * (1 - 0.7 * vacuum) * 900 * meanRadius * meanRadius * exits.length * palette.opacity;
      light.current.position.set(0, -meanRadius * 5, 0);
    }
  }, FRAME_PRIORITY.SCENE + 1);

  return (
    <group ref={group} visible={false}>
      {exits.map((_, i) => (
        <mesh key={i} geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
      ))}
      <pointLight ref={light} color={palette.edge} intensity={0} distance={600} decay={2} />
    </group>
  );
}
