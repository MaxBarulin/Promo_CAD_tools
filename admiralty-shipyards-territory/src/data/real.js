// Территория по реальной геометрии (Overture Maps / OpenStreetMap, src/data/real-data.js).
//
// Отсюда берутся: граница территории верфи, контуры и высоты всех зданий, вода, улицы,
// внутризаводские проезды, мосты, скверы, ворота. С карты предприятия (после привязки
// к реальной границе, см. mapdata.js) — назначение и названия цехов, стапели, подкрановые
// пути, краны, суда, плавдоки.

import pc from 'polygon-clipping';
import REAL from './real-data.js';
import * as Y from './shipyard.js';
import { MAP_BUILDINGS_RAW, MAP_PIECES, px } from './mapdata.js';
import { ensureCCW, area, centroid, dist, sub, norm, add, mul, pointInRing, bbox, angleOf, polylineLength, pointAt } from '../geo.js';

// ---------- геометрические помощники ----------

const mpArea = (mp) => mp.reduce((s, poly) => s + area(poly[0]) - poly.slice(1).reduce((t, h) => t + area(h), 0), 0);
const bbOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const inPoly = (p, poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h));

function overlap(a, b) {
  try {
    return mpArea(pc.intersection([[a]], [[b]]));
  } catch {
    return 0;
  }
}

// Минимальный описанный прямоугольник (по направлениям рёбер).
function minRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const u = norm(sub(ring[(i + 1) % ring.length], ring[i]));
    if (!Number.isFinite(u[0])) continue;
    const v = [-u[1], u[0]];
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of ring) {
      const a = p[0] * u[0] + p[1] * u[1];
      const b = p[0] * v[0] + p[1] * v[1];
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const ar = (a1 - a0) * (b1 - b0);
    if (!best || ar < best.area) {
      const P = (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];
      best = { area: ar, w: a1 - a0, d: b1 - b0, corners: [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)] };
    }
  }
  return best;
}

function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

function distToRing(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1)));
    best = Math.min(best, dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
  }
  return best;
}

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- участки территории ----------

const pieceCenters = Y.PIECE_INFO.map((z) => {
  const mp = MAP_PIECES.find((p) => Math.abs(p.cxPx - z.cx) < 60);
  return { ...z, c: centroid(mp.polygon) };
});

export const YARD_ZONES = REAL.yard.map((poly) => {
  const c = centroid(poly[0]);
  const z = pieceCenters.slice().sort((a, b) => dist(a.c, c) - dist(b.c, c))[0];
  return { id: z.id, name: z.name, kind: 'shipyard', polygon: poly[0], holes: poly.slice(1), label: c };
});
const yardPolys = REAL.yard;
const inYard = (p) => yardPolys.some((poly) => inPoly(p, poly));
const distYard = (p) => (inYard(p) ? 0 : Math.min(...yardPolys.map((poly) => distToRing(p, poly[0]))));
const zoneOf = (p) => YARD_ZONES.find((z) => pointInRing(p, z.polygon))?.id;
const inWater = (p) => REAL.water.some((poly) => inPoly(p, poly));

// ---------- здания верфи: реальный контур + назначение с карты ----------

const mapBld = MAP_BUILDINGS_RAW.map((m) => ({ ...m, bb: bbox(m.poly), ring: ensureCCW(m.poly) }));
const slipPolys = Y.SLIPWAYS.map((s) => {
  const d = [Math.cos((s.angle * Math.PI) / 180), Math.sin((s.angle * Math.PI) / 180)];
  const n = [-d[1], d[0]];
  const w = s.width / 2 + 2;
  const e = add(s.head, mul(d, s.length));
  return ensureCCW([add(s.head, mul(n, w)), add(e, mul(n, w)), add(e, mul(n, -w)), add(s.head, mul(n, -w))]);
});
const SKIP_IDX = new Set([31, 40, 22, 34, 4, 81, 8, 9]); // подкрановые пути, настил моста, стапели

