// Проверка доработок из папки custom/ на моделях, выгруженных из Blender 4.5:
//   Z129.glb — корпус из выгрузки модели с UV-развёрткой и текстурой на кровле (замена);
//   N1.glb   — новое здание; custom.json — удаление двух построек и крана, новое описание Z161.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getTerritory } from '../src/data/index.js';
import { initModel, buildModel } from '../src/model/index.js';
import { prepareCustom, analyzeGlb, parseGlb, customIdFromFile } from '../src/model/custom.js';
import { mergeGlb } from '../src/export/glb-merge.js';
import { centroid, area } from '../src/geo.js';
import { readCustomDir } from '../scripts/custom-files.mjs';

assert.equal(customIdFromFile('Z129 Корпусосборочный цех (предстап.glb'), 'Z129');
assert.equal(customIdFromFile('F-galerny-1.GLB'), 'F-galerny-1');

const dir = fileURLToPath(new URL('./fixtures/custom/', import.meta.url));
const { config, files } = await readCustomDir(dir);
const custom = prepareCustom(config, files);
assert.deepEqual(custom.warnings, []);

initModel(THREE);
const base = buildModel(getTerritory(), { contextDetail: 'low' });
const data = getTerritory();
const model = buildModel(data, { contextDetail: 'low', custom });
const find = (m, id) => m.layers.flatMap((l) => l.objects.map((o) => ({ o, layer: l.id }))).find((x) => x.o.id === id);

const r = model.custom;
assert.deepEqual(r.replaced, ['Z129']);
assert.deepEqual(r.added, ['N1']);
assert.deepEqual([...r.removed].sort(), ['C2', 'Y34cacb', 'Y707ec3']);
assert.deepEqual(r.renamed, ['Z161']);
assert.deepEqual(r.warnings, []);

// удалённые — ни в модели, ни в данных (по ним строятся DXF и GeoJSON)
for (const id of ['C2', 'Y34cacb', 'Y707ec3']) assert.ok(!find(model, id), `${id} удалён из модели`);
assert.ok(!data.cranes.some((c) => c.id === 'C2'), 'кран C2 удалён из данных');

// замена: своей геометрии нет, контур из Blender совпадает с исходным
const z = find(model, 'Z129').o;
const z0 = find(base, 'Z129').o;
assert.equal(z.sink.triangleCount(), 0);
assert.equal(z.custom, 'Z129.glb');
const [cx, cy] = centroid(z.proxy.poly);
const [bx, by] = centroid(z0.proxy.poly);
assert.ok(Math.hypot(cx - bx, cy - by) < 1, 'модель из Blender стоит на месте исходного корпуса');
assert.ok(Math.abs(z.proxy.z1 - z0.proxy.z1) < 0.5);
assert.equal(z.info.name, z0.info.name, 'сведения о корпусе сохраняются');

// новое здание: слой верфи, сведения из custom.json, контур 30 × 18 м
const n = find(model, 'N1');
assert.equal(n.layer, 'shipyard');
assert.equal(n.o.name, 'Новый склад (пример)');
assert.equal(n.o.info.type, 'warehouse');
assert.equal(n.o.info.zone, 'matisov');
assert.ok(Math.abs(area(n.o.proxy.poly) - 540) < 5);
assert.ok(Math.abs(n.o.proxy.z1 - 12) < 0.01);

assert.equal(find(model, 'Z161').o.info.info, 'Описание изменено через custom.json.');

// анализ GLB: текстура в файле, сдвиг и поворот узла учтены
const a = analyzeGlb(files.find((f) => f.file === 'N1.glb').bytes);
const [nx, ny] = centroid(a.hull);
assert.ok(Math.hypot(nx + 305, ny - 905) < 0.5, 'центр нового здания — там, где его поставили в Blender');
assert.equal(analyzeGlb(files.find((f) => f.file === 'Z129.glb').bytes).images, 1);

// склейка GLB: целостность ссылок, текстура и узлы-обёртки на месте
const target = files.find((f) => f.file === 'N1.glb').bytes;
const { bytes } = mergeGlb(target, [{ bytes: files.find((f) => f.file === 'Z129.glb').bytes, nodeName: 'Z129 Корпус', parentName: 'нет такого слоя' }]);
const { json: J, bin } = parseGlb(bytes);
assert.equal(J.buffers.length, 1);
assert.equal(J.buffers[0].byteLength, bin.byteLength);
const lt = (k) => (J[k] || []).length;
for (const bv of J.bufferViews) assert.ok((bv.byteOffset || 0) + bv.byteLength <= bin.byteLength, 'bufferView в пределах буфера');
for (const ac of J.accessors) assert.ok(ac.bufferView < lt('bufferViews'));
for (const im of J.images || []) assert.ok(im.bufferView < lt('bufferViews'));
for (const t of J.textures || []) assert.ok(t.source < lt('images'));
for (const m of J.materials || []) if (m.pbrMetallicRoughness?.baseColorTexture) assert.ok(m.pbrMetallicRoughness.baseColorTexture.index < lt('textures'));
for (const me of J.meshes) for (const p of me.primitives) {
  for (const i of Object.values(p.attributes)) assert.ok(i < lt('accessors'));
  if (p.material != null) assert.ok(p.material < lt('materials'));
}
for (const nd of J.nodes) for (const c of nd.children || []) assert.ok(c < lt('nodes'));
assert.equal(lt('images'), 1);
assert.ok(J.nodes.some((nd) => nd.name === 'Z129 Корпус'));
// склеенный файл читается тем же разбором, что и исходные модели
assert.ok(analyzeGlb(bytes).hull.length >= 4);

console.log('OK: доработки custom/ — заменено', r.replaced.length, ', добавлено', r.added.length, ', удалено', r.removed.length, ', склейка GLB', (bytes.byteLength / 1024).toFixed(0), 'КБ');
