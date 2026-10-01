// Генерация зданий: стены, цоколь, карнизы, кровли (плоская с парапетом, двускатная,
// вальмовая, многопролётная), окна по этажам, двери и ворота, портики, вывески.

import { ensureCCW, ensureCW, sub, add, mul, norm, len, dist, lerp, centroid, area, pointInRing } from '../geo.js';
import { dedupe, Sink, triangulate } from './geom.js';
import { selfIntersects } from './straighten.js';
import pc from 'polygon-clipping';

// Смещение замкнутого контура (CCW) наружу на d (d < 0 — внутрь).
export function offsetRing(ring, d) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const e1 = norm(sub(c, p));
    const e2 = norm(sub(q, c));
    const n1 = [e1[1], -e1[0]];
    const n2 = [e2[1], -e2[0]];
    let m = norm(add(n1, n2));
    let k = m[0] * n1[0] + m[1] * n1[1];
    if (k < 0.3) {
      m = n1;
      k = 1;
    }
    out.push(add(c, mul(m, d / k)));
  }
  return out;
}

// Детерминированный «шум» по координатам — какие окна светятся вечером.
const hash3 = (p) => {
  const v = Math.sin(p[0] * 12.9898 + p[1] * 78.233 + p[2] * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

// ---------- параметры окон по типам зданий ----------

// Окна по типу здания; sill — высота низа окон первого этажа над землёй (по обмеру), м.
function windowSpec(b) {
  // глухие здания (подстанции, технические помещения) — без окон
  if (b.windows === false) return null;
  const floors = b.floors || Math.max(1, Math.round(b.h / 3.6));
  // сплошное остекление в сетку: от цоколя почти до верха, над ним — глухой пояс
  if (b.glazing === 'grid') return { rows: [{ z0: 1.2, h: Math.max(2, b.h * 0.78 - 1.2) }], w: 2.84, step: 3, frame: 'frame_dark', glass: 'glass_green', grid: 1.5 };
  // обычные окна по этажам (склады и цеха в два-три этажа)
  if (b.glazing === 'floors') return { rows: Array.from({ length: floors }, (_, i) => ({ z0: (i * b.h) / floors + (b.h / floors) * 0.3, h: (b.h / floors) * 0.48 })), w: 2.1, step: 3.3, frame: 'frame_dark', glass: 'glass' };
  // ленточные окна по этажам
  if (b.glazing === 'ribbon') return { rows: Array.from({ length: floors }, (_, i) => ({ z0: (i * b.h) / floors + (b.h / floors) * 0.32, h: (b.h / floors) * 0.42 })), w: 2.9, step: 3, frame: 'frame_dark', glass: 'glass', minEdge: 3.5 };
  const spec = baseWindowSpec(b);
  if (Number.isFinite(b.sill) && spec.rows.length) {
    const [r0] = spec.rows;
    spec.rows = [{ z0: b.sill, h: r0.h + Math.max(0, r0.z0 - b.sill) * 0.6 }, ...spec.rows.slice(1)];
  }
  return spec;
}

function baseWindowSpec(b) {
  const floors = b.floors || Math.max(1, Math.round(b.h / 3.4));
  const fh = b.h / floors;
  const perFloor = (sillFrac, hFrac, extra = {}) => ({
    rows: Array.from({ length: floors }, (_, i) => ({ z0: i * fh + fh * sillFrac, h: fh * hFrac })),
    ...extra,
  });
  switch (b.type) {
    case 'residential':
      return perFloor(0.3, 0.52, { w: 1.35, step: 3.3, frame: 'frame_white', glass: 'glass', sill: true, mullion: true });
    case 'historic':
      return perFloor(0.28, 0.55, { w: 1.45, step: 3.7, frame: 'frame_white', glass: 'glass', sill: true, mullion: true });
    case 'office':
      return perFloor(0.27, 0.5, { w: 1.9, step: 3.0, frame: 'frame_white', glass: 'glass', mullion: true });
    case 'checkpoint':
      return perFloor(0.25, 0.6, { w: 2.6, step: 3.1, frame: 'frame_dark', glass: 'glass_light', mullion: true, minEdge: 3.5 });
    case 'warehouse_historic':
      return perFloor(0.3, 0.42, { w: 1.3, step: 4.2, frame: 'frame_white', glass: 'glass', sill: true });
    case 'historic_hall':
      return { rows: [{ z0: 2.2, h: Math.min(b.h - 5, 8) }], w: 3.0, step: 5.5, frame: 'frame_white', glass: 'glass', mullion: true, transom: true };
    case 'elling_historic':
      return { rows: [{ z0: 4, h: Math.min(8, b.h - 6) }], w: 2.6, step: 5.6, frame: 'frame_white', glass: 'glass', mullion: true, transom: true };
    case 'elling':
      if (b.wall === 'brick')
        return { rows: [{ z0: 4.5, h: b.h * 0.5 }], w: 3.2, step: 6.8, frame: 'frame_white', glass: 'glass', mullion: true, transom: true };
      return {
        rows: [
          { z0: 4, h: 2.8 },
          { z0: b.h - 7, h: 4 },
        ],
        w: 5.4,
        step: 6,
        frame: 'frame_dark',
        glass: 'glass_light',
        mullion: true,
      };
    case 'hall': {
      const rows = [{ z0: 3.2, h: 2.4 }];
      if (b.h > 13) rows.push({ z0: b.h - 5.4, h: 2.8 });
      return { rows, w: 5.4, step: 6, frame: 'frame_dark', glass: 'glass_light', mullion: true };
    }
    case 'warehouse':
      return { rows: [{ z0: b.h - 2.6, h: 1.1 }], w: 2.6, step: 8, frame: 'frame_dark', glass: 'glass_light' };
    case 'utility': {
      const rows = [{ z0: 2.2, h: 1.8 }];
      if (b.h > 8) rows.push({ z0: b.h - 3.6, h: 1.6 });
      return { rows, w: 1.6, step: 5, frame: 'frame_dark', glass: 'glass' };
    }
    default:
      return perFloor(0.3, 0.5, { w: 1.5, step: 3.5, frame: 'frame_white', glass: 'glass' });
  }
}

const HAS_CORNICE = new Set(['residential', 'historic', 'office', 'warehouse_historic', 'historic_hall', 'elling_historic', 'checkpoint']);
const HAS_BANDS = new Set(['historic', 'residential', 'warehouse_historic']);

// ---------- фасад: окна и двери на одной стороне ----------

function facade(sink, a, b, spec, doors, opts) {
  const L = dist(a, b);
  const dir = norm(sub(b, a));
  const nOut = [dir[1], -dir[0]];
  const P = (u, z, off) => [a[0] + dir[0] * u + nOut[0] * off, a[1] + dir[1] * u + nOut[1] * off, z];
  const rectQ = (key, u0, u1, z0, z1, off) => sink.quad(key, P(u0, z0, off), P(u1, z0, off), P(u1, z1, off), P(u0, z1, off));

  // двери и ворота
  const blocked = [];
  for (const d of doors) {
    const uc = d.t * L;
    const w = Math.min(d.w, L - 1);
    const u0 = uc - w / 2;
    const u1 = uc + w / 2;
    const h = Math.min(d.h, opts.h - 0.5);
    blocked.push([u0 - 0.5, u1 + 0.5, h + 0.4]);
    if (d.kind === 'gate') {
      rectQ('trim', u0 - 0.3, u1 + 0.3, 0, h + 0.3, 0.03);
      rectQ('gate', u0, u1, 0, h, 0.06);
      // горизонтальные филёнки ворот
      for (let z = 1.2; z < h - 0.3; z += 1.2) rectQ('frame_dark', u0, u1, z, z + 0.08, 0.08);
    } else if (d.kind === 'arch') {
      rectQ('trim', u0 - 0.35, u1 + 0.35, 0, h + 0.35, 0.03);
      rectQ('base', u0, u1, 0, h, 0.06);
    } else if (d.kind === 'main') {
      rectQ('frame_dark', u0 - 0.15, u1 + 0.15, 0, h + 0.15, 0.03);
      rectQ('glass_light', u0, u1, 0, h, 0.06);
      rectQ('frame_dark', (u0 + u1) / 2 - 0.05, (u0 + u1) / 2 + 0.05, 0, h, 0.08);
      if (d.canopy) {
        const c = P((u0 + u1) / 2, h + 0.45, d.canopy / 2);
        sink.box('canopy', [c[0], c[1], h + 0.45], [w + 1.2, d.canopy, 0.22], opts.angle);
      }
    } else {
      rectQ('trim', u0 - 0.12, u1 + 0.12, 0, h + 0.12, 0.03);
      rectQ(opts.doorKey || 'door', u0, u1, 0, h, 0.06);
    }
  }

  if (!spec || opts.blind || L < (spec.minEdge || 4)) return;

  // окна
  const step = spec.step;
  const n = Math.floor((L - 1.2) / step);
  if (n < 1) return;
  const start = (L - n * step) / 2 + step / 2;
  const hw = spec.w / 2;
  for (const row of spec.rows) {
    const z1 = Math.min(row.z0 + row.h, opts.h - 0.4);
    if (z1 - row.z0 < 0.5) continue;
    for (let i = 0; i < n; i++) {
      const uc = start + i * step;
      const u0 = uc - hw;
      const u1 = uc + hw;
      let z0 = row.z0;
      const hit = blocked.filter(([b0, b1, bh]) => u1 > b0 && u0 < b1 && z0 < bh);
      // сплошное остекление продолжается над воротами, обычные окна над ними не ставятся
      if (hit.length && !spec.grid) continue;
      if (hit.length) z0 = Math.max(...hit.map((x) => x[2])) + 0.3;
      if (z1 - z0 < 1) continue;
      rectQ(spec.frame, u0 - 0.1, u1 + 0.1, z0 - 0.1, z1 + 0.1, 0.03);
      const wp = P(uc, z0, 0);
      const lit = spec.glass === 'glass' && hash3(wp) < 0.42;
      rectQ(lit ? 'glass_lit' : spec.glass, u0, u1, z0, z1, 0.05);
      if (spec.mullion && spec.w > 1.1) rectQ(spec.frame, uc - 0.05, uc + 0.05, z0, z1, 0.07);
      // сетка остекления: горизонтальные импосты с шагом spec.grid
      if (spec.grid) for (let zg = z0 + spec.grid; zg < z1 - 0.3; zg += spec.grid) rectQ(spec.frame, u0, u1, zg - 0.05, zg + 0.05, 0.07);
      if (spec.transom && z1 - z0 > 3) {
        const zt = z0 + (z1 - z0) * 0.72;
        rectQ(spec.frame, u0, u1, zt - 0.06, zt + 0.06, 0.07);
      }
      if (spec.sill) {
        // подоконный слив: верхняя и лицевая грани
        const s0 = uc - hw - 0.15;
        const s1 = uc + hw + 0.15;
        sink.quad('trim', P(s0, z0 - 0.1, 0.26), P(s1, z0 - 0.1, 0.26), P(s1, z0 - 0.1, 0.0), P(s0, z0 - 0.1, 0.0));
        rectQ('trim', s0, s1, z0 - 0.2, z0 - 0.1, 0.26);
      }
    }
  }
}

// ---------- кровли ----------

function rectFrame(r) {
  const [c0, c1, , c3] = r;
  return { c0, ux: norm(sub(c1, c0)), uy: norm(sub(c3, c0)), w: dist(c0, c1), d: dist(c0, c3) };
}

// Отступ внутрь годится, если не перехлёстывается и не выходит за стены
// (у сложных контуров с короткими рёбрами простой отступ ломается).
function insetOk(ring, inner) {
  if (selfIntersects(inner) || inner.some((p) => !pointInRing(p, ring))) return false;
  const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < ring.length; j++) {
      const c = ring[j];
      const d = ring[(j + 1) % ring.length];
      if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return false;
    }
  }
  return true;
}

