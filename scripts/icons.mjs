// Render the app icon SVG to every PNG size the platforms need (web, Tauri, Expo).
// Usage: node scripts/icons.mjs   (needs @playwright/test from apps/web)
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');
const svg = readFileSync(join(root, 'apps/web/public/icon.svg'), 'utf8');

const targets = [
  ['apps/web/public/icon-180.png', 180, false],
  ['apps/web/public/icon-192.png', 192, false],
  ['apps/web/public/icon-512.png', 512, false],
  ['apps/web/public/icon-maskable-512.png', 512, true],
  ['apps/web/public/favicon-32.png', 32, false],
  ['assets/icon-1024.png', 1024, false],
  ['assets/icon-maskable-1024.png', 1024, true],
  ['assets/icon-ios-1024.png', 1024, 'ios'],
  ['assets/icon-macos-1024.png', 1024, 'macos'],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, size, maskable] of targets) {
  // Maskable/full-bleed: square background, artwork kept inside the 80% safe zone.
  let inner = `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  if (maskable === true) {
    inner = `<div style="width:${size}px;height:${size}px;background:#1f8f6a;display:grid;place-items:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg.replace('rx="228"', 'rx="0"')}</div></div>`;
  } else if (maskable === 'ios') {
    // iOS masks the icon itself and rejects transparency: full-bleed square.
    inner = `<div style="width:${size}px;height:${size}px">${svg.replace('rx="228"', 'rx="0"')}</div>`;
  } else if (maskable === 'macos') {
    // macOS (Big Sur grid): 824px rounded tile centred on a 1024 canvas with a soft shadow.
    inner = `<div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:824px;height:824px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.28))">${svg.replace('rx="228"', 'rx="185"')}</div></div>`;
  }
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${inner}</body></html><style>svg{width:100%;height:100%;display:block}</style>`,
  );
  const file = join(root, out);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: maskable !== true && maskable !== 'ios' });
  console.log('wrote', out);
}
await browser.close();
