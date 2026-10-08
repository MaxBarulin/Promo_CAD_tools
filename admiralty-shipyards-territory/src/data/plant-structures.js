// Сооружения по данным предприятия: стапели, дымовые трубы, заводские мосты,
// площадки и плиты, а также объекты, обозначенные на данные предприятия только номером без контура
// (набережные, причалы, пирсы, эстакады, ямы, монумент). Сведения — из таблицы объектов
// недвижимости предприятия (название, инвентарный номер, литера).

import { PLANT_TABLE, PLANT_BUILDINGS, PLANT_PLATFORMS, PLANT_POINTS } from './plant.js';
import { centroid, area, dist, add, sub, mul, dot, dirOf, pointInRing, DEG } from '../geo.js';

const TABLE = new Map();
for (const r of PLANT_TABLE) {
  if (!TABLE.has(r.num)) TABLE.set(r.num, []);
  TABLE.get(r.num).push(r);
}

// Названия предприятия набраны с лишними пробелами («5- Ю», «в т . ч .», «( стап . место )»)
const clean = (s) =>
  s
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+([,.)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/"\s*([^"]*?)\s*"/g, '«$1»')
    .replace(/№\s*(\d)/g, '№ $1')
    .replace(/\s+/g, ' ')
    .trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// «Сооружение, пожарный пирс №10» → «Пожарный пирс № 10»
const shortName = (s) => cap(clean(s).replace(/^Сооружени[ея]\s*[,]?\s*/i, '').replace(/^\(([^)]*)\)$/, '$1'));


export function regInfo(num) {
  const rows = TABLE.get(String(num)) || [];
  return {
    num: String(num),
    nums: [String(num)],
    inv: rows.find((r) => r.inv)?.inv || '',
    lit: rows.find((r) => r.lit)?.lit || '',
    names: rows.map((r) => clean(r.name)).filter(Boolean),
  };
}
const regOf = (g) => ({ num: g.num, nums: g.nums, inv: g.inv, lit: g.lit });

// Номера объектов, которые в модели — дымовые трубы (их контуры не становятся зданиями)
export const PLANT_CHIMNEY_NUMS = new Set(['179', '180']);
// Номера, которые в модели — стапели (бетонные стапельные дорожки данные предприятия)
const SLIP_NUMS = { S1: '166', S2: '165' };
const SLIP_NAMES = { S1: 'Южный стапель 5-Ю', S2: 'Северный стапель 5-С' };

// Прямоугольник минимальной площади вокруг контура: центр, угол длинной стороны, размеры
function orientedRect(poly) {
  let best = null;
  for (let a = 0; a < 180; a += 0.25) {
    const c = Math.cos(a * DEG);
    const s = Math.sin(a * DEG);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of poly) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, a, c, s, u0, u1, v0, v1 };
  }
  const { a, c, s, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  const L = u1 - u0;
  const W = v1 - v0;
  return L >= W ? { cx: cu * c - cv * s, cy: cu * s + cv * c, angle: a, L, W } : { cx: cu * c - cv * s, cy: cu * s + cv * c, angle: a + 90, L: W, W: L };
}

// Стапели: ось — по бетонной стапельной дорожке, названия и реквизиты — из таблицы предприятия;
// длина, ширина и голова стапеля (проекция прежней на новую ось) — прежние.
export function plantSlipways(list) {
  return list.map((sw) => {
    const num = SLIP_NUMS[sw.id];
    const face = num && PLANT_PLATFORMS.find((p) => p.nums[0] === num);
    if (!face) return sw;
    const r = orientedRect(face.poly);
    let angle = r.angle;
    if (Math.cos((angle - sw.angle) * DEG) < 0) angle += 180;
    const d = dirOf(angle);
    const head = add([r.cx, r.cy], mul(d, dot(sub(sw.head, [r.cx, r.cy]), d)));
    const g = regInfo(num);
    const name = SLIP_NAMES[sw.id] || sw.name;
    const tbl = g.names[0] ? `${cap(g.names[0])}.` : '';
    const info = `${tbl} Открытый наклонный стапель: длина ≈ ${Math.round(sw.length)} м, ширина ${sw.width} м (паспорт — 259×35 м, суда дедвейтом до 70 000 т). Спуск — в Большую Неву. Ось — по бетонной стапельной дорожке (${Math.round(r.L)} × ${Math.round(r.W)} м).`.trim();
    return { ...sw, head: head.map((v) => +v.toFixed(2)), angle: +angle.toFixed(2), name, info, reg: regOf(g) };
  });
}