function roofFlat(sink, ring, h, key) {
  const inner = [0.35, 0.15].map((d) => offsetRing(ring, -d)).find((r) => insetOk(ring, r));
  // без парапета: кровля по верху стен
  if (!inner) return sink.flat(key, ring, h);
  const zr = h - 0.6;
  sink.flat(key, inner, zr);
  // парапет: верх и внутренние стенки
  sink.flat('trim', ring, h, { holes: [inner] });
  const ir = inner.slice().reverse();
  for (let i = 0; i < ir.length; i++) sink.wall('panel', ir[i], ir[(i + 1) % ir.length], zr, h);
}

// Односкатная кровля: низ — вдоль длинной стороны q0→q1, верх — над противоположной.
function roofShed(sink, q, h, rh, key, wallKey) {
  let [q0, q1, q2, q3] = q;
  if (dist(q0, q1) < dist(q1, q2)) [q0, q1, q2, q3] = [q1, q2, q3, q0];
  const v = (p, z) => [p[0], p[1], z];
  sink.quad(key, v(q0, h), v(q1, h), v(q2, h + rh), v(q3, h + rh));
  sink.tri(wallKey, v(q1, h), v(q2, h), v(q2, h + rh));
  sink.tri(wallKey, v(q3, h), v(q0, h), v(q3, h + rh));
  sink.quad(wallKey, v(q2, h), v(q3, h), v(q3, h + rh), v(q2, h + rh));
}

