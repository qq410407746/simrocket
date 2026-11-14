import { useMemo } from 'react';
import { DoubleSide, MeshStandardMaterial, Vector2 } from 'three';
import type { RocketMaterial, RocketPart, RocketSection } from './rocketLayout';

const RADIAL_SEGMENTS = 56;

export type RocketMaterials = Record<RocketMaterial, MeshStandardMaterial>;

export const createRocketMaterials = (): RocketMaterials => ({
  paint: new MeshStandardMaterial({ color: '#e8ebef', roughness: 0.48, metalness: 0.05, side: DoubleSide }),
  dark: new MeshStandardMaterial({ color: '#1d2127', roughness: 0.62, metalness: 0.15, side: DoubleSide }),
  accent: new MeshStandardMaterial({ color: '#ff8a3c', roughness: 0.5, metalness: 0.05, side: DoubleSide }),
  nozzle: new MeshStandardMaterial({ color: '#3a3c42', roughness: 0.45, metalness: 0.55, side: DoubleSide }),
  heatShield: new MeshStandardMaterial({ color: '#3b2a1f', roughness: 0.9, metalness: 0, side: DoubleSide }),
  metal: new MeshStandardMaterial({ color: '#8b929c', roughness: 0.4, metalness: 0.6, side: DoubleSide }),
  foil: new MeshStandardMaterial({ color: '#c9a04a', roughness: 0.35, metalness: 0.7, side: DoubleSide }),
  solar: new MeshStandardMaterial({ color: '#16284f', roughness: 0.3, metalness: 0.4, side: DoubleSide }),
});

function Part({ part, materials }: { part: RocketPart; materials: RocketMaterials }) {
  const points = useMemo(
    () => (part.kind === 'lathe' ? part.profile.map(([r, y]) => new Vector2(r, y)) : null),
    [part],
  );
  switch (part.kind) {
    case 'lathe': {
      const full = part.phiLength === undefined;
      return (
        <mesh material={materials[part.material]} castShadow receiveShadow>
          <latheGeometry
            args={[points ?? [], full ? RADIAL_SEGMENTS : RADIAL_SEGMENTS / 2, part.phiStart ?? 0, part.phiLength ?? Math.PI * 2]}
          />
        </mesh>
      );
    }
    case 'nozzle':
      return (
        <mesh position={[part.x, part.y + part.length / 2, part.z]} material={materials.nozzle} castShadow>
          <cylinderGeometry args={[part.throatRadius, part.exitRadius, part.length, 28, 1, true]} />
        </mesh>
      );
    case 'box':
      return (
        <mesh position={[...part.center]} material={materials[part.material]} castShadow>
          <boxGeometry args={[...part.size]} />
        </mesh>
      );
  }
}

/**
 * 火箭的一个分段（某一级、返回舱、卫星或整流罩半罩）。
 * 分段坐标：+Y 指向头部，y = 0 为分段底面，单位 m（与物理模型同一组尺寸）。
 */
export function RocketSectionMesh({ section, materials }: { section: RocketSection; materials: RocketMaterials }) {
  return (
    <>
      {section.parts.map((part, i) => (
        <Part key={i} part={part} materials={materials} />
      ))}
    </>
  );
}
