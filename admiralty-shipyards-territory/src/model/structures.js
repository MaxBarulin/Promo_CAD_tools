// Прочие сооружения: мосты, дымовые трубы, арка Новой Голландии, деревья,
// автомобили, складируемый металл, секции корпуса, контейнеры.

import { sub, add, mul, norm, dist, lerp, rect, pointInRing, bbox, rng, ensureCCW, DEG } from '../geo.js';

// ---------- мосты ----------

export function buildBridge(sink, br) {
  const dir = norm(sub(br.to, br.from));
  const n = [-dir[1], dir[0]];
  const ext = 3;
  const a = add(br.from, mul(dir, -ext));
  const b = add(br.to, mul(dir, ext));
  const L = dist(a, b);
  const hw = br.w / 2;
  const P = (u, v, z) => {
    const p = add(add(a, mul(dir, u)), mul(n, v));
    return [p[0], p[1], z];
  };
  const hump = br.type === 'kalinkin' ? 1.8 : br.type === 'industrial' ? 0.1 : 0.7;
  const zTop = (u) => 0.3 + hump * Math.sin((Math.PI * u) / L);
  const N = 12;
  const deckKey = br.type === 'industrial' ? 'bridge_steel' : 'bridge_deck';
  const sideKey = br.type === 'industrial' ? 'bridge_steel' : 'bridge';
  const thick = br.type === 'kalinkin' ? 1.2 : 0.9;
  for (let k = 0; k < N; k++) {
    const u0 = (L * k) / N;
    const u1 = (L * (k + 1)) / N;
    sink.quad(deckKey, P(u0, -hw, zTop(u0)), P(u1, -hw, zTop(u1)), P(u1, hw, zTop(u1)), P(u0, hw, zTop(u0)));
    // фасады пролётного строения
    sink.quad(sideKey, P(u0, -hw, zTop(u0) - thick), P(u1, -hw, zTop(u1) - thick), P(u1, -hw, zTop(u1)), P(u0, -hw, zTop(u0)));
    sink.quad(sideKey, P(u1, hw, zTop(u1) - thick), P(u0, hw, zTop(u0) - thick), P(u0, hw, zTop(u0)), P(u1, hw, zTop(u1)));
    sink.quad(sideKey, P(u1, -hw, zTop(u1) - thick), P(u0, -hw, zTop(u0) - thick), P(u0, hw, zTop(u0) - thick), P(u1, hw, zTop(u1) - thick));
  }
  // тротуары на мосту (кроме заводских)
  if (br.type !== 'industrial' && br.w >= 9) {
    for (const s of [-1, 1]) {
      for (let k = 0; k < N; k++) {
        const u0 = (L * k) / N;
        const u1 = (L * (k + 1)) / N;
        const v0 = s * hw;
        const v1 = s * (hw - 2.2);
        const q = [P(u0, v0, zTop(u0) + 0.15), P(u1, v0, zTop(u1) + 0.15), P(u1, v1, zTop(u1) + 0.15), P(u0, v1, zTop(u0) + 0.15)];
        sink.quad('sidewalk', ...(s < 0 ? q : q.slice().reverse()));
      }
    }
  }
  // ограждение
  for (const s of [-1, 1]) {
    const v = s * (hw - 0.2);
    for (let k = 0; k < N; k++) {
      const u0 = (L * k) / N;
      const u1 = (L * (k + 1)) / N;
      if (br.type === 'kalinkin') {
        sink.beam('parapet', P(u0, v, zTop(u0) + 0.55), P(u1, v, zTop(u1) + 0.55), 0.5, 1.1);
      } else {
        sink.beam(br.type === 'industrial' ? 'crane_yellow' : 'railing', P(u0, v, zTop(u0) + 1.1), P(u1, v, zTop(u1) + 1.1), 0.08, 0.08);
        sink.beam('railing', P(u0, v, zTop(u0) + 0.2), P(u1, v, zTop(u1) + 0.2), 0.06, 0.06);
        for (let t = 0; t < 3; t++) {
          const u = u0 + ((u1 - u0) * t) / 3;
          sink.beam('railing', P(u, v, zTop(u)), P(u, v, zTop(u) + 1.1), 0.06, 0.06);
        }
      }
    }
  }
  // опоры и своды
  if (br.type === 'kalinkin') {
    const spans = [
      [ext - 1, L * 0.36],
      [L * 0.36, L * 0.64],
      [L * 0.64, L - ext + 1],
    ];
    for (const [s0, s1] of spans) {
      const M = 10;
      for (let k = 0; k < M; k++) {
        const t0 = k / M;
        const t1 = (k + 1) / M;
        const u0 = s0 + (s1 - s0) * t0;
        const u1 = s0 + (s1 - s0) * t1;
        const rise = 3.4;
        const za = (t) => -2.4 + 0.6 + rise * Math.sin(Math.PI * t);
        // тимпаны (стенки над сводом)
        for (const s of [-1, 1]) {
          const v = s * hw;
          const q = [P(u0, v, za(t0)), P(u1, v, za(t1)), P(u1, v, zTop(u1) - thick), P(u0, v, zTop(u0) - thick)];
          sink.quad('bridge', ...(s < 0 ? q : [q[1], q[0], q[3], q[2]]));
        }
        // внутренняя поверхность свода
        sink.quad('bridge', P(u1, -hw, za(t1)), P(u0, -hw, za(t0)), P(u0, hw, za(t0)), P(u1, hw, za(t1)));
      }
    }
    // быки и башни-павильоны
    for (const u of [L * 0.36, L * 0.64]) {
      const c = P(u, 0, 0);
      sink.box('bridge', [c[0], c[1], -3.4 + 2.2], [3.5, br.w + 2, 4.4], (Math.atan2(dir[1], dir[0]) * 180) / Math.PI);
      for (const s of [-1, 1]) {
        const t = P(u, s * (hw + 0.9), 0);
        const z0 = zTop(u);
        sink.box('bridge', [t[0], t[1], z0 + 3.2], [2.6, 2.6, 6.4], (Math.atan2(dir[1], dir[0]) * 180) / Math.PI);
        sink.box('trim', [t[0], t[1], z0 + 6.6], [3.0, 3.0, 0.4], (Math.atan2(dir[1], dir[0]) * 180) / Math.PI);
        sink.cylinder('r_dark', [t[0], t[1]], z0 + 6.8, z0 + 9.2, 1.4, 0.15, 10);
        sink.cylinder('railing', [t[0], t[1]], z0 + 9.2, z0 + 10.4, 0.08, 0.04, 6);
      }
    }
  } else {
    // опора посередине для длинных пролётов
    if (dist(br.from, br.to) > 32) {
      const c = P(L / 2, 0, 0);
      sink.box(sideKey, [c[0], c[1], (-3.4 + zTop(L / 2) - thick) / 2], [1.6, br.w - 1, zTop(L / 2) - thick + 3.4], (Math.atan2(dir[1], dir[0]) * 180) / Math.PI);
    }
  }
}

