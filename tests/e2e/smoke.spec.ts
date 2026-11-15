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
    mapVisibility: number;
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
      heatShieldAttached: boolean;
      canJettisonHeatShield: boolean;
      trimAngle: number;
      bankAngle: number;
      angleOfAttack: number;
      liftToDrag: number;
      stagePropellant: number[];
      stageAttached: boolean[];
      attitudeMode: string;
      referenceHeatFlux: number;
      thermal: { zone: string; material: string; surfaceTemperature: number; heatFlux: number; ablatorFraction: number; margin: number }[];
      parachute: { phase: string; dragArea: number };
      orbit: null | {
        classification: string;
        apoapsisAltitude: number;
        periapsisAltitude: number;
        inclination: number;
        eccentricity: number;
        period: number;
        timeToApoapsis: number | null;
      };
    };
    events: string[];
    outcome: null | {
      kind: string;
      cause: string | null;
      thermalZone: string | null;
      altitude: number;
      impactSpeed: number;
      latitude: number;
      longitude: number;
      time: number;
    };
    stats: null | { maxGLoad: number; maxDynamicPressure: number; maxHeatFlux: number; maxSurfaceTemperature: number; maxAltitude: number };
    predictedImpact: null | { time: number; latitude: number; longitude: number; speed: number };
    missionId: string | null;
    mission: null | {
      status: string;
      failure: string | null;
      objectives: { id: string; status: string; resolvedAt: number | null }[];
    };
    missionScore: null | { total: number; grade: string; items: { id: string; points: number; weight: number }[] };
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
        mapVisibility: frame.mapVisibility,
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
        stats: sim.stats
          ? {
              maxGLoad: sim.stats.maxGLoad,
              maxDynamicPressure: sim.stats.maxDynamicPressure,
              maxHeatFlux: sim.stats.maxHeatFlux,
              maxSurfaceTemperature: sim.stats.maxSurfaceTemperature,
              maxAltitude: sim.stats.maxAltitude,
            }
          : null,
        outcome: sim.outcome
          ? {
              kind: sim.outcome.kind,
              cause: sim.outcome.cause,
              thermalZone: sim.outcome.thermalZone,
              altitude: sim.outcome.altitude,
              impactSpeed: sim.outcome.impactSpeed,
              latitude: sim.outcome.latitude,
              longitude: sim.outcome.longitude,
              time: sim.outcome.time,
            }
          : null,
        predictedImpact: sim.predictedImpact,
        missionId: sim.missionId,
        mission: sim.mission
          ? {
              status: sim.mission.status,
              failure: sim.mission.failure,
              objectives: sim.mission.objectives.map((o) => ({ id: o.id, status: o.status, resolvedAt: o.resolvedAt })),
            }
          : null,
        missionScore: sim.missionScore
          ? {
              total: sim.missionScore.total,
              grade: sim.missionScore.grade,
              items: sim.missionScore.items.map((item) => ({ id: item.id, points: item.points, weight: item.weight })),
            }
          : null,
      },
      debrisCount: frame.debris.length,
      fps: perf.fps,
    };
  });

/**
 * 递归检查对象中所有数值都是有限的（没有 NaN / Infinity）。
 * 唯一的例外是结构限值里表示"没有这项限制"的 Infinity（返回舱没有横向气动载荷限值）。
 */
const collectNonFinite = (value: unknown, path = ''): string[] => {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return [];
    return value === Infinity && path.endsWith('structure.maxBendingLoad') ? [] : [`${path} = ${value}`];
  }
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

/** 打开页面并等物理线程运行起来。主菜单停在默认的"任务"页签。 */
const openApp = async (page: Page): Promise<string[]> => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  await page.goto('/', { waitUntil: 'load' });
  await waitForRunning(page);
  // These flight smoke tests exercise the sandbox, now a separate main-menu tab.
  await page.getByTestId('tab-sandbox').click();
  return problems;
};

