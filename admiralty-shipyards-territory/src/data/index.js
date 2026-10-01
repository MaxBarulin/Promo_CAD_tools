// Сборка полного набора данных модели.
//
// Геометрия — реальная (Overture Maps / OpenStreetMap, см. real.js): граница верфи,
// здания с высотами, вода, улицы, мосты. С карты предприятия (mapdata.js, привязана к
// реальной границе) — назначение цехов, стапели, краны, суда, плавдоки.

import * as Y from './shipyard.js';
import { realTerritory, REAL } from './real.js';
import { GEOREF } from './mapdata.js';
import { ORIGIN, pointInRing, area, centroid } from '../geo.js';
import OSM_OVERLAY from './osm-overlay.js';
import { applyOverlay } from './overlay.js';

// useOSM: подмешать свежую выгрузку OpenStreetMap, если она загружена (npm run osm:fetch).
export function getTerritory({ useOSM = true } = {}) {
  const base = baseTerritory();
  return useOSM && OSM_OVERLAY ? applyOverlay(base, OSM_OVERLAY) : base;
}

export const hasOSM = () => !!OSM_OVERLAY;

// Подпись над водой: ближайшая к желаемой точка внутри акватории.
function inWaterNear([x0, y0]) {
  const inside = (p) => REAL.water.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h)));
  for (let r = 0; r <= 300; r += 6) {
    const n = Math.max(1, Math.round(r / 3));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = [x0 + Math.cos(a) * r, y0 + Math.sin(a) * r];
      if (inside(p)) return p;
    }
  }
  return [x0, y0];
}

const WATER_LABELS = [
  { text: 'Большая Нева', at: [-760, 420], size: 'xl' },
  { text: 'Большая Нева', at: [-250, 1500], size: 'l' },
  { text: 'р. Фонтанка', at: [-330, -150], size: 'm' },
  { text: 'р. Екатерингофка', at: [-900, -650], size: 's' },
  { text: 'р. Мойка', at: [230, 1080], size: 'm' },
  { text: 'р. Пряжка', at: [-20, 620], size: 's' },
  { text: 'Ново-Адмиралтейский канал', at: [300, 1520], size: 's' },
].map((l) => ({ ...l, at: inWaterNear(l.at) }));

const DISTRICTS = [
  { text: 'Коломна', at: [330, 480], kind: 'district' },
  { text: 'Новая Голландия', at: [600, 1330], kind: 'district' },
  { text: 'Васильевский остров', at: [-1050, 1650], kind: 'district' },
  { text: 'Балтийский завод', at: [-1250, 700], kind: 'district' },
  { text: 'Екатерингоф', at: [-650, -720], kind: 'district' },
  { text: 'пл. Репина', at: [10, -40], kind: 'street' },
];

function baseTerritory() {
  const R = realTerritory();
  // подписи участков — по центру крупнейшей части
  const zoneLabels = [];
  for (const z of R.zones) {
    const prev = zoneLabels.find((l) => l.id === z.id);
    if (prev && prev.area >= area(z.polygon)) continue;
    const l = { id: z.id, text: z.name, at: centroid(z.polygon), kind: 'island', area: area(z.polygon) };
    if (prev) Object.assign(prev, l);
    else zoneLabels.push(l);
  }
  return {
    meta: {
      title: 'АО «Адмиралтейские верфи» — цифровая модель территории',
      origin: ORIGIN,
      bounds: R.bounds,
      shipyard: Y.SHIPYARD_META,
      version: '0.3.0',
      georef: GEOREF,
      source: 'overture',
      sources: R.source,
      accuracy:
        'Граница территории, контуры и высоты зданий, вода, улицы и мосты — из открытых данных OpenStreetMap и Microsoft ML Buildings (через Overture Maps). Назначение цехов, стапели, краны и суда — с карты предприятия, совмещённой с реальной границей (отклонение ≈3 м). Высоты зданий верфи в открытых данных отсутствуют и оценены по площади и типу.',
    },
    water: { real: R.water, labels: WATER_LABELS },
    zones: R.zones,
    fences: [],
    gates: R.gates,
    autoFence: true,
    buildings: R.buildings,
    chimneys: Y.CHIMNEYS,
    internalRoads: R.internalRoads,
    streets: R.streets,
    areas: [...R.areas, ...Y.AREAS],
    rails: Y.RAILS,
    slipways: Y.SLIPWAYS,
    cranes: Y.CRANES,
    ships: [...Y.SHIPS, ...R.ships],
    docks: Y.DOCKS,
    bridges: R.bridges,
    arches: [],
    containers: Y.CONTAINERS,
    crossings: R.crossings,
    labels: [...zoneLabels, ...DISTRICTS, ...R.streetLabels],
    frontage: false,
  };
}
