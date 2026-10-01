// Сборка PDF «Предложение по улучшению» из promo/ppu.html (headless Chromium через Playwright).
//   node promo/build-pdf.mjs
// Нужен Playwright (npm i -D playwright или глобальная установка).

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'ППУ_Цифровая_3D-карта_территории.pdf');

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
  console.error('Не найден Playwright: npm i -D playwright');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(here, 'ppu.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true });
await browser.close();
console.log('Готово:', path.relative(process.cwd(), out));
