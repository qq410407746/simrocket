/**
 * 程序化火箭外形：把飞行器定义（物理参数）转换成一组几何部件描述。
 *
 * 纯数据、纯函数——不依赖 Three.js，可单元测试。渲染组件只负责把部件画出来。
 * 外形尺寸全部来自 VehicleDefinition，因此模型高度、直径与物理模型使用的数值一致。
 *
 * 模型坐标：+Y 沿箭体纵轴指向头部，y = 0 为飞行器底端；单位 m。
 */
import type { CapsuleDefinition, SatelliteDefinition, StageDefinition, VehicleDefinition } from '@/game/vehicles/types';

export type RocketMaterial = 'paint' | 'dark' | 'accent' | 'nozzle' | 'heatShield' | 'metal';

/** 回转体：由 (半径, 高度) 剖面绕 Y 轴旋转而成。 */
export interface LathePart {
  readonly kind: 'lathe';
  /** 剖面点 [半径 m, 高度 m]，高度相对所在分段底面，自下而上。 */
  readonly profile: readonly (readonly [number, number])[];
  readonly material: RocketMaterial;
}

/** 发动机喷管（开口朝下的截锥壳）。 */
export interface NozzlePart {
  readonly kind: 'nozzle';
  /** 喷管轴线在横截面内的位置 [m]。 */
  readonly x: number;
  readonly z: number;
  /** 喷管出口所在高度 [m]（相对分段底面）。 */
  readonly y: number;
  readonly length: number;
  readonly exitRadius: number;
  readonly throatRadius: number;
}

/** 长方体细节（电缆整流罩等）。 */
export interface BoxPart {
  readonly kind: 'box';
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly material: RocketMaterial;
}

export type RocketPart = LathePart | NozzlePart | BoxPart;

/** 一个可分离的分段（某一级或载荷），为阶段二的分级动画预留。 */
export interface RocketSection {
  readonly id: string;
  readonly kind: 'stage' | 'payload';
  /** 分段底面在整箭中的高度 [m]。 */
  readonly baseY: number;
  readonly length: number;
  readonly parts: readonly RocketPart[];
}

export interface RocketLayout {
  readonly sections: readonly RocketSection[];
  readonly height: number;
  readonly maxRadius: number;
}

const cylinder = (radius: number, y0: number, y1: number, material: RocketMaterial): LathePart => ({
  kind: 'lathe',
  profile: [
    [radius, y0],
    [radius, y1],
  ],
  material,
});

/**
 * 发动机喷管在底面上的排布：1 台居中；2–4 台排成一圈；更多时 1 台居中、其余排成一圈。
 * 若喷管放不下，则按比例缩小显示半径（仅影响外观，不影响物理参数）。
 */
export const nozzleArrangement = (
  count: number,
  exitRadius: number,
  bodyRadius: number,
): { positions: readonly (readonly [number, number])[]; radius: number } => {
  const margin = bodyRadius * 0.04;
  if (count <= 1) return { positions: [[0, 0]], radius: Math.min(exitRadius, bodyRadius * 0.86) };
  const ringCount = count <= 4 ? count : count - 1;
  const sinHalf = Math.sin(Math.PI / ringCount);
  // 相邻喷管不重叠：2r ≤ 2·ringRadius·sin(π/n)，且 ringRadius = bodyRadius − margin − r
  let radius = Math.min(exitRadius, ((bodyRadius - margin) * sinHalf) / (1 + sinHalf));
  let ringRadius = bodyRadius - margin - radius;
  // 中心喷管不与外圈重叠
  if (count > 4 && ringRadius < 2 * radius) {
    radius = (bodyRadius - margin) / 3;
    ringRadius = bodyRadius - margin - radius;
  }
  const positions: [number, number][] = count > 4 ? [[0, 0]] : [];
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2 + Math.PI / ringCount;
    positions.push([ringRadius * Math.cos(a), ringRadius * Math.sin(a)]);
  }
  return { positions, radius };
};

