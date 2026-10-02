// Снимки модели для документа ППУ (promo/img). Запуск после `npm run build`:
//   node promo/shots.mjs [cover,objects,registry,plan,city,bus,mobile,editor,details]
// Затем пересоберите PDF: node promo/build-pdf.mjs
// Нужен Playwright (npm i -D playwright или глобальная установка).

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { sunPosition } from '../src/viewer/daytime.js';

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

async function open(viewport, { hash = '', mobile = false, storage = {} } = {}) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
  await p.addInitScript((st) => {
    try {
      localStorage.clear();
      // подсказка по управлению на снимках не нужна
      localStorage.setItem('admiralty-hint-closed', '1');
      for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
    } catch {
      /* хранилище недоступно */
    }
  }, storage);
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

if (want('cover')) {
  // обложка: портрет A4 во всю страницу, без подписей; утреннее солнце сбоку (с юго-востока)
  // даёт тени и объём. Час — первый, когда солнце поднялось на 18° (зимой — ближе к полудню).
  const today = new Date();
  let hour = 11.5;
  for (let m = 6 * 60; m <= 11.5 * 60; m += 5) {
    if (sunPosition(today, m / 60).el >= 18) {
      hour = m / 60;
      break;
    }
  }
  const p = await open({ width: 1240, height: 1754 });
  await hideUi(p);
  await p.addStyleTag({ content: '#labels,.coords{display:none!important}' });
  await p.evaluate((h) => {
    const v = window.__viewer;
    v.setPanelCollapsed(true);
    v.setDayTime(h);
    v.flyTo([-1450, -950, 780], [-330, 760, 0], 0);
  }, hour);
  await shot(p, 'cover.jpg');
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
  // реестр как он есть: показатели по модели, поля учёта ещё не заполнены (без демо-значений)
  const p = await open({ width: 1440, height: 900 });
  await p.addStyleTag({ content: '#regDemoBtn{display:none!important}' });
  await p.click('#regOpen');
  await p.selectOption('#regCat', 'building');
  await p.click('#regHead th[data-k="volume"] button');
  await p.click('#regHead th[data-k="volume"] button');
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
if (want('bus')) {
  // внутризаводской автобус на остановке «ОТЗ» у Подзорного моста: среда, 8:35, рейс 8:30 к цеху № 12
  const p = await open({ width: 1440, height: 900 });
  await hideUi(p);
  await p.evaluate(() => {
    const v = window.__viewer;
    v.setPanelCollapsed(true);
    v.setDateTime('2026-09-30', 8 + 35.75 / 60, 0);
    v.flyTo([-302, 374, 24], [-327, 404, 1], 0);
  });
  await shot(p, 'bus.jpg', 7000);
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
if (want('editor')) {
  // редактор: цех лит. ЕЯ (Z32) с открытым разделом «Положение» — сдвиг, поворот, высота, масштаб
  const p = await open({ width: 1440, height: 900 }, { storage: { 'admiralty-ed-sections': JSON.stringify({ pos: true }) } });
  await p.evaluate(() => {
    const v = window.__viewer;
    v.setPanelCollapsed(true);
    v.selectById('Z32');
  });
  await p.click('#card [data-act="edit"]');
  await p.evaluate(() => window.__viewer.flyTo([-470, 1235, 40], [-300, 1105, 10], 0));
  await shot(p, 'editor.jpg');
  await p.close();
}
if (want('details')) {
  // узнаваемые здания, уточнённые по фото и документам
  const p = await open({ width: 1200, height: 800 });
  await hideUi(p);
  await p.evaluate(() => window.__viewer.flyTo([-75, 70, 3], [-150, 160, 14], 0));
  await shot(p, 'detail-lotsmanskaya.jpg');
  await p.evaluate(() => window.__viewer.flyTo([150, 1190, 30], [100, 1310, 16], 0));
  await shot(p, 'detail-boiler.jpg');
  await p.close();
}
await browser.close();
