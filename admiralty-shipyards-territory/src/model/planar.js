// Плановая (2D) геометрия: вода, суша, зоны, улицы, тротуары, площадки.
// Булевы операции — библиотека polygon-clipping (формат MultiPolygon: [[outer, ...holes], ...]).

import pc from 'polygon-clipping';
import { bufferPolyline, rect, bbox, ensureCCW, ensureCW, area } from '../geo.js';
import { dedupe } from './geom.js';

export const Z = {
  water: -2.4,
  quayBottom: -3.4,
  base: -9,
  ground: 0,
  internalRoad: 0.05,
  area: 0.03,
  carriageway: 0.06,
  sidewalk: 0.2,
  square: 0.12,
  garden: 0.18,
  marking: 0.075,
};

const toMP = (ring) => [[ring.map((p) => [p[0], p[1]])]];

export function mpArea(mp) {
  let s = 0;
  for (const poly of mp) {
    s += area(poly[0]);
    for (let i = 1; i < poly.length; i++) s -= area(poly[i]);
  }
  return s;
}

export function cleanMP(mp) {
  return mp
    .map((poly) => poly.map((r, i) => (i === 0 ? ensureCCW(dedupe(r)) : ensureCW(dedupe(r)))).filter((r) => r.length >= 3))
    .filter((poly) => poly.length && area(poly[0]) > 0.5);
}

// polygon-clipping иногда не может замкнуть кольцо на почти совпадающих рёбрах —
// повторяем операцию с округлением координат.
const roundMP = (mp, q) => mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(x / q) * q, Math.round(y / q) * q])));
function robust(op, args) {
  try {
    return op(...args);
  } catch (e) {
    for (const q of [0.01, 0.05, 0.2]) {
      try {
        return op(...args.map((a) => roundMP(a, q)));
      } catch (e2) {
        /* следующая попытка */
      }
    }
    throw e;
  }
}

export function safeUnion(list) {
  const items = list.filter((x) => x && x.length);
  if (!items.length) return [];
  let acc = items[0];
  // объединяем порциями — быстрее и устойчивее
  for (let i = 1; i < items.length; i += 8) acc = robust(pc.union, [acc, ...items.slice(i, i + 8)]);
  return acc;
}

export function inter(a, b) {
  if (!a.length || !b.length) return [];
  return robust(pc.intersection, [a, b]);
}

export function diff(a, ...b) {
  const bs = b.filter((x) => x && x.length);
  if (!a.length) return [];
  if (!bs.length) return a;
  return robust(pc.difference, [a, ...bs]);
}

// Признак с ограничивающим прямоугольником для быстрых проверок пересечений.
export function feature(mp, meta = {}) {
  const pts = mp.flatMap((poly) => poly[0]);
  return { mp, bb: pts.length ? bbox(pts) : null, ...meta };
}

const bbOverlap = (a, b) => a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

export function overlapArea(ring, features) {
  const pts = ring;
  const bb = bbox(pts);
  const mp = toMP(ring);
  let s = 0;
  for (const f of features) {
    if (!bbOverlap(bb, f.bb)) continue;
    s += mpArea(robust(pc.intersection, [mp, f.mp]));
  }
  return s;
}

