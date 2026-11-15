import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, LinearFilter, Matrix4, type Mesh, type OrthographicCamera, SRGBColorSpace, type Sprite, Vector3 } from 'three';
import { type AttitudeMode, SURFACE_REFERENCE_ALTITUDE, pointingDirection } from '@/game/physics/attitude/pointing';
import { EARTH, RAD2DEG } from '@/game/physics/constants';
import { enuBasisAt } from '@/game/physics/frames/frames';
import { rotate } from '@/game/physics/math/quat';
import { dot, length, vec3 } from '@/game/physics/math/vec3';
import { useI18n } from '@/i18n';
import { frameState } from '@/rendering/core/frameState';
import { simRuntime } from '@/stores/simRuntime';
import { useSimStore } from '@/stores/simStore';
import { formatAngle } from '@/utils/format';
import { FLIGHT_KEY_HINTS } from './useFlightControls';
import { bankLabel } from './thermalLabels';

/**
 * 导航球：显示箭体姿态相对当地水平面的关系，以及轨道参考方向的标记。
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
 *
 * 标记：顺行 / 逆行（黄绿）始终显示；法向 / 反法向（品红）与径向外 / 内（青）只在高空显示
 * ——它们是轨道面上的概念，在上升段低空没有操作意义。
 */

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

type MarkerMode = Exclude<AttitudeMode, 'manual'>;

const MARKER_MODES: readonly MarkerMode[] = ['prograde', 'retrograde', 'normal', 'antinormal', 'radial-out', 'radial-in'];

