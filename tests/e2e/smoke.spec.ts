import { type Page, expect, test } from '@playwright/test';

/** 与 src/app/debug.ts 中 window.__orbitalFrontier 对应的最小类型。 */
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
interface DebugState {
  frame: {
    valid: boolean;
    simTime: number;
    earthAngle: number;
    cameraAltitude: number;
    cameraDistance: number;
    cameraPosition: Vec3;
    vehiclePosition: Vec3;
    sunDirection: Vec3;
  };
  sim: {
    status: string;
    execution: string | null;
    paused: boolean;
    timeWarp: number;
    maxTimeWarp: number;
    simRate: number;
    telemetry: null | {
      simTime: number;
      missionTime: number | null;
      phase: string;
      altitude: number;
      inertialSpeed: number;
      surfaceSpeed: number;
      verticalSpeed: number;
      gLoad: number;
      latitude: number;
      longitude: number;
      mass: number;
      pitch: number;
      heading: number | null;
      throttle: number;
      thrust: number;
      ignited: boolean;
      dynamicPressure: number;
      mach: number;
      remainingDeltaV: number;
      activeStageIndex: number;
      fairingAttached: boolean;
      stagePropellant: number[];
      stageAttached: boolean[];
    };
    events: string[];
    outcome: null | { kind: string; impactSpeed: number };
  };
  debrisCount: number;
  fps: number;
}

const readState = (page: Page): Promise<DebugState | null> =>
  page.evaluate(() => {
    const api = (window as unknown as { __orbitalFrontier?: Record<string, () => unknown> }).__orbitalFrontier;
    if (!api) return null;
    const frame = api.frame!() as DebugState['frame'] & { debris: unknown[] };
    const sim = api.sim!() as Omit<DebugState['sim'], 'events'> & { events: { kind: string }[] };
    const perf = api.perf!() as { fps: number };
    return {
      frame: {
        valid: frame.valid,
        simTime: frame.simTime,
        earthAngle: frame.earthAngle,
        cameraAltitude: frame.cameraAltitude,
        cameraDistance: frame.cameraDistance,
        cameraPosition: frame.cameraPosition,
        vehiclePosition: frame.vehiclePosition,
        sunDirection: frame.sunDirection,
      },
      sim: {
        status: sim.status,
        execution: sim.execution,
        paused: sim.paused,
        timeWarp: sim.timeWarp,
        maxTimeWarp: sim.maxTimeWarp,
        simRate: sim.simRate,
        telemetry: sim.telemetry,
        events: sim.events.map((e) => e.kind),
        outcome: sim.outcome ? { kind: sim.outcome.kind, impactSpeed: sim.outcome.impactSpeed } : null,
      },
      debrisCount: frame.debris.length,
      fps: perf.fps,
    };
  });

