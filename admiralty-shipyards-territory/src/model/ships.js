// Суда: корпус (лофтинг по шпангоутам), надстройка, труба, мачта; подводные лодки;
// плавучие доки; кильблоки стапелей.

import { DEG } from '../geo.js';

const Z_WATER = -2.4;

// Полуширина корпуса в плане (0…1) по относительной длине x ∈ [0 (корма), 1 (нос)].
function planShape(x, type) {
  const stern = type === 'icebreaker' ? 0.8 : type === 'tanker' ? 0.86 : 0.78;
  if (x < 0.12) return stern + (1 - stern) * Math.sin((x / 0.12) * (Math.PI / 2));
  const bowStart = type === 'tanker' ? 0.82 : type === 'icebreaker' ? 0.68 : 0.72;
  if (x <= bowStart) return 1;
  const t = (x - bowStart) / (1 - bowStart);
  return Math.max(0.02, Math.cos((t * Math.PI) / 2) ** (type === 'tanker' ? 0.7 : 1.1));
}

// Сечение шпангоута: точки полубортa (y, z) от киля к палубе (z ∈ [0, D]).
function section(halfB, D, type) {
  const bilge = Math.min(halfB * 0.45, D * 0.35);
  const pts = [[0, 0]];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([halfB - bilge + Math.sin(a) * bilge, bilge - Math.cos(a) * bilge]);
  }
  const flare = type === 'icebreaker' ? 1.04 : 1.0;
  pts.push([halfB, D * 0.6]);
  pts.push([halfB * flare, D]);
  return pts;
}

function frame(at, angleDeg, z0, pitchDeg = 0) {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  const cp = Math.cos(pitchDeg * DEG);
  const sp = Math.sin(pitchDeg * DEG);
  // x — вдоль судна (нос +), y — к левому борту, z — вверх; дифферент — поворот вокруг y
  return (x, y, z) => {
    const xx = x * cp - z * sp;
    const zz = x * sp + z * cp;
    return [at[0] + c * xx - s * y, at[1] + s * xx + c * y, z0 + zz];
  };
}

