// Время суток: положение солнца над верфью и освещение сцены.
// Солнце — по упрощённым формулам NOAA (точность — доли градуса, для освещения достаточно).

const LAT = 59.926;
const LON = 30.27;
const TZ = 3; // московское время, без перехода на летнее
const DEG = Math.PI / 180;

// Высота и азимут солнца (°): азимут — от севера по часовой стрелке. hours — местное время.
export function sunPosition(date, hours) {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hours - TZ - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hours * 60 + eqtime + 4 * LON - 60 * TZ;
  const ha = (tst / 4 - 180) * DEG;
  const lat = LAT * DEG;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const el = 90 - zen / DEG;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zen))))) / DEG;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { el, az };
}

// Восход и заход (часы местного времени) — первый и последний момент, когда солнце выше горизонта.
export function sunTimes(date) {
  let rise = null;
  let set = null;
  for (let m = 0; m <= 24 * 60; m += 2) {
    const up = sunPosition(date, m / 60).el > -0.83;
    if (up && rise === null) rise = m / 60;
    if (up) set = m / 60;
  }
  return { rise, set };
}

export const hhmm = (h) => {
  const m = Math.round(h * 60) % (24 * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Ключевые состояния неба по высоте солнца: ночь, сумерки, низкое солнце, день.
// Небо — четыре цвета градиента сверху вниз (0, 0,55, 0,82, 1).
const KEYS = [
  { el: -12, sky: ['#08101d', '#121d33', '#1c2840', '#26324a'], hemi: [0x50628a, 0x1e1f26, 0.42], water: 0x162636, env: 0.22, exposure: 1.25 },
  { el: -2, sky: ['#1b2a44', '#3d4a6a', '#b8826b', '#e0a77d'], hemi: [0x9fb0d0, 0x5a4a44, 0.85], water: 0x2e4a60, env: 0.6, exposure: 1.15 },
  { el: 8, sky: ['#5f88b5', '#a8c0d4', '#e3c8a8', '#efd8bd'], hemi: [0xc9d6e6, 0x665a4e, 1.0], water: 0x3a576b, env: 0.75, exposure: 1.05 },
  { el: 25, sky: ['#8fb4d6', '#c9dbe8', '#dde7ef', '#e6edf2'], hemi: [0xdfe9f3, 0x6b6558, 1.15], water: 0x3e5d70, env: 0.8, exposure: 1.0 },
];

// Состояние освещения для высоты солнца el: цвета неба, полусферы, воды, яркость окон, солнца.
export function lightingFor(THREE, el) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(a.el, b.el, el);
  const col = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  return {
    sky: a.sky.map((c, k) => '#' + col(c, b.sky[k]).getHexString()),
    hemiSky: col(a.hemi[0], b.hemi[0]),
    hemiGround: col(a.hemi[1], b.hemi[1]),
    hemiIntensity: a.hemi[2] + (b.hemi[2] - a.hemi[2]) * t,
    water: col(a.water, b.water),
    envIntensity: a.env + (b.env - a.env) * t,
    exposure: a.exposure + (b.exposure - a.exposure) * t,
    // солнце: гаснет у горизонта, низкое — тёплое
    sunIntensity: 2.6 * smooth(-1.5, 18, el),
    sunColor: new THREE.Color(0xffa766).lerp(new THREE.Color(0xfff3e0), smooth(2, 28, el)),
    // окна зажигаются в сумерках
    windows: 1.6 * (1 - smooth(-4, 4, el)),
    evening: el < 6,
  };
}
