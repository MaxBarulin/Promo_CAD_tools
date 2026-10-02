// Проверка внутризаводских автобусов: маршрут по проездам и положение по расписанию.
import assert from 'node:assert/strict';
import { getTerritory } from '../src/data/index.js';
import { busStates, busRuns, busStopTimes, pointOnRoute, stopTimes, busDeparts, BUS_TIMETABLE } from '../src/data/bus.js';
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

// первый автобус делает все рейсы расписания, точно по времени; второй — навстречу ему:
// от цеха № 12 в те же минуты, что первый от цеха № 33, и наоборот, кроме последнего рейса на север
// перед обедом и вечером
for (const wd of [1, 5]) {
  const d = busDeparts(wd);
  const [one, two] = [0, 1].map((b) => busRuns(R, b, wd));
  for (const dir of ['s', 'n'])
    assert.deepEqual(
      one.filter((r) => r.kind === dir).map((r) => r.T / 60),
      d[dir],
      `рейсы ${dir} первого автобуса в день ${wd}`,
    );
  assert.ok(one.filter((r) => r.T != null).every((r) => r.printed));
  assert.ok(two.filter((r) => r.T != null).every((r) => !r.printed));
  assert.deepEqual(two.filter((r) => r.kind === 'n').map((r) => r.T / 60), d.s, `второй навстречу рейсам на юг, день ${wd}`);
  const lastN = [11 * 60 + 15, d.n.at(-1)];
  assert.deepEqual(
    two.filter((r) => r.kind === 's').map((r) => r.T / 60),
    d.n.filter((t) => !lastN.includes(t)),
    `второй навстречу рейсам на север, день ${wd}`,
  );
}
// утром и после обеда второй выходит на линию к цеху № 12 за полчаса, первый уходит рейсом по расписанию
assert.equal(at(3, '7:05', 1).state, 'move');
assert.equal(at(3, '7:05', 0).state, 'park');
assert.ok(near(at(3, '7:29:50', 0), 'BS-c33-s'));
assert.ok(near(at(3, '7:29:50', 1), 'BS-c12-n'));
assert.equal(at(3, '12:35', 1).state, 'move');
assert.equal(at(3, '12:35', 0).state, 'park');
assert.equal(at(3, '13:00:30', 0).state, 'move');
assert.equal(at(3, '13:00:30', 1).state, 'move');
// едут навстречу и встречаются у ОТЗ: в 10:06 оба рядом с ОТЗ, в разные стороны
{
  const otz = R.stops.find((x) => x.id === 'BS-otz-s');
  const [a, b] = [at(3, '10:06', 0), at(3, '10:06', 1)].map((x) => pointOnRoute(R, x.s));
  const pa = pointOnRoute(R, otz.s).p;
  assert.ok(Math.hypot(a.p[0] - pa[0], a.p[1] - pa[1]) < 150 && Math.hypot(b.p[0] - pa[0], b.p[1] - pa[1]) < 150, 'в 10:06 оба у ОТЗ');
  assert.ok(a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] < -0.5, 'в 10:06 автобусы едут навстречу');
}
// в перерыв 9:30 — в разных концах: первый на северном кольце, второй у цеха № 12
assert.equal(at(3, '9:40', 0).state, 'park');
assert.ok(Math.min(at(3, '9:40', 0).s, R.total - at(3, '9:40', 0).s) < 20);
assert.ok(near(at(3, '9:40', 1), 'BS-c12-n'));
// отклонение от расписания на остановках — не больше пары минут (у второго — от его графика)
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
    for (const [who, times] of [['первый', stopTimes(st, dir, 3)], ['второй', busStopTimes(R, 1, st, dir, 3)]])
      for (const m of times.filter((_, i) => i % 3 === 0)) {
        const dep = departed(`BS-${st}-${dir}`, m * 60);
        assert.ok(dep != null && Math.abs(dep - m * 60) <= 120, `${who}: ${st} ${dir} ${Math.floor(m / 60)}:${m % 60}: отклонение ${dep == null ? '—' : dep - m * 60} с`);
      }
// только первый автобус (второй отключён): то же движение, без второго
for (const t of ['7:05', '10:06', '12:00', '16:25']) {
  const [h, m] = t.split(':').map(Number);
  const one = busStates(R, 3, h * 3600 + m * 60, 1);
  assert.equal(one.length, 1);
  assert.equal(one[0].state, busStates(R, 3, h * 3600 + m * 60)[0].state);
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
// у цеха № 12 вдвоём не стоят: в 14:43 один подъезжает, другой уже на северном кольце
{
  const [x, y] = [at(3, '14:43', 0), at(3, '14:43', 1)];
  assert.ok([x, y].filter((z) => near(z, 'BS-c12-n')).length <= 1);
  assert.ok(Math.min(y.s, R.total - y.s) < 20);
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
