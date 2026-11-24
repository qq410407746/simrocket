import { type Page, expect, test } from '@playwright/test';

const ARTICLES = ['physics-basics', 'rocket-equation', 'orbital-elements', 'cosmic-velocities', 'earth', 'moon', 'mars'] as const;

const expectNoChinese = async (page: Page) => {
  const content = (await page.locator('body').textContent()) ?? '';
  expect(content.replaceAll('简体中文', '')).not.toMatch(/\p{Script=Han}/u);
};

test('知识库：七个条目、计算器、相关条目跳转与中英文', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/');
  await page.getByTestId('tab-wiki').click();
  await expect(page.getByTestId('tab-wiki')).toHaveText('知识库');
  for (const id of ARTICLES) await expect(page.getByTestId(`wiki-${id}`)).toBeVisible();

  // 默认条目：火箭方程，计算器按 Δv = Isp·g₀·ln(m₀/m_f)
  await expect(page.getByTestId('wiki-title')).toHaveText('火箭方程基础');
  await page.getByTestId('rocket-eq-isp').fill('300');
  await page.getByTestId('rocket-eq-m0').fill('100');
  await page.getByTestId('rocket-eq-mf').fill('50');
  await expect(page.getByTestId('rocket-eq-result')).toHaveText(`${Math.round(300 * 9.80665 * Math.log(2)).toLocaleString('en-US')} m/s`);
  await page.getByTestId('rocket-eq-mf').fill('150');
  await expect(page.getByTestId('rocket-eq-result')).toHaveText('—');
  // 游戏里三种火箭的理想 Δv
  const table = page.getByTestId('wiki-vehicle-table');
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(table).toContainText('联盟-2.1a');

  // 宇宙速度
  await page.getByTestId('wiki-cosmic-velocities').click();
  await expect(page.getByTestId('wiki-title')).toHaveText('第一、第二、第三宇宙速度');
  await expect(page.getByTestId('wiki-article')).toContainText('7,910 m/s');
  await expect(page.getByTestId('wiki-article')).toContainText('11,186 m/s');
  await expect(page.getByTestId('wiki-article')).toContainText('16.65 km/s');

  // 相关条目跳到轨道要素，圆轨道计算器：月球 100 km 周期约 117.8 分钟
  await page.getByTestId('wiki-related-orbital-elements').click();
  await expect(page.getByTestId('wiki-title')).toHaveText('轨道力学要素');
  await expect(page.getByTestId('orbit-speed')).toHaveText('7,788 m/s');
  await page.getByTestId('orbit-body-moon').click();
  await page.getByTestId('orbit-altitude').fill('100');
  await expect(page.getByTestId('orbit-period')).toHaveText('117.8 min');

  // 每个条目都能打开，切换到英文后没有中文
  await page.getByTestId('language-en').click();
  for (const id of ARTICLES) {
    await page.getByTestId(`wiki-${id}`).click();
    await expect(page.getByTestId(`wiki-${id}`)).toHaveAttribute('aria-pressed', 'true');
    await expectNoChinese(page);
  }
  await expect(page.getByTestId('wiki-title')).toHaveText('Mars');
  await expect(page.getByTestId('wiki-game-note').first()).toContainText('In the game');

  // 选中的条目与页签刷新后保留
  await page.reload();
  await expect(page.getByTestId('wiki-title')).toHaveText('Mars');
  await page.getByTestId('language-zh').click();
  await expect(page.getByTestId('wiki-title')).toHaveText('火星');
  expect(problems).toEqual([]);
});
