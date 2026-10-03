// Выпрямление контура здания: стены — под прямым углом к главной оси, мелкие уступы
// и дрожание вершин (неточные контуры, распознавание космоснимков) убираются.
// Наклонные стены, которые заметно отходят от осей, остаются наклонными.
// Возвращает null, если выпрямить, не исказив здание, не получается.

import { ensureCCW, area, dist } from '../geo.js';
import { dedupe } from './geom.js';

const DEG = Math.PI / 180;

// Главное направление стен (по длинам рёбер, с точностью до 90°).
export function mainAngle(ring) {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = dist(a, b);
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]) * 4;
    sx += L * Math.cos(t);
    sy += L * Math.sin(t);
  }
  return Math.atan2(sy, sx) / 4;
}

// Упрощение Дугласа — Пекера для замкнутого контура (опорные — две самые далёкие вершины).
function simplify(ring, tol) {
  const n = ring.length;
  if (n <= 4) return ring;
  let i0 = 0;
  let i1 = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const d = dist(ring[0], ring[i]);
    if (d > best) [best, i1] = [d, i];
  }
  best = -1;
  for (let i = 0; i < n; i++) {
    const d = dist(ring[i1], ring[i]);
    if (d > best) [best, i0] = [d, i];
  }
  const keep = new Array(n).fill(false);
  keep[i0] = keep[i1] = true;
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const rec = (s, e) => {
    // вершины от s до e по кругу
    let far = -1;
    let fi = -1;
    for (let k = (s + 1) % n; k !== e; k = (k + 1) % n) {
      const d = segDist(ring[k], ring[s], ring[e]);
      if (d > far) [far, fi] = [d, k];
    }
    if (fi >= 0 && far > tol) {
      keep[fi] = true;
      rec(s, fi);
      rec(fi, e);
    }
  };
  rec(i0, i1);
  rec(i1, i0);
  return ring.filter((_, i) => keep[i]);
}

const lineX = (a, b) => {
  // пересечение прямых (p, d) и (q, e)
  const [p, d] = a;
  const [q, e] = b;
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
};

export function selfIntersects(ring) {
  const n = ring.length;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[(j + 1) % n];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return true;
    }
  }
  return false;
}

