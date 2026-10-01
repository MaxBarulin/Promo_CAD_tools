// Геометрические утилиты и система координат модели.
//
// Модель задаётся в локальной метрической системе:
//   x — на восток, y — на север, z — вверх (метры).
// Начало координат — центр площади Репина (у главной проходной).
// Для перевода в WGS84 используется равнопромежуточная проекция,
// погрешность которой на масштабе 2–3 км пренебрежимо мала (< 0,1 м).

export const ORIGIN = { lat: 59.91694, lon: 30.27948, name: 'площадь Репина' };

const R_LAT = 111412; // м в 1° широты на ~59,9° с. ш.
const R_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180); // м в 1° долготы

export function toLatLon([x, y]) {
  return [ORIGIN.lat + y / R_LAT, ORIGIN.lon + x / R_LON];
}

export function fromLatLon(lat, lon) {
  return [(lon - ORIGIN.lon) * R_LON, (lat - ORIGIN.lat) * R_LAT];
}

export const DEG = Math.PI / 180;

// ---------- векторы ----------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
// Левая нормаль (поворот на +90°)
export const perp = (a) => [-a[1], a[0]];
export const dirOf = (angleDeg) => [Math.cos(angleDeg * DEG), Math.sin(angleDeg * DEG)];
export const angleOf = (v) => Math.atan2(v[1], v[0]) / DEG;

// ---------- многоугольники ----------

// Прямоугольник: центр, ширина (вдоль локальной оси X), глубина (вдоль локальной Y),
// поворот в градусах против часовой стрелки. Вершины против часовой стрелки:
// 0 (-w/2,-d/2) → 1 (+w/2,-d/2) → 2 (+w/2,+d/2) → 3 (-w/2,+d/2).
// Стороны: 0 — «фасад» (-Y), 1 — правая (+X), 2 — задняя (+Y), 3 — левая (-X).
export function rect(cx, cy, w, d, angle = 0) {
  const ux = dirOf(angle);
  const uy = perp(ux);
  const hw = w / 2;
  const hd = d / 2;
  return [
    [cx - ux[0] * hw - uy[0] * hd, cy - ux[1] * hw - uy[1] * hd],
    [cx + ux[0] * hw - uy[0] * hd, cy + ux[1] * hw - uy[1] * hd],
    [cx + ux[0] * hw + uy[0] * hd, cy + ux[1] * hw + uy[1] * hd],
    [cx - ux[0] * hw + uy[0] * hd, cy - ux[1] * hw + uy[1] * hd],
  ];
}

export function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const area = (ring) => Math.abs(signedArea(ring));

export function ensureCCW(ring) {
  return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

export function ensureCW(ring) {
  return signedArea(ring) > 0 ? ring.slice().reverse() : ring;
}

export function centroid(ring) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const s = ring.reduce((acc, p) => add(acc, p), [0, 0]);
    return mul(s, 1 / ring.length);
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function bbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------- полилинии ----------

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

// Точка и направление на полилинии на расстоянии s от начала.
export function pointAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (acc + seg >= s || i === pts.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (s - acc) / seg)) : 0;
      return { p: lerp(pts[i - 1], pts[i], t), dir: norm(sub(pts[i], pts[i - 1])), index: i - 1 };
    }
    acc += seg;
  }
  return { p: pts[0], dir: [1, 0], index: 0 };
}

// Ближайшая точка полилинии: возвращает расстояние вдоль линии и смещение.
export function project(pts, q) {
  let best = { d: Infinity, s: 0, p: pts[0] };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const ab = sub(b, a);
    const l2 = dot(ab, ab) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
    const p = add(a, mul(ab, t));
    const d = dist(p, q);
    if (d < best.d) best = { d, s: acc + t * Math.sqrt(l2), p };
    acc += Math.sqrt(l2);
  }
  return best;
}

// Смещение полилинии на d (d > 0 — влево по ходу) со «срезанными» острыми углами.
export function offsetPolyline(pts, d) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? norm(sub(pts[i], pts[i - 1])) : null;
    const next = i < n - 1 ? norm(sub(pts[i + 1], pts[i])) : null;
    if (!prev) {
      out.push(add(pts[i], mul(perp(next), d)));
    } else if (!next) {
      out.push(add(pts[i], mul(perp(prev), d)));
    } else {
      const n1 = perp(prev);
      const n2 = perp(next);
      const bis = norm(add(n1, n2));
      const c = dot(bis, n1);
      if (c < 0.35) {
        // слишком острый угол — две точки вместо одной
        out.push(add(pts[i], mul(n1, d)));
        out.push(add(pts[i], mul(n2, d)));
      } else {
        out.push(add(pts[i], mul(bis, d / c)));
      }
    }
  }
  return out;
}

// Контур полосы заданной полуширины вокруг полилинии (замкнутое кольцо, против часовой).
export function bufferPolyline(pts, half, { capExtend = 0 } = {}) {
  let p = pts;
  if (capExtend) {
    const d0 = norm(sub(p[1], p[0]));
    const d1 = norm(sub(p[p.length - 1], p[p.length - 2]));
    p = [sub(p[0], mul(d0, capExtend)), ...p.slice(1, -1), add(p[p.length - 1], mul(d1, capExtend))];
  }
  const left = offsetPolyline(p, half);
  const right = offsetPolyline(p, -half);
  return ensureCCW([...right, ...left.reverse()]);
}

// Равномерная расстановка точек вдоль полилинии с шагом step.
export function sampleAlong(pts, step, { start = 0, end = 0 } = {}) {
  const L = polylineLength(pts);
  const res = [];
  for (let s = start; s <= L - end + 1e-6; s += step) res.push({ s, ...pointAt(pts, s) });
  return res;
}

// Сглаживание полилинии (Чайкин) — для берегов и рек.
export function smooth(pts, iterations = 2, closed = false) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = p[i];
      const b = p[(i + 1) % n];
      out.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

// Локальная система координат (u — вдоль angle, v — влево от него).
export function frame(origin, angle) {
  const u = dirOf(angle);
  const v = perp(u);
  return {
    origin,
    angle,
    u,
    v,
    at: (a, b) => [origin[0] + u[0] * a + v[0] * b, origin[1] + u[1] * a + v[1] * b],
  };
}

// Детерминированный генератор случайных чисел (чтобы модель была воспроизводимой).
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
