// Внутризаводские автобусы: остановки, маршрут по проездам верфи и расписание.
//
// Маршрут проходит через опорные точки (по какой дороге ехать) и остановки; между ними —
// кратчайший путь по внутризаводским проездам и заводским мостам, автобус едет по правой
// полосе. Автобусов два, оба стоят у Северной проходной и по очереди выходят на круг.
// Положение автобусов в любой момент — busStates(route, день недели, секунды) по расписанию.

import { add, sub, mul, dot, dist, norm, perp, lerp, smooth, centroid } from '../geo.js';

// Остановки. at — примерная точка у дороги; near — здание, у которого стоит остановка
// (точка — ближайшее к нему место на проезде).
export const BUS_STOPS = {
  ring_n: { name: 'Северная проходная', at: [189, 1487], ring: true },
  c33: { name: 'Цех № 33', at: [5, 1350] },
  c20: { name: 'Цех № 20', at: [-247, 1110] },
  c19: { name: 'Цех № 19', at: [-400, 629] },
  otz: { name: 'ОТЗ', at: [-331, 400] },
  zupr: { name: 'Заводоуправление', at: [-171, 106] },
  c22: { name: 'Цех № 22', at: [-509, -92] },
  c12: { name: 'Цех № 12', near: 'Z90' },
};

// Направления рейсов — как в расписании
export const BUS_DIRS = {
  s: { name: 'к цеху № 12', from: 'c33' },
  n: { name: 'к цеху № 29', from: 'c12' },
};

// Дорога с юга на север: опорные точки (по какой дороге ехать) и остановки по порядку.
const WAY = [
  { via: [-669, -370] },
  { stop: 'c12' },
  { via: [-604, -208] },
  { via: [-542, -125] },
  { stop: 'c22' },
  { via: [-380, -78] },
  { via: [-271, -78] },
  { via: [-158, -15] },
  { via: [-150, 80] },
  { stop: 'zupr' },
  { via: [-194, 137] },
  { via: [-328, 297] },
  { via: [-345, 345] },
  { stop: 'otz' },
  { via: [-309, 464] },
  { via: [-423, 496] },
  { stop: 'c19' },
  { via: [-383, 679] },
  { via: [-390, 759] },
  { via: [-344, 984] },
  { via: [-214, 1057] },
  { stop: 'c20' },
  { via: [-214, 1190] },
  { stop: 'c33' },
];
// Круг: от конечной у Северной проходной на юг (к цеху № 12 — без остановки у цеха № 12 до
// разворота), разворот на Галерном острове, обратно на север (к цеху № 29 — без цеха № 33) и
// объезд квартала у проходной (на конечную по R57, с неё — по R59 и R58).
const CYCLE = [
  { stop: 'ring_n' },
  { via: [167.4, 1473.9] },
  { via: [180, 1450.5] },
  ...WAY.slice()
    .reverse()
    .filter((w) => w.stop !== 'c12')
    .map((w) => (w.stop ? { stop: w.stop, dir: 's' } : w)),
  { via: [-705, -385], uturn: true },
  ...WAY.filter((w) => w.stop !== 'c33').map((w) => (w.stop ? { stop: w.stop, dir: 'n' } : w)),
  { via: [185, 1453] },
  { via: [208.9, 1467.5] },
];

// Расписание рейсового автобуса с 13.02.2024: отправление с первой остановки рейса и
// минуты в пути до следующих остановок.
const T = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
export const BUS_TIMETABLE = {
  since: '2024-02-13',
  s: { stops: ['c33', 'c20', 'c19', 'otz', 'zupr', 'c22'], offsets: [0, 2, 4, 6, 8, 10], dep: ['7:30', '8:00', '8:30', '9:00', '10:00', '10:30', '11:00', '13:00', '14:00', '14:30', '15:00', '15:30', '16:00'].map(T) },
  n: { stops: ['c12', 'c22', 'zupr', 'otz', 'c19', 'c20'], offsets: [0, 2, 4, 6, 8, 10], dep: ['7:45', '8:15', '8:45', '9:15', '10:15', '10:45', '11:15', '13:15', '14:15', '14:45', '15:15', '15:45', '16:20'].map(T) },
  // в пятницу последний рейс в 15:00, обратно от цеха № 12 — в 15:20 (остальное — на 5 минут позже)
  friday: { lastS: T('15:00'), lastN: T('15:20'), shiftN: [T('15:15'), T('15:20')] },
};

