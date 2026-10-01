// Сборка полного набора данных модели.

import { BOUNDS, NEVA, LAND_CUTS, RIVERS, WATER_LABELS } from './water.js';
import { MAP_CORRIDOR, GEOREF } from './mapdata.js';
import * as Y from './shipyard.js';
import * as C from './context.js';
import { ORIGIN } from '../geo.js';
import OSM_OVERLAY from './osm-overlay.js';
import { applyOverlay } from './overlay.js';

// useOSM: подмешать данные OpenStreetMap, если они загружены (npm run osm:fetch).
export function getTerritory({ useOSM = true } = {}) {
  const base = schemaTerritory();
  return useOSM && OSM_OVERLAY ? applyOverlay(base, OSM_OVERLAY) : base;
}

export const hasOSM = () => !!OSM_OVERLAY;

function schemaTerritory() {
  return {
    meta: {
      title: 'АО «Адмиралтейские верфи» — цифровая модель территории',
      origin: ORIGIN,
      bounds: BOUNDS,
      shipyard: Y.SHIPYARD_META,
      version: '0.2.0',
      georef: GEOREF,
      accuracy:
        'Контуры территории, всех построек, причалов и акватории верфи сняты с карты предприятия (масштаб 1,514 м/пикс. по площади 67 га, север — по стрелке карты). Назначение большинства зданий и высоты — условные. Окружающие улицы и Нева за пределами карты построены по открытым источникам с точностью ±30–80 м. Для уточнения окружения используйте импорт OpenStreetMap (npm run osm:fetch).',
    },
    water: { neva: NEVA, map: [MAP_CORRIDOR], cuts: LAND_CUTS, rivers: RIVERS, labels: WATER_LABELS },
    landPieces: Y.LAND_PIECES,
    zones: Y.ZONES,
    fences: Y.FENCES,
    gates: Y.GATES,
    autoFence: true,
    buildings: [...Y.BUILDINGS, ...C.CONTEXT_BUILDINGS],
    chimneys: Y.CHIMNEYS,
    internalRoads: Y.INTERNAL_ROADS,
    streets: C.STREETS,
    areas: [...Y.AREAS, ...C.CITY_AREAS],
    rails: Y.RAILS,
    slipways: Y.SLIPWAYS,
    cranes: [...Y.CRANES, ...C.CONTEXT_CRANES],
    ships: [...Y.SHIPS, ...C.CONTEXT_SHIPS],
    docks: Y.DOCKS,
    bridges: [...Y.BRIDGES, ...C.CONTEXT_BRIDGES],
    arches: [C.ARCH_NEW_HOLLAND],
    containers: Y.CONTAINERS,
    crossings: C.CROSSINGS,
    labels: [...Y.LABELS, ...C.CONTEXT_LABELS],
  };
}