// ---------- дымовая труба ----------

export function buildChimney(sink, ch) {
  if (ch.style === 'steel') return buildSteelChimney(sink, ch);
  sink.cylinder('chimney', ch.at, 0, ch.h - 6, ch.r, ch.r * 0.7, 16, { top: false });
  sink.cylinder('chimney_band', ch.at, ch.h - 6, ch.h - 3, ch.r * 0.7, ch.r * 0.66, 16, { top: false });
  sink.cylinder('white', ch.at, ch.h - 3, ch.h, ch.r * 0.66, ch.r * 0.62, 16, { top: false });
  sink.cylinder('r_bitumen', ch.at, ch.h - 0.05, ch.h, ch.r * 0.5, ch.r * 0.5, 12);
  sink.cylinder('chimney_band', ch.at, ch.h * 0.5, ch.h * 0.5 + 2.5, ch.r * 0.86, ch.r * 0.85, 16, { top: false });
}

// Стальная труба котельной на растяжках: тёмный ствол, оголовок, площадка обслуживания,
// три троса к анкерам на земле (или на кровле соседних корпусов — guyZ).
function buildSteelChimney(sink, ch) {
  const [x, y] = ch.at;
  const h = ch.h;
  const r = ch.r;
  sink.cylinder('steel_dark', ch.at, 0, h, r, r, 16, { top: false });
  sink.cylinder('steel_dark', ch.at, 0, 1.2, r + 0.35, r + 0.35, 16);
  sink.cylinder('steel', ch.at, h - 0.6, h, r + 0.12, r + 0.12, 16, { top: false });
  sink.cylinder('r_bitumen', ch.at, h - 0.05, h, r * 0.9, r * 0.9, 12);
  if (ch.platform) {
    const zp = h - 3.5;
    sink.cylinder('steel', ch.at, zp, zp + 0.2, r + 1.1, r + 1.1, 16, { bottom: true });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = [x + Math.cos(a) * (r + 1.05), y + Math.sin(a) * (r + 1.05)];
      sink.beam('steel', [p[0], p[1], zp + 0.2], [p[0], p[1], zp + 1.2], 0.06);
    }
  }
  // растяжки: к анкерам guys ([x, y] на высоте guyZ — на земле или на кровле корпуса) или
  // три троса через 120° к земле
  const zg = h * 0.72;
  const R = Math.max(10, h * 0.42);
  const anchors = ch.guys || [0, 1, 2].map((k) => {
    const a = (((ch.guyAngle ?? 30) + k * 120) * Math.PI) / 180;
    return [x + Math.cos(a) * R, y + Math.sin(a) * R];
  });
  for (const g of anchors) {
    const L = Math.hypot(g[0] - x, g[1] - y) || 1;
    sink.beam('steel_dark', [x + ((g[0] - x) / L) * r, y + ((g[1] - y) / L) * r, zg], [g[0], g[1], ch.guyZ ?? 0], 0.05);
  }
}