export function buildShip(sink, sh, { pitch = 0 } = {}) {
  if (sh.hull === 'submarine') return buildSubmarine(sink, sh, { pitch });
  const { L, B, D } = sh;
  const T = sh.T || 0;
  const z0 = sh.afloat ? Z_WATER - T : sh.z ?? 0;
  const P = frame(sh.at, sh.angle, z0, pitch);
  const type = sh.hull;
  const topKey = sh.hullColor || (type === 'icebreaker' ? 'hull_red_top' : type === 'trawler' ? 'hull_blue' : 'hull_black');
  const botKey = sh.stage === 'hull' ? 'hull_primer' : 'hull_red';
  const wl = sh.afloat ? T : D * 0.45;

  const NS = 26;
  const secs = [];
  for (let i = 0; i <= NS; i++) {
    const x = i / NS;
    const hb = (B / 2) * planShape(x, type);
    const sheer = D + (x > 0.85 ? (x - 0.85) * 12 : 0);
    // носовой подъём днища (форштевень)
    const keelRise = x > 0.85 ? ((x - 0.85) / 0.15) ** 2 * D * 0.35 : x < 0.04 ? (0.04 - x) * D * 4 : 0;
    const sec = section(Math.max(hb, 0.05), sheer - keelRise, type).map(([y, z]) => [y, z + keelRise]);
    secs.push({ x: (x - 0.5) * L, pts: sec });
  }
  const m = secs[0].pts.length;
  // борта (обе стороны)
  for (const side of [1, -1]) {
    for (let i = 0; i < NS; i++) {
      const A = secs[i];
      const Bs = secs[i + 1];
      for (let j = 0; j < m - 1; j++) {
        const a0 = P(A.x, side * A.pts[j][0], A.pts[j][1]);
        const a1 = P(A.x, side * A.pts[j + 1][0], A.pts[j + 1][1]);
        const b0 = P(Bs.x, side * Bs.pts[j][0], Bs.pts[j][1]);
        const b1 = P(Bs.x, side * Bs.pts[j + 1][0], Bs.pts[j + 1][1]);
        const zMid = (A.pts[j][1] + A.pts[j + 1][1]) / 2;
        const key = zMid < wl ? botKey : topKey;
        if (side > 0) sink.quad(key, a0, a1, b1, b0);
        else sink.quad(key, a0, b0, b1, a1);
      }
    }
  }
  // транец
  const tr = secs[0];
  const trPts = [...tr.pts.map(([y, z]) => P(tr.x, -y, z)).reverse(), ...tr.pts.map(([y, z]) => P(tr.x, y, z))];
  sink.face(topKey, trPts.slice().reverse());
  // палуба
  const deckL = secs.map((s) => P(s.x, s.pts[m - 1][0], s.pts[m - 1][1]));
  const deckR = secs.map((s) => P(s.x, -s.pts[m - 1][0], s.pts[m - 1][1]));
  for (let i = 0; i < NS; i++) sink.quad('deck', deckR[i], deckR[i + 1], deckL[i + 1], deckL[i]);
  // фальшборт
  for (let i = 0; i < NS; i++) {
    for (const side of [deckL, deckR]) {
      const up = (p) => [p[0], p[1], p[2] + 0.55];
      sink.beam(topKey, up(side[i]), up(side[i + 1]), 0.2, 1.1);
    }
  }

  if (sh.stage === 'hull') {
    // формирование корпуса: блоки на палубе и леса
    const bz = D;
    for (const [x, w, l, hh] of [
      [-0.3, 0.8, 0.12, 6],
      [-0.18, 0.7, 0.08, 4],
      [0.1, 0.9, 0.1, 3],
    ]) {
      const c = P(x * L, 0, bz + hh / 2);
      sink.box('hull_primer', c, [l * L, w * B, hh], sh.angle);
    }
    return;
  }

  // надстройка
  const sup = type === 'trawler' ? { x: 0.18, l: 0.2, levels: 4 } : type === 'icebreaker' ? { x: 0.12, l: 0.26, levels: 5 } : { x: -0.38, l: 0.12, levels: 6 };
  const lh = 2.8;
  for (let k = 0; k < sup.levels; k++) {
    const shrink = 1 - k * 0.06;
    const c = P(sup.x * L, 0, D + lh * k + lh / 2);
    sink.box('superstructure', c, [sup.l * L * shrink, B * 0.78 * shrink, lh], sh.angle);
    // ряд иллюминаторов/окон
    for (const side of [1, -1]) {
      const n = Math.floor((sup.l * L * shrink) / 2.2);
      for (let q = 0; q < n; q++) {
        const xx = sup.x * L - (sup.l * L * shrink) / 2 + 1.1 + q * 2.2;
        const pw = P(xx, side * (B * 0.39 * shrink + 0.03), D + lh * k + lh * 0.55);
        sink.box('glass', pw, [1.1, 0.06, 0.8], sh.angle);
      }
    }
  }
  // рубка
  const bridgeZ = D + lh * sup.levels;
  sink.box('superstructure', P(sup.x * L + sup.l * L * 0.2, 0, bridgeZ + 1.4), [sup.l * L * 0.45, B * 0.95, 2.8], sh.angle);
  sink.box('glass', P(sup.x * L + sup.l * L * 0.2 + sup.l * L * 0.225 + 0.04, 0, bridgeZ + 1.6), [0.08, B * 0.85, 1.2], sh.angle);
  // мачта
  const mast = P(sup.x * L + sup.l * L * 0.15, 0, 0);
  sink.cylinder('superstructure', mast, bridgeZ + 2.8, bridgeZ + 12, 0.35, 0.2, 8);
  sink.beam('superstructure', [mast[0], mast[1], bridgeZ + 9], P(sup.x * L + sup.l * L * 0.15, 3, bridgeZ + 9), 0.15, 0.15);
  sink.beam('superstructure', [mast[0], mast[1], bridgeZ + 9], P(sup.x * L + sup.l * L * 0.15, -3, bridgeZ + 9), 0.15, 0.15);
  // труба
  const fx = sup.x * L - sup.l * L * 0.35;
  sink.box('funnel', P(fx, 0, bridgeZ), [Math.min(6, L * 0.05), B * 0.28, 7], sh.angle);
  sink.box('hull_black', P(fx, 0, bridgeZ + 3.8), [Math.min(6, L * 0.05) + 0.1, B * 0.28 + 0.1, 0.8], sh.angle);
  // палубное оборудование
  if (type === 'trawler') {
    // слип и портал на корме
    sink.beam('crane_yellow', P(-0.45 * L, B * 0.35, D), P(-0.45 * L, B * 0.35, D + 9), 0.6, 0.6);
    sink.beam('crane_yellow', P(-0.45 * L, -B * 0.35, D), P(-0.45 * L, -B * 0.35, D + 9), 0.6, 0.6);
    sink.beam('crane_yellow', P(-0.45 * L, B * 0.35, D + 9), P(-0.45 * L, -B * 0.35, D + 9), 0.6, 0.6);
    sink.box('steel_dark', P(-0.2 * L, 0, D + 1), [L * 0.12, B * 0.5, 2], sh.angle);
  } else {
    sink.box('steel_dark', P(0.4 * L, 0, D + 0.8), [3, B * 0.5, 1.6], sh.angle);
    sink.cylinder('crane_yellow', P(0.25 * L, B * 0.3, 0), D, D + 4, 0.5, 0.5, 8);
    sink.beam('crane_yellow', P(0.25 * L, B * 0.3, D + 4), P(0.25 * L + 10, B * 0.3, D + 9), 0.4, 0.4);
  }
}

