import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Matrix4, type PerspectiveCamera, Vector3 } from 'three';
import { EARTH } from '@/game/physics/constants';
import { enuBasisAt } from '@/game/physics/frames/frames';
import { type Vec3, add, distance, dot, length, normalize, sub } from '@/game/physics/math/vec3';
import { useGameStore } from '@/stores/gameStore';
import { simRuntime } from '@/stores/simRuntime';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciToRender } from '../core/renderSpace';
import {
  type CameraContext,
  type CameraModeId,
  type CameraPose,
  type OrbitParams,
  blendPoses,
  clampParams,
  computeCameraPose,
  easeInOut,
  horizonDirection,
  inertialAnglesFromDirection,
} from './cameraMath';

/** 相机"机位"：四种飞行视角 + 主菜单的环绕展示机位。 */
type RigMode = CameraModeId | 'menu';

const DEG = Math.PI / 180;
const FOV_DEG = 45;
const ROTATE_SPEED = 0.0045; // rad / 像素
const ZOOM_SPEED = 0.0012; // 每滚轮单位的对数缩放量
const MENU_SPIN_RATE = 0.012; // rad / s
/** 主菜单中地球在画面上的水平位置（NDC）；左侧留给菜单面板。 */
const MENU_FRAMING_OFFSET = 0.42;

const baseMode = (mode: RigMode): CameraModeId => (mode === 'menu' ? 'orbit' : mode);

/** 各机位的初始参数，取决于飞行器尺寸与发射场位置。 */
const initialParams = (height: number, site: Vec3, focus: Vec3): Record<RigMode, OrbitParams> => {
  const siteLongitude = Math.atan2(site.y, site.x);
  const siteLatitude = Math.asin(site.z / Math.max(length(site), 1));
  // chase：从正南偏东看向火箭（勤务塔在西侧、避雷塔在四个斜角，这个方向没有遮挡）。
  // free：初始时与 chase 机位重合，之后保持惯性指向。
  const az = 172 * DEG;
  const el = 7 * DEG;
  const free = inertialAnglesFromDirection(horizonDirection(az, el, focus));
  return {
    chase: { azimuth: az, elevation: el, distance: height * 2.3 },
    free: { ...free, distance: height * 2.3 },
    pad: { azimuth: 196 * DEG, elevation: 1.1 * DEG, distance: Math.max(160, height * 4.2) },
    orbit: { azimuth: siteLongitude + 0.3, elevation: siteLatitude + 0.12, distance: EARTH.RADIUS * 3.1 },
    menu: { azimuth: siteLongitude + 0.55, elevation: Math.max(siteLatitude, 0.1) + 0.1, distance: EARTH.RADIUS * 3.4 },
  };
};

