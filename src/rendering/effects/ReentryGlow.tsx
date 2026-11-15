import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  type Group,
  type Mesh,
  type PointLight,
  Quaternion,
  ShaderMaterial,
  type Sprite,
  Vector3,
} from 'three';
import { EARTH } from '@/game/physics/constants';
import { rotate } from '@/game/physics/math/quat';
import { vec3 } from '@/game/physics/math/vec3';
import { vehicleMaxDiameter } from '@/game/vehicles/analysis';
import { lowestAttachedStage } from '@/game/vehicles/configuration';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciToRender, eciToRenderRelative } from '../core/renderSpace';
import { plasmaColor, plasmaIntensity } from './reentryVisuals';

/**
 * 再入等离子体辉光（视觉效果，由物理状态驱动）。
 *
 * 强度与颜色只取决于"参考驻点热流"——物理线程由大气密度与相对大气的速度算出的量（见 reentryVisuals.ts）。
 * 所以它不会只因为高度低就出现：亚声速伞降、上升段、轨道上都没有辉光。
 *
 * 画法：迎风端一团激波层的光晕（精灵）+ 包住飞行器并向后拖出的尾迹（加色混合的锥形壳）+ 一盏照亮箭体的点光源。
 * 这是外观模型，不是激波层辐射或流场的计算。
 */

const vertexShader = /* glsl */ `
uniform float uFlare;
varying float vAlong;   // 0 迎风端 → 1 尾端
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vAlong = 0.5 - position.y;                        // 几何体沿 Y 取 [−0.5, 0.5]，迎风端在 +Y
  vec3 p = position;
  // 包络：迎风端收拢成钝头，向后逐渐张开
  float widen = sqrt(clamp(vAlong * 14.0, 0.0, 1.0)) * (1.0 + uFlare * pow(vAlong, 0.8));
  p.xz *= widen;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalV = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vAlong;
varying vec3 vNormalV;
varying vec3 vViewDir;

void main() {
  // 掠射处最亮：薄壳状的激波层沿视线的光学厚度在边缘最大
  float rim = 1.0 - abs(dot(normalize(vNormalV), vViewDir));
  float shell = 0.1 + 0.9 * pow(rim, 2.2);
  float fade = pow(1.0 - vAlong, 2.6);
  float streaks = 0.82 + 0.18 * sin(vAlong * 46.0 - uTime * 55.0);
  float alpha = shell * fade * streaks * uIntensity;
  // 迎风端最热（偏白），向后变红
  vec3 color = mix(uColor, uColor * vec3(1.0, 0.55, 0.35), clamp(vAlong * 1.6, 0.0, 1.0));
  gl_FragColor = vec4(color * alpha, alpha);
  #include <colorspace_fragment>
}
`;

const createGlowTexture = (): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
};

const UP = new Vector3(0, 1, 0);

export function ReentryGlow({ vehicle }: { vehicle: VehicleDefinition }) {
  const group = useRef<Group>(null);
  const trail = useRef<Mesh>(null);
  const cap = useRef<Sprite>(null);
  const light = useRef<PointLight>(null);
  const geometry = useMemo(() => new CylinderGeometry(1, 1, 1, 40, 24, true), []);
  const texture = useMemo(createGlowTexture, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { uColor: { value: new Color(1, 0.5, 0.2) }, uIntensity: { value: 0 }, uFlare: { value: 1.2 }, uTime: { value: 0 } },
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    [],
  );
  const direction = useMemo(() => new Vector3(), []);
  const orientation = useMemo(() => new Quaternion(), []);
  const fullDiameter = useMemo(() => vehicleMaxDiameter(vehicle), [vehicle]);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const snapshot = frameState.snapshot;
    const flight = snapshot?.vehicle.phase === 'flight' ? snapshot.vehicle.flight : null;
    const intensity = frameState.valid && flight ? plasmaIntensity(flight.referenceHeatFlux) : 0;
    g.visible = intensity > 0.004;
    if (light.current) light.current.intensity = 0;
    if (!g.visible || !snapshot) return;

    // 相对（随地球共转的）大气的速度方向，即飞行器"迎风"的方向
    const r = frameState.vehiclePosition;
    const v = frameState.vehicleVelocity;
    const air = vec3(v.x + EARTH.ROTATION_RATE * r.y, v.y - EARTH.ROTATION_RATE * r.x, v.z);
    eciToRender(air, direction);
    if (direction.lengthSq() < 1e-6) {
      g.visible = false;
      return;
    }
    direction.normalize();

    // 飞行器在来流方向上的投影尺寸：决定光晕与尾迹包络的大小和位置
    const nose = rotate(frameState.vehicleAttitude, vec3(1, 0, 0));
    const speed = Math.hypot(air.x, air.y, air.z);
    const cosAlpha = (nose.x * air.x + nose.y * air.y + nose.z * air.z) / speed;
    const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));
    const payloadOnly = lowestAttachedStage(snapshot.vehicle) >= vehicle.stages.length;
    const diameter = payloadOnly ? vehicle.payload.geometry.diameter : fullDiameter;
    const height = frameState.vehicleHeight;
    const com = frameState.centerOfMassHeight;
    const ahead = Math.max(cosAlpha * (height - com), -cosAlpha * com) + 0.35 * diameter;
    const radius = 0.62 * Math.hypot(diameter, height * sinAlpha);

    eciToRenderRelative(r, frameState.cameraPosition, g.position);
    g.quaternion.copy(orientation.setFromUnitVectors(UP, direction));

    const [cr, cg, cb] = plasmaColor(intensity);
    const u = material.uniforms;
    (u.uColor!.value as Color).setRGB(cr, cg, cb);
    u.uIntensity!.value = 0.6 * intensity;
    u.uFlare!.value = 0.9 + 0.8 * intensity;
    u.uTime!.value = clock.elapsedTime;

    const length = radius * (5 + 16 * intensity);
    if (trail.current) {
      trail.current.scale.set(radius, length, radius);
      trail.current.position.set(0, ahead + 0.25 * radius - length / 2, 0);
    }
    if (cap.current) {
      const size = radius * (2.6 + 1.6 * intensity);
      cap.current.scale.set(size, size, 1);
      cap.current.position.set(0, ahead, 0);
      cap.current.material.color.setRGB(cr, cg, cb);
      cap.current.material.opacity = 0.9 * intensity;
    }
    if (light.current) {
      light.current.color.setRGB(cr, cg, cb);
      light.current.intensity = intensity * 1_400 * radius * radius;
      light.current.position.set(0, ahead + radius, 0);
    }
  }, FRAME_PRIORITY.SCENE + 2);

  return (
    <group ref={group} visible={false}>
      <mesh ref={trail} geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
      <sprite ref={cap} renderOrder={5}>
        <spriteMaterial map={texture} blending={AdditiveBlending} depthWrite={false} transparent toneMapped={false} />
      </sprite>
      <pointLight ref={light} intensity={0} distance={0} decay={2} />
    </group>
  );
}
