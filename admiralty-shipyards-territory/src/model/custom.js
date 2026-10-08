// Доработки модели вручную (папка custom/): замена объекта моделью из Blender,
// удаление объектов, новые здания. Не зависит от окружения (браузер или Node).
//
//   custom/<код>.glb   — модель одного объекта; если код есть в модели — замена,
//                        если нет — новое здание
//   custom/custom.json — { "remove": [коды], "buildings": { код: запись } }
//
// Запись здания: name, type, info, floors — сведения; height (м) и wall (отделка фасада) —
// для зданий, построенных по данным; move [dx, dy] (м) и rotate (°, против часовой стрелки) —
// сдвиг и поворот вокруг центра контура; box { x, y, length, width, angle } — новое здание
// без модели (коробка с кровлей и проёмами по типу); units — подразделения: [{ name, role, person }],
// role: 'occupant' — размещается в здании, 'owner' — отвечает за здание (здание может пустовать);
// roof — форма кровли (ROOF_TYPES), roofH — её высота (м); src — откуда уточнено (по фото, по документам).
// Эти же записи создаёт редактор на сайте.

import { pointInRing, centroid, ensureCCW, rect, area } from '../geo.js';
import { decorate, minRect } from '../data/decorate.js';

// Код объекта по имени файла: «Z129.glb», «Z129 Корпусосборочный цех.glb» → Z129
export const customIdFromFile = (file) => file.replace(/\.glb$/i, '').trim().split(/\s+/)[0];

export const BUILDING_TYPES = ['hall', 'elling', 'elling_historic', 'warehouse', 'office', 'checkpoint', 'utility', 'historic', 'foreign'];

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

// ---------- правка зданий ----------

// Отделка новых зданий по типу (ключи палитры materials.js)
export const DEFAULT_FINISH = {
  hall: { wall: 'blue_gray', roof: 'r_light' },
  elling: { wall: 'blue', roof: 'r_gray' },
  elling_historic: { wall: 'brick', roof: 'r_rust' },
  warehouse: { wall: 'light', roof: 'r_light' },
  office: { wall: 'white', roof: 'r_dark' },
  checkpoint: { wall: 'white', roof: 'r_dark' },
  utility: { wall: 'gray', roof: 'r_bitumen' },
  historic: { wall: 'yellow', roof: 'r_rust' },
  foreign: { wall: 'gray', roof: 'r_gray' },
};
// Формы кровли: двускатная, вальмовая, сводчатая и односкатная — для прямоугольного контура
export const ROOF_TYPES = { flat: 'Плоская', gable: 'Двускатная', hip: 'Вальмовая', barrel: 'Сводчатая', shed: 'Односкатная', pyramid: 'Шатровая', multigable: 'Многопролётная', dome: 'Купол' };
// Покрытие кровли
export const ROOF_COLORS = ['r_gray', 'r_light', 'r_dark', 'r_bitumen', 'r_blue', 'r_green', 'r_rust', 'r_copper'];
// Отделка фасада, доступная в редакторе
export const WALLS = ['light', 'white', 'gray', 'panel', 'blue_gray', 'blue', 'brick', 'brick_dark', 'cream', 'yellow', 'ochre', 'sand', 'pink', 'terracotta', 'green', 'blue_stucco', 'mint', 'green_dark', 'red'];
// остекление фасада: сплошное в сетку (цеха 1960-х) или ленточные окна по этажам
export const GLAZING = { grid: 'сплошное в сетку', ribbon: 'ленточные окна', floors: 'окна по этажам' };

const has = (v) => v !== undefined && v !== null && v !== '';
const DEG = Math.PI / 180;

// Подразделения: только строки с названием; роль — размещается (по умолчанию) или отвечает за здание.
export const UNIT_ROLES = { occupant: 'Размещается', owner: 'Отвечает за здание' };
export function cleanUnits(list) {
  if (!Array.isArray(list)) return undefined;
  return list
    .filter((u) => u && typeof u.name === 'string' && u.name.trim())
    .map((u) => ({ name: u.name.trim(), role: u.role === 'owner' ? 'owner' : 'occupant', ...(has(u.person) ? { person: String(u.person).trim() } : {}) }));
}