export function buildPlanar(data) {
  const B = data.meta.bounds;
  const bboxRing = [
    [B.minX, B.minY],
    [B.maxX, B.minY],
    [B.maxX, B.maxY],
    [B.minX, B.maxY],
  ];
  const bboxMP = toMP(bboxRing);

  // --- вода ---
  // Акватория у верфи — с карты предприятия; Нева за пределами карты — полигон NEVA;
  // из них вычитается суша, изображённая на карте фоном (Васильевский о., Английская наб.).
  // Реки за пределами карты добавляются буферами осевых линий; участки верфи — всегда суша.
  const osmWater = data.water.osmPolygons;
  const riverFeatures = [];
  let water;
  const zoneMP = (z) => [[z.polygon.map((p) => [p[0], p[1]]), ...(z.holes || []).map((h) => h.map((p) => [p[0], p[1]]))]];
  if (data.water.real) {
    // реальная вода (Overture/OSM); территория верфи — всегда суша
    const yardMP = safeUnion(data.zones.filter((z) => z.kind === 'shipyard').map(zoneMP));
    water = cleanMP(inter(diff(safeUnion(data.water.real.map((poly) => [poly])), yardMP), bboxMP));
  } else if (osmWater) {
    water = cleanMP(inter(safeUnion(osmWater.map(toMP)), bboxMP));
  } else {
    const base = safeUnion([toMP(data.water.neva.polygon), ...(data.water.map || []).map(toMP)]);
    const open = diff(base, ...(data.water.cuts || []).map((c) => toMP(c.polygon)));
    const parts = [open];
    for (const r of data.water.rivers) {
      const mp = toMP(bufferPolyline(r.line, r.width / 2, { capExtend: 6 }));
      parts.push(mp);
      riverFeatures.push(feature(inter(mp, bboxMP), { id: r.id, name: r.name }));
    }
    water = cleanMP(inter(diff(safeUnion(parts), ...(data.landPieces || []).map(toMP)), bboxMP));
  }
  const land = cleanMP(diff(bboxMP, water));

  // --- зоны ---
  const zones = {};
  for (const z of data.zones) {
    const mp = cleanMP(inter(zoneMP(z), land));
    zones[z.id] = zones[z.id] ? cleanMP(safeUnion([zones[z.id], mp])) : mp;
  }
  const shipyardMP = safeUnion(data.zones.filter((z) => z.kind === 'shipyard').map((z) => zones[z.id]));
  const civilMP = safeUnion(data.zones.filter((z) => z.kind === 'civil').map((z) => zones[z.id]));
  const cityGround = cleanMP(diff(land, shipyardMP, civilMP));

  // --- улицы ---
  const streetFeatures = [];
  const carriageways = [];
  const sidewalkOuter = [];
  for (const s of data.streets) {
    const sw = s.kind === 'local' ? 0 : s.sidewalk ?? 3;
    const cw = toMP(bufferPolyline(s.line, s.w / 2, { capExtend: s.kind === 'local' ? 0 : 3 }));
    carriageways.push(cw);
    if (sw > 0) sidewalkOuter.push(toMP(bufferPolyline(s.line, s.w / 2 + sw, { capExtend: 3 })));
    streetFeatures.push(feature(toMP(bufferPolyline(s.line, s.w / 2 + sw + 0.3, { capExtend: 3 })), { id: s.id }));
  }
  const cwUnion = cleanMP(inter(safeUnion(carriageways), land));
  const areaPolys = data.areas.map((a) => toMP(a.polygon));
  const cityAreas = safeUnion(data.areas.filter((a) => !a.id.startsWith('A')).map((a) => toMP(a.polygon)));
  let sidewalks = diff(safeUnion(sidewalkOuter), cwUnion, cityAreas);
  sidewalks = cleanMP(inter(sidewalks, land));

  // --- внутризаводские дороги ---
  const internal = data.internalRoads.map((r) => toMP(bufferPolyline(r.line, r.w / 2, { capExtend: 1 })));
  const internalUnion = cleanMP(diff(inter(safeUnion(internal), land), cwUnion));
  const internalFeatures = internal.map((mp, i) => feature(mp, { id: data.internalRoads[i].id }));

  // --- площадки ---
  const areas = data.areas.map((a, i) => ({ ...a, mp: cleanMP(diff(inter(areaPolys[i], land), cwUnion)) }));

  // --- мосты (пятна) ---
  const bridgeFeatures = data.bridges.map((b) => {
    const ring = bufferPolyline([b.from, b.to], b.w / 2 + 1, { capExtend: 2 });
    return feature(toMP(ring), { id: b.id });
  });

  return {
    bboxRing,
    water,
    land,
    zones,
    shipyardMP: cleanMP(shipyardMP),
    civilMP: cleanMP(civilMP),
    cityGround,
    carriageways: cwUnion,
    sidewalks,
    internal: internalUnion,
    areas,
    features: {
      water: [feature(water, { id: 'water' }), ...riverFeatures],
      neva: feature(water, { id: 'water' }),
      streets: streetFeatures,
      internal: internalFeatures,
      zones: [...new Map(data.zones.map((z) => [z.id, z])).values()].map((z) => feature(zones[z.id], { id: z.id, kind: z.kind })),
      areas: areas.map((a) => feature(a.mp, { id: a.id, kind: a.kind })),
      bridges: bridgeFeatures,
    },
  };
}

export { rect };
