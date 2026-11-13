// Store screenshots, framed with a caption:
// - App Store iPhone 6.9" (1320×2868) and Google Play phone (1080×1920) from the phone UI running
//   in the Expo web preview with demo data;
// - App Store iPad 13" (2064×2752) and the iPhone Home Screen widgets from simulator captures kept
//   in <outDir>/raw (ipad-<lang>-<name>.png, <lang>-widgets.png).
// Usage: (cd apps/mobile && pnpm web) then node scripts/store-screenshots.mjs [outDir]
//   --only=<name>   one phone shot (e.g. --only=widgets)
//   --frame-only    reuse the captures in raw/ (no web preview needed)
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const frameOnly = args.includes('--frame-only');
const out = args.find((a) => !a.startsWith('--')) ?? join(root, 'assets/store');
const base = 'http://localhost:8082';
mkdirSync(join(out, 'raw'), { recursive: true });
mkdirSync(join(out, 'play'), { recursive: true });

const shots = {
  zh: [
    ['today', '/', '今天要做的，一眼看清', 'light'],
    ['add', '/add', '一句话，日期项目全识别', 'light'],
    ['upcoming', '/upcoming', '未来两周，按天排好', 'light'],
    ['detail', '/upcoming', '子任务、备注、提醒，都在一处', 'light'],
    ['dark', '/', '深色模式，同样耐看', 'dark'],
    ['widgets', null, '不打开应用，也能勾掉任务', 'light'],
  ],
  en: [
    ['today', '/', 'Today, at a glance', 'light'],
    ['add', '/add', 'Type it the way you say it', 'light'],
    ['upcoming', '/upcoming', 'Two weeks, day by day', 'light'],
    ['detail', '/upcoming', 'Subtasks, notes and reminders in one place', 'light'],
    ['dark', '/', 'Just as calm in the dark', 'dark'],
    ['widgets', null, 'Check things off from your Home Screen', 'light'],
  ],
};

/** Canvas and device-frame geometry per store format. */
const formats = {
  iphone: {
    w: 1320,
    h: 2868,
    capH: 470,
    capTop: 40,
    font: 88,
    pad: 110,
    fw: 1060,
    fh: 2304,
    r: 120,
    ir: 100,
    bezel: 22,
  },
  play: {
    w: 1080,
    h: 1920,
    capH: 300,
    capTop: 20,
    font: 62,
    pad: 70,
    fw: 700,
    fh: 1540,
    r: 80,
    ir: 66,
    bezel: 16,
  },
  ipad: {
    w: 2064,
    h: 2752,
    capH: 520,
    capTop: 40,
    font: 116,
    pad: 180,
    fw: 1600,
    fh: 2128,
    r: 90,
    ir: 64,
    bezel: 22,
  },
};

// The display face (variable, with the optical-size axis), embedded so rendering needs no network.
const fontFile = join(
  dirname(require.resolve('@fontsource-variable/bricolage-grotesque/opsz.css')),
  'files/bricolage-grotesque-latin-opsz-normal.woff2',
);
const fontFace = `<style>@font-face{font-family:'Bricolage Grotesque';font-weight:200 800;src:url(data:font/woff2;base64,${readFileSync(fontFile).toString('base64')}) format('woff2-variations')}</style>`;

const browser = await chromium.launch();

async function capture(lang, name, path, scheme, raw) {
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
  await page.screenshot({ path: raw });
  await ctx.close();
}

/** Marketing frame: caption on paper, the screen inside a rounded device outline. */
async function frame(format, { caption, dark, screen, sheet = '' }, file) {
  const f = formats[format];
  const page = await browser.newPage({ viewport: { width: f.w, height: f.h } });
  await page.setContent(`
    <html><head>${fontFace}</head>
    <body style="margin:0;width:${f.w}px;height:${f.h}px;background:${dark ? '#17191E' : '#F2F3F5'};display:flex;flex-direction:column;align-items:center;font-family:'Bricolage Grotesque',-apple-system,'PingFang SC',sans-serif">
      <div style="height:${f.capH}px;margin-top:${f.capTop}px;display:flex;align-items:center;justify-content:center;padding:0 ${f.pad}px;text-align:center;font-size:${f.font}px;line-height:1.14;font-weight:700;letter-spacing:-0.02em;color:${dark ? '#E8EAEE' : '#1D2230'}">${caption}</div>
      <div style="width:${f.fw}px;height:${f.fh}px;box-sizing:border-box;border-radius:${f.r}px;padding:${f.bezel}px;background:${dark ? '#2A2E36' : '#1D2230'};box-shadow:0 40px 120px rgba(0,0,0,${dark ? 0.5 : 0.22})">
        <div style="position:relative;width:100%;height:100%;border-radius:${f.ir}px;overflow:hidden">
          <img src="data:image/png;base64,${screen}" style="width:100%;height:100%;object-fit:cover;object-position:top;display:block"/>
          ${sheet}
        </div>
      </div>
    </body></html>`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: file });
  await page.close();
  console.log('wrote', file.slice(out.length + 1));
}

