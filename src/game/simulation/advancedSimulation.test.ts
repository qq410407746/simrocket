import { describe, it, expect } from 'vitest';
import { getVehicleOrDefault } from '@/data/vehicles';
import { EARTH, STANDARD_GRAVITY } from '../physics/constants';
import { vec3, distance, add, scale, length, sub } from '../physics/math/vec3';
import { elementsFromState, stateFromElements } from '../physics/orbital/elements';
import { propagateKepler } from '../physics/orbital/kepler';
import { SYNCHRONOUS_RADIUS } from '../physics/orbital/advanced';
import { Simulation } from './Simulation';
import { SimulationHost } from './SimulationHost';
import { buildSnapshot } from './snapshot';
import { interpolateMotion } from './interpolation';
import type { SimulationConfig, SimSnapshot } from './types';
const config = (): SimulationConfig => ({ vehicle: getVehicleOrDefault('zenith-3'), site: { latitude: 0, longitude: 0, altitude: 0 }, epochJulianDate: 2451545,
 initialState: { position: vec3(SYNCHRONOUS_RADIUS,0,0), velocity: vec3(0,Math.sqrt(EARTH.MU / SYNCHRONOUS_RADIUS),0), separatedStages: 2, fairingJettisoned: true } });
const meta = { seq: 0, timeWarp: 100000 as const, paused: false, simRate: 100000 };
describe('解析滑行与机动指令', () => {
 it('主机在 100000× 推进，不受旧的 4000 个物理步限额拖慢；暂停不变', () => {
  let ms = 0; let snapshot: SimSnapshot | null = null;
  const host = new SimulationHost((event) => { if(event.type === 'snapshot') snapshot = event.snapshot; }, () => ms);
  host.handle({type:'init',config:config()}); host.handle({type:'setTimeWarp',warp:100000}); host.tick();
  for(let i=0;i<10;i++){ms+=20; host.tick();}
  expect(snapshot!.simTime).toBeCloseTo(20000, 6);
  expect(snapshot!.simRate).toBeCloseTo(100000, 6);
  host.handle({type:'setPaused',paused:true}); ms+=100; host.tick();
  expect(snapshot!.simTime).toBeCloseTo(20000,6);
 });
 it('长时间传播与开普勒解一致，高倍率插值不穿过弦线；燃料不消耗', () => {
  const sim = new Simulation(config()), before = buildSnapshot(sim,meta);
  for(let i=0;i<100;i++) expect(sim.coastSteps(3000)).toBe(3000);
  const after=buildSnapshot(sim,meta), exact=propagateKepler(before.vehicle.body.position,before.vehicle.body.velocity,sim.time);
  expect(distance(after.vehicle.body.position,exact.position)).toBeLessThan(0.01);
  expect(after.vehicle.stages).toEqual(before.vehicle.stages);
  const mid=interpolateMotion(before,after,3000), expected=propagateKepler(before.vehicle.body.position,before.vehicle.body.velocity,3000);
  expect(distance(mid.position,expected.position)).toBeLessThan(1e-4);
 });
 it('节点前120秒停止高速滑行；点火、操纵和分离立即退出', () => {
  const sim=new Simulation(config()); sim.setManeuver({time:300,prograde:50,radial:0,normal:10});
  for(let i=0;i<3;i++) sim.coastSteps(3000);
  expect(sim.time).toBe(180); expect(sim.coastSteps(3000)).toBe(0);
  sim.setManeuver(null); sim.setAttitudeInput({pitch:1,yaw:0,roll:0}); expect(sim.coastSteps(3000)).toBe(0);
  sim.setAttitudeInput({pitch:0,yaw:0,roll:0}); sim.stage(); sim.setThrottle(1);
  expect(sim.maxTimeWarp).toBe(5); expect(sim.coastSteps(3000)).toBe(0);
  sim.setThrottle(0); sim.deploySatellite(); expect(sim.deployedAt).toBe(180);
  expect(sim.getVehicleState().stages.every((s)=>!s.attached)).toBe(true);
  expect(sim.getDebris()).toHaveLength(1); expect(sim.coastSteps(3000)).toBe(0);
 });
 it('部署前后总线动量守恒，且推力积分使节点剩余增量减少', () => {
  const sim = new Simulation(config());
  sim.setManeuver({ time: 500, prograde: 100, radial: 0, normal: 0 });
  sim.setAttitudeMode('maneuver');
  for (let i = 0; i < 500; i++) sim.step();
  sim.stage(); sim.setThrottle(1);
  for (let i = 0; i < 50; i++) sim.step();
  expect(length(sim.maneuverState!.remaining)).toBeLessThan(100);
  const before = sim.getVehicleState();
  sim.setThrottle(0); sim.deploySatellite();
  const after = sim.getVehicleState(), debris = sim.getDebris()[0]!;
  const debrisMass = sim.vehicle.stages[debris.stageIndex]!.dryMass + debris.propellantMass;
  expect(after.mass + debrisMass).toBeCloseTo(before.mass, 6);
  expect(length(sub(add(scale(after.body.velocity, after.mass), scale(debris.velocity, debrisMass)), scale(before.body.velocity, before.mass)))).toBeLessThan(1e-6);
 });
 it('通过分级键释放最后一级也会记为卫星部署，重复部署不产生第二个分离体', () => {
  const sim = new Simulation(config());
  sim.stage(); sim.stage();
  expect(sim.deployedAt).toBe(0);
  sim.deploySatellite();
  expect(sim.getDebris()).toHaveLength(1);
 });
 it('解析与数值切换不越过 GTO 大气边界，混合区间插值保持真实末端', () => {
  const c = config(), rp = EARTH.RADIUS + 200_000, ra = SYNCHRONOUS_RADIUS;
  const orbit = stateFromElements({ semiLatusRectum: 2 * rp * ra / (rp + ra), eccentricity: (ra - rp) / (ra + rp),
    inclination: 0.1, raan: 0, argumentOfPeriapsis: 0, trueAnomaly: Math.PI });
  const sim = new Simulation({ ...c, initialState: { ...c.initialState!, ...orbit } });
  let batches = 0;
  while (sim.coastSteps(1_000_000) && batches++ < 1000) { /* 合并批次直到边界 */ }
  expect(batches).toBeLessThan(1000);
  expect(sim.maxTimeWarp).toBeLessThanOrEqual(1000);
  expect(length(sim.getVehicleState().body.position) - EARTH.RADIUS).toBeGreaterThanOrEqual(1_000_000);
  for (let i = 0; i < 10; i++) sim.step();
  expect(length(sim.getVehicleState().body.position) - EARTH.RADIUS).toBeLessThan(1_000_000);
  const high = new Simulation(config()), a = buildSnapshot(high, meta);
  high.stage(); high.setThrottle(1); high.step(); high.setThrottle(0);
  high.coastSteps(3000);
  const b = buildSnapshot(high, meta), end = interpolateMotion(a, b, b.simTime);
  expect(distance(end.position, b.vehicle.body.position)).toBeLessThan(1e-8);
  expect(elementsFromState(b.vehicle.body.position, b.vehicle.body.velocity).period).not.toBe(elementsFromState(a.vehicle.body.position, a.vehicle.body.velocity).period);
 });
 it('接近节点正常降档不会被当作计算落后', () => {
  let ms = 0; let snapshot: SimSnapshot | null = null;
  const host = new SimulationHost((event) => { if (event.type === 'snapshot') snapshot = event.snapshot; }, () => ms);
  host.handle({ type: 'init', config: config() });
  host.handle({ type: 'setManeuver', node: { time: 300, prograde: 50, radial: 0, normal: 0 } });
  host.handle({ type: 'setTimeWarp', warp: 100000 }); host.tick();
  ms = 20; host.tick();
  expect(snapshot!.simTime).toBeCloseTo(180, 6);
  expect(snapshot!.timeWarp).toBe(5);
  expect(snapshot!.simRate).toBeCloseTo(5, 6);
 });
 it('短脉冲按物理步关机，消耗真实燃料；手动关机可以取消', () => {
  const sim = new Simulation(config());
  const before = sim.getVehicleState();
  const engine = sim.vehicle.stages[2]!.engine;
  sim.pulseBurn(0.1);
  for (let i = 0; i < 5; i++) sim.step();
  expect(sim.getVehicleState().throttle).toBe(0);
  const used = before.stages[2]!.propellantMass - sim.getVehicleState().stages[2]!.propellantMass;
  expect(used).toBeCloseTo(engine.thrustVacuum / (engine.ispVacuum * STANDARD_GRAVITY) * 0.1, 8);
  const remaining = sim.getVehicleState().stages[2]!.propellantMass;
  sim.pulseBurn(0.02); sim.setThrottle(0); sim.step();
  expect(sim.getVehicleState().stages[2]!.propellantMass).toBe(remaining);
  sim.pulseBurn(Infinity); sim.step();
  expect(sim.getVehicleState().throttle).toBe(0);
 });
 it('大气内不能解析跳步，无效节点和提前部署不会改变状态', () => {
  const c=config(); const sim=new Simulation({...c,initialState:{...c.initialState!,position:vec3(EARTH.RADIUS+200000,0,0),velocity:vec3(0,7800,0)}});
  expect(sim.coastSteps(3000)).toBe(0);
  sim.setManeuver({time:NaN,prograde:0,radial:0,normal:0}); expect(sim.maneuverState).toBeNull();
  const pad=new Simulation({...c,initialState:undefined}); pad.deploySatellite(); expect(pad.deployedAt).toBeNull();
 });
});
