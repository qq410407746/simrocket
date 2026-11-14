import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, ShadowMaterial } from 'three';
import type { LaunchSite as LaunchSiteData } from '@/data/launchSites';
import { DEG2RAD } from '@/game/physics/constants';
import { enuBasisAt } from '@/game/physics/frames/frames';
import { fromBasis } from '@/game/physics/math/quat';
import { dot, negate } from '@/game/physics/math/vec3';
import { vehicleHeight, vehicleMaxDiameter } from '@/game/vehicles/analysis';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciOrientationToRender, eciToRenderRelative } from '../core/renderSpace';
import { GroundPatch } from './GroundPatch';
import { LaunchPad } from './LaunchPad';

interface LaunchSiteProps {
  site: LaunchSiteData;
  vehicle: VehicleDefinition;
  shadows: boolean;
}

/**
 * 发射场：地面补丁 + 发射工位，固定在地固系中（随地球自转）。
 * 局部坐标（x 东、y 天、z 南）到渲染空间的变换每帧由地球自转角算出。
 */
export function LaunchSite({ site, vehicle, shadows }: LaunchSiteProps) {
  const group = useRef<Group>(null);
  const shadowMaterial = useRef<ShadowMaterial>(null);
  const height = vehicleHeight(vehicle);
  const radius = vehicleMaxDiameter(vehicle) / 2;
  const padRadius = Math.max(45, height * 1.1);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.visible = frameState.valid;
    if (!frameState.valid) return;
    const sitePos = frameState.sitePosition;
    const { east, north, up } = enuBasisAt(sitePos);
    eciToRenderRelative(sitePos, frameState.cameraPosition, g.position);
    eciOrientationToRender(fromBasis(east, up, negate(north)), g.quaternion);
    // 影子的浓度随太阳高度变化；太阳落到地平线下后没有直射光，也就没有影子。
    if (shadowMaterial.current) {
      const sunElevationSin = dot(up, frameState.sunDirection);
      shadowMaterial.current.opacity = 0.6 * Math.min(1, Math.max(0, sunElevationSin * 6));
    }
  }, FRAME_PRIORITY.SCENE);

  return (
    <group ref={group} visible={false}>
      <GroundPatch latitude={site.latitudeDeg * DEG2RAD} longitude={site.longitudeDeg * DEG2RAD} padRadius={padRadius} />
      {shadows && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow renderOrder={2}>
          <circleGeometry args={[Math.max(220, height * 4), 48]} />
          <shadowMaterial ref={shadowMaterial} transparent opacity={0.6} depthWrite={false} />
        </mesh>
      )}
      <LaunchPad vehicleHeight={height} vehicleRadius={radius} />
    </group>
  );
}