const LANE = 1.6; // смещение оси автобуса от оси проезда, м
const SNAP = 4; // примыкание проездов друг к другу, м
const BRIDGE_REACH = 40; // поиск проезда у конца моста, м

// ---------- граф проездов ----------
function segPoint(s, t) {
  return lerp(s.a, s.b, t);
}
function projectSeg(s, p) {
  const d = sub(s.b, s.a);
  const L2 = dot(d, d) || 1e-9;
  const t = Math.max(0, Math.min(1, dot(sub(p, s.a), d) / L2));
  const q = segPoint(s, t);
  return { t, q, d: dist(p, q) };
}
function intersect(s, u) {
  const r = sub(s.b, s.a);
  const q = sub(u.b, u.a);
  const den = r[0] * q[1] - r[1] * q[0];
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(u.a, s.a);
  const t = (w[0] * q[1] - w[1] * q[0]) / den;
  const v = (w[0] * r[1] - w[1] * r[0]) / den;
  return t > 1e-6 && t < 1 - 1e-6 && v > 1e-6 && v < 1 - 1e-6 ? [t, v] : null;
}

function buildGraph(roads, bridges, points) {
  const segs = [];
  for (const r of roads) for (let i = 0; i < r.line.length - 1; i++) segs.push({ a: r.line[i], b: r.line[i + 1], w: r.w });
  for (const br of bridges) segs.push({ a: br.from, b: br.to, w: br.w, bridge: br });
  const cuts = segs.map(() => [0, 1]);
  const extra = [];
  // пересечения
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const x = intersect(segs[i], segs[j]);
      if (x) {
        cuts[i].push(x[0]);
        cuts[j].push(x[1]);
      }
    }
  // примыкания: конец одного проезда у середины другого; концы мостов — к ближайшему проезду
  segs.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      let best = null;
      segs.forEach((u, j) => {
        if (j === i || (s.bridge && u.bridge)) return;
        const pr = projectSeg(u, p);
        if (pr.d < 0.01) return;
        if (!best || pr.d < best.d) best = { ...pr, j };
      });
      if (best && best.d < (s.bridge ? BRIDGE_REACH : SNAP)) {
        cuts[best.j].push(best.t);
        extra.push([p, best.q]);
      }
    }
  });
  // точки остановок — на ближайший проезд (не на мост)
  const snapped = points.map((p) => {
    let best = null;
    segs.forEach((u, j) => {
      if (u.bridge) return;
      const pr = projectSeg(u, p);
      if (!best || pr.d < best.d) best = { ...pr, j };
    });
    cuts[best.j].push(best.t);
    return best.q;
  });
  // узлы и рёбра
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const nodes = new Map();
  const node = (p) => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { p, adj: [] });
    return k;
  };
  const edge = (p, q, w, bridge) => {
    const a = node(p);
    const b = node(q);
    if (a === b) return;
    const L = dist(p, q);
    nodes.get(a).adj.push({ to: b, L, w, bridge });
    nodes.get(b).adj.push({ to: a, L, w, bridge });
  };
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) edge(segPoint(s, ts[k]), segPoint(s, ts[k + 1]), s.w, s.bridge);
  });
  for (const [p, q] of extra) edge(p, q, 6);
  return { nodes, key, snapped };
}

