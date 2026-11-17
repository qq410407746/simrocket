import { nodeAtPosition } from '@/game/physics/orbital/planning';
import { ecefToEci, geodeticToEcef } from '@/game/physics/frames/frames';
import { groundTrack, SYNCHRONOUS_RADIUS } from '@/game/physics/orbital/advanced';
import { stateFromElements } from '@/game/physics/orbital/elements';
import { useSimStore } from '@/stores/simStore';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, type InterleavedBufferAttribute, type Sprite } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH } from '@/game/physics/constants';
import { type Vec3, vec3 } from '@/game/physics/math/vec3';
import { elementsFromState, perifocalBasis, positionAtTrueAnomaly } from '@/game/physics/orbital/elements';
import { sampleConic } from '@/game/physics/orbital/sampling';
import { simRuntime } from '@/stores/simRuntime';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { isOccludedByEarth } from '../core/occlusion';
import { eciToRenderRelative } from '../core/renderSpace';

/** 当前轨道折线的段数；预测轨迹的最多点数（与物理线程输出的上限一致）。 */
const ORBIT_SEGMENTS = 256;
const PREDICTION_POINTS = 400;
/** 开放轨道与极扁椭圆画到多远 [m]。 */
const MAX_DRAW_RADIUS = 60 * EARTH.RADIUS;
const MARKER_PIXELS = 34;

/** 可原地更新顶点的粗线（Line2）。几何体按最大点数一次分配，之后只改写缓冲区内容。 */
class PolyLine {
  readonly object: Line2;
  private readonly segments: Float32Array;
  private readonly attribute: InterleavedBufferAttribute;
  private readonly geometry: LineGeometry;
  private readonly material: LineMaterial;
  private readonly baseOpacity: number;

  constructor(maxPoints: number, color: string, width: number, opacity: number) {
    this.geometry = new LineGeometry();
    this.geometry.setPositions(new Float32Array(maxPoints * 3));
    this.attribute = this.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute;
    this.segments = this.attribute.data.array as Float32Array;
    this.baseOpacity = opacity;
    this.material = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
    this.object = new Line2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
    this.object.visible = false;
  }

  /** 写入 count 个点（相机相对的渲染坐标，由 write 逐点给出）。 */
  update(count: number, write: (index: number, out: Float32Array, offset: number) => void, visibility: number): void {
    const segmentCount = Math.min(count - 1, this.segments.length / 6);
    this.object.visible = segmentCount > 0 && visibility > 0;
    if (!this.object.visible) return;
    // 每段存 起点 xyz + 终点 xyz
    write(0, this.segments, 0);
    for (let i = 1; i <= segmentCount; i++) {
      const end = (i - 1) * 6 + 3;
      write(i, this.segments, end);
      if (i < segmentCount) this.segments.copyWithin(i * 6, end, end + 3);
    }
    this.attribute.data.needsUpdate = true;
    this.geometry.instanceCount = segmentCount;
    this.material.opacity = this.baseOpacity * visibility;
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const createLabelTexture = (label: string, color: string, shape: 'up' | 'down' | 'cross'): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (shape === 'cross') {
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(c - 26, c - 26 * s);
        ctx.lineTo(c + 26, c + 26 * s);
        ctx.stroke();
      }
    } else {
      // 指向轨道上该点的小三角 + 文字
      const tip = shape === 'up' ? c + 8 : c - 8;
      const baseY = shape === 'up' ? c - 22 : c + 22;
      ctx.beginPath();
      ctx.moveTo(c, tip);
      ctx.lineTo(c - 18, baseY);
      ctx.lineTo(c + 18, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.font = '700 40px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, c, shape === 'up' ? c - 46 : c + 48);
    }
  }
  return new CanvasTexture(canvas);
};

/**
 * 轨道地图的三维内容：当前（密切）轨道、数值预测轨迹、远/近地点与落点标记。
 *
 * 全部在惯性系中绘制：轨道在画面中保持不动，地球在其中自转。
 * 当前轨道是由此刻的位置与速度解析得到的圆锥曲线（二体，不含阻力）；
 * 预测轨迹来自物理线程的数值传播（含阻力），只在轨道会进入大气层时存在。
 * 曲线使用常规深度测试，被行星着色器输出的地球深度正确遮挡。
 */