interface Transition {
  /** 切换瞬间相机相对注视锚点的位姿（冻结）。 */
  readonly offset: Vec3;
  readonly targetOffset: Vec3;
  readonly up: Vec3;
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * 相机控制器：读取输入与当前模式，计算相机在 ECI 中的位姿，
 * 并把相机放到渲染空间原点（浮动原点），只设置其朝向与裁剪面。
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);

  const params = useRef<Record<RigMode, OrbitParams> | null>(null);
  const paramsKey = useRef<string | null>(null);
  const mode = useRef<RigMode>('menu');
  const transition = useRef<Transition | null>(null);
  const lastPose = useRef<CameraPose | null>(null);
  const dragging = useRef(false);
  const scratch = useRef({ eye: new Vector3(), target: new Vector3(), up: new Vector3(), m: new Matrix4() });

  // 指针与滚轮输入：直接修改当前机位的参数（不经过 React 状态，避免每次移动都重渲染）。
  useEffect(() => {
    const el = gl.domElement;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !params.current) return;
      const p = params.current[mode.current];
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // chase / pad 的方位角自北向东（顺时针）为正，free / orbit 在惯性系中逆时针为正；
      // 统一成"向右拖动 → 景物跟着向右转"。
      const clockwise = mode.current === 'chase' || mode.current === 'pad';
      p.azimuth += (clockwise ? 1 : -1) * dx * ROTATE_SPEED;
      p.elevation += dy * ROTATE_SPEED;
      Object.assign(p, clampParams(baseMode(mode.current), p));
    };
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!params.current || mode.current === 'menu') return;
      const p = params.current[mode.current];
      p.distance *= Math.exp(e.deltaY * ZOOM_SPEED);
      Object.assign(p, clampParams(baseMode(mode.current), p));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl]);

  useFrame((_, delta) => {
    if (!frameState.valid) return;
    const now = performance.now();
    const focus = frameState.vehicleFocus;

    // 换了飞行器或发射场：重置机位参数，并直接切到新位置（不做过渡）。
    // （同一配置下重新开始模拟不算，以免打断正在进行的镜头过渡。）
    const config = simRuntime.config;
    const key = config ? `${config.vehicle.id}|${config.site.latitude}|${config.site.longitude}` : null;
    if (paramsKey.current !== key) {
      paramsKey.current = key;
      params.current = initialParams(frameState.vehicleHeight, frameState.sitePosition, focus);
      transition.current = null;
      lastPose.current = null;
    }
    const allParams = params.current;
    if (!allParams) return;

    const game = useGameStore.getState();
    const wanted: RigMode = game.screen === 'menu' ? 'menu' : game.cameraMode;

    const tanHalfFovY = Math.tan((FOV_DEG * DEG) / 2);
    const aspect = size.width / Math.max(size.height, 1);
    const ctxFor = (m: RigMode): CameraContext => ({
      focus,
      site: frameState.sitePosition,
      framingOffsetX: m === 'menu' ? MENU_FRAMING_OFFSET : 0,
      tanHalfFovX: tanHalfFovY * aspect,
    });

    if (wanted !== mode.current) {
      const from = lastPose.current;
      const to = computeCameraPose(baseMode(wanted), allParams[wanted], ctxFor(wanted));
      if (from) {
        // 过渡时长随缩放跨度增加：近景之间约 1.2 s，地面 ↔ 轨道约 3.5 s。
        const dFrom = Math.max(distance(from.position, focus), 1);
        const dTo = Math.max(distance(to.position, focus), 1);
        const durationMs = Math.min(3600, 1200 + 240 * Math.abs(Math.log(dTo / dFrom)));
        transition.current = {
          offset: sub(from.position, focus),
          targetOffset: sub(from.target, focus),
          up: from.up,
          startMs: now,
          durationMs,
        };
      }
      mode.current = wanted;
    }

    if (mode.current === 'menu' && !dragging.current) allParams.menu.azimuth += MENU_SPIN_RATE * Math.min(delta, 0.1);

    let pose = computeCameraPose(baseMode(mode.current), allParams[mode.current], ctxFor(mode.current));
    const tr = transition.current;
    if (tr) {
      const s = easeInOut((now - tr.startMs) / tr.durationMs);
      if (s >= 1) {
        transition.current = null;
      } else {
        const from: CameraPose = { position: add(focus, tr.offset), target: add(focus, tr.targetOffset), up: tr.up };
        pose = blendPoses(from, pose, focus, s);
      }
    }
    lastPose.current = pose;

    // 朝向：相机位于渲染空间原点，只需要"看向 target − position"的旋转。
    const { eye, target, up, m } = scratch.current;
    const view = sub(pose.target, pose.position);
    if (length(view) < 1e-6) return;
    eye.set(0, 0, 0);
    eciToRender(view, target);
    // "上"方向与视线几乎平行时（例如从正上方俯视），改用一个垂直方向以避免退化。
    const viewDir = normalize(view);
    let upHint = pose.up;
    if (Math.abs(dot(viewDir, upHint)) > 0.9995) upHint = enuBasisAt(pose.position).north;
    eciToRender(upHint, up);
    m.lookAt(eye, target, up);
    camera.position.set(0, 0, 0);
    camera.quaternion.setFromRotationMatrix(m);

    // 裁剪面：近景对象（火箭、发射台、地面补丁）使用常规深度缓冲；
    // 行星由解析着色器绘制，不参与深度，因此远裁剪面只需覆盖近景对象与飞行器标记。
    const cameraAltitude = length(pose.position) - EARTH.RADIUS;
    const cameraDistance = distance(pose.position, focus);
    const near = Math.min(1e5, Math.max(0.2, 0.05 * Math.min(cameraDistance, Math.max(cameraAltitude, 1))));
    const far = Math.max(2e5, cameraDistance * 20, near * 1e5);
    if (camera.fov !== FOV_DEG || camera.near !== near || camera.far !== far || camera.aspect !== aspect) {
      camera.fov = FOV_DEG;
      camera.near = near;
      camera.far = far;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();

    frameState.cameraPosition = pose.position;
    frameState.cameraAltitude = cameraAltitude;
    frameState.cameraDistance = cameraDistance;
    frameState.pixelAngle = (2 * tanHalfFovY) / Math.max(1, gl.domElement.height);
  }, FRAME_PRIORITY.CAMERA);

  return null;
}
