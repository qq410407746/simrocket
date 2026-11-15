/**
 * 测试辅助：让一个测试驾驶员把某个任务从头飞到有结论，途中按界面的刷新率（10 Hz）推进任务判定。
 * 这与游戏运行时的数据流相同：物理步 → 快照 → 遥测 → 任务状态。
 */
import type { Geodetic } from '../../physics/frames/frames';
import { Simulation } from '../../simulation/Simulation';
import { buildSnapshot } from '../../simulation/snapshot';
import { createFlightConfig } from '../../simulation/startConditions';
import type { SimulationConfig } from '../../simulation/types';
import { type Telemetry, deriveTelemetry } from '../../telemetry/telemetry';
import type { VehicleDefinition } from '../../vehicles/types';
import { scoreMission } from '../scoring';
import { type MissionInput, createMissionState, missionMetrics, updateMission } from '../tracker';
import type { MissionDefinition, MissionMetrics, MissionScore, MissionState } from '../types';

/** 驾驶员：每个物理步之前被调用一次。可以读取当前的任务状态（相当于玩家看任务面板）。 */
export interface MissionPilot {
  update(mission: MissionState): void;
}

export interface MissionFlight {
  readonly sim: Simulation;
  readonly config: SimulationConfig;
  readonly state: MissionState;
  readonly score: MissionScore;
  readonly metrics: MissionMetrics;
  /** 任务有结论（或超时）时的遥测。 */
  readonly telemetry: Telemetry;
}

/** 界面遥测的刷新间隔，以物理步计（0.1 s）。 */
const HUD_REFRESH_STEPS = 5;

export const flyMission = (
  mission: MissionDefinition,
  vehicle: VehicleDefinition,
  site: Geodetic,
  makePilot: (sim: Simulation, config: SimulationConfig) => MissionPilot,
  timeout = 12_000,
): MissionFlight => {
  const config = createFlightConfig(vehicle, site, mission.start);
  const sim = new Simulation(config);
  const pilot = makePilot(sim, config);
  let state = createMissionState(mission);
  const read = (): MissionInput => ({
    telemetry: deriveTelemetry(buildSnapshot(sim, { seq: 0, timeWarp: 1, paused: false, simRate: 1 }), config),
    stats: sim.flightStats,
    outcome: sim.flightOutcome,
  });
  let input = read();
  let steps = 0;
  while (state.status === 'active' && sim.time < timeout) {
    pilot.update(state);
    sim.step();
    if (++steps % HUD_REFRESH_STEPS === 0 || sim.flightPhase !== 'flight') {
      input = read();
      state = updateMission(mission, state, input);
    }
  }
  const metrics = missionMetrics(mission, state, input);
  return { sim, config, state, score: scoreMission(mission, state, metrics), metrics, telemetry: input.telemetry };
};

/** 按任务目录里的飞行器与发射场飞一个任务（发射场以地理坐标给出，避免游戏层依赖内容数据）。 */
export type PilotFactory = (sim: Simulation, config: SimulationConfig) => MissionPilot;
