// Проверка конвейера OSM на синтетических данных: преобразование, сопоставление имён, сборка модели.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertOverpass } from '../src/osm/convert.js';
import { applyOverlay } from '../src/data/overlay.js';
import { getTerritory } from '../src/data/index.js';
import { YARD_ZONES } from '../src/data/real.js';
import { initModel, buildModel } from '../src/model/index.js';

const json = JSON.parse(await readFile(new URL('./fixtures/overpass-sample.json', import.meta.url), 'utf8'));
const ov = convertOverpass(json, { shipyardZones: YARD_ZONES.map((z) => z.polygon) });
assert.equal(ov.buildings.length, 2);
assert.equal(ov.buildings.filter((b) => b.kind === 'shipyard').length, 1, 'эллинг должен попасть на территорию верфи');
assert.equal(ov.water.length, 2, 'Нева (мультиполигон из двух путей) и Фонтанка');
assert.equal(ov.fences.length, 1);
assert.equal(ov.streets.length, 1);
assert.match(ov.buildings[1].name, /Декабристов/);

const base = getTerritory({ useOSM: false });
const data = applyOverlay(base, ov);
assert.ok(data.overlayReport.matched.includes('Z136'), 'эллинг Z136 сохранён при подмешивании OSM');
const z136 = data.buildings.find((b) => b.id === 'Z136');
assert.equal(z136.name, base.buildings.find((b) => b.id === 'Z136').name);
assert.equal(z136.geomSrc, 'plant', 'контур эллинга — по данным предприятия, а не OSM');
assert.equal(data.buildings.filter((b) => b.kind === 'shipyard' && b.geomSrc !== 'plant').length, 0, 'OSM-контуры внутри территории верфи не добавляются');

initModel(THREE);
const model = buildModel(data);
assert.equal(model.generatedCount, 0, 'при данных OSM рядовая застройка не генерируется');
assert.ok(model.stats.triangles > 10000);
console.log('OK: конвейер OSM —', data.overlayReport.matched.length, 'совпадений имён, треугольников', model.stats.triangles);