// Оценка высоты: у промзданий — по пролёту (ширине корпуса), как у типовых цехов
// (пролёт 18 м → ≈15 м, 24 м → ≈18 м, 30 м → ≈21 м; многопролётные — по пролёту 30–36 м).
const hallHeight = (wid) => Math.max(9, Math.min(28, 6 + 0.5 * Math.min(wid, 36)));
function estimate(A, len, wid, zone, cls) {
  if (cls === 'guardhouse') return { type: 'checkpoint', h: 4.5, floors: 1 };
  if (cls === 'office' || cls === 'commercial') return { type: 'office', h: 15, floors: 4 };
  if (A > 1200) return { type: 'hall', h: +hallHeight(wid).toFixed(1) };
  if (A > 450) {
    const type = len / wid > 2.4 ? 'warehouse' : 'office';
    return type === 'office' ? { type, h: 12, floors: 3 } : { type, h: 9 };
  }
  if (A > 150) return { type: 'utility', h: 6.5 };
  return { type: 'utility', h: 4.5 };
}

// Кровля и проёмы — по реальному контуру.
function decorate(b, named) {
  const ring = b.poly;
  const mr = minRect(ring);
  const rectish = !b.holes?.length && ring.length <= 6 && area(ring) / mr.area > 0.93;
  if (rectish) b.poly = ensureCCW(mr.corners);
  const quad = b.poly.length === 4;
  const span = Math.min(mr.w, mr.d);
  const long = Math.max(mr.w, mr.d);
  const shed = ['hall', 'elling', 'elling_historic', 'warehouse'].includes(b.type);
  let roof = { type: 'flat', color: b.roofColor };
  if (quad && shed) {
    const [c0, c1, , c3] = b.poly;
    const along = dist(c0, c3) > dist(c0, c1) ? 'd' : 'w';
    const bays = b.type === 'hall' && span > 44 ? Math.max(2, Math.round(span / 30)) : 1;
    roof = bays > 1
      ? { type: 'multigable', bays, along, h: 4, color: b.roofColor, lantern: true }
      : { type: 'gable', h: named?.roofH ?? Math.max(2.5, Math.min(10, span * 0.18)), color: b.roofColor, lantern: named?.lantern || (b.type === 'hall' && span > 25), ridge: along };
  } else if (quad && (named?.hip || b.type === 'historic')) {
    roof = { type: 'hip', h: 3, color: b.roofColor };
  } else if (quad && b.type === 'residential' && span < 24 && long < 120) {
    roof = { type: 'gable', h: 2.6 + (hash(b.id) % 10) / 10, color: b.roofColor, ridge: dist(b.poly[0], b.poly[1]) >= dist(b.poly[0], b.poly[3]) ? 'w' : 'd' };
  }
  b.roof = roof;
  // двери: ворота в торцах цехов, входы на длинных сторонах
  const edges = b.poly.map((a, i) => ({ i, L: dist(a, b.poly[(i + 1) % b.poly.length]) })).sort((x, y) => y.L - x.L);
  const doors = [];
  if (quad) {
    const wE = dist(b.poly[0], b.poly[1]);
    const dE = dist(b.poly[0], b.poly[3]);
    const shortE = wE < dE ? [0, 2] : [1, 3];
    const longE = wE < dE ? [1, 3] : [0, 2];
    if (shed) {
      const gw = Math.min(span * 0.45, b.type === 'elling' ? 22 : 12);
      const gh = Math.min(b.h - 2, b.type === 'elling' ? b.h * 0.8 : 9);
      for (const e of shortE) doors.push({ edge: e, t: 0.5, w: gw, h: gh, kind: 'gate' });
      doors.push({ edge: longE[0], t: 0.3, w: 2.2, h: 2.6 });
    } else if (b.type === 'utility') {
      doors.push({ edge: shortE[0], t: 0.5, w: 2.4, h: 2.8, kind: 'gate' });
    } else {
      doors.push({ edge: longE[0], t: 0.5, w: 3, h: 3, kind: b.kind === 'shipyard' ? 'main' : undefined, canopy: b.kind === 'shipyard' ? 2.5 : undefined });
      doors.push({ edge: longE[1], t: 0.5, w: 2.2, h: 2.6 });
    }
  } else if (edges.length) {
    const e0 = edges[0];
    if (shed && edges[1]) doors.push({ edge: edges[1].i, t: 0.5, w: Math.min(10, edges[1].L * 0.4), h: Math.min(b.h - 2, 8), kind: 'gate' });
    if (b.type === 'residential') {
      for (let t = 9; t < e0.L - 4; t += 18) doors.push({ edge: e0.i, t: t / e0.L, w: 1.7, h: 2.7 });
    } else doors.push({ edge: e0.i, t: 0.5, w: 2.4, h: 2.8 });
  }
  b.doors = doors;
  delete b.roofColor;
  return b;
}