// Сводчатая кровля: свод вдоль длинной стороны, арочные щипцы в торцах (каменные эллинги).
function roofBarrel(sink, q, h, rh, key, wallKey) {
  let [q0, q1, q2, q3] = q;
  if (dist(q0, q1) < dist(q1, q2)) [q0, q1, q2, q3] = [q1, q2, q3, q0];
  const N = 10;
  const v = (p, z) => [p[0], p[1], z];
  // сечение: от стороны q0q1 к стороне q3q2 по полуэллипсу высотой rh
  const prof = Array.from({ length: N + 1 }, (_, k) => {
    const t = (Math.PI * k) / N;
    return { u: (1 - Math.cos(t)) / 2, z: h + rh * Math.sin(t) };
  });
  const at = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  for (let k = 0; k < N; k++) {
    const A0 = at(q0, q3, prof[k].u);
    const B0 = at(q1, q2, prof[k].u);
    const A1 = at(q0, q3, prof[k + 1].u);
    const B1 = at(q1, q2, prof[k + 1].u);
    sink.quad(key, v(A0, prof[k].z), v(B0, prof[k].z), v(B1, prof[k + 1].z), v(A1, prof[k + 1].z));
  }
  // торцы — арочные щипцы
  const end0 = prof.map((p) => v(at(q0, q3, p.u), p.z));
  const end1 = prof.map((p) => v(at(q1, q2, p.u), p.z)).reverse();
  sink.face(wallKey, end0);
  sink.face(wallKey, end1);
}

// Самопересекающийся контур (распознавание космоснимков) — наибольший из простых кусков.
export function cleanRing(ring) {
  if (ring.length < 4 || !selfIntersects(ring)) return ring;
  try {
    const parts = pc.union([[...ring, ring[0]]]).map((poly) => poly[0].slice(0, -1));
    const best = parts.sort((x, y) => area(y) - area(x))[0];
    return best && best.length >= 3 ? ensureCCW(best) : ring;
  } catch {
    return ring;
  }
}

