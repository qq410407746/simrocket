import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, LinearFilter, Matrix4, type Mesh, type OrthographicCamera, SRGBColorSpace, type Sprite, Vector3 } from 'three';
import { EARTH, RAD2DEG } from '@/game/physics/constants';
import { airRelativeVelocityEci, enuBasisAt } from '@/game/physics/frames/frames';
import { rotate } from '@/game/physics/math/quat';
import { dot, length, vec3 } from '@/game/physics/math/vec3';
import { frameState } from '@/rendering/core/frameState';
import { useSimStore } from '@/stores/simStore';
import { formatAngle } from '@/utils/format';
import { FLIGHT_KEY_HINTS } from './useFlightControls';

/**
 * 导航球：显示箭体姿态相对当地水平面的关系，以及速度方向标记。
 *
 * 约定（与真实航天器及同类游戏的导航球一致）：
 *  - 球心正对观察者的那一点是箭体头部（机体 +X）当前指向的方向；
 *  - 球面上半部（蓝）是天空，下半部（棕）是地面，水平线是当地地平线；
 *  - 球面上的刻度是 俯仰角（纬线）与 航向角（经线，N = 0°，E = 90°）；
 *  - 画面右方对应机体 +Y，画面上方对应机体 −Z。
 *    因此 A/D 使头部标记左/右移动，W/S 使其下/上移动。
 *
 * 几何上，导航球是"方向球面"的镜像（从外面看一个本应从里面看的球），
 * 所以球面贴图定义在镜像后的当地坐标系（X 东、Y 天、Z 北）中，再用一个真旋转摆到观察坐标系。
 */

/** 低于该高度 [m] 时速度标记使用相对地面的速度，否则使用惯性（轨道）速度。 */
export const SURFACE_MODE_ALTITUDE = 50_000;

const TEX_W = 2048;
const TEX_H = 1024;

/** 航向角 [°] → 贴图横坐标（Three.js 球体的 u = 0 对应当地 −X 方向，即正西）。 */
const headingToX = (heading: number): number => ((((heading + 90) % 360) + 360) % 360) / 360 * TEX_W;
const pitchToY = (pitch: number): number => ((90 - pitch) / 180) * TEX_H;

const HEADING_LABELS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