// ---------- арка Новой Голландии ----------

export function buildArch(sink, a) {
  const dir = [Math.cos(a.angle * DEG), Math.sin(a.angle * DEG)];
  const n = [-dir[1], dir[0]];
  const P = (u, v) => add(add(a.at, mul(dir, u)), mul(n, v));
  const span = a.w;
  const depth = 27;
  for (const s of [-1, 1]) {
    const c = P((s * (span / 2 + 2.2)), 0);
    sink.box('brick', [c[0], c[1], a.h / 2], [4.4, depth, a.h], a.angle);
    // колонны тосканского ордера на фасаде к Мойке
    for (const k of [-1, 1]) {
      const cc = add(P(s * (span / 2 + 2.2) + k * 1.4, -depth / 2 - 0.9), [0, 0]);
      sink.cylinder('column', cc, 0, a.h - 5, 0.7, 0.62, 12);
    }
  }
  // свод
  const R = span / 2;
  const zs = a.h - 5 - R;
  const M = 12;
  for (let k = 0; k < M; k++) {
    const t0 = (Math.PI * k) / M;
    const t1 = (Math.PI * (k + 1)) / M;
    const p0 = P(-Math.cos(t0) * R, 0);
    const p1 = P(-Math.cos(t1) * R, 0);
    sink.beam('brick', [p0[0], p0[1], zs + Math.sin(t0) * R + 0.8], [p1[0], p1[1], zs + Math.sin(t1) * R + 0.8], depth, 1.6);
  }
  // аттик и антаблемент
  const c = P(0, 0);
  sink.box('brick', [c[0], c[1], a.h - 2.5], [span + 2, depth, 5], a.angle);
  const f = P(0, -depth / 2 - 0.9);
  sink.box('trim', [f[0], f[1], a.h - 4.6], [span + 9, 2.4, 1.2], a.angle);
  sink.box('trim', [c[0], c[1], a.h + 0.2], [span + 10, depth + 2, 0.4], a.angle);
}