// Скатная кровля над контуром любой формы (Г-образные, изломанные корпуса): высота точки —
// уклон × расстояние до края контура, не выше конька rh. Строится по сетке вдоль длинной оси
// контура: ячейки отсекаются контуром, вершины поднимаются на высоту ската.
function roofAny(sink, ring, h, rh, key) {
  const segs = ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);
  const dEdge = (p) => {
    let m = Infinity;
    for (const [a, b] of segs) {
      const ab = sub(b, a);
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
      m = Math.min(m, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t));
    }
    return m;
  };
  // оси сетки — по самому длинному ребру контура
  let ax = [1, 0];
  let best = 0;
  for (const [a, b] of segs) if (dist(a, b) > best) [best, ax] = [dist(a, b), norm(sub(b, a))];
  const ay = [-ax[1], ax[0]];
  const toUV = (p) => [p[0] * ax[0] + p[1] * ax[1], p[0] * ay[0] + p[1] * ay[1]];
  const fromUV = ([u, v]) => [u * ax[0] + v * ay[0], u * ax[1] + v * ay[1]];
  const uv = ring.map(toUV);
  const [u0, u1] = [Math.min(...uv.map((p) => p[0])), Math.max(...uv.map((p) => p[0]))];
  const [v0, v1] = [Math.min(...uv.map((p) => p[1])), Math.max(...uv.map((p) => p[1]))];
  // «типичная» половина ширины корпуса — на ней скат доходит до конька
  const perim = segs.reduce((s, [a, b]) => s + dist(a, b), 0);
  const half = Math.max(1, (1.1 * area(ring)) / perim);
  const slope = rh / half;
  let step = Math.max(0.75, Math.min(3, half / 4));
  while (((u1 - u0) / step) * ((v1 - v0) / step) > 6000) step *= 1.25;
  // ряд сетки проходит по середине корпуса — там конёк
  const vMid = (v0 + v1) / 2;
  const vs = [];
  for (let v = vMid - Math.ceil((vMid - v0) / step) * step; v < v1 + step; v += step) vs.push(v);
  const us = [];
  for (let u = u0; u < u1 + step; u += step) us.push(u);
  const clip = (poly, k, c, keepGreater) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ina = keepGreater ? a[k] >= c : a[k] <= c;
      const inb = keepGreater ? b[k] >= c : b[k] <= c;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (c - a[k]) / (b[k] - a[k]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  };
  const zOf = (p) => h + Math.min(rh, slope * dEdge(p));
  const up = (p) => [p[0], p[1], zOf(p)];
  for (let i = 0; i + 1 < us.length; i++) {
    let col = clip(clip(uv, 0, us[i], true), 0, us[i + 1], false);
    if (col.length < 3) continue;
    for (let j = 0; j + 1 < vs.length; j++) {
      const cell = clip(clip(col, 1, vs[j], true), 1, vs[j + 1], false);
      if (cell.length < 3) continue;
      const pts = cell.map(fromUV);
      if (Math.abs(pts.reduce((s, p, k) => s + p[0] * pts[(k + 1) % pts.length][1] - pts[(k + 1) % pts.length][0] * p[1], 0)) < 1e-4) continue;
      const P = pts.map(up);
      const ccw = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) > 0;
      if (P.length === 4 && P.every((p, k) => ccw(p, P[(k + 1) % 4], P[(k + 2) % 4]))) {
        // целая ячейка — по диагонали, лучше передающей конёк
        const d02 = P[0][2] + P[2][2];
        const d13 = P[1][2] + P[3][2];
        const [a, b, c, d] = d02 >= d13 ? [0, 1, 2, 3] : [1, 2, 3, 0];
        sink.face(key, [P[a], P[b], P[c]]);
        sink.face(key, [P[a], P[c], P[d]]);
      } else for (const [a, b, c] of triangulate(pts)) sink.face(key, ccw(P[a], P[b], P[c]) ? [P[a], P[b], P[c]] : [P[a], P[c], P[b]]);
    }
  }
}

// Шатровая (пирамидальная) кровля над любым выпуклым контуром.
function roofPyramid(sink, ring, h, rh, key) {
  const c = centroid(ring);
  for (let i = 0; i < ring.length; i++) sink.tri(key, [ring[i][0], ring[i][1], h], [ring[(i + 1) % ring.length][0], ring[(i + 1) % ring.length][1], h], [c[0], c[1], h + rh]);
}

// Купол и луковичная глава над контуром (обычно круглым барабаном).
function roofDome(sink, ring, h, rh, key, shape) {
  const c = centroid(ring);
  const r = Math.max(0.5, Math.min(...ring.map((p) => dist(p, c))) * 0.98);
  sink.flat('trim', ring, h);
  const H = rh || (shape === 'onion' ? r * 1.6 : r * 0.9);
  const prof =
    shape === 'onion'
      ? [[0.85, 0], [1.12, 0.2], [1.18, 0.38], [0.95, 0.6], [0.5, 0.8], [0.14, 0.94], [0, 1]]
      : Array.from({ length: 7 }, (_, i) => [Math.cos((i / 6) * (Math.PI / 2)), Math.sin((i / 6) * (Math.PI / 2))]);
  sink.revolve(key, c, prof.map(([k, z]) => [k * r, h + z * H]), 18);
  if (shape === 'onion') sink.cylinder('r_gold', c, h + H, h + H + r * 0.7, Math.max(0.06, r * 0.05), Math.max(0.04, r * 0.03), 6);
}

// q: [q0,q1,q2,q3], конёк вдоль q0→q1 (свесы над сторонами q0q1 и q2q3)
function roofGable(sink, q, h, rh, key, wallKey, { overhang = 0.45, lantern = false } = {}) {
  const [q0, q1, q2, q3] = q;
  const a = norm(sub(q1, q0));
  const c = norm(sub(q3, q0));
  const hs = dist(q0, q3) / 2;
  const r0 = lerp(q0, q3, 0.5);
  const r1 = lerp(q1, q2, 0.5);
  const eL = 0.3;
  const zE = h - (rh * overhang) / hs;
  const f0 = add(sub(q0, mul(a, eL)), mul(c, -overhang));
  const f1 = add(add(q1, mul(a, eL)), mul(c, -overhang));
  const b0 = add(sub(q3, mul(a, eL)), mul(c, overhang));
  const b1 = add(add(q2, mul(a, eL)), mul(c, overhang));
  const R0 = sub(r0, mul(a, eL));
  const R1 = add(r1, mul(a, eL));
  const zr = h + rh;
  const v = (p, z) => [p[0], p[1], z];
  sink.quad(key, v(f0, zE), v(f1, zE), v(R1, zr), v(R0, zr));
  sink.quad(key, v(b1, zE), v(b0, zE), v(R0, zr), v(R1, zr));
  // нижняя сторона свесов
  sink.quad(key, v(R0, zr - 0.15), v(R1, zr - 0.15), v(f1, zE - 0.15), v(f0, zE - 0.15));
  sink.quad(key, v(R1, zr - 0.15), v(R0, zr - 0.15), v(b0, zE - 0.15), v(b1, zE - 0.15));
  // щипцы
  sink.tri(wallKey, v(q1, h), v(q2, h), v(r1, zr));
  sink.tri(wallKey, v(q3, h), v(q0, h), v(r0, zr));
  if (lantern) {
    const lw = Math.min(6, Math.max(2, hs * 0.35));
    const L = dist(q0, q1) * 0.8;
    const m = lerp(r0, r1, 0.5);
    const zb = zr - (rh * (lw / 2)) / hs;
    const ring = [
      add(add(m, mul(a, -L / 2)), mul(c, -lw / 2)),
      add(add(m, mul(a, L / 2)), mul(c, -lw / 2)),
      add(add(m, mul(a, L / 2)), mul(c, lw / 2)),
      add(add(m, mul(a, -L / 2)), mul(c, lw / 2)),
    ];
    sink.prism(key, ring, zb, zr + 1.3, { sideKey: 'lantern' });
  }
}

