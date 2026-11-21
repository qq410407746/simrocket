import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
interface DebugApi {
  perf(): { fps: number };
  snapshot(): { vehicle: { mass: number } } | null;
  sim(): { telemetry: { altitude: number } | null };
}

test.use({ deviceScaleFactor: 2 });
test('设计图纸跨刷新试飞、真实耗料、曲线持久化与回看', async ({ page }, info) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/');
  await page.getByTestId('tab-design').click();
  await page.getByLabel('设计模板').selectOption('mercury-redstone');
  await page.getByLabel('火箭名称').fill('晨光试验一号');
  await expect(page.getByTestId('design-performance')).toContainText('29.94 t');
  await page.getByTestId('save-design').click();
  await expect(page.getByRole('status')).toContainText('图纸已保存');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出图纸备份', exact: true }).click();
  const download = await downloadPromise;
  const backup = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(backup).designs[0].name).toBe('晨光试验一号');
  await page.getByLabel('导入图纸备份').setInputFiles({ name: '图纸.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await expect(page.getByRole('status')).toContainText('备份已导入');
  await expect(page.getByTestId('saved-design')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('saved-design')).toContainText('晨光试验一号');
  await page.getByTestId('saved-design').getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByTestId('main-menu').locator(':scope > div').first().evaluate((element) => { element.scrollTop = 0; });
  await expect(page.getByTestId('loading-overlay')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __orbitalFrontier: DebugApi }).__orbitalFrontier.perf().fps)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('阶段七火箭设计.png') });
  await page.getByTestId('saved-design').getByRole('button', { name: '用于自由飞行' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: /晨光试验一号/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('enter-flight').click();
  await expect(page.getByTestId('vehicle-panel')).toContainText('晨光试验一号');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __orbitalFrontier: DebugApi }).__orbitalFrontier.snapshot()?.vehicle.mass).then((mass) => Math.round(mass ?? 0))).toBe(29_937);
  await page.getByTestId('stage-button').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __orbitalFrontier: DebugApi }).__orbitalFrontier.sim().telemetry?.altitude ?? 0)).toBeGreaterThan(100);
  expect(await page.evaluate(() => (window as unknown as { __orbitalFrontier: DebugApi }).__orbitalFrontier.snapshot()!.vehicle.mass)).toBeLessThan(29_937);
  await page.getByTestId('throttle-cut').click();
  await page.getByTestId('warp-5').click();
  await expect(page.getByTestId('flight-summary')).toBeVisible();
  await page.getByTestId('summary-menu').click();
  await page.getByTestId('tab-logbook').click();
  await expect(page.getByTestId('archive-notice')).toContainText('曲线已保存');
  await page.reload();
  await expect(page.getByTestId('logbook-entry')).toHaveCount(1);
  await expect(page.getByTestId('logbook-entry').first()).toContainText('晨光试验一号');
  await page.getByRole('button', { name: '查看遥测曲线' }).first().click();
  await expect(page.getByTestId('archive-playback')).toBeVisible();
  const slider = page.getByTestId('archive-time');
  const initial = await page.getByTestId('archive-reading').textContent();
  const max = await slider.getAttribute('max');
  expect(Number(max)).toBeGreaterThan(Number(await slider.getAttribute('min')));
  await expect(slider).toBeEnabled();
  // 用键盘把滑块拖到末端（End 键）：比 fill() 写入浮点数更接近真实操作，也不受 step="any" 的取整影响
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveValue(max!);
  await expect(page.getByTestId('archive-reading')).not.toHaveText(initial!);
  await page.getByRole('button', { name: '从头回看', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停回看', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停回看', exact: true }).click();
  await page.getByTestId('archive-playback').scrollIntoViewIfNeeded();
  const playbackBox = await page.getByTestId('archive-playback').boundingBox();
  const settingsBox = await page.getByTestId('menu-settings').boundingBox();
  expect(settingsBox!.y).toBeGreaterThanOrEqual(playbackBox!.y + playbackBox!.height);
  await page.screenshot({ path: info.outputPath('阶段七遥测回看.png') });
  // 用存储接口破坏档案来验证校验路径，不改物理状态。
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('orbital-frontier/flights', 1);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('telemetry', 'readwrite'), store = tx.objectStore('telemetry');
        const cursor = store.openCursor();
        cursor.onsuccess = () => { const item = cursor.result; if (item) item.update({ ...item.value, version: 999 }); };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByRole('button', { name: '关闭遥测回看' }).click();
  await page.getByRole('button', { name: '查看遥测曲线' }).click();
  await expect(page.getByTestId('archive-viewer')).toContainText('已损坏');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('reset-career').click();
  await expect(page.getByTestId('logbook-empty')).toBeVisible();
  await expect(page.getByTestId('archive-notice')).toContainText('已清空');
  expect(problems).toEqual([]);
});

test('设计器拒绝不兼容模块、坏备份和存储失败', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-design').click();
  // 联盟号的助推器挪到芯级上面：并联助推器只能绑在原配芯级下面
  await page.getByRole('button', { name: '第2级移向底部', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('并联助推器');
  await expect(page.getByTestId('save-design')).toBeDisabled();
  await page.getByLabel('设计模板').selectOption('atlas-v-401');
  // 水星飞船（1.78 m 接口）放在半人马座（3.05 m）上：没有转接结构
  await page.getByLabel('有效载荷').selectOption('mercury');
  await expect(page.getByRole('alert')).toContainText('接口直径不同');
  await expect(page.getByTestId('save-design')).toBeDisabled();
  await page.getByLabel('有效载荷').selectOption('relay-7');
  await page.getByRole('button', { name: '添加推进级', exact: true }).click();
  await page.getByRole('button', { name: '添加推进级', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加推进级', exact: true })).toBeDisabled();
  // 去掉芯级：只剩三个半人马座，海平面推力远小于重量
  await page.getByRole('button', { name: '删除第1级', exact: true }).click();
  await expect(page.getByTestId('design-workshop')).toContainText('无法从发射台起飞');
  await page.getByLabel('导入图纸备份').setInputFiles({ name: '坏备份.json', mimeType: 'application/json', buffer: Buffer.from('{"version":2,"designs":[]}') });
  await expect(page.getByRole('status')).toContainText('备份无效');
  await expect(page.getByTestId('saved-design')).toHaveCount(0);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'orbital-frontier/designs') throw new DOMException('空间不足', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.getByTestId('save-design').click();
  await expect(page.getByRole('status')).toContainText('保存失败');
  await expect(page.getByTestId('saved-design')).toHaveCount(0);
});
