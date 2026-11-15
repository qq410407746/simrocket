/**
 * 程序化火箭外形：把飞行器定义（物理参数）转换成一组几何部件描述。
 *
 * 纯数据、纯函数——不依赖 Three.js，可单元测试。渲染组件只负责把部件画出来。
 * 外形尺寸全部来自 VehicleDefinition，因此模型高度、直径与物理模型使用的数值一致。
 *
 * 模型按"可分离单元"组织成分段：每个推进级、返回舱/卫星、整流罩的两个半罩。
 * 分级后，被抛掉的分段跟随对应的分离体运动，其余分段继续跟随飞行器。
 *
 * 模型坐标：+Y 沿箭体纵轴指向头部，y = 0 为分段底面；单位 m。
 * 与机体系的关系：模型 +Y = 机体 +X，模型 +X = 机体 −Y，模型 +Z = 机体 +Z。
 */
import type { CapsuleDefinition, SatelliteDefinition, StageDefinition, VehicleDefinition } from '@/game/vehicles/types';

export type RocketMaterial = 'paint' | 'dark' | 'accent' | 'nozzle' | 'heatShield' | 'metal' | 'foil' | 'solar';

/** 回转体：由 (半径, 高度) 剖面绕 Y 轴旋转而成。 */
export interface LathePart {
  readonly kind: 'lathe';
  /** 剖面点 [半径 m, 高度 m]，高度相对所在分段底面，自下而上。 */
  readonly profile: readonly (readonly [number, number])[];
  readonly material: RocketMaterial;
  /** 回转的起始角与张角 [rad]；缺省为整圈。角度 0 在模型 +Z，π/2 在模型 +X。 */
  readonly phiStart?: number;
  readonly phiLength?: number;
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

/** 长方体细节（电缆整流罩、卫星本体、太阳翼等）。 */
export interface BoxPart {
  readonly kind: 'box';
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly material: RocketMaterial;
}

export type RocketPart = LathePart | NozzlePart | BoxPart;

export type SectionKind = 'stage' | 'capsule' | 'satellite' | 'fairing';

/** 尾焰的出口：位置（相对分段底面）与出口半径 [m]。 */
export interface PlumeExit {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** 一个可分离的分段。 */
export interface RocketSection {
  readonly id: string;
  readonly kind: SectionKind;
  /** kind 为 'stage' 时对应 definition.stages 的下标，否则为 −1。 */
  readonly stageIndex: number;
  /** kind 为 'fairing' 时：+1 为模型 +X 一侧的半罩，−1 为另一侧；否则为 0。 */
  readonly half: -1 | 0 | 1;
  /** 分段底面在整箭（满构型）中的高度 [m]。 */
  readonly baseY: number;
  /** 分段的名义长度 [m]（与物理定义一致）。 */
  readonly length: number;
  /** 超出名义长度的部分 [m]：级间段包住上一级的发动机，分离时随本级一起脱落。 */
  readonly overhang: number;
  readonly parts: readonly RocketPart[];
  /** 本分段作为推进单元工作时的尾焰出口。 */
  readonly plumes: readonly PlumeExit[];
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

/** 上面级底部发动机舱（被下一级的级间段包住的部分）的长度 [m]。 */
const engineBayLength = (stage: StageDefinition): number => {
  const exitRadius = Math.sqrt(stage.engine.nozzleExitArea / Math.PI);
  return Math.min(stage.geometry.length * 0.3, exitRadius * 2.2 + 0.6);
};

const buildStage = (vehicle: VehicleDefinition, index: number, baseY: number): RocketSection => {
  const stage = vehicle.stages[index] as StageDefinition;
  const above = vehicle.stages[index + 1];
  const radius = stage.geometry.diameter / 2;
  const length = stage.geometry.length;
  const parts: RocketPart[] = [];
  const plumes: PlumeExit[] = [];
  const exitRadius = Math.sqrt(stage.engine.nozzleExitArea / Math.PI);
  const { positions, radius: nozzleRadius } = nozzleArrangement(stage.engineCount, exitRadius, radius);

  let bodyStart: number;
  if (index === 0) {
    // 底级：喷管从尾段伸出一部分
    const nozzleLength = Math.min(nozzleRadius * 2.6, length * 0.12);
    bodyStart = nozzleLength * 0.5;
    for (const [x, z] of positions) {
      parts.push({ kind: 'nozzle', x, z, y: 0, length: nozzleLength, exitRadius: nozzleRadius, throatRadius: nozzleRadius * 0.38 });
      plumes.push({ x, y: 0, z, radius: nozzleRadius });
    }
    // 尾段底板与推力结构裙
    parts.push({ kind: 'lathe', profile: [[0, bodyStart + 0.02], [radius * 0.97, bodyStart + 0.02], [radius, bodyStart]], material: 'dark' });
    const skirtTop = bodyStart + Math.min(length * 0.07, radius * 1.4);
    parts.push(cylinder(radius, bodyStart, skirtTop, 'dark'));
    bodyStart = skirtTop;
  } else {
    // 上面级：底部是发动机舱。喷管平时被下一级的级间段包住，分离后露出。
    const bay = engineBayLength(stage);
    const nozzleLength = bay * 0.82;
    for (const [x, z] of positions) {
      parts.push({ kind: 'nozzle', x, z, y: 0.04, length: nozzleLength, exitRadius: nozzleRadius, throatRadius: nozzleRadius * 0.3 });
      plumes.push({ x, y: 0.04, z, radius: nozzleRadius });
    }
    // 推力锥与贮箱底
    parts.push({ kind: 'lathe', profile: [[nozzleRadius * 0.34, 0.04 + nozzleLength], [radius * 0.55, bay - 0.02], [radius * 0.98, bay]], material: 'metal' });
    bodyStart = bay;
  }

  const bandHeight = above ? Math.min(length * 0.035, 0.9) : 0;
  const bodyEnd = length - bandHeight;
  const accentHeight = Math.min(0.5, length * 0.03);
  if (above) {
    parts.push(cylinder(radius, bodyStart, bodyEnd, 'paint'));
    parts.push(cylinder(radius * 1.004, bodyEnd, length, 'dark'));
  } else {
    // 最上面一级：顶部一圈识别色带
    parts.push(cylinder(radius, bodyStart, bodyEnd - accentHeight * 2, 'paint'));
    parts.push(cylinder(radius * 1.003, bodyEnd - accentHeight * 2, bodyEnd - accentHeight, 'accent'));
    parts.push(cylinder(radius, bodyEnd - accentHeight, bodyEnd, 'paint'));
    // 顶盖（载荷分离后可见）
    parts.push({ kind: 'lathe', profile: [[radius, length - 0.01], [0, length - 0.01]], material: 'dark' });
  }

  // 级间段：包住上一级的发动机舱，分离时随本级脱落
  const overhang = above ? engineBayLength(above) : 0;
  if (above) {
    const upperRadius = above.geometry.diameter / 2;
    parts.push({
      kind: 'lathe',
      profile: [
        [radius * 1.004, length],
        [upperRadius * 1.004, length + overhang],
      ],
      material: 'dark',
    });
  }

  // 电缆整流罩：沿箭体外侧的一条细长凸起，也让滚转姿态肉眼可辨
  const racewayLength = (bodyEnd - bodyStart) * 0.86;
  parts.push({
    kind: 'box',
    center: [radius + 0.05, bodyStart + (bodyEnd - bodyStart) / 2, 0],
    size: [0.14, racewayLength, Math.max(0.22, radius * 0.14)],
    material: 'dark',
  });

  return { id: stage.id, kind: 'stage', stageIndex: index, half: 0, baseY, length, overhang, parts, plumes };
};

const buildCapsule = (capsule: CapsuleDefinition, baseY: number): RocketSection => {
  const r = capsule.geometry.diameter / 2;
  const h = capsule.geometry.length;
  const parts: RocketPart[] = [
    // 防热大底（朝下，发射时坐落在上面级顶部）
    { kind: 'lathe', profile: [[0, 0], [r * 0.6, h * 0.015], [r * 0.93, h * 0.06], [r, h * 0.13]], material: 'heatShield' },
    // 锥形侧壁
    { kind: 'lathe', profile: [[r, h * 0.13], [r * 0.985, h * 0.2], [r * 0.44, h * 0.86]], material: 'paint' },
    // 侧壁上的识别色带
    { kind: 'lathe', profile: [[r * 0.992, h * 0.2], [r * 0.925, h * 0.285]], material: 'accent' },
    // 顶部对接机构
    { kind: 'lathe', profile: [[r * 0.44, h * 0.86], [r * 0.4, h * 0.96], [r * 0.3, h], [0, h]], material: 'metal' },
  ];
  // 飞船机动发动机的安装位置为简化处理：推力沿纵轴，尾焰从底部中心画出。
  const plumes: PlumeExit[] = capsule.engine ? [{ x: 0, y: 0, z: 0, radius: Math.max(0.12, r * 0.09) }] : [];
  return { id: capsule.id, kind: 'capsule', stageIndex: -1, half: 0, baseY, length: h, overhang: 0, parts, plumes };
};

const buildSatellite = (satellite: SatelliteDefinition, baseY: number): RocketSection => {
  const h = satellite.geometry.length;
  const w = satellite.geometry.diameter * 0.62;
  const adapter = Math.min(0.5, h * 0.12);
  const busHeight = h * 0.62;
  const panelWidth = w * 0.92;
  const parts: RocketPart[] = [
    // 星箭适配器
    { kind: 'lathe', profile: [[w * 0.62, 0], [w * 0.42, adapter]], material: 'metal' },
    // 卫星本体（包覆多层隔热材料）
    { kind: 'box', center: [0, adapter + busHeight / 2, 0], size: [w, busHeight, w], material: 'foil' },
    // 收拢状态的太阳翼，贴在本体两侧
    { kind: 'box', center: [w / 2 + 0.06, adapter + busHeight / 2, 0], size: [0.08, busHeight * 0.94, panelWidth], material: 'solar' },
    { kind: 'box', center: [-w / 2 - 0.06, adapter + busHeight / 2, 0], size: [0.08, busHeight * 0.94, panelWidth], material: 'solar' },
    // 顶部天线
    { kind: 'lathe', profile: [[0.06, adapter + busHeight], [0.06, adapter + busHeight + h * 0.08], [w * 0.42, h * 0.97], [w * 0.44, h]], material: 'paint' },
  ];
  return { id: satellite.id, kind: 'satellite', stageIndex: -1, half: 0, baseY, length: h, overhang: 0, parts, plumes: [] };
};

const buildFairingHalf = (satellite: SatelliteDefinition, stageRadius: number, baseY: number, half: 1 | -1): RocketSection => {
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
  // 半罩之间留一条细缝，两瓣的分界面是模型的 YZ 平面。
  const gap = 0.012;
  const sweep = { phiStart: (half === 1 ? 0 : Math.PI) + gap, phiLength: Math.PI - 2 * gap };
  const lathe = (profile: readonly (readonly [number, number])[], material: RocketMaterial): LathePart => ({
    kind: 'lathe',
    profile,
    material,
    ...sweep,
  });
  const parts: RocketPart[] = [
    lathe([[stageRadius, 0], [r, flareTop]], 'dark'),
    lathe([[r, flareTop], [r, cylinderTop - 0.9]], 'paint'),
    lathe([[r * 1.003, cylinderTop - 0.9], [r * 1.003, cylinderTop - 0.45]], 'accent'),
    lathe([[r, cylinderTop - 0.45], [r, cylinderTop]], 'paint'),
    lathe(ogive, 'paint'),
  ];
  return {
    id: `${satellite.id}-fairing-${half === 1 ? 'a' : 'b'}`,
    kind: 'fairing',
    stageIndex: -1,
    half,
    baseY,
    length: h,
    overhang: 0,
    parts,
    plumes: [],
  };
};

export const buildRocketLayout = (vehicle: VehicleDefinition): RocketLayout => {
  const sections: RocketSection[] = [];
  let y = 0;
  let maxRadius = 0;
  vehicle.stages.forEach((stage, i) => {
    sections.push(buildStage(vehicle, i, y));
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
    sections.push(buildSatellite(payload, y));
    sections.push(buildFairingHalf(payload, topRadius, y, 1));
    sections.push(buildFairingHalf(payload, topRadius, y, -1));
    y += payload.fairing.geometry.length;
    maxRadius = Math.max(maxRadius, payload.fairing.geometry.diameter / 2);
  }
  return { sections, height: y, maxRadius };
};
