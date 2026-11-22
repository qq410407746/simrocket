import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
interface GeoDebugApi {
  sim(): {
    timeWarp: number; maxTimeWarp: number;
    mission: { status: string; objectives: { id: string; status: string }[] } | null;
    missionScore: { total: number; grade: string } | null;
    telemetry: {
      simTime: number; phase: string; ignited: boolean; pitch: number; altitude: number;
      surfaceSpeed: number; verticalSpeed: number; activeStageIndex: number; gLoad: number;
      stagePropellant: number[]; fairingAttached: boolean; attitudeMode: string; throttle: number;
      satelliteDeployedAt: number | null;
      synchronous: { geo: boolean; gso: boolean; periodError: number | null; longitudeSpan: number | null };
      orbit: { periapsisAltitude: number; apoapsisAltitude: number; inclination: number; period: number; timeToApoapsis: number; timeToPeriapsis: number } | null;
    } | null;
  };
  snapshot(): {
    maneuver?: { node: { time: number }; remaining: { x: number; y: number; z: number } } | null;
    vehicle: { body: { attitude: { x: number; y: number; z: number; w: number }; velocity: { x: number; y: number; z: number } } };
  } | null;
}
type GeoWindow = Window & { __orbitalFrontier: GeoDebugApi };

test.use({ deviceScaleFactor: 2 });

test('暂停时规划三分量节点、预览与地面轨迹不改变物理状态', async ({ page }, info) => {
  await page.goto('/');
  await page.getByTestId('quality-low').click();
  await page.getByTestId('tab-sandbox').click();
  await page.getByTestId('vehicle-atlas-v-401').click();
  await page.getByTestId('start-orbit').click();
  await page.getByTestId('enter-flight').click();
  await page.getByTestId('pause-button').click();
  await expect(page.getByTestId('pause-button')).toHaveAttribute('aria-label', '继续');
  await page.getByTestId('camera-map').click();
  await page.getByTestId('maneuver-panel').locator(':scope > summary').click();
  const before = await page.evaluate(() => JSON.stringify((window as unknown as {
    __orbitalFrontier: { snapshot(): { vehicle: unknown } };
  }).__orbitalFrontier.snapshot().vehicle));
  await page.getByTestId('plan-gto').click();
  await expect(page.getByTestId('maneuver-status')).toContainText('预计满推力燃烧');
  await page.getByTestId('maneuver-editor').locator('summary').click();
  await page.getByLabel('顺行增量', { exact: true }).fill('100');
  await page.getByLabel('径向增量', { exact: true }).fill('-20');
  await page.getByLabel('法向增量', { exact: true }).fill('30');
  await page.getByRole('button', { name: '更新所选节点' }).click();
  await expect(page.getByTestId('maneuver-status')).toContainText('法向 30.0');
  await expect(page.getByTestId('ground-track').locator('polyline').first()).toBeAttached();
  const after = await page.evaluate(() => JSON.stringify((window as unknown as {
    __orbitalFrontier: { snapshot(): { vehicle: unknown } };
  }).__orbitalFrontier.snapshot().vehicle));
  expect(after).toBe(before);
  await page.getByLabel('顺行增量', { exact: true }).fill('30001');
  await page.getByRole('button', { name: '更新所选节点' }).click();
  await expect(page.getByTestId('maneuver-panel').getByRole('status')).toContainText('节点无效');
  await expect(page.getByTestId('maneuver-status')).toContainText('顺行 100.0');
  await page.getByTestId('maneuver-editor').locator('summary').click();
  await page.getByTestId('plan-gto').click();
  await page.getByTestId('map-overlay').evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: info.outputPath('阶段六机动规划.png') });
  await page.getByTestId('ground-track').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('阶段六地面轨迹.png') });
});

