import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { getLaunchSiteOrDefault } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { vehicleHeight } from '@/game/vehicles/analysis';
import { type GraphicsQuality, useGameStore } from '@/stores/gameStore';
import { CameraRig } from './cameras/CameraRig';
import { FrameDriver } from './core/FrameDriver';
import { PerfProbe } from './core/PerfProbe';
import { Planet } from './earth/Planet';
import { LaunchSite } from './launchpad/LaunchSite';
import { OrbitMap } from './orbital-map/OrbitMap';
import { VehicleMarker } from './rockets/VehicleMarker';
import { VehicleAssembly } from './rockets/VehicleAssembly';
import { SceneLighting } from './sky/SceneLighting';
import { Starfield } from './sky/Starfield';

/** 各画质档位的最大设备像素比。 */
const MAX_DPR: Record<GraphicsQuality, number> = { low: 1, medium: 1.5, high: 2 };

/**
 * 三维场景根组件。
 *
 * 绘制顺序：星空 → 行星（解析着色器，不写深度）→ 近景对象（常规深度缓冲）。
 * 每帧执行顺序：FrameDriver（采样物理状态）→ CameraRig（相机位姿）→ 各对象定位。
 */
export function SceneRoot() {
  const quality = useGameStore((s) => s.quality);
  const vehicle = getVehicleOrDefault(useGameStore((s) => s.vehicleId));
  const site = getLaunchSiteOrDefault(useGameStore((s) => s.siteId));
  const shadows = quality !== 'low';

  return (
    <Canvas
      // 画质切换会改变抗锯齿等只能在创建时指定的上下文参数，因此重建画布。
      key={quality}
      className="!absolute inset-0"
      dpr={[1, MAX_DPR[quality]]}
      shadows={shadows ? 'percentage' : false}
      gl={{ antialias: quality !== 'low', alpha: false, stencil: false, powerPreference: 'high-performance' }}
      camera={{ fov: 45, near: 0.5, far: 1e7, position: [0, 0, 0] }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 1)}
    >
      <FrameDriver />
      <CameraRig />
      <Starfield />
      <Suspense fallback={null}>
        <Planet />
        <SceneLighting shadows={shadows} shadowExtent={Math.max(70, vehicleHeight(vehicle) * 1.4)} />
        <LaunchSite site={site} vehicle={vehicle} shadows={shadows} />
        <VehicleAssembly vehicle={vehicle} />
        <VehicleMarker />
      </Suspense>
      <OrbitMap />
      <PerfProbe />
    </Canvas>
  );
}
