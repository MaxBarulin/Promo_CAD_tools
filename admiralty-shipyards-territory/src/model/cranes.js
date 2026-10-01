// Краны: портальные (набережные), башенные стапельные на рельсовом ходу, козловые.

import { DEG } from '../geo.js';

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

// Решётчатая ферма квадратного сечения между точками p0 и p1.
function lattice(sink, key, p0, p1, w0, w1 = w0, step = 3, chord = 0.25, brace = 0.12) {
  const ax = V.sub(p1, p0);
  const L = V.len(ax);
  const d = V.norm(ax);
  let u = V.cross(d, [0, 0, 1]);
  if (V.len(u) < 1e-3) u = [1, 0, 0];
  u = V.norm(u);
  const v = V.norm(V.cross(u, d));
  const corner = (p, w, i) => {
    const su = i === 0 || i === 3 ? -0.5 : 0.5;
    const sv = i < 2 ? -0.5 : 0.5;
    return V.add(p, V.add(V.mul(u, su * w), V.mul(v, sv * w)));
  };
  for (let i = 0; i < 4; i++) sink.beam(key, corner(p0, w0, i), corner(p1, w1, i), chord, chord);
  const n = Math.max(1, Math.round(L / step));
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const p = V.add(p0, V.mul(ax, t));
    const w = w0 + (w1 - w0) * t;
    const cs = [0, 1, 2, 3].map((i) => corner(p, w, i));
    for (let i = 0; i < 4; i++) sink.beam(key, cs[i], cs[(i + 1) % 4], brace, brace);
    if (prev) for (let i = 0; i < 4; i++) sink.beam(key, prev[i], cs[(i + 1) % 4], brace, brace);
    prev = cs;
  }
}

function frameAt(at, angleDeg) {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  return {
    // u — вдоль рельсов, v — поперёк
    p: (u, v, z) => [at[0] + c * u - s * v, at[1] + s * u + c * v, z],
  };
}

export function buildPortalCrane(sink, c) {
  const F = frameAt(c.at, c.track);
  const gauge = 10.5;
  const base = 10;
  const zp = 9.5;
  const portal = 'crane_gray';
  const body = c.color || 'crane_yellow';
  // ноги портала
  for (const su of [-1, 1])
    for (const sv of [-1, 1]) {
      const foot = F.p((su * base) / 2, (sv * gauge) / 2, 0.3);
      const top = F.p(su * 3.2, sv * 3.2, zp);
      sink.beam(portal, foot, top, 0.9, 0.9);
      sink.box('steel_dark', [foot[0], foot[1], 0.45], [2.2, 1.0, 0.9], c.track);
    }
  // связи портала
  for (const sv of [-1, 1]) sink.beam(portal, F.p(-base / 2, (sv * gauge) / 2, 1.2), F.p(base / 2, (sv * gauge) / 2, 1.2), 0.6, 0.6);
  sink.box(portal, [...F.p(0, 0, 0).slice(0, 2), zp + 0.7], [8, 8, 1.4], c.track);
  // поворотная часть
  sink.cylinder('steel_dark', F.p(0, 0, 0), zp + 1.4, zp + 2.2, 3.2, 3.2, 16);
  const sl = c.slew;
  const R = frameAt(c.at, sl);
  const z0 = zp + 2.2;
  sink.box(body, [...R.p(-1.2, 0, 0).slice(0, 2), z0 + 2], [8, 4.8, 4], sl);
  sink.box('steel_dark', [...R.p(-5.6, 0, 0).slice(0, 2), z0 + 1.6], [2.2, 4.4, 3.2], sl); // противовес
  sink.box(body, [...R.p(2.6, 2.6, 0).slice(0, 2), z0 + 2.4], [2.2, 1.8, 2.4], sl); // кабина
  sink.box('glass', [...R.p(3.75, 2.6, 0).slice(0, 2), z0 + 2.8], [0.06, 1.5, 1.0], sl);
  // А-образная стойка
  const apex = R.p(-1.5, 0, c.h);
  for (const sv of [-1.6, 1.6]) sink.beam(body, R.p(-3.5, sv, z0 + 4), apex, 0.5, 0.5);
  for (const sv of [-1.6, 1.6]) sink.beam(body, R.p(1.5, sv, z0 + 4), apex, 0.4, 0.4);
  // стрела
  const elev = 52 * DEG;
  const pivot = R.p(2.5, 0, z0 + 3.2);
  const jib = c.jib;
  const tip = V.add(pivot, V.add(V.mul([Math.cos(sl * DEG), Math.sin(sl * DEG), 0], jib * Math.cos(elev)), [0, 0, jib * Math.sin(elev)]));
  for (const sv of [-0.9, 0.9]) {
    const off = [-Math.sin(sl * DEG) * sv, Math.cos(sl * DEG) * sv, 0];
    sink.beam(body, V.add(pivot, off), V.add(tip, V.mul(off, 0.3)), 0.55, 0.7);
  }
  // хобот
  const nose = V.add(tip, V.add(V.mul([Math.cos(sl * DEG), Math.sin(sl * DEG), 0], 7), [0, 0, -1.5]));
  sink.beam(body, V.add(tip, [0, 0, 0.6]), nose, 0.7, 0.9);
  sink.beam(body, V.add(apex, [0, 0, -0.5]), V.add(tip, V.mul([Math.cos(sl * DEG), Math.sin(sl * DEG), 0], -4)), 0.25, 0.25);
  // канаты и крюк
  sink.beam('cable', apex, tip, 0.06, 0.06);
  const hookZ = Math.max(4, nose[2] - 14);
  sink.beam('cable', nose, [nose[0], nose[1], hookZ], 0.06, 0.06);
  sink.box('steel_dark', [nose[0], nose[1], hookZ - 0.5], [0.8, 0.5, 1.0], sl);
}