// Дымовые трубы по данным предприятия: № 179 — труба цеха № 6-Ю (бетонное основание), № 180 — труба кузницы.
// Высот в данных предприятия нет — оценены по типу (кирпичные трубы цеха и кузницы).
const CHIMNEY_H = { 179: 45, 180: 30 };
export function plantChimneys(list) {
  const out = [...list];
  const faces = [
    ...PLANT_PLATFORMS.filter((p) => PLANT_CHIMNEY_NUMS.has(p.nums[0])).map((p) => ({ num: p.nums[0], poly: p.poly })),
    ...PLANT_BUILDINGS.filter((b) => PLANT_CHIMNEY_NUMS.has(b.nums[0])).map((b) => ({ num: b.nums[0], poly: b.poly })),
  ];
  let k = 0;
  for (const num of [...PLANT_CHIMNEY_NUMS].sort()) {
    const f = faces.find((x) => x.num === num);
    if (!f) continue;
    const g = regInfo(num);
    const at = centroid(f.poly).map((v) => +v.toFixed(2));
    const dia = 2 * Math.sqrt(area(f.poly) / Math.PI);
    const r = +Math.min(2.4, Math.max(1.2, dia / 2)).toFixed(2);
    const h = CHIMNEY_H[num] || 30;
    out.push({
      id: `CH${list.length + ++k}`,
      name: shortName(g.names[0] || 'Дымовая труба'),
      info: `Кирпичная дымовая труба; основание ≈ ${dia.toFixed(1).replace('.', ',')} м в диаметре. Высота оценена по типу сооружения — требует уточнения.`,
      at,
      h,
      r,
      approx: true,
      reg: regOf(g),
    });
  }
  return out;
}

// Заводские мосты: номера без контура, название предприятия и реквизиты — ближайшему мосту
export function plantBridges(list) {
  const mid = (b) => [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2];
  const pts = PLANT_POINTS.map((p) => ({ ...p, g: regInfo(p.num) })).filter((p) => /мост/i.test(p.g.names.join(' ')));
  const used = new Set();
  const out = list.map((b) => {
    const hit = pts.map((p) => ({ p, d: dist(mid(b), p.at) })).sort((x, y) => x.d - y.d)[0];
    if (!hit || hit.d > 40 || used.has(hit.p.num)) return b;
    used.add(hit.p.num);
    const full = hit.p.g.names[0] || '';
    const q = full.match(/«([^»]+)»/);
    const name = q ? `${q[1]} мост` : b.name && b.name !== 'Мост' ? b.name : cap(full.replace(/^Сооружение\s+/i, '').replace(/^мост\s+автодорожный\s+/i, 'мост '));
    return { ...b, name, info: `${cap(full)}. Внутризаводской мост; положение и размеры — по OpenStreetMap.`, reg: regOf(hit.p.g), yard: true };
  });
  out.usedNums = used;
  return out;
}

