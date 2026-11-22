import { expect, it } from 'vitest';
import { DEG2RAD, EARTH } from '../constants';
import { distance } from '../math/vec3';
import { elementsFromState, stateFromElements } from './elements';
import { propagateKepler } from './kepler';
import { planManeuver, SYNCHRONOUS_RADIUS, synchronousDiagnostics } from './advanced';
import { nodeAtPosition, suggestManeuver } from './planning';

it('快捷草案在赤道交点注入 GTO，并在远端交点同时圆化、消除倾角', () => {
  const initial = stateFromElements({ semiLatusRectum: EARTH.RADIUS + 200_000, eccentricity: 0,
    inclination: 5.24 * DEG2RAD, raan: 0.8, argumentOfPeriapsis: 0, trueAnomaly: 0.4 });
  const first = suggestManeuver(initial.position, initial.velocity, 0, 'gto')!;
  const transfer = planManeuver(initial.position, initial.velocity, 0, first)!;
  expect(elementsFromState(transfer.after.position, transfer.after.velocity).apoapsisRadius).toBeCloseTo(SYNCHRONOUS_RADIUS, 3);
  expect(Math.abs(transfer.position.z)).toBeLessThan(1e-5);
  const second = suggestManeuver(transfer.after.position, transfer.after.velocity, first.time, 'equatorial')!;
  const circular = planManeuver(transfer.after.position, transfer.after.velocity, first.time, second)!;
  expect(synchronousDiagnostics(circular.after.position, circular.after.velocity).geo).toBe(true);
});

it('点选轨道得到下一次到达时刻，零增量节点不改变轨道', () => {
  const initial = stateFromElements({ semiLatusRectum: 8_000_000, eccentricity: 0.1,
    inclination: 0.3, raan: 0.8, argumentOfPeriapsis: 0.2, trueAnomaly: 1 });
  const point = propagateKepler(initial.position, initial.velocity, 1500).position;
  const node = nodeAtPosition(initial.position, initial.velocity, 100, point)!;
  expect(node.time).toBeCloseTo(1600, 6);
  const plan = planManeuver(initial.position, initial.velocity, 100, node)!;
  expect(distance(plan.position, point)).toBeLessThan(1e-5);
  expect(plan.after.velocity).toEqual(plan.velocity);
  expect(nodeAtPosition(initial.position, initial.velocity, 100, { x: NaN, y: 0, z: 0 })).toBeNull();
});
