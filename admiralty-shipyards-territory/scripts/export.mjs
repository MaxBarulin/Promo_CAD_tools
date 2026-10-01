// Экспорт модели в файлы без браузера:
//   dist/admiralty-shipyards.glb           — 3D (glTF 2.0, бинарный): слои → объекты, материалы по палитре
//   dist/admiralty-shipyards-plan.dxf      — генплан DXF R12 (м, локальные координаты)
//   dist/admiralty-shipyards.geojson       — слои в WGS84
//   dist/admiralty-shipyards-registry.xlsx — реестр зданий и сооружений (шаблон для заполнения ЭПБ/ОПО)
// Запуск: npm run export [-- --full | --no-context]
//   по умолчанию рядовая городская застройка экспортируется упрощённо (объёмы без окон);
//   --full       — вся застройка с окнами (файл ~30 МБ);
//   --no-context — только верфь, мосты, вода и набережные.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getTerritory } from '../src/data/index.js';
import { initModel, buildModel, toObjectHierarchy } from '../src/model/index.js';
import { createMaterialFactory } from '../src/model/materials.js';
import { buildDXF } from '../src/export/dxf.js';
import { buildGeoJSON } from '../src/export/geojson.js';
import { registryItems } from '../src/registry/core.js';
import { registryXlsx } from '../src/registry/workbook.js';

// GLTFExporter в Node: минимальная замена FileReader на основе Blob.arrayBuffer().
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.();
      });
    }
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const noContext = process.argv.includes('--no-context');
const full = process.argv.includes('--full');

initModel(THREE);
const data = getTerritory();
if (noContext) data.buildings = data.buildings.filter((b) => b.kind !== 'context');
const model = buildModel(data, { frontage: !noContext, contextDetail: full ? 'auto' : 'low' });
const getMaterial = createMaterialFactory(THREE, { forExport: true });
await mkdir(dist, { recursive: true });

// GLB
const scene = new THREE.Scene();
scene.name = data.meta.title;
const hier = toObjectHierarchy(THREE, model, getMaterial);
scene.add(hier);
const glb = await new Promise((resolve, reject) =>
  new GLTFExporter().parse(scene, resolve, reject, {
    binary: true,
    includeCustomExtensions: false,
  }),
);
const glbPath = path.join(dist, noContext ? 'admiralty-shipyards-no-context.glb' : full ? 'admiralty-shipyards-full.glb' : 'admiralty-shipyards.glb');
await writeFile(glbPath, Buffer.from(glb));
console.log(`GLB:     ${path.relative(root, glbPath)}  ${(glb.byteLength / 1048576).toFixed(1)} МБ, объектов ${hier.children.reduce((s, g) => s + g.children.length, 0)}, треугольников ${model.stats.triangles}`);

if (!noContext && !full) {
  const dxf = buildDXF(data, model);
  await writeFile(path.join(dist, 'admiralty-shipyards-plan.dxf'), dxf);
  console.log(`DXF:     dist/admiralty-shipyards-plan.dxf  ${(dxf.length / 1048576).toFixed(1)} МБ`);
  const geo = JSON.stringify(buildGeoJSON(data, model));
  await writeFile(path.join(dist, 'admiralty-shipyards.geojson'), geo);
  console.log(`GeoJSON: dist/admiralty-shipyards.geojson  ${(geo.length / 1048576).toFixed(1)} МБ`);
  const items = registryItems(model, data);
  const xlsx = registryXlsx(items, {}, { years: 2 });
  await writeFile(path.join(dist, 'admiralty-shipyards-registry.xlsx'), xlsx);
  console.log(`Реестр:  dist/admiralty-shipyards-registry.xlsx  ${items.length} объектов (шаблон для заполнения ЭПБ/ОПО)`);
}