export function buildTowerCrane(sink, c) {
  const F = frameAt(c.at, c.track);
  const gauge = 8;
  const zb = 7;
  const body = c.color || 'crane_yellow';
  // ходовой портал
  for (const su of [-1, 1])
    for (const sv of [-1, 1]) {
      const foot = F.p(su * 4, (sv * gauge) / 2, 0.3);
      sink.beam(body, foot, F.p(su * 1.6, sv * 1.6, zb), 0.7, 0.7);
      sink.box('steel_dark', [foot[0], foot[1], 0.5], [2.4, 1.1, 1.0], c.track);
    }
  sink.box('steel_dark', [...F.p(0, 0, 0).slice(0, 2), zb + 0.5], [4.5, 4.5, 1.0], c.track);
  // балласт на портале
  sink.box('panel', [...F.p(0, 0, 0).slice(0, 2), zb + 1.6], [3.6, 3.6, 1.2], c.track);
  // башня
  const top = c.h;
  lattice(sink, body, [c.at[0], c.at[1], zb + 1], [c.at[0], c.at[1], top], 2.6, 2.6, 2.6, 0.28, 0.12);
  // поворотная часть
  const sl = c.slew;
  const R = frameAt(c.at, sl);
  sink.cylinder('steel_dark', [c.at[0], c.at[1]], top, top + 0.8, 2.2, 2.2, 12);
  sink.box(body, [...R.p(1.8, 1.9, 0).slice(0, 2), top - 1.0], [2.4, 2.0, 2.6], sl); // кабина
  sink.box('glass', [...R.p(3.02, 1.9, 0).slice(0, 2), top - 0.8], [0.06, 1.6, 1.2], sl);
  const head = [c.at[0], c.at[1], top + 9];
  lattice(sink, body, [c.at[0], c.at[1], top + 0.8], head, 2.2, 0.6, 2.2, 0.22, 0.1);
  // стрела (горизонтальная, решётчатая) и противовесная консоль
  const jibStart = R.p(0, 0, top + 2.2);
  const jibEnd = R.p(c.jib, 0, top + 2.2);
  lattice(sink, body, jibStart, jibEnd, 1.6, 1.2, 3, 0.2, 0.1);
  const cjEnd = R.p(-c.jib * 0.32, 0, top + 2.2);
  lattice(sink, body, jibStart, cjEnd, 1.8, 1.8, 3, 0.2, 0.1);
  sink.box('panel', [...R.p(-c.jib * 0.28, 0, 0).slice(0, 2), top + 1.0], [3.4, 2.6, 2.6], sl);
  // тяги
  sink.beam('cable', head, R.p(c.jib * 0.7, 0, top + 2.9), 0.12, 0.12);
  sink.beam('cable', head, cjEnd, 0.12, 0.12);
  // грузовая тележка и крюк
  const tr = R.p(c.jib * 0.55, 0, top + 1.2);
  sink.box('steel_dark', [tr[0], tr[1], tr[2]], [2.2, 1.8, 0.8], sl);
  const hookZ = Math.max(6, top - 26);
  sink.beam('cable', tr, [tr[0], tr[1], hookZ], 0.06, 0.06);
  sink.box('steel_dark', [tr[0], tr[1], hookZ - 0.6], [0.9, 0.6, 1.2], sl);
}

export function buildGantryCrane(sink, c) {
  // c.angle — направление рельсов (ход крана); пролёт перекрывает поперёк
  const F = frameAt(c.at, c.angle);
  const span = c.span;
  const h = c.h;
  const key = c.color || 'crane_blue';
  for (const sv of [-1, 1]) {
    const v = (sv * span) / 2;
    for (const su of [-1, 1]) sink.beam(key, F.p((su * c.len) / 2, v, 0.4), F.p(su * 1.2, v, h), 0.8, 0.8);
    sink.beam(key, F.p(-c.len / 2, v, 0.8), F.p(c.len / 2, v, 0.8), 0.9, 0.9);
    sink.box('steel_dark', [...F.p(-c.len / 2, v, 0).slice(0, 2), 0.5], [1.8, 1.0, 1.0], c.angle);
    sink.box('steel_dark', [...F.p(c.len / 2, v, 0).slice(0, 2), 0.5], [1.8, 1.0, 1.0], c.angle);
  }
  // мост (две балки) с консолями
  for (const su of [-1.1, 1.1]) sink.beam(key, F.p(su, -span / 2 - 6, h + 0.9), F.p(su, span / 2 + 6, h + 0.9), 1.0, 1.8);
  // тележка
  const t = F.p(0, span * 0.15, 0);
  sink.box('steel_dark', [t[0], t[1], h + 2.4], [3.6, 3.0, 1.4], c.angle);
  sink.beam('cable', [t[0], t[1], h + 1.6], [t[0], t[1], 3.5], 0.06, 0.06);
  sink.box('steel_dark', [t[0], t[1], 3.0], [1.0, 0.7, 1.0], c.angle);
  // кабина
  const cb = F.p(0, span / 2 - 1.6, 0);
  sink.box(key, [cb[0], cb[1], h - 1.6], [2.2, 2.0, 2.2], c.angle);
}

export function buildCrane(sink, c) {
  if (c.type === 'portal') buildPortalCrane(sink, c);
  else if (c.type === 'tower') buildTowerCrane(sink, c);
  else buildGantryCrane(sink, c);
}