function roofHip(sink, q, h, rh, key) {
  let [q0, q1, q2, q3] = q;
  if (dist(q0, q1) < dist(q0, q3)) [q0, q1, q2, q3] = [q1, q2, q3, q0];
  const a = norm(sub(q1, q0));
  const hs = dist(q0, q3) / 2;
  const Lr = dist(q0, q1) - 2 * hs;
  const m0 = lerp(q0, q3, 0.5);
  const m1 = lerp(q1, q2, 0.5);
  const zr = h + rh;
  const v = (p, z) => [p[0], p[1], z];
  if (Lr <= 0.2) {
    const apex = lerp(m0, m1, 0.5);
    for (let i = 0; i < 4; i++) {
      const p = [q0, q1, q2, q3][i];
      const n = [q0, q1, q2, q3][(i + 1) % 4];
      sink.tri(key, v(p, h), v(n, h), v(apex, zr));
    }
    return;
  }
  const r0 = add(m0, mul(a, hs));
  const r1 = sub(m1, mul(a, hs));
  sink.quad(key, v(q0, h), v(q1, h), v(r1, zr), v(r0, zr));
  sink.quad(key, v(q2, h), v(q3, h), v(r0, zr), v(r1, zr));
  sink.tri(key, v(q1, h), v(q2, h), v(r1, zr));
  sink.tri(key, v(q3, h), v(q0, h), v(r0, zr));
}

function roofMulti(sink, r, h, rh, key, wallKey, bays, alongD, lantern) {
  const F = rectFrame(r);
  for (let k = 0; k < bays; k++) {
    let q;
    if (alongD) {
      // коньки вдоль uy, пролёты делят ux
      const s0 = add(F.c0, mul(F.ux, (F.w * k) / bays));
      const s1 = add(F.c0, mul(F.ux, (F.w * (k + 1)) / bays));
      const s2 = add(s1, mul(F.uy, F.d));
      const s3 = add(s0, mul(F.uy, F.d));
      q = [s1, s2, s3, s0];
    } else {
      const s0 = add(F.c0, mul(F.uy, (F.d * k) / bays));
      const s3 = add(F.c0, mul(F.uy, (F.d * (k + 1)) / bays));
      const s1 = add(s0, mul(F.ux, F.w));
      const s2 = add(s3, mul(F.ux, F.w));
      q = [s0, s1, s2, s3];
    }
    roofGable(sink, q, h, rh, key, wallKey, { overhang: 0.25, lantern });
  }
}

// Выступающий пояс (карниз, тяга, цоколь): боковины + верхняя и нижняя полки.
function ledge(sink, key, ring, ext, z0, z1) {
  const o = offsetRing(ring, ext);
  for (let i = 0; i < o.length; i++) sink.wall(key, o[i], o[(i + 1) % o.length], z0, z1);
  sink.flat(key, o, z1, { holes: [ring] });
  sink.flat(key, o, z0, { holes: [ring], up: false });
}

// ---------- портик ----------

function portico(sink, a, b, pspec, h, roofKey, angle) {
  const L = dist(a, b);
  const dir = norm(sub(b, a));
  const nOut = [dir[1], -dir[0]];
  const n = pspec.columns;
  const depth = pspec.depth;
  const width = Math.min(L * 0.7, n * (pspec.spacing || (n > 6 ? 3.6 : 3)));
  const u0 = (L - width) / 2;
  const P = (u, off) => [a[0] + dir[0] * u + nOut[0] * off, a[1] + dir[1] * u + nOut[1] * off];
  const colH = h * 0.78;
  const r = n > 6 ? 0.75 : 0.42;
  // стилобат (ступени)
  const st = [P(u0 - 0.8, 0), P(u0 + width + 0.8, 0), P(u0 + width + 0.8, depth + 1), P(u0 - 0.8, depth + 1)];
  sink.prism('plinth', ensureCCW(st), 0, 0.9);
  for (let i = 0; i < n; i++) {
    const u = u0 + (width * (i + 0.5)) / n;
    const c = P(u, depth - 0.2);
    sink.cylinder('column', c, 0.9, colH, r, r * 0.88, 12);
  }
  // антаблемент
  const ent = [P(u0 - 0.3, 0), P(u0 + width + 0.3, 0), P(u0 + width + 0.3, depth + 0.5), P(u0 - 0.3, depth + 0.5)];
  sink.prism('trim', ensureCCW(ent), colH, colH + 1.4, { bottom: true });
  // фронтон
  const ph = Math.min(3.5, width * 0.18);
  const z0 = colH + 1.4;
  const A = P(u0 - 0.3, depth + 0.5);
  const B = P(u0 + width + 0.3, depth + 0.5);
  const M = P(u0 + width / 2, depth + 0.5);
  const A0 = P(u0 - 0.3, 0);
  const B0 = P(u0 + width + 0.3, 0);
  const M0 = P(u0 + width / 2, 0);
  const v = (p, z) => [p[0], p[1], z];
  sink.tri('trim', v(B, z0), v(A, z0), v(M, z0 + ph));
  sink.quad(roofKey, v(A, z0), v(A0, z0), v(M0, z0 + ph), v(M, z0 + ph));
  sink.quad(roofKey, v(B0, z0), v(B, z0), v(M, z0 + ph), v(M0, z0 + ph));
}