// Площадки и плиты с номерами: сборочно-сварочные площадки (металл), палы, ямы, основания (бетон)
export function plantPlatforms() {
  const skip = new Set([...Object.values(SLIP_NUMS), ...PLANT_CHIMNEY_NUMS]);
  const list = PLANT_PLATFORMS.filter((p) => !skip.has(p.nums[0]));
  const count = {};
  for (const p of list) count[p.nums[0]] = (count[p.nums[0]] || 0) + 1;
  const seen = {};
  return list.map((p) => {
    const num = p.nums[0];
    const g = regInfo(num);
    const k = seen[num] || 0;
    seen[num] = k + 1;
    const id = `P${num}${count[num] > 1 ? 'абвгде'[k] : ''}`;
    const name = shortName(g.names[0] || 'Площадка');
    const pit = /(^|\s)ям[аы](\s|$|,)/i.test(name);
    const kind = pit ? 'pit' : p.surface;
    const what = pit ? 'Трансбордерная яма (заглублённое сооружение)' : p.surface === 'metal' ? 'Металлическая площадка (плита)' : 'Бетонная площадка (плита)';
    return {
      id,
      name,
      info: `${what}, площадь ≈ ${Math.round(p.area)} м²${count[num] > 1 ? `; под № ${num} — ${count[num]} контура` : ''}.`,
      poly: p.poly,
      surface: kind,
      reg: { ...regOf(g), nums: p.nums },
    };
  });
}

// Объекты, учтённые номером без контура: точка — по месту подписи
export function plantMarkers(usedNums = new Set()) {
  const skip = new Set([...usedNums, ...PLANT_CHIMNEY_NUMS]);
  return PLANT_POINTS.filter((p) => !skip.has(p.num)).map((p) => {
    const g = regInfo(p.num);
    const names = g.names.length ? g.names : ['Сооружение'];
    const name = shortName(names[0]);
    const kind = /набережн|берегоукр|б\/укр/i.test(names[0]) ? 'quay' : /пирс|причал/i.test(names[0]) ? 'pier' : /эстакад/i.test(names[0]) ? 'trestle' : /(^|\s)ям[аы](\s|$|,)/i.test(names[0]) ? 'pit' : /монумент|памятн/i.test(names[0]) ? 'monument' : /склад/i.test(names[0]) ? 'storage' : 'structure';
    const more = names.length > 1 ? ` Под тем же номером на листе: ${names.slice(1).map(cap).join('; ')}.` : '';
    return {
      id: `M${p.num}`,
      name,
      info: `${cap(names[0])}.${more} Объект учтён под номером без контура: отметка поставлена условно.`,
      at: p.at,
      kind,
      reg: regOf(g),
    };
  });
}

// ---------- отметки служб и знаков на территории ----------

import { PLANT_MARKS, MARK_KINDS } from './plant-marks.js';

const SERVICE = { med: 'медпункт', canteen: 'столовая', cashier: 'касса', training: 'учебный центр', atm: 'банкомат', kiosk: 'ларёк / кафе', kpp: 'КПП' };
const NAME_FOR = { med: 'Медпункт', canteen: 'Столовая', cashier: 'Касса', training: 'Учебный центр', atm: 'Банкомат', kiosk: 'Ларёк / кафе', kpp: 'Будка КПП', bus: 'Знак автобусной остановки' };
const PLACEHOLDER = 'Здание без номера объектов';