// opts: tol — допуск упрощения, м; minEdge — уступы короче не сохраняются, м;
// maxShift — насколько можно сдвинуть стену, м; angleTol — отклонение от оси, которое ещё считается «по оси», °.
export function straighten(ring0, { tol = 0.9, minEdge = 2, maxShift = 2.5, angleTol = 18 } = {}) {
  let ring = ensureCCW(dedupe(ring0));
  if (ring.length < 4) return null;
  const A0 = area(ring);
  const th = mainAngle(ring);
  const c = Math.cos(-th);
  const s = Math.sin(-th);
  const rot = ([x, y]) => [x * c - y * s, x * s + y * c];
  const unrot = ([x, y]) => [x * c + y * s, -x * s + y * c];
  const R = simplify(ring.map(rot), tol);
  // рёбра: класс H (вдоль оси), V (поперёк) или D (наклонное)
  const edgesOf = (P) =>
    P.map((a, i) => {
      const b = P[(i + 1) % P.length];
      const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG + 360) % 180;
      const cls = ang < angleTol || ang > 180 - angleTol ? 'H' : Math.abs(ang - 90) < angleTol ? 'V' : 'D';
      return { a, b, cls, L: dist(a, b) };
    });
  const edges = edgesOf(R);
  // серии подряд идущих рёбер одного класса (H, V) — одна стена
  const runsOf = (E) => {
    const runs = [];
    for (const e of E) {
      const last = runs[runs.length - 1];
      if (last && last.cls === e.cls && e.cls !== 'D') last.edges.push(e);
      else runs.push({ cls: e.cls, edges: [e] });
    }
    if (runs.length > 1 && runs[0].cls === runs[runs.length - 1].cls && runs[0].cls !== 'D') {
      const r = runs.pop();
      runs[0].edges = [...r.edges, ...runs[0].edges];
    }
    for (const r of runs) {
      r.L = r.edges.reduce((s, e) => s + e.L, 0);
      if (r.cls === 'H') r.v = r.edges.reduce((s, e) => s + e.L * (e.a[1] + e.b[1]) / 2, 0) / (r.L || 1);
      if (r.cls === 'V') r.v = r.edges.reduce((s, e) => s + e.L * (e.a[0] + e.b[0]) / 2, 0) / (r.L || 1);
    }
    return runs;
  };
  let runs = runsOf(edges);
  // мелкие уступы: короткая стена между двумя параллельными — убираем, стены сливаем
  for (let guard = 0; guard < 200; guard++) {
    const n = runs.length;
    if (n < 4) return null;
    let k = -1;
    let bestL = Infinity;
    for (let i = 0; i < n; i++) {
      const r = runs[i];
      const p = runs[(i - 1 + n) % n];
      const q = runs[(i + 1) % n];
      if (r.cls !== 'D' && r.L < minEdge && p.cls === q.cls && p.cls !== 'D' && p.cls !== r.cls && r.L < bestL) [k, bestL] = [i, r.L];
    }
    if (k >= 0) {
      // повернуть список так, чтобы уступ стал вторым: [p, уступ, q, …]
      const st = (k - 1 + n) % n;
      runs = [...runs.slice(st), ...runs.slice(0, st)];
      const [p, , q] = runs;
      const merged = { cls: p.cls, edges: [...p.edges, ...q.edges], L: p.L + q.L, v: (p.v * p.L + q.v * q.L) / (p.L + q.L) };
      runs = [merged, ...runs.slice(3)];
      continue;
    }
    // короткий скос угла между стеной вдоль и стеной поперёк — прямой угол
    const cut = runs.findIndex((r, i) => r.cls === 'D' && r.L < 1.5 * minEdge && [runs[(i - 1 + n) % n].cls, runs[(i + 1) % n].cls].sort().join('') === 'HV');
    if (cut < 0) break;
    runs = runs.filter((_, i) => i !== cut);
  }
  // прямые стен и их пересечения
  const lines = runs.map((r) => {
    if (r.cls === 'H') return [[0, r.v], [1, 0]];
    if (r.cls === 'V') return [[r.v, 0], [0, 1]];
    const e = r.edges[0];
    return [e.a, [e.b[0] - e.a[0], e.b[1] - e.a[1]]];
  });
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const j = (i + 1) % runs.length;
    let p = lineX(lines[i], lines[j]);
    if (!p) p = runs[j].edges[0].a; // параллельные соседние стены — оставить исходную вершину
    out.push(p);
  }
  // убрать совпавшие и лежащие на одной прямой вершины
  const clean = [];
  for (const p of out) if (!clean.length || dist(clean[clean.length - 1], p) > 0.05) clean.push(p);
  while (clean.length > 3 && dist(clean[0], clean[clean.length - 1]) <= 0.05) clean.pop();
  const res = [];
  for (let i = 0; i < clean.length; i++) {
    const a = clean[(i - 1 + clean.length) % clean.length];
    const b = clean[i];
    const d = clean[(i + 1) % clean.length];
    const cr = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    if (Math.abs(cr) > 1e-6 * (dist(a, b) + dist(b, d)) ** 2) res.push(b);
  }
  if (res.length < 3 || selfIntersects(res)) return null;
  const result = ensureCCW(res.map(unrot));
  // проверка: площадь и отклонение от исходного контура
  const A1 = area(result);
  if (Math.abs(A1 - A0) > Math.max(0.08 * A0, 4)) return null;
  const segD = (p, P) => {
    let m = Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      m = Math.min(m, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
    }
    return m;
  };
  const shift = Math.max(...ring.map((p) => segD(p, result)), ...result.map((p) => segD(p, ring)));
  if (shift > maxShift) return null;
  return result;
}
