// Проверка доработок из папки custom/ на моделях, выгруженных из Blender 4.5:
//   Z129.glb — корпус из выгрузки модели с UV-развёрткой и текстурой на кровле (замена);
//   N1.glb   — новое здание; custom.json — удаление двух построек и крана, новое описание Z161,
//   правка Z141 (высота, отделка, сдвиг, поворот) и новое здание N2 по размерам (box).
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getTerritory } from '../src/data/index.js';
import { initModel, buildModel, makeBuildingObject } from '../src/model/index.js';
import { prepareCustom, analyzeGlb, parseGlb, customIdFromFile, transformRing, placeModel, editBuilding, splitRing, newObjectInYard, modelBuilding, boxBuilding } from '../src/model/custom.js';
import { straighten } from '../src/model/straighten.js';
import { mergeGlb, placementTRS } from '../src/export/glb-merge.js';
import { centroid, area } from '../src/geo.js';
import { readCustomDir } from '../scripts/custom-files.mjs';
import { registryItems, rowsToRecords, minRect, COLUMNS, columnGroups } from '../src/registry/core.js';

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
assert.deepEqual([...r.added].sort(), ['N1', 'N2']);
assert.deepEqual([...r.removed].sort(), ['C2', 'GN1', 'GN2']);
assert.deepEqual([...r.edited].sort(), ['Z141', 'Z161']);
assert.deepEqual(r.warnings, []);

// удалённые — ни в модели, ни в данных (по ним строятся DXF и GeoJSON)
for (const id of ['C2', 'GN1', 'GN2']) assert.ok(!find(model, id), `${id} удалён из модели`);
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

