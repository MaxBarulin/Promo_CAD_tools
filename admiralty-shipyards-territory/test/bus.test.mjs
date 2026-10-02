// Проверка внутризаводских автобусов: маршрут по проездам и положение по расписанию.
import assert from 'node:assert/strict';
import { getTerritory } from '../src/data/index.js';
import { busStates, pointOnRoute, stopTimes, busDeparts } from '../src/data/bus.js';
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

const at = (wd, hm, bus = 0) => {
  const [h, m, s = 0] = hm.split(':').map(Number);
  return busStates(R, wd, h * 3600 + m * 60 + s)[bus];
};
const stopS = (id) => R.stops.find((s) => s.id === id).s;
const near = (st, id) => Math.abs(st.s - stopS(id)) < 0.5;

// среда: автобус 1 ходит по расписанию, автобус 2 тем же кругом на 15 минут позже
let st = at(3, '7:31:30');
assert.equal(st.state, 'stop');
assert.ok(near(st, 'BS-c20-s'));
st = at(3, '7:32:30');
assert.equal(st.state, 'move');
assert.ok(st.s > stopS('BS-c20-s') && st.s < stopS('BS-c19-s'));
st = at(3, '7:44:30');
assert.equal(st.state, 'stop');
assert.ok(near(st, 'BS-c12-n'));
assert.equal(at(3, '7:40', 1).state, 'park');
assert.ok(near(at(3, '7:44:30', 1), 'BS-c33-s'));
// едут навстречу друг другу и встречаются у остановки «ОТЗ» в :06, :21, :36, :51
for (const t of ['7:50:50', '8:05:50', '10:20:50', '14:50:50']) {
  const [a, b] = [at(3, t, 0), at(3, t, 1)];
  const both = [a, b].map((x) => (near(x, 'BS-otz-s') ? 's' : near(x, 'BS-otz-n') ? 'n' : '-')).sort().join('');
  assert.equal(both, 'ns', `в ${t} автобусы не встретились у ОТЗ`);
}
// обед и ночь — оба у проходной, друг за другом
for (const t of ['12:00', '23:00', '6:00']) {
  const [a, b] = [at(3, t, 0), at(3, t, 1)];
  assert.equal(a.state, 'park');
  assert.equal(b.state, 'park');
  const gap = (((a.s - b.s) % R.total) + R.total) % R.total;
  assert.ok(Math.abs(Math.min(gap, R.total - gap) - 14) < 0.5, `в ${t} автобусы стоят в ${gap.toFixed(1)} м`);
}
// пятница: обратно от цеха № 12 в 15:20 тот же автобус, что ушёл в 15:00; второй заканчивает
// рейсом 14:45 и обратным 15:00; выходные: рейсов нет
assert.equal(at(5, '15:16', 0).state, 'stop');
assert.equal(at(5, '15:20:20', 0).state, 'move');
assert.equal(at(5, '15:50', 0).state, 'park');
assert.equal(at(5, '15:20', 1).state, 'park');
assert.equal(at(6, '10:00', 0).state, 'park');
assert.equal(at(0, '10:00', 1).state, 'park');
assert.equal(busDeparts(6), null);

// расписание остановок
assert.deepEqual(stopTimes('c20', 's', 1).slice(0, 4), [7 * 60 + 32, 7 * 60 + 47, 8 * 60 + 2, 8 * 60 + 17]);
assert.equal(stopTimes('c12', 'n', 5).at(-1), 15 * 60 + 20);
assert.equal(stopTimes('c33', 's', 5).at(-1), 15 * 60);

// движение плавное: за секунду автобус проезжает не больше 12 м, путь не идёт назад; автобусы
// не наезжают друг на друга
for (let t = 6 * 3600; t < 17.5 * 3600; t += 1) {
  const a = busStates(R, 2, t);
  const b = busStates(R, 2, t + 1);
  for (let k = 0; k < 2; k++) {
    const ds = (((b[k].s - a[k].s) % R.total) + R.total) % R.total;
    assert.ok(ds < 12, `автобус ${k + 1}: скачок ${ds.toFixed(1)} м в ${t} с`);
  }
  const gap = (((a[0].s - a[1].s) % R.total) + R.total) % R.total;
  assert.ok(Math.min(gap, R.total - gap) > 13.5, `автобусы ближе 14 м в ${t} с`);
}
// на мосту — по настилу
const b3 = R.bridges[0];
const mid = [(b3.a[0] + b3.b[0]) / 2, (b3.a[1] + b3.b[1]) / 2];
let close = null;
for (let s = 0; s < R.total; s += 2) {
  const p = pointOnRoute(R, s);
  const d = Math.hypot(p.p[0] - mid[0], p.p[1] - mid[1]);
  if (!close || d < close.d) close = { d, z: p.z };
}
assert.ok(close.d < 4 && close.z > 0.3, 'автобус проезжает по настилу моста');

console.log(`Автобусы: круг ${(R.total / 1000).toFixed(2)} км, ${R.stops.length} площадок остановок — проверки пройдены`);
