import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type DirectionalLight, type HemisphereLight, Object3D, Vector3 } from 'three';
import { EARTH } from '@/game/physics/constants';
import { dot, length, normalize } from '@/game/physics/math/vec3';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciToRender, eciToRenderRelative } from '../core/renderSpace';
import { ATMOSPHERE, sunTransmittance } from '../earth/atmosphereModel';

/** 直射阳光强度（Three.js 物理光照单位；π ≈ 白色表面正对太阳时输出 1.0）。 */
const SUN_LIGHT_INTENSITY = 4.2;
const LIGHT_DISTANCE = 900;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 近景对象（火箭、发射台）的光照。
 *  - 平行光：方向为太阳方向；颜色 = 飞行器所在位置的大气透射率（日出日落自然变红，
 *    进入地球阴影后为 0），与行星着色器使用同一个大气模型。
 *  - 半球光：天空散射光与地面反射光的近似，随太阳高度与大气密度变化。
 */
export function SceneLighting({ shadows, shadowExtent }: { shadows: boolean; shadowExtent: number }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const scratch = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (sun.current) sun.current.target = target;
  }, [target]);

  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    const cam = light.shadow.camera;
    cam.left = -shadowExtent;
    cam.right = shadowExtent;
    cam.top = shadowExtent;
    cam.bottom = -shadowExtent;
    cam.near = LIGHT_DISTANCE - shadowExtent * 2.5;
    cam.far = LIGHT_DISTANCE + shadowExtent * 2.5;
    cam.updateProjectionMatrix();
  }, [shadowExtent]);

  useFrame(() => {
    const light = sun.current;
    const sky = hemi.current;
    if (!light || !sky || !frameState.valid) return;

    const vehicle = frameState.vehiclePosition;
    const r = length(vehicle);
    const up = normalize(vehicle);
    const mu = dot(up, frameState.sunDirection);
    const heightKm = (r - EARTH.RADIUS) / 1000;
    const [tr, tg, tb] = sunTransmittance(heightKm, mu);
    light.color.setRGB(tr, tg, tb);
    light.intensity = SUN_LIGHT_INTENSITY;

    eciToRenderRelative(vehicle, frameState.cameraPosition, target.position);
    eciToRender(frameState.sunDirection, scratch);
    light.position.copy(target.position).addScaledVector(scratch, LIGHT_DISTANCE);

    // 天空光：白天且在大气内最强；高空只剩来自下方地球的反射光。
    const day = smoothstep(-0.1, 0.25, mu);
    const air = Math.exp(-Math.max(0, heightKm) / ATMOSPHERE.RAYLEIGH_SCALE_HEIGHT);
    eciToRender(up, sky.position);
    // 常数项是夜间的微弱环境光（星光/月光的量级近似），让火箭轮廓在夜里仍可辨认。
    sky.color.setRGB(0.5 * day * air + 0.03, 0.66 * day * air + 0.035, 0.95 * day * air + 0.05);
    sky.groundColor.setRGB(0.3 * day + 0.012, 0.3 * day + 0.012, 0.3 * day + 0.016);
  }, FRAME_PRIORITY.SCENE);

  return (
    <>
      <directionalLight
        ref={sun}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.06}
      />
      <primitive object={target} />
      <hemisphereLight ref={hemi} intensity={1.1} />
    </>
  );
}