for (const [lang, list] of Object.entries(shots)) {
  for (const [name, path, caption, scheme] of list) {
    if (only && name !== only) continue;
    const raw = join(out, 'raw', `${lang}-${name}.png`);
    if (path !== null && !frameOnly) await capture(lang, name, path, scheme, raw);
    if (!existsSync(raw)) continue;
    const img = readFileSync(raw).toString('base64');
    // Quick add is a bottom sheet on device; the web preview shows it as a page. Composite it over
    // the dimmed Today screen the way the phone presents it.
    const sheet =
      name === 'add'
        ? `<div style="position:absolute;inset:0;background:rgba(16,19,26,.32)"></div>
           <div style="position:absolute;left:0;right:0;bottom:0;height:34%;overflow:hidden;border-radius:5.5% 5.5% 0 0 / 7.3% 7.3% 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.18)">
             <img src="data:image/png;base64,${img}" style="width:100%;display:block"/>
           </div>`
        : '';
    const screen =
      name === 'add' ? readFileSync(join(out, 'raw', `${lang}-today.png`)).toString('base64') : img;
    const shot = { lang, caption, dark: scheme === 'dark', screen, sheet };
    await frame('iphone', shot, join(out, `${lang}-${name}.png`));
    // Google Play: same shots at 9:16, except the iPhone Home Screen.
    if (name !== 'widgets') await frame('play', shot, join(out, 'play', `${lang}-${name}.png`));
  }

  // iPad 13": framed from simulator captures.
  if (only) continue;
  for (const [name, , caption, scheme] of list) {
    const raw = join(out, 'raw', `ipad-${lang}-${name}.png`);
    if (!existsSync(raw)) continue;
    const screen = readFileSync(raw).toString('base64');
    await frame(
      'ipad',
      { lang, caption, dark: scheme === 'dark', screen },
      join(out, `ipad-${lang}-${name}.png`),
    );
  }
}
// Google Play feature graphic (1024×500): the slip from the icon, the name and the tagline.
const feature = {
  zh: {
    tagline: '一句话记下，安心做完',
    rows: ['回复客户关于合同的邮件', '和设计团队评审新版首页', '给妈妈打电话'],
  },
  en: {
    tagline: 'Write it down.<br>Get it done.',
    rows: ['Reply to the client', 'Review the homepage', 'Call mom'],
  },
};
if (!only) {
  for (const [lang, { tagline, rows }] of Object.entries(feature)) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
    const row = (text, i) => `
      <div style="display:flex;align-items:center;gap:14px;padding:13px 0;${i ? 'border-top:2px solid #EEF0F3' : ''}">
        <div style="width:24px;height:24px;border-radius:12px;box-sizing:border-box;${i === 2 ? 'background:#1F8F6A' : `border:2.5px solid ${['#DD8F12', '#D64545'][i]}`};display:grid;place-items:center">
          ${i === 2 ? '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
        </div>
        <div style="font-size:22px;color:${i === 2 ? '#8C919C' : '#1D2230'};${i === 2 ? 'text-decoration:line-through' : ''};white-space:nowrap">${text}</div>
      </div>`;
    await page.setContent(`
      <html><head>${fontFace}</head>
      <body style="margin:0;width:1024px;height:500px;overflow:hidden;background:linear-gradient(#24a079,#1a7f5e);font-family:'Bricolage Grotesque',-apple-system,'PingFang SC',sans-serif;position:relative">
        <div style="position:absolute;left:72px;top:0;bottom:0;width:420px;display:flex;flex-direction:column;justify-content:center;color:#fff">
          <div style="font-size:104px;font-weight:700;letter-spacing:-0.03em;line-height:1">Docket</div>
          <div style="margin-top:22px;font-size:${lang === 'zh' ? 38 : 36}px;font-weight:600;opacity:.92;font-family:-apple-system,'PingFang SC',sans-serif">${tagline}</div>
        </div>
        <div style="position:absolute;right:64px;top:84px;width:390px;border-radius:30px;background:linear-gradient(#ffffff,#eef6f2);box-shadow:0 30px 60px rgba(6,40,28,.35);padding:22px 28px;transform:rotate(-4deg);font-family:-apple-system,'PingFang SC',sans-serif">
          <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px">
            <div style="font-family:'Bricolage Grotesque';font-size:46px;font-weight:700;color:#1F8F6A">13</div>
            <div style="font-size:24px;font-weight:700;color:#1D2230">${lang === 'zh' ? '今天' : 'Today'}</div>
          </div>
          ${rows.map(row).join('')}
        </div>
      </body></html>`);
    await page.waitForTimeout(800);
    const file = join(out, 'play', `feature-${lang}.png`);
    await page.screenshot({ path: file });
    await page.close();
    console.log('wrote', file.slice(out.length + 1));
  }
}

await browser.close();
