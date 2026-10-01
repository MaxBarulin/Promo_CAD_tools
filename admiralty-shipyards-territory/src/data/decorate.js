// Оформление здания по контуру и типу: кровля (плоская, двускатная, многопролётная, вальмовая)
// и проёмы (ворота в торцах цехов, входы). Общее для сборки данных и редактора на сайте.

import { ensureCCW, area, dist, sub, norm } from '../geo.js';

// Минимальный описанный прямоугольник (по направлениям рёбер).
export function minRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const u = norm(sub(ring[(i + 1) % ring.length], ring[i]));
    if (!Number.isFinite(u[0])) continue;
    const v = [-u[1], u[0]];
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of ring) {
      const a = p[0] * u[0] + p[1] * u[1];
      const b = p[0] * v[0] + p[1] * v[1];
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const ar = (a1 - a0) * (b1 - b0);
    if (!best || ar < best.area) {
      const P = (a, b) => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];
      best = { area: ar, w: a1 - a0, d: b1 - b0, corners: [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)] };
    }
  }
  return best;
}

export const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// Кровля и проёмы — по реальному контуру.
export function decorate(b, named) {
  const ring = b.poly;
  const mr = minRect(ring);
  const rectish = !b.holes?.length && ring.length <= 6 && area(ring) / mr.area > 0.93;
  if (rectish) b.poly = ensureCCW(mr.corners);
  const quad = b.poly.length === 4;
  const span = Math.min(mr.w, mr.d);
  const long = Math.max(mr.w, mr.d);
  const shed = ['hall', 'elling', 'elling_historic', 'warehouse'].includes(b.type);
  let roof = { type: 'flat', color: b.roofColor };
  if (quad && shed) {
    const [c0, c1, , c3] = b.poly;
    const along = dist(c0, c3) > dist(c0, c1) ? 'd' : 'w';
    const bays = b.type === 'hall' && span > 44 ? Math.max(2, Math.round(span / 30)) : 1;
    roof = bays > 1
      ? { type: 'multigable', bays, along, h: 4, color: b.roofColor, lantern: true }
      : { type: 'gable', h: named?.roofH ?? Math.max(2.5, Math.min(10, span * 0.18)), color: b.roofColor, lantern: named?.lantern || (b.type === 'hall' && span > 25), ridge: along };
  } else if (quad && (named?.hip || b.type === 'historic')) {
    roof = { type: 'hip', h: 3, color: b.roofColor };
  } else if (quad && b.type === 'residential' && span < 24 && long < 120) {
    roof = { type: 'gable', h: 2.6 + (hash(b.id) % 10) / 10, color: b.roofColor, ridge: dist(b.poly[0], b.poly[1]) >= dist(b.poly[0], b.poly[3]) ? 'w' : 'd' };
  }
  b.roof = roof;
  // двери: ворота в торцах цехов, входы на длинных сторонах
  const edges = b.poly.map((a, i) => ({ i, L: dist(a, b.poly[(i + 1) % b.poly.length]) })).sort((x, y) => y.L - x.L);
  const doors = [];
  if (quad) {
    const wE = dist(b.poly[0], b.poly[1]);
    const dE = dist(b.poly[0], b.poly[3]);
    const shortE = wE < dE ? [0, 2] : [1, 3];
    const longE = wE < dE ? [1, 3] : [0, 2];
    if (shed) {
      const gw = Math.min(span * 0.45, b.type === 'elling' ? 22 : 12);
      const gh = Math.min(b.h - 2, b.type === 'elling' ? b.h * 0.8 : 9);
      for (const e of shortE) doors.push({ edge: e, t: 0.5, w: gw, h: gh, kind: 'gate' });
      doors.push({ edge: longE[0], t: 0.3, w: 2.2, h: 2.6 });
    } else if (b.type === 'utility') {
      doors.push({ edge: shortE[0], t: 0.5, w: 2.4, h: 2.8, kind: 'gate' });
    } else {
      doors.push({ edge: longE[0], t: 0.5, w: 3, h: 3, kind: b.kind === 'shipyard' ? 'main' : undefined, canopy: b.kind === 'shipyard' ? 2.5 : undefined });
      doors.push({ edge: longE[1], t: 0.5, w: 2.2, h: 2.6 });
    }
  } else if (edges.length) {
    const e0 = edges[0];
    if (shed && edges[1]) doors.push({ edge: edges[1].i, t: 0.5, w: Math.min(10, edges[1].L * 0.4), h: Math.min(b.h - 2, 8), kind: 'gate' });
    if (b.type === 'residential') {
      for (let t = 9; t < e0.L - 4; t += 18) doors.push({ edge: e0.i, t: t / e0.L, w: 1.7, h: 2.7 });
    } else doors.push({ edge: e0.i, t: 0.5, w: 2.4, h: 2.8 });
  }
  b.doors = doors;
  delete b.roofColor;
  return b;
}
