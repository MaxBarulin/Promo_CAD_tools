// Преобразование ответа Overpass API (out geom) в «слой уточнения» модели:
// реальные контуры зданий с высотами, водные объекты, ограждения, улицы.
// Результат подмешивается к схеме в src/data/index.js (см. applyOverlay).

import { fromLatLon, ensureCCW, area, centroid, pointInRing } from '../geo.js';

const toXY = (g) => g.map((p) => {
  const [x, y] = fromLatLon(p.lat, p.lon);
  return [+x.toFixed(2), +y.toFixed(2)];
});

const closed = (r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
const open = (r) => (closed(r) ? r.slice(0, -1) : r);

// Сборка колец мультиполигона из отрезков-путей.
function assembleRings(ways) {
  const segs = ways.map((w) => w.slice());
  const rings = [];
  const key = (p) => `${p[0]},${p[1]}`;
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 1000) {
      const end = key(ring[ring.length - 1]);
      const i = segs.findIndex((s) => key(s[0]) === end || key(s[s.length - 1]) === end);
      if (i < 0) break;
      const s = segs.splice(i, 1)[0];
      ring = ring.concat(key(s[0]) === end ? s.slice(1) : s.slice().reverse().slice(1));
    }
    if (ring.length >= 4) rings.push(open(ring));
  }
  return rings;
}

function levelsHeight(tags, fallback) {
  const h = parseFloat(String(tags.height || '').replace(',', '.'));
  if (Number.isFinite(h) && h > 0) return h;
  const lv = parseFloat(tags['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return lv * 3.4 + 0.6;
  return fallback;
}

function buildingType(tags) {
  const b = tags.building;
  if (['industrial', 'manufacture', 'shed', 'hangar', 'boathouse'].includes(b)) return 'hall';
  if (['warehouse', 'storage_tank', 'garage', 'garages'].includes(b)) return 'warehouse';
  if (['office', 'commercial', 'public', 'government', 'civic', 'university', 'school', 'hospital'].includes(b)) return 'office';
  if (['apartments', 'residential', 'house', 'dormitory'].includes(b)) return 'residential';
  if (['service', 'transformer_tower', 'kiosk'].includes(b)) return 'utility';
  if (tags.historic || tags['heritage']) return 'historic';
  return 'residential';
}

const WALL_BY_TYPE = { hall: 'blue_gray', warehouse: 'panel', office: 'light', residential: 'ochre', utility: 'gray', historic: 'yellow' };
const STREET_W = { primary: 16, secondary: 14, tertiary: 12, residential: 9, unclassified: 9, living_street: 7, service: 6, pedestrian: 6 };

// shipyardZones — полигоны территории верфи из схемы (для разделения «верфь / окружение»).
export function convertOverpass(json, { shipyardZones = [] } = {}) {
  const out = { source: 'OpenStreetMap (© участники OpenStreetMap, ODbL)', fetched: json.osm3s?.timestamp_osm_base || null, buildings: [], water: [], fences: [], streets: [], parks: [] };
  const inYard = (p) => shipyardZones.some((z) => pointInRing(p, z));
  let n = 0;
  for (const el of json.elements || []) {
    const tags = el.tags || {};
    let rings = [];
    if (el.type === 'way' && el.geometry) rings = [toXY(el.geometry)];
    if (el.type === 'relation' && el.members) {
      const outer = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => toXY(m.geometry));
      rings = assembleRings(outer);
    }
    if (!rings.length) continue;

    if (tags.building && tags.building !== 'no' && tags.building !== 'roof') {
      for (const r0 of rings) {
        const r = ensureCCW(open(r0));
        if (r.length < 3 || area(r) < 12) continue;
        const c = centroid(r);
        const yard = inYard(c);
        const type = buildingType(tags);
        const h = levelsHeight(tags, type === 'hall' ? 16 : type === 'warehouse' ? 9 : type === 'utility' ? 5 : 18);
        out.buildings.push({
          kind: yard ? 'shipyard' : 'context',
          id: `osm-${el.type[0]}${el.id}${rings.length > 1 ? '-' + ++n : ''}`,
          name: tags.name || tags['addr:street'] ? [tags.name, [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ')].filter(Boolean).join(' — ') : yard ? 'Здание верфи (OSM)' : 'Здание (OSM)',
          info: `Контур и высота по OpenStreetMap: building=${tags.building}${tags['building:levels'] ? `, этажей ${tags['building:levels']}` : ''}${tags.height ? `, высота ${tags.height} м` : ''}.`,
          poly: r,
          h: +h.toFixed(1),
          floors: tags['building:levels'] ? +tags['building:levels'] : undefined,
          type,
          wall: WALL_BY_TYPE[type] || 'light',
          roof: { type: r.length === 4 && type !== 'office' ? 'gable' : 'flat', h: 2.5, color: type === 'hall' ? 'r_light' : 'r_gray' },
          osm: true,
          detail: yard || area(r) > 200 ? 'full' : 'low',
        });
      }
      continue;
    }
    if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water) {
      for (const r of rings) if (closed(r) || el.type === 'relation') out.water.push(open(r));
      continue;
    }
    if (tags.barrier === 'fence' || tags.barrier === 'wall') {
      out.fences.push({ line: rings[0], type: tags.barrier === 'wall' ? 'wall' : inYard(rings[0][0]) ? 'concrete' : 'mesh', h: parseFloat(tags.height) || (tags.barrier === 'wall' ? 3 : 2.5) });
      continue;
    }
    if (tags.highway && STREET_W[tags.highway] && el.type === 'way') {
      out.streets.push({ name: tags.name || '', w: tags.width ? parseFloat(tags.width) : STREET_W[tags.highway], line: rings[0], service: tags.highway === 'service' });
      continue;
    }
    if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass') {
      for (const r of rings) out.parks.push(open(r));
    }
  }
  return out;
}

// Запрос Overpass для прямоугольника в WGS84 (юг, запад, север, восток).
export function overpassQuery([s, w, n, e]) {
  const bb = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  return `[out:json][timeout:180];
(
  way["building"](${bb});
  relation["building"](${bb});
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["waterway"="riverbank"](${bb});
  way["barrier"~"^(fence|wall)$"](${bb});
  way["highway"](${bb});
  way["leisure"~"^(park|garden)$"](${bb});
  way["landuse"="grass"](${bb});
);
out geom;`;
}
