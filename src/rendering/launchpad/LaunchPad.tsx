import { useMemo } from 'react';
import { MeshStandardMaterial } from 'three';

interface LaunchPadProps {
  /** 火箭总高度 [m]。 */
  vehicleHeight: number;
  /** 火箭最大半径 [m]。 */
  vehicleRadius: number;
}

/**
 * 发射工位：牵制释放支座、勤务塔、摆臂与避雷塔。
 * 尺寸随火箭自适应。局部坐标：x 东、y 天、z 南，原点在火箭底端正下方的地面。
 * （纯视觉模型；牵制释放的力学在阶段二由模拟器处理。）
 */
export function LaunchPad({ vehicleHeight, vehicleRadius }: LaunchPadProps) {
  const materials = useMemo(
    () => ({
      steel: new MeshStandardMaterial({ color: '#7f8894', roughness: 0.62, metalness: 0.35 }),
      dark: new MeshStandardMaterial({ color: '#2b3038', roughness: 0.7, metalness: 0.3 }),
      accent: new MeshStandardMaterial({ color: '#c2552f', roughness: 0.6, metalness: 0.2 }),
    }),
    [],
  );

  const towerHeight = vehicleHeight * 1.06;
  const towerWidth = Math.max(4.2, vehicleRadius * 2.4);
  const towerX = -(vehicleRadius + 4.5 + towerWidth / 2);
  const half = towerWidth / 2;
  const platformCount = Math.max(2, Math.floor(towerHeight / 7.5));
  const armHeights = [0.4, 0.68, 0.93].map((f) => f * vehicleHeight);
  const armStart = towerX + half;
  const armEnd = -(vehicleRadius + 0.35);
  const mastDistance = Math.max(38, vehicleHeight * 0.75);
  const mastHeight = vehicleHeight * 1.35;
  const clampHeight = Math.max(1.6, vehicleRadius * 1.1);

  return (
    <group>
      {/* 牵制释放支座 */}
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const r = vehicleRadius + 0.75;
        return (
          <mesh key={`clamp-${i}`} position={[r * Math.cos(a), clampHeight / 2, r * Math.sin(a)]} rotation={[0, -a, 0]} material={materials.dark} castShadow receiveShadow>
            <boxGeometry args={[1.1, clampHeight, 0.9]} />
          </mesh>
        );
      })}

      {/* 勤务塔：四根立柱 + 芯筒 + 分层平台 */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`col-${sx}-${sz}`} position={[towerX + sx * half, towerHeight / 2, sz * half]} material={materials.steel} castShadow receiveShadow>
            <boxGeometry args={[0.45, towerHeight, 0.45]} />
          </mesh>
        )),
      )}
      <mesh position={[towerX, towerHeight / 2, 0]} material={materials.dark} castShadow receiveShadow>
        <boxGeometry args={[towerWidth * 0.42, towerHeight, towerWidth * 0.42]} />
      </mesh>
      {Array.from({ length: platformCount }, (_, i) => (
        <mesh key={`platform-${i}`} position={[towerX, ((i + 1) / platformCount) * towerHeight, 0]} material={materials.steel} castShadow receiveShadow>
          <boxGeometry args={[towerWidth + 0.7, 0.22, towerWidth + 0.7]} />
        </mesh>
      ))}

      {/* 摆臂 */}
      {armHeights.map((y, i) => (
        <group key={`arm-${i}`}>
          <mesh position={[(armStart + armEnd) / 2, y, 0]} material={materials.steel} castShadow receiveShadow>
            <boxGeometry args={[armEnd - armStart, 0.6, 1.3]} />
          </mesh>
          <mesh position={[armEnd - 0.25, y, 0]} material={materials.accent} castShadow>
            <boxGeometry args={[0.5, 0.9, 1.6]} />
          </mesh>
        </group>
      ))}

      {/* 塔顶避雷针 */}
      <mesh position={[towerX, towerHeight + vehicleHeight * 0.1, 0]} material={materials.steel} castShadow>
        <cylinderGeometry args={[0.06, 0.16, vehicleHeight * 0.2, 8]} />
      </mesh>

      {/* 四角避雷塔 */}
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`mast-${sx}-${sz}`} position={[sx * mastDistance, mastHeight / 2, sz * mastDistance]} material={materials.steel} castShadow>
            <cylinderGeometry args={[0.12, 0.55, mastHeight, 10]} />
          </mesh>
        )),
      )}
    </group>
  );
}