// Колоннада большого ордера вдоль фасада: колонны от z0 до z1 с шагом spacing, у стены,
// над ними — антаблемент. c = { z0, z1, spacing, r, near }.
function colonnade(sink, a, b, c, h) {
  const L = dist(a, b);
  const dir = norm(sub(b, a));
  const nOut = [dir[1], -dir[0]];
  const z0 = c.z0 ?? 4.5;
  const z1 = Math.min(c.z1 ?? h * 0.8, h - 1.2);
  const step = c.spacing ?? 4.2;
  const r = c.r ?? 0.5;
  const off = r + 0.2;
  const n = Math.max(2, Math.floor((L - 2) / step) + 1);
  const span = (n - 1) * step;
  const u0 = (L - span) / 2;
  const P = (u, o) => [a[0] + dir[0] * u + nOut[0] * o, a[1] + dir[1] * u + nOut[1] * o];
  const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  for (let i = 0; i < n; i++) {
    const p = P(u0 + i * step, off);
    sink.cylinder('column', p, z0 + 0.5, z1 - 0.6, r, r * 0.88, 12);
    sink.box('trim', [p[0], p[1], z0 + 0.25], [r * 2.4, r * 2.4, 0.5], ang); // база
    sink.box('trim', [p[0], p[1], z1 - 0.3], [r * 2.5, r * 2.5, 0.6], ang); // капитель
  }
  // антаблемент и карниз над колоннадой, полка под ней
  const band = (o0, o1, za, zb, key) => sink.prism(key, ensureCCW([P(u0 - r - 0.6, o0), P(u0 + span + r + 0.6, o0), P(u0 + span + r + 0.6, o1), P(u0 - r - 0.6, o1)]), za, zb, { bottom: true });
  band(0, off + r + 0.25, z1, z1 + 1.1, 'trim');
  band(0, off + r + 0.5, z1 + 1.1, z1 + 1.35, 'trim');
  band(0, off + r + 0.35, z0 - 0.15, z0, 'trim');
}

// ---------- здание целиком ----------

// Стена двора с аркой проезда (принадлежит зданию): w = { line: [[x, y], [x, y]], h, t,
// arch: { w — ширина проёма, h — высота до замка, at — место по длине стены, 0…1 } }.
// Над аркой — аттик на пилонах. Без arch — глухая стена.
export function archWallSize(w) {
  const [a, b] = w.line;
  const L = dist(a, b);
  const t = w.t ?? 0.6;
  const h = w.h ?? 3.5;
  if (!w.arch) return { L, t, h, top: h + 0.15 };
  const aw = Math.min(w.arch.w ?? 3.6, Math.max(1, L - 1.6));
  const ah = Math.max(w.arch.h ?? 4, aw / 2 + 0.5);
  const top = Math.max(h + 0.8, ah + 0.9);
  return { L, t, h, aw, ah, top: top + 0.25, uc: Math.min(L - aw / 2 - 0.7, Math.max(aw / 2 + 0.7, L * (w.arch.at ?? 0.5))) };
}
export function archWallProxy(w) {
  const { L, t, top } = archWallSize(w);
  const [a, b] = w.line;
  const d = [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)];
  const n = [-d[1], d[0]];
  const hw = Math.max(t + 0.3, 1.2) / 2;
  const P = (u, v) => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v];
  return { poly: ensureCCW([P(0, -hw), P(L, -hw), P(L, hw), P(0, hw)]), z0: 0, z1: top };
}
export function buildArchWall(sink, w, key) {
  const { L, t, h, aw, ah, uc } = archWallSize(w);
  if (L < 0.5) return;
  const [a, b] = w.line;
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [-d[1], d[0]];
  const P = (u, v, z) => [a[0] + d[0] * u + n[0] * v, a[1] + d[1] * u + n[1] * v, z];
  // грань лицом наружу (out) — порядок вершин по нормали Ньюэлла
  const put = (k, pts, out) => {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (Math.hypot(nx, ny, nz) < 1e-9) return;
    sink.face(k, nx * out[0] + ny * out[1] + nz * out[2] < 0 ? pts.slice().reverse() : pts);
  };
  // выпуклый многоугольник в плоскости стены (u — вдоль, z — вверх), выдавленный на толщину th
  const slab = (k, poly, th) => {
    const f = poly.map(([u, z]) => P(u, -th / 2, z));
    const r = poly.map(([u, z]) => P(u, th / 2, z));
    put(k, f, [-n[0], -n[1], 0]);
    put(k, r, [n[0], n[1], 0]);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const du = poly[j][0] - poly[i][0];
      const dz = poly[j][1] - poly[i][1];
      if (Math.hypot(du, dz) < 1e-6) continue;
      // контур против часовой стрелки: наружу — вправо от ребра
      put(k, [f[i], f[j], r[j], r[i]], [d[0] * dz, d[1] * dz, -du]);
    }
  };
  const rect = (u0, u1, z0, z1) => [[u0, z0], [u1, z0], [u1, z1], [u0, z1]];
  const run = (u0, u1) => {
    if (u1 - u0 < 0.05) return;
    slab(key, rect(u0, u1, 0, h), t);
    slab('trim', rect(u0 - 0.04, u1 + 0.04, h, h + 0.15), t + 0.16);
  };
  if (!aw) return run(0, L);
  const R = aw / 2;
  const p = 0.7;
  const zs = ah - R;
  const top = Math.max(h + 0.8, ah + 0.9);
  const tp = t + 0.3;
  run(0, uc - R - p);
  run(uc + R + p, L);
  // пилоны и надарочная часть со сводом
  slab(key, rect(uc - R - p, uc - R, 0, top), tp);
  slab(key, rect(uc + R, uc + R + p, 0, top), tp);
  const M = 12;
  for (let i = 0; i < M; i++) {
    const x0 = -R + (2 * R * i) / M;
    const x1 = -R + (2 * R * (i + 1)) / M;
    const z0 = zs + Math.sqrt(Math.max(0, R * R - x0 * x0));
    const z1 = zs + Math.sqrt(Math.max(0, R * R - x1 * x1));
    slab(key, [[uc + x0, z0], [uc + x1, z1], [uc + x1, top], [uc + x0, top]], tp);
  }
  slab('trim', rect(uc - R - p - 0.15, uc + R + p + 0.15, top, top + 0.25), tp + 0.2);
}