export function buildSubmarine(sink, sh, { pitch = 0 } = {}) {
  const { L, B } = sh;
  const R = B / 2;
  const zc = sh.afloat ? Z_WATER - (sh.T || 6.2) + R : sh.z ?? 0;
  const P = frame(sh.at, sh.angle, zc, pitch);
  const NS = 30;
  const seg = 16;
  const radius = (x) => {
    // x ∈ [0 (корма), 1 (нос)]
    if (x > 0.85) return R * Math.sqrt(Math.max(0, 1 - ((x - 0.85) / 0.15) ** 2)) * 0.98 + 0.02;
    if (x < 0.32) return R * (0.15 + 0.85 * Math.sin(((x / 0.32) * Math.PI) / 2));
    return R;
  };
  const rings = [];
  for (let i = 0; i <= NS; i++) {
    const x = i / NS;
    const r = radius(x);
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const n = [0, Math.cos(a), Math.sin(a)];
      ring.push({ p: P((x - 0.5) * L, n[1] * r, n[2] * r), n });
    }
    rings.push({ ring, x: (x - 0.5) * L });
  }
  const c = Math.cos(sh.angle * DEG);
  const s = Math.sin(sh.angle * DEG);
  const rotN = (n) => [-s * n[1], c * n[1], n[2]];
  for (let i = 0; i < NS; i++) {
    for (let k = 0; k < seg; k++) {
      const j = (k + 1) % seg;
      const a = rings[i].ring[k];
      const b = rings[i].ring[j];
      const cc = rings[i + 1].ring[j];
      const d = rings[i + 1].ring[k];
      sink.triSmooth('sub_black', a.p, b.p, cc.p, rotN(a.n), rotN(b.n), rotN(cc.n));
      sink.triSmooth('sub_black', a.p, cc.p, d.p, rotN(a.n), rotN(cc.n), rotN(d.n));
    }
  }
  // ограждение рубки
  sink.box('sub_black', P(0.12 * L, 0, R + 2.4), [L * 0.12, 2.2, 4.8], sh.angle);
  sink.box('sub_black', P(0.12 * L + 0.5, 0, R + 4.9), [L * 0.1, 1.8, 0.5], sh.angle);
  // горизонтальные рули на рубке
  sink.box('sub_black', P(0.14 * L, 0, R + 3.2), [2.4, 7, 0.3], sh.angle);
  // кормовое оперение
  sink.box('sub_black', P(-0.47 * L, 0, 0), [3.5, 0.4, 7], sh.angle);
  sink.box('sub_black', P(-0.47 * L, 0, 0), [3.5, 7, 0.4], sh.angle);
  // палуба-настил
  sink.box('deck', P(0.05 * L, 0, R - 0.1), [L * 0.6, 1.6, 0.25], sh.angle);
}

