/// <reference types="node" />
/**
 * 性能基准：每个场景先预热一次，再跑若干次取中位数，结果打印成表并写到 BENCH_OUT（如果设置了）。
 * 运行：npm run bench
 */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { ascent, jupiterWindows, marsWindows, orbitSteps, predictions, routeSearch, snapshots } from './scenarios';

const SCENARIOS: readonly [name: string, run: () => unknown, runs: number][] = [
  ['上升段 150 s（7500 步）', ascent, 7],
  ['轨道 20000 步', orbitSteps, 7],
  ['轨迹预测 ×40', predictions, 7],
  ['快照 ×2000', snapshots, 7],
  ['火星 10 年窗口 + 猪排图', marsWindows, 5],
  ['木星 10 年窗口', jupiterWindows, 5],
  ['地球—木星—土星 借力路线', routeSearch, 3],
];

it('性能基准', () => {
  const rows: Record<string, number> = {};
  for (const [name, run, runs] of SCENARIOS) {
    run();
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      run();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    rows[name] = Number(times[Math.floor(times.length / 2)]!.toFixed(1));
  }
  console.table(Object.entries(rows).map(([场景, 中位数ms]) => ({ 场景, 中位数ms })));
  const out = process.env.BENCH_OUT;
  if (out) writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
});
