/**
 * 任务可以被完成：让"照着提示操作"的测试驾驶员把目录里的每个任务从头飞到有结论。
 * 数据流与游戏运行时相同（物理步 → 快照 → 10 Hz 遥测 → 任务判定 → 评分）。
 * 这些驾驶员只做键盘能做的操作，飞得故意粗糙：它们的得分是评分线的参照，不是上限。
 */
import { describe, expect, it } from 'vitest';
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { MISSION_CATALOG } from '@/data/missions';
import { getVehicleOrDefault } from '@/data/vehicles';
import { RAD2DEG } from '../physics/constants';
import type { Simulation } from '../simulation/Simulation';
import { type HandFlownOptions, HandFlownPilot } from '../simulation/testing/handFlownPilot';
import { type ReturnOptions, ReturnPilot, SuborbitalPilot } from '../simulation/testing/missionPilots';
import type { SimulationConfig } from '../simulation/types';
import { fineKickKeys, headingOfCombo, launchGuidance } from './guidance';
import { type MissionFlight, type MissionPilot, type PilotFactory, flyMission } from './testing/flyMission';
import { missionOrbitRequirement } from './tracker';
import type { MissionDefinition } from './types';

const missionOf = (id: string): MissionDefinition => MISSION_CATALOG.find((m) => m.id === id) as MissionDefinition;
const siteOf = (mission: MissionDefinition) => launchSiteGeodetic(getLaunchSiteOrDefault(mission.siteId));
const fly = (id: string, pilot: PilotFactory, timeout?: number): MissionFlight => {
  const mission = missionOf(id);
  return flyMission(mission, getVehicleOrDefault(mission.vehicleId), siteOf(mission), pilot, timeout);
};
const points = (flight: MissionFlight): Record<string, number> => Object.fromEntries(flight.score.items.map((item) => [item.id, item.points]));

/** 宇宙神 V 401：推重比低，晚一些、轻一些地倾斜；芯级末段把过载压在 5 g（RD-180 可以节流）。 */
const ATLAS_ASCENT: Partial<HandFlownOptions> = { kickSpeed: 100, kickAngleDeg: 1.5, maxGLoad: 5 };

/**
 * 入轨（可选：之后返回）的驾驶员：按任务的发射引导选择起飞倾斜用的键；有倾角要求时用航向修正。
 * 发射方位角与八个键盘方向差得较多时（拜科努尔飞 51.6°），起飞倾斜按"按住一个键、间断点按另一个键"的方法对准方位角。
 * 轨道目标确认之后才开始返回。
 */
const orbitalPilot = (id: string, extra: Partial<HandFlownOptions> = {}, back: ReturnOptions | null = null, steer = true): PilotFactory => {
  const mission = missionOf(id);
  const guidance = launchGuidance(mission, siteOf(mission).latitude);
  const target = missionOrbitRequirement(mission)?.inclination?.target;
  return (sim: Simulation, config: SimulationConfig): MissionPilot => {
    const ascent = new HandFlownPilot(sim, config, {
      targetAltitude: 200_000,
      kickAngleDeg: 2.5,
      pitchStepDeg: 2,
      decisionInterval: 2,
      kickHeadingDeg: headingOfCombo(guidance.lower),
      kickAzimuthDeg: fineKickKeys(guidance.azimuthDeg) ? guidance.azimuthDeg : undefined,
      inclination:
        steer && target !== undefined ? { target, increase: guidance.direction === 'ascending' ? 'left' : 'right' } : undefined,
      ...extra,
    });
    const descent = back ? new ReturnPilot(sim, config, back) : null;
    let inOrbit = false;
    return {
      update: (state) => {
        if (!inOrbit) inOrbit = ascent.update() === 'orbit';
        else if (descent && state.objectives.find((o) => o.id === 'orbit')?.status === 'done') descent.update();
      },
    };
  };
};

