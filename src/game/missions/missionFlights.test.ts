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
import { HandFlownPilot } from '../simulation/testing/handFlownPilot';
import { type ReturnOptions, ReturnPilot, SuborbitalPilot } from '../simulation/testing/missionPilots';
import type { SimulationConfig } from '../simulation/types';
import { headingOfCombo, launchGuidance } from './guidance';
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

/**
 * 入轨（可选：之后返回）的驾驶员：按任务的发射引导选择起飞倾斜用的键；有倾角要求时用航向修正。
 * 轨道目标确认之后才开始返回。
 */
const orbitalPilot = (id: string, kickAngleDeg: number, back: ReturnOptions | null = null, steer = true): PilotFactory => {
  const mission = missionOf(id);
  const guidance = launchGuidance(mission, siteOf(mission).latitude);
  const target = missionOrbitRequirement(mission)?.inclination?.target;
  return (sim: Simulation, config: SimulationConfig): MissionPilot => {
    const ascent = new HandFlownPilot(sim, config, {
      targetAltitude: 200_000,
      kickAngleDeg,
      kickHeadingDeg: headingOfCombo(guidance.lower),
      inclination:
        steer && target !== undefined ? { target, increase: guidance.direction === 'ascending' ? 'left' : 'right' } : undefined,
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

describe('亚轨道任务（流星-S）', () => {
  it('突破卡门线：竖直飞到 286 km，分离返回舱并开伞回收——满分', () => {
    const flight = fly('karman-line', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 0 }));
    expect(flight.state.status).toBe('success');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    expect(flight.metrics['max-altitude']).toBeGreaterThan(270_000);
    expect(flight.metrics['max-altitude']).toBeLessThan(300_000);
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.score.total).toBe(100);
    expect(flight.score.grade).toBe('S');
    // 近乎竖直地落回大气层：过载十几个 g，在无人返回舱 25 g 的结构限值之内
    expect(flight.metrics['max-g']).toBeGreaterThan(12);
    expect(flight.metrics['max-g']).toBeLessThan(18);
  });

  it('突破卡门线：不回收返回舱也算完成，但拿不到回收分', () => {
    // 不分离返回舱：整箭坠回大气层解体
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

  it('亚轨道飞行：300 m/s 时向东倾斜 10° / 15°——越过 120 km，落到几百公里外并安全着陆', () => {
    const gentle = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 10, kickSpeed: 300 }));
    const steeper = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 15, kickSpeed: 300, jettisonShield: true }));
    for (const flight of [gentle, steeper]) {
      expect(flight.state.status).toBe('success');
      expect(flight.sim.flightOutcome?.kind).toBe('landed');
      expect(flight.metrics['max-altitude']).toBeGreaterThan(150_000);
      expect(flight.metrics.downrange).toBeGreaterThan(400_000);
      expect(flight.score.total).toBeGreaterThanOrEqual(90);
    }
    // 倾斜越多：飞得越远、越低，再入越缓和
    expect(steeper.metrics.downrange as number).toBeGreaterThan(gentle.metrics.downrange as number);
    expect(steeper.metrics['max-altitude'] as number).toBeLessThan(gentle.metrics['max-altitude'] as number);
    expect(steeper.metrics['max-g'] as number).toBeLessThan(gentle.metrics['max-g'] as number);
    // 抛掉大底落得更慢，着陆速度一项拿到满分
    expect(steeper.metrics['landing-speed'] as number).toBeLessThan((gentle.metrics['landing-speed'] as number) - 0.2);
    expect(points(steeper).landing).toBe(15);
    expect(points(gentle).landing).toBeLessThan(15);
  });

  it('亚轨道飞行：全程竖直也能完成，但航程一项得 0 分；倾斜过头则到不了 120 km', () => {
    const vertical = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 0 }));
    expect(vertical.state.status).toBe('success');
    expect(points(vertical).range).toBe(0);
    expect(vertical.score.grade).toBe('B');
    const tooFlat = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 35, kickSpeed: 300 }));
    expect(tooFlat.metrics['max-altitude']).toBeLessThan(120_000);
    expect(tooFlat.state.status).toBe('failed');
    expect(tooFlat.state.failure).toBe('flight-ended');
    // 返回舱是安全着陆的：失败的是高度目标
    expect(tooFlat.state.objectives.map((o) => o.status)).toEqual(['failed', 'done']);
  });

  it('亚轨道飞行：刚起飞（60 m/s）就倾斜 5°——轨迹被迅速压平，在稠密大气里动压过大解体', () => {
    const flight = fly('suborbital-hop', (sim, config) => new SuborbitalPilot(sim, config, { kickAngleDeg: 5 }));
    expect(flight.sim.flightOutcome?.cause).toBe('dynamic-pressure');
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
  });
});

