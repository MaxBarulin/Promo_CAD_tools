// Проверка конвейера OSM на синтетических данных: преобразование, сопоставление имён, сборка модели.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertOverpass } from '../src/osm/convert.js';
import { applyOverlay } from '../src/data/overlay.js';
import { getTerritory } from '../src/data/index.js';
import { ZONES } from '../src/data/shipyard.js';
import { initModel, buildModel } from '../src/model/index.js';

const json = JSON.parse(await readFile(new URL('./fixtures/overpass-sample.json', import.meta.url), 'utf8'));
const ov = convertOverpass(json, { shipyardZones: ZONES.filter((z) => z.kind === 'shipyard').map((z) => z.polygon) });
assert.equal(ov.buildings.length, 2);
assert.equal(ov.buildings.filter((b) => b.kind === 'shipyard').length, 1, 'эллинг должен попасть на территорию верфи');
assert.equal(ov.water.length, 2, 'Нева (мультиполигон из двух путей) и Фонтанка');
assert.equal(ov.fences.length, 1);
assert.equal(ov.streets.length, 1);
assert.match(ov.buildings[1].name, /Декабристов/);

const data = applyOverlay(getTerritory({ useOSM: false }), ov);
assert.ok(data.overlayReport.matched.includes('N1'), 'название «Большой каменный эллинг» перенесено на OSM-контур');
assert.equal(data.buildings.find((b) => b.id === 'N1').name, 'Большой каменный эллинг');

initModel(THREE);
const model = buildModel(data);
assert.equal(model.generatedCount, 0, 'при данных OSM рядовая застройка не генерируется');
assert.ok(model.stats.triangles > 10000);
console.log('OK: конвейер OSM —', data.overlayReport.matched.length, 'совпадений имён, треугольников', model.stats.triangles);
