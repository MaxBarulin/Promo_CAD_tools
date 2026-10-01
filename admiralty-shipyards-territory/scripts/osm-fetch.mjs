// Загрузка данных OpenStreetMap (Overpass API) для границ модели и сборка слоя уточнения.
//   npm run osm:fetch                         — скачать и сразу преобразовать
//   OVERPASS_URL=https://... npm run osm:fetch — другой сервер Overpass
// Результат: data/osm/raw.json (ответ сервера) → src/data/osm-overlay.js (через osm-convert).

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import REAL from '../src/data/real-data.js';
import { toLatLon } from '../src/geo.js';
import { overpassQuery } from '../src/osm/convert.js';
import { convertFile } from './osm-convert.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

const BOUNDS = REAL.bounds;
const [s, w] = toLatLon([BOUNDS.minX, BOUNDS.minY]);
const [n, e] = toLatLon([BOUNDS.maxX, BOUNDS.maxY]);
const query = overpassQuery([s, w, n, e]);
console.log(`Запрос к ${url}\nграницы: ${s.toFixed(5)}, ${w.toFixed(5)} — ${n.toFixed(5)}, ${e.toFixed(5)}`);

let res;
try {
  res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
} catch (err) {
  console.error(`Не удалось подключиться к ${url}: ${err.cause?.code || err.message}.\nЕсли сеть ограничена политикой окружения — добавьте домен overpass-api.de в список разрешённых.`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`Сервер ответил ${res.status} ${res.statusText}`);
  process.exit(1);
}
const json = await res.json();
await mkdir(path.join(root, 'data/osm'), { recursive: true });
const rawPath = path.join(root, 'data/osm/raw.json');
await writeFile(rawPath, JSON.stringify(json));
console.log(`Получено элементов: ${json.elements?.length ?? 0} → data/osm/raw.json`);
await convertFile(rawPath);
