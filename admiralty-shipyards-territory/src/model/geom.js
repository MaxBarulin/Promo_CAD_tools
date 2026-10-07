// Накопитель геометрии («Sink»): собирает треугольники по ключам материалов
// в координатах модели (x — восток, y — север, z — вверх) и выдаёт
// BufferGeometry в системе three.js (X = x, Y = z, Z = −y).

import { ensureCCW, DEG } from '../geo.js';

let TRI = null; // функция триангуляции (THREE.ShapeUtils.triangulateShape), задаётся при инициализации

export function setTriangulator(fn) {
  TRI = fn;
}

// Триангуляция простого многоугольника (без отверстий): тройки индексов вершин.
export function triangulate(ring) {
  if (!TRI) throw new Error('triangulator not set');
  return TRI(ring.map((p) => ({ x: p[0], y: p[1] })), []);
}

// Удаление повторяющихся соседних вершин и замыкающей точки.
export function dedupe(ring) {
  const out = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-7 || Math.abs(q[1] - p[1]) > 1e-7) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-7 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-7) out.pop();
  return out;
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export class Sink {
  constructor() {
    this.bufs = new Map();
  }

  _get(key) {
    let b = this.bufs.get(key);
    if (!b) {
      b = { pos: [], nrm: [], idx: [] };
      this.bufs.set(key, b);
    }
    return b;
  }

  get empty() {
    for (const b of this.bufs.values()) if (b.idx.length) return false;
    return true;
  }

  // Плоский многоугольник (выпуклый или звёздный относительно 0-й вершины), вершины против часовой стрелки при взгляде с лицевой стороны.
  face(key, pts, normal = null) {
    if (pts.length < 3) return;
    const n = normal || norm3(cross3(sub3(pts[1], pts[0]), sub3(pts[2], pts[0])));
    const b = this._get(key);
    const base = b.pos.length / 3;
    for (const p of pts) {
      b.pos.push(p[0], p[2], -p[1]);
      b.nrm.push(n[0], n[2], -n[1]);
    }
    for (let i = 1; i < pts.length - 1; i++) b.idx.push(base, base + i, base + i + 1);
  }

  tri(key, a, b, c) {
    this.face(key, [a, b, c]);
  }

  quad(key, a, b, c, d) {
    // нормаль по диагоналям — устойчиво для слегка неплоских четырёхугольников
    const n = norm3(cross3(sub3(c, a), sub3(d, b)));
    this.face(key, [a, b, c, d], n);
  }

  // Треугольник с явными нормалями (для гладких поверхностей).
  triSmooth(key, a, b, c, na, nb, nc) {
    const buf = this._get(key);
    const base = buf.pos.length / 3;
    for (const [p, n] of [
      [a, na],
      [b, nb],
      [c, nc],
    ]) {
      buf.pos.push(p[0], p[2], -p[1]);
      buf.nrm.push(n[0], n[2], -n[1]);
    }
    buf.idx.push(base, base + 1, base + 2);
  }

  // Горизонтальный многоугольник (с отверстиями) на высоте z. up=true — лицом вверх.
  flat(key, ring, z, { holes = [], up = true } = {}) {
    if (!TRI) throw new Error('triangulator not set');
    const outer = ensureCCW(dedupe(ring));
    if (outer.length < 3) return;
    const hs = holes.map((h) => ensureCCW(dedupe(h)).slice().reverse()).filter((h) => h.length >= 3);
    const contour = outer.map((p) => ({ x: p[0], y: p[1] }));
    const holesV = hs.map((h) => h.map((p) => ({ x: p[0], y: p[1] })));
    const tris = TRI(contour, holesV);
    const all = [...outer, ...hs.flat()];
    const b = this._get(key);
    const base = b.pos.length / 3;
    const nz = up ? 1 : -1;
    for (const p of all) {
      b.pos.push(p[0], z, -p[1]);
      b.nrm.push(0, nz, 0);
    }
    for (const t of tris) {
      const p0 = all[t[0]];
      const p1 = all[t[1]];
      const p2 = all[t[2]];
      const ccw = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]) > 0;
      if (ccw === up) b.idx.push(base + t[0], base + t[1], base + t[2]);
      else b.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }

  // Вертикальная стенка вдоль отрезка a→b (2D), лицом вправо от направления a→b.
  wall(key, a, b, z0, z1) {
    this.quad(key, [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
  }

  // Призма по контуру (против часовой стрелки) между z0 и z1.
  prism(key, ring, z0, z1, { top = true, bottom = false, sides = true, sideKey = null, holes = [] } = {}) {
    const r = ensureCCW(ring);
    if (sides) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        // для CCW-контура внешняя сторона — справа от направления обхода
        this.wall(sideKey || key, a, b, z0, z1);
      }
      for (const h of holes) {
        const hr = ensureCCW(h).slice().reverse();
        for (let i = 0; i < hr.length; i++) this.wall(sideKey || key, hr[i], hr[(i + 1) % hr.length], z0, z1);
      }
    }
    if (top) this.flat(key, r, z1, { holes });
    if (bottom) this.flat(key, r, z0, { holes, up: false });
  }

  // Параллелепипед: центр (x, y, z — центр по высоте), размеры, поворот вокруг вертикали.
  box(key, c, size, angle = 0, { bottom = false } = {}) {
    const [sx, sy, sz] = size;
    const ca = Math.cos(angle * DEG);
    const sa = Math.sin(angle * DEG);
    const hx = sx / 2;
    const hy = sy / 2;
    const ring = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ].map(([x, y]) => [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
    this.prism(key, ring, c[2] - sz / 2, c[2] + sz / 2, { bottom });
  }

  // Брус между двумя точками 3D с поперечным сечением w×h (w — горизонтально).
  beam(key, p0, p1, w, h = w) {
    const d = sub3(p1, p0);
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return;
    const ax = [d[0] / L, d[1] / L, d[2] / L];
    let side = cross3(ax, [0, 0, 1]);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-6) side = [1, 0, 0];
    side = norm3(side);
    const up = norm3(cross3(side, ax));
    const hw = w / 2;
    const hh = h / 2;
    const corner = (p, s, u) => [p[0] + side[0] * s + up[0] * u, p[1] + side[1] * s + up[1] * u, p[2] + side[2] * s + up[2] * u];
    const a = [corner(p0, -hw, -hh), corner(p0, hw, -hh), corner(p0, hw, hh), corner(p0, -hw, hh)];
    const b = [corner(p1, -hw, -hh), corner(p1, hw, -hh), corner(p1, hw, hh), corner(p1, -hw, hh)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(key, a[i], b[i], b[j], a[j]);
    }
    this.face(key, [a[0], a[1], a[2], a[3]]);
    this.face(key, [b[3], b[2], b[1], b[0]]);
  }

  // Цилиндр (вертикальный) с гладкими боковыми нормалями.
  cylinder(key, c, z0, z1, r0, r1 = r0, seg = 14, { top = true, bottom = false } = {}) {
    const pts0 = [];
    const pts1 = [];
    const ns = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pts0.push([c[0] + ca * r0, c[1] + sa * r0, z0]);
      pts1.push([c[0] + ca * r1, c[1] + sa * r1, z1]);
      const slope = (r0 - r1) / Math.max(1e-6, z1 - z0);
      ns.push(norm3([ca, sa, slope]));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.triSmooth(key, pts0[i], pts0[j], pts1[j], ns[i], ns[j], ns[j]);
      this.triSmooth(key, pts0[i], pts1[j], pts1[i], ns[i], ns[j], ns[i]);
    }
    if (top && r1 > 0) this.face(key, pts1);
    if (bottom && r0 > 0) this.face(key, pts0.slice().reverse());
  }

  // Горизонтальный цилиндр (ось p0→p1), сечение — окружность радиуса r.
  tube(key, p0, p1, r, seg = 10, caps = true) {
    const d = sub3(p1, p0);
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-6) return;
    const ax = [d[0] / L, d[1] / L, d[2] / L];
    let u = cross3(ax, [0, 0, 1]);
    if (Math.hypot(...u) < 1e-6) u = [1, 0, 0];
    u = norm3(u);
    const v = norm3(cross3(u, ax));
    const ring = (p) =>
      Array.from({ length: seg }, (_, i) => {
        const a = (i / seg) * Math.PI * 2;
        const n = [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
        return { p: [p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r], n };
      });
    const A = ring(p0);
    const B = ring(p1);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.triSmooth(key, A[i].p, B[j].p, A[j].p, A[i].n, B[j].n, A[j].n);
      this.triSmooth(key, A[i].p, B[i].p, B[j].p, A[i].n, B[i].n, B[j].n);
    }
    if (caps) {
      this.face(key, A.map((x) => x.p));
      this.face(key, B.map((x) => x.p).reverse());
    }
  }

  // Низкополигональная сфера/эллипсоид (крона дерева).
  blob(key, c, rx, ry, rz, seg = 7, rings = 5) {
    const P = [];
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      const row = [];
      for (let i = 0; i < seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const n = [Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)];
        row.push({ p: [c[0] + n[0] * rx, c[1] + n[1] * ry, c[2] + n[2] * rz], n });
      }
      P.push(row);
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const k = (i + 1) % seg;
        const a = P[j][i];
        const b = P[j][k];
        const cc = P[j + 1][k];
        const d = P[j + 1][i];
        if (j > 0) this.triSmooth(key, a.p, d.p, b.p, a.n, d.n, b.n);
        if (j < rings - 1) this.triSmooth(key, b.p, d.p, cc.p, b.n, d.n, cc.n);
      }
    }
  }

  // Тело вращения вокруг вертикали через c (купола, главы): profile — [[радиус, z], …] снизу вверх.
  revolve(key, c, profile, seg = 16) {
    const ring = (r, z) =>
      Array.from({ length: seg }, (_, i) => {
        const a = (i / seg) * Math.PI * 2;
        return { p: [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z], ca: Math.cos(a), sa: Math.sin(a) };
      });
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, z0] = profile[k];
      const [r1, z1] = profile[k + 1];
      // нормаль к образующей наружу: (dz, −dr) в плоскости (радиус, высота)
      const L = Math.hypot(z1 - z0, r1 - r0) || 1;
      const nr = (z1 - z0) / L;
      const nz = -(r1 - r0) / L;
      const A = ring(r0, z0);
      const B = ring(r1, z1);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        const na = [A[i].ca * nr, A[i].sa * nr, nz];
        const nb = [A[j].ca * nr, A[j].sa * nr, nz];
        if (r0 > 1e-6) this.triSmooth(key, A[i].p, A[j].p, B[j].p, na, nb, nb);
        if (r1 > 1e-6) this.triSmooth(key, A[i].p, B[j].p, B[i].p, na, nb, na);
        else this.triSmooth(key, A[i].p, A[j].p, B[i].p, na, nb, na);
      }
    }
  }

  // Слить другой набор, подняв его на dz по высоте (части зданий на своей отметке).
  mergeShifted(other, dz) {
    for (const [key, ob] of other.bufs) {
      const b = this._get(key);
      const base = b.pos.length / 3;
      for (let i = 0; i < ob.pos.length; i++) b.pos.push(i % 3 === 1 ? ob.pos[i] + dz : ob.pos[i]);
      for (let i = 0; i < ob.nrm.length; i++) b.nrm.push(ob.nrm[i]);
      for (let i = 0; i < ob.idx.length; i++) b.idx.push(ob.idx[i] + base);
    }
  }

  // Копия, повёрнутая на rotate° (против часовой стрелки на плане) вокруг точки pivot, сдвинутая
  // на move и поднятая на lift метров.
  transformed(pivot, move, rotate, lift = 0, scale = 1) {
    const a = ((rotate || 0) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const [dx, dy] = move || [0, 0];
    const out = new Sink();
    for (const [key, b] of this.bufs) {
      const nb = out._get(key);
      for (let i = 0; i < b.pos.length; i += 3) {
        // в буфере: X = x, Y = высота, Z = −y
        const u = (b.pos[i] - pivot[0]) * scale;
        const v = (-b.pos[i + 2] - pivot[1]) * scale;
        nb.pos.push(pivot[0] + u * c - v * s + dx, b.pos[i + 1] * scale + lift, -(pivot[1] + u * s + v * c + dy));
        const nx = b.nrm[i];
        const ny = -b.nrm[i + 2];
        nb.nrm.push(nx * c - ny * s, b.nrm[i + 1], -(nx * s + ny * c));
      }
      nb.idx.push(...b.idx);
    }
    return out;
  }

  // keyMap — переназначение материалов при слиянии (раскраска по назначению)
  merge(other, keyMap = null) {
    for (const [key, ob] of other.bufs) {
      const b = this._get(keyMap ? keyMap(key) : key);
      const base = b.pos.length / 3;
      for (let i = 0; i < ob.pos.length; i++) b.pos.push(ob.pos[i]);
      for (let i = 0; i < ob.nrm.length; i++) b.nrm.push(ob.nrm[i]);
      for (let i = 0; i < ob.idx.length; i++) b.idx.push(ob.idx[i] + base);
    }
  }

  triangleCount() {
    let n = 0;
    for (const b of this.bufs.values()) n += b.idx.length / 3;
    return n;
  }

  // → [{ key, geometry }]
  toGeometries(THREE) {
    const out = [];
    for (const [key, b] of this.bufs) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      const vcount = b.pos.length / 3;
      g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      out.push({ key, geometry: g });
    }
    return out;
  }
}
