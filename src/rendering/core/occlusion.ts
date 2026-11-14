import { EARTH } from '@/game/physics/constants';
import { type Vec3, dot, length, scale, sub } from '@/game/physics/math/vec3';

/**
 * 从相机看向某一点的视线是否被地球挡住（双精度、数值稳定的求根）。
 * @param margin 交点需比目标点近至少这么多 [m] 才算遮挡，避免贴近地表的点被自身所在的地面误判
 */
export const isOccludedByEarth = (camera: Vec3, point: Vec3, margin = 1000): boolean => {
  const toPoint = sub(point, camera);
  const dist = length(toPoint);
  if (!(dist > 0)) return false;
  const direction = scale(toPoint, 1 / dist);
  const b = dot(camera, direction);
  if (b >= 0) return false;
  const r = length(camera);
  const c = (r - EARTH.RADIUS) * (r + EARTH.RADIUS);
  const disc = b * b - c;
  if (disc <= 0) return false;
  const tNear = c / (-b + Math.sqrt(disc));
  return tNear > 0 && tNear < dist - margin;
};
