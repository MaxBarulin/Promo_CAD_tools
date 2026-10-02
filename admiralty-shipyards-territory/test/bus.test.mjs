// Проверка внутризаводских автобусов: маршрут по проездам и положение по расписанию.
import assert from 'node:assert/strict';
import { getTerritory } from '../src/data/index.js';
import { busStates, busRuns, pointOnRoute, stopTimes, busDeparts, BUS_TIMETABLE } from '../src/data/bus.js';
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

// оба автобуса вместе делают все рейсы расписания, каждый — со своей конечной точно по времени
for (const wd of [1, 5]) {
  const d = busDeparts(wd);
  const runs = [0, 1].flatMap((b) => busRuns(R, b, wd));
  for (const dir of ['s', 'n'])
    assert.deepEqual(
      runs.filter((r) => r.kind === dir).map((r) => r.T / 60).sort((x, y) => x - y),
      d[dir],
      `рейсы ${dir} в день ${wd}`,
    );
}
// утром и после обеда: один выходит на линию, через полчаса другой — в рейс от цеха № 33
assert.equal(at(3, '7:05', 0).state, 'move');
assert.equal(at(3, '7:05', 1).state, 'park');
assert.ok(near(at(3, '7:29:50', 1), 'BS-c33-s'));
assert.equal(at(3, '12:35', 0).state, 'move');
assert.equal(at(3, '12:35', 1).state, 'park');
assert.equal(at(3, '13:00:30', 1).state, 'move');
// на конечной у цеха № 12 автобус стоит до рейса обратно; в перерыв 9:30 — час на кольце у цеха № 12
assert.ok(near(at(3, '7:44', 0), 'BS-c12-n'));
assert.ok(near(at(3, '9:40', 0), 'BS-c12-n'));
assert.equal(at(3, '9:40', 1).state, 'park');
// отклонение от расписания на остановках — не больше пары минут
const departed = (sid, T) => {
  const s0 = stopS(sid);
  for (let t = T - 150; t < T + 150; t++) {
    const a = busStates(R, 3, t);
    const b = busStates(R, 3, t + 1);
    for (let k = 0; k < 2; k++) if (Math.abs(a[k].s - s0) < 0.5 && Math.abs(b[k].s - s0) > 0.01 && !b[k].queued) return t + 1;
  }
  return null;
};
for (const dir of ['s', 'n'])
  for (const st of BUS_TIMETABLE[dir].stops)
    for (const m of stopTimes(st, dir, 3).filter((_, i) => i % 3 === 0)) {
      const dep = departed(`BS-${st}-${dir}`, m * 60);
      assert.ok(dep != null && Math.abs(dep - m * 60) <= 120, `${st} ${dir} ${Math.floor(m / 60)}:${m % 60}: отклонение ${dep == null ? '—' : dep - m * 60} с`);
    }
// обед и ночь — оба на северном кольце, друг за другом
for (const t of ['12:00', '23:00', '6:00']) {
  const [a, b] = [at(3, t, 0), at(3, t, 1)];
  assert.equal(a.state, 'park');
  assert.equal(b.state, 'park');
  const gap = (((a.s - b.s) % R.total) + R.total) % R.total;
  assert.ok(Math.abs(Math.min(gap, R.total - gap) - 14) < 0.5, `в ${t} автобусы стоят в ${gap.toFixed(1)} м`);
}
// пятница: последний рейс от цеха № 33 в 15:00, обратно от цеха № 12 в 15:20; выходные — рейсов нет
assert.equal(at(5, '15:20:20', 0).state === 'move' || at(5, '15:20:20', 1).state === 'move', true);
assert.equal(at(5, '16:00', 0).state, 'park');
assert.equal(at(5, '16:00', 1).state, 'park');
assert.equal(at(6, '10:00', 0).state, 'park');
assert.equal(at(0, '10:00', 1).state, 'park');
assert.equal(busDeparts(6), null);
assert.deepEqual(stopTimes('c20', 's', 1).slice(0, 3), [7 * 60 + 32, 8 * 60 + 2, 8 * 60 + 32]);
assert.equal(stopTimes('c12', 'n', 5).at(-1), 15 * 60 + 20);

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
  const g = Math.min(gap, R.total - gap);
  assert.ok(g > 13.5, `автобусы ближе 14 м в ${t} с`);
  // на одной остановке вдвоём не стоят: рядом друг с другом — только на северном кольце в перерыв
  const atRing = (x) => Math.min(x.s, R.total - x.s) < 60; // на кольце у Северной проходной (стоянка, отдых)
  assert.ok(g > 40 || (atRing(a[0]) && atRing(a[1])), `в ${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')} автобусы стоят рядом: ${a[0].text} / ${a[1].text}`);
}
// в 14:43 у цеха № 12 один автобус: второй ждёт на кольце-развороте, пока первый уйдёт в 14:45
{
  const [x, y] = [at(3, '14:43', 0), at(3, '14:43', 1)];
  assert.equal([x, y].filter((z) => near(z, 'BS-c12-n')).length, 1);
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
