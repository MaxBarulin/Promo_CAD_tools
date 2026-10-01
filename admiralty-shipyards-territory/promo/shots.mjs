// Снимки модели для документа ППУ (promo/img). Запуск после `npm run build`:
//   node promo/shots.mjs [hero,objects,registry,plan,city,evening,mobile]
// Затем пересоберите PDF: node promo/build-pdf.mjs
// Нужен Playwright (npm i -D playwright или глобальная установка).

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = (name) => path.join(here, 'img', name);
const url = pathToFileURL(path.join(here, '..', 'dist', 'index.html')).href;
const only = process.argv[2] ? process.argv[2].split(',') : null;
const want = (k) => !only || only.includes(k);

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

// без GPU WebGL рисуется программно (SwiftShader) — медленно, но одинаково на любой машине
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });

async function open(viewport, { hash = '', mobile = false } = {}) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  await p.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* хранилище недоступно */
    }
  });
  await p.goto(url + hash, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  return p;
}
async function shot(p, name, wait = 5000) {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: out(name), type: 'jpeg', quality: 85, timeout: 300000 });
  console.log('Снимок:', name);
}
const hideUi = (p, keepScope = false) =>
  p.addStyleTag({ content: `.brand,.panel,.hint,.hud,.card${keepScope ? '' : ',.scope-toggle'}{display:none!important}` });

if (want('hero')) {
  const p = await open({ width: 1800, height: 1000 });
  await hideUi(p);
  await p.evaluate(() => {
    window.__viewer.setPanelCollapsed(true);
    window.__viewer.flyTo([-1500, -350, 650], [-420, 480, 0], 0);
  });
  await shot(p, 'hero.jpg');
  await p.close();
}
if (want('objects')) {
  const p = await open({ width: 1440, height: 900 });
  await p.click('#tabObjects');
  await p.evaluate(() => {
    const v = window.__viewer;
    const o = v.pickMesh.userData.objects.find((x) => x.id === 'Z129');
    v.select(o);
    v.focusObject(o);
  });
  await shot(p, 'objects.jpg');
  await p.close();
}
if (want('registry')) {
  // демо-режим: условные сроки ЭПБ, в документе снимок помечен «ДЕМО»
  const p = await open({ width: 1440, height: 900 });
  await p.click('#regOpen');
  await p.click('#regDemoBtn');
  await p.selectOption('#regEpb', 'due');
  await shot(p, 'registry.jpg');
  await p.close();
}
if (want('plan')) {
  const p = await open({ width: 1000, height: 1400 });
  await hideUi(p, true);
  await p.evaluate(() => {
    const v = window.__viewer;
    v.setYardOnly(true);
    v.setPanelCollapsed(true);
    v.flyTo([-329, 585, 3200], [-329, 593, 0], 0);
  });
  await shot(p, 'plan-yard.jpg');
  await p.close();
}
if (want('city')) {
  const p = await open({ width: 1440, height: 900 });
  await p.evaluate(() => {
    window.__viewer.setPanelCollapsed(true);
    window.__viewer.flyTo([-1250, 1650, 900], [-300, 560, 0], 0);
  });
  await shot(p, 'city.jpg');
  await p.evaluate(() => window.__viewer.setYardOnly(true));
  await shot(p, 'yard-only.jpg');
  await p.close();
}
if (want('evening')) {
  const p = await open({ width: 1440, height: 900 }, { hash: '#slipways' });
  await hideUi(p);
  await p.evaluate(() => window.__viewer.setEvening(true));
  await shot(p, 'evening.jpg');
  await p.close();
}
if (want('mobile')) {
  const p = await open({ width: 390, height: 844 }, { mobile: true });
  await p.tap('#tabObjects');
  await shot(p, 'mobile-list.jpg', 3000);
  await p.tap('#objList button.obj >> nth=0');
  await shot(p, 'mobile-card.jpg', 4000);
  await p.close();
}
await browser.close();
