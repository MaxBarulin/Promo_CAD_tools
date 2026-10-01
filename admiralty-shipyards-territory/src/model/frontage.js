// Рядовая городская застройка: дома по красной линии вдоль улиц (петербургские
// «периметральные» кварталы с дворами). Генерация детерминирована (фиксированное зерно).
// Дом не ставится, если пересекает воду, проезжие части и тротуары, территорию верфи,
// площади и скверы или уже размещённые здания.

import { rect, sub, norm, dist, add, mul, rng, ensureCCW, bbox } from '../geo.js';
import { overlapArea } from './planar.js';
import { WALL_KEYS_CITY, ROOF_KEYS_CITY } from './materials.js';

// Проверка пересечения выпуклых многоугольников (теорема о разделяющей оси).
function satOverlap(A, B, tol = 0.3) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = norm([-(q[1] - p[1]), q[0] - p[0]]);
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of A) {
        const d = v[0] * ax[0] + v[1] * ax[1];
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of B) {
        const d = v[0] * ax[0] + v[1] * ax[1];
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA - tol <= minB || maxB - tol <= minA) return false;
    }
  }
  return true;
}

// Расстояние от точки до границы мультиполигона.
function distToMP(p, mp) {
  let best = Infinity;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const ab = [b[0] - a[0], b[1] - a[1]];
        const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
        const d = Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// Дома ближе DETAIL_RADIUS к территории верфи — с окнами и дверями, дальше — упрощённые.
export const DETAIL_RADIUS = 260;

export function generateFrontage(data, P, explicitBuildings, { contextDetail = 'auto' } = {}) {
  const detailAt = (c) => (contextDetail === 'auto' ? (distToMP(c, P.shipyardMP) > DETAIL_RADIUS ? 'low' : 'full') : contextDetail);
  const R = rng(20250704);
  const B = data.meta.bounds;
  const placed = explicitBuildings.map((b) => ({ poly: ensureCCW(b.poly), bb: bbox(b.poly) }));
  const blockers = [
    ...P.features.water,
    ...P.features.streets,
    ...P.features.internal,
    ...P.features.zones,
    ...P.features.areas.filter((a) => a.kind !== 'industrial'),
    ...P.features.bridges,
  ];
  const houses = [];
  let counter = 0;

  const fits = (poly) => {
    const bb = bbox(poly);
    if (bb.minX < B.minX + 4 || bb.maxX > B.maxX - 4 || bb.minY < B.minY + 4 || bb.maxY > B.maxY - 4) return false;
    for (const p of placed) {
      if (p.bb.minX > bb.maxX || p.bb.maxX < bb.minX || p.bb.minY > bb.maxY || p.bb.maxY < bb.minY) continue;
      if (satOverlap(poly, p.poly)) return false;
    }
    return overlapArea(poly, blockers) < 0.5;
  };

  for (const st of data.streets) {
    if (!st.frontage || st.frontage === 'none') continue;
    const sides = st.frontage === 'both' ? [1, -1] : st.frontage === 'left' ? [1] : [-1];
    const setback = st.w / 2 + (st.sidewalk ?? 3) + 0.6;
    for (const side of sides) {
      for (let i = 0; i < st.line.length - 1; i++) {
        const a = st.line[i];
        const b = st.line[i + 1];
        const L = dist(a, b);
        const dir = norm(sub(b, a));
        const nrm = [-dir[1] * side, dir[0] * side];
        const angle = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI + (side > 0 ? 0 : 180);
        let s = 3;
        while (s < L - 8) {
          let len = 16 + R() * 22;
          const depth = 13 + R() * 4;
          let ok = false;
          for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            if (s + len > L - 2) len = L - 2 - s;
            if (len < 9) break;
            const c = add(add(a, mul(dir, s + len / 2)), mul(nrm, setback + depth / 2));
            const poly = rect(c[0], c[1], len, depth, angle);
            if (fits(poly)) {
              const floors = 4 + Math.floor(R() * 3);
              const h = floors * 3.4 + 0.8;
              const wall = WALL_KEYS_CITY[Math.floor(R() * WALL_KEYS_CITY.length)];
              const roofC = ROOF_KEYS_CITY[Math.floor(R() * ROOF_KEYS_CITY.length)];
              const doors = [];
              for (let t = 9; t < len - 4; t += 18) doors.push({ edge: 0, t: t / len, w: 1.7, h: 2.7 });
              if (!doors.length) doors.push({ edge: 0, t: 0.5, w: 1.7, h: 2.7 });
              // проездная арка во двор у длинных домов
              if (len > 26) doors.push({ edge: 0, t: 0.5, w: 3.6, h: 4.2, kind: 'arch' });
              houses.push({
                kind: 'context',
                id: `H${++counter}`,
                name: `Жилой дом (${st.name})`,
                info: `Рядовая историческая застройка: ${st.name}. Схематично.`,
                poly,
                h,
                floors,
                type: 'residential',
                wall,
                roof: { type: 'gable', h: 2.6 + R() * 1.2, color: roofC, ridge: 'w' },
                blind: [1, 3],
                doors,
                generated: true,
                detail: detailAt(c),
              });
              placed.push({ poly, bb: bbox(poly) });
              // дворовый флигель, примыкающий к дому со стороны двора
              if (len >= 16 && R() < 0.62) {
                const ww = 10 + R() * 3;
                const wd = 16 + R() * 18;
                const end = R() < 0.5 ? -1 : 1;
                const wc = add(add(c, mul(dir, end * (len / 2 - ww / 2))), mul(nrm, depth / 2 + wd / 2));
                const wpoly = rect(wc[0], wc[1], ww, wd, angle);
                if (fits(wpoly)) {
                  const wf = Math.max(3, floors - (R() < 0.5 ? 1 : 0));
                  houses.push({
                    kind: 'context',
                    id: `H${++counter}`,
                    name: `Дворовый флигель (${st.name})`,
                    info: 'Дворовый флигель рядовой застройки. Схематично.',
                    poly: wpoly,
                    h: wf * 3.4 + 0.6,
                    floors: wf,
                    type: 'residential',
                    wall: R() < 0.5 ? wall : WALL_KEYS_CITY[Math.floor(R() * WALL_KEYS_CITY.length)],
                    roof: { type: 'gable', h: 2.4, color: roofC, ridge: 'd' },
                    blind: [0, 2],
                    doors: [{ edge: end > 0 ? 3 : 1, t: 0.3, w: 1.5, h: 2.6 }],
                    generated: true,
                    detail: detailAt(c),
                  });
                  placed.push({ poly: wpoly, bb: bbox(wpoly) });
                }
              }
              s += len;
              ok = true;
            } else {
              len *= 0.62;
            }
          }
          if (!ok) s += 5;
        }
      }
    }
  }
  return houses;
}