const buildStage = (stage: StageDefinition, index: number, stageCount: number, baseY: number): RocketSection => {
  const radius = stage.geometry.diameter / 2;
  const length = stage.geometry.length;
  const parts: RocketPart[] = [];
  const isBottom = index === 0;
  const hasStageAbove = index < stageCount - 1;
  const exitRadius = Math.sqrt(stage.engine.nozzleExitArea / Math.PI);

  let bodyStart: number;
  if (isBottom) {
    // 底级：喷管从尾段伸出一部分
    const { positions, radius: nozzleRadius } = nozzleArrangement(stage.engineCount, exitRadius, radius);
    const nozzleLength = Math.min(nozzleRadius * 2.6, length * 0.12);
    bodyStart = nozzleLength * 0.5;
    for (const [x, z] of positions) {
      parts.push({ kind: 'nozzle', x, z, y: 0, length: nozzleLength, exitRadius: nozzleRadius, throatRadius: nozzleRadius * 0.38 });
    }
    // 尾段底板与推力结构裙
    parts.push({ kind: 'lathe', profile: [[0, bodyStart + 0.02], [radius * 0.97, bodyStart + 0.02], [radius, bodyStart]], material: 'dark' });
    const skirtTop = bodyStart + Math.min(length * 0.07, radius * 1.4);
    parts.push(cylinder(radius, bodyStart, skirtTop, 'dark'));
    bodyStart = skirtTop;
  } else {
    // 上面级：底部是包住真空喷管的级间段
    const interstage = Math.min(length * 0.3, exitRadius * 2.2 + 0.6);
    parts.push(cylinder(radius, 0, interstage, 'dark'));
    bodyStart = interstage;
  }

  const bodyEnd = hasStageAbove ? length - Math.min(length * 0.035, 0.9) : length;
  const accentHeight = Math.min(0.5, length * 0.03);
  if (hasStageAbove) {
    parts.push(cylinder(radius, bodyStart, bodyEnd, 'paint'));
    parts.push(cylinder(radius * 1.004, bodyEnd, length, 'dark'));
  } else {
    // 最上面一级：顶部一圈识别色带
    parts.push(cylinder(radius, bodyStart, bodyEnd - accentHeight * 2, 'paint'));
    parts.push(cylinder(radius * 1.003, bodyEnd - accentHeight * 2, bodyEnd - accentHeight, 'accent'));
    parts.push(cylinder(radius, bodyEnd - accentHeight, bodyEnd, 'paint'));
  }

  // 电缆整流罩：沿箭体外侧的一条细长凸起，也让滚转姿态肉眼可辨
  const racewayLength = (bodyEnd - bodyStart) * 0.86;
  parts.push({
    kind: 'box',
    center: [radius + 0.05, bodyStart + (bodyEnd - bodyStart) / 2, 0],
    size: [0.14, racewayLength, Math.max(0.22, radius * 0.14)],
    material: 'dark',
  });

  return { id: stage.id, kind: 'stage', baseY, length, parts };
};

const buildCapsule = (capsule: CapsuleDefinition, baseY: number): RocketSection => {
  const r = capsule.geometry.diameter / 2;
  const h = capsule.geometry.length;
  const parts: RocketPart[] = [
    // 防热大底（朝下，发射时被级间适配器遮住一部分）
    { kind: 'lathe', profile: [[0, 0], [r * 0.6, h * 0.015], [r * 0.93, h * 0.06], [r, h * 0.13]], material: 'heatShield' },
    // 锥形侧壁
    { kind: 'lathe', profile: [[r, h * 0.13], [r * 0.985, h * 0.2], [r * 0.44, h * 0.86]], material: 'paint' },
    // 侧壁上的识别色带
    { kind: 'lathe', profile: [[r * 0.992, h * 0.2], [r * 0.925, h * 0.285]], material: 'accent' },
    // 顶部对接机构
    { kind: 'lathe', profile: [[r * 0.44, h * 0.86], [r * 0.4, h * 0.96], [r * 0.3, h], [0, h]], material: 'metal' },
  ];
  return { id: capsule.id, kind: 'payload', baseY, length: h, parts };
};

const buildFairing = (satellite: SatelliteDefinition, stageRadius: number, baseY: number): RocketSection => {
  const r = satellite.fairing.geometry.diameter / 2;
  const h = satellite.fairing.geometry.length;
  const flareTop = h * 0.07;
  const cylinderTop = h * 0.52;
  const ogive: [number, number][] = [];
  const OGIVE_POINTS = 14;
  for (let i = 0; i <= OGIVE_POINTS; i++) {
    const s = i / OGIVE_POINTS;
    ogive.push([r * Math.pow(Math.max(0, 1 - s * s), 0.62), cylinderTop + (h - cylinderTop) * s]);
  }
  const parts: RocketPart[] = [
    { kind: 'lathe', profile: [[stageRadius, 0], [r, flareTop]], material: 'dark' },
    cylinder(r, flareTop, cylinderTop - 0.9, 'paint'),
    cylinder(r * 1.003, cylinderTop - 0.9, cylinderTop - 0.45, 'accent'),
    cylinder(r, cylinderTop - 0.45, cylinderTop, 'paint'),
    { kind: 'lathe', profile: ogive, material: 'paint' },
    // 整流罩分离缝
    { kind: 'box', center: [0, flareTop + (cylinderTop - flareTop) / 2, r + 0.01], size: [0.08, cylinderTop - flareTop, 0.05], material: 'dark' },
  ];
  return { id: satellite.id, kind: 'payload', baseY, length: h, parts };
};

export const buildRocketLayout = (vehicle: VehicleDefinition): RocketLayout => {
  const sections: RocketSection[] = [];
  let y = 0;
  let maxRadius = 0;
  vehicle.stages.forEach((stage, i) => {
    sections.push(buildStage(stage, i, vehicle.stages.length, y));
    y += stage.geometry.length;
    maxRadius = Math.max(maxRadius, stage.geometry.diameter / 2);
  });
  const topStage = vehicle.stages[vehicle.stages.length - 1];
  const topRadius = topStage ? topStage.geometry.diameter / 2 : 1;
  const { payload } = vehicle;
  if (payload.kind === 'capsule') {
    sections.push(buildCapsule(payload, y));
    y += payload.geometry.length;
    maxRadius = Math.max(maxRadius, payload.geometry.diameter / 2);
  } else {
    sections.push(buildFairing(payload, topRadius, y));
    y += payload.fairing.geometry.length;
    maxRadius = Math.max(maxRadius, payload.fairing.geometry.diameter / 2);
  }
  return { sections, height: y, maxRadius };
};