describe('亚轨道任务（水星-红石）', () => {
  it('突破卡门线：竖直飞到约 297 km，分离飞船并开伞回收——满分', () => {
    const flight = fly('karman-line', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 0 }));
    expect(flight.state.status).toBe('success');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    expect(flight.metrics['max-altitude']).toBeGreaterThan(280_000);
    expect(flight.metrics['max-altitude']).toBeLessThan(310_000);
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.score.total).toBe(100);
    expect(flight.score.grade).toBe('S');
    // 近乎竖直地落回大气层：过载十几个 g，在估算的 20 g 结构限值之内
    expect(flight.metrics['max-g']).toBeGreaterThan(12);
    expect(flight.metrics['max-g']).toBeLessThan(18);
    // 主伞下约 9 m/s：与 MR-3 实测的 30 ft/s 相符
    expect(flight.metrics['landing-speed']).toBeGreaterThan(8.5);
    expect(flight.metrics['landing-speed']).toBeLessThan(9.6);
  });

  it('突破卡门线：不回收飞船也算完成，但拿不到回收分', () => {
    // 不分离飞船：整箭坠回大气层解体
    const flight = fly('karman-line', (sim) => ({
      update: () => {
        if (sim.flightPhase === 'prelaunch' && !sim.getVehicleState().ignited) sim.stage();
      },
    }));
    expect(flight.state.status).toBe('success');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'failed']);
    expect(flight.sim.flightOutcome?.kind).toBe('destroyed');
    expect(flight.score.total).toBe(75);
    expect(flight.score.grade).toBe('B');
  });

  it('突破卡门线：中途关机，没到 100 km——任务失败', () => {
    const flight = fly('karman-line', (sim) => ({
      update: () => {
        if (sim.flightPhase === 'prelaunch' && !sim.getVehicleState().ignited) sim.stage();
        if (sim.time > 60) sim.setThrottle(0);
      },
    }));
    expect(flight.metrics['max-altitude']).toBeLessThan(100_000);
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
    expect(flight.score.total).toBe(0);
    expect(flight.score.grade).toBe('F');
  });

  it('亚轨道飞行：300 m/s 时向东倾斜 10° / 15°——与自由 7 号相近的弹道，安全溅落', () => {
    const gentle = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 10, kickSpeed: 300 }));
    const steeper = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 15, kickSpeed: 300 }));
    for (const flight of [gentle, steeper]) {
      expect(flight.state.status).toBe('success');
      expect(flight.sim.flightOutcome?.kind).toBe('landed');
      expect(flight.metrics['max-altitude']).toBeGreaterThan(180_000);
      expect(flight.metrics.downrange).toBeGreaterThan(400_000);
      expect(flight.score.total).toBeGreaterThanOrEqual(90);
    }
    // 15° 的弹道最接近 MR-3（187 km、487 km）
    expect(steeper.metrics['max-altitude'] as number).toBeLessThan(230_000);
    expect(steeper.metrics.downrange as number).toBeGreaterThan(480_000);
    expect(steeper.metrics.downrange as number).toBeLessThan(580_000);
    // 倾斜越多：飞得越远、越低，再入越缓和
    expect(steeper.metrics.downrange as number).toBeGreaterThan(gentle.metrics.downrange as number);
    expect(steeper.metrics['max-altitude'] as number).toBeLessThan(gentle.metrics['max-altitude'] as number);
    expect(steeper.metrics['max-g'] as number).toBeLessThan(gentle.metrics['max-g'] as number);
  });

  it('亚轨道飞行：全程竖直也能完成，但航程一项得 0 分', () => {
    const vertical = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 0 }));
    expect(vertical.state.status).toBe('success');
    expect(points(vertical).range).toBe(0);
    expect(vertical.score.grade).toMatch(/[AB]/);
  });

  it('亚轨道飞行：300 m/s 时倾斜 20°——稠密大气里迎角过大，箭体被横向载荷折断', () => {
    const flight = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 20, kickSpeed: 300 }));
    expect(flight.sim.flightOutcome?.cause).toBe('bending');
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
  });
});

