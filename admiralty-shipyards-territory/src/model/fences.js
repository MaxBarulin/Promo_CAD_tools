// Ограждение: ж/б забор с колючей проволокой, сетчатое ограждение, исторический
// кирпичный забор; ворота (откатные) со столбами и шлагбаумом.

import { polylineLength, pointAt, add, mul, sub, norm, dist } from '../geo.js';

// Разбиение полилинии на участки [s0, s1] за вычетом проёмов ворот.
function pieces(line, gates) {
  const L = polylineLength(line);
  const cuts = (gates || []).map((g) => [g.s - g.w / 2, g.s + g.w / 2]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let s = 0;
  for (const [a, b] of cuts) {
    if (a > s) out.push([s, a]);
    s = Math.max(s, b);
  }
  if (s < L) out.push([s, L]);
  return out;
}

// Точки полилинии между s0 и s1 (включая вершины изломов).
function sub_line(line, s0, s1) {
  const pts = [pointAt(line, s0).p];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += dist(line[i - 1], line[i]);
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) pts.push(line[i]);
  }
  pts.push(pointAt(line, s1).p);
  return pts;
}

export function buildFence(sink, f) {
  const h = f.h || 2.5;
  for (const [s0, s1] of pieces(f.line, f.gates)) {
    const pts = sub_line(f.line, s0, s1);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const L = dist(a, b);
      if (L < 0.05) continue;
      const dir = norm(sub(b, a));
      if (f.type === 'concrete') {
        sink.beam('fence_concrete', [a[0], a[1], h / 2], [b[0], b[1], h / 2], 0.16, h);
        // столбы с шагом 3 м
        const n = Math.max(1, Math.round(L / 3));
        for (let k = 0; k <= n; k++) {
          const p = add(a, mul(dir, (L * k) / n));
          sink.box('fence_post', [p[0], p[1], (h + 0.15) / 2], [0.3, 0.3, h + 0.15], Math.atan2(dir[1], dir[0]) * 57.2958);
          // кронштейн «козырька»
          sink.beam('fence_wire', [p[0], p[1], h + 0.1], [p[0], p[1], h + 0.6], 0.05, 0.05);
        }
        // колючая проволока — три нити
        for (const z of [h + 0.25, h + 0.42, h + 0.58]) sink.beam('fence_wire', [a[0], a[1], z], [b[0], b[1], z], 0.03, 0.03);
      } else if (f.type === 'mesh') {
        sink.beam('fence_mesh', [a[0], a[1], h / 2 + 0.1], [b[0], b[1], h / 2 + 0.1], 0.02, h - 0.2);
        const n = Math.max(1, Math.round(L / 3));
        for (let k = 0; k <= n; k++) {
          const p = add(a, mul(dir, (L * k) / n));
          sink.box('steel_dark', [p[0], p[1], h / 2], [0.08, 0.08, h], 0);
        }
        sink.beam('steel_dark', [a[0], a[1], h], [b[0], b[1], h], 0.06, 0.06);
        sink.beam('steel_dark', [a[0], a[1], 0.15], [b[0], b[1], 0.15], 0.06, 0.06);
      } else {
        // кирпичная стена с пилястрами и белой тягой
        sink.beam('fence_wall', [a[0], a[1], h / 2], [b[0], b[1], h / 2], 0.55, h);
        sink.beam('trim', [a[0], a[1], h + 0.08], [b[0], b[1], h + 0.08], 0.7, 0.16);
        const n = Math.max(1, Math.round(L / 4.5));
        for (let k = 0; k <= n; k++) {
          const p = add(a, mul(dir, (L * k) / n));
          sink.box('fence_wall', [p[0], p[1], (h + 0.3) / 2], [0.8, 0.8, h + 0.3], Math.atan2(dir[1], dir[0]) * 57.2958);
          sink.box('trim', [p[0], p[1], h + 0.38], [0.95, 0.95, 0.16], Math.atan2(dir[1], dir[0]) * 57.2958);
        }
      }
    }
  }

  // ворота
  for (const g of f.gates || []) {
    const { p, dir } = pointAt(f.line, g.s);
    const ang = Math.atan2(dir[1], dir[0]) * 57.2958;
    const a = add(p, mul(dir, -g.w / 2));
    const b = add(p, mul(dir, g.w / 2));
    const postKey = f.type === 'wall' ? 'fence_wall' : 'steel_dark';
    const ph = f.type === 'wall' ? h + 1.2 : h + 0.4;
    const ps = f.type === 'wall' ? 1.1 : 0.35;
    for (const q of [add(a, mul(dir, -ps / 2)), add(b, mul(dir, ps / 2))]) sink.box(postKey, [q[0], q[1], ph / 2], [ps, ps, ph], ang);
    if (f.type === 'wall') {
      for (const q of [add(a, mul(dir, -ps / 2)), add(b, mul(dir, ps / 2))]) sink.box('trim', [q[0], q[1], ph + 0.15], [ps + 0.2, ps + 0.2, 0.3], ang);
    }
    // створка (приоткрыта на треть)
    const gh = Math.min(h, 2.4);
    const off = g.w * 0.33;
    const g0 = add(a, mul(dir, off));
    const g1 = add(b, mul(dir, off));
    const n = [-dir[1], dir[0]];
    const shift = mul(n, 0.35);
    const G0 = add(g0, shift);
    const G1 = add(g1, shift);
    sink.beam('gate_leaf', [G0[0], G0[1], 0.15], [G1[0], G1[1], 0.15], 0.08, 0.12);
    sink.beam('gate_leaf', [G0[0], G0[1], gh], [G1[0], G1[1], gh], 0.08, 0.12);
    const bars = Math.round(g.w / 0.5);
    for (let k = 0; k <= bars; k++) {
      const q = add(G0, mul(dir, (g.w * k) / bars));
      sink.beam('gate_leaf', [q[0], q[1], 0.15], [q[0], q[1], gh], 0.05, 0.05);
    }
    // шлагбаум
    const sb = add(p, mul(n, -3));
    const sa = add(sb, mul(dir, -g.w / 2));
    sink.box('steel_dark', [sa[0], sa[1], 0.5], [0.4, 0.4, 1.0], ang);
    const e = add(sa, mul(dir, g.w * 0.9));
    sink.beam('crane_red', [sa[0], sa[1], 1.0], [e[0], e[1], 1.0], 0.1, 0.1);
  }
}