// ---------- деревья ----------

export function buildTree(sink, p, h, r, key) {
  sink.box('trunk', [p[0], p[1], h * 0.22], [0.35, 0.35, h * 0.44], 0);
  sink.blob(key, [p[0], p[1], h * 0.62], r, r, h * 0.4, 7, 5);
}

export function scatterInPolygon(ring, spacing, seed, margin = 2) {
  const R = rng(seed);
  const bb = bbox(ring);
  const out = [];
  for (let x = bb.minX + margin; x < bb.maxX - margin; x += spacing) {
    for (let y = bb.minY + margin; y < bb.maxY - margin; y += spacing) {
      const p = [x + (R() - 0.5) * spacing * 0.6, y + (R() - 0.5) * spacing * 0.6];
      if (pointInRing(p, ring)) out.push(p);
    }
  }
  return out;
}

// ---------- автомобили ----------

export function buildCar(sink, p, angle, key) {
  sink.box(key, [p[0], p[1], 0.75], [4.3, 1.8, 0.75], angle);
  const c = [p[0] - Math.cos(angle * DEG) * 0.3, p[1] - Math.sin(angle * DEG) * 0.3];
  sink.box('glass', [c[0], c[1], 1.38], [2.3, 1.6, 0.55], angle);
  sink.box(key, [c[0], c[1], 1.68], [2.1, 1.5, 0.06], angle);
}

// ---------- внутризаводской автобус и остановки ----------

// Автобус длиной 12 м (низкопольный, не сочленённый) в начале координат, нос — по +x.
// Двери — по правому борту (−y).
export function buildBus(sink) {
  sink.box('bus_dark', [0, 0, 0.5], [11.9, 2.5, 0.4]);
  sink.box('bus', [0, 0, 1.85], [12, 2.55, 2.3]);
  // окна по бортам, лобовое и заднее стекло
  sink.box('glass', [-0.2, 0, 2.05], [10.9, 2.57, 1.05]);
  sink.box('glass', [5.98, 0, 1.75], [0.08, 2.3, 1.85]);
  sink.box('glass', [-5.98, 0, 2.15], [0.08, 2.1, 0.85]);
  // маршрутный указатель
  sink.box('frame_dark', [5.99, 0, 2.83], [0.08, 1.7, 0.24]);
  // двери (правый борт)
  for (const x of [4.6, 0.4, -3.6]) sink.box('glass', [x, -1.28, 1.5], [1.25, 0.04, 2.25]);
  // крыша: светлый верх и блок кондиционера
  sink.box('white', [0, 0, 3.02], [11.8, 2.4, 0.04]);
  sink.box('white', [-1.2, 0, 3.18], [4.2, 1.7, 0.3]);
  // фары (вечером светятся вместе с окнами)
  for (const y of [-0.9, 0.9]) sink.box('glass_lit', [6.01, y, 0.82], [0.04, 0.4, 0.16]);
  // колёса
  for (const x of [3.4, -2.6])
    for (const y of [-1, 1]) sink.tube('tyre', [x, y * 1.0, 0.5], [x, y * 1.3, 0.5], 0.5, 14);
}

