import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { type Group, Quaternion, Vector3 } from 'three';
import type { DebrisState, SimSnapshot } from '@/game/simulation/types';
import { activePropulsion, stageAloneMassProperties } from '@/game/vehicles/configuration';
import type { VehicleDefinition } from '@/game/vehicles/types';
import { FRAME_PRIORITY, frameState } from '../core/frameState';
import { eciOrientationToRender, eciToRenderRelative } from '../core/renderSpace';
import { incandescence } from '../effects/reentryVisuals';
import { EnginePlume } from './EnginePlume';
import { RocketSectionMesh, createRocketMaterials } from './RocketModel';
import { type RocketSection, buildRocketLayout } from './rocketLayout';

/** 模型坐标（+Y 为头部）→ 机体系（+X 为头部）：绕 Z 轴旋转 −90°。 */
const MODEL_TO_BODY = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);

/** 分段当前是否仍连接在飞行器上。 */
const isAttached = (section: RocketSection, snapshot: SimSnapshot): boolean => {
  switch (section.kind) {
    case 'stage':
      return snapshot.vehicle.stages[section.stageIndex]?.attached ?? false;
    case 'fairing':
      return snapshot.vehicle.fairingAttached;
    case 'heat-shield':
      return snapshot.vehicle.heatShieldAttached;
    default:
      return true;
  }
};

const findDebris = (section: RocketSection, debris: readonly DebrisState[]): DebrisState | undefined =>
  section.kind === 'stage'
    ? debris.find((d) => d.kind === 'stage' && d.stageIndex === section.stageIndex)
    : section.kind === 'fairing'
      ? debris.find((d) => d.kind === 'fairing' && d.half === section.half)
      : section.kind === 'heat-shield'
        ? debris.find((d) => d.kind === 'heat-shield')
        : undefined;

/**
 * 飞行器的全部分段。每个分段每帧处于三种状态之一：
 *  - 仍连接：跟随飞行器的位置与姿态（模型质心与物理质心重合）；
 *  - 已分离且仍被跟踪：跟随对应分离体的位置与姿态；
 *  - 其余情况（分离体已落地或超出跟踪时限、飞行器损毁）：隐藏。
 * 位置一律取"相对相机"的双精度差值（浮动原点）。
 */
export function VehicleAssembly({ vehicle }: { vehicle: VehicleDefinition }) {
  const layout = useMemo(() => buildRocketLayout(vehicle), [vehicle]);
  const materials = useMemo(createRocketMaterials, []);
  const outer = useRef<(Group | null)[]>([]);
  const inner = useRef<(Group | null)[]>([]);

  useFrame(() => {
    const snapshot = frameState.snapshot;
    const visible = frameState.valid && snapshot !== null;
    // 防热大底的炽热：自发光颜色取自物理线程算出的大底表面温度
    const shield = snapshot?.vehicle.thermal.find((zone) => zone.zone === 'base' && zone.ablative);
    const [glowR, glowG, glowB] = incandescence(shield?.surfaceTemperature ?? 0);
    materials.heatShield.emissive.setRGB(glowR, glowG, glowB);
    // 当前构型中最低连接分段的底面高度：飞行器"底端"的基准
    let base = 0;
    if (snapshot) {
      base = Infinity;
      for (const section of layout.sections) if (isAttached(section, snapshot)) base = Math.min(base, section.baseY);
    }

    layout.sections.forEach((section, i) => {
      const o = outer.current[i];
      const n = inner.current[i];
      if (!o || !n) return;
      if (!visible || !snapshot) {
        o.visible = false;
        return;
      }
      if (isAttached(section, snapshot)) {
        o.visible = snapshot.vehicle.phase !== 'destroyed';
        eciToRenderRelative(frameState.vehiclePosition, frameState.cameraPosition, o.position);
        eciOrientationToRender(frameState.vehicleAttitude, o.quaternion).multiply(MODEL_TO_BODY);
        n.position.set(0, section.baseY - base - frameState.centerOfMassHeight, 0);
        return;
      }
      const debris = findDebris(section, frameState.debris);
      if (!debris) {
        o.visible = false;
        return;
      }
      o.visible = true;
      eciToRenderRelative(debris.position, frameState.cameraPosition, o.position);
      eciOrientationToRender(debris.attitude, o.quaternion).multiply(MODEL_TO_BODY);
      // 分离体的参考点：箭体为其质心，整流罩半罩与防热大底为轴线上的几何中心。
      const stage = vehicle.stages[section.stageIndex];
      const pivot =
        section.kind === 'stage' && stage
          ? stageAloneMassProperties(stage, debris.propellantMass).centerOfMassHeight
          : section.length / 2;
      n.position.set(0, -pivot, 0);
    });
  }, FRAME_PRIORITY.SCENE);

  return (
    <>
      {layout.sections.map((section, i) => (
        <group
          key={section.id}
          ref={(g) => {
            outer.current[i] = g;
          }}
          visible={false}
        >
          <group
            ref={(g) => {
              inner.current[i] = g;
            }}
          >
            <RocketSectionMesh section={section} materials={materials} />
            {section.plumes.length > 0 && (
              <EnginePlume
                exits={section.plumes}
                propellant={(section.kind === 'stage' ? vehicle.stages[section.stageIndex]?.engine : vehicle.payload.engine)?.propellant ?? 'kerolox'}
                sample={() => {
                  // 尾焰只属于"当前工作的推进单元"，强度取自物理状态中的实际推力。
                  const snapshot = frameState.snapshot;
                  if (!snapshot || snapshot.vehicle.phase === 'destroyed') return null;
                  const propulsion = activePropulsion(vehicle, snapshot.vehicle);
                  if (!propulsion) return null;
                  const mine =
                    section.kind === 'stage'
                      ? propulsion.source === 'stage' && propulsion.stageIndex === section.stageIndex
                      : propulsion.source === 'payload';
                  if (!mine) return null;
                  const rated = propulsion.engine.thrustVacuum * propulsion.engineCount;
                  return { level: snapshot.vehicle.flight.thrust / rated, ambientPressure: snapshot.vehicle.flight.ambientPressure };
                }}
              />
            )}
          </group>
        </group>
      ))}
    </>
  );
}
