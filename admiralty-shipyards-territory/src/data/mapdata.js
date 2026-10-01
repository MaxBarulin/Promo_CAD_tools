// Привязка карты предприятия (data/source/enterprise-map.png) к системе координат модели.
//
// Преобразование «пиксель → метры» подобрано tools/register_map.py: контуры участков с карты
// совмещены с реальной границей территории верфи из открытых данных (OpenStreetMap через
// Overture Maps, src/data/real-data.js). Совпадение площадей 89 %, медианное отклонение
// контура ≈3 м; масштаб 1,502 м/пикс. Ось y карты направлена вниз.

import TRACE from './map-trace.js';
import { ensureCCW, area, centroid, dist, sub, norm } from '../geo.js';

// X = a·x + b·y + c,  Y = d·x + e·y + f  (x, y — пиксели карты; X, Y — метры модели)
export const GEOREF = {
  matrix: [
    [0.422823, 1.441015, -1133.455431],
    [1.441015, -0.422823, -472.407934],
  ],
  scale: 1.502,
  method: 'подбор по реальной границе территории (tools/register_map.py)',
};
const [[A, B, C], [D, E, F]] = GEOREF.matrix;
const DET = A * E - B * D;

// Пиксель карты → метры модели (x — восток, y — север).
export function px(x, y) {
  return [+(A * x + B * y + C).toFixed(2), +(D * x + E * y + F).toFixed(2)];
}

// Метры модели → пиксель карты (обратное преобразование).
export function toPx([X, Y]) {
  const u = X - C;
  const v = Y - F;
  return [(E * u - B * v) / DET, (-D * u + A * v) / DET];
}

// Направление в модели (градусы от востока против часовой) для вектора в пикселях.
export function pxAngle(dx, dy) {
  return (Math.atan2(D * dx + E * dy, A * dx + B * dy) * 180) / Math.PI;
}

const conv = (poly) => ensureCCW(poly.map(([x, y]) => px(x, y)));

export const MAP_PIECES = TRACE.pieces.map((p) => ({ cxPx: p.cx, cyPx: p.cy, polygon: conv(p.poly) }));
export const MAP_WATER = TRACE.water.map((w) => conv(w.poly));
// «Коридор» акватории: внутри него всё, что не территория верфи, — вода (без щелей по контуру).
export const MAP_CORRIDOR = conv(TRACE.corridor);
// Внутризаводские проезды (пиксели карты), проложенные tools/trace_map.py
export const MAP_ROADS = TRACE.roads || [];
export const MAP_BRIDGES = TRACE.bridges.map((b) => ({ ...b, from: px(...b.a), to: px(...b.b), w: b.w * GEOREF.scale }));

// Участок по положению на карте (координата x пикселя).
export function zoneOfPx(x) {
  if (x < 300) return 'galerny';
  if (x < 736) return 'kolomna';
  if (x < 1000) return 'matisov';
  if (x < 1150) return 'moika';
  return 'novo';
}

// Здания карты с геометрией в метрах и характеристиками для классификации.
export const MAP_BUILDINGS_RAW = TRACE.buildings.map((b, i) => {
  const poly = conv(b.poly);
  const [rx, ry, rw, rh, ang] = b.rect;
  const len = Math.max(rw, rh) * GEOREF.scale;
  const wid = Math.min(rw, rh) * GEOREF.scale;
  return {
    index: i,
    poly,
    rectPx: b.rect,
    centerPx: [rx, ry],
    center: px(rx, ry),
    area: area(poly),
    len,
    wid,
    fill: b.fill,
    zone: zoneOfPx(rx),
  };
});

export { centroid, dist, sub, norm };