describe('近地轨道任务（联盟-2.1a）', () => {
  it('首次入轨：抛助推器、分级、入轨并确认；余量只有一两百米每秒', () => {
    const flight = fly('first-orbit', orbitalPilot('first-orbit', { kickAngleDeg: 3 }), 1_500);
    expect(flight.state.status).toBe('success');
    const orbit = flight.state.confirmedOrbit!;
    expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(orbit.apoapsisAltitude).toBeLessThan(300_000);
    // 拜科努尔向东发射：倾角等于发射场纬度
    expect(orbit.inclination * RAD2DEG).toBeCloseTo(45.9, 0);
    expect(orbit.remainingDeltaV).toBeGreaterThan(100);
    expect(orbit.remainingDeltaV).toBeLessThan(350);
    // 确认发生在入轨后不久，飞行仍在继续（没有飞行结果）
    expect(flight.sim.flightOutcome).toBeNull();
    expect(flight.sim.time).toBeLessThan(900);
    // 联盟号的发动机不能节流：上升段约 4.4 g
    expect(flight.metrics['max-g']).toBeGreaterThan(4);
    expect(flight.metrics['max-g']).toBeLessThan(4.7);
    expect(flight.score.total).toBeGreaterThanOrEqual(75);
    // 四个助推器各成一个分离体
    const boosters = flight.sim.getDebris().filter((d) => d.kind === 'stage' && d.stageIndex === 0);
    expect(new Set(boosters.map((d) => d.unit)).size).toBeLessThanOrEqual(4);
  });

  it('首次入轨：远地点还没抬起来就关机——坠回大气层，任务失败', () => {
    const flight = fly(
      'first-orbit',
      (sim, config) => {
        const ascent = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5, pitchStepDeg: 2, decisionInterval: 2 });
        return {
          update: () => {
            if (sim.time < 300) ascent.update();
            else {
              sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
              sim.setThrottle(0);
            }
          },
        };
      },
      4_000,
    );
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
    expect(flight.state.confirmedOrbit).toBeNull();
  });

  it('指定倾角轨道：按住 D、间断点按 W 对准 062° 起飞，再用航向修正——倾角落在 51.6° ± 2° 之内', () => {
    for (const kick of [2, 2.5]) {
      const flight = fly('inclined-orbit', orbitalPilot('inclined-orbit', { kickAngleDeg: kick }), 1_500);
      expect(flight.state.status, `转弯角 ${kick}°`).toBe('success');
      const orbit = flight.state.confirmedOrbit!;
      expect(Math.abs(orbit.inclination * RAD2DEG - 51.6), `转弯角 ${kick}°`).toBeLessThan(1);
      expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
      expect(orbit.apoapsisAltitude).toBeLessThan(600_000);
      // 偏离正东发射：地球自转帮的忙变少，剩余 Δv 比向东发射少
      expect(orbit.remainingDeltaV).toBeGreaterThan(20);
      expect(orbit.remainingDeltaV).toBeLessThan(200);
      expect(flight.score.total, `转弯角 ${kick}°`).toBeGreaterThanOrEqual(75);
    }
  });

  it('指定倾角轨道：只按 D 向正东起飞——倾角停在 46° 左右，修正不过来，轨道不被确认', () => {
    const flight = fly('inclined-orbit', orbitalPilot('inclined-orbit', { kickAzimuthDeg: undefined }), 1_500);
    expect(flight.state.confirmedOrbit).toBeNull();
    const orbit = flight.telemetry.orbit!;
    expect(orbit.inclination * RAD2DEG).toBeGreaterThan(45);
    expect(orbit.inclination * RAD2DEG).toBeLessThan(49.6);
  });
});

describe('极地轨道（宇宙神V 401）', () => {
  it('从范登堡按 S 向南起飞，用 A 把航向压向西——倾角落在 90° ± 3° 之内', () => {
    const flight = fly('polar-orbit', orbitalPilot('polar-orbit', ATLAS_ASCENT), 1_500);
    expect(flight.state.status).toBe('success');
    const orbit = flight.state.confirmedOrbit!;
    expect(Math.abs(orbit.inclination * RAD2DEG - 90)).toBeLessThan(2);
    expect(orbit.apoapsisAltitude).toBeLessThan(600_000);
    // 收了节流：过载压在 5 g 附近（不收节流时芯级末段超过 9 g）
    expect(flight.metrics['max-g']).toBeLessThan(5.5);
    expect(orbit.remainingDeltaV).toBeGreaterThan(3_000);
    expect(flight.score.total).toBeGreaterThanOrEqual(75);
  });

  it('不做航向修正——发射场的向东速度留在轨道里，倾角约 81°', () => {
    const flight = fly('polar-orbit', orbitalPilot('polar-orbit', ATLAS_ASCENT, null, false), 1_500);
    expect(flight.state.confirmedOrbit).toBeNull();
    const orbit = flight.telemetry.orbit!;
    expect(orbit.classification).toBe('orbit');
    expect(orbit.inclination * RAD2DEG).toBeGreaterThan(79);
    expect(orbit.inclination * RAD2DEG).toBeLessThan(84);
  });

  it('像推重比高的火箭那样 60 m/s 就倾斜 2.5°——轨迹被迅速压平，在稠密大气里动压过大解体', () => {
    const flight = fly('polar-orbit', orbitalPilot('polar-orbit', { kickAngleDeg: 2.5, maxGLoad: 5 }), 1_500);
    expect(flight.sim.flightOutcome?.cause).toBe('dynamic-pressure');
    expect(flight.state.failure).toBe('destroyed');
  });
});

