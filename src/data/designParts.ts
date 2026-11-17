/** 设计器复用完整推进级：干质量已包含原发动机、箱体和级间段。没有新增未经标定的硬件参数。 */
import type { DesignParts, RocketDesign } from '@/game/vehicles/design';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { VEHICLE_CATALOG } from './vehicles';

export const DESIGN_PARTS: DesignParts = {
  stages: VEHICLE_CATALOG.flatMap((vehicle) => vehicle.stages.map((stage) => ({
    id: stage.id, label: `${vehicle.nameZh}·${stage.name}`, stage, structure: vehicle.structure,
  }))),
  payloads: VEHICLE_CATALOG.map((vehicle) => ({
    id: vehicle.payload.id, payload: vehicle.payload,
    mountingDiameter: vehicle.stages[vehicle.stages.length - 1]!.geometry.diameter,
  })),
};
export const designFromVehicle = (vehicle: VehicleDefinition, id: string): RocketDesign => ({
  version: 1, id, name: `${vehicle.nameZh}改型`, stages: vehicle.stages.map((s) => s.id), payload: vehicle.payload.id,
});