describe('近地轨道任务（边疆一号）', () => {
  it('首次入轨：粗糙的手动飞行入轨并确认，评级 A；轨道确认比关机晚 10 秒', () => {
    const flight = fly('first-orbit', orbitalPilot('first-orbit', 2.5), 1_500);
    expect(flight.state.status).toBe('success');
    const orbit = flight.state.confirmedOrbit!;
    expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(orbit.apoapsisAltitude).toBeLessThan(300_000);
    expect(orbit.inclination * RAD2DEG).toBeCloseTo(28.5, 0);
    expect(orbit.remainingDeltaV).toBeGreaterThan(2_800);
    // 确认发生在入轨后不久，飞行仍在继续（没有飞行结果）
    expect(flight.sim.flightOutcome).toBeNull();
    expect(flight.sim.time).toBeLessThan(600);
    // 没有收节流：一级末段约 6.2 g，过载一项只拿到一半左右
    expect(flight.metrics['max-g']).toBeGreaterThan(6);
    expect(points(flight).g).toBeGreaterThan(5);
    expect(points(flight).g).toBeLessThan(10);
    expect(flight.score.total).toBeGreaterThanOrEqual(82);
    expect(flight.score.total).toBeLessThan(92);
  });

  it('首次入轨：一级末段收节流——过载降到 5 g 以下，过载一项满分', () => {
    const mission = missionOf('first-orbit');
    const flight = flyMission(
      mission,
      getVehicleOrDefault(mission.vehicleId),
      siteOf(mission),
      (sim, config) => {
        const ascent = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5 });
        let inOrbit = false;
        return {
          update: () => {
            if (inOrbit) return;
            // 一级工作期间：过载超过 4.3 g 就把节流收小一点（相当于按住 ↓）
            const state = sim.getVehicleState();
            if (state.activeStageIndex === 0 && state.flight.thrust > 0) {
              const g = Math.hypot(state.specificForce.x, state.specificForce.y, state.specificForce.z) / 9.80665;
              if (g > 4.3) sim.setThrottle(Math.max(0.4, state.throttle - 0.004));
            } else if (state.activeStageIndex === 1 && state.throttle < 1 && state.ignited && state.flight.thrust > 0) {
              sim.setThrottle(1);
            }
            inOrbit = ascent.update() === 'orbit';
          },
        };
      },
      1_500,
    );
    expect(flight.state.status).toBe('success');
    expect(flight.metrics['max-g']).toBeLessThan(5);
    expect(points(flight).g).toBe(15);
    expect(flight.score.total).toBeGreaterThanOrEqual(90);
    expect(flight.score.grade).toBe('S');
  });

  it('首次入轨：远地点还没抬起来就关机——坠回大气层，任务失败', () => {
    const flight = fly(
      'first-orbit',
      (sim, config) => {
        const ascent = new HandFlownPilot(sim, config, { targetAltitude: 200_000, kickAngleDeg: 2.5 });
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

  it('指定倾角轨道：W + D 向东北起飞，飞行中用航向修正——倾角落在 51.6° ± 2° 之内', () => {
    for (const kick of [2, 2.5]) {
      const flight = fly('inclined-orbit', orbitalPilot('inclined-orbit', kick), 1_500);
      expect(flight.state.status, `转弯角 ${kick}°`).toBe('success');
      const orbit = flight.state.confirmedOrbit!;
      expect(Math.abs(orbit.inclination * RAD2DEG - 51.6), `转弯角 ${kick}°`).toBeLessThan(1.5);
      expect(orbit.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
      expect(orbit.apoapsisAltitude).toBeLessThan(600_000);
      // 偏离正东发射：地球自转帮的忙变少，剩余 Δv 比向东发射少
      expect(orbit.remainingDeltaV).toBeGreaterThan(2_600);
      expect(orbit.remainingDeltaV).toBeLessThan(3_000);
      expect(flight.score.total, `转弯角 ${kick}°`).toBeGreaterThanOrEqual(75);
    }
  });

  it('指定倾角轨道：只按 W + D、不做航向修正——倾角约 47°，在容差之外，轨道不被确认', () => {
    const flight = fly('inclined-orbit', orbitalPilot('inclined-orbit', 2.5, null, false), 700);
    expect(flight.state.status).toBe('active');
    expect(flight.state.confirmedOrbit).toBeNull();
    const orbit = flight.telemetry.orbit!;
    expect(orbit.classification).toBe('orbit');
    expect(orbit.inclination * RAD2DEG).toBeGreaterThan(45.5);
    expect(orbit.inclination * RAD2DEG).toBeLessThan(48.5);
  });

  it('极地轨道：从范登堡按 S 向南起飞，用 A 把航向压向西——倾角落在 90° ± 3° 之内', () => {
    for (const kick of [2, 2.5]) {
      const flight = fly('polar-orbit', orbitalPilot('polar-orbit', kick), 1_500);
      expect(flight.state.status, `转弯角 ${kick}°`).toBe('success');
      const orbit = flight.state.confirmedOrbit!;
      expect(Math.abs(orbit.inclination * RAD2DEG - 90), `转弯角 ${kick}°`).toBeLessThan(1.5);
      // 极地轨道用不上地球自转：剩余 Δv 比向东发射少几百米每秒
      expect(orbit.remainingDeltaV).toBeGreaterThan(2_300);
      expect(orbit.remainingDeltaV).toBeLessThan(2_750);
      expect(flight.score.total, `转弯角 ${kick}°`).toBeGreaterThanOrEqual(75);
    }
  });

  it('极地轨道：只按 S、不做航向修正——发射场的向东速度留在轨道里，倾角约 84°', () => {
    const flight = fly('polar-orbit', orbitalPilot('polar-orbit', 2.5, null, false), 700);
    expect(flight.state.status).toBe('active');
    const orbit = flight.telemetry.orbit!;
    expect(orbit.classification).toBe('orbit');
    expect(orbit.inclination * RAD2DEG).toBeGreaterThan(82.5);
    expect(orbit.inclination * RAD2DEG).toBeLessThan(85.5);
  });
});

describe('返回任务（边疆一号）', () => {
  it('载人飞船返回：配平再入并抛大底——过载不到 5 g，评级 S', () => {
    const flight = fly('crew-return', (sim, config) => new ReturnPilot(sim, config, { entry: 'trim', jettisonShield: true }));
    expect(flight.state.status).toBe('success');
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.metrics['max-g']).toBeLessThan(5);
    expect(flight.metrics['landing-speed']).toBeLessThan(7.6);
    expect(flight.metrics['ablator-remaining']).toBeGreaterThan(0.85);
    expect(flight.sim.getVehicleState().heatShieldAttached).toBe(false);
    expect(flight.score.total).toBe(100);
    expect(flight.score.grade).toBe('S');
  });

  it('载人飞船返回：弹道式再入——同样安全着陆，但约 8 g 的过载使评级降到 B', () => {
    const flight = fly('crew-return', (sim, config) => new ReturnPilot(sim, config, { entry: 'retrograde' }));
    expect(flight.state.status).toBe('success');
    expect(flight.metrics['max-g']).toBeGreaterThan(7.5);
    expect(flight.metrics['max-g']).toBeLessThan(9);
    expect(points(flight).g).toBeLessThan(10);
    expect(flight.score.total).toBeGreaterThanOrEqual(65);
    expect(flight.score.total).toBeLessThan(80);
    expect(flight.score.grade).toBe('B');
  });

  it('载人飞船返回：不分离推进级就再入——烧毁，任务失败', () => {
    const flight = fly('crew-return', (sim) => {
      let burned = false;
      return {
        update: () => {
          if (sim.time < 1) sim.setAttitudeMode('retrograde');
          if (sim.time > 40 && !burned) {
            if (!sim.getVehicleState().ignited) sim.stage();
            sim.setThrottle(1);
            const { position, velocity } = sim.getVehicleState().body;
            // 减速约 150 m/s 后关机，之后什么也不做
            if (Math.hypot(velocity.x, velocity.y, velocity.z) < 7_640 && Math.hypot(position.x, position.y, position.z) > 0) {
              sim.setThrottle(0);
              burned = true;
            }
          }
        },
      };
    });
    expect(flight.state.status).toBe('failed');
    expect(flight.state.failure).toBe('destroyed');
    expect(flight.sim.flightOutcome?.cause).toMatch(/thermal/);
  });

  it('载人轨道飞行：从发射台起飞、入轨确认、离轨、配平再入、开伞着陆——完整的任务流程', () => {
    const flight = fly('orbital-flight', orbitalPilot('orbital-flight', 2.5, { entry: 'trim', jettisonShield: true }));
    expect(flight.state.status).toBe('success');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    // 先入轨、后着陆
    const [orbit, land] = flight.state.objectives;
    expect(orbit!.resolvedAt as number).toBeLessThan(600);
    expect(land!.resolvedAt as number).toBeGreaterThan(2_500);
    expect(flight.state.confirmedOrbit!.periapsisAltitude).toBeGreaterThanOrEqual(150_000);
    expect(flight.sim.flightOutcome?.kind).toBe('landed');
    expect(flight.metrics['landing-speed']).toBeLessThan(7.6);
    // 最大过载出现在上升段（没有收节流，约 6.2 g），返回时配平再入不超过 5 g
    expect(flight.metrics['max-g']).toBeGreaterThan(6);
    expect(flight.metrics['max-g']).toBeLessThan(6.5);
    expect(flight.score.total).toBeGreaterThanOrEqual(82);
    expect(flight.score.grade).toMatch(/[SA]/);
  });

  it('载人轨道飞行：入轨后不返回——任务一直处于进行中，不会被判定完成', () => {
    const flight = fly('orbital-flight', orbitalPilot('orbital-flight', 2.5), 2_000);
    expect(flight.state.status).toBe('active');
    expect(flight.state.objectives.map((o) => o.status)).toEqual(['done', 'pending']);
    expect(flight.score.total).toBe(0);
  });
});
