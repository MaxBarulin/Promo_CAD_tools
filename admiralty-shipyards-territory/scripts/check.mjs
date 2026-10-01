// Проверка данных и сборки модели: пересечения зданий, здания в воде, статистика.
// Запуск: npm run check

import * as THREE from 'three';
import pc from 'polygon-clipping';
import { getTerritory } from '../src/data/index.js';
import { initModel, buildModel } from '../src/model/index.js';
import { prepareCustom } from '../src/model/custom.js';
import { readCustomDir } from './custom-files.mjs';
import { mpArea } from '../src/model/planar.js';
import { ensureCCW, area } from '../src/geo.js';

initModel(THREE);
const data = getTerritory();
const customDir = await readCustomDir();
const model = buildModel(data, { custom: prepareCustom(customDir.config, customDir.files) });
const P = model.planar;

let problems = 0;
const notes = [];
const warn = (msg) => {
  problems++;
  console.log('  ⚠ ' + msg);
};

console.log('Площади:');
for (const z of new Map(data.zones.map((zz) => [zz.id, zz])).values()) console.log(`  ${z.name.padEnd(32)} ${(mpArea(P.zones[z.id]) / 1e4).toFixed(1)} га`);
console.log(`  Территория верфи (итого)          ${(mpArea(P.shipyardMP) / 1e4).toFixed(1)} га`);

console.log('\nПроверка зданий:');
const all = model.layers.flatMap((l) => l.objects).filter((o) => o.proxy && o.proxy.poly && (o.info?.kind === 'building' || o.info?.kind === 'context'));
const polys = all.map((o) => {
  const ring = ensureCCW(o.proxy.poly).map((p) => [p[0], p[1]]);
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return { o, mp: [[ring]], bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
const bbHit = (a, b) => a.bb[0] <= b.bb[2] && a.bb[2] >= b.bb[0] && a.bb[1] <= b.bb[3] && a.bb[3] >= b.bb[1];
for (const { o, mp } of polys) {
  // контуры из открытых данных принимаются как есть; проверяем постройки, нарисованные по карте предприятия
  if (o.generated || (o.info?.geomSrc && o.info.geomSrc !== 'map')) continue;
  const wet = mpArea(pc.intersection(mp, P.water));
  if (wet > 2) warn(`${o.id} «${o.name}» заходит в воду на ${wet.toFixed(0)} м²`);
  const road = mpArea(pc.intersection(mp, P.carriageways));
  if (road > 2) warn(`${o.id} «${o.name}» пересекает проезжую часть на ${road.toFixed(0)} м²`);
  // проезды — из OpenStreetMap, часть корпусов — с карты предприятия: мелкие расхождения источников
  const iroad = mpArea(pc.intersection(mp, P.internal));
  if (iroad > 0.15 * area(mp[0][0])) warn(`${o.id} «${o.name}» пересекает внутризаводской проезд на ${iroad.toFixed(0)} м²`);
}
for (let i = 0; i < polys.length; i++) {
  for (let j = i + 1; j < polys.length; j++) {
    const a = polys[i];
    const b = polys[j];
    if ((a.o.generated && b.o.generated) || !bbHit(a, b)) continue;
    const inter = pc.intersection(a.mp, b.mp);
    const ov = mpArea(inter);
    // полоска вдоль общей стены (средняя толщина 2S/P меньше 0,3 м) — касание, не наложение
    const perim = inter.reduce((s, P) => s + P.reduce((t, r) => t + r.slice(1).reduce((u, p, i) => u + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0), 0), 0);
    if (perim && (2 * ov) / perim < 0.3) continue;
    // пристройки примыкают к корпусам общей стеной — допустимо только касание: здания верфи из
    // разных источников (карта предприятия и космоснимок), заходящие друг в друга, — ошибка
    const tol = a.o.info?.kind === 'building' && b.o.info?.kind === 'building' ? 2 : /^[ZY]/.test(a.o.id) && /^[ZY]/.test(b.o.id) ? 30 : 1;
    if (ov <= tol) continue;
    const msg = `${a.o.id} «${a.o.name}» и ${b.o.id} «${b.o.name}» пересекаются (${ov.toFixed(0)} м²)`;
    // у моделей из custom/ контур — выпуклая оболочка: пересечение — повод проверить, не ошибка
    if (a.o.custom || b.o.custom) notes.push(msg);
    else warn(msg);
  }
}
// кровля не должна выходить за контур здания (ломаный отступ парапета, самопересечения контура)
const segD = (p, a, c) => {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
const inRing = (p, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
};
for (const { o } of polys) {
  // у зданий из частей (башни, пристройки) части могут выходить за основной контур
  if (o.info?.kind !== 'building' || o.custom || o.info.parts) continue;
  const r = o.proxy.poly;
  let out = 0;
  for (const [key, b] of o.sink.bufs) {
    if (!key.startsWith('r_')) continue;
    for (let i = 0; i < b.idx.length; i += 3) {
      const P3 = [0, 1, 2].map((j) => b.idx[i + j] * 3).map((k) => [b.pos[k], -b.pos[k + 2]]);
      const m = [(P3[0][0] + P3[1][0] + P3[2][0]) / 3, (P3[0][1] + P3[1][1] + P3[2][1]) / 3];
      if (!inRing(m, r) && Math.min(...r.map((a, k) => segD(m, a, r[(k + 1) % r.length]))) > 1) out++;
    }
  }
  if (out) warn(`${o.id} «${o.name}»: кровля выходит за контур (${out} треуг.)`);
}
if (!problems) console.log('  ✓ замечаний нет');

const cr = model.custom;
if (cr && (cr.replaced.length || cr.added.length || cr.removed.length || cr.edited.length || cr.warnings.length)) {
  console.log('\nДоработки (папка custom/):');
  const list = (title, ids) => ids.length && console.log(`  ${title.padEnd(16)} ${ids.join(', ')}`);
  list('заменены:', cr.replaced);
  list('добавлены:', cr.added);
  list('удалены:', cr.removed);
  list('изменены:', cr.edited);
  for (const w of cr.warnings) warn(w);
  for (const n of notes) console.log('  · ' + n);
}

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