const createBallTexture = (): CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, TEX_H / 2);
    sky.addColorStop(0, '#0a2f73');
    sky.addColorStop(1, '#3f95ea');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, TEX_W, TEX_H / 2);
    const ground = ctx.createLinearGradient(0, TEX_H / 2, 0, TEX_H);
    ground.addColorStop(0, '#9a632c');
    ground.addColorStop(1, '#3a2110');
    ctx.fillStyle = ground;
    ctx.fillRect(0, TEX_H / 2, TEX_W, TEX_H / 2);

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 俯仰刻度线：每 10° 一条
    for (let pitch = -80; pitch <= 80; pitch += 10) {
      if (pitch === 0) continue;
      ctx.lineWidth = pitch % 30 === 0 ? 4 : 2;
      ctx.globalAlpha = pitch % 30 === 0 ? 0.9 : 0.55;
      ctx.beginPath();
      ctx.moveTo(0, pitchToY(pitch));
      ctx.lineTo(TEX_W, pitchToY(pitch));
      ctx.stroke();
    }
    // 航向刻度线：每 30° 一条
    for (let heading = 0; heading < 360; heading += 30) {
      ctx.lineWidth = heading % 90 === 0 ? 5 : 2;
      ctx.globalAlpha = heading % 90 === 0 ? 0.95 : 0.55;
      ctx.beginPath();
      ctx.moveTo(headingToX(heading), pitchToY(85));
      ctx.lineTo(headingToX(heading), pitchToY(-85));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 地平线
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, TEX_H / 2);
    ctx.lineTo(TEX_W, TEX_H / 2);
    ctx.stroke();

    // 文字：等距圆柱投影在高纬度被横向压缩，按 1/cos(俯仰) 预先拉宽
    const label = (text: string, heading: number, pitch: number, size: number, color: string) => {
      ctx.save();
      ctx.translate(headingToX(heading), pitchToY(pitch));
      ctx.scale(1 / Math.cos((pitch * Math.PI) / 180), 1);
      ctx.font = `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    for (let heading = 0; heading < 360; heading += 30) {
      const text = HEADING_LABELS[heading] ?? String(heading).padStart(3, '0');
      const major = heading % 90 === 0;
      for (const pitch of [7, -7]) label(text, heading, pitch, major ? 44 : 30, major ? '#ffd27a' : '#ffffff');
      for (const pitch of [45, -45]) label(text, heading, pitch, major ? 38 : 26, major ? '#ffd27a' : 'rgba(255,255,255,0.85)');
    }
    for (let pitch = -80; pitch <= 80; pitch += 10) {
      if (pitch === 0 || Math.abs(pitch) === 80) continue;
      for (const heading of [15, 105, 195, 285]) label(String(Math.abs(pitch)), heading, pitch, 26, 'rgba(255,255,255,0.9)');
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.anisotropy = 4;
  return texture;
};

const createMarkerTexture = (kind: 'prograde' | 'retrograde'): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    ctx.strokeStyle = '#d7ff3c';
    ctx.fillStyle = '#d7ff3c';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, 26, 0, Math.PI * 2);
    ctx.stroke();
    if (kind === 'prograde') {
      // 顺行：圆 + 中心点 + 上、左、右三条短线
      ctx.beginPath();
      ctx.arc(c, c, 5, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]] as const) {
        ctx.beginPath();
        ctx.moveTo(c + dx * 30, c + dy * 30);
        ctx.lineTo(c + dx * 52, c + dy * 52);
        ctx.stroke();
      }
    } else {
      // 逆行：圆 + 交叉线
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(c - 18, c - 18 * s);
        ctx.lineTo(c + 18, c + 18 * s);
        ctx.stroke();
      }
      for (const [dx, dy] of [[0, -1], [-0.87, 0.5], [0.87, 0.5]] as const) {
        ctx.beginPath();
        ctx.moveTo(c + dx * 30, c + dy * 30);
        ctx.lineTo(c + dx * 50, c + dy * 50);
        ctx.stroke();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const BODY_X = vec3(1, 0, 0);
const BODY_Y = vec3(0, 1, 0);
const BODY_Z = vec3(0, 0, 1);

function Ball() {
  const ball = useRef<Mesh>(null);
  const prograde = useRef<Sprite>(null);
  const retrograde = useRef<Sprite>(null);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const texture = useMemo(createBallTexture, []);
  const progradeTexture = useMemo(() => createMarkerTexture('prograde'), []);
  const retrogradeTexture = useMemo(() => createMarkerTexture('retrograde'), []);
  const scratch = useMemo(() => ({ m: new Matrix4(), x: new Vector3(), y: new Vector3(), z: new Vector3() }), []);

  useFrame(() => {
    // 让球体恰好充满画布
    const zoom = (Math.min(size.width, size.height) / 2) * 0.98;
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
    const mesh = ball.current;
    if (!mesh || !frameState.valid) return;

    const attitude = frameState.vehicleAttitude;
    const position = frameState.vehiclePosition;
    // 观察坐标轴（在 ECI 中表达）：右 = 机体 +Y，上 = 机体 −Z，朝向观察者 = 机体 +X（头部）
    const right = rotate(attitude, BODY_Y);
    const down = rotate(attitude, BODY_Z);
    const forward = rotate(attitude, BODY_X);
    const toView = (d: { x: number; y: number; z: number }, out: Vector3): Vector3 =>
      out.set(dot(d, right), -dot(d, down), dot(d, forward));

    // 球体的当地坐标轴 X = 东、Y = 天、Z = 北 在观察坐标系中的方向，作为旋转矩阵的三列
    const { east, north, up } = enuBasisAt(position);
    const { m, x, y, z } = scratch;
    m.makeBasis(toView(east, x), toView(up, y), toView(north, z));
    mesh.quaternion.setFromRotationMatrix(m);

    // 速度方向标记
    const altitude = length(position) - EARTH.RADIUS;
    const velocity =
      altitude < SURFACE_MODE_ALTITUDE ? airRelativeVelocityEci(position, frameState.vehicleVelocity) : frameState.vehicleVelocity;
    const speed = length(velocity);
    const pro = prograde.current;
    const retro = retrograde.current;
    if (!pro || !retro) return;
    if (speed < 0.5) {
      pro.visible = false;
      retro.visible = false;
      return;
    }
    toView(velocity, x).multiplyScalar(1 / speed);
    pro.visible = x.z > 0.02;
    retro.visible = x.z < -0.02;
    pro.position.set(x.x, x.y, 1.2);
    retro.position.set(-x.x, -x.y, 1.2);
  });

  return (
    <>
      <mesh ref={ball}>
        <sphereGeometry args={[1, 64, 48]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <sprite ref={prograde} scale={[0.36, 0.36, 1]} visible={false}>
        <spriteMaterial map={progradeTexture} depthTest={false} toneMapped={false} />
      </sprite>
      <sprite ref={retrograde} scale={[0.36, 0.36, 1]} visible={false}>
        <spriteMaterial map={retrogradeTexture} depthTest={false} toneMapped={false} />
      </sprite>
    </>
  );
}

/** 导航球及其下方的姿态读数与键位说明。 */
export function NavBall() {
  const pitch = useSimStore((s) => s.telemetry?.pitch ?? null);
  const heading = useSimStore((s) => s.telemetry?.heading ?? null);
  const altitude = useSimStore((s) => s.telemetry?.altitude ?? 0);
  const active = useSimStore((s) => s.telemetry !== null && (s.telemetry.phase === 'flight' || s.telemetry.phase === 'prelaunch'));

  return (
    <div className="pointer-events-none flex flex-col items-center gap-1.5" data-testid="navball">
      <div className="relative h-40 w-40 rounded-full bg-void shadow-[0_0_0_2px_rgb(28_46_72),0_0_0_5px_rgb(6_12_23/0.9),0_10px_30px_rgb(0_0_0/0.6)]">
        <Canvas
          orthographic
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0, 5], near: 0.1, far: 20, zoom: 80 }}
          style={{ borderRadius: '9999px', pointerEvents: 'none' }}
        >
          <Ball />
        </Canvas>
        {/* 玻璃罩的明暗过渡（纯装饰） */}
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(255_255_255/0.16),transparent_45%),radial-gradient(circle_at_50%_50%,transparent_62%,rgb(0_0_0/0.55)_100%)]" />
        {/* 固定的机体指示符：球心 = 头部指向 */}
        <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" stroke="#ff9d3c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M -26 0 L -9 0 L 0 8 L 9 0 L 26 0" />
            <circle cx="0" cy="0" r="1.6" fill="#ff9d3c" />
          </g>
        </svg>
      </div>
      <div className="panel-frame flex flex-col items-center gap-1 rounded-md px-3 py-1.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="readout text-[11px] text-ink-dim">
            俯仰 <span className="text-data" data-testid="navball-pitch">{formatAngle(pitch)}°</span>
          </span>
          <span className="readout text-[11px] text-ink-dim">
            航向 <span className="text-data">{heading === null ? '—' : `${String(Math.round(heading * RAD2DEG) % 360).padStart(3, '0')}°`}</span>
          </span>
          <span className="text-[10px] text-ink-faint" title="速度标记的参考系：低空用相对地面的速度，高空用惯性（轨道）速度">
            速度标记：{altitude < SURFACE_MODE_ALTITUDE ? '相对地面' : '轨道'}
          </span>
        </div>
        <div className={`flex max-w-[460px] flex-wrap justify-center gap-x-2.5 gap-y-0.5 text-[10px] ${active ? 'text-ink-dim' : 'text-ink-faint'}`}>
          {FLIGHT_KEY_HINTS.map(([key, action]) => (
            <span key={key} className="whitespace-nowrap">
              <kbd className="readout rounded-sm border border-line bg-raised px-1 text-[10px] text-ink">{key}</kbd> {action}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