// Поворот вокруг pivot на rotate° против часовой стрелки, затем сдвиг на move.
export function transformRing(ring, pivot, move, rotate, scale = 1) {
  const a = (rotate || 0) * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const [dx, dy] = move || [0, 0];
  return ring.map(([x, y]) => {
    const u = (x - pivot[0]) * scale;
    const v = (y - pivot[1]) * scale;
    return [pivot[0] + u * c - v * s + dx, pivot[1] + u * s + v * c + dy];
  });
}

const validWall = (w) => w && Array.isArray(w.line) && w.line.length === 2 && w.line.every((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])) && Math.hypot(w.line[1][0] - w.line[0][0], w.line[1][1] - w.line[0][1]) >= 0.5;
const validRing = (r) => Array.isArray(r) && r.length >= 3 && r.every((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]));

// Контур части здания из записи: poly — многоугольник, box — прямоугольник { x, y, length, width, angle },
// circle — круг { x, y, r } (башня). Координаты — в исходном положении здания (до move/rotate).
export function partRing(p) {
  if (!p) return null;
  if (validRing(p.poly)) return ensureCCW(p.poly.map(([x, y]) => [+x, +y]));
  if (p.box) return ensureCCW(rect(+p.box.x || 0, +p.box.y || 0, Math.max(1, +p.box.length || 6), Math.max(1, +p.box.width || 6), +p.box.angle || 0));
  if (p.circle) {
    const { x = 0, y = 0 } = p.circle;
    const r = Math.max(0.5, +p.circle.r || 3);
    return Array.from({ length: 20 }, (_, i) => [+x + r * Math.cos((i / 20) * 2 * Math.PI), +y + r * Math.sin((i / 20) * 2 * Math.PI)]);
  }
  return null;
}