/** 各参考方向的标记图案。 */
const createMarkerTexture = (mode: MarkerMode): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const color = mode === 'prograde' || mode === 'retrograde' ? '#d7ff3c' : mode === 'normal' || mode === 'antinormal' ? '#ff6bd6' : '#4be3ff';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(c + x0, c + y0);
      ctx.lineTo(c + x1, c + y1);
      ctx.stroke();
    };
    const circle = (radius: number, fill = false) => {
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      if (fill) ctx.fill();
      else ctx.stroke();
    };
    switch (mode) {
      case 'prograde':
        // 圆 + 中心点 + 上、左、右三条短线
        circle(26);
        circle(5, true);
        line(0, -30, 0, -52);
        line(-30, 0, -52, 0);
        line(30, 0, 52, 0);
        break;
      case 'retrograde':
        // 圆 + 交叉线 + 三条放射短线
        circle(26);
        line(-18, -18, 18, 18);
        line(-18, 18, 18, -18);
        line(0, -30, 0, -50);
        line(-26, 15, -43, 25);
        line(26, 15, 43, 25);
        break;
      case 'normal':
      case 'antinormal': {
        // 法向：尖端朝上的三角；反法向：尖端朝下
        const s = mode === 'normal' ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(c, c + s * 34);
        ctx.lineTo(c - 32, c - s * 22);
        ctx.lineTo(c + 32, c - s * 22);
        ctx.closePath();
        ctx.stroke();
        circle(5, true);
        break;
      }
      case 'radial-out':
        // 径向外：圆 + 中心点 + 四条向外的斜线
        circle(22);
        circle(5, true);
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) line(dx * 19, dy * 19, dx * 36, dy * 36);
        break;
      case 'radial-in':
        // 径向内：圆 + 四条指向中心的斜线
        circle(30);
        for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) line(dx * 18, dy * 18, dx * 6, dy * 6);
        break;
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
  const markers = useRef<(Sprite | null)[]>([]);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  const texture = useMemo(createBallTexture, []);
  const markerTextures = useMemo(() => MARKER_MODES.map(createMarkerTexture), []);
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
    const velocity = frameState.vehicleVelocity;
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

    // 参考方向标记：位于朝向观察者的半球上才显示
    const orbital = length(position) - EARTH.RADIUS >= SURFACE_REFERENCE_ALTITUDE;
    MARKER_MODES.forEach((mode, i) => {
      const sprite = markers.current[i];
      if (!sprite) return;
      const velocityMarker = mode === 'prograde' || mode === 'retrograde';
      const direction = velocityMarker || orbital ? pointingDirection(mode, position, velocity) : null;
      if (!direction) {
        sprite.visible = false;
        return;
      }
      toView(direction, x);
      sprite.visible = x.z > 0.02;
      sprite.position.set(x.x, x.y, 1.2);
    });
  });

  return (
    <>
      <mesh ref={ball}>
        <sphereGeometry args={[1, 64, 48]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      {MARKER_MODES.map((mode, i) => (
        <sprite
          key={mode}
          ref={(s) => {
            markers.current[i] = s;
          }}
          scale={[0.34, 0.34, 1]}
          visible={false}
        >
          <spriteMaterial map={markerTextures[i]} depthTest={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
}

const MODE_BUTTONS: readonly { mode: AttitudeMode; label: [string, string]; hint: [string, string]; color: string }[] = [
  { mode: 'manual', label: ['手动', 'Manual'], hint: ['手动操纵；松开按键后保持当前姿态', 'Manual steering; hold the current attitude when keys are released'], color: 'text-ink' },
  { mode: 'prograde', label: ['顺行', 'Prograde'], hint: ['头部保持指向速度方向（R）。低空以相对地面的速度为准，高空以轨道速度为准', 'Point along velocity (R). Uses surface-relative velocity at low altitude and orbital velocity at high altitude'], color: 'text-[#d7ff3c]' },
  { mode: 'retrograde', label: ['逆行', 'Retrograde'], hint: ['头部保持指向速度的反方向（T）：减速、离轨', 'Point opposite velocity (T) for braking and deorbit burns'], color: 'text-[#d7ff3c]' },
  { mode: 'normal', label: ['法向', 'Normal'], hint: ['头部保持指向轨道面法向：改变轨道倾角', 'Point normal to the orbital plane to change inclination'], color: 'text-[#ff6bd6]' },
  { mode: 'antinormal', label: ['反法向', 'Anti-normal'], hint: ['头部保持指向轨道面法向的反方向', 'Point opposite the orbital plane normal'], color: 'text-[#ff6bd6]' },
  { mode: 'radial-out', label: ['径向外', 'Radial out'], hint: ['头部在轨道面内垂直于速度、指向远离地球的一侧', 'Point perpendicular to velocity in the orbital plane, away from Earth'], color: 'text-[#4be3ff]' },
  { mode: 'radial-in', label: ['径向内', 'Radial in'], hint: ['头部在轨道面内垂直于速度、指向地球一侧', 'Point perpendicular to velocity in the orbital plane, toward Earth'], color: 'text-[#4be3ff]' },
  {
    mode: 'trim',
    label: ['配平', 'Trim'],
    hint: ['配平再入（Y）：防热大底朝前并保持配平迎角，产生升力、降低过载。Q / E 改变倾侧角（升力的方向）', 'Trimmed reentry (Y): heat shield forward at the trim angle of attack to generate lift and reduce g-load. Q / E change bank angle (lift direction)'],
    color: 'text-[#ffb347]',
  },
];

/** 自动指向模式选择。 */
function AttitudeModeBar() {
  const { t } = useI18n();
  const mode = useSimStore((s) => s.telemetry?.attitudeMode ?? 'manual');
  const flying = useSimStore((s) => s.telemetry?.phase === 'flight');
  const canTrim = useSimStore((s) => (s.telemetry?.trimAngle ?? 0) > 0);
  return (
    <div className="flex w-full max-w-[500px] flex-wrap items-center justify-center gap-1" data-testid="attitude-modes">
      <span className="mr-0.5 text-[10px] tracking-[0.14em] text-ink-faint">{t('指向', 'Pointing')}</span>
      {MODE_BUTTONS.map((button) => {
        const active = mode === button.mode;
        return (
          <button
            key={button.mode}
            type="button"
            disabled={!flying || (button.mode === 'trim' && !canTrim)}
            title={button.mode === 'trim' && !canTrim ? t('配平再入只对已与推进级分离、质心有横向偏移的返回舱有效', 'Trimmed reentry requires a separated capsule with a laterally offset center of mass') : t(...button.hint)}
            aria-pressed={active}
            data-testid={`attitude-${button.mode}`}
            onClick={(e) => {
              e.currentTarget.blur();
              simRuntime.setAttitudeMode(button.mode);
            }}
            className={`pointer-events-auto rounded border px-1.5 py-0.5 text-[11px] leading-4 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              active ? `border-data bg-data/15 ${button.color}` : 'border-line text-ink-dim hover:border-data-dim hover:text-ink'
            }`}
          >
            {t(...button.label)}
          </button>
        );
      })}
    </div>
  );
}

/** 只翻译说明文字，不改动键位或飞行指令。 */
const KEY_ACTION_ENGLISH: Readonly<Record<string, string>> = {
  '空格': 'Ignite / stage',
  'W S': 'Pitch',
  'A D': 'Yaw',
  'Q E': 'Roll / bank',
  '↑ ↓': 'Throttle',
  Z: 'Full thrust',
  X: 'Cut engines',
  F: 'Jettison fairing',
  G: 'Deploy chute',
  H: 'Jettison shield',
  'R T': 'Prograde / retrograde hold',
  Y: 'Trimmed reentry',
  M: 'Orbit map',
};

/** 导航球及其下方的姿态读数、指向模式与键位说明。 */
export function NavBall() {
  const { language, t } = useI18n();
  const pitch = useSimStore((s) => s.telemetry?.pitch ?? null);
  const heading = useSimStore((s) => s.telemetry?.heading ?? null);
  const altitude = useSimStore((s) => s.telemetry?.altitude ?? 0);
  const active = useSimStore((s) => s.telemetry !== null && (s.telemetry.phase === 'flight' || s.telemetry.phase === 'prelaunch'));
  const trimming = useSimStore((s) => s.telemetry?.attitudeMode === 'trim');
  const bank = useSimStore((s) => s.telemetry?.bankAngle ?? 0);
  const trimAngle = useSimStore((s) => s.telemetry?.trimAngle ?? 0);

  return (
    <div className="pointer-events-none flex max-w-full flex-col items-center gap-1.5" data-testid="navball">
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
      <div className="panel-frame flex max-w-full flex-col items-center gap-1.5 rounded-md px-3 py-1.5 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span className="readout text-[11px] text-ink-dim">
            {t('俯仰', 'Pitch')} <span className="text-data" data-testid="navball-pitch">{formatAngle(pitch)}°</span>
          </span>
          <span className="readout text-[11px] text-ink-dim">
            {t('航向', 'Heading')} <span className="text-data">{heading === null ? '—' : `${String(Math.round(heading * RAD2DEG) % 360).padStart(3, '0')}°`}</span>
          </span>
          {trimming ? (
            <span
              className="readout text-[11px] text-ink-dim"
              title={t(`配平迎角 ${formatAngle(trimAngle)}°（由质心偏移决定）。倾侧角 0° 升力向上，±180° 升力向下；Q / E 改变倾侧角`, `Trim AoA ${formatAngle(trimAngle)}° (set by center-of-mass offset). Bank 0°: lift up; ±180°: lift down. Q / E change bank angle`)}
            >
              {t('倾侧', 'Bank')} <span className="text-[#ffb347]" data-testid="navball-bank">{bankLabel(bank, language)}</span>
            </span>
          ) : (
            <span className="text-[10px] text-ink-faint" title={t('顺行/逆行的参考速度：低空用相对地面的速度，高空用惯性（轨道）速度', 'Prograde / retrograde reference: surface-relative velocity at low altitude; inertial (orbital) velocity at high altitude')}>
              {t('速度参考：', 'Ref: ')}{altitude < SURFACE_REFERENCE_ALTITUDE ? t('相对地面', 'Surface') : t('轨道', 'Orbit')}
            </span>
          )}
        </div>
        <AttitudeModeBar />
        <div className={`flex max-w-[500px] flex-wrap justify-center gap-x-2.5 gap-y-0.5 text-[10px] ${active ? 'text-ink-dim' : 'text-ink-faint'}`}>
          {FLIGHT_KEY_HINTS.map(([key, action]) => (
            <span key={key} className="whitespace-nowrap">
              <kbd className="readout rounded-sm border border-line bg-raised px-1 text-[10px] text-ink">{key === '空格' ? t('空格', 'Space') : key}</kbd> {t(action, KEY_ACTION_ENGLISH[key] ?? action)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
