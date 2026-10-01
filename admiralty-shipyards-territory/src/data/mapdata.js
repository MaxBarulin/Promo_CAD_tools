// Привязка карты предприятия (data/source/enterprise-map.png) к системе координат модели.
//
// Масштаб получен из площадей: вся территория на карте — 292 тыс. пикс²; при 67 га это
// 1,514 м/пикс. Проверка: Галерный остров (в устье Фонтанки) выходит 10,9 га (по данным
// 10,47 га), Ново-Адмиралтейский остров — 17,7 га (по данным 17 га).
// Север — по стрелке на карте (направлена вправо с подъёмом ≈7°).
// Привязка: юго-восточный угол территории (у Фонтанки и Лоцманской ул., рядом
// с главной проходной) — в точке (−50; −55) м от центра площади Репина.

import TRACE from './map-trace.js';
import { ensureCCW, area, centroid, dist, sub, norm } from '../geo.js';

export const GEOREF = {
  scale: 1.514, // м/пикс
  northDeg: 7.2, // поворот стрелки севера против часовой стрелки от направления «вправо»
  anchorPx: [526, 589],
  anchorModel: [-50, -55],
};

const th = (GEOREF.northDeg * Math.PI) / 180;
const N = [Math.cos(th), -Math.sin(th)]; // направление на север в пикселях (y вниз)
const E = [Math.sin(th), Math.cos(th)]; // на восток

// Пиксель карты → метры модели (x — восток, y — север).
export function px(x, y) {
  const dx = x - GEOREF.anchorPx[0];
  const dy = y - GEOREF.anchorPx[1];
  const s = GEOREF.scale;
  return [+(GEOREF.anchorModel[0] + s * (dx * E[0] + dy * E[1])).toFixed(2), +(GEOREF.anchorModel[1] + s * (dx * N[0] + dy * N[1])).toFixed(2)];
}

// Метры модели → пиксель карты (обратное преобразование).
export function toPx([X, Y]) {
  const s = GEOREF.scale;
  const e = (X - GEOREF.anchorModel[0]) / s;
  const n = (Y - GEOREF.anchorModel[1]) / s;
  // (dx, dy) = e*E + n*N (базис ортонормирован)
  return [GEOREF.anchorPx[0] + e * E[0] + n * N[0], GEOREF.anchorPx[1] + e * E[1] + n * N[1]];
}

// Направление в модели (градусы от востока против часовой) для вектора в пикселях.
export function pxAngle(dx, dy) {
  const e = dx * E[0] + dy * E[1];
  const n = dx * N[0] + dy * N[1];
  return (Math.atan2(n, e) * 180) / Math.PI;
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