function shortest(G, from, to) {
  const dists = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  const queue = [[0, from]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, k] = queue.shift();
    if (done.has(k)) continue;
    done.add(k);
    if (k === to) break;
    for (const e of G.nodes.get(k).adj) {
      const nd = d + e.L;
      if (nd < (dists.get(e.to) ?? Infinity)) {
        dists.set(e.to, nd);
        prev.set(e.to, k);
        queue.push([nd, e.to]);
      }
    }
  }
  if (!done.has(to)) throw new Error('Автобус: нет пути по проездам');
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]));
  return path.map((k) => G.nodes.get(k).p);
}

// ---------- геометрия пути ----------
const dedupe = (pts) => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 0.05);

// смещение вправо по ходу (правостороннее движение)
function rightLane(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = i > 0 ? norm(sub(pts[i], pts[i - 1])) : null;
    const next = i < pts.length - 1 ? norm(sub(pts[i + 1], pts[i])) : null;
    const n1 = prev && mul(perp(prev), -1);
    const n2 = next && mul(perp(next), -1);
    if (!n1) out.push(add(pts[i], mul(n2, d)));
    else if (!n2) out.push(add(pts[i], mul(n1, d)));
    else {
      const bis = norm(add(n1, n2));
      const c = dot(bis, n1);
      if (c < 0.35) out.push(add(pts[i], mul(n1, d)), add(pts[i], mul(n2, d)));
      else out.push(add(pts[i], mul(bis, d / c)));
    }
  }
  return out;
}

// разворот «кольцом»: из правой полосы влево по окружности на встречную
function uturnLoop(p, dir, R = 7.5) {
  const n = perp(dir); // влево
  const c = add(p, mul(dir, R));
  const pts = [add(p, mul(n, -LANE))];
  for (let k = 0; k <= 16; k++) {
    const a = -Math.PI / 2 + (k / 16) * Math.PI;
    pts.push(add(c, add(mul(dir, Math.cos(a) * R), mul(n, Math.sin(a) * R))));
  }
  pts.push(add(p, mul(n, LANE)));
  return pts;
}

// Маршрут: замкнутая линия по правой полосе, отметки остановок (s — путь от начала круга),
// площадки остановок у края проезда.
export function busRoute(data) {
  const roads = data.internalRoads;
  const bridges = data.bridges.filter((b) => b.type === 'industrial');
  const stopAt = (id) => {
    const st = BUS_STOPS[id];
    if (st.at) return st.at;
    const b = data.buildings.find((x) => x.id === st.near);
    return b ? centroid(b.poly) : null;
  };
  const pts = CYCLE.map((c) => (c.stop ? stopAt(c.stop) : c.via));
  const G = buildGraph(roads, bridges, pts);
  const keys = G.snapped.map((p) => G.key(p));

  // ось дороги по кругу, участками между точками круга
  const legs = [];
  for (let i = 0; i < CYCLE.length; i++) {
    const j = (i + 1) % CYCLE.length;
    legs.push(dedupe(shortest(G, keys[i], keys[j])));
  }
  // правая полоса; на развороте — петля
  const path = [];
  const marks = [];
  const widthAt = (p) => {
    let w = 6;
    let best = Infinity;
    for (const r of roads)
      for (let i = 0; i < r.line.length - 1; i++) {
        const pr = projectSeg({ a: r.line[i], b: r.line[i + 1] }, p);
        if (pr.d < best) {
          best = pr.d;
          w = r.w;
        }
      }
    return w;
  };
  for (let i = 0; i < legs.length; i++) {
    let leg = rightLane(legs[i], LANE);
    leg = smooth(leg, 3);
    marks.push(path.length);
    path.push(...(path.length ? leg.slice(1) : leg));
    const next = CYCLE[(i + 1) % CYCLE.length];
    if (next.uturn) {
      const a = legs[i][legs[i].length - 2];
      const b = legs[i][legs[i].length - 1];
      path.push(...uturnLoop(b, norm(sub(b, a))).slice(1));
    }
  }
  path.push(path[0]);
  // длины
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  const nodes = CYCLE.map((c, i) => ({ ...c, s: cum[marks[i]], center: G.snapped[i] }));

  // площадки остановок: справа по ходу, у края проезда
  const stops = [];
  nodes.forEach((n, i) => {
    if (!n.stop) return;
    const leg = legs[(i + legs.length - 1) % legs.length];
    const a = leg[leg.length - 2] || leg[0];
    const b = leg[leg.length - 1];
    const dir = norm(sub(b, a));
    const w = widthAt(n.center);
    const right = mul(perp(dir), -1);
    stops.push({
      id: `BS-${n.stop}${n.dir ? '-' + n.dir : ''}`,
      stop: n.stop,
      dir: n.dir || null,
      name: BUS_STOPS[n.stop].name,
      ring: !!BUS_STOPS[n.stop].ring,
      s: n.s,
      // зона остановки на проезжей части у края, знак — за краем, у переднего конца зоны
      zone: { at: add(n.center, mul(right, w / 2 - 1.3)), angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, L: 18, W: 2.6 },
      sign: add(add(n.center, mul(right, w / 2 + 0.7)), mul(dir, 7)),
    });
  });
  const bridgeRects = bridges.map((b) => ({ a: b.from, b: b.to, hw: b.w / 2 + 0.5 }));
  return { path, cum, total, nodes, stops, bridges: bridgeRects };
}

