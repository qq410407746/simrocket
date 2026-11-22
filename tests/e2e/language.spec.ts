import { type Page, expect, test } from '@playwright/test';

const expectEnglishPage = async (page: Page) => {
  const content = await page.locator('body').textContent() ?? '';
  // The switch keeps the native Chinese option discoverable in either language.
  expect(content.replaceAll('简体中文', '')).not.toMatch(/\p{Script=Han}/u);
  const attributes = await page.locator('[title], [aria-label]').evaluateAll((elements) =>
    elements.map((element) => `${element.getAttribute('title') ?? ''} ${element.getAttribute('aria-label') ?? ''}`).join('\n'),
  );
  expect(attributes).not.toMatch(/\p{Script=Han}/u);
};

test('language selector translates menus and persists across a reload', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('tab-missions')).toHaveText('任务');
  await page.getByTestId('language-en').click({ timeout: 5_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Orbital Frontier');
  await expect(page.getByTestId('language-en')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tab-missions')).toHaveText('Missions');
  await expectEnglishPage(page);

  await page.getByTestId('tab-sandbox').click();
  await expect(page.getByTestId('enter-flight')).toHaveText('Enter launchpad');
  await expectEnglishPage(page);
  await page.reload();
  await expect(page.getByTestId('tab-sandbox')).toHaveText('Free flight');
  await expect(page.getByTestId('language-en')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByTestId('tab-logbook').click();
  await expectEnglishPage(page);
  await page.getByTestId('tab-design').click();
  await expect(page.getByTestId('design-workshop')).toContainText('Rocket design workshop');
  await expect(page.getByTestId('design-performance')).toContainText('Liftoff mass');
  await expectEnglishPage(page);
  await page.getByTestId('language-zh').click();
  await expect(page.getByTestId('design-workshop')).toContainText('火箭设计室');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByTestId('tab-missions')).toHaveText('任务');
  await expect(page.getByTestId('language-zh')).toHaveAttribute('aria-pressed', 'true');
  expect(problems).toEqual([]);
});

test('all eight mission briefings and in-flight guidance are available in English', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('language-en').click();
  await page.getByTestId('unlock-all').check();
  const missions = page.locator('[data-testid="mission-list"] button');
  await expect(missions).toHaveCount(8);
  for (const mission of await missions.all()) {
    await mission.click();
    await expect(page.getByTestId('briefing-plan')).not.toBeEmpty();
    await expectEnglishPage(page);
  }
  await page.getByTestId('mission-karman-line').click();
  await page.getByTestId('start-mission').click();
  await expect(page.getByTestId('mission-title')).toContainText('Kármán');
  await page.getByTestId('mission-title').click();
  await expect(page.getByTestId('mission-plan')).toBeVisible();
  await expect(page.getByTestId('flight-hint')).toContainText('Space');
  await expectEnglishPage(page);
});

test('English flight controls, events, failure result and saved logbook work end to end', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await page.goto('/');
  await page.getByTestId('language-en').click();
  await page.getByTestId('tab-sandbox').click();
  await page.getByTestId('vehicle-mercury-redstone').click();
  await page.getByTestId('enter-flight').click();
  await expect(page.getByTestId('readout-altitude')).toContainText('Altitude');
  await expect(page.getByTestId('flight-hint')).toContainText('Space');
  await expectEnglishPage(page);
  await page.getByTestId('stage-button').click();
  await expect.poll(() => page.evaluate(() => {
    const api = (window as unknown as { __orbitalFrontier?: { sim: () => { telemetry: { altitude: number } | null } } }).__orbitalFrontier;
    return api?.sim().telemetry?.altitude ?? 0;
  })).toBeGreaterThan(50);
  await expectEnglishPage(page);
  await page.getByTestId('throttle-cut').click();
  await page.getByTestId('warp-5').click();
  await expect(page.getByTestId('flight-summary')).toBeVisible();
  await expect(page.getByTestId('flight-outcome')).toContainText('destroyed');
  await expectEnglishPage(page);
  await page.getByTestId('summary-menu').click();
  await page.getByTestId('tab-logbook').click();
  await expect(page.getByTestId('logbook-entry').first()).toContainText('Mercury-Redstone');
  await expect(page.getByTestId('logbook-entry').first()).toContainText('Ground impact');
  await expectEnglishPage(page);
  expect(problems).toEqual([]);
});

test('orbital map remains functional in English and Chinese can be restored', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('language-en').click();
  await page.getByTestId('tab-sandbox').click();
  await page.getByTestId('start-orbit').click();
  await page.getByTestId('enter-flight').click();
  await expect(page.getByTestId('orbit-status')).toContainText('orbit');
  await page.getByTestId('camera-map').click();
  await expect(page.getByTestId('map-overlay')).toBeVisible();
  await expect(page.getByTestId('orbital-elements')).toBeVisible();
  await expect(page.getByTestId('maneuver-panel')).toContainText('Advanced orbit');
  await page.getByTestId('maneuver-panel').locator(':scope > summary').click();
  await page.getByTestId('plan-circular').click();
  await expect(page.getByTestId('maneuver-status')).toContainText('Time to node');
  await expectEnglishPage(page);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('language-zh').click();
  await page.getByTestId('enter-flight').click();
  await expect(page.getByTestId('telemetry-panel')).toContainText('飞行遥测');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});
