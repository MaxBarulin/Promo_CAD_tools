// Доработки модели вручную (папка custom/): замена объекта моделью из Blender,
// удаление объектов, новые здания. Не зависит от окружения (браузер или Node).
//
//   custom/<код>.glb   — модель одного объекта; если код есть в модели — замена,
//                        если нет — новое здание
//   custom/custom.json — { "remove": [коды], "buildings": { код: { name, type, info, floors, layer } } }

import { pointInRing, centroid, ensureCCW } from '../geo.js';

// Код объекта по имени файла: «Z129.glb», «Z129 Корпусосборочный цех.glb» → Z129
export const customIdFromFile = (file) => file.replace(/\.glb$/i, '').trim().split(/\s+/)[0];

export const BUILDING_TYPES = ['hall', 'elling', 'elling_historic', 'warehouse', 'office', 'checkpoint', 'utility', 'historic'];

// ---------- разбор GLB ----------

export function parseGlb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('это не файл GLB (glTF binary)');
  if (dv.getUint32(4, true) !== 2) throw new Error('нужен glTF 2.0');
  let json = null;
  let bin = null;
  for (let off = 12; off + 8 <= bytes.byteLength; ) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const chunk = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('в GLB нет описания сцены');
  return { json, bin };
}

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

// Точки сетки в мировых координатах glTF (Y вверх). Для сжатой геометрии (Draco, meshopt)
// вершины недоступны — тогда берутся углы габарита из min/max.
function worldPoints({ json, bin }, warnings) {
  const pts = [];
  const read = (accIdx, m) => {
    const acc = json.accessors[accIdx];
    const bv = acc.bufferView != null ? json.bufferViews[acc.bufferView] : null;
    const push = (x, y, z) => pts.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
    if (bv && bin && acc.componentType === 5126 && !acc.sparse && (bv.buffer ?? 0) === 0) {
      const stride = bv.byteStride || 12;
      const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
      const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      for (let i = 0; i < acc.count; i++) {
        const o = base + i * stride;
        push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
      }
    } else if (acc.min && acc.max) {
      for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) push(x, y, z);
      warnings.push('вершины не прочитаны (сжатая геометрия?) — контур взят по габариту');
    }
  };
  const visit = (i, parent) => {
    const n = json.nodes[i];
    const m = mul4(parent, nodeMatrix(n));
    if (n.mesh != null) for (const p of json.meshes[n.mesh].primitives) if (p.attributes.POSITION != null) read(p.attributes.POSITION, m);
    for (const c of n.children || []) visit(c, m);
  };
  const sc = json.scenes?.[json.scene ?? 0];
  for (const i of sc ? sc.nodes : (json.nodes || []).map((_, k) => k)) visit(i, ident());
  return pts;
}

