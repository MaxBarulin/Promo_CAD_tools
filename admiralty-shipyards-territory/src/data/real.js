// Территория по реальной геометрии (Overture Maps / OpenStreetMap, src/data/real-data.js).
//
// Отсюда берутся: граница территории верфи, контуры и высоты всех зданий, вода, улицы,
// внутризаводские проезды, мосты, скверы, ворота. Из исходного плана (после привязки
// к реальной границе, см. mapdata.js) — назначение и названия цехов, стапели, подкрановые
// пути, краны, суда, плавдоки.

import pc from 'polygon-clipping';
import REAL from './real-data.js';
import * as Y from './shipyard.js';
import { MAP_BUILDINGS_RAW, MAP_PIECES, px } from './mapdata.js';
import { minRect, hash, decorate } from './decorate.js';
import { straighten } from '../model/straighten.js';
import { PALETTE } from '../model/materials.js';
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

// ---------- участки территории ----------

const pieceCenters = Y.PIECE_INFO.map((z) => {
  const mp = MAP_PIECES.find((p) => Math.abs(p.cxPx - z.cx) < 60);
  return { ...z, c: centroid(mp.polygon) };
});

// территория верфи — без участков, которые заводу больше не принадлежат
const FOREIGN = Y.FOREIGN_AREAS.map((a) => ({ ...a, ring: ensureCCW(a.polygon) }));
const inForeign = (p) => FOREIGN.find((a) => pointInRing(p, a.ring));
const close = (r) => [...r, r[0]];
const YARD = FOREIGN.length
  ? pc.difference(REAL.yard.map((poly) => poly.map(close)), ...FOREIGN.map((a) => [[close(a.ring)]])).map((poly) => poly.map((r) => r.slice(0, -1)))
  : REAL.yard;

export const YARD_ZONES = YARD.map((poly) => {
  const c = centroid(poly[0]);
  const z = pieceCenters.slice().sort((a, b) => dist(a.c, c) - dist(b.c, c))[0];
  return { id: z.id, name: z.name, kind: 'shipyard', polygon: poly[0], holes: poly.slice(1), label: c };
});
const yardPolys = YARD;
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

// Здания у границы, которые OSM относит к городу, а исходный план — к верфи
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
    b.info = [b.info.trim(), 'Высота оценена.'].filter(Boolean).join(' ');
    b.zone = zoneOf(centroid(b.poly)) || b.zone;
    b.geomSrc = 'map';
    // контуры плана бывают с «дрожащими» стенами — выпрямляем, если это не искажает корпус
    // (прямоугольники карты уже ровные: у них ворота и кровля привязаны к сторонам)
    const st = b.poly.length > 4 ? straighten(b.poly) : null;
    if (st) {
      b.poly = st;
      if (st.length === 4) return decorate({ ...b, roofColor: b.roof?.color }, Y.NAMED[m.index]);
    }
    return b;
  };
  let k = 0;
  for (const r of keep) {
    // крупный объединённый контур OSM, в котором по исходному плану несколько корпусов, —
    // заменяем корпусами плана, остаток — пониженной вставкой
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
      // контуры, распознанные по космоснимкам, — с кривыми стенами; выпрямляем
      poly: r.src === 'ml' && !r.holes?.length ? straighten(r.ring) || r.ring : r.ring,
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
      out.push(decorate({ kind: 'shipyard', id: `Y${r.id.slice(0, 5)}${k++}`, zone: zoneOf(centroid(ring)) || 'kolomna', name: 'Пристройка к производственному комплексу', info: 'Часть общего контура OpenStreetMap между соседними корпусами. Высота оценена.', geomSrc: 'osm', poly: ring, holes: poly.slice(1), h: 10, type: 'hall', wall: 'light', roofColor: 'r_gray', approx: true }, null));
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
  // застройка участков, которые заводу больше не принадлежат: снесена; оставленные здания —
  // окружающая застройка
  return out.filter((b) => {
    const a = inForeign(centroid(b.poly));
    if (!a) return true;
    if (!a.keep?.includes(b.id)) return false;
    b.kind = 'context';
    b.zone = undefined;
    b.foreign = a.id;
    b.detail = 'full';
    b.info = `${b.info} ${a.name}: территория заводу не принадлежит.`;
    return true;
  });
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
    const look = osmLook(r, type, hs);
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
      wall: look.wall || (type === 'hall' || type === 'warehouse' ? 'panel' : CITY_WALLS[hs % CITY_WALLS.length]),
      roofColor: look.roofColor || CITY_ROOFS[(hs >> 4) % CITY_ROOFS.length],
      detail: dY < 150 ? 'full' : 'low',
      approx: !r.h,
      generated: true,
    };
    decorate(b, null);
    applyOsmRoof(b, r);
    if (r.parts) withParts(b, r, type, look);
    out.push(b);
  }
  return out;
}

