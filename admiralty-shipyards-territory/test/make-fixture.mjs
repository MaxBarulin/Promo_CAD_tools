// Генерация синтетического ответа Overpass для проверки конвейера импорта OSM.
import { writeFile } from 'node:fs/promises';
import { toLatLon, rect } from '../src/geo.js';
import REAL from '../src/data/real-data.js';
import { BUILDINGS } from '../src/data/shipyard.js';
const g = (ring) => [...ring, ring[0]].map((p) => { const [lat, lon] = toLatLon(p); return { lat, lon }; });
const ELLING = BUILDINGS.find((b) => b.id === 'Z136'); // Большой каменный эллинг
const LOTS = REAL.roads.find((r) => r.name === 'Лоцманская улица').line;
const NEVA = REAL.water.slice().sort((a, b) => b[0].length - a[0].length)[0][0];
const half = Math.floor(NEVA.length / 2);
const ll = (pts) => pts.map((p) => { const [lat, lon] = toLatLon(p); return { lat, lon }; });
const elements = [
  { type: 'way', id: 1, tags: { building: 'industrial', 'building:levels': '6' }, geometry: g(ELLING.poly.map(([x, y]) => [x + 3, y + 2])) },
  { type: 'way', id: 2, tags: { building: 'apartments', 'building:levels': '5', 'addr:street': 'улица Декабристов', 'addr:housenumber': '57' }, geometry: g(rect(44, 690, 42, 16, 16)) },
  { type: 'relation', id: 3, tags: { natural: 'water', type: 'multipolygon', name: 'Большая Нева' }, members: [
    { type: 'way', role: 'outer', geometry: g(NEVA).slice(0, half + 1) },
    { type: 'way', role: 'outer', geometry: g(NEVA).slice(half) },
  ] },
  { type: 'way', id: 4, tags: { natural: 'water', name: 'Фонтанка' }, geometry: g(rect(-200, -130, 300, 50, 12)) },
  { type: 'way', id: 5, tags: { barrier: 'fence' }, geometry: ll(LOTS.map(([x, y]) => [x - 9, y - 10])) },
  { type: 'way', id: 6, tags: { highway: 'residential', name: 'Лоцманская улица' }, geometry: ll(LOTS) },
];
await writeFile(new URL('./fixtures/overpass-sample.json', import.meta.url), JSON.stringify({ osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }, elements }, null, 1));
console.log('fixture written', elements.length);