function convexHull(points) {
  const p = [...new Map(points.map((q) => [`${q[0].toFixed(2)},${q[1].toFixed(2)}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Контур на плане (выпуклая оболочка) и отметки низа и верха объекта в координатах модели
// (x — восток, y — север): three/glTF (X, Y вверх, Z) → модель (X, −Z), высота Y.
export function analyzeGlb(bytes) {
  const warnings = [];
  const glb = parseGlb(bytes);
  if ((glb.json.extensionsRequired || []).length) warnings.push(`нужны расширения ${glb.json.extensionsRequired.join(', ')} — при экспорте из Blender отключите сжатие`);
  const pts = worldPoints(glb, warnings);
  if (pts.length < 3) throw new Error('в файле нет геометрии');
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const q of pts) {
    z0 = Math.min(z0, q[1]);
    z1 = Math.max(z1, q[1]);
  }
  const hull = ensureCCW(convexHull(pts.map((q) => [q[0], -q[2]])));
  return { hull, z0, z1, warnings, images: (glb.json.images || []).length };
}

// ---------- подготовка набора доработок ----------

// config — содержимое custom.json; files — [{ file, bytes }]. Возвращает набор для buildModel.
export function prepareCustom(config = {}, files = []) {
  const warnings = [];
  const models = {};
  for (const f of files) {
    const id = customIdFromFile(f.file);
    if (models[id]) {
      warnings.push(`${f.file}: для кода ${id} уже есть файл ${models[id].file} — этот пропущен`);
      continue;
    }
    try {
      const a = analyzeGlb(f.bytes);
      models[id] = { file: f.file, hull: a.hull, z0: a.z0, z1: a.z1, images: a.images };
      for (const w of a.warnings) warnings.push(`${f.file}: ${w}`);
    } catch (e) {
      warnings.push(`${f.file}: ${e.message} — файл пропущен`);
    }
  }
  const meta = config.buildings || {};
  for (const [id, m] of Object.entries(meta)) if (m.type && !BUILDING_TYPES.includes(m.type)) warnings.push(`custom.json, ${id}: неизвестный тип «${m.type}» (допустимы ${BUILDING_TYPES.join(', ')})`);
  return { remove: new Set(config.remove || []), meta, models, warnings };
}

// Удаление из исходных данных (до сборки): так удалённое пропадает и из DXF/GeoJSON.
const DATA_KEYS = ['buildings', 'cranes', 'ships', 'docks', 'slipways', 'bridges', 'chimneys', 'arches', 'fences'];
// Возвращает коды, которые нашлись в данных.
export function removeFromData(data, remove) {
  const found = new Set();
  if (!remove.size) return found;
  for (const k of DATA_KEYS) {
    if (!Array.isArray(data[k])) continue;
    data[k] = data[k].filter((o) => {
      if (!remove.has(o.id)) return true;
      found.add(o.id);
      return false;
    });
  }
  // суда на удалённых стапелях и доках уходят вместе с ними
  if (Array.isArray(data.ships)) data.ships = data.ships.filter((s) => !(s.onSlip && remove.has(s.onSlip)) && !(s.onDock && remove.has(s.onDock)));
  return found;
}

// После сборки: замена, новые здания, переименование, отчёт.
// ctx: { layers, signs, data, removedFromData, inYard(p), summary(b), Sink }
export function applyCustom(custom, ctx) {
  const { layers, data, inYard, summary, Sink } = ctx;
  const report = { replaced: [], added: [], removed: [], renamed: [], warnings: [...custom.warnings] };
  const all = new Map();
  for (const l of Object.values(layers)) for (const o of l.objects) all.set(o.id, { o, layer: l });

  // объекты, созданные при сборке (автоматическая ограда, застройка-заполнитель)
  for (const id of custom.remove) {
    const hit = all.get(id);
    if (hit) {
      hit.layer.objects = hit.layer.objects.filter((o) => o !== hit.o);
      all.delete(id);
      report.removed.push(id);
    } else if (ctx.removedFromData.has(id)) report.removed.push(id);
    else report.warnings.push(`custom.json, remove: объекта с кодом ${id} нет в модели`);
  }

  const zoneOf = (p) => (data.zones || []).find((z) => pointInRing(p, z.polygon))?.id;
  const proxyOf = (m) => ({ poly: m.hull, z0: m.z0, z1: m.z1 });

  for (const [id, m] of Object.entries(custom.models)) {
    const meta = custom.meta[id] || {};
    const hit = all.get(id);
    if (custom.remove.has(id)) {
      report.warnings.push(`${m.file}: код ${id} одновременно в списке удаления — модель не подставлена`);
      continue;
    }
    if (hit) {
      // замена: своя геометрия из GLB, сведения об объекте сохраняются
      const o = hit.o;
      o.sink = new Sink();
      o.custom = m.file;
      o.proxy = proxyOf(m);
      if (o.info) {
        const h = +(m.z1 - Math.max(0, m.z0)).toFixed(1);
        o.info = { ...o.info, height: h, geomSrc: 'custom' };
        if (o.info.footprint) o.info.volume = Math.round(o.info.footprint * h);
      }
      report.replaced.push(id);
    } else {
      // новое здание
      const c = centroid(m.hull);
      const yard = inYard(c);
      const b = {
        id,
        name: meta.name || `Новое здание ${id}`,
        info: meta.info || '',
        kind: yard ? 'shipyard' : 'context',
        type: meta.type || 'utility',
        floors: meta.floors,
        zone: zoneOf(c),
        poly: m.hull,
        h: Math.max(1, m.z1 - Math.max(0, m.z0)),
        geomSrc: 'custom',
      };
      const layerId = meta.layer && layers[meta.layer] ? meta.layer : yard ? 'shipyard' : 'context';
      const obj = { id, name: b.name, sink: new Sink(), custom: m.file, info: { ...summary(b), kind: layerId === 'shipyard' ? 'building' : 'context' }, proxy: proxyOf(m) };
      obj.scope = layerId === 'shipyard' || yard ? 'yard' : 'city';
      layers[layerId].objects.push(obj);
      all.set(id, { o: obj, layer: layers[layerId] });
      report.added.push(id);
    }
  }

  // переименование и описание без замены геометрии
  for (const [id, meta] of Object.entries(custom.meta)) {
    const hit = all.get(id);
    if (!hit) {
      if (!custom.models[id] && !custom.remove.has(id)) report.warnings.push(`custom.json: объекта с кодом ${id} нет в модели и нет файла ${id}.glb`);
      continue;
    }
    if (report.added.includes(id)) continue;
    const o = hit.o;
    if (meta.name) o.name = meta.name;
    if (o.info) {
      if (meta.name) o.info = { ...o.info, name: meta.name };
      if (meta.info) o.info = { ...o.info, info: meta.info };
      if (meta.type) o.info = { ...o.info, type: meta.type };
      if (meta.floors) o.info = { ...o.info, floors: meta.floors, floorsEst: meta.floors, floorsKnown: true, totalArea: o.info.footprint ? o.info.footprint * meta.floors : o.info.totalArea };
    }
    if (meta.name || meta.info || meta.type || meta.floors) report.renamed.push(id);
  }

  // вывески заменённых зданий (их рисует сама модель из Blender)
  ctx.signs.splice(0, ctx.signs.length, ...ctx.signs.filter((s) => !custom.models[s.id]));
  return report;
}