/** 打开页面并切到"自由飞行"页签（选择火箭、发射场与出发点）。 */
const startApp = async (page: Page): Promise<string[]> => {
  const problems = await openApp(page);
  await page.getByTestId('tab-sandbox').click();
  await expect(page.getByTestId('enter-flight')).toBeVisible();
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
    // 轨道读数在起飞前不给数值
    expect(t.orbit).toBeNull();
    await expect(page.getByTestId('orbit-status')).toHaveCount(0);

    // 热防护面板：发射台上各表面都是环境温度（15 °C），没有加热，风险正常
    await expect(page.getByTestId('thermal-panel')).toBeVisible();
    await expect(page.getByTestId('thermal-risk')).toHaveText('正常');
    await expect(page.getByTestId('readout-surface-temperature')).toHaveText('15');
    await expect(page.getByTestId('readout-heat-flux')).toHaveText('0.0');
    expect(t.thermal.map((z) => z.zone)).toEqual(['nose', 'side', 'base']);
    for (const z of t.thermal) {
      expect(z.surfaceTemperature).toBeCloseTo(288.15, 1);
      expect(z.margin).toBe(1);
    }
    // 降落伞：带着推进级时不可用
    expect(t.parachute.phase).toBe('none');
    await expect(page.getByTestId('parachute-button')).toBeDisabled();
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

  test('视角切换：各机位都给出有效且符合预期的相机位置', async ({ page }) => {
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

    // 轨道地图：按钮与快捷键 M；相机拉远到地球之外，地图内容淡入
    await page.getByTestId('camera-map').click();
    await expect(page.getByTestId('camera-map')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('map-overlay')).toBeVisible();
    await expect.poll(async () => (await readState(page))!.frame.mapVisibility, { timeout: 60_000 }).toBe(1);
    await expect.poll(async () => (await readState(page))!.frame.cameraAltitude, { timeout: 60_000 }).toBeGreaterThan(1e7);
    await expectAllFinite(page);
    await page.keyboard.press('m');
    await expect(page.getByTestId('camera-chase')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('map-overlay')).toHaveCount(0);
  });

  test('常见输入不会产生无效数值：拖拽、极限缩放、连续按键', async ({ page }) => {
    const problems = await startApp(page);
    await enterFlight(page);
    // 主画布（页面上还有导航球的小画布）
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    for (const mode of ['chase', 'free', 'pad', 'orbit', 'map'] as const) {
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
    for (const key of ['.', '.', '.', '.', '.', '.', '.', ',', 'p', 'p', 'c', 'c', 'c', '1', '2', '3', '4', '5', 'm', 'm', ' ', 'w', 'a', 'q', 'r', 't', 't', 'z', 'x', 'f', 'ArrowUp', 'ArrowDown', 'Escape', ' ']) {
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
    await expect.poll(async () => ((await readState(page))!.sim.telemetry!.pitch * 180) / Math.PI, { timeout: 60_000 }).toBeLessThan(85);
    await page.keyboard.up('KeyD');
    const tilted = (await readState(page))!.sim.telemetry!;
    expect(tilted.heading).not.toBeNull();
    expect((tilted.heading! * 180) / Math.PI).toBeGreaterThan(85);
    expect((tilted.heading! * 180) / Math.PI).toBeLessThan(95);
    // 松开后姿态保持：一秒后俯仰角变化很小
    await page.waitForTimeout(1500);
    const held = (await readState(page))!.sim.telemetry!;
    expect(Math.abs(held.pitch - tilted.pitch) * (180 / Math.PI)).toBeLessThan(6);
    // 之后交给顺行保持：带着迎角一直飞进大动压区，箭体会被横向气动载荷折断（阶段四的结构限值）
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.attitudeMode).toBe('prograde');

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

const DEG = 180 / Math.PI;

/** 主菜单选择"从近地轨道出发"并进入飞行。 */
const enterOrbit = async (page: Page): Promise<void> => {
  await page.getByTestId('start-orbit').click();
  await expect(page.getByTestId('start-orbit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('enter-flight')).toContainText('进入轨道');
  await expect.poll(async () => (await readState(page))!.sim.telemetry?.phase ?? null).toBe('flight');
  await enterFlight(page);
};

test.describe('轨道动力学（阶段三）', () => {
  test('从近地轨道出发：轨道读数与理论值一致，滑行一段时间后轨道不变', async ({ page }) => {
    const problems = await startApp(page);
    await enterOrbit(page);

    const state = await expectAllFinite(page);
    const t = state.sim.telemetry!;
    const orbit = t.orbit!;
    expect(orbit.classification).toBe('orbit');
    expect(orbit.apoapsisAltitude / 1000).toBeCloseTo(200, 1);
    expect(orbit.periapsisAltitude / 1000).toBeCloseTo(200, 1);
    expect(orbit.eccentricity).toBeLessThan(1e-4);
    // 向正东入轨：倾角等于发射场纬度
    expect(orbit.inclination * DEG).toBeCloseTo(28.5, 1);
    // 200 km 圆轨道：T = 2π√(a³/μ) ≈ 88.4 min，v = √(μ/r) ≈ 7788 m/s
    expect(orbit.period / 60).toBeCloseTo(88.4, 0);
    expect(t.inertialSpeed).toBeGreaterThan(7780);
    expect(t.inertialSpeed).toBeLessThan(7796);
    expect(t.gLoad).toBeLessThan(0.01);
    expect(t.activeStageIndex).toBe(1);
    expect(t.attitudeMode).toBe('manual');
    expect(state.sim.maxTimeWarp).toBe(1000);
    expect(state.sim.predictedImpact).toBeNull();

    await expect(page.getByTestId('flight-phase')).toContainText('在轨滑行');
    await expect(page.getByTestId('orbit-status')).toHaveText('在轨');
    await expect(page.getByTestId('readout-apoapsis')).toContainText('200.0');
    await expect(page.getByTestId('readout-periapsis')).toContainText('200.0');
    await expect(page.getByTestId('readout-inclination')).toHaveText('28.50');
    await expect(page.getByTestId('stage-button')).toContainText('启动二级');

    // 1000× 滑行约半圈：200 km 高度只有极稀薄的大气，轨道几乎不变，高度始终在 200 km 附近
    await page.getByTestId('warp-1000').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.simTime, { timeout: 60_000 }).toBeGreaterThan(2_600);
    await page.getByTestId('warp-1').click();
    const later = await expectAllFinite(page);
    const o2 = later.sim.telemetry!.orbit!;
    expect(o2.classification).toBe('orbit');
    expect(Math.abs(later.sim.telemetry!.altitude - 200_000)).toBeLessThan(3_000);
    expect(o2.apoapsisAltitude).toBeGreaterThan(195_000);
    expect(o2.apoapsisAltitude).toBeLessThan(200_500);
    expect(o2.inclination * DEG).toBeCloseTo(28.5, 1);
    const hudText = await page.getByTestId('flight-hud').innerText();
    expect(hudText).not.toMatch(/NaN|Infinity|undefined/);
    expect(problems).toEqual([]);
  });

  test('轨道地图：画出轨道，地图说明与标记可见，画面不是空的', async ({ page }) => {
    const problems = await startApp(page);
    await enterOrbit(page);
    await page.keyboard.press('m');
    await expect(page.getByTestId('camera-map')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('map-overlay')).toContainText('当前轨道');
    await expect.poll(async () => (await readState(page))!.frame.mapVisibility, { timeout: 60_000 }).toBe(1);
    // 等过渡结束：相机到地心的距离约为轨道半径的 5.4 倍
    await expect
      .poll(async () => (await readState(page))!.frame.cameraAltitude, { timeout: 60_000 })
      .toBeGreaterThan(2.5e7);
    const state = await expectAllFinite(page);
    expect(state.frame.cameraAltitude).toBeLessThan(3.5e7);
    // 稳定轨道：没有预计落点
    await expect(page.getByTestId('predicted-impact')).toHaveCount(0);
    await expect(page.getByTestId('no-predicted-impact')).toBeVisible();
    // 图例里列出六个轨道根数
    await expect(page.getByTestId('orbital-elements')).toContainText('轨道根数');
    await expect(page.getByTestId('orbital-elements')).toContainText('28.50°');
    await expect(page.getByTestId('orbital-elements')).toContainText('Ω');

    // 地球与轨道所在的区域确实画出了内容
    const shot = await page.screenshot({ clip: { x: 440, y: 90, width: 560, height: 400 } });
    expect(shot.byteLength).toBeGreaterThan(60_000);

    // 在地图里拖动、缩放后状态仍然有效
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height * 0.3 + 200, { steps: 4 });
    await page.mouse.up();
    await page.mouse.wheel(0, 4_000);
    await page.waitForTimeout(500);
    await expectAllFinite(page);
    expect(problems).toEqual([]);
  });

  test('顺行保持 + 点火：抬高远地点，近地点基本不变（轨道机动的基本规律）', async ({ page }) => {
    await startApp(page);
    await enterOrbit(page);

    await page.getByTestId('attitude-prograde').click();
    await expect(page.getByTestId('attitude-prograde')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.attitudeMode).toBe('prograde');
    // 入轨姿态本来就朝东：很快对准速度方向（俯仰≈0，航向≈90°）
    await expect.poll(async () => Math.abs((await readState(page))!.sim.telemetry!.pitch) * DEG, { timeout: 30_000 }).toBeLessThan(1);

    // 启动二级并给满推力
    await page.getByTestId('stage-button').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.ignited).toBe(true);
    expect((await readState(page))!.sim.telemetry!.thrust).toBe(0);
    await page.keyboard.press('KeyZ');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBeGreaterThan(5e5);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.orbit!.apoapsisAltitude, { timeout: 60_000 }).toBeGreaterThan(450_000);
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);

    const state = await expectAllFinite(page);
    const orbit = state.sim.telemetry!.orbit!;
    expect(orbit.classification).toBe('orbit');
    // 顺行加速只抬高轨道另一侧：近地点仍在点火高度附近
    expect(orbit.periapsisAltitude).toBeGreaterThan(195_000);
    expect(orbit.periapsisAltitude).toBeLessThan(215_000);
    expect(orbit.eccentricity).toBeGreaterThan(0.015);
    expect(orbit.period).toBeGreaterThan(90 * 60);
    // 倾角不变（推力在轨道面内）
    expect(orbit.inclination * DEG).toBeCloseTo(28.5, 1);
    expect(state.sim.events).toContain('ignition');
    await expect(page.getByTestId('orbit-status')).toHaveText('在轨');

    // R 再按一次回到手动
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.attitudeMode).toBe('manual');
    await expect(page.getByTestId('attitude-manual')).toHaveAttribute('aria-pressed', 'true');
  });

  test('逆行点火离轨：出现预测轨迹与预计落点，返回舱最终落在预测的位置', async ({ page }) => {
    test.setTimeout(240_000);
    await startApp(page);
    await enterOrbit(page);
    await page.keyboard.press('m');

    // 逆行保持：等箭体调头（最大 8°/s，约 23 s；10× 下几秒）
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('attitude-retrograde')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('warp-10').click();
    await expect
      .poll(
        async () => {
          const t = (await readState(page))!.sim.telemetry!;
          // 头部朝西（逆行）且贴近当地水平面
          return t.heading !== null && t.heading * DEG > 265 && Math.abs(t.pitch) * DEG < 3;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.getByTestId('warp-1').click();

    // 点火减速，直到近地点落到地面以下
    await page.keyboard.press('Space');
    await page.keyboard.press('KeyZ');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.orbit!.periapsisAltitude, { timeout: 60_000 }).toBeLessThan(-150_000);
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);
    // 分离二级：带着推进级再入会在高空烧毁（发动机舱没有防热设计），只有返回舱能落到地面
    await expect(page.getByTestId('flight-hint')).toContainText('分离二级');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.activeStageIndex).toBe(2);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase).toBe('stowed');
    await expect(page.getByTestId('parachute-button')).toBeEnabled();

    await expect(page.getByTestId('orbit-status')).toHaveText('亚轨道');
    await expect.poll(async () => (await readState(page))!.sim.predictedImpact, { timeout: 15_000 }).not.toBeNull();
    await expect(page.getByTestId('predicted-impact')).toBeVisible();
    await expect(page.getByTestId('predicted-impact')).toContainText('预计落点');
    await expectAllFinite(page);
    // 预测每 0.5 s 更新一次：等到相邻两次结果一致（确保拿到的是关机之后的预测）
    let predicted = (await readState(page))!.sim.predictedImpact!;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(800);
      const next = (await readState(page))!.sim.predictedImpact!;
      const settled = Math.abs(next.time - predicted.time) < 0.5;
      predicted = next;
      if (settled) break;
    }
    const now = (await readState(page))!.sim.telemetry!.simTime;
    // 从 200 km 轨道离轨：十几到二十几分钟后落地
    expect(predicted.time - now).toBeGreaterThan(600);
    expect(predicted.time - now).toBeLessThan(2_400);

    // 快进到落地（保持逆行指向：防热大底朝前）；故意不开伞。再入加热开始后倍率自动限制在 10×
    await page.getByTestId('warp-1000').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 90_000 }).toBeLessThan(70_000);
    await expect.poll(async () => (await readState(page))!.sim.maxTimeWarp).toBe(10);
    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 150_000 }).toBe('destroyed');

    const state = await expectAllFinite(page);
    const outcome = state.sim.outcome!;
    // 返回舱扛住了再入，但没有开伞：以上百 m/s 撞击地面
    expect(outcome.cause).toBe('impact');
    expect(outcome.impactSpeed).toBeGreaterThan(80);
    expect(outcome.impactSpeed).toBeLessThan(200);
    await expect(page.getByTestId('flight-cause')).toHaveText('撞击地面');
    await expect(page.getByTestId('flight-reasons')).toContainText('降落伞没有打开');
    // 预测是在落地前约 20 分钟、相隔几千公里时做出的
    expect(Math.abs(outcome.time - predicted.time)).toBeLessThan(5);
    const kmPerRad = 6371;
    const miss = Math.hypot(
      (outcome.latitude - predicted.latitude) * kmPerRad,
      (outcome.longitude - predicted.longitude) * kmPerRad * Math.cos(outcome.latitude),
    );
    expect(miss).toBeLessThan(10);
    await expect(page.getByTestId('flight-summary')).toBeVisible();
  });
});