// правка здания из данных: высота, отделка, сдвиг на (10, −5) м и поворот на 15°
const e0 = find(base, 'Z141').o;
const e1 = find(model, 'Z141').o;
assert.equal(e1.name, 'Заводоуправление (тест)');
assert.equal(e1.info.height, 30);
assert.equal(e1.info.approx, false);
const [ax, ay] = centroid(e0.proxy.poly);
const [bx2, by2] = centroid(e1.proxy.poly);
assert.ok(Math.hypot(bx2 - ax - 10, by2 - ay + 5) < 0.5, 'здание сдвинуто на (10, −5) м');
assert.ok(Math.abs(area(e1.proxy.poly) - area(e0.proxy.poly)) < 1, 'при повороте площадь не меняется');
assert.equal(data.buildings.find((b) => b.id === 'Z141').wall, 'brick');
// подразделения: пустые строки отброшены, роли и ответственные — в карточке и в реестре
assert.deepEqual(e1.info.units, [
  { name: 'Отдел главного механика', role: 'occupant', person: 'Иванов И. И.' },
  { name: 'Административно-хозяйственная служба', role: 'owner' },
]);
// загрузка таблицы: значения из списка принимаются в любом регистре, прочие пропускаются с пояснением
const problems = [];
const recs = rowsToRecords([['Код в модели', 'Техническое состояние', 'Класс ОПО', 'Год постройки', 'Дата обследования'], ['Z141', 'хорошее', 'iv', '1890', '31.02.2025'], ['Z161', 'Аварийное', 'не опо', '2900', '']], problems);
assert.deepEqual(recs.Z141, { opo: 'IV', year: 1890 });
assert.deepEqual(recs.Z161, { state: 'аварийное', opo: 'не ОПО' });
assert.deepEqual(problems.map((p) => `${p.id}:${p.label}`), ['Z141:Техническое состояние', 'Z141:Дата обследования', 'Z161:Год постройки']);
// строка групп над шапкой (как в выгрузке) и обозначения «да/нет» в полях-признаках
const recs2 = rowsToRecords([['Здание', '', 'ОПО'], ['Наименование', 'ОПО: краны', 'Консервация', 'Код в модели'], ['Цех', '+', 'Нет', 'Z141']]);
assert.deepEqual(recs2.Z141, { opoCrane: 'да', conserved: 'нет' });
const reg = registryItems(model, data).find((i) => i.id === 'Z141');
assert.equal(reg.occupants, 'Отдел главного механика (Иванов И. И.)');
assert.equal(reg.owners, 'Административно-хозяйственная служба');
assert.ok(reg.length > reg.width && reg.width > 0, 'габариты по контуру');
// код в модели — последний столбец, группы идут подряд
assert.equal(COLUMNS[COLUMNS.length - 1].key, 'id');
assert.deepEqual(columnGroups().map((g) => g.label), ['Здание', 'Промэкспертиза', 'ОПО', 'Состояние', 'Размеры по модели', 'Размещение', 'Модель']);
// наименьший прямоугольник: повёрнутый 40 × 20 и Г-образный контур
const turn = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
assert.deepEqual(minRect([[0, 0], [40, 0], [40, 20], [0, 20]].map((p) => turn(p, 0.6))), [40, 20]);
assert.deepEqual(minRect([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), [30, 25]);

// к чему относится новый объект: явно, по слою (судно на воде — всё равно верфь), иначе по месту
assert.equal(newObjectInYard({ layer: 'vessels' }, false), true);
assert.equal(newObjectInYard({ layer: 'production' }, false), true);
assert.equal(newObjectInYard({ layer: 'vessels', scope: 'city' }, false), false);
assert.equal(newObjectInYard({ scope: 'yard' }, false), true);
assert.equal(newObjectInYard({ layer: 'context' }, true), false);
assert.equal(newObjectInYard({}, true), true);
assert.equal(newObjectInYard({}, false), false);
// новое здание коробкой: остекление и низ окон из формы применяются (ленточные окна ночью светятся)
{
  const nb = boxBuilding('N8', { type: 'hall', glazing: 'ribbon', sill: 1.5, box: { x: 0, y: 0, length: 30, width: 18 } }, { inYard: () => true, zoneOf: () => null });
  assert.equal(nb.glazing, 'ribbon');
  assert.equal(nb.sill, 1.5);
  assert.equal(boxBuilding('N8', { glazing: 'nope', box: {} }, { inYard: () => true, zoneOf: () => null }).glazing, undefined);
}
assert.equal(modelBuilding('N9', { hull: [[0, 0], [10, 0], [10, 5], [0, 5]], z0: 0, z1: 6 }, { layer: 'vessels' }, { inYard: () => false, zoneOf: () => null }).kind, 'shipyard');
{
  // модель судна, добавленная в слой «Суда и плавдоки», в сборке — объект верфи
  const n1 = files.find((f) => f.file === 'N1.glb');
  const c2 = prepareCustom({ buildings: { N9: { name: 'Судно (проверка)', layer: 'vessels' } } }, [{ file: 'N9.glb', bytes: n1.bytes }]);
  const m2 = buildModel(getTerritory(), { contextDetail: 'low', custom: c2 });
  const v = find(m2, 'N9');
  assert.equal(v.layer, 'vessels');
  assert.equal(v.o.scope, 'yard');
  assert.equal(v.o.info.kind, 'vessel');
}

// новое здание по размерам: 12 × 6 м, тип и высота из записи
const n2 = find(model, 'N2');
assert.equal(n2.layer, 'shipyard');
assert.equal(n2.o.info.type, 'utility');
assert.ok(Math.abs(area(n2.o.proxy.poly) - 72) < 0.5);
assert.ok(n2.o.sink.triangleCount() > 0, 'у нового здания есть геометрия');
assert.ok(Math.hypot(centroid(n2.o.proxy.poly)[0] + 450, centroid(n2.o.proxy.poly)[1] - 260) < 0.1);

// форма кровли и источник уточнения: сводчатая над прямоугольником, вальмовая — скатами по сложному контуру
const src = getTerritory().buildings;
const bke = makeBuildingObject(editBuilding(src.find((b) => b.id === 'Z136'), { roof: 'barrel', height: 23.5, roofH: 8, src: 'по фото' }));
assert.equal(bke.info.roof, 'barrel');
assert.equal(bke.info.height, 31.5, 'высота до верха свода');
assert.equal(bke.info.refined, 'по фото');
// Z160 имеет пристройки (parts): для проверки кровли берём только основной контур
const bar0 = { ...src.find((b) => b.id === 'Z160'), parts: undefined, partsCustom: undefined, holes: undefined };
assert.ok(bar0.poly.length > 4, 'контур Z160 — не прямоугольник');
const bar = makeBuildingObject(editBuilding(bar0, { roof: 'hip', roofH: 4 }));
assert.equal(bar.info.roof, 'hip');
const roofTris = bar.sink.bufs.get(bar0.roof.color || 'r_gray');
let roofArea = 0;
for (let i = 0; i < roofTris.idx.length; i += 3) {
  const P = [0, 1, 2].map((j) => roofTris.idx[i + j] * 3).map((k) => [roofTris.pos[k], -roofTris.pos[k + 2], roofTris.pos[k + 1]]);
  roofArea += ((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])) / 2;
  assert.ok(Math.max(...P.map((q) => q[2])) <= bar0.h + 4 + 1e-6, 'скаты не выше конька');
}
assert.ok(Math.abs(roofArea - area(bar0.poly)) < 1, 'кровля закрывает весь контур, все скаты смотрят вверх');