// Здания у границы, которые OSM относит к городу, а карта предприятия — к верфи
// (например, корпуса вдоль Лоцманской ул., стоящие в линии ограды).
const CLAIMED = (() => {
  const ids = new Set();
  const maps = mapBld.filter((m) => !SKIP_IDX.has(m.index));
  for (const r of REAL.buildings) {
    if (r.yard) continue;
    const ring = ensureCCW(r.poly);
    const c = centroid(ring);
    if (distYard(c) > 40) continue;
    const bb = bbox(ring);
    const A = area(ring);
    if (maps.some((m) => bbOverlap(bb, m.bb) && overlap(ring, m.ring) > 0.5 * Math.min(A, m.area))) ids.add(r.id);
  }
  return ids;
})();

function yardBuildings() {
  const real = REAL.buildings.filter((r) => r.yard || CLAIMED.has(r.id)).map((r) => ({ ...r, ring: ensureCCW(r.poly), bb: bbox(r.poly), A: area(r.poly), hits: [] }));
  // ML-контуры на стапелях и над водой (суда, краны) — не здания
  const keep = real.filter((r) => {
    if (inWater(centroid(r.ring))) return false;
    return !slipPolys.some((sp) => overlap(r.ring, sp) > 0.4 * r.A);
  });
  const mapById = new Map(Y.BUILDINGS.map((b) => [b.mapIndex, b]));
  const maps = mapBld.filter((m) => !SKIP_IDX.has(m.index) && mapById.has(m.index)).map((m) => ({ ...m, hits: [] }));
  for (const r of keep) {
    for (const m of maps) {
      if (!bbOverlap(r.bb, m.bb)) continue;
      const ov = overlap(r.ring, m.ring);
      if (ov > 1) {
        r.hits.push({ m, ov });
        m.hits.push({ r, ov });
      }
    }
  }
  const out = [];
  const merged = [];
  const used = new Set();
  const fromMap = (m, note) => {
    used.add(m.index);
    const b = { ...mapById.get(m.index) };
    b.info = b.info.replace(/Контур — по карте предприятия[^.]*\./, '') + ` Контур — по карте предприятия (${note}). Высота оценена.`;
    b.zone = zoneOf(centroid(b.poly)) || b.zone;
    b.geomSrc = 'map';
    return b;
  };
  let k = 0;
  for (const r of keep) {
    // крупный объединённый контур OSM, в котором на карте предприятия несколько корпусов, —
    // заменяем корпусами карты, остаток — пониженной вставкой
    const inside = r.hits.filter((h) => h.ov > 0.6 * h.m.area);
    if (r.A > 3000 && !r.name && inside.length >= 2 && inside.reduce((s, h) => s + h.ov, 0) > 0.45 * r.A) {
      for (const h of inside) out.push(fromMap(h.m, 'в OpenStreetMap комплекс обозначен одним контуром'));
      merged.push(r);
      continue;
    }
    // обычный случай: реальный контур + назначение наиболее совпадающего корпуса карты
    const best = r.hits.filter((h) => h.ov > 0.3 * Math.min(r.A, h.m.area) && !used.has(h.m.index)).sort((x, y) => y.ov - x.ov)[0];
    const m = best?.m;
    const owner = m && !used.has(m.index) && m.hits.every((h) => h.r === r || h.ov <= best.ov);
    if (owner) used.add(m.index);
    const named = owner ? Y.NAMED[m.index] : null;
    const mr = minRect(r.ring);
    const len = Math.max(mr.w, mr.d);
    const wid = Math.min(mr.w, mr.d);
    const zone = zoneOf(centroid(r.ring)) || 'kolomna';
    const est = named ? { type: named.type, h: named.h, floors: named.floors } : estimate(r.A, len, wid, zone, r.cls);
    if (!named && zone === 'novo' && est.type === 'hall' && len / wid > 2.2) Object.assign(est, { type: 'elling', h: +Math.max(18, Math.min(34, wid * 0.9)).toFixed(1) });
    if (r.name && /проходн/i.test(r.name)) Object.assign(est, { type: 'checkpoint', h: 8, floors: 2 });
    const h = r.h || est.h;
    const idx = m ? m.index : 1000 + k++;
    const wall = named?.wall || (est.type === 'office' || est.type === 'checkpoint' ? Y.OFFICE_WALLS[idx % Y.OFFICE_WALLS.length] : est.type === 'utility' ? (idx % 3 ? 'light' : 'brick_dark') : Y.HALL_WALLS[idx % Y.HALL_WALLS.length]);
    const roofColor = named?.roof || (est.type === 'office' || est.type === 'utility' || est.type === 'checkpoint' ? 'r_dark' : Y.HALL_ROOFS[idx % Y.HALL_ROOFS.length]);
    const name = r.name || named?.name || Y.defaultName(est.type, r.A);
    out.push(decorate({
      kind: 'shipyard',
      id: owner ? `Z${m.index}` : `Y${r.id.slice(0, 6)}`,
      mapIndex: owner ? m.index : undefined,
      zone,
      name,
      info: `${named?.info ? named.info + ' ' : ''}Контур — ${r.src === 'osm' ? 'OpenStreetMap' : 'Microsoft ML Buildings (распознавание космоснимков)'}, ${Math.round(len)}×${Math.round(wid)} м. ${r.h ? 'Высота — по OpenStreetMap.' : 'Высота оценена по площади и типу здания.'}`,
      poly: r.ring,
      holes: r.holes,
      geomSrc: r.src,
      h,
      floors: r.floors || est.floors,
      type: est.type,
      wall,
      roofColor,
      sign: named?.sign || (r.name && /Центральная проходная/.test(r.name)) ? { edge: 0, text: 'АДМИРАЛТЕЙСКИЕ ВЕРФИ' } : undefined,
      approx: !r.h,
    }, named));
  }
  // корпуса карты, которых нет в открытых данных (если не перекрывают реальные проезды и воду)
  const roadRings = REAL.roads.filter((r) => r.yard).map((r) => ({ bb: bbox(r.line), line: r.line, half: Math.max(5, r.w) / 2 }));
  const onRoad = (ring) => {
    const bb = bbox(ring);
    const pts = [...ring, centroid(ring), ...ring.map((p, i) => [(p[0] + ring[(i + 1) % ring.length][0]) / 2, (p[1] + ring[(i + 1) % ring.length][1]) / 2])];
    return roadRings.some((r) => bbOverlap(bb, { minX: r.bb.minX - 6, maxX: r.bb.maxX + 6, minY: r.bb.minY - 6, maxY: r.bb.maxY + 6 }) && pts.some((p) => distToRing(p, r.line) < r.half && r.line.some((q, i) => i > 0 && segDist(p, r.line[i - 1], q) < r.half)));
  };
  for (const m of maps) {
    if (used.has(m.index)) continue;
    const covered = m.hits.reduce((s, h) => s + h.ov, 0);
    const c = centroid(m.ring);
    if (covered > 0.2 * m.area || !inYard(c) || m.area < 40) continue;
    if (m.ring.some((p) => inWater(p)) || onRoad(m.ring)) continue;
    if (slipPolys.some((sp) => overlap(m.ring, sp) > 0.4 * m.area)) continue;
    out.push(fromMap(m, 'в открытых данных этого здания нет'));
  }
  // остаток объединённых контуров OSM между корпусами карты — пониженная вставка
  for (const r of merged) {
    const others = out.filter((b) => bbOverlap(r.bb, bbox(b.poly))).map((b) => [[b.poly]]);
    let rest = [];
    try {
      rest = others.length ? pc.difference([[r.ring]], ...others) : [[r.ring]];
    } catch {
      rest = [];
    }
    for (const poly of rest) {
      const ring = ensureCCW(poly[0]);
      const A = area(ring);
      const mr = minRect(ring);
      if (A < 400 || Math.min(mr.w, mr.d) < 8 || A / mr.area < 0.5) continue;
      out.push(decorate({ kind: 'shipyard', id: `Y${r.id.slice(0, 5)}${k++}`, zone: zoneOf(centroid(ring)) || 'kolomna', name: 'Пристройка к производственному комплексу', info: 'Часть общего контура OpenStreetMap между корпусами карты предприятия. Высота оценена.', geomSrc: 'osm', poly: ring, holes: poly.slice(1), h: 10, type: 'hall', wall: 'light', roofColor: 'r_gray', approx: true }, null));
    }
  }
  // вывеска — на стороне, обращённой наружу территории
  for (const b of out) {
    if (!b.sign) continue;
    const z = YARD_ZONES.find((zz) => pointInRing(centroid(b.poly), zz.polygon));
    const away = z ? norm(sub(centroid(b.poly), centroid(z.polygon))) : [1, 0];
    let best = -Infinity;
    for (let i = 0; i < b.poly.length; i++) {
      const d = norm(sub(b.poly[(i + 1) % b.poly.length], b.poly[i]));
      const score = d[1] * away[0] - d[0] * away[1];
      if (score > best) {
        best = score;
        b.sign = { ...b.sign, edge: i };
      }
    }
  }
  return out;
}