/** 递归检查对象中所有数值都是有限的（没有 NaN / Infinity）。 */
const collectNonFinite = (value: unknown, path = ''): string[] => {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path} = ${value}`];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectNonFinite(v, path ? `${path}.${k}` : k));
  }
  return [];
};

const expectAllFinite = async (page: Page): Promise<DebugState> => {
  const state = await readState(page);
  expect(state, '调试接口应当存在').not.toBeNull();
  expect(collectNonFinite(state)).toEqual([]);
  return state as DebugState;
};

/** 等到物理线程在运行且渲染层拿到了有效帧。 */
const waitForRunning = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => {
      const s = await readState(page);
      return !!s && s.sim.status === 'running' && s.frame.valid && s.sim.telemetry !== null;
    })
    .toBe(true);
};

const startApp = async (page: Page): Promise<string[]> => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  await page.goto('/', { waitUntil: 'load' });
  await waitForRunning(page);
  return problems;
};

const enterFlight = async (page: Page): Promise<void> => {
  await page.getByTestId('enter-flight').click();
  await expect(page.getByTestId('flight-hud')).toBeVisible();
};

test.describe('Orbital Frontier 冒烟测试', () => {
  test('页面加载：主菜单、三维画布、物理线程都正常，且没有报错', async ({ page }) => {
    const problems = await startApp(page);
    await expect(page).toHaveTitle(/Orbital Frontier/);
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ORBITAL FRONTIER' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(1);

    const state = await expectAllFinite(page);
    expect(state.sim.execution).toBe('worker');
    // 主菜单是环绕地球的远景机位
    expect(state.frame.cameraAltitude).toBeGreaterThan(5e6);
    expect(problems).toEqual([]);
  });

  test('三维场景确实画出了内容（不是黑屏）', async ({ page }) => {
    await startApp(page);
    await expect(page.getByTestId('loading-overlay')).toHaveCount(0);
    // 等待至少渲染出若干帧
    await expect.poll(async () => (await readState(page))?.fps ?? 0).toBeGreaterThan(0);
    // 截取画面右半部分（地球所在区域）。纯黑画面压缩后只有几 KB，真实地球影像熵很高。
    const shot = await page.screenshot({ clip: { x: 560, y: 60, width: 700, height: 600 } });
    expect(shot.byteLength).toBeGreaterThan(120_000);
  });

  test('进入发射台：飞行仪表显示物理上合理的读数', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);

    await expect(page.getByTestId('flight-phase')).toContainText('发射台待命');
    await expect(page.getByTestId('telemetry-panel')).toBeVisible();
    await expect(page.getByTestId('vehicle-panel')).toBeVisible();

    const state = await expectAllFinite(page);
    const t = state.sim.telemetry!;
    // 默认：边疆一号 @ 卡纳维拉尔角
    expect(t.altitude).toBeGreaterThan(10);
    expect(t.altitude).toBeLessThan(60);
    expect(t.surfaceSpeed).toBeLessThan(1e-6);
    expect(t.inertialSpeed).toBeGreaterThan(400);
    expect(t.inertialSpeed).toBeLessThan(415);
    expect(t.gLoad).toBeGreaterThan(0.99);
    expect(t.gLoad).toBeLessThan(1.01);
    expect((t.latitude * 180) / Math.PI).toBeCloseTo(28.5, 3);
    expect((t.longitude * 180) / Math.PI).toBeCloseTo(-80.6, 3);
    expect(t.mass).toBe(532_200);
    expect(t.pitch).toBeCloseTo(Math.PI / 2, 6);

    // 界面上不出现 NaN / Infinity / undefined 字样
    const hudText = await page.getByTestId('flight-hud').innerText();
    expect(hudText).not.toMatch(/NaN|Infinity|undefined/);
    await expect(page.getByTestId('readout-altitude')).toContainText('m');
    await expect(page.getByTestId('readout-latitude')).toContainText('28.50° N');
    await expect(page.getByTestId('readout-longitude')).toContainText('80.60° W');
    await expect(page.getByTestId('readout-twr')).toContainText('1.40');

    // 发射台上：点火按钮可用，导航球与节流阀已显示
    await expect(page.getByTestId('stage-button')).toBeEnabled();
    await expect(page.getByTestId('stage-button')).toContainText('点火起飞');
    await expect(page.getByTestId('navball')).toBeVisible();
    await expect(page.getByTestId('throttle-value')).toHaveText('100%');
    await expect(page.getByTestId('flight-hint')).toContainText('空格');
    // 尚未实现的仪表仍然标注阶段而不是显示数值
    await expect(page.getByTestId('telemetry-panel')).toContainText('阶段三');
  });

  test('暂停与恢复', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);

    await page.getByTestId('pause-button').click();
    await expect.poll(async () => (await readState(page))?.sim.paused).toBe(true);
    const frozen = (await readState(page))!.sim.telemetry!.simTime;
    await page.waitForTimeout(1500);
    const still = await readState(page);
    expect(still!.sim.telemetry!.simTime).toBe(frozen);
    expect(still!.sim.simRate).toBe(0);

    await page.getByTestId('pause-button').click();
    await expect.poll(async () => (await readState(page))?.sim.paused).toBe(false);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.simTime).toBeGreaterThan(frozen + 0.5);

    // 键盘快捷键 P 同样可以暂停
    await page.keyboard.press('p');
    await expect.poll(async () => (await readState(page))?.sim.paused).toBe(true);
  });

  test('时间倍率：1000× 下模拟时间按倍率推进，火箭仍固定在发射台', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);

    await page.getByTestId('warp-1000').click();
    await expect.poll(async () => (await readState(page))?.sim.timeWarp).toBe(1000);
    const t0 = (await readState(page))!.sim.telemetry!.simTime;
    const wall0 = Date.now();
    await page.waitForTimeout(3000);
    const state = await expectAllFinite(page);
    const elapsedSim = state.sim.telemetry!.simTime - t0;
    const elapsedWall = (Date.now() - wall0) / 1000;
    // 实际速率应接近 1000×（允许软件渲染环境下的调度抖动）
    expect(elapsedSim / elapsedWall).toBeGreaterThan(700);
    expect(elapsedSim / elapsedWall).toBeLessThan(1100);
    expect(state.sim.simRate).toBeGreaterThan(900);

    // 地球转过了可观的角度，但火箭相对地面没有移动
    const t = state.sim.telemetry!;
    expect(t.surfaceSpeed).toBeLessThan(1e-6);
    expect((t.latitude * 180) / Math.PI).toBeCloseTo(28.5, 3);
    expect((t.longitude * 180) / Math.PI).toBeCloseTo(-80.6, 3);

    // 快捷键 , 降低倍率
    await page.keyboard.press(',');
    await expect.poll(async () => (await readState(page))?.sim.timeWarp).toBe(100);
  });

  test('视角切换：四种机位都给出有效且符合预期的相机位置', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);

    // 跟随：过渡结束后相机在火箭附近
    await expect.poll(async () => (await readState(page))!.frame.cameraDistance, { timeout: 60_000 }).toBeLessThan(400);
    await expectAllFinite(page);

    await page.getByTestId('camera-orbit').click();
    await expect.poll(async () => (await readState(page))!.frame.cameraAltitude, { timeout: 60_000 }).toBeGreaterThan(5e6);
    await expectAllFinite(page);

    await page.getByTestId('camera-pad').click();
    await expect.poll(async () => (await readState(page))!.frame.cameraAltitude, { timeout: 60_000 }).toBeLessThan(200);
    const pad = await expectAllFinite(page);
    expect(pad.frame.cameraAltitude).toBeGreaterThan(1);

    await page.getByTestId('camera-free').click();
    await expect.poll(async () => (await readState(page))!.frame.cameraDistance, { timeout: 60_000 }).toBeLessThan(400);
    await expectAllFinite(page);

    // 快捷键 4 → 轨道视角
    await page.keyboard.press('4');
    await expect(page.getByTestId('camera-orbit')).toHaveAttribute('aria-pressed', 'true');
  });

  test('常见输入不会产生无效数值：拖拽、极限缩放、连续按键', async ({ page }) => {
    const problems = await startApp(page);
    await enterFlight(page);
    // 主画布（页面上还有导航球的小画布）
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    for (const mode of ['chase', 'free', 'pad', 'orbit'] as const) {
      await page.getByTestId(`camera-${mode}`).click();
      // 大幅拖拽（含试图把相机拖到地面以下）
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 900, cy + 700, { steps: 5 });
      await page.mouse.move(cx - 900, cy - 700, { steps: 5 });
      await page.mouse.up();
      // 极限缩放
      await page.mouse.wheel(0, -50_000);
      await page.mouse.wheel(0, 100_000);
      await page.mouse.wheel(0, -20_000);
      await page.waitForTimeout(600);
      const state = await expectAllFinite(page);
      // 相机始终在地面以上
      expect(state.frame.cameraAltitude).toBeGreaterThan(0.5);
    }

    // 连续按键（其中空格会点火起飞，W/A/Q 等会转动火箭——状态都应保持有效）
    for (const key of ['.', '.', '.', '.', '.', '.', '.', ',', 'p', 'p', 'c', 'c', 'c', '1', '2', '3', '4', ' ', 'w', 'a', 'q', 'z', 'x', 'f', 'ArrowUp', 'ArrowDown', 'Escape', ' ']) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(800);
    const state = await expectAllFinite(page);
    expect(state.sim.status).toBe('running');
    expect(problems).toEqual([]);
  });

  test('选择不同火箭与发射场会改变物理状态；返回主菜单后复位', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('vehicle-zenith-3').click();
    await page.getByTestId('site-kourou').click();
    await expect
      .poll(async () => {
        const t = (await readState(page))?.sim.telemetry;
        return t ? Math.round((t.latitude * 180) / Math.PI * 100) / 100 : null;
      })
      .toBe(5.24);
    const state = await expectAllFinite(page);
    expect(state.sim.telemetry!.mass).toBe(607_200);
    // 近赤道发射场的自转线速度更高
    expect(state.sim.telemetry!.inertialSpeed).toBeGreaterThan(460);

    await enterFlight(page);
    await expect(page.getByTestId('vehicle-panel')).toContainText('天顶三号');
    await expect(page.getByTestId('stage-2')).toBeVisible();

    await page.getByTestId('warp-100').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.simTime).toBeGreaterThan(50);
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    // 回到主菜单：模拟复位（时间归零附近、倍率回到 1×）
    // （复位瞬间第一个快照尚未到达时遥测为空，轮询直到拿到新数据。）
    await expect.poll(async () => (await readState(page))!.sim.timeWarp).toBe(1);
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.simTime ?? Infinity).toBeLessThan(30);
    await waitForRunning(page);
    await expectAllFinite(page);
  });

  test('玩家选择会保存到本地并在刷新后恢复', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('vehicle-meteor-s').click();
    await page.getByTestId('site-jiuquan').click();
    await expect(page.getByTestId('vehicle-meteor-s')).toHaveAttribute('aria-pressed', 'true');
    await page.reload({ waitUntil: 'load' });
    await waitForRunning(page);
    await expect(page.getByTestId('vehicle-meteor-s')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('site-jiuquan')).toHaveAttribute('aria-pressed', 'true');
    const state = await expectAllFinite(page);
    expect(state.sim.telemetry!.mass).toBe(14_900);
  });

  test('点火起飞：火箭离开发射台，仪表与事件记录反映真实的飞行状态', async ({ page }) => {
    const problems = await startApp(page);
    await enterFlight(page);
    const before = (await readState(page))!.sim.telemetry!;
    expect(before.phase).toBe('prelaunch');
    expect(before.missionTime).toBeNull();

    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.phase).toBe('flight');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 60_000 }).toBeGreaterThan(before.altitude + 50);

    const state = await expectAllFinite(page);
    const t = state.sim.telemetry!;
    expect(t.missionTime).toBeGreaterThan(0);
    expect(t.thrust).toBeGreaterThan(7.0e6);
    expect(t.thrust).toBeLessThan(8.2e6);
    expect(t.verticalSpeed).toBeGreaterThan(5);
    expect(t.gLoad).toBeGreaterThan(1.3);
    expect(t.gLoad).toBeLessThan(2.0);
    expect(t.stagePropellant[0]!).toBeLessThan(400_000);
    expect(t.mass).toBeLessThan(532_200);
    expect(state.sim.events.slice(0, 2)).toEqual(['ignition', 'liftoff']);
    // 发动机工作时时间倍率受限
    expect(state.sim.maxTimeWarp).toBe(5);
    await expect(page.getByTestId('warp-100')).toBeDisabled();
    await expect(page.getByTestId('warp-5')).toBeEnabled();

    await expect(page.getByTestId('flight-phase')).toContainText('动力飞行');
    await expect(page.getByTestId('mission-clock')).toContainText('T+');
    await expect(page.getByTestId('readout-engine')).toContainText('工作');
    await expect(page.getByTestId('event-log')).toContainText('起飞');
    await expect(page.getByTestId('stage-button')).toContainText('分离一级');
    const hudText = await page.getByTestId('flight-hud').innerText();
    expect(hudText).not.toMatch(/NaN|Infinity|undefined/);
    expect(problems).toEqual([]);
  });

  test('姿态与节流控制：按住 D 向东倾斜；节流阀按钮与方向键生效', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.missionTime ?? 0, { timeout: 60_000 }).toBeGreaterThan(4);

    await page.keyboard.down('KeyD');
    await expect.poll(async () => ((await readState(page))!.sim.telemetry!.pitch * 180) / Math.PI, { timeout: 60_000 }).toBeLessThan(80);
    await page.keyboard.up('KeyD');
    const tilted = (await readState(page))!.sim.telemetry!;
    expect(tilted.heading).not.toBeNull();
    expect((tilted.heading! * 180) / Math.PI).toBeGreaterThan(85);
    expect((tilted.heading! * 180) / Math.PI).toBeLessThan(95);
    // 松开后姿态保持：一秒后俯仰角变化很小
    await page.waitForTimeout(1500);
    const held = (await readState(page))!.sim.telemetry!;
    expect(Math.abs(held.pitch - tilted.pitch) * (180 / Math.PI)).toBeLessThan(6);

    // 节流：按钮关机 → 推力为 0；Z 恢复满推力；方向键下调
    await page.getByTestId('throttle-cut').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.throttle).toBe(0);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);
    await expect(page.getByTestId('flight-phase')).toContainText('无动力滑行');
    await page.keyboard.press('KeyZ');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.throttle).toBe(1);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBeGreaterThan(1e6);
    await page.keyboard.down('ArrowDown');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.throttle).toBeLessThan(0.8);
    await page.keyboard.up('ArrowDown');
    await expectAllFinite(page);
  });

  test('关机后火箭继续按引力与阻力运动并最终坠毁；显示飞行结果，可重新发射', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('vehicle-meteor-s').click();
    await enterFlight(page);
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.mass).toBe(14_900);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 60_000 }).toBeGreaterThan(40);
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);
    const coasting = (await readState(page))!.sim.telemetry!;
    // 关机瞬间仍在上升：惯性
    expect(coasting.phase).toBe('flight');

    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 90_000 }).toBe('destroyed');
    const state = await expectAllFinite(page);
    expect(state.sim.outcome!.impactSpeed).toBeGreaterThan(10);
    expect(state.sim.telemetry!.phase).toBe('destroyed');
    await expect(page.getByTestId('flight-summary')).toBeVisible();
    await expect(page.getByTestId('flight-outcome')).toHaveText('飞行器损毁');
    await expect(page.getByTestId('flight-summary')).toContainText('最大高度');
    await expect(page.getByTestId('flight-summary')).toContainText('垂直速度');

    // 重新发射：回到发射台初始状态
    await page.getByTestId('summary-restart').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.phase ?? null).toBe('prelaunch');
    await expect(page.getByTestId('flight-summary')).toHaveCount(0);
    const reset = await expectAllFinite(page);
    expect(reset.sim.telemetry!.stagePropellant[0]).toBe(10_500);
    expect(reset.sim.events).toEqual([]);
  });

  test('分级：分离后质量下降、下一级点火，被抛掉的箭体作为分离体继续被跟踪', async ({ page }) => {
    await startApp(page);
    await enterFlight(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.missionTime ?? 0, { timeout: 60_000 }).toBeGreaterThan(5);
    await page.getByTestId('stage-button').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.activeStageIndex).toBe(1);
    await expect.poll(async () => (await readState(page))!.debrisCount, { timeout: 30_000 }).toBe(1);
    const state = await expectAllFinite(page);
    const t = state.sim.telemetry!;
    expect(t.stageAttached).toEqual([false, true]);
    expect(t.mass).toBeLessThan(110_000);
    expect(state.sim.events).toContain('separation');
    await expect(page.getByTestId('stage-0')).toContainText('已分离');
    await expect(page.getByTestId('stage-button')).toContainText('分离二级');
    await expect(page.getByTestId('event-log')).toContainText('一级分离');
  });

  test('整流罩：飞行中按 F 抛罩，产生两个半罩分离体', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('vehicle-zenith-3').click();
    await enterFlight(page);
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.mass).toBe(607_200);
    await expect(page.getByTestId('fairing-button')).toBeDisabled();
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.missionTime ?? 0, { timeout: 60_000 }).toBeGreaterThan(4);
    await expect(page.getByTestId('fairing-button')).toBeEnabled();
    await page.keyboard.press('KeyF');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.fairingAttached).toBe(false);
    await expect.poll(async () => (await readState(page))!.debrisCount, { timeout: 30_000 }).toBe(2);
    await expect(page.getByTestId('payload-row')).toContainText('整流罩已抛');
    await expect(page.getByTestId('fairing-button')).toBeDisabled();
    await expectAllFinite(page);
  });
});
