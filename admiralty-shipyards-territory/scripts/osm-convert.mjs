// Преобразование сохранённого ответа Overpass в слой уточнения src/data/osm-overlay.js.
//   npm run osm:convert [-- путь/к/raw.json]
//   npm run osm:convert -- --reset            — вернуть модель к чистой схеме

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { convertOverpass } from '../src/osm/convert.js';
import { YARD_ZONES } from '../src/data/real.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'src/data/osm-overlay.js');

export async function convertFile(rawPath) {
  const json = JSON.parse(await readFile(rawPath, 'utf8'));
  const ov = convertOverpass(json, { shipyardZones: YARD_ZONES.map((z) => z.polygon) });
  const body = `// Сгенерировано scripts/osm-convert.mjs из ${path.relative(root, rawPath)} — не редактировать вручную.\n// Данные © участники OpenStreetMap, лицензия ODbL.\nexport default ${JSON.stringify(ov)};\n`;
  await writeFile(target, body);
  const yard = ov.buildings.filter((b) => b.kind === 'shipyard').length;
  console.log(`Слой уточнения: зданий ${ov.buildings.length} (на территории верфи ${yard}), водных полигонов ${ov.water.length}, ограждений ${ov.fences.length}, улиц ${ov.streets.length} → src/data/osm-overlay.js`);
  console.log('Пересоберите просмотрщик и экспорт: npm run build && npm run export');
  return ov;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--reset')) {
    await writeFile(target, '// Слой уточнения из OpenStreetMap. Файл перезаписывается командой `npm run osm:fetch`\n// (или `npm run osm:convert` из сохранённого data/osm/raw.json). Пока данных нет — null,\n// и модель строится только по схеме.\nexport default null;\n');
    console.log('Слой OSM отключён: модель строится по схеме.');
  } else {
    const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
    await convertFile(path.resolve(root, arg || 'data/osm/raw.json'));
  }
}
