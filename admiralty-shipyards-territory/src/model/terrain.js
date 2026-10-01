// Рельеф-подложка: суша, вода, набережные (гранитные и бетонные причальные стенки),
// основание макета, улицы с тротуарами, внутризаводские проезды, площадки,
// разметка, парапеты набережных, кнехты.

import { Z } from './planar.js';
import { sub, norm, dist, lerp, add, mul, pointInRing, polylineLength, pointAt, sampleAlong } from '../geo.js';

const EPS = 0.5;

function onBoundsEdge(a, b, B) {
  const on = (p) => Math.abs(p[0] - B.minX) < EPS || Math.abs(p[0] - B.maxX) < EPS || Math.abs(p[1] - B.minY) < EPS || Math.abs(p[1] - B.maxY) < EPS;
  if (!on(a) || !on(b)) return false;
  return (
    (Math.abs(a[0] - b[0]) < EPS && (Math.abs(a[0] - B.minX) < EPS || Math.abs(a[0] - B.maxX) < EPS)) ||
    (Math.abs(a[1] - b[1]) < EPS && (Math.abs(a[1] - B.minY) < EPS || Math.abs(a[1] - B.maxY) < EPS))
  );
}

const inMP = (p, mp) => mp.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h)));

// Слэб (приподнятая площадка) по мультиполигону: верх + боковины.
function slab(sink, key, mp, z0, z1, sideKey = null) {
  for (const poly of mp) {
    const [outer, ...holes] = poly;
    sink.flat(key, outer, z1, { holes });
    if (z1 - z0 > 0.02) {
      for (const ring of poly) for (let i = 0; i < ring.length; i++) sink.wall(sideKey || key, ring[i], ring[(i + 1) % ring.length], z0, z1);
    }
  }
}

export function buildGround(sink, data, P) {
  const B = data.meta.bounds;
  // основание макета
  const bb = P.bboxRing;
  for (let i = 0; i < 4; i++) sink.wall('base', bb[i], bb[(i + 1) % 4], Z.base, Z.water);
  sink.flat('base', bb, Z.base, { up: false });
  // вода
  sink.flat('water', bb, Z.water);

  // суша: территория верфи, жилая часть Матисова о., город
  slab(sink, 'ground_yard', P.shipyardMP, 0, 0);
  slab(sink, 'ground_civil', P.civilMP, 0, 0);
  slab(sink, 'ground_city', P.cityGround, 0, 0);

  // набережные
  for (const poly of P.land) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (dist(a, b) < 0.01) continue;
        if (onBoundsEdge(a, b, B)) {
          sink.wall('base', a, b, Z.water, 0);
          continue;
        }
        const m = lerp(a, b, 0.5);
        const key = inMP(offsetIn(a, b, 1.5), P.shipyardMP) ? 'quay_concrete' : 'quay';
        sink.wall(key, a, b, Z.quayBottom, 0);
      }
    }
  }
}

// точка, смещённая от середины ребра внутрь суши (для CCW-контура суша слева)
function offsetIn(a, b, d) {
  const dir = norm(sub(b, a));
  const m = lerp(a, b, 0.5);
  return [m[0] - dir[1] * d, m[1] + dir[0] * d];
}

// Парапеты городских набережных и кнехты на причалах верфи.
export function buildQuayEdges(sinkParapet, sinkBollards, data, P) {
  const B = data.meta.bounds;
  const bridgeFs = P.features.bridges;
  const nearBridge = (p) => bridgeFs.some((f) => f.mp.some((poly) => pointInRing(p, poly[0])));
  for (const poly of P.land) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const L = dist(a, b);
        if (L < 0.5 || onBoundsEdge(a, b, B)) continue;
        const inside = offsetIn(a, b, 1.5);
        const isYard = inMP(inside, P.shipyardMP);
        const dir = norm(sub(b, a));
        const nIn = [-dir[1], dir[0]];
        if (!isYard) {
          // гранитный парапет 0,45×0,9 м с разрывами у мостов
          const steps = Math.max(1, Math.ceil(L / 6));
          for (let k = 0; k < steps; k++) {
            const p0 = lerp(a, b, k / steps);
            const p1 = lerp(a, b, (k + 1) / steps);
            const mid = lerp(p0, p1, 0.5);
            if (nearBridge(mid)) continue;
            const q0 = add(p0, mul(nIn, 0.25));
            const q1 = add(p1, mul(nIn, 0.25));
            sinkParapet.beam('parapet', [q0[0], q0[1], 0.45], [q1[0], q1[1], 0.45], 0.45, 0.9);
          }
        } else {
          // кнехты по кромке причалов верфи на широкой воде (Нева, ковши)
          const m = lerp(a, b, 0.5);
          const outside = [m[0] + dir[1] * 6, m[1] - dir[0] * 6];
          const far = [m[0] + dir[1] * 40, m[1] - dir[0] * 40];
          if (!inMP(outside, P.water) || !inMP(far, P.water)) continue;
          for (let s = 6; s < L - 3; s += 22) {
            const p = add(lerp(a, b, s / L), mul(nIn, 1.0));
            sinkBollards.cylinder('bollard', p, 0, 0.6, 0.22, 0.2, 8);
            sinkBollards.cylinder('bollard', p, 0.6, 0.72, 0.32, 0.32, 8);
          }
          // отбойный брус по кромке причала
          const q0 = add(a, mul(nIn, 0.2));
          const q1 = add(b, mul(nIn, 0.2));
          sinkBollards.beam('steel_dark', [q0[0], q0[1], 0.1], [q1[0], q1[1], 0.1], 0.3, 0.2);
        }
      }
    }
  }
}