/** 从近地轨道出发，逆行点火离轨并分离二级：只剩返回舱在一条再入轨道上。 */
const deorbitCapsule = async (page: Page): Promise<void> => {
  await enterOrbit(page);
  await page.keyboard.press('KeyT');
  await page.getByTestId('warp-10').click();
  await expect
    .poll(
      async () => {
        const t = (await readState(page))!.sim.telemetry!;
        return t.heading !== null && t.heading * DEG > 265 && Math.abs(t.pitch) * DEG < 3;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.getByTestId('warp-1').click();
  await page.keyboard.press('Space');
  await page.keyboard.press('KeyZ');
  await expect.poll(async () => (await readState(page))!.sim.telemetry!.orbit!.periapsisAltitude, { timeout: 60_000 }).toBeLessThan(30_000);
  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readState(page))!.sim.telemetry!.activeStageIndex).toBe(2);
};

test.describe('再入与热防护（阶段四）', () => {
  test('完整返回：防热大底朝前再入，仪表显示热流与温度，开伞后安全着陆', async ({ page }) => {
    test.setTimeout(360_000);
    const problems = await startApp(page);
    await deorbitCapsule(page);
    // 逆行保持仍然有效：返回舱的防热大底朝前
    expect((await readState(page))!.sim.telemetry!.attitudeMode).toBe('retrograde');
    await expect(page.getByTestId('thermal-zone-base')).toContainText('烧蚀防热层');
    await expect(page.getByTestId('thermal-zone-base')).toContainText('余 100%');

    await page.getByTestId('warp-1000').click();
    // 再入加热：热流升到几百 kW/m²，倍率被限制，阶段显示"再入大气层"
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.referenceHeatFlux, { timeout: 120_000 }).toBeGreaterThan(300_000);
    const heating = await expectAllFinite(page);
    expect(heating.sim.maxTimeWarp).toBe(10);
    expect(heating.sim.telemetry!.altitude).toBeGreaterThan(40_000);
    await expect(page.getByTestId('flight-phase')).toContainText('再入大气层');
    await expect(page.getByTestId('thermal-subject')).toHaveText('防热大底');
    const shield = heating.sim.telemetry!.thermal.find((z) => z.zone === 'base')!;
    expect(shield.heatFlux).toBeGreaterThan(100_000);
    expect(shield.surfaceTemperature).toBeGreaterThan(900);
    // 面板上的读数与物理状态一致：热流单位已切到 kW/m² 的三位数
    const fluxText = await page.getByTestId('readout-heat-flux').innerText();
    expect(Number(fluxText.replace(/,/g, ''))).toBeGreaterThan(100);
    await expect(page.getByTestId('thermal-chart')).toBeVisible();
    await expect(page.getByTestId('flight-hint')).toContainText('再入中');

    // 减速到亚声速后提示开伞
    await expect(page.getByTestId('flight-hint')).toContainText('已降到亚声速', { timeout: 200_000 });
    const subsonic = (await readState(page))!.sim.telemetry!;
    expect(subsonic.mach).toBeLessThan(0.9);
    expect(subsonic.altitude).toBeLessThan(12_000);
    expect(subsonic.altitude).toBeGreaterThan(1_500);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase).toMatch(/drogue|main/);
    await expect(page.getByTestId('flight-phase')).toContainText('伞降');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase, { timeout: 60_000 }).toBe('main');
    await expect(page.getByTestId('parachute-button')).toContainText('主伞');
    await expectAllFinite(page);

    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 200_000 }).toBe('landed');
    const state = await expectAllFinite(page);
    const outcome = state.sim.outcome!;
    expect(outcome.cause).toBeNull();
    expect(outcome.impactSpeed).toBeGreaterThan(5);
    expect(outcome.impactSpeed).toBeLessThan(10);
    const stats = state.sim.stats!;
    // 弹道再入：峰值过载约 8 g，峰值热流约 0.5 MW/m²，表面达到烧蚀温度 1500 K
    expect(stats.maxGLoad).toBeGreaterThan(7);
    expect(stats.maxGLoad).toBeLessThan(10);
    expect(stats.maxHeatFlux).toBeGreaterThan(350_000);
    expect(stats.maxHeatFlux).toBeLessThan(800_000);
    expect(stats.maxSurfaceTemperature).toBe(1_500);
    // 烧蚀层消耗了一部分
    const final = state.sim.telemetry!.thermal.find((z) => z.zone === 'base')!;
    expect(final.ablatorFraction).toBeGreaterThan(0.6);
    expect(final.ablatorFraction).toBeLessThan(0.95);
    expect(state.sim.events).toEqual(expect.arrayContaining(['separation', 'drogue-deployed', 'main-deployed', 'landed']));

    await expect(page.getByTestId('flight-outcome')).toHaveText('已着陆');
    await expect(page.getByTestId('flight-summary')).toContainText('最大热流');
    await expect(page.getByTestId('flight-summary')).toContainText('1,227 °C');
    await expect(page.getByTestId('flight-cause')).toHaveCount(0);
    const hudText = await page.getByTestId('flight-hud').innerText();
    expect(hudText).not.toMatch(/NaN|Infinity|undefined/);
    expect(problems).toEqual([]);
  });

  test('危险的再入：舱顶朝前（没有防热大底保护），在高空烧毁并说明原因', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await startApp(page);
    await deorbitCapsule(page);
    // 改成顺行保持：舱顶朝前
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.attitudeMode).toBe('prograde');
    await page.getByTestId('warp-10').click();
    await expect
      .poll(
        async () => {
          const t = (await readState(page))!.sim.telemetry!;
          return t.heading !== null && Math.abs(t.heading * DEG - 100) < 25 && Math.abs(t.pitch) * DEG < 4;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.getByTestId('warp-1000').click();
    // 进入大气层前界面已经给出警告
    await expect(page.getByTestId('flight-hint')).toContainText('防热大底没有朝前', { timeout: 120_000 });

    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 150_000 }).toBe('destroyed');
    const state = await expectAllFinite(page);
    const outcome = state.sim.outcome!;
    expect(outcome.cause).toBe('thermal-surface');
    expect(outcome.thermalZone).toBe('nose');
    // 在 60–100 km 的高空、仍以轨道速度飞行时解体
    expect(outcome.altitude).toBeGreaterThan(60_000);
    expect(outcome.altitude).toBeLessThan(100_000);
    expect(outcome.impactSpeed).toBeGreaterThan(6_500);
    // 防热大底在背风面，完好无损
    expect(state.sim.telemetry!.thermal.find((z) => z.zone === 'base')!.ablatorFraction).toBe(1);

    await expect(page.getByTestId('flight-phase')).toContainText('飞行器损毁');
    await expect(page.getByTestId('flight-outcome')).toHaveText('飞行器损毁');
    await expect(page.getByTestId('flight-cause')).toHaveText('表面过热');
    await expect(page.getByTestId('flight-reasons')).toContainText('头部（隔热瓦）的表面温度超过了材料的最高工作温度');
    await expect(page.getByTestId('flight-reasons')).toContainText('逆行保持');
    await expect(page.getByTestId('thermal-risk')).toContainText('已失效');
    // 重新发射后一切复位
    await page.getByTestId('summary-restart').click();
    await expect.poll(async () => (await readState(page))!.sim.outcome).toBeNull();
    await expect(page.getByTestId('thermal-risk')).toHaveText('正常');
    expect(problems).toEqual([]);
  });

  test('配平再入与抛大底：Y 保持配平迎角产生升力，Q / E 改变倾侧角；主伞张开后按 H 抛掉防热大底', async ({ page }) => {
    test.setTimeout(420_000);
    const problems = await startApp(page);
    await enterOrbit(page);
    // 带着推进级时：不能配平、不能抛大底
    await expect(page.getByTestId('attitude-trim')).toBeDisabled();
    await expect(page.getByTestId('heat-shield-button')).toBeDisabled();
    await page.keyboard.press('KeyT');
    await page.getByTestId('warp-10').click();
    await expect
      .poll(
        async () => {
          const t = (await readState(page))!.sim.telemetry!;
          return t.heading !== null && t.heading * DEG > 265 && Math.abs(t.pitch) * DEG < 3;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await page.getByTestId('warp-1').click();
    await page.keyboard.press('Space');
    await page.keyboard.press('KeyZ');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.orbit!.periapsisAltitude, { timeout: 60_000 }).toBeLessThan(30_000);
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.thrust).toBe(0);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.activeStageIndex).toBe(2);

    // 只剩返回舱：配平迎角约 20°（由质心偏移算出），可以进入配平模式
    const alone = (await readState(page))!.sim.telemetry!;
    expect(alone.trimAngle * DEG).toBeGreaterThan(18);
    expect(alone.trimAngle * DEG).toBeLessThan(21);
    expect(alone.canJettisonHeatShield).toBe(true);
    await expect(page.getByTestId('attitude-trim')).toBeEnabled();
    await page.keyboard.press('KeyY');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.attitudeMode).toBe('trim');
    await expect(page.getByTestId('attitude-trim')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('navball-bank')).toContainText('升力向上');
    // 迎角收敛到 180° − 配平迎角
    await expect
      .poll(async () => Math.abs((await readState(page))!.sim.telemetry!.angleOfAttack * DEG - (180 - alone.trimAngle * DEG)), { timeout: 60_000 })
      .toBeLessThan(1);

    // E：向右倾侧；配平模式不被打断
    await page.keyboard.down('KeyE');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.bankAngle * DEG, { timeout: 20_000 }).toBeGreaterThan(20);
    await page.keyboard.up('KeyE');
    const banked = (await readState(page))!.sim.telemetry!;
    expect(banked.attitudeMode).toBe('trim');
    await expect(page.getByTestId('navball-bank')).toContainText('偏右');
    // Q：转回升力向上
    await page.keyboard.down('KeyQ');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.bankAngle * DEG, { timeout: 20_000 }).toBeLessThan(4);
    await page.keyboard.up('KeyQ');
    expect(Math.abs((await readState(page))!.sim.telemetry!.bankAngle) * DEG).toBeLessThan(15);

    // 再入：升阻比约 0.3
    await page.getByTestId('warp-1000').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.referenceHeatFlux, { timeout: 150_000 }).toBeGreaterThan(250_000);
    const heating = await expectAllFinite(page);
    expect(heating.sim.telemetry!.liftToDrag).toBeGreaterThan(0.27);
    expect(heating.sim.telemetry!.liftToDrag).toBeLessThan(0.34);
    await expect(page.getByTestId('flight-hint')).toContainText('配平再入');

    // 降到 4 km 以下再开伞（缩短伞降时间）
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 300_000 }).toBeLessThan(4_000);
    const low = (await readState(page))!.sim.telemetry!;
    expect(low.mach).toBeLessThan(0.9);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase, { timeout: 60_000 }).toBe('main');
    expect((await readState(page))!.sim.telemetry!.attitudeMode).toBe('manual');
    await expect(page.getByTestId('flight-hint')).toContainText('按 H 抛掉防热大底');

    // H：抛大底——质量减少 650 kg，底部热区换成舱底结构，多出一个分离体
    const before = (await readState(page))!;
    await page.keyboard.press('KeyH');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.heatShieldAttached).toBe(false);
    const after = await expectAllFinite(page);
    expect(after.sim.telemetry!.mass).toBeCloseTo(before.sim.telemetry!.mass - 650, 3);
    expect(after.sim.events).toContain('heat-shield');
    // 分离体数量取自渲染帧（软件渲染下帧率很低，要等下一帧）
    await expect.poll(async () => (await readState(page))!.debrisCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('heat-shield-button')).toContainText('已抛大底');
    await expect(page.getByTestId('heat-shield-button')).toBeDisabled();
    await expect(page.getByTestId('thermal-zone-base')).toContainText('舱底结构');

    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 200_000 }).toBe('landed');
    const state = await expectAllFinite(page);
    // 抛掉大底后落得更慢（带着大底约 7.8 m/s）
    expect(state.sim.outcome!.impactSpeed).toBeGreaterThan(6.5);
    expect(state.sim.outcome!.impactSpeed).toBeLessThan(7.7);
    // 升力式再入：整个飞行的最大过载就是开伞冲击（约 4.4 g），远低于弹道式的 8 g
    expect(state.sim.stats!.maxGLoad).toBeLessThan(5.5);
    const hudText = await page.getByTestId('flight-hud').innerText();
    expect(hudText).not.toMatch(/NaN|Infinity|undefined/);
    expect(problems).toEqual([]);
  });

  test('提前开伞：超声速时按 G，降落伞被撕毁', async ({ page }) => {
    test.setTimeout(240_000);
    await startApp(page);
    await deorbitCapsule(page);
    await page.getByTestId('warp-1000').click();
    // 降到 50 km 以下（高超声速，正在减速）就回到 1×，留出足够的时间在超声速时按下开伞
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 200_000 }).toBeLessThan(50_000);
    await page.getByTestId('warp-1').click();
    await expect.poll(async () => (await readState(page))!.sim.timeWarp).toBe(1);
    const t = (await readState(page))!.sim.telemetry!;
    expect(t.mach).toBeGreaterThan(1.5);
    await expect(page.getByTestId('parachute-button')).toHaveAttribute('title', /现在开伞会被撕毁/);
    await page.getByTestId('parachute-button').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase).toBe('lost');
    expect((await readState(page))!.sim.events).toContain('parachute-failed');
    await expect(page.getByTestId('parachute-button')).toContainText('伞已毁');
    await expect(page.getByTestId('parachute-button')).toBeDisabled();
    await expect(page.getByTestId('event-log')).toContainText('降落伞被撕毁');
    await expectAllFinite(page);
  });
});

