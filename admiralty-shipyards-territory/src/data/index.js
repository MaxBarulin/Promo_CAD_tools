// Сборка полного набора данных модели.

import { BOUNDS, NEVA, RIVERS, WATER_LABELS } from './water.js';
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
      version: '0.1.0',
      accuracy:
        'Схема восстановлена по открытым источникам (описания, адреса, размеры объектов). Береговые линии и улицы привязаны к опорным точкам с точностью ±30–80 м; внутренняя планировка верфи — условная. Для точной геометрии используйте импорт OpenStreetMap (npm run osm:fetch).',
    },
    water: { neva: NEVA, rivers: RIVERS, labels: WATER_LABELS },
    zones: Y.ZONES,
    fences: Y.FENCES,
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
    bridges: Y.BRIDGES,
    arches: [C.ARCH_NEW_HOLLAND],
    labels: [...Y.LABELS, ...C.CONTEXT_LABELS],
    quays: { novo: Y.NOVO_SHORE, galerny: Y.GALERNY_QUAY, matisov: Y.MATISOV_QUAY },
  };
}
