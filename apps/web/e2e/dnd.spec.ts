import { expect, type Locator, type Page, test } from '@playwright/test';

const rows = (page: Page) => page.locator('[data-task-row]');

async function drag(page: Page, from: Locator, to: Locator, offsetY = 0) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error('missing box');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Past the 6px activation distance, then glide to the target.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + offsetY, { steps: 16 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/#/inbox');
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible();
  // Start from an empty Inbox.
  while ((await rows(page).count()) > 0) {
    await rows(page).first().click();
    await page.keyboard.press('Meta+Backspace');
    await page.waitForTimeout(250);
  }
  const qa = page.getByLabel('添加任务');
  for (const title of ['甲', '乙', '丙']) {
    await qa.fill(title);
    await qa.press('Enter');
  }
  await qa.press('Escape');
  await expect(rows(page)).toHaveText(['甲', '乙', '丙']);
});

test('drag to reorder within a list (persists across reload)', async ({ page }) => {
  await drag(page, rows(page).filter({ hasText: '丙' }), rows(page).filter({ hasText: '甲' }), -8);
  await expect(rows(page)).toHaveText(['丙', '甲', '乙']);
  await page.waitForTimeout(600); // debounced save
  await page.reload();
  await expect(rows(page)).toHaveText(['丙', '甲', '乙']);
});

test('drag onto a sidebar project moves the task', async ({ page }) => {
  await drag(
    page,
    rows(page).filter({ hasText: '乙' }),
    page.locator('nav').getByRole('button', { name: /工作/ }),
  );
  await expect(rows(page)).toHaveText(['甲', '丙']);
  await expect(page.getByText(/已移动到 工作/)).toBeVisible();
});