export function buildRoads(sinkRoads, sinkMarks, data, P) {
  slab(sinkRoads, 'asphalt', P.carriageways, 0, Z.carriageway);
  slab(sinkRoads, 'sidewalk', P.sidewalks, 0, Z.sidewalk, 'trim');
  slab(sinkRoads, 'asphalt_yard', P.internal, 0, Z.internalRoad);

  // осевая разметка городских улиц шириной от 12 м
  for (const s of data.streets) {
    if (s.w < 12) continue;
    for (const { p, dir } of sampleAlong(s.line, 9, { start: 6, end: 6 })) {
      if (!inMP(p, P.carriageways)) continue;
      const a = add(p, mul(dir, -1.5));
      const b = add(p, mul(dir, 1.5));
      sinkMarks.beam('marking', [a[0], a[1], Z.carriageway + 0.01], [b[0], b[1], Z.carriageway + 0.01], 0.15, 0.02);
    }
  }
  // пешеходные переходы у главной проходной и на пл. Репина
  const zebra = (c, dir, len, width) => {
    const d = norm(dir);
    const n = [-d[1], d[0]];
    for (let k = -len / 2; k <= len / 2; k += 1.0) {
      const p = add(c, mul(d, k));
      const a = add(p, mul(n, -width / 2));
      const b = add(p, mul(n, width / 2));
      sinkMarks.beam('marking', [a[0], a[1], Z.carriageway + 0.01], [b[0], b[1], Z.carriageway + 0.01], 0.5, 0.02);
    }
  };
  for (const z of data.crossings || []) {
    const st = data.streets.find((x) => x.id === z.street);
    if (!st) continue;
    const { p, dir } = pointAt(st.line, z.s);
    zebra(p, [-dir[1], dir[0]], st.w, 4);
  }
}

export function buildAreas(sink, data, P) {
  const H = { square: Z.square, garden: Z.garden, lawn: Z.garden, parking: 0.08, storage: 0.04, apron: 0.04, pond: 0.06, industrial: 0.02 };
  const KEY = { square: 'square', garden: 'grass', lawn: 'grass', parking: 'parking', storage: 'storage', apron: 'apron', pond: 'water_pond', industrial: 'industrial' };
  const order = ['industrial', 'square', 'garden', 'lawn', 'parking', 'storage', 'apron', 'pond'];
  const sorted = [...P.areas].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const a of sorted) {
    const z = H[a.kind] ?? 0.05;
    slab(sink, KEY[a.kind] || 'apron', a.mp, 0, z, a.kind === 'garden' || a.kind === 'lawn' ? 'trim' : null);
    if (a.kind === 'parking') {
      // разметка мест
      for (const poly of a.mp) {
        const r = poly[0];
        // длинная сторона
        let best = 0;
        let bi = 0;
        for (let i = 0; i < r.length; i++) {
          const L = dist(r[i], r[(i + 1) % r.length]);
          if (L > best) {
            best = L;
            bi = i;
          }
        }
        const p0 = r[bi];
        const p1 = r[(bi + 1) % r.length];
        const dir = norm(sub(p1, p0));
        const nIn = [-dir[1], dir[0]];
        for (let s = 2.5; s < best - 1; s += 2.6) {
          const a0 = add(add(p0, mul(dir, s)), mul(nIn, 0.3));
          const a1 = add(a0, mul(nIn, 5));
          sink.beam('marking', [a0[0], a0[1], z + 0.01], [a1[0], a1[1], z + 0.01], 0.12, 0.02);
        }
      }
    }
  }
}

export function buildRails(sink, data) {
  for (const r of data.rails) {
    const half = r.gauge / 2;
    const L = polylineLength(r.line);
    if (r.gauge < 2) {
      // заводская железная дорога: балласт + шпалы
      for (let i = 0; i < r.line.length - 1; i++) {
        const a = r.line[i];
        const b = r.line[i + 1];
        sink.beam('sleeper', [a[0], a[1], 0.08], [b[0], b[1], 0.08], 3.0, 0.16);
      }
      for (let s = 0.4; s < L; s += 0.9) {
        const { p, dir } = pointAt(r.line, s);
        const n = [-dir[1], dir[0]];
        const a = add(p, mul(n, -1.3));
        const b = add(p, mul(n, 1.3));
        sink.beam('keelblock', [a[0], a[1], 0.18], [b[0], b[1], 0.18], 0.22, 0.06);
      }
    }
    for (const side of [-half, half]) {
      for (let i = 0; i < r.line.length - 1; i++) {
        const a = r.line[i];
        const b = r.line[i + 1];
        const dir = norm(sub(b, a));
        const n = [-dir[1], dir[0]];
        const a1 = add(a, mul(n, side));
        const b1 = add(b, mul(n, side));
        const z = r.gauge < 2 ? 0.26 : 0.1;
        sink.beam('rail', [a1[0], a1[1], z], [b1[0], b1[1], z], 0.09, 0.14);
      }
    }
  }
}