// ---------- окружение ----------

const CITY_WALLS = ['ochre', 'yellow', 'cream', 'pink', 'terracotta', 'green', 'sand', 'light', 'blue_stucco', 'gray', 'ochre', 'yellow', 'cream'];
const CITY_ROOFS = ['r_gray', 'r_dark', 'r_rust', 'r_gray', 'r_green', 'r_gray'];
const TYPE_BY_CLS = {
  apartments: 'residential', residential: 'residential', dormitory: 'residential', house: 'residential',
  office: 'office', commercial: 'office', retail: 'office', public: 'office', hospital: 'office', university: 'office', school: 'office', kindergarten: 'office', transportation: 'office',
  church: 'historic', chapel: 'historic', synagogue: 'historic',
  industrial: 'hall', warehouse: 'warehouse', hangar: 'hall',
  garages: 'utility', garage: 'utility', shed: 'utility', service: 'utility', guardhouse: 'utility', kiosk: 'utility', toilets: 'utility', shelter: 'utility', pavilion: 'utility', grandstand: 'utility',
};
const DEFAULT_FLOORS = { residential: 5, office: 4, historic: 4, hall: 3, warehouse: 2, utility: 1 };

function contextBuildings() {
  const out = [];
  for (const r of REAL.buildings) {
    if (r.yard || CLAIMED.has(r.id) || r.cls === 'roof') continue;
    const ring = ensureCCW(r.poly);
    const A = area(ring);
    if (A < 25) continue;
    if (inWater(centroid(ring))) continue; // плавучие объекты (дебаркадеры, суда), отмеченные как здания
    const c = centroid(ring);
    if (/Красин/.test(r.name || '')) continue; // ледокол — отдельной моделью судна
    let type = TYPE_BY_CLS[r.cls] || (A < 70 ? 'utility' : 'residential');
    if (type === 'residential' && A < 70) type = 'utility';
    let h = r.h;
    if (!h) {
      const fl = type === 'utility' ? (A > 300 ? 2 : 1) : A < 160 && type === 'residential' ? 3 : DEFAULT_FLOORS[type];
      h = type === 'utility' ? fl * 3.2 : type === 'historic' ? 18 : fl * 3.4 + 0.8;
    }
    const hs = hash(r.id);
    const dY = distYard(c);
    const b = {
      kind: 'context',
      id: `C${r.id.slice(0, 7)}`,
      name: r.name || { residential: 'Жилой дом', office: 'Общественное здание', historic: 'Храм', hall: 'Производственное здание', warehouse: 'Склад', utility: 'Хозяйственная постройка' }[type],
      info: `Контур — ${r.src === 'osm' ? 'OpenStreetMap' : 'Microsoft ML Buildings'}${r.floors ? `, этажей: ${r.floors}` : ''}${r.h ? `, высота ${r.h} м` : ', высота оценена'}.`,
      poly: ring,
      holes: r.holes,
      h,
      floors: r.floors || undefined,
      type,
      wall: type === 'hall' || type === 'warehouse' ? 'panel' : CITY_WALLS[hs % CITY_WALLS.length],
      roofColor: CITY_ROOFS[(hs >> 4) % CITY_ROOFS.length],
      detail: dY < 150 ? 'full' : 'low',
      approx: !r.h,
      generated: true,
    };
    out.push(decorate(b, null));
  }
  return out;
}

