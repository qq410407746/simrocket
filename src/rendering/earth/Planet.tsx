import { useFrame, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Matrix3,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three';
import { EARTH } from '@/game/physics/constants';
import { length } from '@/game/physics/math/vec3';
import { type GraphicsQuality, useGameStore } from '@/stores/gameStore';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciToRender } from '../core/renderSpace';
import { ATMOSPHERE, cloudOpacityForAltitude } from './atmosphereModel';
import { getTransmittanceLut, texelSizeKm, useEarthTextures } from './earthTextures';
import { buildPlanetFragmentShader, planetVertexShader } from './planetShader';
import { EXPOSURE, SUN_INTENSITY } from './shaderChunks';

/** 大气视线积分的采样数。 */
const VIEW_STEPS: Record<GraphicsQuality, number> = { low: 8, medium: 12, high: 16 };

/** 云层相对地表缓慢漂移的角速度 [圈/秒]（约 20 天绕一圈；纯视觉效果）。 */
const CLOUD_DRIFT_RATE = 1 / (20 * 86_400);

const R_SURFACE = EARTH.RADIUS;
const R_CLOUD = EARTH.RADIUS + ATMOSPHERE.CLOUD_HEIGHT * 1000;
const R_ATMOSPHERE = EARTH.RADIUS + ATMOSPHERE.TOP_HEIGHT * 1000;

/** (r − R)(r + R) = r² − R²，以 km² 为单位；分解因式避免两个大数平方相减。 */
const sphereC = (r: number, sphereRadius: number): number => ((r - sphereRadius) * (r + sphereRadius)) / 1e6;

/**
 * 地球：全屏三角形 + 解析射线求交着色器。
 * 在不透明队列中最先绘制（renderOrder 为负、不写深度），近景对象随后叠加在其上。
 */
export function Planet() {
  const textures = useEarthTextures();
  const quality = useGameStore((s) => s.quality);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: planetVertexShader,
        fragmentShader: buildPlanetFragmentShader(VIEW_STEPS[quality]),
        uniforms: {
          uCamRight: { value: new Vector3(1, 0, 0) },
          uCamUp: { value: new Vector3(0, 1, 0) },
          uCamFwd: { value: new Vector3(0, 0, -1) },
          uTanHalfFov: { value: 0.41 },
          uAspect: { value: 1 },
          uPixelAngle: { value: 0.001 },
          uPrincipalOffsetY: { value: 0 },
          uCamPos: { value: new Vector3(20_000, 0, 0) },
          uCSurf: { value: 1 },
          uCCloud: { value: 1 },
          uCAtmo: { value: 1 },
          uSunDir: { value: new Vector3(1, 0, 0) },
          uRenderToEcef: { value: new Matrix3() },
          uDayMap: { value: textures.day },
          uNightMap: { value: textures.night },
          uWaterMap: { value: textures.water },
          uCloudMap: { value: textures.clouds },
          uTexelKm: {
            value: new Vector4(
              texelSizeKm(textures.day),
              texelSizeKm(textures.night),
              texelSizeKm(textures.water),
              texelSizeKm(textures.clouds),
            ),
          },
          uCloudOpacity: { value: 1 },
          uCloudShift: { value: 0 },
          uTransmittanceLut: { value: getTransmittanceLut() },
          uSunIntensity: { value: SUN_INTENSITY },
          uExposure: { value: EXPOSURE },
        },
        // 预乘 alpha 混合：地表像素 alpha = 1（覆盖星空），大气边缘按透射率衰减背后的星光。
        // transparent 保持 false，使它留在不透明队列里、先于火箭等近景对象绘制。
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
      }),
    [textures, quality],
  );

  useFrame(() => {
    if (!frameState.valid) return;
    const u = material.uniforms;
    const cam = frameState.cameraPosition;
    const r = length(cam);

    (u.uCamRight!.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 0);
    (u.uCamUp!.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 1);
    (u.uCamFwd!.value as Vector3).setFromMatrixColumn(camera.matrixWorld, 2).negate();
    u.uTanHalfFov!.value = Math.tan((camera.fov * Math.PI) / 360);
    u.uAspect!.value = camera.aspect;
    u.uPixelAngle!.value = frameState.pixelAngle;
    u.uPrincipalOffsetY!.value = frameState.principalOffsetY;

    eciToRender(cam, u.uCamPos!.value as Vector3).multiplyScalar(1e-3);
    u.uCSurf!.value = sphereC(r, R_SURFACE);
    u.uCCloud!.value = sphereC(r, R_CLOUD);
    u.uCAtmo!.value = sphereC(r, R_ATMOSPHERE);
    eciToRender(frameState.sunDirection, u.uSunDir!.value as Vector3);

    // 渲染空间方向 → 地固系方向：先撤销坐标轴旋转（render → ECI），再绕 Z 轴转 −θ。
    const c = Math.cos(frameState.earthAngle);
    const s = Math.sin(frameState.earthAngle);
    (u.uRenderToEcef!.value as Matrix3).set(c, 0, -s, -s, 0, -c, 0, 1, 0);

    u.uCloudOpacity!.value = cloudOpacityForAltitude(frameState.cameraAltitude);
    u.uCloudShift!.value = (frameState.simTime * CLOUD_DRIFT_RATE) % 1;
  }, FRAME_PRIORITY.SCENE);

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-20} />;
}
