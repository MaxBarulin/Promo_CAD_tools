// Ограждение: ж/б забор с колючей проволокой, сетчатое ограждение, исторический
// кирпичный забор; ворота (откатные) со столбами и шлагбаумом.

import { polylineLength, pointAt, project, add, mul, sub, norm, dist, pointInRing, ensureCCW } from '../geo.js';

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

// ---------- автоматическая ограда по контуру территории ----------
//
// Контур каждого участка верфи обходится с шагом 2 м; по тому, что снаружи, выбирается тип:
//   • городская суша — ж/б забор (на Ново-Адмиралтейском острове — исторический кирпичный);
//   • узкая вода (Фонтанка, Пряжка, Мойка, канал), за которой город, — ограждение по кромке
//     набережной (на Ново-Адмиралтейском острове — кирпичная стена);
//   • Нева, ковши, протоки между участками верфи — без ограды (причальный фронт);
//   • стена здания на границе участка — без ограды (здание само служит оградой).
// Ворота (data.gates) вырезаются в ближайшем участке ограды.

const inMP = (p, mp) => mp.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h)));

function distToRing(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ab = sub(b, a);
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
    best = Math.min(best, dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
  }
  return best;
}

// Упрощение полилинии (Дуглас — Пекер).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0];
    const b = pts[i1];
    const d = norm(sub(b, a));
    let worst = -1;
    let wi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const v = sub(pts[i], a);
      const e = Math.abs(v[0] * d[1] - v[1] * d[0]);
      if (e > worst) {
        worst = e;
        wi = i;
      }
    }
    if (worst > tol) {
      keep[wi] = true;
      stack.push([i0, wi], [wi, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function autoFences(data, P, { step = 2, minRun = 8 } = {}) {
  const yard = P.shipyardMP;
  const water = P.water;
  const yardBuildings = data.buildings.filter((b) => b.kind === 'shipyard').map((b) => ensureCCW(b.poly));
  const nearBuilding = (p) => yardBuildings.some((r) => pointInRing(p, r) || distToRing(p, r) < 1.6);
  const rivers = data.water.rivers || [];
  const out = [];

  const classify = (p, n, zoneId) => {
    const q = add(p, mul(n, 5));
    if (inMP(q, yard)) return 'none';
    if (!inMP(q, water)) return zoneId === 'novo' ? 'wall' : 'concrete';
    // вода: ищем противоположный берег
    for (let d = 10; d <= 130; d += 5) {
      const r = add(p, mul(n, d));
      if (inMP(r, water)) continue;
      if (inMP(r, yard)) return 'none';
      return zoneId === 'novo' ? 'wall' : 'mesh';
    }
    return 'none';
  };

  for (const z of [...new Map(data.zones.filter((zz) => zz.kind === 'shipyard').map((zz) => [zz.id, zz])).values()]) {
    for (const poly of P.zones[z.id] || []) {
      const ring = ensureCCW(poly[0]);
      const closed = [...ring, ring[0]];
      const L = polylineLength(closed);
      const samples = [];
      for (let s = 0; s < L; s += step) {
        const { p, dir } = pointAt(closed, s);
        const n = [dir[1], -dir[0]]; // наружу (контур против часовой — суша слева)
        let type = classify(p, n, z.id);
        if (type !== 'none' && nearBuilding(add(p, mul(n, -1)))) type = 'none';
        samples.push({ s, p, n, type });
      }
      // сглаживание: короткие вкрапления другого типа поглощаются соседями
      const k = Math.ceil(minRun / step);
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < samples.length; i++) {
          const prev = samples[(i - 1 + samples.length) % samples.length].type;
          let j = i;
          while (j - i < k && samples[j % samples.length].type === samples[i].type) j++;
          const next = samples[j % samples.length].type;
          if (j - i < k && prev === next && prev !== samples[i].type) for (let m = i; m < j; m++) samples[m % samples.length].type = prev;
        }
      }
      // начинаем обход со смены типа, чтобы не разрывать участок на стыке начала контура
      let start = samples.findIndex((x, i) => x.type !== samples[(i - 1 + samples.length) % samples.length].type);
      if (start < 0) start = 0;
      const seq = [...samples.slice(start), ...samples.slice(0, start)];
      const runs = [];
      for (const x of seq) {
        const last = runs[runs.length - 1];
        if (last && last.type === x.type) last.pts.push(x);
        else runs.push({ type: x.type, pts: [x] });
      }
      if (runs.length > 1 && runs[0].type === runs[runs.length - 1].type) runs[0].pts = [...runs.pop().pts, ...runs[0].pts];
      for (const r of runs) {
        if (r.type === 'none' || r.pts.length * step < minRun) continue;
        const inset = r.type === 'wall' ? 0.9 : r.type === 'mesh' ? 0.6 : 0.7;
        // продлеваем на полшага к соседям, чтобы не было щелей у изломов
        const pts = r.pts.map((x) => add(x.p, mul(x.n, -inset)));
        const line = simplify(pts, 0.35);
        if (polylineLength(line) < minRun) continue;
        out.push({ id: `F-${z.id}-${out.length + 1}`, zone: z.id, type: r.type, h: r.type === 'wall' ? 3.2 : r.type === 'mesh' ? 2.2 : 2.8, line, gates: [] });
      }
    }
  }

  // ворота: в ближайший участок ограды
  for (const g of data.gates || []) {
    let best = null;
    for (const f of out) {
      const pr = project(f.line, g.at);
      if (!best || pr.d < best.pr.d) best = { f, pr };
    }
    if (best && best.pr.d < 25) {
      const L = polylineLength(best.f.line);
      const s = Math.min(Math.max(best.pr.s, g.w / 2 + 1), L - g.w / 2 - 1);
      best.f.gates.push({ s, w: g.w, name: g.name });
    }
  }

  // названия — по ближайшей улице или реке снаружи
  const named = [
    ...data.streets.map((s) => ({ line: s.line, name: s.name })),
    ...rivers.map((r) => ({ line: r.line, name: r.name.startsWith('р.') || /канал/.test(r.name) ? r.name : `р. ${r.name}` })),
  ];
  const kindName = { concrete: 'Ж/б забор', mesh: 'Ограждение по кромке набережной', wall: 'Кирпичная ограда' };
  for (const f of out) {
    const mid = pointAt(f.line, polylineLength(f.line) / 2).p;
    let near = null;
    for (const c of named) {
      const pr = project(c.line, mid);
      if (pr.d < 90 && (!near || pr.d < near.d)) near = { d: pr.d, name: c.name };
    }
    const zone = data.zones.find((z) => z.id === f.zone);
    f.name = `${kindName[f.type]}${near ? ` (${near.name})` : ''} — ${zone ? zone.name : ''}`;
  }
  return out;
}
