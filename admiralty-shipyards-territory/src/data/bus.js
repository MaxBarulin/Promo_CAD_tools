// Внутризаводские автобусы: остановки, маршрут по проездам верфи и расписание.
//
// Маршрут проходит через опорные точки (по какой дороге ехать) и остановки; между ними —
// кратчайший путь по внутризаводским проездам и заводским мостам, автобус едет по правой
// полосе. Автобусов два, оба ночуют на кольце у Северной проходной: первый делает рейсы
// по расписанию, второй ходит между ними навстречу первому.
// Положение автобусов в любой момент — busStates(route, день недели, секунды).

import { add, sub, mul, dot, dist, norm, perp, lerp, smooth, centroid } from '../geo.js';

// Остановки. at — примерная точка у дороги; near — здание, у которого стоит остановка
// (точка — ближайшее к нему место на проезде).
export const BUS_STOPS = {
  ring_n: { name: 'Кольцо', at: [189, 1487], ring: true },
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

// ---------- расписание и положение автобусов ----------
// Расписание рассчитано на один автобус: от цеха № 33 к цеху № 12 и сразу обратно, круг за
// полчаса. Первый автобус делает все рейсы расписания. Второй ходит по тому же кругу со сдвигом
// на 15 минут: уходит от цеха № 12 на север, когда первый уходит от цеха № 33 на юг, и наоборот,
// поэтому они едут навстречу друг другу и встречаются у ОТЗ. Утром и после обеда второй за
// полчаса до своего первого рейса выходит на линию к цеху № 12; последний рейс на север перед
// обедом и вечером делает только первый, второй к этому времени уже на северном кольце.
// Автобусы идут ровно, с одной умеренной скоростью, и коротко стоят на остановках; с конечных
// уходят точно по времени, лишнее время стоят на том кольце, где оказались.
const V = 4.5; // скорость хода, м/с (16 км/ч): ровно и не быстро
const ACC = 0.6; // разгон и торможение, м/с²
const DWELL = 30; // посадка на промежуточной остановке, с
export const BUS_COUNT = 2; // автобусов на маршруте
const GAP = 14; // автобус в очереди стоит за передним с таким шагом, м
const OUT_BEFORE = 30; // второй выходит на линию за столько минут до своего первого рейса от цеха № 12
const BREAK = 60; // перерыв больше часа между рейсами на юг — обед, оба автобуса стоят на северном кольце

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

// Время отправления от остановки stop в направлении dir по расписанию (минуты от полуночи)
export function stopTimes(stop, dir, weekday) {
  const d = busDeparts(weekday);
  if (!d) return [];
  const tt = BUS_TIMETABLE[dir];
  const k = tt.stops.indexOf(stop);
  return k < 0 ? [] : d[dir].map((t) => t + tt.offsets[k]);
}

// Проход по кругу от узла a до узла b с отправлением в t0: куски хода и стоянок на остановках.
// Без пассажиров (выход на линию, возврат на кольцо) — без остановок.
function runPieces(R, a, b, t0, service = true) {
  const N = CYCLE.length;
  const S = (i) => R.nodes[i].s;
  const pieces = [];
  let t = t0;
  let s = S(a);
  let i = a;
  do {
    i = (i + 1) % N;
    if (i !== b && !(service && CYCLE[i].stop)) continue;
    const L = (((S(i) - s) % R.total) + R.total) % R.total;
    const T = travelTime(L);
    pieces.push({ kind: 'move', s0: s, L, t0: t, t1: t + T, to: i });
    t += T;
    s = S(i);
    if (i !== b) {
      pieces.push({ kind: 'dwell', s0: s, t0: t, t1: t + DWELL, at: i });
      t += DWELL;
    }
  } while (i !== b);
  return { a, b, t0, t1: t, pieces };
}

// План дня: какие рейсы делает каждый автобус. Рейсы — { kind: 's' | 'n' | 'out' | 'home',
// T — отправление с конечной, printed — рейс из расписания, t0 — начало хода, t1 — приезд, pieces }.
function dayPlan(R, weekday) {
  R.plans ??= new Map();
  if (R.plans.has(weekday)) return R.plans.get(weekday);
  const ring = 0;
  const c33 = cycleIndex('c33', 's');
  const c12 = cycleIndex('c12', 'n');
  const lead = travelTime(R.nodes[c33].s - R.nodes[ring].s) + DWELL; // от кольца до отправления от цеха № 33
  const buses = Array.from({ length: BUS_COUNT }, () => ({ at: 'N', free: -Infinity, runs: [] }));
  const run = (bus, kind, t0, T = null, printed = false) => {
    const south = kind === 's' || kind === 'out';
    const r = { kind, T, printed, ...runPieces(R, south ? ring : c12, south ? c12 : ring, t0, kind === 's' || kind === 'n') };
    bus.runs.push(r);
    bus.at = south ? 'S' : 'N';
    bus.free = r.t1;
  };
  // рейс dir с отправлением с конечной в T; если автобус стоит на другом конце — сначала перегон
  const trip = (bus, dir, T, printed) => {
    if (dir === 's' && bus.at === 'S') run(bus, 'home', bus.free);
    if (dir === 'n' && bus.at === 'N') run(bus, 'out', Math.max(bus.free, T - OUT_BEFORE * 60));
    run(bus, dir, Math.max(bus.free, dir === 's' ? T - lead : T), T, printed);
  };
  const d = busDeparts(weekday);
  if (d) {
    const [first, second] = buses;
    const ev = [...d.s.map((t) => ({ dir: 's', T: t * 60 })), ...d.n.map((t) => ({ dir: 'n', T: t * 60 }))].sort((x, y) => x.T - y.T);
    // блоки рейсов: утро и после обеда (между рейсами на юг больше часа)
    const blocks = [];
    let lastS = -Infinity;
    for (const e of ev) {
      if (!blocks.length || (e.dir === 's' && e.T - lastS > BREAK * 60)) blocks.push([]);
      blocks[blocks.length - 1].push(e);
      if (e.dir === 's') lastS = e.T;
    }
    for (const block of blocks) {
      for (const e of block) trip(first, e.dir, e.T, true);
      // второй — навстречу первому, кроме последнего рейса блока на север
      const lastN = [...block].reverse().find((e) => e.dir === 'n');
      if (second) for (const e of block) if (e !== lastN) trip(second, e.dir === 's' ? 'n' : 's', e.T, false);
      // обед и ночь — на северном кольце
      for (const bus of buses) if (bus.at === 'S') run(bus, 'home', bus.free);
    }
  }
  const plan = buses.map((b) => b.runs);
  R.plans.set(weekday, plan);
  return plan;
}

// Отправление рейса от остановки по расписанию (с), если рейс в расписании
function scheduled(run, node) {
  if (run.T == null) return null;
  const c = CYCLE[node];
  const tt = BUS_TIMETABLE[run.kind];
  const k = c.stop && c.dir === run.kind ? tt.stops.indexOf(c.stop) : -1;
  return k < 0 ? null : run.T + tt.offsets[k] * 60;
}

// Положение одного автобуса (bus — 0 или 1): weekday — день недели (0 — воскресенье), sec —
// секунды от полуночи. → { s (путь по кругу), state: 'park' | 'stop' | 'move', text, next, since }
// next — когда автобус тронется, since — с какого времени стоит (для очереди на кольце).
export function busState(R, bus, weekday, sec) {
  const runs = dayPlan(R, weekday)[bus];
  const S = (i) => R.nodes[i].s;
  const name = (i) => `«${BUS_STOPS[CYCLE[i].stop].name}»`;
  const DIR = { s: BUS_DIRS.s.name, out: BUS_DIRS.s.name, n: BUS_DIRS.n.name, home: BUS_DIRS.n.name };
  const north = 'на кольце у Северной проходной';
  const south = 'на кольце у цеха № 12';
  if (!runs.length) return { s: S(0), state: 'park', text: `стоит ${north}: ${WEEKDAYS[weekday]}, рейсов нет`, next: Infinity, since: -Infinity };
  // ждёт следующего рейса там, где закончил предыдущий
  const waiting = (prev, next) => {
    const atSouth = prev && (prev.kind === 's' || prev.kind === 'out');
    const s = atSouth ? S(prev.b) : S(0);
    const where = atSouth ? south : north;
    let text;
    if (!next) text = `рейсы на сегодня окончены, стоит ${north}`;
    else if (next.kind === 'out') text = `стоит ${north}, выйдет на линию в ${hm(next.t0)}`;
    else if (next.kind === 'home') text = `стоит ${south}, вернётся на северное кольцо в ${hm(next.t0)}`;
    else text = `стоит ${where}, рейс ${DIR[next.kind]} в ${hm(next.T)}`;
    return { s, state: 'park', text, next: next ? next.t0 : Infinity, since: prev ? prev.t1 : -Infinity };
  };
  let k = runs.findIndex((r) => sec < r.t1);
  if (k < 0) return waiting(runs[runs.length - 1], null);
  const run = runs[k];
  if (sec < run.t0) return waiting(runs[k - 1], run);
  const p = run.pieces.find((x) => sec < x.t1) || run.pieces[run.pieces.length - 1];
  // время у остановки: у первого — по расписанию, у второго — по его графику между рейсами
  const when = (node) => {
    const T = scheduled(run, node);
    return T == null ? '' : `, ${run.printed ? 'по расписанию' : 'по графику'} ${hm(T)}`;
  };
  if (p.kind === 'dwell') return { s: p.s0 % R.total, state: 'stop', text: `на остановке ${name(p.at)}, ${DIR[run.kind]}${when(p.at)}`, next: p.t1, since: p.t0 };
  const s = (p.s0 + distAt(p.L, p.t1 - p.t0, sec - p.t0)) % R.total;
  let text;
  if (run.kind === 'out') text = `выходит на линию: едет ${south.replace('на кольце', 'на кольцо')}`;
  else if (run.kind === 'home') text = `возвращается ${north.replace('на кольце', 'на кольцо')}`;
  else if (p.to === run.b) text = run.kind === 's' ? `${DIR.s}, едет на конечную «Цех № 12»` : `${DIR.n}, едет на кольцо у Северной проходной`;
  else text = `${DIR[run.kind]}, следующая остановка ${name(p.to)}${when(p.to)}`;
  return { s, state: 'move', text, next: sec, since: sec };
}

// Автобусы на линии (count — сколько: 1 — только первый, по расписанию). Если один догоняет
// другой (на кольце), задний останавливается в GAP метрах позади и подтягивается, когда передний уедет.
export function busStates(R, weekday, sec, count = BUS_COUNT) {
  const st = [];
  for (let b = 0; b < Math.min(count, BUS_COUNT); b++) st.push(busState(R, b, weekday, sec));
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

// Рейсы автобуса за день (для проверки и подписей): [{ kind, T, printed, t0, t1 }]
export function busRuns(R, bus, weekday) {
  return dayPlan(R, weekday)[bus].map(({ kind, T, printed, t0, t1 }) => ({ kind, T, printed, t0, t1 }));
}

// Отправления автобуса bus от остановки stop в направлении dir за день (минуты от полуночи):
// у первого — расписание, у второго — его рейсы между ними.
export function busStopTimes(R, bus, stop, dir, weekday) {
  const k = BUS_TIMETABLE[dir].stops.indexOf(stop);
  if (k < 0 || bus >= BUS_COUNT) return [];
  return dayPlan(R, weekday)[bus].filter((r) => r.kind === dir && r.T != null).map((r) => r.T / 60 + BUS_TIMETABLE[dir].offsets[k]);
}

// План дня целиком, с кусками хода и стоянок (для проверки)
export const busPlan = (R, weekday) => dayPlan(R, weekday);
