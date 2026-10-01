// Экспорт генплана в DXF (формат R12, ASCII) для AutoCAD / nanoCAD / КОМПАС / LibreCAD.
// Единицы — метры, локальная система координат модели (x — восток, y — север,
// начало — площадь Репина, WGS84 59.91694 N, 30.27948 E). Контуры зданий — замкнутые
// полилинии с «высотой» (thickness), поэтому в 3D-виде они показываются как объёмы.
// Кириллица в подписях кодируется последовательностями \U+XXXX.

import { bufferPolyline, centroid, ensureCCW, pointAt } from '../geo.js';
import { ORIGIN } from '../geo.js';

const LAYERS = [
  ['WATER', 5],
  ['LAND_EDGE', 8],
  ['ZONE_SHIPYARD', 1],
  ['ZONE_CIVIL', 3],
  ['BUILDINGS_SHIPYARD', 6],
  ['BUILDINGS_CONTEXT', 9],
  ['FENCE', 1],
  ['FENCE_GATES', 2],
  ['ROADS_CITY', 8],
  ['ROADS_INTERNAL', 250],
  ['SIDEWALKS', 9],
  ['RAILS', 30],
  ['SLIPWAYS', 4],
  ['BRIDGES', 34],
  ['CRANES', 2],
  ['VESSELS', 140],
  ['DOCKS', 150],
  ['AREAS', 62],
  ['LABELS', 7],
];

const esc = (s) =>
  String(s)
    .split('')
    .map((ch) => {
      const c = ch.codePointAt(0);
      return c < 128 ? ch : '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
    })
    .join('');

const f = (n) => (Math.round(n * 1000) / 1000).toString();

