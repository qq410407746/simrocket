import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { type Group, Quaternion, Vector3 } from 'three';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciOrientationToRender, eciToRenderRelative } from '../core/renderSpace';
import { RocketModel } from './RocketModel';

/** 模型坐标（+Y 为头部）→ 机体系（+X 为头部）：绕 Z 轴旋转 −90°。 */
const MODEL_TO_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);

/**
 * 把火箭模型放到物理状态给出的位置与姿态上。
 * 位置取"质心相对相机"的双精度差值；模型内部再下移质心高度，使模型质心与物理质心重合。
 */
export function VehicleView({ vehicle }: { vehicle: VehicleDefinition }) {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);

  useFrame(() => {
    const g = outer.current;
    if (!g || !inner.current) return;
    g.visible = frameState.valid;
    if (!frameState.valid) return;
    eciToRenderRelative(frameState.vehiclePosition, frameState.cameraPosition, g.position);
    eciOrientationToRender(frameState.vehicleAttitude, g.quaternion).multiply(MODEL_TO_BODY);
    inner.current.position.set(0, -frameState.centerOfMassHeight, 0);
  }, FRAME_PRIORITY.SCENE);

  return (
    <group ref={outer} visible={false}>
      <group ref={inner}>
        <RocketModel vehicle={vehicle} />
      </group>
    </group>
  );
}