// Разрезать контур прямой через точки a и b: режется отрезок прямой внутри контура, на котором
// лежит середина ab. Возвращает два контура или null (середина вне контура, прямая не пересекает).
export function splitRing(ring0, a, b) {
  const ring = ensureCCW(ring0);
  const d = [b[0] - a[0], b[1] - a[1]];
  if (Math.hypot(d[0], d[1]) < 1e-6) return null;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!pointInRing(m, ring)) return null;
  const n = ring.length;
  const hits = [];
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const e = [q[0] - p[0], q[1] - p[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    // a + d·t = p + e·u
    const t = ((p[0] - a[0]) * e[1] - (p[1] - a[1]) * e[0]) / den;
    const u = ((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / den;
    if (u >= 0 && u < 1) hits.push({ i, t, pt: [a[0] + d[0] * t, a[1] + d[1] * t] });
  }
  const lo = hits.filter((h) => h.t < 0.5).sort((x, y) => y.t - x.t)[0];
  const hi = hits.filter((h) => h.t > 0.5).sort((x, y) => x.t - y.t)[0];
  if (!lo || !hi) return null;
  const walk = (from, to) => {
    // от точки разреза from по контуру до точки to
    const out = [from.pt];
    for (let k = (from.i + 1) % n; ; k = (k + 1) % n) {
      out.push(ring[k]);
      if (k === to.i) break;
    }
    out.push(to.pt);
    return out.filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 1e-6);
  };
  const A = walk(lo, hi);
  const B = walk(hi, lo);
  if (A.length < 3 || B.length < 3 || area(A) < 1 || area(B) < 1) return null;
  return [ensureCCW(A), ensureCCW(B)];
}

// Здание из данных с правками записи e. Исходные данные не меняются.
export function editBuilding(orig, e) {
  if (!e) return orig;
  let b = { ...orig };
  if (has(e.name)) b.name = e.name;
  if (has(e.info)) b.info = e.info;
  if (has(e.floors)) b.floors = +e.floors;
  if (has(e.wall)) b.wall = e.wall;
  if (Array.isArray(e.units)) b.units = cleanUnits(e.units);
  if (has(e.src)) b.refined = e.src;
  if (has(e.sill)) b.sill = +e.sill;
  if (liftOf(e)) b.lift = liftOf(e);
  else delete b.lift;
  if (GLAZING[e.glazing]) b.glazing = e.glazing;
  if (e.windows === false) b.windows = false;
  else if (e.windows === true) delete b.windows;
  const retype = has(e.type) && e.type !== orig.type;
  const reheight = has(e.height) && +e.height !== orig.h;
  // масштаб: контур, высоты и кровля — пропорционально, вокруг центра здания
  const sc = scaleOf(e);
  if (retype) b.type = e.type;
  if (reheight) {
    b.h = +e.height;
    b.approx = false;
  }
  if (sc !== 1) b.h *= sc;
  // новый контур (выпрямленный, по обмеру) — в исходном положении, затем сдвиг и поворот
  const reshape = validRing(e.poly);
  const baseRing = reshape ? ensureCCW(e.poly.map(([x, y]) => [+x, +y])) : orig.poly;
  const pivot = centroid(baseRing);
  const tf = (ring) => (e.move || e.rotate || sc !== 1 ? transformRing(ring, pivot, e.move, e.rotate, sc) : ring);
  b.poly = tf(baseRing);
  // колоннада: точка near (у какой стены) — в исходном положении здания
  const colonnadeOf = (c) => (c && typeof c === 'object' ? { ...c, ...(Array.isArray(c.near) ? { near: tf([c.near.map(Number)])[0] } : {}) } : undefined);
  if (e.colonnade) b.colonnade = colonnadeOf(e.colonnade);
  if (reshape) delete b.holes;
  else if (orig.holes) b.holes = orig.holes.map(tf);
  // стены двора с аркой — тоже в исходном положении здания
  if (Array.isArray(e.walls))
    b.walls = e.walls.filter(validWall).map((w) => ({
      ...w,
      line: tf(w.line.map(([x, y]) => [+x, +y])),
      ...(sc !== 1 ? { h: (w.h ?? 3.5) * sc, t: (w.t ?? 0.6) * sc, ...(w.arch ? { arch: { ...w.arch, w: (w.arch.w ?? 3.6) * sc, h: (w.arch.h ?? 4) * sc } } : {}) } : {}),
    }));
  // кровля и проёмы — заново под новый тип, высоту и контур
  if (retype || reheight || reshape || sc !== 1) b = decorate({ ...b, roof: undefined, doors: undefined, roofColor: orig.roof?.color }, null);
  const scaleRoof = (r) => (sc !== 1 && has(r.roofH) ? { ...r, roofH: +r.roofH * sc } : r);
  applyRoof(b, scaleRoof(e));
  if (ROOF_COLORS.includes(e.roofColor)) b.roof = { ...(b.roof || { type: 'flat' }), color: e.roofColor };
  // части разной высоты (и башни): каждая — своим объёмом, основной объём не рисуется
  if (Array.isArray(e.parts) && e.parts.length) {
    const parts = [];
    // только башни и надстройки — основной объём остаётся частью со своими параметрами
    const list = e.parts.some((p) => validRing(p.poly)) ? e.parts : [{ poly: baseRing, height: b.h, floors: b.floors, roof: b.roof?.type, roofH: b.roof?.h }, ...e.parts];
    for (const p of list) {
      const ring = partRing(p);
      if (!ring || area(ring) < 0.5) continue;
      const ph = has(p.height) ? +p.height * sc : b.h;
      const part = decorate({ ...b, type: BUILDING_TYPES.includes(p.type) ? p.type : b.type, poly: tf(ring), holes: undefined, parts: undefined, h: ph, floors: has(p.floors) ? +p.floors : has(p.height) ? undefined : b.floors, roof: undefined, doors: undefined, roofColor: b.roof?.color }, null);
      if (p.circle) part.doors = [];
      applyRoof(part, scaleRoof({ roof: p.roof || b.roof?.type || 'flat', roofH: p.roofH }));
      if (ROOF_COLORS.includes(p.roofColor)) part.roof.color = p.roofColor;
      if (has(p.wall)) part.wall = p.wall;
      if (GLAZING[p.glazing]) part.glazing = p.glazing;
      part.colonnade = p.colonnade ? colonnadeOf(p.colonnade) : undefined;
      part.minH = 0;
      parts.push(part);
    }
    if (parts.length) {
      b.parts = parts;
      b.bodyH = 0;
      b.partsCustom = true;
      const top = (p) => p.h + (p.roof && p.roof.type !== 'flat' ? (p.roof.h ?? 3) : 0);
      b.h = Math.max(...parts.map(top));
      b.roof = { type: 'flat', color: b.roof?.color };
      const fl = parts.map((p) => p.floors).filter(Boolean);
      if (fl.length) b.floors = Math.max(...fl);
    }
  }
  // части, созданные при переносе данных предприятия (основной объём + пристройки без номера):
  // правки высоты, кровли и типа — основному объёму, стен, остекления и покрытия — всем частям;
  // при новом контуре части теряют смысл
  if (orig.partsCustom && Array.isArray(orig.parts) && orig.parts.length && !(Array.isArray(e.parts) && e.parts.length)) {
    if (reshape) {
      delete b.parts;
      delete b.partsCustom;
    } else {
      const main = { ...b, parts: undefined, partsCustom: undefined, bodyH: undefined, walls: undefined, minH: 0 };
      const rest = orig.parts.slice(1).map((p) => {
        const q = { ...p, poly: tf(p.poly), ...(p.holes ? { holes: p.holes.map(tf) } : {}) };
        if (has(e.wall)) q.wall = e.wall;
        if (GLAZING[e.glazing]) q.glazing = e.glazing;
        if (e.windows === false) q.windows = false;
        else if (e.windows === true) delete q.windows;
        if (has(e.sill)) q.sill = +e.sill;
        if (ROOF_COLORS.includes(e.roofColor)) q.roof = { ...(q.roof || { type: 'flat' }), color: e.roofColor };
        if (sc !== 1) {
          q.h *= sc;
          if (q.roof && has(q.roof.h)) q.roof = { ...q.roof, h: q.roof.h * sc };
        }
        return q;
      });
      b.parts = [main, ...rest];
      b.partsCustom = true;
    }
  }
  b.edited = true;
  return b;
}

// Форма и высота кровли из записи (по фото, по документам). Двускатная и вальмовая над
// непрямоугольным контуром строятся скатами по контуру; сводчатая, односкатная и
// многопролётная — только над прямоугольным, иначе остаётся плоская.
function applyRoof(b, e) {
  if (ROOF_TYPES[e.roof]) {
    const mr = minRect(b.poly);
    const span = Math.min(mr.w, mr.d);
    const bays = e.roof === 'multigable' ? +e.roofBays || b.roof?.bays || 3 : 1;
    const rh = has(e.roofH) ? +e.roofH : e.roof === 'flat' ? 0 : e.roof === 'barrel' ? span * 0.35 : e.roof === 'shed' ? Math.min(3, span * 0.15) : Math.max(2, Math.min(10, (span / bays) * 0.18));
    b.roof = { ...(b.roof || {}), type: e.roof, h: rh, ...(e.roof === 'multigable' ? { bays } : {}), ...(e.roof === 'gable' || e.roof === 'hip' ? { any: true } : {}) };
  } else if (has(e.roofH) && b.roof && b.roof.type !== 'flat') b.roof = { ...b.roof, h: +e.roofH };
  return b;
}

// К чему относится новый объект — к верфи или к городу (от этого зависят режим «Только верфь»,
// список объектов верфи и реестр): явно — полем scope записи ('yard' | 'city'); иначе по
// выбранному слою (здания верфи, стапели и краны, суда — верфь; окружающая застройка — город);
// иначе по месту: на территории верфи или за ней (судно на воде — за ней).
export const SCOPES = { yard: 'к верфи', city: 'к городу' };
const YARD_LAYERS = new Set(['shipyard', 'production', 'vessels']);
export function newObjectInYard(e, byPlace) {
  if (e?.scope === 'yard' || e?.scope === 'city') return e.scope === 'yard';
  if (YARD_LAYERS.has(e?.layer)) return true;
  if (e?.layer === 'context') return false;
  return byPlace;
}

// Новое здание по записи с box: коробка нужного размера, кровля и проёмы по типу.
export function boxBuilding(id, e, { inYard, zoneOf }) {
  const bx = e.box || {};
  // контур — по точкам poly (по обмеру, по плану) или прямоугольник box
  const ring = validRing(e.poly) ? ensureCCW(e.poly.map(([px, py]) => [+px, +py])) : null;
  const [x, y] = ring ? centroid(ring) : [+bx.x || 0, +bx.y || 0];
  const type = BUILDING_TYPES.includes(e.type) ? e.type : 'warehouse';
  const fin = DEFAULT_FINISH[type];
  const yard = newObjectInYard(e, inYard([x, y]));
  const b = decorate(
    {
      kind: yard ? 'shipyard' : 'context',
      id,
      zone: zoneOf([x, y]),
      name: has(e.name) ? e.name : `Новое здание ${id}`,
      info: e.info || '',
      type,
      floors: has(e.floors) ? +e.floors : undefined,
      h: (has(e.height) ? +e.height : 10) * scaleOf(e),
      wall: e.wall || fin.wall,
      roofColor: fin.roof,
      units: cleanUnits(e.units),
      poly: ring ? transformRing(ring, [x, y], null, 0, scaleOf(e)) : ensureCCW(rect(x, y, Math.max(2, +bx.length || 30) * scaleOf(e), Math.max(2, +bx.width || 18) * scaleOf(e), +bx.angle || 0)),
      geomSrc: 'editor',
      approx: false,
    },
    null,
  );
  if (has(e.src)) b.refined = e.src;
  if (liftOf(e)) b.lift = liftOf(e);
  if (has(e.sill)) b.sill = +e.sill;
  if (GLAZING[e.glazing]) b.glazing = e.glazing;
  if (e.windows === false) b.windows = false;
  return { ...applyRoof(b, e), edited: true };
}

// Модель из Blender на месте: контур и отметки после сдвига и поворота из записи e.
export function placeModel(a, e) {
  const lift = liftOf(e);
  const sc = scaleOf(e);
  const out = { hull: a.hull, z0: a.z0 * sc + lift, z1: a.z1 * sc + lift, transform: null };
  if (e && (e.move || e.rotate || lift || sc !== 1)) {
    const pivot = centroid(a.hull);
    out.transform = { pivot, move: e.move || [0, 0], rotate: e.rotate || 0, ...(lift ? { lift } : {}), ...(sc !== 1 ? { scale: sc } : {}) };
    out.hull = ensureCCW(transformRing(a.hull, pivot, e.move, e.rotate, sc));
  }
  return out;
}
// Подъём (+) или опускание (−) объекта по высоте, м.
export const liftOf = (e) => (Number.isFinite(+e?.lift) ? +e.lift : 0);
// Масштаб объекта (1 — как есть).
export const scaleOf = (e) => (Number.isFinite(+e?.scale) && +e.scale > 0 ? +e.scale : 1);

// Сведения о новом здании-модели (без своих данных) — для карточки и реестра.
export function modelBuilding(id, m, e, { inYard, zoneOf }) {
  const c = centroid(m.hull);
  const yard = newObjectInYard(e, inYard(c));
  return {
    id,
    name: has(e?.name) ? e.name : `Новое здание ${id}`,
    info: e?.info || '',
    kind: yard ? 'shipyard' : 'context',
    type: BUILDING_TYPES.includes(e?.type) ? e.type : 'utility',
    floors: has(e?.floors) ? +e.floors : undefined,
    zone: zoneOf(c),
    poly: m.hull,
    h: Math.max(1, m.z1 - Math.max(0, m.z0)),
    geomSrc: 'custom',
    units: cleanUnits(e?.units),
  };
}

// ---------- подготовка набора доработок ----------

// config — содержимое custom.json; files — [{ file, bytes }]. Возвращает набор для buildModel.
export function prepareCustom(config = {}, files = []) {
  const warnings = [];
  const models = {};
  const meta = config.buildings || {};
  // точное имя «код.glb» важнее файла с названием
  const sorted = [...files].sort((a, b) => (a.file === `${customIdFromFile(a.file)}.glb` ? 0 : 1) - (b.file === `${customIdFromFile(b.file)}.glb` ? 0 : 1));
  for (const f of sorted) {
    const id = customIdFromFile(f.file);
    if (models[id]) {
      warnings.push(`${f.file}: для кода ${id} уже есть файл ${models[id].file} — этот пропущен`);
      continue;
    }
    try {
      const a = analyzeGlb(f.bytes);
      models[id] = { file: f.file, images: a.images, ...placeModel(a, meta[id]) };
      for (const w of a.warnings) warnings.push(`${f.file}: ${w}`);
    } catch (e) {
      warnings.push(`${f.file}: ${e.message} — файл пропущен`);
    }
  }
  for (const [id, m] of Object.entries(meta)) {
    if (m.type && !BUILDING_TYPES.includes(m.type)) warnings.push(`custom.json, ${id}: неизвестный тип «${m.type}» (допустимы ${BUILDING_TYPES.join(', ')})`);
    if (m.wall && !WALLS.includes(m.wall)) warnings.push(`custom.json, ${id}: неизвестная отделка «${m.wall}» (допустимы ${WALLS.join(', ')})`);
    if (m.poly !== undefined && !validRing(m.poly)) warnings.push(`custom.json, ${id}: poly должен быть списком точек [[x, y], …], не меньше трёх`);
    if (m.parts !== undefined && (!Array.isArray(m.parts) || m.parts.some((p) => !partRing(p)))) warnings.push(`custom.json, ${id}: parts — список частей { "poly" | "box" | "circle", "floors", "height", "roof" }`);
    if (m.glazing !== undefined && !GLAZING[m.glazing]) warnings.push(`custom.json, ${id}: glazing — ${Object.keys(GLAZING).join(' или ')}`);
    if (m.scale !== undefined && !(+m.scale > 0)) warnings.push(`custom.json, ${id}: scale — масштаб, число больше нуля (1 — как есть)`);
    if (m.lift !== undefined && !Number.isFinite(+m.lift)) warnings.push(`custom.json, ${id}: lift — подъём (+) или опускание (−) в метрах, число`);
    if (m.walls !== undefined && (!Array.isArray(m.walls) || !m.walls.every(validWall))) warnings.push(`custom.json, ${id}: walls — список стен { "line": [[x, y], [x, y]], "h", "t", "arch": { "w", "h", "at" } }`);
    if (m.roofColor && !ROOF_COLORS.includes(m.roofColor)) warnings.push(`custom.json, ${id}: неизвестное покрытие кровли «${m.roofColor}» (допустимы ${ROOF_COLORS.join(', ')})`);
    if (m.roof && !ROOF_TYPES[m.roof]) warnings.push(`custom.json, ${id}: неизвестная форма кровли «${m.roof}» (допустимы ${Object.keys(ROOF_TYPES).join(', ')})`);
    if (m.units !== undefined && !Array.isArray(m.units)) warnings.push(`custom.json, ${id}: units должен быть списком [{ "name": …, "role": "occupant" | "owner", "person": … }]`);
  }
  return { remove: new Set(config.remove || []), meta, models, warnings };
}

// Удаление из исходных данных (до сборки): так удалённое пропадает и из DXF/GeoJSON.
export const DATA_KEYS = ['buildings', 'cranes', 'ships', 'docks', 'slipways', 'bridges', 'chimneys', 'arches', 'fences', 'platforms', 'markers'];
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

// До сборки зданий: правки зданий из данных и новые здания-коробки.
// ctx: { inYard(p), zoneOf(p) }. Возвращает { edited, added }.
export function editBuildingsData(data, custom, ctx) {
  const ids = new Set(data.buildings.map((b) => b.id));
  const edited = [];
  data.buildings = data.buildings.map((b) => {
    const e = custom.meta[b.id];
    if (!e || custom.models[b.id]) return b;
    edited.push(b.id);
    return editBuilding(b, e);
  });
  const added = [];
  for (const [id, e] of Object.entries(custom.meta)) {
    if (!(e.box || validRing(e.poly)) || ids.has(id) || custom.models[id] || custom.remove.has(id)) continue;
    data.buildings.push(boxBuilding(id, e, ctx));
    added.push(id);
  }
  return { edited, added };
}

// Сведения объекта из записи (для заменённых моделью и прочих объектов: краны, суда…).
export function patchInfo(o, e) {
  if (!e) return o;
  const out = { ...o };
  if (has(e.name)) out.name = e.name;
  if (out.info) {
    const i = { ...out.info };
    if (has(e.name)) i.name = e.name;
    if (has(e.info)) i.info = e.info;
    if (has(e.type)) i.type = e.type;
    if (Array.isArray(e.units)) i.units = cleanUnits(e.units);
    if (has(e.src)) i.refined = e.src;
    if (has(e.floors)) {
      i.floors = +e.floors;
      i.floorsEst = +e.floors;
      i.floorsKnown = true;
      if (i.footprint) i.totalArea = i.footprint * +e.floors;
    }
    out.info = i;
  }
  return out;
}

// Слои, куда можно поставить новый объект из Blender, и вид объекта в карточке
export const NEW_LAYERS = { shipyard: 'Здания верфи', production: 'Стапели, краны, оборудование', vessels: 'Суда и плавдоки', bridges: 'Мосты', context: 'Окружающая застройка' };
export const LAYER_KIND = { shipyard: 'building', production: 'misc', vessels: 'vessel', bridges: 'bridge', context: 'context' };

// ---------- сдвиг и поворот прочих объектов (краны, трубы, суда, доки, мосты, заборы) ----------
// Центр поворота — центр контура выбора объекта (как у зданий — центр контура).
export function objectPivot(proxy) {
  if (proxy?.poly) return centroid(proxy.poly);
  if (proxy?.line?.length) {
    const xs = proxy.line.map((p) => p[0]);
    const ys = proxy.line.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return null;
}
// Объект на новом месте: геометрия и контур выбора. Исходное положение хранится в o.unmoved,
// поэтому повторная правка считается от него, а не от уже сдвинутого.
export function moveObject(o, e) {
  const src = o.unmoved || o;
  const lift = liftOf(e);
  const sc = scaleOf(e);
  if (!e?.move && !e?.rotate && !lift && sc === 1) return o.unmoved ? { ...o, sink: src.sink, proxy: src.proxy } : o;
  const pivot = objectPivot(src.proxy);
  if (!pivot) return o;
  const tf = (ring) => transformRing(ring, pivot, e.move, e.rotate, sc);
  const p0 = src.proxy;
  const proxy = {
    ...p0,
    ...(p0.poly ? { poly: tf(p0.poly), z0: p0.z0 * sc + lift, z1: p0.z1 * sc + lift } : {}),
    ...(p0.line ? { line: tf(p0.line), z0: (p0.z0 || 0) * sc + lift, h: p0.h * sc } : {}),
  };
  return { ...o, sink: src.sink.transformed(pivot, e.move, e.rotate, lift, sc), proxy, unmoved: { sink: src.sink, proxy: src.proxy } };
}
// Те же сдвиг и поворот в данных (по ним строятся DXF и GeoJSON): точки, линии и углы.
const POINT_KEYS = ['at', 'head', 'from', 'to'];
const LINE_KEYS = ['line', 'poly', 'polygon'];
const ANGLE_KEYS = ['angle', 'track', 'slew'];
export function moveDataItem(item, pivot, e) {
  if (!e?.move && !e?.rotate) return item;
  const tf = (ring) => transformRing(ring, pivot, e.move, e.rotate);
  const out = { ...item };
  for (const k of POINT_KEYS) if (Array.isArray(item[k]) && item[k].length === 2) out[k] = tf([item[k]])[0];
  for (const k of LINE_KEYS) if (Array.isArray(item[k]) && Array.isArray(item[k][0])) out[k] = tf(item[k]);
  for (const k of ANGLE_KEYS) if (Number.isFinite(item[k])) out[k] = item[k] + (e.rotate || 0);
  if (Array.isArray(item.gates)) out.gates = item.gates.map((g) => (Array.isArray(g.at) ? { ...g, at: tf([g.at])[0] } : g));
  // судно, уведённое со стапеля или дока, — на плаву
  if (item.onSlip || item.onDock) {
    delete out.onSlip;
    delete out.onDock;
    out.afloat = true;
  }
  return out;
}

// После сборки: замена моделями, новые здания-модели, сведения прочих объектов, отчёт.
// ctx: { layers, signs, data, removedFromData, pre: {edited, added}, inYard(p), zoneOf(p), summary(b), Sink }
export function applyCustom(custom, ctx) {
  const { layers, summary, Sink } = ctx;
  const report = { replaced: [], added: [...ctx.pre.added], removed: [], edited: [...ctx.pre.edited], warnings: [...custom.warnings] };
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

  for (const [id, m] of Object.entries(custom.models)) {
    const e = custom.meta[id];
    if (custom.remove.has(id)) {
      report.warnings.push(`${m.file}: код ${id} одновременно в списке удаления — модель не подставлена`);
      continue;
    }
    const hit = all.get(id);
    if (hit) {
      // замена: своя геометрия из GLB, сведения об объекте сохраняются
      const o = modelObject(hit.o, m, Sink);
      Object.assign(hit.o, patchInfo(o, e));
      report.replaced.push(id);
      if (e) report.edited.push(id);
    } else {
      const b = modelBuilding(id, m, e, ctx);
      const layerId = e?.layer && layers[e.layer] ? e.layer : b.kind === 'shipyard' ? 'shipyard' : 'context';
      const obj = { id, name: b.name, sink: new Sink(), custom: m.file, transform: m.transform, info: { ...summary(b), kind: LAYER_KIND[layerId] || 'context' }, proxy: { poly: m.hull, z0: m.z0, z1: m.z1 } };
      obj.scope = b.kind === 'shipyard' ? 'yard' : 'city';
      layers[layerId].objects.push(obj);
      all.set(id, { o: obj, layer: layers[layerId] });
      report.added.push(id);
    }
  }

  // сведения прочих объектов (здания из данных уже поправлены до сборки)
  const done = new Set([...ctx.pre.edited, ...report.added, ...report.replaced]);
  for (const [id, e] of Object.entries(custom.meta)) {
    if (done.has(id)) continue;
    const hit = all.get(id);
    if (!hit) {
      if (!custom.remove.has(id)) report.warnings.push(`custom.json: объекта с кодом ${id} нет в модели, нет файла ${id}.glb и нет размеров box или контура poly для нового здания`);
      continue;
    }
    Object.assign(hit.o, patchInfo(moveObject(hit.o, e), e));
    if (e.move || e.rotate) moveInData(ctx.data, id, objectPivot(hit.o.unmoved.proxy), e);
    report.edited.push(id);
  }

  // вывески заменённых зданий (их рисует сама модель из Blender)
  ctx.signs.splice(0, ctx.signs.length, ...ctx.signs.filter((s) => !custom.models[s.id]));
  return report;
}

function moveInData(data, id, pivot, e) {
  if (!data || !pivot) return;
  for (const k of DATA_KEYS) {
    if (k === 'buildings' || !Array.isArray(data[k])) continue;
    // новый массив: исходные списки данных общие для всех сборок
    if (data[k].some((x) => x.id === id)) data[k] = data[k].map((x) => (x.id === id ? moveDataItem(x, pivot, e) : x));
  }
}

// Объект модели, у которого геометрия — модель из Blender (сведения прежние, высота — по модели).
export function modelObject(o, m, Sink) {
  const out = { ...o, sink: new Sink(), custom: m.file, transform: m.transform, proxy: { poly: m.hull, z0: m.z0, z1: m.z1 } };
  if (o.info) {
    const h = +(m.z1 - Math.max(0, m.z0)).toFixed(1);
    out.info = { ...o.info, height: h, geomSrc: 'custom' };
    if (out.info.footprint) out.info.volume = Math.round(out.info.footprint * h);
  }
  return out;
}