// Точка пути по длине s (с заворотом по кругу): положение, направление, высота.
export function pointOnRoute(R, s) {
  s = ((s % R.total) + R.total) % R.total;
  let lo = 0;
  let hi = R.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (R.cum[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - R.cum[lo]) / Math.max(1e-9, R.cum[hi] - R.cum[lo]);
  const p = lerp(R.path[lo], R.path[hi], t);
  // направление — по хорде ±4 м, чтобы автобус не дёргался на изломах
  const ahead = pointRaw(R, s + 4);
  const behind = pointRaw(R, s - 4);
  const d = norm(sub(ahead, behind));
  let z = 0.05;
  for (const br of R.bridges) {
    const pr = projectSeg(br, p);
    if (pr.d < br.hw) z = 0.38;
  }
  return { p, dir: d, z };
}
function pointRaw(R, s) {
  s = ((s % R.total) + R.total) % R.total;
  let lo = 0;
  let hi = R.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (R.cum[m] <= s) lo = m;
    else hi = m;
  }
  const t = (s - R.cum[lo]) / Math.max(1e-9, R.cum[hi] - R.cum[lo]);
  return lerp(R.path[lo], R.path[hi], t);
}

// ---------- расписание и положение автобуса ----------
const V = 8; // крейсерская скорость, м/с (≈ 29 км/ч)
const ACC = 0.8; // разгон и торможение, м/с²
const DWELL = 60; // стоянка на остановке, с — для наглядности
const DWELL_MIN = 20;
export const BUS_COUNT = 2; // автобусов на маршруте
const GAP = 14; // автобус в очереди стоит за передним с таким шагом, м

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const hm = (sec) => {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// время в пути по участку длиной L (разгон — ход — торможение)
function travelTime(L) {
  return L >= (V * V) / ACC ? L / V + V / ACC : 2 * Math.sqrt(L / ACC);
}
// пройденный путь через t с на участке длиной L, пройденном за Tt с
function distAt(L, Tt, t) {
  if (t <= 0) return 0;
  if (t >= Tt) return L;
  let a = ACC;
  let disc = (a * Tt) ** 2 - 4 * a * L;
  if (disc < 0) {
    a = (4 * L) / (Tt * Tt);
    disc = 0;
  }
  const v = (a * Tt - Math.sqrt(disc)) / 2;
  const ta = v / a;
  if (t < ta) return 0.5 * a * t * t;
  if (t > Tt - ta) return L - 0.5 * a * (Tt - t) ** 2;
  return 0.5 * a * ta * ta + v * (t - ta);
}

const cycleIndex = (stop, dir) => CYCLE.findIndex((c) => c.stop === stop && (c.dir || null) === (dir || null));

// Отправления по дням: weekday 1–5 — рабочие дни (в пятницу короче), 0 и 6 — выходные.
export function busDeparts(weekday) {
  if (weekday === 0 || weekday === 6) return null;
  const tt = BUS_TIMETABLE;
  const fri = weekday === 5;
  const s = fri ? tt.s.dep.filter((t) => t <= tt.friday.lastS) : tt.s.dep;
  const n = fri ? tt.n.dep.filter((t) => t < tt.friday.shiftN[0]).concat(tt.friday.lastN) : tt.n.dep;
  return { s, n };
}

// Время отправления от остановки stop в направлении dir (минуты от полуночи)
export function stopTimes(stop, dir, weekday) {
  const d = busDeparts(weekday);
  if (!d) return [];
  const tt = BUS_TIMETABLE[dir];
  const k = tt.stops.indexOf(stop);
  return k < 0 ? [] : d[dir].map((t) => t + tt.offsets[k]);
}

// Рейсы дня по автобусам. Круговой рейс — отправление к цеху № 12 и следующее за ним обратное
// (15:00 → 15:20 в пятницу — тот же автобус); круговые рейсы по очереди делают автобус 1 и
// автобус 2, поэтому первый выходит в 7:30, второй — в 8:00. События: { node — индекс в круге
// маршрута, t — отправление, секунды от полуночи }.
const eventsCache = new Map();
function busEvents(bus, weekday) {
  const key = `${bus}:${weekday}`;
  if (!eventsCache.has(key)) eventsCache.set(key, buildEvents(bus, weekday));
  return eventsCache.get(key);
}
function buildEvents(bus, weekday) {
  const d = busDeparts(weekday);
  if (!d) return [];
  const ev = [];
  d.s.forEach((tS, k) => {
    if (k % BUS_COUNT !== bus) return;
    const trips = [['s', tS], ['n', d.n[k]]];
    for (const [dir, t0] of trips) {
      if (t0 == null) continue;
      const tt = BUS_TIMETABLE[dir];
      tt.stops.forEach((st, i) => ev.push({ node: cycleIndex(st, dir), t: (t0 + tt.offsets[i]) * 60, stop: st, dir }));
    }
  });
  return ev.sort((a, b) => a.t - b.t);
}

// Положение одного автобуса (bus — 0 или 1): weekday — день недели (0 — воскресенье), sec —
// секунды от полуночи. → { s (путь по кругу), state: 'park' | 'stop' | 'move', text, next }
// next — когда автобус тронется (для очереди на стоянке).
export function busState(R, bus, weekday, sec) {
  const S = (i) => R.nodes[i].s;
  const ring = R.nodes.findIndex((n) => n.stop === 'ring_n');
  const ev = busEvents(bus, weekday);
  // since — с какого времени стоит (кто раньше встал, тот и впереди)
  const parked = (text, next = Infinity, since = -Infinity) => ({ s: S(ring), state: 'park', text, next, since });
  if (!ev.length) return parked(`стоит у Северной проходной: ${WEEKDAYS[weekday]}, рейсов нет`);
  const span = (a, b) => (((S(b) - S(a)) % R.total) + R.total) % R.total;
  const name = (i) => `«${BUS_STOPS[CYCLE[i].stop].name}»`;
  const dirName = (e) => BUS_DIRS[e.dir].name;
  const at = (a, L, Tt, t0) => S(a) + distAt(L, Tt, sec - t0);

  // участок от узла a (отправление ta) к узлу b (отправление tb); через стоянку у проходной —
  // со стоянкой на ней, если есть время
  const leg = (a, ta, b, tb, e0, e1) => {
    const L = span(a, b);
    const viaRing = a === ring || span(a, ring) < L;
    if (viaRing) {
      const L1 = a === ring ? 0 : span(a, ring);
      const L2 = L - L1;
      const T1 = L1 ? travelTime(L1) : 0;
      const T2 = travelTime(L2);
      const leave = Math.max(ta + T1, tb - DWELL - T2);
      if (sec < ta + T1) return { s: at(a, L1, T1, ta), state: 'move', text: `едет к Северной проходной, следующий рейс ${dirName(e1)} — в ${hm(tb)}`, next: sec };
      if (sec < leave) return parked(`стоит у Северной проходной, следующий рейс ${dirName(e1)} — в ${hm(tb)}`, leave, a === ring ? -Infinity : ta + T1);
      const Tt = Math.max(1, Math.min(T2, tb - DWELL_MIN - leave));
      if (sec < leave + Tt) return { s: at(ring, L2, Tt, leave), state: 'move', text: `едет к остановке ${name(b)}, отправление ${dirName(e1)} в ${hm(tb)}`, next: sec };
      return { s: S(b), state: 'stop', text: `на остановке ${name(b)}, отправление ${dirName(e1)} в ${hm(tb)}`, next: tb };
    }
    const Tt = Math.max(1, Math.min(travelTime(L), tb - ta - DWELL_MIN));
    const end = e0.dir !== e1.dir ? ` (конечная), обратно — в ${hm(tb)}` : ` — ${hm(tb)}`;
    if (sec < ta + Tt) return { s: at(a, L, Tt, ta), state: 'move', text: `${dirName(e0)}, следующая остановка ${name(b)}${end}`, next: sec };
    return { s: S(b), state: 'stop', text: `на остановке ${name(b)}, отправление ${dirName(e1)} в ${hm(tb)}`, next: tb };
  };

  const first = ev[0];
  const last = ev[ev.length - 1];
  let st;
  if (sec < first.t) {
    st = leg(ring, 0, first.node, first.t, first, first);
    if (st.state === 'park') st.text = `стоит у Северной проходной, первый рейс ${dirName(first)} — в ${hm(first.t)}`;
  } else if (sec >= last.t) {
    const L = span(last.node, ring);
    const T = travelTime(L);
    st = sec < last.t + T ? { s: at(last.node, L, T, last.t), state: 'move', text: 'рейсы окончены, едет к Северной проходной', next: sec } : parked('рейсы на сегодня окончены, стоит у Северной проходной', Infinity, last.t + T);
  } else {
    let i = 0;
    while (ev[i + 1].t <= sec) i++;
    st = leg(ev[i].node, ev[i].t, ev[i + 1].node, ev[i + 1].t, ev[i], ev[i + 1]);
  }
  return { ...st, s: ((st.s % R.total) + R.total) % R.total };
}

// Оба автобуса. Если один догоняет другой (на стоянке у проходной или на конечной), задний
// останавливается в GAP метрах позади и подтягивается, когда передний уедет.
export function busStates(R, weekday, sec) {
  const st = [];
  for (let b = 0; b < BUS_COUNT; b++) st.push(busState(R, b, weekday, sec));
  const fwd = (x, y) => (((y - x) % R.total) + R.total) % R.total;
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < st.length; i++)
      for (let j = 0; j < st.length; j++) {
        if (i === j) continue;
        const d = fwd(st[i].s, st[j].s); // насколько j впереди i
        // на одном месте впереди тот, кто раньше тронется; если оба стоят до конца дня — кто раньше встал
        const first = (x, y) => x.next < y.next || (x.next === y.next && ((x.since ?? 0) < (y.since ?? 0) || ((x.since ?? 0) === (y.since ?? 0) && j < i)));
        const tie = d < 1e-6 && first(st[j], st[i]);
        if ((d > 1e-6 && d < GAP) || tie) st[i] = { ...st[i], s: (((st[j].s - GAP) % R.total) + R.total) % R.total, queued: true };
      }
  return st;
}