// Остановка: зона на проезжей части у края (жёлтая разметка с зигзагом) и знак
// «Место остановки автобуса» на стойке. st — { zone: { at, angle, L, W }, sign }.
export function buildBusStop(sink, st) {
  const { at, angle, L, W } = st.zone;
  const c = Math.cos(angle * DEG);
  const s = Math.sin(angle * DEG);
  const P = (u, v) => [at[0] + c * u - s * v, at[1] + s * u + c * v];
  const z = 0.07;
  const line = (p, q, w = 0.15) => {
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    sink.box('marking_yellow', [m[0], m[1], z], [Math.hypot(q[0] - p[0], q[1] - p[1]) + w, w, 0.02], ang);
  };
  const hu = L / 2;
  const hv = W / 2;
  line(P(-hu, -hv), P(hu, -hv));
  line(P(-hu, hv), P(hu, hv));
  line(P(-hu, -hv), P(-hu, hv));
  line(P(hu, -hv), P(hu, hv));
  // зигзаг 1.17
  const n = 6;
  for (let k = 0; k < n; k++) {
    const u0 = -hu + (k * L) / n;
    const u1 = -hu + ((k + 1) * L) / n;
    line(P(u0, k % 2 ? hv : -hv), P(u1, k % 2 ? -hv : hv), 0.12);
  }
  // стойка и знак 5.16 (синий квадрат, белое поле, автобус)
  const p = st.sign;
  sink.cylinder('steel', p, 0.05, 2.9, 0.045, 0.045, 8);
  sink.box('sign_bus', [p[0], p[1], 2.5], [0.05, 0.62, 0.62], angle);
  for (const k of [-1, 1]) {
    const q = [p[0] + c * 0.03 * k, p[1] + s * 0.03 * k];
    sink.box('white', [q[0], q[1], 2.5], [0.012, 0.44, 0.44], angle);
    const r = [p[0] + c * 0.04 * k, p[1] + s * 0.04 * k];
    sink.box('bus_dark', [r[0], r[1], 2.49], [0.012, 0.32, 0.14], angle);
  }
}

// ---------- секции корпуса, контейнеры ----------

export function buildBlocks(sink, at, angle, list) {
  const c = Math.cos(angle * DEG);
  const s = Math.sin(angle * DEG);
  for (const [u, v, w, d, h] of list) {
    const p = [at[0] + c * u - s * v, at[1] + s * u + c * v];
    sink.box('hull_primer', [p[0], p[1], h / 2 + 0.6], [w, d, h], angle);
    for (const k of [-0.35, 0.35]) {
      const q = [p[0] + c * k * w, p[1] + s * k * w];
      sink.box('keelblock', [q[0], q[1], 0.3], [1.2, d * 0.8, 0.6], angle);
    }
  }
}

export function buildContainers(sink, at, angle, n, seed) {
  const R = rng(seed);
  const c = Math.cos(angle * DEG);
  const s = Math.sin(angle * DEG);
  for (let i = 0; i < n; i++) {
    const u = (i % 4) * 2.7;
    const lvl = Math.floor(i / 4);
    const p = [at[0] - s * u, at[1] + c * u];
    sink.box(R() < 0.5 ? 'container' : 'container2', [p[0], p[1], 1.3 + lvl * 2.6], [6.1, 2.44, 2.59], angle);
  }
}

export { rect, lerp };

// Площадка или плита по данным предприятия: тонкая плита по контуру (бетон / металл), яма — заглублённая
export function buildPlatform(sink, p) {
  const ring = ensureCCW(p.poly);
  if (p.surface === 'pit') {
    // борт ямы по контуру и тёмное дно чуть ниже земли
    sink.prism('asphalt', ring, -0.02, 0.05, { bottom: false });
    return;
  }
  const key = p.surface === 'metal' ? 'steel_plate' : 'apron';
  sink.prism(key, ring, 0.02, p.surface === 'metal' ? 0.22 : 0.3, { bottom: false });
}

// Отметка объекта без контура: стойка с табличкой (сам объект — набережная, пирс, эстакада — контура не имеет)
export function buildMarker(sink, m) {
  const [x, y] = m.at;
  sink.cylinder('marker_post', [x, y], 0, 2.3, 0.07, 0.07, 8, { top: true });
  sink.box(m.kind === 'service' ? 'marker_service' : 'marker_sign', [x, y, 2.1], [0.9, 0.08, 0.6], 0);
  sink.cylinder('apron', [x, y], 0, 0.12, 0.6, 0.6, 12, { top: true });
}