export function buildDock(sink, d) {
  const z0 = Z_WATER - 4.5;
  const pontoonH = 5.4; // палуба понтона на 0,9 м выше воды
  const wallH = 12;
  const wallW = 3.2;
  const c = Math.cos(d.angle * DEG);
  const s = Math.sin(d.angle * DEG);
  const P = (u, v) => [d.at[0] + c * u - s * v, d.at[1] + s * u + c * v];
  // понтон
  sink.box('dock_red', [...P(0, 0), (z0 + Z_WATER + 0.3) / 2], [d.L, d.B, Z_WATER + 0.3 - z0], d.angle);
  sink.box('dock', [...P(0, 0), (Z_WATER + 0.3 + z0 + pontoonH) / 2], [d.L, d.B, z0 + pontoonH - Z_WATER - 0.3], d.angle);
  // башни
  for (const sv of [-1, 1]) {
    const cc = P(0, sv * (d.B / 2 - wallW / 2));
    sink.box('dock', [cc[0], cc[1], z0 + pontoonH + wallH / 2], [d.L, wallW, wallH], d.angle);
    // кран на башне
    const cr = P(-d.L * 0.15 * sv, sv * (d.B / 2 - wallW / 2));
    sink.box('crane_yellow', [cr[0], cr[1], z0 + pontoonH + wallH + 3], [3, 2.6, 6], d.angle);
    const tip = P(-d.L * 0.15 * sv + 10, sv * (d.B / 2 - wallW / 2 - 8));
    sink.beam('crane_yellow', [cr[0], cr[1], z0 + pontoonH + wallH + 5.5], [tip[0], tip[1], z0 + pontoonH + wallH + 12], 0.6, 0.6);
    // леера
    const a = P(-d.L / 2, sv * (d.B / 2 - 0.2));
    const b = P(d.L / 2, sv * (d.B / 2 - 0.2));
    sink.beam('steel_dark', [a[0], a[1], z0 + pontoonH + wallH + 1.1], [b[0], b[1], z0 + pontoonH + wallH + 1.1], 0.05, 0.05);
  }
  // кильблоки
  for (let u = -d.L / 2 + 8; u < d.L / 2 - 6; u += 6) {
    const p = P(u, 0);
    sink.box('keelblock', [p[0], p[1], z0 + pontoonH + 0.6], [1.2, 2.4, 1.2], d.angle);
  }
  return z0 + pontoonH + 1.2;
}

// Стапель: наклонная бетонная постель (голова приподнята над землёй), спусковые
// дорожки, подводная часть. Возвращает функцию высоты по расстоянию от головы.
export function slipProfile(sw) {
  const zHead = 5.5;
  const zBank = 0.4;
  const L = sw.length;
  return (u) => (u <= L ? zHead + ((zBank - zHead) * u) / L : zBank + ((-6 - zBank) * (u - L)) / sw.water);
}

export function slipPitch(sw) {
  return (Math.atan2(5.1, sw.length) * 180) / Math.PI;
}

export function buildSlipway(sink, sw) {
  const c = Math.cos(sw.angle * DEG);
  const s = Math.sin(sw.angle * DEG);
  const P = (u, v, z) => [sw.head[0] + c * u - s * v, sw.head[1] + s * u + c * v, z];
  const hw = sw.width / 2;
  const Lw = sw.length + sw.water;
  const zAt = slipProfile(sw);
  const us = [];
  for (let k = 0; k <= 10; k++) us.push((sw.length * k) / 10);
  us.push(Lw);
  for (let k = 0; k < us.length - 1; k++) {
    const u0 = us[k];
    const u1 = us[k + 1];
    sink.quad('slipway', P(u0, -hw, zAt(u0)), P(u1, -hw, zAt(u1)), P(u1, hw, zAt(u1)), P(u0, hw, zAt(u0)));
    sink.quad('quay_concrete', P(u1, hw, -3), P(u0, hw, -3), P(u0, hw, zAt(u0)), P(u1, hw, zAt(u1)));
    sink.quad('quay_concrete', P(u0, -hw, -3), P(u1, -hw, -3), P(u1, -hw, zAt(u1)), P(u0, -hw, zAt(u0)));
    // спусковые дорожки
    for (const v of [-7, 7]) sink.beam('keelblock', P(u0, v, zAt(u0) + 0.2), P(u1, v, zAt(u1) + 0.2), 1.6, 0.4);
  }
  // торцевая стенка головы стапеля
  sink.quad('quay_concrete', P(0, hw, -0.5), P(0, -hw, -0.5), P(0, -hw, zAt(0)), P(0, hw, zAt(0)));
  // ограждение по бровке
  for (const v of [-hw + 0.2, hw - 0.2]) {
    for (let k = 0; k < 10; k++) {
      const u0 = us[k];
      const u1 = us[k + 1];
      sink.beam('crane_yellow', P(u0, v, zAt(u0) + 1.1), P(u1, v, zAt(u1) + 1.1), 0.06, 0.06);
      sink.beam('steel_dark', P(u0, v, zAt(u0) + 0.55), P(u0, v, zAt(u0) + 1.1), 0.06, 0.06);
    }
  }
  return { zAt, P };
}