export function buildDXF(data, model) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));

  // HEADER
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSBASE');
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(9, '$EXTMIN');
  g(10, data.meta.bounds.minX);
  g(20, data.meta.bounds.minY);
  g(30, 0);
  g(9, '$EXTMAX');
  g(10, data.meta.bounds.maxX);
  g(20, data.meta.bounds.maxY);
  g(30, 60);
  g(0, 'ENDSEC');

  // TABLES / LAYER
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  g(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  g(70, 0);
  g(3, 'Solid line');
  g(72, 65);
  g(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, LAYERS.length);
  for (const [name, color] of LAYERS) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ENTITIES
  g(0, 'SECTION');
  g(2, 'ENTITIES');

  const poly = (layer, pts, { closed = true, elevation = 0, thickness = 0 } = {}) => {
    if (pts.length < 2) return;
    g(0, 'POLYLINE');
    g(8, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, f(elevation));
    if (thickness) g(39, f(thickness));
    g(70, closed ? 1 : 0);
    for (const p of pts) {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, f(p[0]));
      g(20, f(p[1]));
      g(30, f(elevation));
    }
    g(0, 'SEQEND');
    g(8, layer);
  };
  const text = (layer, p, h, s, rot = 0) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, f(p[0]));
    g(20, f(p[1]));
    g(30, 0);
    g(40, f(h));
    g(1, esc(s));
    if (rot) g(50, f(rot));
  };
  const circle = (layer, p, r) => {
    g(0, 'CIRCLE');
    g(8, layer);
    g(10, f(p[0]));
    g(20, f(p[1]));
    g(30, 0);
    g(40, f(r));
  };

  const P = model.planar;
  for (const mp of [P.water]) for (const pl of mp) for (const ring of pl) poly('WATER', ring);
  for (const pl of P.land) for (const ring of pl) poly('LAND_EDGE', ring);
  // участок может состоять из нескольких частей с одним кодом — контур у них общий
  for (const z of new Map(data.zones.map((zz) => [zz.id, zz])).values()) for (const pl of P.zones[z.id]) poly(z.kind === 'shipyard' ? 'ZONE_SHIPYARD' : 'ZONE_CIVIL', pl[0]);
  for (const pl of P.carriageways) for (const ring of pl) poly('ROADS_CITY', ring);
  for (const pl of P.sidewalks) for (const ring of pl) poly('SIDEWALKS', ring);
  for (const pl of P.internal) for (const ring of pl) poly('ROADS_INTERNAL', ring);
  for (const a of P.areas) for (const pl of a.mp) poly('AREAS', pl[0]);

  for (const layer of model.layers) {
    for (const o of layer.objects) {
      if (!o.proxy) continue;
      const kind = o.info?.kind;
      if (kind === 'building' || kind === 'context') {
        const h = o.proxy.z1 - o.proxy.z0;
        poly(kind === 'building' ? 'BUILDINGS_SHIPYARD' : 'BUILDINGS_CONTEXT', o.proxy.poly, { thickness: h });
        if (!o.generated) text('LABELS', centroid(o.proxy.poly), kind === 'building' ? 3 : 2, o.name);
      }
    }
  }

  for (const fe of data.fences) {
    poly('FENCE', fe.line, { closed: false });
    for (const gt of fe.gates || []) text('FENCE_GATES', pointAt(fe.line, gt.s).p, 1.5, gt.name);
  }
  for (const r of data.rails) {
    for (const side of [-r.gauge / 2, r.gauge / 2]) {
      const ring = bufferPolyline(r.line, Math.abs(side) + 0.05);
      poly('RAILS', ring);
    }
  }
  for (const s of data.slipways) {
    const end = [s.head[0] + Math.cos((s.angle * Math.PI) / 180) * s.length, s.head[1] + Math.sin((s.angle * Math.PI) / 180) * s.length];
    poly('SLIPWAYS', bufferPolyline([s.head, end], s.width / 2));
    text('LABELS', s.head, 4, s.name);
  }
  for (const b of data.bridges) {
    poly('BRIDGES', bufferPolyline([b.from, b.to], b.w / 2));
    text('LABELS', b.from, 2.5, b.name);
  }
  for (const c of data.cranes) {
    circle('CRANES', c.at, c.type === 'gantry' ? 2 : 6);
    text('CRANES', [c.at[0] + 7, c.at[1]], 1.5, c.name);
  }
  for (const s of data.ships) {
    const a = (s.angle * Math.PI) / 180;
    const d = [Math.cos(a), Math.sin(a)];
    const n = [-d[1], d[0]];
    const L = s.L / 2;
    const B = s.B / 2;
    const at = s.at;
    const pts = [
      [at[0] - d[0] * L - n[0] * B, at[1] - d[1] * L - n[1] * B],
      [at[0] + d[0] * (L - B) - n[0] * B, at[1] + d[1] * (L - B) - n[1] * B],
      [at[0] + d[0] * L, at[1] + d[1] * L],
      [at[0] + d[0] * (L - B) + n[0] * B, at[1] + d[1] * (L - B) + n[1] * B],
      [at[0] - d[0] * L + n[0] * B, at[1] - d[1] * L + n[1] * B],
    ];
    poly('VESSELS', ensureCCW(pts));
    text('LABELS', at, 2.5, s.name);
  }
  for (const d of data.docks) {
    const a = (d.angle * Math.PI) / 180;
    const u = [Math.cos(a), Math.sin(a)];
    const v = [-u[1], u[0]];
    const c = d.at;
    poly('DOCKS', [
      [c[0] - u[0] * d.L / 2 - v[0] * d.B / 2, c[1] - u[1] * d.L / 2 - v[1] * d.B / 2],
      [c[0] + u[0] * d.L / 2 - v[0] * d.B / 2, c[1] + u[1] * d.L / 2 - v[1] * d.B / 2],
      [c[0] + u[0] * d.L / 2 + v[0] * d.B / 2, c[1] + u[1] * d.L / 2 + v[1] * d.B / 2],
      [c[0] - u[0] * d.L / 2 + v[0] * d.B / 2, c[1] - u[1] * d.L / 2 + v[1] * d.B / 2],
    ]);
    text('LABELS', c, 2.5, d.name);
  }
  for (const l of [...data.labels, ...data.water.labels]) text('LABELS', l.at, l.kind === 'island' ? 12 : 6, l.text);
  text('LABELS', [data.meta.bounds.minX + 20, data.meta.bounds.minY + 20], 6, `АО «Адмиралтейские верфи» — генплан (схема). Начало координат: ${ORIGIN.name}, ${ORIGIN.lat} N, ${ORIGIN.lon} E. Единицы: м.`);

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
