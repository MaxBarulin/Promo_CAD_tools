// Генерация синтетического ответа Overpass для проверки конвейера импорта OSM.
import { writeFile } from 'node:fs/promises';
import { toLatLon, rect } from '../src/geo.js';
import { NEVA, RIVERS } from '../src/data/water.js';
import { BUILDINGS } from '../src/data/shipyard.js';
import { STREETS } from '../src/data/context.js';
import { bufferPolyline } from '../src/geo.js';
const g = (ring) => [...ring, ring[0]].map((p) => { const [lat, lon] = toLatLon(p); return { lat, lon }; });
const ELLING = BUILDINGS.find((b) => b.id === 'Z136'); // Большой каменный эллинг
const LOTS = STREETS.find((s) => s.id === 'lotsmanskaya').line;
const ll = (pts) => pts.map((p) => { const [lat, lon] = toLatLon(p); return { lat, lon }; });
const elements = [
  { type: 'way', id: 1, tags: { building: 'industrial', 'building:levels': '6' }, geometry: g(ELLING.poly.map(([x, y]) => [x + 3, y + 2])) },
  { type: 'way', id: 2, tags: { building: 'apartments', 'building:levels': '5', 'addr:street': 'улица Декабристов', 'addr:housenumber': '57' }, geometry: g(rect(44, 690, 42, 16, 16)) },
  { type: 'relation', id: 3, tags: { natural: 'water', type: 'multipolygon', name: 'Большая Нева' }, members: [
    { type: 'way', role: 'outer', geometry: g(NEVA.polygon).slice(0, 8) },
    { type: 'way', role: 'outer', geometry: g(NEVA.polygon).slice(7) },
  ] },
  { type: 'way', id: 4, tags: { natural: 'water', name: 'Фонтанка' }, geometry: g(bufferPolyline(RIVERS[0].line, 25)) },
  { type: 'way', id: 5, tags: { barrier: 'fence' }, geometry: ll(LOTS.map(([x, y]) => [x - 9, y - 10])) },
  { type: 'way', id: 6, tags: { highway: 'residential', name: 'Лоцманская улица' }, geometry: ll(LOTS) },
];
await writeFile(new URL('./fixtures/overpass-sample.json', import.meta.url), JSON.stringify({ osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }, elements }, null, 1));
console.log('fixture written', elements.length);
