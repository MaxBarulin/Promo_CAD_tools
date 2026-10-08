// Экспорт в GeoJSON (WGS84, [долгота, широта]) — для проверки и уточнения схемы
// на космоснимках: geojson.io, QGIS, JOSM, Яндекс/Google-карты (импорт слоёв).

import { toLatLon, bufferPolyline } from '../geo.js';

const ll = ([x, y]) => {
  const [lat, lon] = toLatLon([x, y]);
  return [+lon.toFixed(7), +lat.toFixed(7)];
};
const ring = (r) => {
  const pts = r.map(ll);
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  return pts;
};

export function buildGeoJSON(data, model) {
  const features = [];
  const add = (geometry, properties) => features.push({ type: 'Feature', geometry, properties });
  const P = model.planar;

  add({ type: 'MultiPolygon', coordinates: P.water.map((pl) => pl.map(ring)) }, { layer: 'water', name: 'Акватория (Большая Нева, Фонтанка, Мойка, Пряжка, каналы)' });
  for (const z of new Map(data.zones.map((zz) => [zz.id, zz])).values()) add({ type: 'MultiPolygon', coordinates: P.zones[z.id].map((pl) => pl.map(ring)) }, { layer: 'zone', id: z.id, name: z.name, kind: z.kind });

  for (const layer of model.layers) {
    for (const o of layer.objects) {
      if (!o.proxy || !o.info) continue;
      const base = { layer: layer.id, id: o.id, name: o.name, kind: o.info.kind, info: o.info.info || '', approx: !!o.info.approx };
      if (o.proxy.line) {
        add({ type: 'LineString', coordinates: o.proxy.line.map(ll) }, { ...base, height: o.proxy.h });
      } else {
        add({ type: 'Polygon', coordinates: [ring(o.proxy.poly)] }, { ...base, height: +(o.proxy.z1 - Math.max(0, o.proxy.z0)).toFixed(1), floors: o.info.floors ?? null, generated: !!o.generated });
      }
    }
  }
  for (const s of data.streets) add({ type: 'LineString', coordinates: s.line.map(ll) }, { layer: 'street', name: s.name, width: s.w });
  for (const r of data.internalRoads) add({ type: 'LineString', coordinates: r.line.map(ll) }, { layer: 'internal_road', name: r.name, width: r.w });
  for (const r of data.rails) add({ type: 'LineString', coordinates: r.line.map(ll) }, { layer: 'rail', name: r.name, gauge: r.gauge });
  for (const c of data.cranes) add({ type: 'Point', coordinates: ll(c.at) }, { layer: 'crane', id: c.id, name: c.name, type: c.type });
  for (const p of data.platforms || []) add({ type: 'Polygon', coordinates: [ring(p.poly)] }, { layer: 'platform', id: p.id, name: p.name, surface: p.surface, object_no: p.reg?.num ?? null, inv: p.reg?.inv || null, lit: p.reg?.lit || null });
  for (const m of data.markers || []) add({ type: 'Point', coordinates: ll(m.at) }, { layer: 'object_point', id: m.id, name: m.name, kind: m.kind, object_no: m.reg?.num ?? null, inv: m.reg?.inv || null, lit: m.reg?.lit || null });
  for (const l of [...data.labels, ...data.water.labels]) add({ type: 'Point', coordinates: ll(l.at) }, { layer: 'label', name: l.text });
  for (const b of data.bridges) add({ type: 'Polygon', coordinates: [ring(bufferPolyline([b.from, b.to], b.w / 2))] }, { layer: 'bridge', id: b.id, name: b.name });

  return {
    type: 'FeatureCollection',
    name: 'admiralty_shipyards_territory',
    metadata: {
      title: data.meta.title,
      crs: 'EPSG:4326',
      origin_local: data.meta.origin,
      accuracy: data.meta.accuracy,
    },
    features,
  };
}
