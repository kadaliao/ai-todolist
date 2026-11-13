import { expect, test } from '@playwright/test';

test('phone layout: drawer navigation and detail sheet', async ({ page }) => {
  await page.goto('/#/today');
  await expect(page.getByRole('heading', { name: '今天' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: /收件箱/ }).click();
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible();
  const qa = page.getByLabel('添加任务');
  await qa.fill('手机上加的任务');
  await qa.press('Enter');
  await page.locator('[data-task-row]').filter({ hasText: '手机上加的任务' }).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  // No horizontal scrolling at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
