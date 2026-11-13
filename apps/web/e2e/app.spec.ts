import { expect, type Page, test } from '@playwright/test';

const row = (page: Page, text: string) => page.locator('[data-task-row]').filter({ hasText: text });

test.beforeEach(async ({ page }) => {
  await page.goto('/#/inbox');
  await expect(page.getByRole('heading', { name: '收件箱' })).toBeVisible();
});

test('quick add understands dates, projects and priority', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  await qa.fill('明天下午3点 写周报 #工作 p1');
  await expect(page.getByRole('button', { name: /明天 15:00/ })).toBeVisible();
  await qa.press('Enter');
  // Added to the 工作 project, so the toast says where it went.
  await expect(page.getByText(/已添加到 工作/)).toBeVisible();
  await page.getByRole('button', { name: '查看' }).click();
  await expect(row(page, '写周报')).toBeVisible();
  await expect(row(page, '写周报')).toContainText('明天 15:00');
});

test('un-recognizing a token keeps it as text', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  await qa.fill('读《明天简史》');
  await page.getByTitle('按普通文字处理').first().click();
  await qa.press('Enter');
  await expect(row(page, '读《明天简史》')).toBeVisible();
  // No date was set: the row has no "明天" date label, only the title.
  await expect(row(page, '读《明天简史》').getByText('明天', { exact: true })).toHaveCount(0);
});

test('complete with undo', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  await qa.fill('买牛奶');
  await qa.press('Enter');
  await row(page, '买牛奶').getByRole('checkbox').click();
  await expect(row(page, '买牛奶')).toHaveCount(0);
  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(row(page, '买牛奶')).toBeVisible();
});

test('detail pane edits notes and subtasks', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  await qa.fill('准备发布会');
  await qa.press('Enter');
  await row(page, '准备发布会').click();
  const detail = page.getByRole('complementary');
  await detail.getByPlaceholder('添加备注（支持 Markdown）').fill('**场地** 已订好 https://example.com');
  await detail.getByPlaceholder('添加子任务').click();
  await expect(detail.getByText('场地')).toBeVisible();
  await detail.getByPlaceholder('添加子任务').fill('写新闻稿');
  await detail.getByPlaceholder('添加子任务').press('Enter');
  await expect(detail.locator('input[value="写新闻稿"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row(page, '准备发布会')).toContainText('0/1');
});

test('keyboard: navigate, complete, palette', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  for (const title of ['第一件', '第二件']) {
    await qa.fill(title);
    await qa.press('Enter');
  }
  await qa.press('Escape');
  await page.locator('main').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('e');
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('第一件');
  await expect(page.getByRole('option', { name: /第一件/ })).toBeVisible();
});

test('recurring task asks before moving the series', async ({ page }) => {
  const qa = page.getByLabel('添加任务');
  await qa.fill('每周一 例会');
  await qa.press('Enter');
  await page.goto('/#/upcoming');
  await row(page, '例会').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /明天/ }).click();
  await expect(page.getByRole('dialog', { name: '这是一个重复任务' })).toBeVisible();
  await page.getByRole('button', { name: '只改这一次' }).click();
  await expect(page.getByText(/已改到/)).toBeVisible();
});