// части разной этажности: разрез по линии, у каждой части свои этажи и высота
const L = [[0, 0], [60, 0], [60, 15], [15, 15], [15, 50], [0, 50]];
const halves = splitRing(L, [0, 20], [15, 20]);
assert.deepEqual(halves.map((h) => Math.round(area(h))).sort((x, y) => x - y), [450, 975], 'режется только крыло, через которое проведена линия');
const z197 = src.find((b) => b.id === 'Z197');
const [cx197, cy197] = centroid(z197.poly);
const cut = splitRing(z197.poly, [cx197 - 2, cy197 - 40], [cx197 + 2, cy197 + 40]);
const parted = makeBuildingObject(editBuilding(z197, { parts: [{ poly: cut[0] }, { poly: cut[1], floors: 2, height: 7 }] }));
assert.equal(parted.info.floorsText, `2–${z197.floors}`);
assert.ok(Math.abs(parted.info.footprint - Math.round(area(z197.poly))) <= 1, 'площадь застройки — по всему контуру');
// башня: части только «сверху» — основной объём остаётся
const tower = makeBuildingObject(editBuilding(z197, { parts: [{ circle: { x: cx197, y: cy197, r: 3 }, height: 30, roof: 'flat' }] }));
assert.equal(tower.info.height, 30);
assert.ok(tower.sink.triangleCount() > makeBuildingObject(z197).sink.triangleCount() * 0.8, 'основной объём здания на месте');
// новое здание по контуру poly (без box)
const byPoly = buildModel(getTerritory(), { contextDetail: 'low', custom: prepareCustom({ buildings: { N9: { name: 'По контуру', type: 'office', floors: 2, height: 8, poly: [[-450, 250], [-430, 250], [-430, 265], [-450, 265]] } } }, []) });
const n9 = find(byPoly, 'N9');
assert.ok(n9 && Math.abs(area(n9.o.proxy.poly) - 300) < 0.5, 'новое здание по контуру');
assert.deepEqual(byPoly.custom.added, ['N9']);

// выпрямление стен: дрожащий прямоугольник становится прямоугольником
const wobbly = [[0, 0], [20, 0.4], [40, -0.3], [60, 0.2], [60.4, 20], [30, 19.6], [0.3, 20.2]];
const st = straighten(wobbly);
assert.equal(st.length, 4);
assert.ok(Math.abs(area(st) - 1200) < 25);

// сдвиг и поворот прочих объектов: дымовая труба и кран — в модели и в данных (DXF, GeoJSON)
const dataM = getTerritory();
const ch0 = dataM.chimneys.find((c) => c.id === 'CH1').at;
const a10 = dataM.cranes.find((c) => c.id === 'C10').slew;
const moved = buildModel(dataM, { contextDetail: 'low', custom: prepareCustom({ buildings: { CH1: { move: [10, 5] }, C10: { rotate: 30 } } }, []) });
const chObj = find(moved, 'CH1').o;
const [mx, my] = centroid(chObj.proxy.poly);
assert.ok(Math.hypot(mx - ch0[0] - 10, my - ch0[1] - 5) < 0.01, 'труба сдвинута');
assert.ok(Math.hypot(dataM.chimneys.find((c) => c.id === 'CH1').at[0] - ch0[0] - 10, dataM.chimneys.find((c) => c.id === 'CH1').at[1] - ch0[1] - 5) < 0.01, 'и в данных');
assert.ok(Math.abs(dataM.cranes.find((c) => c.id === 'C10').slew - a10 - 30) < 1e-9, 'кран повёрнут');
assert.equal(getTerritory().cranes.find((c) => c.id === 'C10').slew, a10, 'исходные данные не меняются');
assert.deepEqual(moved.custom.warnings, []);

// стена двора с аркой — часть здания: строится вместе с ним, выбирается по своему контуру
{
  const base = getTerritory().buildings.find((b) => b.id === 'Z197');
  const withWall = editBuilding(base, { walls: [{ line: [[-183.3, -40.1], [-200, -49.1]], h: 3.5, arch: { w: 3.6, h: 4.2 } }], move: [5, 0] });
  assert.equal(withWall.walls.length, 1);
  assert.ok(Math.abs(withWall.walls[0].line[0][0] - -178.3) < 1e-6, 'стена сдвигается вместе со зданием');
  const o = makeBuildingObject(withWall);
  assert.equal(o.proxy.extra.length, 1);
  assert.ok(o.proxy.extra[0].z1 > 5, 'над аркой — аттик');
  assert.ok(o.sink.triangleCount() > makeBuildingObject(editBuilding(base, { move: [5, 0] })).sink.triangleCount());
  // глухое здание: без окон треугольников меньше
  const plain = getTerritory().buildings.find((b) => b.id === 'Z195');
  assert.ok(makeBuildingObject(editBuilding(plain, { windows: false })).sink.triangleCount() < makeBuildingObject(plain).sink.triangleCount());
}

