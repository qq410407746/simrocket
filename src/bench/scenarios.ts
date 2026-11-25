/**
 * 性能基准场景（npm run bench）。每个场景都是确定性的纯计算，不依赖浏览器。
 * 用来比较优化前后的耗时；不是功能测试。
 */
import { getLaunchSiteOrDefault, launchSiteGeodetic } from '@/data/launchSites';
import { getVehicleOrDefault } from '@/data/vehicles';
import { searchRoute } from '@/game/interplanetary/mga';
import { porkchop, searchWindows } from '@/game/interplanetary/windows';
import { julianDateFromUnixMs } from '@/game/physics/ephemeris/time';
import { Simulation } from '@/game/simulation/Simulation';
import { buildSnapshot } from '@/game/simulation/snapshot';
import { createFlightConfig } from '@/game/simulation/startConditions';

const jd = (y: number, m: number, d: number) => julianDateFromUnixMs(Date.UTC(y, m - 1, d));
const soyuz = () => getVehicleOrDefault('soyuz-2-1a');
const baikonur = () => launchSiteGeodetic(getLaunchSiteOrDefault('baikonur'));

/** 联盟号从发射台起飞，竖直加略微倾斜地飞 seconds 秒（大气、气动、加热、并联助推器）。返回物理步数。 */
export const ascent = (seconds = 150): number => {
  const sim = new Simulation(createFlightConfig(soyuz(), baikonur()));
  sim.stage();
  let steps = 0;
  while (sim.time < seconds && sim.flightPhase !== 'destroyed') {
    if (steps === 1500) sim.setAttitudeInput({ pitch: 0, yaw: 1, roll: 0 });
    if (steps === 1600) sim.setAttitudeInput({ pitch: 0, yaw: 0, roll: 0 });
    sim.step();
    steps++;
  }
  return steps;
};

/** 从 200 km 圆轨道出发、不点火逐步积分 steps 步（真空 RK4，不走解析滑行）。 */
export const orbitSteps = (steps = 20_000): Simulation => {
  const sim = new Simulation(createFlightConfig(soyuz(), baikonur(), 'orbit'));
  for (let i = 0; i < steps; i++) sim.step();
  return sim;
};

/** 轨道上与上升段的轨迹预测各 times 次。 */
export const predictions = (times = 20): number => {
  const orbit = orbitSteps(10);
  const climbing = new Simulation(createFlightConfig(soyuz(), baikonur()));
  climbing.stage();
  for (let i = 0; i < 3000; i++) climbing.step();
  let points = 0;
  for (let i = 0; i < times; i++) {
    points += orbit.predictTrajectory()?.points.length ?? 0;
    points += climbing.predictTrajectory()?.points.length ?? 0;
  }
  return points;
};

/** 每秒 60 次的快照：times 次 buildSnapshot。 */
export const snapshots = (times = 2000): number => {
  const sim = orbitSteps(10);
  let n = 0;
  for (let i = 0; i < times; i++) n += buildSnapshot(sim, { seq: i, timeWarp: 1, paused: false, simRate: 1 }).seq >= 0 ? 1 : 0;
  return n;
};

/** 发射窗口：火星 10 年搜索 + 第一个窗口的猪排图。 */
export const marsWindows = (): number => {
  const result = searchWindows({ target: 'mars', startJd: jd(2026, 1, 1), endJd: jd(2036, 1, 1), arrival: 'capture', parkingAltitude: 200_000 });
  const grid = porkchop('mars', result.windows[0]!.best.departureJd, result.options, result.flightDays);
  return result.windows.length + grid.values.length;
};

/** 发射窗口：木星 10 年搜索。 */
export const jupiterWindows = (): number =>
  searchWindows({ target: 'jupiter', startJd: jd(2026, 1, 1), endJd: jd(2036, 1, 1), arrival: 'capture', parkingAltitude: 200_000 }).windows.length;

/** 借力路线：地球—木星—土星，2026–2036。 */
export const routeSearch = (): number =>
  searchRoute({ sequence: ['earth', 'jupiter', 'saturn'], startJd: jd(2026, 1, 1), endJd: jd(2036, 1, 1), arrival: 'capture', parkingAltitude: 200_000 }).solutions.length;