export function buildBuilding(sink, b, extras = {}) {
  // стены двора с аркой — один раз, на уровне здания
  if (b.walls && b.walls.length) {
    for (const w of b.walls) buildArchWall(sink, w, w.wall || b.wall || 'light');
    return buildBuilding(sink, { ...b, walls: undefined }, extras);
  }
  // части здания (OSM building:part) — каждая на своей отметке, со своей высотой и кровлей;
  // основной объём рисуется, только если части закрывают контур не целиком
  if (b.parts && b.parts.length) {
    if (b.bodyH) buildBuilding(sink, { ...b, parts: undefined, h: b.bodyH }, extras);
    for (const p of b.parts) {
      const tmp = new Sink();
      buildBuilding(tmp, { ...p, type: p.type || b.type, detail: b.detail, noPlinth: p.minH > 0.5, doors: p.minH > 0.5 ? [] : p.doors }, extras);
      sink.mergeShifted(tmp, p.minH || 0);
    }
    return;
  }
  if (b.holes && b.holes.length) return buildCourtyardBuilding(sink, b);
  const ring = cleanRing(ensureCCW(dedupe(b.poly)));
  const h = b.h;
  const roof = b.roof || { type: 'flat' };
  const roofKey = roof.color || 'r_gray';
  const wallKey = b.wall || 'light';
  const spec = windowSpec(b);
  const plinthH = Math.min(b.type === 'hall' || b.type === 'warehouse' || b.type === 'elling' ? 0.5 : 0.75, Number.isFinite(b.sill) ? Math.max(0.15, b.sill - 0.1) : 1);

  const low = b.detail === 'low';

  // цоколь (у упрощённых домов окружения — без цоколя и карниза)
  if (!low && !b.noPlinth) ledge(sink, 'plinth', ring, 0.07, 0, plinthH);

  // стены
  for (let i = 0; i < ring.length; i++) sink.wall(wallKey, ring[i], ring[(i + 1) % ring.length], 0, h);

  // карниз и междуэтажные тяги
  if (HAS_CORNICE.has(b.type) && !low) {
    const ext = b.type === 'office' || b.type === 'checkpoint' ? 0.12 : 0.32;
    ledge(sink, 'trim', ring, ext, h - 0.55, h - 0.03);
  }
  if (HAS_BANDS.has(b.type) && !low) {
    const floors = b.floors || Math.max(1, Math.round(h / 3.4));
    const fh = h / floors;
    ledge(sink, 'trim', ring, 0.1, fh - 0.25, fh);
  }

  // кровля
  const isQuad = ring.length === 4;
  const rh = roof.h ?? 3;
  if (roof.type === 'gable' && isQuad) {
    const [c0, c1, c2, c3] = ring;
    const alongW = roof.ridge ? roof.ridge === 'w' : dist(c0, c1) >= dist(c0, c3);
    const q = alongW ? [c0, c1, c2, c3] : [c1, c2, c3, c0];
    roofGable(sink, q, h, rh, roofKey, wallKey, { lantern: roof.lantern });
  } else if (roof.type === 'hip' && isQuad) {
    roofHip(sink, ring, h, rh, roofKey);
  } else if (roof.type === 'multigable' && isQuad) {
    roofMulti(sink, ring, h, rh, roofKey, wallKey, roof.bays || 3, roof.along !== 'w', roof.lantern);
  } else if ((roof.type === 'gable' || roof.type === 'hip') && !isQuad && roof.any) {
    roofAny(sink, ring, h, rh, roofKey);
  } else if (roof.type === 'barrel' && isQuad) {
    roofBarrel(sink, ring, h, rh, roofKey, wallKey);
  } else if (roof.type === 'shed' && isQuad) {
    roofShed(sink, ring, h, rh, roofKey, wallKey);
  } else if (roof.type === 'pyramid') {
    roofPyramid(sink, ring, h, rh, roofKey);
  } else if (roof.type === 'dome' || roof.type === 'onion') {
    roofDome(sink, ring, h, roof.h, roofKey, roof.type);
  } else {
    roofFlat(sink, ring, h, roofKey);
  }

  // фасады
  const doorsByEdge = new Map();
  for (const d of b.doors || []) {
    if (!doorsByEdge.has(d.edge)) doorsByEdge.set(d.edge, []);
    doorsByEdge.get(d.edge).push(d);
  }
  const blind = new Set(b.blind || []);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const dir = sub(c, a);
    facade(sink, a, c, low ? null : spec, low ? [] : doorsByEdge.get(i) || [], {
      h,
      blind: blind.has(i),
      angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI,
      doorKey: b.type === 'hall' || b.type === 'warehouse' || b.type === 'utility' ? 'door_metal' : 'door',
    });
  }

  // портик
  if (b.portico) {
    const i = b.portico.edge;
    portico(sink, ring[i], ring[(i + 1) % ring.length], b.portico, h, roofKey);
  }
  // колоннада вдоль фасада (у стены, ближайшей к точке near)
  if (b.colonnade && !low) {
    const c = b.colonnade;
    let best = 0;
    let bd = Infinity;
    ring.forEach((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const d = c.near ? dist([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], c.near) : -dist(p, q);
      if (d < bd) [bd, best] = [d, i];
    });
    colonnade(sink, ring[best], ring[(best + 1) % ring.length], c, h);
  }

  // вывеска на кровле
  if (b.sign) {
    const i = b.sign.edge;
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const dir = norm(sub(c, a));
    const nOut = [dir[1], -dir[0]];
    const m = lerp(a, c, 0.5);
    const w = Math.min(dist(a, c) * 0.9, 26);
    const pos = add(m, mul(nOut, -0.4));
    const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    sink.box('sign', [pos[0], pos[1], h + 1.5], [w, 0.3, 2.2], ang);
    for (const t of [-0.4, 0.4]) {
      const p = add(pos, mul(dir, t * w));
      sink.box('steel_dark', [p[0] - nOut[0] * 0.5, p[1] - nOut[1] * 0.5, h + 0.3], [0.15, 1.2, 0.6], ang);
    }
    extras.signs?.push({ id: b.id, text: b.sign.text, center: [pos[0] + nOut[0] * 0.17, pos[1] + nOut[1] * 0.17, h + 1.5], normal: nOut, w, h: 2.2 });
  }
}

