import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type Group,
  type LineSegments,
  type Mesh,
  type MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciOrientationToRender, eciToRenderRelative } from '../core/renderSpace';
import { canopyRadius } from './reentryVisuals';

/** 模型坐标（+Y 为头部）→ 机体系（+X 为头部）。 */
const MODEL_TO_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
/** 伞绳根数。 */
const LINE_COUNT = 12;
/** 伞绳长度相对该级伞衣张满半径的倍数。 */
const LINE_LENGTH_FACTOR = 1.7;

/**
 * 降落伞（视觉效果，由物理状态驱动）。
 * 伞衣的大小取自物理线程中当前的降落伞阻力面积，所以充气过程、减速伞到主伞的切换都与受力一致；
 * 伞被撕毁或尚未打开时不显示。伞沿机体纵轴系在舱顶上方——物理上返回舱此时被拉正为舱顶朝向来流反方向。
 */
export function Parachute({ vehicle }: { vehicle: VehicleDefinition }) {
  const group = useRef<Group>(null);
  const canopy = useRef<Mesh>(null);
  const lines = useRef<LineSegments>(null);
  const chute = vehicle.payload.kind === 'capsule' ? vehicle.payload.parachute : null;

  // 上半球壳（开口朝下）：半径 1，之后按伞衣半径缩放
  const canopyGeometry = useMemo(() => new SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), []);
  const lineGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(LINE_COUNT * 6), 3));
    return geometry;
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const snapshot = frameState.snapshot;
    const state = snapshot?.vehicle.parachute;
    const open = !!chute && !!state && frameState.valid && snapshot?.vehicle.phase === 'flight' && (state.phase === 'drogue' || state.phase === 'main');
    g.visible = open && state.dragArea > 0.01;
    if (!g.visible || !chute || !state) return;

    eciToRenderRelative(frameState.vehiclePosition, frameState.cameraPosition, g.position);
    eciOrientationToRender(frameState.vehicleAttitude, g.quaternion).multiply(MODEL_TO_BODY);

    const main = state.phase === 'main';
    const radius = canopyRadius(state.dragArea);
    const fullRadius = canopyRadius(main ? chute.mainDragArea : chute.drogueDragArea);
    const top = frameState.vehicleHeight - frameState.centerOfMassHeight;
    const rimHeight = top + LINE_LENGTH_FACTOR * fullRadius;
    if (canopy.current) {
      // 充气不足时伞衣又窄又高，张满后是扁半球
      const crown = radius * (0.55 + 0.6 * (1 - radius / Math.max(fullRadius, 1e-6)));
      canopy.current.scale.set(radius, crown, radius);
      canopy.current.position.set(0, rimHeight, 0);
      (canopy.current.material as MeshStandardMaterial).color.set(main ? '#f3efe6' : '#ff8a3c');
    }
    if (lines.current) {
      const positions = lineGeometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < LINE_COUNT; i++) {
        const angle = (i / LINE_COUNT) * Math.PI * 2;
        positions.setXYZ(i * 2, 0, top, 0);
        positions.setXYZ(i * 2 + 1, Math.cos(angle) * radius, rimHeight, Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
    }
  }, FRAME_PRIORITY.SCENE + 2);

  if (!chute) return null;
  return (
    <group ref={group} visible={false}>
      <mesh ref={canopy} geometry={canopyGeometry} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#f3efe6" roughness={0.85} metalness={0} side={DoubleSide} />
      </mesh>
      <lineSegments ref={lines} geometry={lineGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#c8ccd2" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}