/** 只读仪表，通过现有按钮和键盘飞行；不写快照、不调用物理内部方法。 */
test('从发射台规划并执行 GTO、远地点圆化、部署卫星并确认 GEO', async ({ page }, info) => {
  test.setTimeout(1_800_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.text().startsWith('飞行验收：')) console.log(message.text());
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  await page.getByTestId('quality-low').click();
  await page.getByTestId('unlock-all').check();
  await page.getByTestId('mission-geo-deployment').click();
  await page.getByTestId('start-mission').click();
  await expect(page.getByTestId('flight-hud')).toBeVisible();
  await page.evaluate(() => {
    const api = (window as unknown as GeoWindow).__orbitalFrontier;
    const button = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    const click = (id: string) => button(id)?.click();
    const held = new Set<string>();
    const steer = (direction: number) => {
      for (const code of ['KeyD', 'KeyA']) {
        const down = direction === (code === 'KeyD' ? 1 : -1);
        if (down === held.has(code)) continue;
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
        if (down) held.add(code); else held.delete(code);
      }
    };
    const warp = (value: number) => { if (api.sim().timeWarp !== value) click(`warp-${value}`); };
    // 宇宙神 V 的 RD-180 可以节流：芯级末段过载超过 5 g 就按住 ↓，降回 4.8 g 以下松开
    const throttleDown = (down: boolean) => {
      if (down === held.has('ArrowDown')) return;
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'ArrowDown', key: 'ArrowDown' }));
      if (down) held.add('ArrowDown'); else held.delete('ArrowDown');
    };
    let phase = 'vertical', settledAt = 0, pitchTarget = 90, nextDecision = 0;
    let lastTime = -1, lastAction = -1, resumeAt = 0, duration = 0, started = false, maneuvers = 0, fine = false, preferCircular = false, lastPulse = -1;
    let lastReport = '', lastWall = 0;
    const timer = setInterval(() => {
      const state = api.sim(), t = state.telemetry, snapshot = api.snapshot();
      if (!t || !snapshot || t.simTime === lastTime) return;
      lastTime = t.simTime;
      const pending = state.mission?.objectives.find((o) => o.status === 'pending')?.id;
      const report = `${phase}/${pending}`;
      if (report !== lastReport || Date.now() - lastWall > 20_000) {
        console.log('飞行验收：' + JSON.stringify({ phase, pending, time: t.simTime, started, fine, maneuvers, mode: t.attitudeMode, throttle: t.throttle, altitude: t.altitude, pitch: t.pitch * 180 / Math.PI, orbit: t.orbit, fuel: t.stagePropellant, node: snapshot.maneuver?.node, remaining: snapshot.maneuver?.remaining, sync: t.synchronous }));
        lastReport = report; lastWall = Date.now();
      }
      if (state.mission?.status !== 'active' || (t.phase !== 'flight' && t.phase !== 'prelaunch')) {
        steer(0); clearInterval(timer); return;
      }
      if (t.phase === 'prelaunch') { if (!t.ignited) click('stage-button'); return; }
      const pitch = t.pitch * 180 / Math.PI;
      if (phase !== 'orbit') {
        if (t.orbit && t.orbit.periapsisAltitude >= 150_000) {
          click('throttle-cut'); steer(0); warp(1); phase = 'orbit';
          click('camera-map'); resumeAt = t.simTime + 15; return;
        }
        if (t.activeStageIndex === 0) throttleDown(t.gLoad > 5 || (held.has('ArrowDown') && t.gLoad > 4.8));
        if (t.activeStageIndex < 1 && t.stagePropellant[t.activeStageIndex] === 0 && t.simTime - lastAction > 2) {
          throttleDown(false);
          click('stage-button'); click('throttle-full'); click('attitude-manual'); steer(0); phase = 'manual';
          pitchTarget = Math.round(pitch / 5) * 5; nextDecision = t.simTime + 3; lastAction = t.simTime; warp(1); return;
        }
        if (t.fairingAttached && t.altitude > 100_000) click('fairing-button');
        // 推重比只有约 1.2：100 m/s 才倾斜，只倾斜约 1.5°
        if (phase === 'vertical' && t.surfaceSpeed >= 100) { steer(1); phase = 'kick'; }
        else if (phase === 'kick' && pitch <= 88.5) { steer(0); phase = 'settle'; settledAt = t.simTime; }
        else if (phase === 'settle' && t.simTime >= settledAt + 5) { click('attitude-prograde'); phase = 'prograde'; warp(5); }
        else if (phase === 'manual') {
          // 半人马座要烧十几分钟：发动机工作时最高 5×
          warp(5);
          if (t.simTime >= nextDecision) {
            nextDecision = t.simTime + 3;
            const error = Math.max(-100, Math.min(600, (200_000 - t.altitude) / 60)) - t.verticalSpeed;
            if (error > 25) pitchTarget += 5; else if (error < -25) pitchTarget -= 5;
            pitchTarget = Math.max(-10, Math.min(50, pitchTarget));
          }
          steer(pitch > pitchTarget + 1 ? 1 : pitch < pitchTarget - 1 ? -1 : 0);
        }
        return;
      }
      const details = document.querySelector<HTMLDetailsElement>('[data-testid="maneuver-panel"]');
      if (details && !details.open) details.querySelector('summary')?.click();
      if (t.simTime < resumeAt || pending === 'parking') { warp(5); return; }
      // 部署前先把周期误差修到 60 s 以内：卫星分离冲量会让周期再变化一些，而卫星没有发动机
      const needsTrim = Math.abs(t.synchronous?.periodError ?? 0) > 60;
      if (pending === 'deploy' && !needsTrim && !snapshot.maneuver) { warp(1); click('deploy-satellite'); return; }
      if (pending === 'confirm' || (!snapshot.maneuver && t.synchronous?.geo && !needsTrim)) { warp(5); return; }
      // 周期精修：轨道已在赤道面内、偏心率在 GEO 容许范围附近时，不再用机动草案（草案不以周期为目标），
      // 而在拱点点短脉冲（0.02 s 约 0.5 m/s，在同步轨道上约改变周期 42 s）：
      // 周期太长 → 在近地点逆行，降低远地点；周期太短 → 在远地点顺行，抬高近地点。两者都同时减小偏心率。
      const SIDEREAL_DAY = 86_164.0905;
      const orbitNow = t.orbit;
      if ((pending === 'geo' || pending === 'deploy') && orbitNow && orbitNow.inclination <= 0.001
        && orbitNow.apoapsisAltitude - orbitNow.periapsisAltitude < 168_000 && Math.abs(orbitNow.period - SIDEREAL_DAY) > (pending === 'deploy' ? 60 : 100)) {
        if (snapshot.maneuver) { click('clear-maneuver'); return; }
        const tooLong = orbitNow.period > SIDEREAL_DAY;
        const want = tooLong ? 'retrograde' : 'prograde';
        if (t.attitudeMode !== want) { warp(1); click(`attitude-${want}`); return; }
        const toApsis = tooLong ? orbitNow.timeToPeriapsis : orbitNow.timeToApoapsis;
        if (toApsis > 300) { warp(toApsis > 3_000 ? state.maxTimeWarp : 5); return; }
        warp(1);
        const q = snapshot.vehicle.body.attitude, v = snapshot.vehicle.body.velocity;
        const nose = { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) };
        const along = (nose.x * v.x + nose.y * v.y + nose.z * v.z) / Math.hypot(v.x, v.y, v.z);
        if ((tooLong ? -along : along) > 0.995 && t.throttle === 0 && t.simTime - lastPulse > 3) {
          click('pulse-20'); lastPulse = t.simTime;
        }
        return;
      }
      if (!snapshot.maneuver) {
        if (t.simTime - lastAction < 3) return;
        warp(1);
        // 精修：轨道已接近圆形时只用"同步高度修正"——依次在两个拱点把对面拉到同步高度，
        // 不与"远地点圆化"交替（两者交替时在同步高度上方会互相抵消，周期误差不变）
        const kind = pending === 'gto' ? 'gto' : (t.orbit?.inclination ?? 1) > 0.001 ? 'equatorial'
          : t.orbit && t.orbit.apoapsisAltitude - t.orbit.periapsisAltitude > 100_000 ? 'circular'
          : preferCircular ? 'circular' : 'synchronous';
        click(`plan-${kind}`);
        lastAction = t.simTime; started = false; fine = false; duration = 0; maneuvers++;
        if (maneuvers > 16) { clearInterval(timer); throw new Error('机动未收敛'); }
        return;
      }
      if (t.attitudeMode !== 'maneuver' && !started) click('point-maneuver');
      const plan = snapshot.maneuver, remaining = Math.hypot(plan.remaining.x, plan.remaining.y, plan.remaining.z);
      // 修正量可以忽略（例如一个拱点已经正好在同步高度）：清掉，下次换另一种修正
      if (!started && remaining < 0.2) { warp(1); click('clear-maneuver'); preferCircular = !preferCircular; resumeAt = t.simTime + 20; return; }
      if (!duration) duration = Number(document.querySelector('[data-testid="maneuver-status"]')?.getAttribute('data-burn-duration') ?? 0);
      if (!duration) return;
      // 机头（机体 +X 轴）与剩余增量方向的夹角：没对准之前不点火，否则调头途中的脉冲会与之后的互相抵消
      const q = snapshot.vehicle.body.attitude;
      const nose = { x: 1 - 2 * (q.y * q.y + q.z * q.z), y: 2 * (q.x * q.y + q.w * q.z), z: 2 * (q.x * q.z - q.w * q.y) };
      const aligned = remaining > 0 && (nose.x * plan.remaining.x + nose.y * plan.remaining.y + nose.z * plan.remaining.z) / remaining > 0.995;
      if (!started) {
        if (t.simTime >= plan.node.time - duration / 2 && !aligned) { warp(1); return; }
        if (t.simTime >= plan.node.time - duration / 2) {
          warp(1); started = true;
          if (remaining < 25) { fine = true; click(remaining > 3 ? 'pulse-100' : 'pulse-20'); }
          else click('throttle-full');
        }
        else {
          const until = plan.node.time - duration / 2 - t.simTime;
          warp(until < 65 ? 5 : state.maxTimeWarp);
        }
        return;
      }
      if (pending === 'gto' && remaining < 10) click('attitude-prograde');
      const targetAltitude = Math.cbrt(3.986004418e14 / (7.292115e-5 ** 2)) - 6_371_000;
      const done = pending === 'gto' ? (t.orbit?.apoapsisAltitude ?? 0) >= targetAltitude : remaining < 0.3;
      if (done || (!fine && remaining > 25 && t.simTime > plan.node.time + duration)) {
        click('throttle-cut'); click('clear-maneuver'); resumeAt = t.simTime + 20; warp(1); return;
      }
      if (pending !== 'gto' && remaining < 25) {
        warp(1);
        if (!fine) { click('throttle-cut'); fine = true; }
        else if (t.throttle === 0 && aligned) click(remaining > 3 ? 'pulse-100' : 'pulse-20');
      }
      else warp(pending === 'gto' && remaining < 50 ? 1 : 2);
    }, 100);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as GeoWindow).__orbitalFrontier?.sim().mission?.status), {
    timeout: 1_700_000, intervals: [5000],
  }).not.toBe('active');
  const result = await page.evaluate(() => {
    const state = (window as unknown as GeoWindow).__orbitalFrontier!.sim();
    return { mission: state.mission, score: state.missionScore, telemetry: state.telemetry };
  });
  const resultPath = info.outputPath('完整任务验收.json');
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  await info.attach('完整任务验收', { path: resultPath, contentType: 'application/json' });
  expect(result.mission?.status).toBe('success');
  expect(result.mission?.objectives.every((o) => o.status === 'done')).toBe(true);
  expect(result.telemetry?.synchronous?.geo).toBe(true);
  expect(result.telemetry?.satelliteDeployedAt).not.toBeNull();
  expect(result.score?.total).toBeGreaterThanOrEqual(80);
  await expect(page.getByTestId('mission-result')).toHaveAttribute('data-status', 'success');
  expect(problems).toEqual([]);
  await page.screenshot({ path: info.outputPath('阶段六任务完成.png') });
});
