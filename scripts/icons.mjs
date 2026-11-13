// Render the app icon SVG to every PNG size the platforms need (web, Tauri, Expo).
// Usage: node scripts/icons.mjs [filter]   (needs @playwright/test from apps/web; `filter` limits
// the run to output paths containing it)
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
  ['apps/mobile/assets/icon.png', 1024, 'ios'],
  ['apps/mobile/assets/icon-dark.png', 1024, 'ios-dark'],
  ['apps/mobile/assets/icon-tinted.png', 1024, 'ios-tinted'],
  ['apps/mobile/assets/adaptive-icon.png', 1024, 'foreground'],
  ['apps/mobile/assets/adaptive-icon-monochrome.png', 1024, 'monochrome'],
  ['apps/mobile/assets/splash-icon.png', 512, false],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [out, size, maskable] of targets.filter(([o]) => o.includes(process.argv[2] ?? ''))) {
  // Maskable/full-bleed: square background, artwork kept inside the 80% safe zone.
  let inner = `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  if (maskable === true) {
    inner = `<div style="width:${size}px;height:${size}px;background:#1f8f6a;display:grid;place-items:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg.replace('rx="228"', 'rx="0"')}</div></div>`;
  } else if (maskable === 'ios') {
    // iOS masks the icon itself and rejects transparency: full-bleed square.
    inner = `<div style="width:${size}px;height:${size}px">${svg.replace('rx="228"', 'rx="0"')}</div>`;
  } else if (maskable === 'ios-dark') {
    // iOS 18 dark icon: the system draws the dark background; the slip turns jade, the check white.
    const art = svg
      .replace(/<rect width="1024" height="1024"[^>]*\/>/, '')
      .replace('stop-color="#ffffff"', 'stop-color="#3fbf93"')
      .replace('stop-color="#eef6f2"', 'stop-color="#1f8f6a"')
      .replaceAll('fill="#1f8f6a" opacity=".22"', 'fill="#ffffff" opacity=".35"')
      .replace('stroke="#1f8f6a" stroke-width="64"', 'stroke="#ffffff" stroke-width="64"');
    inner = `<div style="width:${size}px;height:${size}px">${art}</div>`;
  } else if (maskable === 'ios-tinted') {
    // iOS 18 tinted icon: grayscale on black; the system maps brightness to the tint colour.
    const art = svg
      .replace(/<rect width="1024" height="1024"[^>]*\/>/, '<rect width="1024" height="1024" fill="#000"/>')
      .replace('stop-color="#ffffff"', 'stop-color="#ffffff"')
      .replace('stop-color="#eef6f2"', 'stop-color="#d9d9d9"')
      .replaceAll('fill="#1f8f6a" opacity=".22"', 'fill="#000" opacity=".25"')
      .replace('stroke="#1f8f6a" stroke-width="64"', 'stroke="#3a3a3a" stroke-width="64"');
    inner = `<div style="width:${size}px;height:${size}px">${art}</div>`;
  } else if (maskable === 'monochrome') {
    // Android 13 themed icon: only alpha counts, so the lines and the check are cut out of the slip.
    const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><mask id="m">
      <rect width="1024" height="1024" fill="#fff"/>
      <rect x="342" y="330" width="260" height="34" rx="17" fill="#000" opacity=".55"/>
      <rect x="342" y="404" width="200" height="34" rx="17" fill="#000" opacity=".55"/>
      <path d="M352 594 L452 690 L676 470" fill="none" stroke="#000" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
    </mask></defs><rect x="262" y="226" width="500" height="572" rx="72" fill="#fff" mask="url(#m)"/></svg>`;
    inner = `<div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${size * 0.9}px;height:${size * 0.9}px">${mono}</div></div>`;
  } else if (maskable === 'foreground') {
    // Android adaptive icon foreground: artwork only, inside the 66% safe zone.
    const art = svg.replace(/<rect width="1024" height="1024"[^>]*\/>/, '');
    inner = `<div style="width:${size}px;height:${size}px;display:grid;place-items:center"><div style="width:${size * 0.9}px;height:${size * 0.9}px">${art}</div></div>`;
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
  const opaque = maskable === true || maskable === 'ios' || maskable === 'ios-tinted';
  await page.screenshot({ path: file, omitBackground: !opaque });
  console.log('wrote', out);
}
await browser.close();
