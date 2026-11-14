import type { Simulation } from './Simulation';
import type { SimSnapshot, TimeWarp } from './types';

/** 快照中由调度层（SimulationHost）而非物理层决定的部分。 */
export interface SnapshotMeta {
  readonly seq: number;
  readonly timeWarp: TimeWarp;
  readonly paused: boolean;
  readonly simRate: number;
}

/** 把模拟器当前状态打包成快照。 */
export const buildSnapshot = (sim: Simulation, meta: SnapshotMeta): SimSnapshot => ({
  seq: meta.seq,
  simTime: sim.time,
  timeWarp: meta.timeWarp,
  maxTimeWarp: sim.maxTimeWarp,
  paused: meta.paused,
  simRate: meta.simRate,
  earthRotationAngle: sim.earthRotationAngle,
  vehicle: sim.getVehicleState(),
  liftoffTime: sim.liftoffAt,
  stats: sim.flightStats,
  outcome: sim.flightOutcome,
  debris: sim.getDebris(),
});