// Ледокол «Красин» — по контуру из OSM
function krasin() {
  const r = REAL.buildings.find((b) => /Красин/.test(b.name || ''));
  if (!r) return [];
  const mr = minRect(ensureCCW(r.poly));
  const [c0, c1, , c3] = mr.corners;
  const longW = dist(c0, c1) >= dist(c0, c3);
  const ax = longW ? sub(c1, c0) : sub(c3, c0);
  return [{
    id: 'KR', name: 'Ледокол «Красин» (музейное судно)', info: 'Ледокол 1917 г., ныне музей; стоит у наб. Лейтенанта Шмидта. Положение — по OpenStreetMap.',
    hull: 'icebreaker', L: Math.max(mr.w, mr.d), B: Math.min(mr.w, mr.d), D: 12, T: 6, at: centroid(mr.corners), angle: angleOf(ax), afloat: true, stage: 'complete', hullColor: 'hull_black',
  }];
}

// ---------- улицы, проезды, мосты, площадки, ворота ----------

function streets() {
  return REAL.roads.filter((r) => !r.yard).map((r, i) => ({
    id: `s${i}`,
    name: r.name || 'проезд',
    w: r.w,
    line: r.line,
    frontage: 'none',
    sidewalk: ['primary', 'secondary', 'tertiary', 'residential', 'unclassified'].includes(r.cls) ? 3 : 0,
    kind: ['pedestrian', 'living_street', 'service'].includes(r.cls) ? 'local' : undefined,
    cls: r.cls,
  }));
}

