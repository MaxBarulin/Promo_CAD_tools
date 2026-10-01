// Генерация зданий: стены, цоколь, карнизы, кровли (плоская с парапетом, двускатная,
// вальмовая, многопролётная), окна по этажам, двери и ворота, портики, вывески.

import { ensureCCW, ensureCW, sub, add, mul, norm, len, dist, lerp, centroid, area } from '../geo.js';
import { dedupe } from './geom.js';

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

function windowSpec(b) {
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
    const z0 = row.z0;
    const z1 = Math.min(row.z0 + row.h, opts.h - 0.4);
    if (z1 - z0 < 0.5) continue;
    for (let i = 0; i < n; i++) {
      const uc = start + i * step;
      const u0 = uc - hw;
      const u1 = uc + hw;
      if (blocked.some(([b0, b1, bh]) => u1 > b0 && u0 < b1 && z0 < bh)) continue;
      rectQ(spec.frame, u0 - 0.1, u1 + 0.1, z0 - 0.1, z1 + 0.1, 0.03);
      const wp = P(uc, z0, 0);
      const lit = spec.glass === 'glass' && hash3(wp) < 0.42;
      rectQ(lit ? 'glass_lit' : spec.glass, u0, u1, z0, z1, 0.05);
      if (spec.mullion && spec.w > 1.1) rectQ(spec.frame, uc - 0.05, uc + 0.05, z0, z1, 0.07);
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

function roofFlat(sink, ring, h, key) {
  const inner = offsetRing(ring, -0.35);
  const zr = h - 0.6;
  sink.flat(key, inner, zr);
  // парапет: верх и внутренние стенки
  sink.flat('trim', ring, h, { holes: [inner] });
  const ir = inner.slice().reverse();
  for (let i = 0; i < ir.length; i++) sink.wall('panel', ir[i], ir[(i + 1) % ir.length], zr, h);
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

// ---------- здание целиком ----------

export function buildBuilding(sink, b, extras = {}) {
  if (b.holes && b.holes.length) return buildCourtyardBuilding(sink, b);
  const ring = ensureCCW(dedupe(b.poly));
  const h = b.h;
  const roof = b.roof || { type: 'flat' };
  const roofKey = roof.color || 'r_gray';
  const wallKey = b.wall || 'light';
  const spec = windowSpec(b);
  const plinthH = b.type === 'hall' || b.type === 'warehouse' || b.type === 'elling' ? 0.5 : 0.75;

  const low = b.detail === 'low';

  // цоколь (у упрощённых домов окружения — без цоколя и карниза)
  if (!low) ledge(sink, 'plinth', ring, 0.07, 0, plinthH);

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
    extras.signs?.push({ text: b.sign.text, center: [pos[0] + nOut[0] * 0.17, pos[1] + nOut[1] * 0.17, h + 1.5], normal: nOut, w, h: 2.2 });
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

export function buildingSummary(b) {
  const ring = ensureCCW(dedupe(b.poly));
  const c = centroid(ring);
  const roofH = b.roof && b.roof.type !== 'flat' ? (b.roof.h ?? 3) : 0;
  return {
    id: b.id,
    name: b.name,
    info: b.info,
    kind: b.kind,
    type: b.type,
    zone: b.zone,
    floors: b.floors,
    height: +(b.h + roofH).toFixed(1),
    footprint: Math.round(area(ring)),
    dims: ring.length === 4 ? [+dist(ring[0], ring[1]).toFixed(1), +dist(ring[1], ring[2]).toFixed(1)] : null,
    center: c,
    approx: !!b.approx,
    geomSrc: b.geomSrc,
  };
}

export { len };
