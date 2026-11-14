import { expect, type Page, type Route, test } from '@playwright/test';

/**
 * The assistant panel end to end, with the sync server and the model mocked: the model's
 * tool calls run on the page's own replica, exactly as with a real server.
 */

const SERVER = 'http://docket.test';
const row = (page: Page, text: string) => page.locator('[data-task-row]').filter({ hasText: text });

type Step = (body: {
  messages: { role: string }[];
  context: { todayTasks: { id: string; title: string }[] };
}) => unknown[];

async function mockServer(page: Page, steps: Step[]) {
  let i = 0;
  await page.route(`${SERVER}/api/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        device: 'e2e',
        cursor: 0,
        ai: { available: true, model: 'mock', agent: true, speech: false },
      });
    }
    if (url.pathname === '/api/sync/pull') return json({ ops: [], cursor: 0, more: false });
    if (url.pathname === '/api/sync/push') {
      const { ops } = route.request().postDataJSON() as { ops: { hlc: string }[] };
      return json({ acked: ops.map((o) => o.hlc), cursor: 0 });
    }
    if (url.pathname === '/api/agent') {
      const step = steps[i++];
      if (!step) return route.fulfill({ status: 500, json: { error: 'unexpected call' } });
      const events = step(route.request().postDataJSON());
      return route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${[...events.map((data) => ({ type: 'item', data })), { type: 'done' }].map((x) => JSON.stringify(x)).join('\n')}\n`,
      });
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } });
  });
  await page.routeWebSocket(/\/api\/sync\/ws/, () => {});
}

async function connect(page: Page) {
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('服务器地址').fill(SERVER);
  await page.getByLabel('设备令牌').fill('dk_e2e');
  await page.getByRole('button', { name: '连接' }).click();
  await expect(page.getByText('可用：mock')).toBeVisible();
  await page.keyboard.press('Escape');
}

const call = (name: string, input: unknown) => ({ type: 'call', call: { id: `c_${name}`, name, input } });
const text = (t: string) => ({ type: 'text', text: t });

test('talk to the list: add, confirm a delete, undo', async ({ page }) => {
  await mockServer(page, [
    () => [call('add-tasks', { tasks: [{ title: '给张三打电话', when: '明天上午9点' }] })],
    () => [text('好，明早九点提醒你给张三打电话。')],
    (b) => [call('delete-tasks', { ids: [b.context.todayTasks.find((t) => t.title === '交房租')?.id] })],
    () => [text('要删掉“交房租”吗？')],
  ]);
  await page.goto('/#/today');
  await connect(page);
  const qa = page.getByLabel('添加任务');
  await qa.fill('交房租');
  await qa.press('Enter');

  await page.keyboard.press('Meta+j');
  const panel = page.getByRole('dialog', { name: '跟 Docket 说' });
  const box = panel.getByPlaceholder('说或输入要做的事…');
  await box.fill('提醒我明早九点给张三打电话');
  await box.press('Enter');
  await expect(panel.getByText('好，明早九点提醒你给张三打电话。')).toBeVisible();
  await expect(panel.getByTestId('assistant-changes')).toContainText('给张三打电话');
  await expect(panel.getByTestId('assistant-changes')).toContainText('明天 09:00');

  // A delete waits for a yes.
  await box.fill('把交房租删了');
  await box.press('Enter');
  await expect(panel.getByText('说“好”或点确认后生效')).toBeVisible();
  await expect(row(page, '交房租')).toBeVisible();
  await box.fill('好');
  await box.press('Enter');
  await expect(row(page, '交房租')).toHaveCount(0);

  // Undo puts it back.
  await panel.getByRole('button', { name: '撤销' }).click();
  await expect(row(page, '交房租')).toBeVisible();
  await expect(panel.getByText('已撤销')).toBeVisible();

  // The new task is in Upcoming for tomorrow.
  await page.keyboard.press('Escape');
  await page.goto('/#/upcoming');
  await expect(row(page, '给张三打电话')).toContainText('09:00');
});

test('model errors are shown with a retry', async ({ page }) => {
  await mockServer(page, [
    () => [{ type: 'error', error: 'AI provider is rate limiting; try again shortly' }],
  ]);
  await page.goto('/#/today');
  await connect(page);
  await page.keyboard.press('Meta+j');
  const box = page.getByPlaceholder('说或输入要做的事…');
  await box.fill('今天还有什么');
  await box.press('Enter');
  await expect(page.getByText(/rate limiting/)).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次' })).toBeVisible();
});