// подъём и опускание (lift): здание, кран и модель — вместе с контуром выбора
{
  const lifted = buildModel(getTerritory(), { contextDetail: 'low', custom: prepareCustom({ buildings: { Z195: { lift: 4 }, C10: { lift: -1.5 } } }, []) });
  assert.equal(find(lifted, 'Z195').o.proxy.z0, 4);
  assert.equal(find(lifted, 'C10').o.proxy.z0, -1.5);
  const minY = (o) => Math.min(...[...o.sink.bufs.values()].flatMap((b) => b.pos.filter((_, i) => i % 3 === 1)));
  assert.ok(minY(find(lifted, 'Z195').o) > 3.9, 'здание поднято целиком');
  assert.ok(Math.abs(placeModel({ hull: [[0, 0], [1, 0], [1, 1]], z0: 0, z1: 5 }, { lift: 2 }).transform.lift - 2) < 1e-9);
}

// масштаб (scale): здание — контур и высота, кран — геометрия и контур выбора, модель — преобразование
{
  const base0 = getTerritory().buildings.find((b) => b.id === 'Z195');
  const big = editBuilding(base0, { scale: 1.5 });
  assert.ok(Math.abs(area(big.poly) / area(base0.poly) - 2.25) < 0.05, 'площадь ×1,5²');
  assert.ok(Math.abs(big.h / base0.h - 1.5) < 1e-9, 'высота ×1,5');
  const [bx0, by0] = centroid(base0.poly);
  const [bx1, by1] = centroid(big.poly);
  assert.ok(Math.hypot(bx1 - bx0, by1 - by0) < 0.5, 'центр на месте');
  const sc = buildModel(getTerritory(), { contextDetail: 'low', custom: prepareCustom({ buildings: { C10: { scale: 2 } } }, []) });
  const c0 = find(buildModel(getTerritory(), { contextDetail: 'low' }), 'C10').o;
  assert.ok(Math.abs(find(sc, 'C10').o.proxy.z1 - c0.proxy.z1 * 2) < 1e-9);
  const pm = placeModel({ hull: [[0, 0], [2, 0], [2, 2], [0, 2]], z0: 0, z1: 5 }, { scale: 2 });
  assert.equal(pm.transform.scale, 2);
  assert.ok(Math.abs(area(pm.hull) - 16) < 1e-9 && pm.z1 === 10);
  // GLB: узел T·R·S оставляет центр модели на месте
  const t = placementTRS({ pivot: [1, 1], move: [0, 0], rotate: 30, scale: 2 });
  const a = (30 * Math.PI) / 180;
  const P = [1, 0, -1];
  const rx = (x, z) => [x * Math.cos(a) + z * Math.sin(a), -x * Math.sin(a) + z * Math.cos(a)];
  const [px, pz] = rx(P[0] * 2, P[2] * 2);
  assert.ok(Math.hypot(px + t.translation[0] - 1, pz + t.translation[2] + 1) < 1e-9, 'центр модели не уходит при масштабе');
}

// поворот вокруг центра: точка (1, 0) от центра на 90° → (0, 1)
const t = transformRing([[11, 5]], [10, 5], [2, 3], 90)[0];
assert.ok(Math.hypot(t[0] - 12, t[1] - 9) < 1e-9);
// сдвиг и поворот модели из Blender: узел glTF даёт ту же точку, что и контур на плане
const pm = placeModel({ hull: [[0, 0], [10, 0], [10, 4], [0, 4]], z0: 0, z1: 5 }, { move: [100, -50], rotate: 30 });
const trs = placementTRS(pm.transform);
const q = trs.rotation;
const rot = (v) => {
  // поворот вектора кватернионом (вокруг Y)
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
};
const g = rot([10, 0, -4]);
const gx = g[0] + trs.translation[0];
const gz = g[2] + trs.translation[2];
const expect = transformRing([[10, 4]], pm.transform.pivot, [100, -50], 30)[0];
assert.ok(Math.hypot(gx - expect[0], -gz - expect[1]) < 1e-6, 'узел glTF и контур на плане совпадают');

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