// расстояние от точки до контура (0 — внутри)
function distToRing(p, ring) {
  if (pointInRing(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

const servicePoint = (m, k) => ({
  id: `MS-${m.kind}-${k}`,
  name: NAME_FOR[m.kind] || cap(MARK_KINDS[m.kind]),
  info: `Отметка: ${MARK_KINDS[m.kind]}. Положение условное.`,
  at: m.at,
  kind: 'service',
  mark: m.kind,
});

// Знаки служб (медпункт, столовая, касса, учебный центр, банкомат, КПП, ларёк) — зданиям верфи,
// на которых или у которых они стоят; ларьки и знаки вне зданий — отдельные отметки.
// Знаки пешеходных переходов — переходы через проезды (парами по сторонам проезда).
export function applyMarks(buildings, { crossings = [], roads = [] } = {}) {
  const out = buildings.slice();
  const index = new Map(out.map((b, i) => [b.id, i]));
  const yard = out.filter((b) => b.kind === 'shipyard');
  const report = { attached: [], points: [], crossings: 0, singles: 0 };
  const points = [];
  let k = 0;
  const attach = (b, kind) => {
    const i = index.get(b.id);
    const nb = { ...out[i], services: [...(out[i].services || []), SERVICE[kind]] };
    if (nb.name === PLACEHOLDER) nb.name = NAME_FOR[kind];
    // небольшая постройка со знаком КПП — будка проходной
    if (kind === 'kpp' && area(nb.poly) < 150 && nb.type !== 'checkpoint') {
      nb.type = 'checkpoint';
      // будка проходной — одноэтажная, невысокая
      if (area(nb.poly) < 40 && nb.h > 3.5) {
        nb.h = 3.2;
        nb.floors = 1;
        nb.approx = true;
      }
    }
    nb.info = `${nb.info ? nb.info + ' ' : ''}По данным предприятия: ${SERVICE[kind]}.`;
    out[i] = nb;
    report.attached.push({ id: b.id, kind });
  };
  for (const m of PLANT_MARKS) {
    if (m.kind === 'bus' || m.kind === 'crossing') continue;
    const cands = yard.map((b) => ({ b, d: distToRing(m.at, b.poly), A: area(b.poly) })).sort((x, y) => x.d - y.d);
    let hit = cands[0];
    // знак на крошечной постройке вплотную к большому зданию — служба в большом здании
    if (hit && hit.d < 1.5 && hit.A < 60 && cands[1] && cands[1].d < 3 && cands[1].A > 200 && m.kind !== 'kpp') hit = cands[1];
    const near = m.kind === 'kiosk' ? hit && hit.d === 0 : hit && hit.d <= 8;
    if (near) attach(hit.b, m.kind);
    else {
      points.push(servicePoint(m, ++k));
      report.points.push({ kind: m.kind, at: m.at });
    }
  }
  // переходы: пары знаков по сторонам проезда; одиночный знак — поперёк ближайшего проезда
  const signs = PLANT_MARKS.filter((m) => m.kind === 'crossing').map((m) => m.at);
  const used = new Set();
  const added = [];
  for (let i = 0; i < signs.length; i++) {
    if (used.has(i)) continue;
    let bj = -1;
    let bd = Infinity;
    for (let j = 0; j < signs.length; j++) {
      if (j === i || used.has(j)) continue;
      const d = dist(signs[i], signs[j]);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    if (bj >= 0 && bd <= 32) {
      used.add(i);
      used.add(bj);
      added.push({ line: [signs[i], signs[bj]], src: 'plant' });
      continue;
    }
    used.add(i);
    // одиночный знак: ближайший проезд и его сторона
    let best = null;
    for (const r of roads) {
      for (let s = 0; s < r.line.length - 1; s++) {
        const a = r.line[s];
        const b = r.line[s + 1];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const L = dx * dx + dy * dy;
        if (!L) continue;
        const t = Math.max(0, Math.min(1, ((signs[i][0] - a[0]) * dx + (signs[i][1] - a[1]) * dy) / L));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = dist(signs[i], q);
        if (!best || d < best.d) best = { d, q, w: r.w || 6 };
      }
    }
    if (!best || best.d > 15) continue;
    const v = sub(best.q, signs[i]);
    const n = v[0] || v[1] ? mul(v, 1 / Math.hypot(v[0], v[1])) : [1, 0];
    added.push({ line: [signs[i], add(signs[i], mul(n, best.w + 2 * best.d + 1))], src: 'plant', single: true });
    report.singles++;
  }
  report.crossings = added.length;
  return { buildings: out, crossings: [...crossings, ...added], points, report };
}

// Знаки автобусных остановок по данным предприятия, у которых нет остановки модели поблизости
export function busSignPoints(stops) {
  const out = [];
  let k = 0;
  for (const m of PLANT_MARKS.filter((x) => x.kind === 'bus')) {
    const d = Math.min(...stops.map((s) => dist(s.sign || s.zone?.at || s.at, m.at)));
    if (d <= 25) continue;
    out.push({ ...servicePoint(m, ++k), id: `MS-bus-${k}`, info: `Знак автобусной остановки; в расписании внутризаводского автобуса такой остановки нет (ближайшая остановка модели — в ${Math.round(d)} м).` });
  }
  return out;
}
