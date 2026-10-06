// Снимки экрана предустановленных видов (headless Chromium через Playwright).
//   node scripts/screenshots.mjs [папка=docs/img] [вид1,вид2,...] [--evening] [--dark] [--width=1600 --height=1000]
// Нужен Playwright (npm i -D playwright или глобальная установка).

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const pos = args.filter((a) => !a.startsWith('--'));
const outDir = path.resolve(root, pos[0] || 'docs/img');
const only = pos[1] ? pos[1].split(',') : null;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const require = createRequire(import.meta.url);
  for (const p of ['/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) {
    try {
      ({ chromium } = require(p));
      break;
    } catch {}
  }
}
if (!chromium) {
  console.error('Playwright не найден: npm i -D playwright');
  process.exit(1);
}

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const width = +(flags.width || 1600);
const height = +(flags.height || 1000);
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: flags.dark ? 'dark' : 'light' });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.type(), m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(pathToFileURL(path.join(root, 'dist/index.html')).href);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await mkdir(outDir, { recursive: true });
const views = await page.evaluate(() => window.__viewer.VIEWS.map((v) => v.id));
// страница открывается в текущем времени; снимки — в полдень (или в сумерках с --evening)
await page.evaluate((ev) => window.__viewer.setEvening(ev), !!flags.evening);
for (const id of views) {
  if (only && !only.includes(id)) continue;
  await page.evaluate((id) => {
    const v = window.__viewer.VIEWS.find((x) => x.id === id);
    window.__viewer.flyTo(v.eye, v.target, 0);
  }, id);
  await page.waitForTimeout(1200);
  const file = path.join(outDir, `${id}${flags.evening ? '-evening' : ''}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 82 });
  console.log('снимок:', path.relative(root, file));
}
await browser.close();
