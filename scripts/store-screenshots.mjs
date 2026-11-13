// App Store screenshots (6.9", 1320×2868) from the phone UI running in the Expo web preview with
// demo data. Usage: (cd apps/mobile && pnpm web) then node scripts/store-screenshots.mjs [outDir]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const out = process.argv[2] ?? join(root, 'assets/store');
const base = 'http://localhost:8082';
mkdirSync(join(out, 'raw'), { recursive: true });

const shots = {
  zh: [
    ['today', '/', '今天要做的，一眼看清', 'light'],
    ['add', '/add', '一句话，日期项目全识别', 'light'],
    ['upcoming', '/upcoming', '未来两周，按天排好', 'light'],
    ['detail', '/upcoming', '子任务、备注、提醒，都在一处', 'light'],
    ['dark', '/', '深色模式，同样耐看', 'dark'],
  ],
  en: [
    ['today', '/', 'Today, at a glance', 'light'],
    ['add', '/add', 'Type it the way you say it', 'light'],
    ['upcoming', '/upcoming', 'Two weeks, day by day', 'light'],
    ['detail', '/upcoming', 'Subtasks, notes and reminders in one place', 'light'],
    ['dark', '/', 'Just as calm in the dark', 'dark'],
  ],
};

const browser = await chromium.launch();
for (const [lang, list] of Object.entries(shots)) {
  for (const [name, path, caption, scheme] of list) {
    const ctx = await browser.newContext({
      viewport: { width: 440, height: 956 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      locale: lang === 'zh' ? 'zh-CN' : 'en-US',
      timezoneId: 'Asia/Shanghai',
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    await page.goto(`${base}/?demo=1`, { timeout: 120000 });
    await page.waitForTimeout(3500);
    if (path && path !== '/') {
      await page.evaluate((p) => window.history.pushState(null, '', p), path);
      await page.goto(`${base}${path}`);
      await page.waitForTimeout(2500);
    }
    if (name === 'add') {
      await page.keyboard.type(
        lang === 'zh' ? '下周五下午3点 和设计团队评审 #工作 p1' : 'Review with design next fri 3pm #Work p1',
        { delay: 5 },
      );
      await page.waitForTimeout(600);
    }
    if (name === 'detail') {
      await page
        .getByText(lang === 'zh' ? '准备发布会演讲稿' : 'Draft the launch keynote')
        .first()
        .click();
      await page.waitForTimeout(1500);
    }
    // Hide the web focus ring of text fields (not present on device).
    await page.addStyleTag({ content: 'input, textarea { outline: none !important; }' });
    const raw = join(out, 'raw', `${lang}-${name}.png`);
    await page.screenshot({ path: raw });
    await ctx.close();

    // Marketing frame: caption on paper, the screen inside a rounded device outline.
    const frame = await browser.newPage({ viewport: { width: 1320, height: 2868 } });
    const dark = scheme === 'dark';
    const img = readFileSync(raw).toString('base64');
    // Quick add is a bottom sheet on device; the web preview shows it as a page. Composite it over
    // the dimmed Today screen the way the phone presents it.
    const sheet =
      name === 'add'
        ? `<div style="position:absolute;inset:0;background:rgba(16,19,26,.32)"></div>
           <div style="position:absolute;left:0;right:0;bottom:0;height:34%;overflow:hidden;border-radius:56px 56px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.18)">
             <img src="data:image/png;base64,${img}" style="width:100%;display:block"/>
           </div>`
        : '';
    const screen =
      name === 'add' ? readFileSync(join(out, 'raw', `${lang}-today.png`)).toString('base64') : img;
    await frame.setContent(`
      <html><head><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=swap" rel="stylesheet"></head>
      <body style="margin:0;width:1320px;height:2868px;background:${dark ? '#17191E' : '#F2F3F5'};display:flex;flex-direction:column;align-items:center;font-family:'Bricolage Grotesque',-apple-system,'PingFang SC',sans-serif">
        <div style="height:470px;margin-top:40px;display:flex;align-items:center;justify-content:center;padding:0 110px;text-align:center;font-size:${lang === 'zh' ? 88 : 90}px;line-height:1.14;font-weight:700;letter-spacing:-0.02em;color:${dark ? '#E8EAEE' : '#1D2230'}">${caption}</div>
        <div style="width:1060px;height:2304px;border-radius:120px;padding:22px;background:${dark ? '#2A2E36' : '#1D2230'};box-shadow:0 40px 120px rgba(0,0,0,${dark ? 0.5 : 0.22})">
          <div style="position:relative;width:100%;height:100%;border-radius:100px;overflow:hidden">
            <img src="data:image/png;base64,${screen}" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"/>
            ${sheet}
          </div>
        </div>
      </body></html>`);
    await frame.waitForTimeout(800);
    await frame.screenshot({ path: join(out, `${lang}-${name}.png`) });
    await frame.close();
    console.log('wrote', `${lang}-${name}.png`);
  }
}
await browser.close();
