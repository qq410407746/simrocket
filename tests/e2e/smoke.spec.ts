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
    simRate: number;
    telemetry: null | {
      simTime: number;
      altitude: number;
      inertialSpeed: number;
      surfaceSpeed: number;
      gLoad: number;
      latitude: number;
      longitude: number;
      mass: number;
      pitch: number;
    };
  };
  fps: number;
}

const readState = (page: Page): Promise<DebugState | null> =>
  page.evaluate(() => {
    const api = (window as unknown as { __orbitalFrontier?: Record<string, () => unknown> }).__orbitalFrontier;
    if (!api) return null;
    const frame = api.frame!() as DebugState['frame'];
    const sim = api.sim!() as DebugState['sim'];
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
        simRate: sim.simRate,
        telemetry: sim.telemetry,
      },
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

    // 尚未实现的飞行控制必须是禁用状态
    await expect(page.getByTestId('ignite-button')).toBeDisabled();
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
    const canvas = page.locator('canvas');
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

    for (const key of ['.', '.', '.', '.', '.', '.', '.', ',', 'p', 'p', 'c', 'c', 'c', '1', '2', '3', '4', 'x', 'Escape', ' ']) {
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
});