function internalRoads() {
  return REAL.roads.filter((r) => r.yard).map((r, i) => ({ id: `R${i + 1}`, name: r.name || 'Внутризаводской проезд', w: Math.max(5, r.w), line: r.line }));
}

function bridges() {
  const real = REAL.bridges.map((b, i) => ({
    id: `B${i + 1}`,
    name: b.name || 'Мост',
    info: `${b.name ? b.name + '. ' : ''}Положение и размеры — по OpenStreetMap.`,
    type: /Старо-Калинкин/.test(b.name || '') ? 'kalinkin' : inYard(b.from) || inYard(b.to) ? 'industrial' : 'beam',
    from: b.from,
    to: b.to,
    w: Math.max(2.5, b.w),
  }));
  const mid = (b) => [(b.from[0] + b.to[0]) / 2, (b.from[1] + b.to[1]) / 2];
  const factory = Y.BRIDGES.filter((fb) => !real.some((rb) => dist(mid(rb), mid(fb)) < 30));
  return [...real, ...factory];
}

function areas() {
  return REAL.areas.map((a, i) => ({ id: `p${i}`, kind: a.kind, name: a.name || { garden: 'Сквер', lawn: 'Газон', square: 'Площадь' }[a.kind], polygon: a.poly }));
}

function gates() {
  return REAL.gates.map((g) => {
    const near = Y.GATES.slice().sort((a, b) => dist(a.at, g.at) - dist(b.at, g.at))[0];
    const name = g.name || (near && dist(near.at, g.at) < 60 ? near.name : g.kind === 'lift_gate' ? 'Шлагбаум' : 'Ворота');
    return { name, at: g.at, w: g.kind === 'lift_gate' ? 5 : 8 };
  });
}

// Названия улиц: по одной подписи на улицу у самого длинного участка
function streetLabels(list) {
  const best = new Map();
  for (const s of list) {
    if (!s.name || s.name === 'проезд' || !['primary', 'secondary', 'tertiary', 'residential'].includes(s.cls)) continue;
    const L = polylineLength(s.line);
    if (!best.has(s.name) || best.get(s.name).L < L) best.set(s.name, { L, s });
  }
  return [...best.values()].filter((x) => x.L > 120).map(({ s, L }) => ({ text: s.name, at: pointAt(s.line, L / 2).p, kind: 'street' }));
}

export function realTerritory() {
  const st = streets();
  const yb = yardBuildings();
  return {
    zones: YARD_ZONES,
    buildings: [...yb, ...contextBuildings()],
    streets: st,
    internalRoads: internalRoads(),
    bridges: bridges(),
    areas: areas(),
    gates: gates(),
    crossings: REAL.crossings.map((line) => ({ line })),
    ships: krasin(),
    water: REAL.water,
    bounds: REAL.bounds,
    streetLabels: streetLabels(st),
    source: REAL.source,
  };
}

export { REAL };