// ---------- кровля, фасад и части зданий по тегам OSM (через Overture) ----------
const OSM_ROOF = { flat: 'flat', gabled: 'gable', round: 'gable', gambrel: 'gable', saltbox: 'gable', hipped: 'hip', half_hipped: 'hip', mansard: 'hip', pyramidal: 'pyramid', skillion: 'shed', dome: 'dome', onion: 'onion' };
const ROOF_KEYS = ['r_gray', 'r_dark', 'r_green', 'r_rust', 'r_light', 'r_blue', 'r_bitumen', 'r_gold', 'r_copper'];
const hexRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};
// ближайший по цвету материал палитры
function nearestKey(hex, keys) {
  const c = hexRgb(hex);
  if (!c) return null;
  let best = null;
  let bd = Infinity;
  for (const k of keys) {
    const p = hexRgb(PALETTE[k]?.color);
    if (!p) continue;
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}
// отделка по тегам: материал и цвет фасада, материал и цвет кровли
function osmLook(r, type, hs) {
  const out = {};
  if (r.fc) out.wall = nearestKey(r.fc, CITY_WALL_KEYS);
  else if (r.fm === 'brick') out.wall = hs % 3 ? 'brick' : 'brick_dark';
  else if (r.fm === 'glass') out.wall = 'glass_light';
  else if (r.fm === 'concrete') out.wall = 'panel';
  if (r.rc) out.roofColor = nearestKey(r.rc, ROOF_KEYS);
  else if (r.rm === 'tar_paper') out.roofColor = 'r_bitumen';
  else if (r.rm === 'copper') out.roofColor = 'r_copper';
  else if (r.rm === 'roof_tiles') out.roofColor = 'r_rust';
  else if (r.rm === 'metal') out.roofColor = hs % 2 ? 'r_gray' : 'r_green';
  return out;
}
const CITY_WALL_KEYS = ['light', 'white', 'gray', 'panel', 'brick', 'brick_dark', 'cream', 'yellow', 'ochre', 'sand', 'pink', 'terracotta', 'green', 'blue_stucco'];
// форма кровли из OSM вместо подобранной по типу здания; высота из OSM — до верха кровли
function applyOsmRoof(b, r) {
  const t = OSM_ROOF[r.roof];
  if (!t) return;
  const quad = b.poly.length === 4;
  if ((t === 'gable' || t === 'hip' || t === 'shed') && !quad) {
    b.roof = { type: 'flat', color: b.roof?.color };
    return;
  }
  const mr = minRect(b.poly);
  const span = Math.min(mr.w, mr.d);
  const rh = r.roofH ?? (t === 'flat' ? 0 : t === 'dome' || t === 'onion' ? undefined : t === 'shed' ? Math.min(3, span * 0.15) : Math.max(2, Math.min(8, span * 0.2)));
  b.roof = { type: t, h: rh, color: b.roof?.color || 'r_gray' };
  if (t === 'dome' && !r.rc && !r.rm) b.roof.color = 'r_copper';
  if (t === 'onion' && !r.rc && !r.rm) b.roof.color = 'r_gold';
  if (r.hTop && rh) b.h = Math.max(2, b.h - rh);
}
// части здания: каждая на своей отметке; основной объём — если части закрывают контур не целиком
function withParts(b, r, type, look) {
  const parts = [];
  for (const p of r.parts) {
    const ring = ensureCCW(p.poly);
    if (ring.length < 3) continue;
    const part = decorate({ kind: 'context', id: `${b.id}p`, type: type === 'residential' ? 'residential' : type, poly: ring, holes: p.holes, h: Math.max(1, p.h - p.minH), wall: osmLook(p, type, hash(b.id)).wall || look.wall || b.wall, roofColor: osmLook(p, type, 0).roofColor || b.roof?.color || 'r_gray' }, null);
    applyOsmRoof(part, { ...p, h: undefined });
    if (p.hTop && part.roof?.h && part.roof.type !== 'flat') part.h = Math.max(1, part.h - part.roof.h);
    parts.push({ ...part, minH: p.minH, doors: p.minH > 0.5 ? [] : part.doors });
  }
  if (!parts.length) return;
  b.parts = parts;
  const top = Math.max(...parts.map((p) => p.minH + p.h));
  b.bodyH = r.cover < 0.7 ? r.hOwn || Math.min(...parts.map((p) => p.minH).filter((z) => z > 0.5), b.h) || b.h : 0;
  b.h = Math.max(top, b.bodyH || 0);
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

// части линии вне участков, которые заводу больше не принадлежат (шаг проверки — step м;
// остаются вершины линии и точки выхода на границу участка)
function outsideForeign(line, step = 1) {
  if (!FOREIGN.length || !line.some((p) => inForeign(p)) && !FOREIGN.some((a) => line.some((p, i) => i && segCrossesRing(line[i - 1], p, a.ring)))) return [line];
  const runs = [];
  let cur = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      const vertex = k === 0 || k === n;
      if (inForeign(p)) {
        cur = null;
        continue;
      }
      if (!cur) runs.push((cur = { pts: [], last: null }));
      if (!cur.pts.length || vertex) cur.pts.push(p);
      cur.last = p;
      cur.lastVertex = vertex;
    }
  }
  return runs
    .map((r) => (r.lastVertex ? r.pts : [...r.pts, r.last]))
    .filter((r) => r.length >= 2 && polylineLength(r) > 3);
}
function segCrossesRing(p, q, ring) {
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return ring.some((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return cr(p, q, a) * cr(p, q, b) < 0 && cr(a, b, p) * cr(a, b, q) < 0;
  });
}

function internalRoads() {
  return REAL.roads
    .filter((r) => r.yard)
    .flatMap((r, i) => outsideForeign(r.line).map((line, k) => ({ id: k ? `R${i + 1}-${k + 1}` : `R${i + 1}`, name: r.name || 'Внутризаводской проезд', w: Math.max(5, r.w), line })));
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
  return REAL.gates.filter((g) => !Y.NO_GATES.some((n) => dist(n.at, g.at) < 12)).map((g) => {
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
    // участки, отошедшие от завода: сам участок — в пределах прежней границы верфи
    foreignAreas: FOREIGN.map(({ ring, ...a }) => ({ ...a, site: pc.intersection(REAL.yard.map((poly) => poly.map(close)), [[close(ring)]]).map((poly) => poly.map((r) => r.slice(0, -1))) })),
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