/** 读取浏览器里保存的生涯存档。 */
const readCareer = (page: Page): Promise<{ progress: Record<string, { completed: boolean; bestScore: number; bestGrade: string | null; attempts: number }>; logbook: { missionId: string | null; result: string; score: number | null; grade: string | null }[] } | null> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('orbital-frontier/career');
    return raw ? (JSON.parse(raw) as { state: never }).state : null;
  });

test.describe('任务系统（阶段五）', () => {
  test('任务菜单：默认显示任务列表与简报；未解锁的任务不能开始；"解锁全部"后可以', async ({ page }) => {
    const problems = await openApp(page);
    // 默认页签是"任务"，选中第一个任务，右侧是它的简报
    await expect(page.getByTestId('tab-missions')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('mission-list')).toBeVisible();
    await expect(page.getByTestId('mission-progress')).toHaveText('已完成 0 / 7');
    await expect(page.getByTestId('mission-karman-line')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('mission-karman-line')).toHaveAttribute('aria-pressed', 'true');
    for (const id of ['suborbital-hop', 'first-orbit', 'crew-return', 'orbital-flight', 'inclined-orbit', 'polar-orbit']) {
      await expect(page.getByTestId(`mission-${id}`)).toHaveAttribute('data-state', 'locked');
    }
    await expect(page.getByTestId('briefing-title')).toHaveText('突破卡门线');
    await expect(page.getByTestId('briefing-objectives')).toContainText('最大高度达到 100 km');
    await expect(page.getByTestId('briefing-objectives')).toContainText('附加目标');
    await expect(page.getByTestId('briefing-scoring')).toContainText('回收返回舱');
    await expect(page.getByTestId('briefing-plan').locator('li')).toHaveCount(5);
    await expect(page.getByTestId('start-mission')).toBeEnabled();
    await expect(page.getByTestId('start-mission')).toHaveText('开始任务');

    // 选中未解锁的任务：可以读简报，但不能开始，并说明需要先完成什么
    await page.getByTestId('mission-polar-orbit').click();
    await expect(page.getByTestId('briefing-title')).toHaveText('极地轨道');
    await expect(page.getByTestId('start-mission')).toBeDisabled();
    await expect(page.getByTestId('start-mission')).toContainText('需要先完成：指定倾角轨道');
    // 发射方位说明：范登堡向南，理论方位角 183°，按 S，用 A 增大倾角
    await expect(page.getByTestId('launch-note')).toContainText('183°');
    await expect(page.getByTestId('launch-note')).toContainText('航向 180°');
    await page.getByTestId('mission-inclined-orbit').click();
    await expect(page.getByTestId('launch-note')).toContainText('043°');
    await expect(page.getByTestId('launch-note')).toContainText('W + D');
    await expect(page.getByTestId('launch-note')).toContainText('W + A');
    await page.getByTestId('mission-first-orbit').click();
    await expect(page.getByTestId('launch-note')).toHaveCount(0);

    // 飞行记录是空的
    await page.getByTestId('tab-logbook').click();
    await expect(page.getByTestId('logbook-empty')).toBeVisible();
    await expect(page.getByTestId('mission-briefing')).toHaveCount(0);

    // "解锁全部任务"
    await page.getByTestId('tab-missions').click();
    await page.getByTestId('unlock-all').check();
    await expect(page.getByTestId('mission-polar-orbit')).toHaveAttribute('data-state', 'open');
    await page.getByTestId('mission-crew-return').click();
    await expect(page.getByTestId('start-mission')).toBeEnabled();

    // 开始"载人飞船返回"：直接在 200 km 轨道上，任务条与任务提示就位
    await page.getByTestId('start-mission').click();
    await expect(page.getByTestId('flight-hud')).toBeVisible();
    await waitForRunning(page);
    await expect.poll(async () => (await readState(page))!.sim.missionId).toBe('crew-return');
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.orbit?.classification ?? null).toBe('orbit');
    const state = await expectAllFinite(page);
    expect(state.sim.mission?.status).toBe('active');
    expect(state.sim.mission?.objectives.map((o) => o.status)).toEqual(['pending']);
    expect(Math.abs(state.sim.telemetry!.altitude - 200_000)).toBeLessThan(2_000);
    await expect(page.getByTestId('mission-strip')).toContainText('任务 · 载人飞船返回');
    await expect(page.getByTestId('objective-land')).toHaveAttribute('data-status', 'pending');
    await expect(page.getByTestId('flight-hint')).toContainText('任务：返回地球。按 T 开启逆行保持');
    // 点击任务名展开 / 收起飞行步骤
    await expect(page.getByTestId('mission-plan')).toHaveCount(0);
    await page.getByTestId('mission-title').click();
    await expect(page.getByTestId('mission-plan').locator('li')).toHaveCount(5);
    await page.getByTestId('mission-title').click();
    await expect(page.getByTestId('mission-plan')).toHaveCount(0);
    // 按 T：提示随之推进
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('flight-hint')).toContainText('逆行保持中');

    // 回到主菜单：任务还没有结论，不计入任务进度；什么都没做的飞行不留记录
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('mission-progress')).toHaveText('已完成 0 / 7');
    const career = await readCareer(page);
    expect(career?.progress['crew-return']).toBeUndefined();
    expect(career?.logbook ?? []).toHaveLength(0);
    // 刷新后"解锁全部"与选中的任务仍在
    await page.reload({ waitUntil: 'load' });
    await waitForRunning(page);
    await expect(page.getByTestId('unlock-all')).toBeChecked();
    await expect(page.getByTestId('mission-crew-return')).toHaveAttribute('aria-pressed', 'true');
    expect(problems).toEqual([]);
  });

  test('完整的游戏循环：选任务 → 发射 → 完成目标 → 回收 → 评分 → 存档 → 解锁并开始下一个任务', async ({ page }) => {
    test.setTimeout(420_000);
    const problems = await openApp(page);
    await page.getByTestId('start-mission').click();
    await expect(page.getByTestId('flight-hud')).toBeVisible();
    await waitForRunning(page);
    await expect.poll(async () => (await readState(page))!.sim.missionId).toBe('karman-line');
    // 任务规定的火箭与发射场：流星-S，酒泉
    await expect(page.getByTestId('vehicle-panel')).toContainText('流星-S');
    const pad = await expectAllFinite(page);
    expect(pad.sim.telemetry!.phase).toBe('prelaunch');
    expect(pad.sim.telemetry!.latitude * DEG).toBeCloseTo(40.96, 1);
    await expect(page.getByTestId('mission-strip')).toContainText('任务 · 突破卡门线');
    await expect(page.getByTestId('objective-altitude')).toContainText('最大高度 0 / 100 km');
    await expect(page.getByTestId('objective-recover')).toContainText('附加');
    await expect(page.getByTestId('flight-hint')).toHaveText('按 空格 点火起飞');

    // 点火，竖直上升：提示保持竖直
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.phase).toBe('flight');
    await page.getByTestId('warp-5').click();
    await expect(page.getByTestId('flight-hint')).toContainText('保持竖直上升');
    // 燃尽：分离返回舱
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.stagePropellant[0], { timeout: 120_000 }).toBe(0);
    await expect(page.getByTestId('flight-hint')).toContainText('按 空格 分离');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.activeStageIndex).toBe(1);

    // 靠惯性越过 100 km：主要目标完成，任务仍在进行（附加目标还没有结论）
    await page.getByTestId('warp-10').click();
    await expect(page.getByTestId('objective-altitude')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
    const reached = (await readState(page))!;
    expect(reached.sim.stats!.maxAltitude).toBeGreaterThanOrEqual(100_000);
    expect(reached.sim.mission?.status).toBe('active');
    expect(reached.sim.missionScore).toBeNull();
    await expect(page.getByTestId('flight-summary')).toHaveCount(0);
    await expect(page.getByTestId('flight-hint')).toContainText('靠惯性上升中');

    // 越过最高点，落回大气层；降到 4 km 以下开伞
    await page.getByTestId('warp-1000').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.verticalSpeed, { timeout: 120_000 }).toBeLessThan(-100);
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 200_000 }).toBeLessThan(4_000);
    expect((await readState(page))!.sim.telemetry!.mach).toBeLessThan(0.9);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.parachute.phase, { timeout: 60_000 }).toBe('main');
    await expect(page.getByTestId('objective-recover')).toContainText('主伞已张开');

    // 着陆：任务完成，结果面板给出评级、总分与各评分项
    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 200_000 }).toBe('landed');
    const done = await expectAllFinite(page);
    expect(done.sim.mission?.status).toBe('success');
    expect(done.sim.mission?.objectives.map((o) => o.status)).toEqual(['done', 'done']);
    expect(done.sim.missionScore?.total).toBe(100);
    expect(done.sim.missionScore?.grade).toBe('S');
    expect(done.sim.stats!.maxAltitude).toBeGreaterThan(250_000);
    await expect(page.getByTestId('mission-result')).toHaveAttribute('data-status', 'success');
    await expect(page.getByTestId('mission-outcome')).toHaveText('突破卡门线');
    await expect(page.getByTestId('mission-grade')).toHaveText('S');
    await expect(page.getByTestId('mission-score')).toContainText('100');
    await expect(page.getByTestId('mission-score-items').locator('tr')).toHaveCount(3);
    await expect(page.getByTestId('mission-score-items')).toContainText('回收返回舱');
    await expect(page.getByTestId('flight-outcome')).toHaveText('已着陆');
    await expect(page.getByTestId('flight-stats')).toContainText('最大高度');
    // 飞行记录曲线画出来了
    await expect(page.getByTestId('chart-trajectory')).toBeVisible();
    await expect(page.getByTestId('chart-loads')).toBeVisible();
    await expect(page.getByTestId('chart-trajectory')).toContainText('高度');
    const chart = await page.getByTestId('chart-trajectory').locator('canvas').screenshot();
    expect(chart.byteLength).toBeGreaterThan(1_500);
    await expect(page.getByTestId('summary-continue')).toHaveCount(0);

    // 存档：任务完成、最好成绩、一条飞行记录
    const career = (await readCareer(page))!;
    expect(career.progress['karman-line']).toEqual({ completed: true, bestScore: 100, bestGrade: 'S', attempts: 1 });
    expect(career.logbook).toHaveLength(1);
    expect(career.logbook[0]).toMatchObject({ missionId: 'karman-line', result: 'landed', score: 100, grade: 'S' });

    // "下一个任务"：解锁了"亚轨道飞行与回收"，直接开始（同一枚火箭，回到发射台）
    await expect(page.getByTestId('summary-next')).toContainText('亚轨道飞行与回收');
    await page.getByTestId('summary-next').click();
    await expect.poll(async () => (await readState(page))!.sim.missionId).toBe('suborbital-hop');
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.phase ?? null).toBe('prelaunch');
    await expect(page.getByTestId('flight-summary')).toHaveCount(0);
    await expect(page.getByTestId('mission-strip')).toContainText('任务 · 亚轨道飞行与回收');
    await expect(page.getByTestId('objective-land')).toHaveAttribute('data-status', 'pending');
    expect((await readState(page))!.sim.mission?.objectives.map((o) => o.status)).toEqual(['pending', 'pending']);

    // 回到主菜单：任务列表反映进度；飞行记录里有这次飞行
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('mission-progress')).toHaveText('已完成 1 / 7');
    await expect(page.getByTestId('mission-karman-line')).toHaveAttribute('data-state', 'completed');
    await expect(page.getByTestId('mission-karman-line')).toContainText('S');
    await expect(page.getByTestId('mission-suborbital-hop')).toHaveAttribute('data-state', 'open');
    await expect(page.getByTestId('mission-first-orbit')).toHaveAttribute('data-state', 'locked');
    await page.getByTestId('mission-karman-line').click();
    await expect(page.getByTestId('briefing-record')).toContainText('最好成绩');
    await expect(page.getByTestId('briefing-record')).toContainText('已飞 1 次');
    await page.getByTestId('tab-logbook').click();
    await expect(page.getByTestId('logbook-entry')).toHaveCount(1);
    await expect(page.getByTestId('logbook-entry')).toContainText('突破卡门线');
    await expect(page.getByTestId('logbook-entry')).toContainText('安全着陆');
    await expect(page.getByTestId('logbook-entry')).toContainText('流星-S');

    // 刷新页面：进度与记录仍在
    await page.reload({ waitUntil: 'load' });
    await waitForRunning(page);
    await expect(page.getByTestId('logbook-entry')).toHaveCount(1);
    await page.getByTestId('tab-missions').click();
    await expect(page.getByTestId('mission-progress')).toHaveText('已完成 1 / 7');
    await expect(page.getByTestId('mission-suborbital-hop')).toHaveAttribute('data-state', 'open');
    expect(problems).toEqual([]);
  });

  test('任务失败：没到 100 km 就关机——结果面板说明原因，评级 F，不解锁下一个任务；可以再飞一次', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await openApp(page);
    await page.getByTestId('start-mission').click();
    await waitForRunning(page);
    await expect.poll(async () => (await readState(page))!.sim.missionId).toBe('karman-line');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.phase).toBe('flight');
    await page.getByTestId('warp-5').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 60_000 }).toBeGreaterThan(1_500);
    // 关机：火箭落回地面
    await page.keyboard.press('KeyX');
    await page.getByTestId('warp-10').click();
    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 150_000 }).toBe('destroyed');

    const state = await expectAllFinite(page);
    expect(state.sim.stats!.maxAltitude).toBeLessThan(100_000);
    expect(state.sim.mission?.status).toBe('failed');
    expect(state.sim.mission?.failure).toBe('destroyed');
    expect(state.sim.missionScore).toMatchObject({ total: 0, grade: 'F' });
    await expect(page.getByTestId('mission-result')).toHaveAttribute('data-status', 'failed');
    await expect(page.getByTestId('mission-failure')).toHaveText('飞行器损毁');
    await expect(page.getByTestId('mission-grade')).toHaveText('F');
    await expect(page.getByTestId('mission-strip')).toHaveAttribute('data-status', 'failed');
    await expect(page.getByTestId('objective-altitude')).toHaveAttribute('data-status', 'failed');
    await expect(page.getByTestId('flight-outcome')).toHaveText('飞行器损毁');
    await expect(page.getByTestId('flight-reasons')).toBeVisible();
    // 失败不解锁下一个任务
    await expect(page.getByTestId('summary-next')).toHaveCount(0);
    const career = (await readCareer(page))!;
    expect(career.progress['karman-line']).toEqual({ completed: false, bestScore: 0, bestGrade: null, attempts: 1 });
    expect(career.logbook[0]).toMatchObject({ missionId: 'karman-line', result: 'destroyed', score: 0, grade: 'F' });

    // 再飞一次：同一个任务，从发射台重新开始
    await page.getByTestId('summary-restart').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry?.phase ?? null).toBe('prelaunch');
    await expect(page.getByTestId('flight-summary')).toHaveCount(0);
    const again = (await readState(page))!;
    expect(again.sim.missionId).toBe('karman-line');
    expect(again.sim.mission?.status).toBe('active');
    expect(again.sim.mission?.objectives.map((o) => o.status)).toEqual(['pending', 'pending']);
    await expect(page.getByTestId('objective-altitude')).toHaveAttribute('data-status', 'pending');
    expect(problems).toEqual([]);
  });

  test('自由飞行不带任务：没有任务条，结果面板没有评分；飞行结束后留下一条记录', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await startApp(page);
    await page.getByTestId('vehicle-meteor-s').click();
    await waitForRunning(page);
    await enterFlight(page);
    expect((await readState(page))!.sim.missionId).toBeNull();
    expect((await readState(page))!.sim.mission).toBeNull();
    await expect(page.getByTestId('mission-strip')).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.phase).toBe('flight');
    await page.getByTestId('warp-5').click();
    await expect.poll(async () => (await readState(page))!.sim.telemetry!.altitude, { timeout: 60_000 }).toBeGreaterThan(1_000);
    await page.keyboard.press('KeyX');
    await page.getByTestId('warp-10').click();
    await expect.poll(async () => (await readState(page))!.sim.outcome?.kind ?? null, { timeout: 150_000 }).toBe('destroyed');
    await expect(page.getByTestId('flight-summary')).toBeVisible();
    await expect(page.getByTestId('mission-result')).toHaveCount(0);
    await expect(page.getByTestId('flight-outcome')).toHaveText('飞行器损毁');
    await expect(page.getByTestId('summary-restart')).toHaveText('重新发射');
    await expect(page.getByTestId('flight-charts')).toBeVisible();
    const career = (await readCareer(page))!;
    expect(career.logbook).toHaveLength(1);
    expect(career.logbook[0]).toMatchObject({ missionId: null, result: 'destroyed', score: null, grade: null });
    expect(career.progress).toEqual({});
    await page.getByTestId('summary-menu').click();
    await page.getByTestId('tab-logbook').click();
    await expect(page.getByTestId('logbook-entry')).toContainText('自由飞行');
    expect(problems).toEqual([]);
  });
});
