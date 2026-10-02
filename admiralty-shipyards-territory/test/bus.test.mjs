// Проверка внутризаводского автобуса: маршрут по проездам и положение по расписанию.
import assert from 'node:assert/strict';
import { getTerritory } from '../src/data/index.js';
import { busState, pointOnRoute, stopTimes, busDeparts } from '../src/data/bus.js';
import { pointInRing, area } from '../src/geo.js';

const R = getTerritory().bus;
assert.ok(R && R.total > 4000 && R.total < 8000, `длина круга ${R?.total}`);
// 12 площадок в обе стороны и кольцо
assert.equal(R.stops.length, 13);
// путь идёт по проездам и мостам: каждая точка — не дальше 12 м от оси проезда (петля разворота шире
// дороги) и не заходит внутрь зданий (мелкие будки, которые в исходных данных стоят на обочине, не в счёт)
const D = getTerritory();
const bigBuildings = D.buildings.filter((b) => area(b.poly) >= 100);
const segs = [
  ...D.internalRoads.flatMap((r) => r.line.slice(1).map((q, i) => [r.line[i], q])),
  ...D.bridges.filter((b) => b.type === 'industrial').map((b) => [b.from, b.to]),
];
const toSeg = (p, [a, b]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
};
for (let s = 0; s < R.total; s += 3) {
  const { p } = pointOnRoute(R, s);
  const d = Math.min(...segs.map((g) => toSeg(p, g)));
  assert.ok(d < 12, `точка пути ${p.map(Math.round)} в ${d.toFixed(1)} м от проезда`);
  const inside = bigBuildings.find((b) => Math.abs(b.poly[0][0] - p[0]) < 300 && Math.abs(b.poly[0][1] - p[1]) < 300 && pointInRing(p, b.poly));
  assert.ok(!inside, `путь проходит через здание ${inside?.id} у ${p.map(Math.round)}`);
}

const at = (wd, hm) => {
  const [h, m, s = 0] = hm.split(':').map(Number);
  return busState(R, wd, h * 3600 + m * 60 + s);
};
const stopS = (id) => R.stops.find((s) => s.id === id).s;

// среда: на остановке «Цех № 20» перед отправлением в 7:32
let st = at(3, '7:31:30');
assert.equal(st.state, 'stop');
assert.ok(Math.abs(st.s - stopS('BS-c20-s')) < 0.5);
// ровно в 7:32 трогается, через полминуты уже в пути
st = at(3, '7:32:30');
assert.equal(st.state, 'move');
assert.ok(st.s > stopS('BS-c20-s') && st.s < stopS('BS-c19-s'));
// конечная у цеха № 12 — стоит до 7:45
st = at(3, '7:44:30');
assert.equal(st.state, 'stop');
assert.ok(Math.abs(st.s - stopS('BS-c12-n')) < 0.5);
// обед — на кольце
st = at(3, '12:00');
assert.equal(st.state, 'wait');
assert.ok(Math.abs(st.s - stopS('BS-ring_n')) < 0.5);
// до первого рейса и после последнего автобуса нет
assert.equal(at(3, '6:30').visible, false);
assert.equal(at(3, '17:00').visible, false);
// пятница: обратно от цеха № 12 в 15:20, после 15:45 рейсов нет; выходные — не ходит
assert.equal(at(5, '15:16').state, 'stop');
assert.equal(at(5, '15:20:20').state, 'move');
assert.equal(at(5, '15:50').visible, false);
assert.equal(at(6, '10:00').visible, false);
assert.equal(at(0, '10:00').visible, false);
assert.equal(busDeparts(6), null);

// расписание остановок
assert.deepEqual(stopTimes('c20', 's', 1).slice(0, 3), [7 * 60 + 32, 8 * 60 + 2, 8 * 60 + 32]);
assert.equal(stopTimes('c12', 'n', 5).at(-1), 15 * 60 + 20);

// движение плавное: за секунду автобус проезжает не больше 12 м, путь не идёт назад
for (let t = 7 * 3600; t < 8 * 3600; t += 1) {
  const a = busState(R, 2, t);
  const b = busState(R, 2, t + 1);
  if (!a.visible || !b.visible) continue;
  const ds = (((b.s - a.s) % R.total) + R.total) % R.total;
  assert.ok(ds < 12, `скачок ${ds.toFixed(1)} м в ${t} с`);
}
// на мосту — по настилу
const b3 = R.bridges[0];
const mid = [(b3.a[0] + b3.b[0]) / 2, (b3.a[1] + b3.b[1]) / 2];
let near = null;
for (let s = 0; s < R.total; s += 2) {
  const p = pointOnRoute(R, s);
  const d = Math.hypot(p.p[0] - mid[0], p.p[1] - mid[1]);
  if (!near || d < near.d) near = { d, z: p.z };
}
assert.ok(near.d < 4 && near.z > 0.3, 'автобус проезжает по настилу моста');

console.log(`Автобус: круг ${(R.total / 1000).toFixed(2)} км, ${R.stops.length} площадок остановок — проверки пройдены`);
