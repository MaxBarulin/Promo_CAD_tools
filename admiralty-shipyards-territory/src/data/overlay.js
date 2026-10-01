// Подмешивание данных OpenStreetMap к схеме.
// Геометрия зданий, воды, улиц и ограждений берётся из OSM; названия, описания и
// оформление зданий верфи переносятся со схемы на совпавшие OSM-контуры.
// Стапели, краны, суда, доки и мосты остаются из схемы.

import { centroid, pointInRing, area } from '../geo.js';

export function applyOverlay(data, ov) {
  if (!ov) return data;
  const report = { matched: [], unmatched: [] };
  const out = { ...data, meta: { ...data.meta, source: 'osm', osm: { fetched: ov.fetched, attribution: ov.source } } };

  // здания: переносим имена схемы на OSM-контуры
  const osmB = ov.buildings.map((b) => ({ ...b }));
  const schemaYard = data.buildings.filter((b) => b.kind === 'shipyard');
  for (const sb of schemaYard) {
    const c = centroid(sb.poly);
    const hit = osmB.filter((b) => pointInRing(c, b.poly)).sort((a, b) => area(a.poly) - area(b.poly))[0];
    if (hit && !hit.matched) {
      Object.assign(hit, {
        id: sb.id,
        name: sb.name,
        info: sb.info + ' Контур — по OpenStreetMap.',
        kind: 'shipyard',
        zone: sb.zone,
        type: sb.type,
        wall: sb.wall,
        roof: sb.roof,
        h: hit.h && hit.h !== 16 && hit.h !== 18 ? hit.h : sb.h,
        floors: sb.floors ?? hit.floors,
        portico: sb.portico,
        sign: sb.sign,
        approx: false,
        matched: true,
      });
      report.matched.push(sb.id);
    } else report.unmatched.push(sb.id);
  }
  // знаковые здания окружения из схемы, не совпавшие ни с одним OSM-контуром, сохраняем
  const keepContext = data.buildings.filter((b) => b.kind === 'context' && !osmB.some((o) => pointInRing(centroid(b.poly), o.poly)));
  out.buildings = [...osmB, ...keepContext];
  out.frontage = false;

  if (ov.water && ov.water.length) out.water = { ...data.water, osmPolygons: ov.water };
  if (ov.fences && ov.fences.length > 3) {
    out.fences = ov.fences.map((f, i) => ({ id: `OF${i + 1}`, name: 'Ограждение (OSM)', type: f.type, h: f.h, line: f.line }));
    out.autoFence = false;
  }
  if (ov.streets && ov.streets.length) {
    const yard = data.zones.filter((z) => z.kind === 'shipyard').map((z) => z.polygon);
    const inYard = (l) => yard.some((z) => pointInRing(l[Math.floor(l.length / 2)], z));
    out.streets = ov.streets.filter((s) => !inYard(s.line)).map((s, i) => ({ id: `os${i}`, name: s.name || 'улица', w: s.w, line: s.line, frontage: 'none', kind: s.service ? 'local' : undefined }));
    const internal = ov.streets.filter((s) => inYard(s.line));
    if (internal.length) out.internalRoads = internal.map((s, i) => ({ id: `oi${i}`, name: s.name || 'внутризаводской проезд', w: Math.max(5, s.w), line: s.line }));
  }
  if (ov.parks && ov.parks.length) out.areas = [...data.areas, ...ov.parks.map((p, i) => ({ id: `op${i}`, kind: 'garden', name: 'Сквер (OSM)', polygon: p }))];
  out.overlayReport = report;
  return out;
}
