/** 图纸只引用已知模块；物理参数由内容目录提供，不信任存档中的数值。 */
import { analyzeVehicle } from './analysis';
import type { PayloadDefinition, StageDefinition, StructuralLimits, VehicleDefinition } from './types';

export interface StageModule {
  readonly id: string;
  readonly label: string;
  readonly stage: StageDefinition;
  readonly structure: StructuralLimits;
  /** 来源：原型火箭的标识，以及该模块在原型中的位置（自下而上的下标）。原配的上下两级之间有真实的级间段。 */
  readonly origin: { readonly vehicleId: string; readonly position: number };
}
export interface PayloadModule {
  readonly id: string;
  readonly payload: PayloadDefinition;
  /** 原生安装接口直径，不等同于整流罩最大直径。 */
  readonly mountingDiameter: number;
  /** 来源：原型火箭的标识，以及原型中最上面一级的位置。 */
  readonly origin: { readonly vehicleId: string; readonly position: number };
}
export interface DesignParts {
  readonly stages: readonly StageModule[];
  readonly payloads: readonly PayloadModule[];
}
export interface RocketDesign {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  /** 自下而上，允许相同模块重复使用。 */
  readonly stages: readonly string[];
  readonly payload: string;
}
export const DESIGN_LIMIT = 20;
export const MAX_DESIGN_STAGES = 4;
export const DESIGN_BACKUP_LIMIT = 64_000;

export function parseDesign(value: unknown, parts: DesignParts): RocketDesign | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Partial<RocketDesign>;
  if (d.version !== 1 || typeof d.id !== 'string' || !/^custom-[a-z0-9-]{1,50}$/.test(d.id) ||
      typeof d.name !== 'string' || !d.name.trim() || d.name.length > 40 ||
      Array.from(d.name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || !Array.isArray(d.stages) ||
      d.stages.length < 1 || d.stages.length > MAX_DESIGN_STAGES ||
      !d.stages.every((id: unknown) => typeof id === 'string' && parts.stages.some((p) => p.id === id)) ||
      !parts.payloads.some((p) => p.id === d.payload)) return null;
  return { version: 1, id: d.id, name: d.name.trim(), stages: [...d.stages], payload: d.payload as string };
}

export function compileDesign(value: unknown, parts: DesignParts): { vehicle: VehicleDefinition | null; errors: string[]; warnings: string[] } {
  const d = parseDesign(value, parts);
  if (!d) return { vehicle: null, errors: ['图纸格式无效，或引用了不存在的模块。'], warnings: [] };
  const modules = d.stages.map((id) => parts.stages.find((p) => p.id === id)!);
  const payload = parts.payloads.find((p) => p.id === d.payload)!;
  // 相邻两个模块：在原型里本来就是上下相接的（有真实的级间段 / 载荷适配器），或者接口直径相同。
  const native = (lower: StageModule, upper: { readonly origin: StageModule['origin'] }): boolean =>
    lower.origin.vehicleId === upper.origin.vehicleId && upper.origin.position === lower.origin.position + 1;
  // 并联助推器只能绑在原配的芯级周围（先检查，给出更明确的原因）
  const strapOnMisplaced = modules.some((module, i) => module.stage.parallel && !(modules[i + 1] && native(module, modules[i + 1]!)));
  if (strapOnMisplaced) {
    return { vehicle: null, errors: ['并联助推器只能放在它原配的芯级下面（不能单独使用，也不能放在最上面）。'], warnings: [] };
  }
  let allNative = true;
  for (let i = 0; i < modules.length; i++) {
    const lower = modules[i]!;
    const upperStage = modules[i + 1];
    if (lower.stage.parallel) continue;
    const isNative = native(lower, upperStage ?? payload);
    const upperDiameter = upperStage ? upperStage.stage.geometry.diameter : payload.mountingDiameter;
    if (!isNative && Math.abs(lower.stage.geometry.diameter - upperDiameter) > 1e-6) {
      return { vehicle: null, errors: ['模块接口直径不同；尚未提供转接结构，请选择接口相同的推进级与载荷。'], warnings: [] };
    }
    if (!isNative) allNative = false;
  }
  const vehicle: VehicleDefinition = {
    id: d.id, name: d.name, nameZh: d.name, role: '自定义火箭',
    description: '由现有完整模块组成的火箭。理想性能不保证入轨，实际飞行受气动、热与结构限制。',
    stages: modules.map((p, i) => ({ ...structuredClone(p.stage), id: `${d.id}-${i}`, name: `第${i + 1}级（${p.label}）` })),
    payload: structuredClone(payload.payload),
    structure: {
      maxGLoad: Math.min(...modules.map((p) => p.structure.maxGLoad)),
      maxDynamicPressure: Math.min(...modules.map((p) => p.structure.maxDynamicPressure)),
      maxBendingLoad: Math.min(...modules.map((p) => p.structure.maxBendingLoad)),
    },
  };
  const perf = analyzeVehicle(vehicle);
  const warnings = perf.liftoffTwr <= 1 ? ['海平面推重比不超过1，满推力也无法从发射台起飞。'] : [];
  if (vehicle.stages.length > 3 && !allNative) warnings.push('四级构型尚无任务驾驶基准，请通过自由飞行验证。');
  return { vehicle, errors: [], warnings };
}

/** 整份导入原子校验；不静默截断、替换损坏条目或丢掉未知版本。 */
export function parseDesignBackup(value: unknown, parts: DesignParts): readonly RocketDesign[] | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as { version?: unknown; designs?: unknown };
  if (saved.version !== 1 || !Array.isArray(saved.designs) || saved.designs.length > DESIGN_LIMIT) return null;
  const designs: RocketDesign[] = [];
  for (const raw of saved.designs) {
    const d = parseDesign(raw, parts);
    if (!d || !compileDesign(d, parts).vehicle || designs.some((existing) => existing.id === d.id)) return null;
    designs.push(d);
  }
  return designs;
}