export function OrbitMap() {
  const size = useThree((s) => s.size);
  const orbit = useMemo(() => new PolyLine(ORBIT_SEGMENTS + 1, '#5fd4ff', 2.2, 0.95), []);
  const predicted = useMemo(() => new PolyLine(PREDICTION_POINTS, '#ffb347', 2.2, 0.95), []);
  const planned = useMemo(() => new PolyLine(ORBIT_SEGMENTS + 1, '#c4a5ff', 2, 0.9), []);
  const ground = useMemo(() => new PolyLine(181, '#a5d6a7', 1.5, 0.65), []);
  const maneuverMarker = useRef<Sprite>(null);
  const targetOrbit = useMemo(() => new PolyLine(ORBIT_SEGMENTS + 1, '#86efac', 1.5, 0.7), []);
  const apoapsis = useRef<Sprite>(null);
  const periapsis = useRef<Sprite>(null);
  const impact = useRef<Sprite>(null);
  const textures = useMemo(
    () => ({
      apoapsis: createLabelTexture('Ap', '#5fd4ff', 'up'),
      periapsis: createLabelTexture('Pe', '#5fd4ff', 'down'),
      impact: createLabelTexture('', '#ff5d5d', 'cross'),
      maneuver: createLabelTexture('机动', '#c4a5ff', 'up'),
    }),
    [],
  );

  useEffect(
    () => () => {
      orbit.dispose();
      predicted.dispose();
      planned.dispose(); targetOrbit.dispose(); ground.dispose();
      Object.values(textures).forEach((texture) => texture.dispose());
    },
    [orbit, predicted, planned, targetOrbit, ground, textures],
  );

  useFrame(() => {
    const visibility = frameState.valid && frameState.snapshot?.vehicle.phase === 'flight' ? frameState.mapVisibility : 0;
    const camera = frameState.cameraPosition;
    // 线宽以 CSS 像素计：分辨率取画布的 CSS 尺寸，线条在高像素密度屏幕上保持同样的视觉粗细
    orbit.setResolution(size.width, size.height);
    predicted.setResolution(size.width, size.height);
    planned.setResolution(size.width, size.height); targetOrbit.setResolution(size.width, size.height);
    ground.setResolution(size.width, size.height);

    const placeMarker = (sprite: Sprite | null, point: Vec3 | null): void => {
      if (!sprite) return;
      sprite.visible = visibility > 0 && point !== null && !isOccludedByEarth(camera, point);
      if (!sprite.visible || !point) return;
      eciToRenderRelative(point, camera, sprite.position);
      // 标记按 CSS 像素定大小：高像素密度屏幕上不会缩小
      const angular = MARKER_PIXELS * frameState.pixelAngle * frameState.pixelRatio;
      sprite.scale.set(angular, angular, 1);
      sprite.material.opacity = visibility;
    };

    planned.object.visible = false; targetOrbit.object.visible = false; ground.object.visible = false;
    placeMarker(maneuverMarker.current, null);
    if (visibility <= 0) {
      orbit.update(0, () => undefined, 0);
      predicted.update(0, () => undefined, 0);
      placeMarker(apoapsis.current, null);
      placeMarker(periapsis.current, null);
      placeMarker(impact.current, null);
      return;
    }

    // —— 当前轨道（解析圆锥曲线）——
    const elements = elementsFromState(frameState.vehiclePosition, frameState.vehicleVelocity);
    const conic = sampleConic(elements, ORBIT_SEGMENTS, EARTH.RADIUS, MAX_DRAW_RADIUS);
    orbit.update(
      conic.count,
      (i, out, offset) => {
        // (p − camera) 在双精度下相减，再换到渲染坐标轴（x, z, −y）
        out[offset] = (conic.points[i * 3] as number) - camera.x;
        out[offset + 1] = (conic.points[i * 3 + 2] as number) - camera.z;
        out[offset + 2] = -((conic.points[i * 3 + 1] as number) - camera.y);
      },
      visibility,
    );

    const drawOrbit = (line: PolyLine, r: Vec3, v: Vec3) => {
      const curve = sampleConic(elementsFromState(r,v), ORBIT_SEGMENTS, EARTH.RADIUS, MAX_DRAW_RADIUS);
      line.update(curve.count, (i,out,offset) => {
        out[offset] = curve.points[i*3]! - camera.x;
        out[offset+1] = curve.points[i*3+2]! - camera.z;
        out[offset+2] = -(curve.points[i*3+1]! - camera.y);
      }, visibility);
    };
    const node = simRuntime.snapshots.latest?.maneuver;
    if (node) {
      drawOrbit(planned, node.after.position, node.after.velocity);
      placeMarker(maneuverMarker.current, node.position);
    }
    // 星下点轨迹随地球当前姿态显示；每个预测点已经扣除了到达时的地球自转。
    if (elements.kind === 'elliptic' && elements.periapsisRadius > EARTH.RADIUS) {
      const points = groundTrack(frameState.vehiclePosition, frameState.vehicleVelocity,
        frameState.simTime, simRuntime.earthAngleAtEpoch, elements.period);
      ground.update(points.length, (i, out, offset) => {
        const point = points[i]!;
        const eci = ecefToEci(geodeticToEcef({ ...point, altitude: 10_000 }), frameState.earthAngle);
        out[offset] = eci.x - camera.x;
        out[offset + 1] = eci.z - camera.z;
        out[offset + 2] = -(eci.y - camera.y);
      }, visibility);
    }
    const mission = simRuntime.context.mission;
    const status = useSimStore.getState().mission;
    const objective = mission?.objectives.find((o,i) => status?.objectives[i]?.status === 'pending' && (o.spec.kind === 'orbit' || o.spec.kind === 'synchronous'));
    if (objective?.spec.kind === 'orbit' || objective?.spec.kind === 'synchronous') {
      const spec = objective.spec;
      const rp = spec.kind === 'synchronous' ? SYNCHRONOUS_RADIUS : EARTH.RADIUS + spec.minPeriapsis;
      const ra = spec.kind === 'synchronous' ? SYNCHRONOUS_RADIUS : EARTH.RADIUS + (spec.minApoapsis ?? spec.minPeriapsis);
      const e = (ra-rp)/(ra+rp);
      const state = stateFromElements({semiLatusRectum:2*rp*ra/(rp+ra),eccentricity:e,
        inclination:spec.kind === 'synchronous' ? 0 : (spec.inclination?.target ?? elements.inclination),
        raan:elements.raan,argumentOfPeriapsis:elements.argumentOfPeriapsis,trueAnomaly:0});
      drawOrbit(targetOrbit,state.position,state.velocity);
    }

    // —— 拱点标记：只标出位于地面以上的拱点 ——
    const basis = perifocalBasis(elements);
    const hasApoapsis = elements.kind === 'elliptic' && elements.apoapsisRadius > EARTH.RADIUS && elements.apoapsisRadius < MAX_DRAW_RADIUS;
    placeMarker(apoapsis.current, hasApoapsis ? positionAtTrueAnomaly(elements, basis, Math.PI) : null);
    placeMarker(periapsis.current, elements.periapsisRadius > EARTH.RADIUS ? positionAtTrueAnomaly(elements, basis, 0) : null);

    // —— 数值预测轨迹（含阻力）与落点 ——
    const prediction = simRuntime.prediction;
    const points = prediction?.points;
    const count = points ? points.length / 3 : 0;
    predicted.update(
      count,
      (i, out, offset) => {
        const p = points as readonly number[];
        out[offset] = (p[i * 3] as number) - camera.x;
        out[offset + 1] = (p[i * 3 + 2] as number) - camera.z;
        out[offset + 2] = -((p[i * 3 + 1] as number) - camera.y);
      },
      visibility,
    );
    const last = count - 1;
    placeMarker(
      impact.current,
      prediction?.impact && points && last >= 0
        ? vec3(points[last * 3] as number, points[last * 3 + 1] as number, points[last * 3 + 2] as number)
        : null,
    );
  }, FRAME_PRIORITY.SCENE);

  return (
    <>
      <primitive object={orbit.object} onDoubleClick={(event: { point: { x: number; y: number; z: number }; stopPropagation: () => void }) => {
        event.stopPropagation();
        const snapshot = simRuntime.snapshots.latest;
        if (!snapshot || snapshot.vehicle.throttle > 0) return;
        const point = vec3(event.point.x + frameState.cameraPosition.x,
          -event.point.z + frameState.cameraPosition.y, event.point.y + frameState.cameraPosition.z);
        const node = nodeAtPosition(snapshot.vehicle.body.position, snapshot.vehicle.body.velocity, snapshot.simTime, point);
        if (node) simRuntime.setManeuver(node);
      }} />
      <primitive object={predicted.object} />
      <primitive object={planned.object} />
      <primitive object={ground.object} />
      <sprite ref={maneuverMarker} visible={false} renderOrder={9}>
        <spriteMaterial map={textures.maneuver} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
      </sprite>
      <primitive object={targetOrbit.object} />
      <sprite ref={apoapsis} visible={false} renderOrder={9}>
        <spriteMaterial map={textures.apoapsis} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
      </sprite>
      <sprite ref={periapsis} visible={false} renderOrder={9}>
        <spriteMaterial map={textures.periapsis} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
      </sprite>
      <sprite ref={impact} visible={false} renderOrder={9}>
        <spriteMaterial map={textures.impact} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
      </sprite>
    </>
  );
}
