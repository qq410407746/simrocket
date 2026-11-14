import { useMemo } from 'react';
import { DoubleSide, MeshStandardMaterial, Vector2 } from 'three';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { type RocketMaterial, type RocketPart, buildRocketLayout } from './rocketLayout';

const RADIAL_SEGMENTS = 56;

const createMaterials = (): Record<RocketMaterial, MeshStandardMaterial> => ({
  paint: new MeshStandardMaterial({ color: '#e8ebef', roughness: 0.48, metalness: 0.05, side: DoubleSide }),
  dark: new MeshStandardMaterial({ color: '#1d2127', roughness: 0.62, metalness: 0.15, side: DoubleSide }),
  accent: new MeshStandardMaterial({ color: '#ff8a3c', roughness: 0.5, metalness: 0.05, side: DoubleSide }),
  nozzle: new MeshStandardMaterial({ color: '#3a3c42', roughness: 0.45, metalness: 0.55, side: DoubleSide }),
  heatShield: new MeshStandardMaterial({ color: '#3b2a1f', roughness: 0.9, metalness: 0, side: DoubleSide }),
  metal: new MeshStandardMaterial({ color: '#8b929c', roughness: 0.4, metalness: 0.6, side: DoubleSide }),
});

function Part({ part, materials }: { part: RocketPart; materials: Record<RocketMaterial, MeshStandardMaterial> }) {
  const points = useMemo(
    () => (part.kind === 'lathe' ? part.profile.map(([r, y]) => new Vector2(r, y)) : null),
    [part],
  );
  switch (part.kind) {
    case 'lathe':
      return (
        <mesh material={materials[part.material]} castShadow receiveShadow>
          <latheGeometry args={[points ?? [], RADIAL_SEGMENTS]} />
        </mesh>
      );
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
 * 根据飞行器定义程序化生成的火箭模型。
 * 模型坐标：+Y 指向头部，y = 0 为底端，单位 m（与物理模型同一组尺寸）。
 */
export function RocketModel({ vehicle }: { vehicle: VehicleDefinition }) {
  const layout = useMemo(() => buildRocketLayout(vehicle), [vehicle]);
  const materials = useMemo(createMaterials, []);
  return (
    <group>
      {layout.sections.map((section) => (
        <group key={section.id} position={[0, section.baseY, 0]}>
          {section.parts.map((part, i) => (
            <Part key={i} part={part} materials={materials} />
          ))}
        </group>
      ))}
    </group>
  );
}
