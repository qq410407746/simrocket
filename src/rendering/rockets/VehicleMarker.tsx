import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, type Sprite } from 'three';
import { length, sub } from '@/game/physics/math/vec3';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { isOccludedByEarth } from '../core/occlusion';
import { eciToRenderRelative } from '../core/renderSpace';

const MARKER_PIXELS = 30;

const createMarkerTexture = (): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(c, c, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(c, c, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(c + dx * 42, c + dy * 42);
      ctx.lineTo(c + dx * 58, c + dy * 58);
      ctx.stroke();
    }
  }
  return new CanvasTexture(canvas);
};

/**
 * 飞行器位置标记：当火箭在屏幕上只有几个像素时（轨道视角），用固定屏幕大小的图标标出其位置。
 * 被地球遮挡时隐藏。
 */
export function VehicleMarker() {
  const sprite = useRef<Sprite>(null);
  const texture = useMemo(createMarkerTexture, []);

  useFrame(() => {
    const s = sprite.current;
    if (!s) return;
    if (!frameState.valid) {
      s.visible = false;
      return;
    }
    const cam = frameState.cameraPosition;
    const dist = length(sub(frameState.vehicleFocus, cam));
    // 火箭在屏幕上的高度（CSS 像素，与屏幕的像素密度无关）
    const cssPixelAngle = frameState.pixelAngle * frameState.pixelRatio;
    const pixels = frameState.vehicleHeight / Math.max(dist * cssPixelAngle, 1e-9);
    const opacity = 1 - Math.min(1, Math.max(0, (pixels - 10) / 30));

    const occluded = isOccludedByEarth(cam, frameState.vehicleFocus);

    s.visible = opacity > 0.01 && !occluded;
    if (!s.visible) return;
    s.material.opacity = opacity;
    eciToRenderRelative(frameState.vehicleFocus, cam, s.position);
    // sizeAttenuation = false 时，scale 表示距离为 1 处的尺寸，即视角的正切。
    const angular = MARKER_PIXELS * cssPixelAngle;
    s.scale.set(angular, angular, 1);
  }, FRAME_PRIORITY.SCENE);

  return (
    <sprite ref={sprite} visible={false} renderOrder={10}>
      <spriteMaterial map={texture} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
    </sprite>
  );
}
