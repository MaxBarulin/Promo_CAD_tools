// Проверка данных и сборки модели: пересечения зданий, здания в воде, статистика.
// Запуск: npm run check

import * as THREE from 'three';
import pc from 'polygon-clipping';
import { getTerritory } from '../src/data/index.js';
import { initModel, buildModel } from '../src/model/index.js';
import { mpArea } from '../src/model/planar.js';
import { ensureCCW, area } from '../src/geo.js';

initModel(THREE);
const data = getTerritory();
const model = buildModel(data);
const P = model.planar;

let problems = 0;
const warn = (msg) => {
  problems++;
  console.log('  ⚠ ' + msg);
};

console.log('Площади:');
for (const z of data.zones) console.log(`  ${z.name.padEnd(32)} ${(mpArea(P.zones[z.id]) / 1e4).toFixed(1)} га`);
console.log(`  Территория верфи (итого)          ${(mpArea(P.shipyardMP) / 1e4).toFixed(1)} га`);

console.log('\nПроверка зданий:');
const all = model.layers.flatMap((l) => l.objects).filter((o) => o.proxy && o.proxy.poly && (o.info?.kind === 'building' || o.info?.kind === 'context'));
const polys = all.map((o) => ({ o, mp: [[ensureCCW(o.proxy.poly).map((p) => [p[0], p[1]])]] }));
for (const { o, mp } of polys) {
  const wet = mpArea(pc.intersection(mp, P.water));
  if (wet > 2) warn(`${o.id} «${o.name}» заходит в воду на ${wet.toFixed(0)} м²`);
  const road = mpArea(pc.intersection(mp, P.carriageways));
  if (road > 2) warn(`${o.id} «${o.name}» пересекает проезжую часть на ${road.toFixed(0)} м²`);
  const iroad = mpArea(pc.intersection(mp, P.internal));
  if (iroad > 2 && !o.generated) warn(`${o.id} «${o.name}» пересекает внутризаводской проезд на ${iroad.toFixed(0)} м²`);
}
for (let i = 0; i < polys.length; i++) {
  for (let j = i + 1; j < polys.length; j++) {
    const a = polys[i];
    const b = polys[j];
    if (a.o.generated && b.o.generated) continue;
    const ov = mpArea(pc.intersection(a.mp, b.mp));
    // пристройки на карте примыкают к корпусам общей стеной — небольшое касание допустимо
    const tol = a.o.id.startsWith('Z') && b.o.id.startsWith('Z') ? 25 : 1;
    if (ov > tol) warn(`${a.o.id} «${a.o.name}» и ${b.o.id} «${b.o.name}» пересекаются (${ov.toFixed(0)} м²)`);
  }
}
if (!problems) console.log('  ✓ замечаний нет');

console.log('\nСтатистика модели:');
for (const l of model.layers) {
  let t = 0;
  for (const o of l.objects) t += o.sink.triangleCount();
  console.log(`  ${l.name.padEnd(32)} объектов ${String(l.objects.length).padStart(4)}   треугольников ${String(t).padStart(8)}`);
}
console.log(`  Всего треугольников: ${model.stats.triangles}; зданий: ${model.stats.buildings} (сгенерировано ${model.generatedCount}); время сборки ${model.stats.ms} мс`);
const footprint = all.filter((o) => o.info.kind === 'building').reduce((s, o) => s + area(o.proxy.poly), 0);
console.log(`  Площадь застройки верфи: ${(footprint / 1e4).toFixed(2)} га`);
process.exitCode = problems ? 1 : 0;
