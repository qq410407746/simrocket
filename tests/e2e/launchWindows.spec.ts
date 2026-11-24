import { expect, test } from '@playwright/test';

const kms = (text: string | null) => Number((text ?? '').replace(/[^0-9.]/g, ''));

test('发射窗口计算器：火星窗口、猪排图点选、木星时间上限、飞掠、英文', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/');
  await page.getByTestId('tab-windows').click();
  await expect(page.getByTestId('tab-windows')).toHaveText('发射窗口');
  await page.getByTestId('lw-start-year').fill('2026');
  await expect(page.getByTestId('lw-status')).not.toHaveText('计算中…', { timeout: 60_000 });

  // 火星 2026 年窗口：10–11 月发射，总 Δv 4–5 km/s，飞行约 300 天
  await expect(page.getByTestId('lw-target-mars')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lw-window-0')).toBeVisible();
  await expect(page.getByTestId('lw-best-departure')).toHaveText(/^2026-1[01]-\d\d$/);
  const total = kms(await page.getByTestId('lw-best-dv-total').textContent());
  expect(total).toBeGreaterThan(4);
  expect(total).toBeLessThan(5);
  await expect(page.getByTestId('lw-window-range')).toContainText('2026-');
  await expect(page.getByTestId('lw-ephemeris')).toContainText('Table 1');

  // 点选猪排图上的一点：显示那条轨道，悬停有提示
  const area = page.getByTestId('lw-porkchop-area');
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3);
  await expect(page.getByTestId('lw-porkchop-tooltip')).toContainText('Δv');
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.3);
  await expect(page.getByTestId('lw-picked')).toBeVisible();
  expect(kms(await page.getByTestId('lw-picked-dv-total').textContent())).toBeGreaterThanOrEqual(total - 0.01);

  // 第二个窗口约两年后
  await page.getByTestId('lw-window-1').click();
  await expect(page.getByTestId('lw-best-departure')).toHaveText(/^2028-/);
  await expect(page.getByTestId('lw-picked')).toHaveCount(0);

  // 木星：默认时间上限下最优解贴着上限；放宽到 5 年后飞行时间不超过 5 年
  await page.getByTestId('lw-target-jupiter').click();
  await expect(page.getByTestId('lw-status')).not.toHaveText('计算中…', { timeout: 60_000 });
  await expect(page.getByTestId('lw-limit-note')).toBeVisible();
  await page.getByTestId('lw-max-flight').fill('5');
  await page.getByTestId('lw-max-flight').press('Enter');
  await expect(page.getByTestId('lw-max-flight-reset')).toBeVisible();
  await expect(page.getByTestId('lw-status')).not.toHaveText('计算中…', { timeout: 60_000 });
  expect(Number((await page.getByTestId('lw-best-tof').textContent())?.replace(/[^0-9.]/g, ''))).toBeLessThanOrEqual(5);

  // 飞掠：入轨 Δv 为 0，总 Δv = 出发 Δv
  await page.getByTestId('lw-arrival-flyby').click();
  await expect(page.getByTestId('lw-status')).not.toHaveText('计算中…', { timeout: 60_000 });
  await expect(page.getByTestId('lw-best-dv-capture')).toHaveText('0.00 km/s');
  expect(kms(await page.getByTestId('lw-best-dv-total').textContent())).toBeCloseTo(kms(await page.getByTestId('lw-best-dv-departure').textContent()), 2);

  // 超出 2050 年的搜索改用 Table 2
  await page.getByTestId('lw-start-year').fill('2049');
  await expect(page.getByTestId('lw-status')).not.toHaveText('计算中…', { timeout: 60_000 });
  await expect(page.getByTestId('lw-ephemeris')).toContainText('Table 2');

  // 英文界面里没有中文
  await page.getByTestId('language-en').click();
  await expect(page.getByTestId('tab-windows')).toHaveText('Launch windows');
  const content = (await page.locator('body').textContent()) ?? '';
  expect(content.replaceAll('简体中文', '')).not.toMatch(/\p{Script=Han}/u);
  expect(problems).toEqual([]);
});