describe('返回任务（联盟 MS）', () => {
  it('载人飞船返回：配平再入并抛大底——过载约 5 g，评级 S', () => {
    const flight = fly('crew-return', (sim, config) => new ReturnPilot(sim, config, { entry: 'trim', jettisonShield: true }));
    expect(flight.state.status).toBe('success');
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.metrics['max-g']).toBeLessThan(5.5);
    expect(flight.metrics['landing-speed']).toBeLessThan(7);
    expect(flight.metrics['ablator-remaining']).toBeGreaterThan(0.5);
    expect(flight.sim.getVehicleState().heatShieldAttached).toBe(false);
    expect(flight.score.total).toBeGreaterThanOrEqual(95);
    expect(flight.score.grade).toBe('S');
  });

  it('载人飞船返回：弹道式再入——同样安全着陆，但约 8 g 的过载使评级降到 B', () => {
    const flight = fly('crew-return', (sim, config) => new ReturnPilot(sim, config, { entry: 'retrograde' }));
    expect(flight.state.status).toBe('success');
    expect(flight.metrics['max-g']).toBeGreaterThan(7.5);
    expect(flight.metrics['max-g']).toBeLessThan(9);
    expect(points(flight).g).toBeLessThan(5);
    expect(flight.score.total).toBeGreaterThanOrEqual(65);
    expect(flight.score.total).toBeLessThan(80);
    expect(flight.score.grade).toBe('B');
  });

  it('载人飞船返回：不抛服务舱就再入——烧毁，任务失败', () => {
    const flight = fly('crew-return', (sim) => {
      let burned = false;
      return {
        update: () => {
          if (sim.time < 1) sim.setAttitudeMode('retrograde');
          if (sim.time > 40 && !burned) {
            if (!sim.getVehicleState().ignited) sim.stage();
            sim.setThrottle(1);
            const { velocity } = sim.getVehicleState().body;
            // 减速约 100 m/s 后关机，之后什么也不做
            if (Math.hypot(velocity.x, velocity.y, velocity.z) < 7_690) {
              sim.setThrottle(0);
              burned = true;
            }
          }
        },
      };
    }, 12_000);
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
    expect(flight.sim.flightOutcome?.cause).toMatch(/thermal/);
  });

  it('载人轨道飞行：从拜科努尔起飞、入轨确认、离轨、配平再入、开伞着陆——完整的任务流程', () => {
    const flight = fly('orbital-flight', orbitalPilot('orbital-flight', {}, { entry: 'trim', jettisonShield: true }));
    expect(flight.state.status).toBe('success');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    const [orbit, land] = flight.state.objectives;
    expect(orbit!.resolvedAt as number).toBeLessThan(900);
    expect(land!.resolvedAt as number).toBeGreaterThan(2_500);
    expect(flight.state.confirmedOrbit!.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.metrics['landing-speed']).toBeLessThan(7);
    // 上升段约 4.4 g（不能节流），返回时配平再入约 5 g
    expect(flight.metrics['max-g']).toBeLessThan(5.5);
    expect(flight.score.total).toBeGreaterThanOrEqual(85);
    expect(flight.score.grade).toMatch(/[SA]/);
  });

  it('载人轨道飞行：入轨后不返回——任务一直处于进行中，不会被判定完成', () => {
    const flight = fly('orbital-flight', orbitalPilot('orbital-flight'), 2_000);
    expect(flight.state.status).toBe('active');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'pending']);
    expect(flight.score.total).toBe(0);
  });
});