// Здание с внутренними дворами: стены по внешнему контуру и по дворам, плоская кровля.
function buildCourtyardBuilding(sink, b) {
  const outer = ensureCCW(dedupe(b.poly));
  const holes = b.holes.map((h) => ensureCW(dedupe(h))).filter((h) => h.length >= 3);
  const h = b.h;
  const wallKey = b.wall || 'light';
  const spec = windowSpec(b);
  const low = b.detail === 'low';
  if (!low) {
    ledge(sink, 'plinth', outer, 0.07, 0, 0.75);
    ledge(sink, 'trim', outer, 0.25, h - 0.55, h - 0.03);
  }
  for (const ring of [outer, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      sink.wall(wallKey, a, c, 0, h);
      const dir = sub(c, a);
      facade(sink, a, c, low ? null : spec, [], { h, angle: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, doorKey: 'door' });
    }
  }
  sink.flat((b.roof && b.roof.color) || 'r_gray', outer, h, { holes });
}

const SINGLE_STOREY = new Set(['hall', 'elling', 'elling_historic', 'warehouse']);

// Части здания разной высоты (custom.json, parts): площадь этажей и объём — по частям.
function partsSummary(b) {
  const parts = b.parts.map((p) => {
    const A = area(ensureCCW(dedupe(p.poly)));
    const rh = p.roof && p.roof.type !== 'flat' ? (p.roof.h ?? 3) : 0;
    const floors = p.floors || (SINGLE_STOREY.has(p.type) ? 1 : Math.max(1, Math.round(p.h / 3.4)));
    return { A, floors, known: !!p.floors, vol: A * (p.h + rh / 2) };
  });
  const fl = parts.map((p) => p.floors);
  const lo = Math.min(...fl);
  const hi = Math.max(...fl);
  return {
    floorsText: lo === hi ? String(hi) : `${lo}–${hi}`,
    totalArea: Math.round(parts.reduce((s, p) => s + p.A * p.floors, 0)),
    volume: Math.round(parts.reduce((s, p) => s + p.vol, 0)),
    floorsKnown: parts.every((p) => p.known),
    parts: b.parts.length,
  };
}

export function buildingSummary(b) {
  const ring = ensureCCW(dedupe(b.poly));
  const c = centroid(ring);
  const roofH = b.roof && b.roof.type !== 'flat' ? (b.roof.h ?? 3) : 0;
  // площадь застройки за вычетом дворов; строительный объём — до средней отметки кровли
  const net = area(ring) - (b.holes || []).reduce((s, h) => s + area(h), 0);
  const avgRoof = !roofH ? 0 : b.roof.type === 'hip' || b.roof.type === 'pyramid' ? roofH / 3 : b.roof.type === 'barrel' ? (roofH * Math.PI) / 4 : roofH / 2;
  const floorsEst = b.floors || (SINGLE_STOREY.has(b.type) ? 1 : Math.max(1, Math.round(b.h / 3.4)));
  return {
    id: b.id,
    name: b.name,
    info: b.info,
    kind: b.kind,
    type: b.type,
    zone: b.zone,
    floors: b.floors,
    height: +(b.h + roofH).toFixed(1),
    footprint: Math.round(net),
    floorsEst,
    floorsKnown: !!b.floors,
    totalArea: Math.round(net * floorsEst),
    volume: Math.round(net * (b.h + avgRoof)),
    dims: ring.length === 4 ? [+dist(ring[0], ring[1]).toFixed(1), +dist(ring[1], ring[2]).toFixed(1)] : null,
    center: c,
    approx: !!b.approx,
    geomSrc: b.geomSrc,
    roof: b.roof?.type || 'flat',
    units: b.units,
    refined: b.refined,
    ...(b.partsCustom ? partsSummary(b) : {}),
  };
}

export { len };
