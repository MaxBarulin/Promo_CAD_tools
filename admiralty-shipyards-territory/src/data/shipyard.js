// Территория АО «Адмиралтейские верфи» по карте предприятия.
//
// Контуры участков и всех 200 построек сняты с карты (tools/trace_map.py → map-trace.js)
// и переведены в метры (mapdata.js). Здесь — назначение и параметры зданий,
// стапели, краны, суда, мосты, проезды, ворота.
//
// Участки (с юга на север):
//   • Галерный остров (≈11 га) — в устье Фонтанки; после засыпки левого рукава Фонтанки
//     примыкает к левому берегу (Рижский пр.);
//   • основная площадка (≈25 га) — между Фонтанкой, Невой, Пряжкой и Лоцманской ул.:
//     открытые стапели, ковш, главная проходная у пл. Репина, заводоуправление;
//   • Матисов остров (≈13 га с причалом и площадкой у устья Мойки) — цеха, ковш, длинный причал;
//   • Ново-Адмиралтейский остров (≈17,6 га) — эллинги, ориентированные торцом к Неве.
// Назначение отдельных зданий определено по размерам и положению и помечено как условное.

import { px, pxAngle, MAP_PIECES, MAP_BRIDGES, MAP_BUILDINGS_RAW, MAP_ROADS, GEOREF } from './mapdata.js';
import { rect, pointAt, perp, add, mul, sub, norm, dist, angleOf, dirOf, polylineLength, ensureCCW, area, pointInRing } from '../geo.js';

// ---------- вспомогательные построения ----------

export function besideLine(line, s, w, d, gap = 0) {
  const { p, dir } = pointAt(line, s);
  const n = perp(dir);
  const c = add(p, mul(n, gap + d / 2));
  return rect(c[0], c[1], w, d, angleOf(dir));
}

export function frameOnLine(line, s, offset = 0) {
  const { p, dir } = pointAt(line, s);
  return { p: add(p, mul(perp(dir), offset)), dir, angle: angleOf(dir), normal: perp(dir) };
}

// Прямоугольник OpenCV (minAreaRect) в пикселях → углы в метрах модели.
function boxFromRect([cx, cy, w, h, angle], grow = 1.1) {
  const a = (angle * Math.PI) / 180;
  const W = w + grow;
  const H = h + grow;
  const b = Math.cos(a) * 0.5;
  const s = Math.sin(a) * 0.5;
  const p0 = [cx - s * H - b * W, cy + b * H - s * W];
  const p1 = [cx + s * H - b * W, cy - b * H - s * W];
  const p2 = [2 * cx - p0[0], 2 * cy - p0[1]];
  const p3 = [2 * cx - p1[0], 2 * cy - p1[1]];
  return ensureCCW([p0, p1, p2, p3].map(([x, y]) => px(x, y)));
}

// ---------- участки (зоны) ----------

const pieceIdx = (cx) => MAP_PIECES.findIndex((p) => Math.abs(p.cxPx - cx) < 60);
export const PIECE_INFO = [
  { cx: 201, id: 'galerny', name: 'Галерный остров', label: px(185, 230) },
  { cx: 495, id: 'kolomna', name: 'Основная площадка', label: px(560, 420) },
  { cx: 896, id: 'matisov', name: 'Матисов остров', label: px(830, 380) },
  { cx: 1389, id: 'novo', name: 'Ново-Адмиралтейский остров', label: px(1330, 330) },
];

export const ZONES = [
  ...PIECE_INFO.map((z) => ({ id: z.id, name: z.name, kind: 'shipyard', label: z.label, polygon: MAP_PIECES[pieceIdx(z.cx)].polygon })),
  {
    id: 'matisov-civil',
    name: 'Матисов остров (жилая часть)',
    kind: 'civil',
    polygon: [px(740, 428), px(870, 488), px(1088, 383), px(1152, 300), px(1355, 494), px(1200, 503), px(1000, 513), px(762, 518), px(742, 498)],
  },
];

export const LAND_PIECES = MAP_PIECES.map((p) => p.polygon);

// ---------- здания ----------

// Подкрановые пути (узкие полосы вдоль причалов на карте) — не здания.
const RUNWAY_IDX = new Set([31, 40, 22, 34, 4]);
// Настил моста через протоку у устья Мойки — изображён на карте цветом зданий.
const DECK_IDX = new Set([81]);
// Стапели
const SLIP_IDX = { 8: 'S1', 9: 'S2' };

export const NAMED = {
  200: { name: 'Главная проходная', info: 'Главная проходная у площади Репина (адрес предприятия: наб. реки Фонтанки, 203).', type: 'checkpoint', h: 8, floors: 2, wall: 'light', sign: true },
  199: { name: 'Павильон главной проходной', info: 'Крытый павильон у главной проходной.', type: 'checkpoint', h: 4, floors: 1, wall: 'light' },
  182: { name: 'Заводоуправление', info: 'Протяжённый административный корпус вдоль Лоцманской улицы (≈190 м).', type: 'office', h: 19, floors: 5, wall: 'sand' },
  162: { name: 'Административный корпус', info: 'Корпус вдоль Лоцманской улицы.', type: 'office', h: 15, floors: 4, wall: 'cream' },
  156: { name: 'КПП-2 (Лоцманская ул.)', info: 'Контрольно-пропускной пункт для автотранспорта.', type: 'checkpoint', h: 4, floors: 1, wall: 'light' },
  155: { name: 'Инженерный корпус', info: 'Инженерные службы и конструкторское бюро.', type: 'office', h: 15, floors: 4, wall: 'light' },
  129: { name: 'Корпусосборочный цех (предстапельная сборка)', info: 'Крупный цех у голов открытых стапелей: сборка секций и блоков корпуса перед подачей на стапель.', type: 'hall', h: 26, wall: 'blue' },
  14: { name: 'Корпусообрабатывающий цех', info: 'Обработка листового и профильного проката, изготовление деталей корпуса.', type: 'hall', h: 20, wall: 'blue_gray' },
  55: { name: 'Механосборочный цех', info: 'Механическая обработка и сборка узлов.', type: 'hall', h: 16, wall: 'light' },
  154: { name: 'Трубомедницкий цех', info: 'Изготовление трубопроводов судовых систем.', type: 'hall', h: 14, wall: 'panel' },
  23: { name: 'Цех достройки у ковша', info: 'Протяжённый корпус вдоль ковша основной площадки (≈260 м).', type: 'hall', h: 16, wall: 'blue_gray' },
  58: { name: 'Сборочно-сварочный цех', info: 'Сборка и сварка объёмных секций.', type: 'hall', h: 26, wall: 'light' },
  52: { name: 'Цех металлоконструкций', info: 'Изготовление насыщения и металлоконструкций.', type: 'hall', h: 20, wall: 'blue_gray' },
  3: { name: 'Главный корпус Галерного острова', info: 'Самое крупное здание предприятия по площади застройки (≈180×105 м).', type: 'hall', h: 28, wall: 'blue_gray' },
  5: { name: 'Протяжённый цех Галерного острова', info: 'Корпус ≈170×20 м.', type: 'hall', h: 16, wall: 'panel' },
  75: { name: 'Цех Матисова острова', info: 'Производственный корпус на Матисовом острове.', type: 'hall', h: 22, wall: 'light' },
  123: { name: 'Корпус у ковша Матисова острова', info: 'Производственный корпус вдоль ковша.', type: 'hall', h: 20, wall: 'blue_gray' },
  68: { name: 'Корпус у устья Мойки', info: 'Крупный цех на северо-западной оконечности Матисова острова у устья Мойки.', type: 'hall', h: 24, wall: 'blue' },
  126: { name: 'Крытый эллинг (бывш. завод «Судомех»)', info: 'Крупнейший эллинг Ново-Адмиралтейского острова; по составу мощностей — 5 крытых построечных мест 120×20 м для подводных лодок. Отнесение условное.', type: 'elling', h: 30, wall: 'blue_gray' },
  136: { name: 'Большой каменный эллинг', info: 'По размерам и положению соответствует Большому каменному эллингу (1890–1893 гг., инж. С. Н. Будзынский, Н. П. Дуткин, Н. Д. Куторга; 132×28 м между стенами). Ориентирован торцом к Неве. Отнесение условное.', type: 'elling', h: 20, roofH: 11, wall: 'brick', lantern: true },
  153: { name: 'Малый каменный эллинг (эллинг № 1)', info: 'По размерам соответствует Малому каменному эллингу 1833–1838 гг. — одному из старейших сохранившихся эллингов России. Отнесение условное.', type: 'elling_historic', h: 16, roofH: 9, wall: 'ochre', roof: 'r_green' },
  171: { name: 'Крытый эллинг', info: 'Эллинг, ориентированный торцом к Неве.', type: 'elling', h: 20, wall: 'light' },
  177: { name: 'Крытый эллинг', info: 'Эллинг, ориентированный торцом к Неве.', type: 'elling', h: 18, wall: 'light' },
  103: { name: 'Эллинг-цех', info: 'Корпус, ориентированный торцом к Неве.', type: 'elling', h: 22, wall: 'blue_gray' },
  47: { name: 'Эллинг-цех', info: 'Корпус, ориентированный торцом к Неве.', type: 'elling', h: 24, wall: 'light' },
  82: { name: 'Цех Нового Адмиралтейства', info: 'Производственный корпус.', type: 'hall', h: 20, wall: 'blue_gray' },
  76: { name: 'Цех Нового Адмиралтейства', info: 'Производственный корпус.', type: 'hall', h: 20, wall: 'panel' },
  160: { name: 'Протяжённый корпус вдоль Мойки', info: 'Корпус ≈200×27 м вдоль южного берега Ново-Адмиралтейского острова.', type: 'hall', h: 14, wall: 'brick_dark' },
  187: { name: 'КПП Нового Адмиралтейства', info: 'Контрольно-пропускной пункт у ворот на набережную Ново-Адмиралтейского канала (выступ ограды на карте). Отнесение условное.', type: 'checkpoint', h: 5, floors: 1, wall: 'light' },
  161: { name: 'Служебное здание у часовни', info: 'Небольшое здание у северной оконечности Ново-Адмиралтейского острова, рядом с часовней на месте храма Спаса-на-Водах. Назначение не установлено (исторический Караульный дом стоит у Адмиралтейского моста — см. план КГИОП).', type: 'historic', h: 9, floors: 2, wall: 'yellow', roof: 'r_green', hip: true },
  32: { name: 'Административный корпус Нового Адмиралтейства', info: 'Административно-бытовой корпус у устья Мойки.', type: 'office', h: 15, floors: 4, wall: 'cream' },
  50: { name: 'Служебный корпус', info: 'Вспомогательный корпус вдоль Невы.', type: 'office', h: 11, floors: 3, wall: 'light' },
};

export const HALL_WALLS = ['blue_gray', 'light', 'panel', 'blue_gray', 'gray', 'blue', 'light', 'panel'];
export const OFFICE_WALLS = ['sand', 'cream', 'light', 'yellow'];
export const HALL_ROOFS = ['r_light', 'r_gray', 'r_light', 'r_blue'];

function classify(raw) {
  const named = NAMED[raw.index];
  const { area: A, len, wid } = raw;
  // прямоугольник — если контур почти совпадает с описанным прямоугольником (крупные
  // корпуса-параллелограммы остаются по контуру карты)
  const isRect = (raw.fill > 0.94 && raw.fill < 1.08) || (A < 800 && raw.fill > 0.85 && raw.fill < 1.08);
  const poly = isRect ? boxFromRect(raw.rectPx, A < 800 ? 0.4 : 1.1) : raw.poly;
  let type;
  let h;
  let floors;
  if (named) {
    type = named.type;
    h = named.h;
    floors = named.floors;
  } else if (A > 6000) {
    type = 'hall';
    h = 24;
  } else if (A > 2500) {
    type = 'hall';
    h = 18;
  } else if (A > 1200) {
    type = 'hall';
    h = 14;
  } else if (A > 450) {
    type = len / wid > 2.4 ? 'warehouse' : 'office';
    h = type === 'office' ? 12 : 9;
    floors = type === 'office' ? 3 : undefined;
  } else if (A > 150) {
    type = 'utility';
    h = 6.5;
  } else {
    type = 'utility';
    h = 4.5;
  }
  if (raw.zone === 'novo' && !named && type === 'hall' && len / wid > 2.2) type = 'elling';
  const wall = named?.wall || (type === 'office' ? OFFICE_WALLS[raw.index % OFFICE_WALLS.length] : type === 'utility' ? (raw.index % 3 ? 'light' : 'brick_dark') : HALL_WALLS[raw.index % HALL_WALLS.length]);
  const roofColor = named?.roof || (type === 'office' || type === 'utility' ? 'r_dark' : HALL_ROOFS[raw.index % HALL_ROOFS.length]);
  let roof = { type: 'flat', color: roofColor };
  if (isRect && (type === 'hall' || type === 'elling' || type === 'elling_historic' || type === 'warehouse')) {
    const [c0, c1, , c3] = poly;
    const along = dist(c0, c3) > dist(c0, c1) ? 'd' : 'w';
    const span = Math.min(dist(c0, c1), dist(c0, c3));
    const bays = type === 'hall' && span > 44 ? Math.max(2, Math.round(span / 30)) : 1;
    roof =
      bays > 1
        ? { type: 'multigable', bays, along, h: 4, color: roofColor, lantern: type === 'hall' }
        : { type: 'gable', h: named?.roofH ?? Math.max(2.5, Math.min(10, span * 0.18)), color: roofColor, lantern: named?.lantern || (type === 'hall' && span > 25) };
  } else if (named?.hip && isRect) {
    roof = { type: 'hip', h: 3, color: roofColor };
  }
  // двери: ворота в торцах цехов, входы в административных зданиях
  const doors = [];
  if (isRect) {
    const [c0, c1, , c3] = poly;
    const wEdge = dist(c0, c1);
    const dEdge = dist(c0, c3);
    const shortEdges = wEdge < dEdge ? [0, 2] : [1, 3];
    const longEdges = wEdge < dEdge ? [1, 3] : [0, 2];
    const span = Math.min(wEdge, dEdge);
    if (type === 'hall' || type === 'elling' || type === 'elling_historic' || type === 'warehouse') {
      const gw = Math.min(span * 0.45, type === 'elling' ? 22 : 12);
      const gh = Math.min(h - 2, type === 'elling' ? h * 0.8 : 9);
      for (const e of shortEdges) doors.push({ edge: e, t: 0.5, w: gw, h: gh, kind: 'gate' });
      doors.push({ edge: longEdges[0], t: 0.3, w: 2.2, h: 2.6 });
    } else if (type === 'office' || type === 'checkpoint' || type === 'historic') {
      doors.push({ edge: longEdges[0], t: 0.5, w: 3, h: 3, kind: 'main', canopy: 2.5 });
      doors.push({ edge: longEdges[1], t: 0.5, w: 2.2, h: 2.6 });
    } else {
      doors.push({ edge: shortEdges[0], t: 0.5, w: 2.4, h: 2.8, kind: 'gate' });
    }
  }
  return {
    kind: 'shipyard',
    id: `Z${raw.index}`,
    mapIndex: raw.index,
    zone: raw.zone === 'moika' ? 'matisov' : raw.zone,
    name: named?.name || defaultName(type, A),
    info: (named?.info ? named.info + ' ' : '') + `Контур — по карте предприятия (${Math.round(len)}×${Math.round(wid)} м).`,
    poly,
    h,
    floors,
    type,
    wall,
    roof,
    doors,
    sign: named?.sign ? { edge: 1, text: 'АДМИРАЛТЕЙСКИЕ ВЕРФИ' } : undefined,
    approx: !named || /условн/.test(named.info || ''),
  };
}

export function defaultName(type, A) {
  if (type === 'hall') return A > 6000 ? 'Производственный корпус' : 'Цех';
  if (type === 'elling') return 'Эллинг';
  if (type === 'warehouse') return 'Склад';
  if (type === 'office') return 'Административно-бытовой корпус';
  return 'Вспомогательное здание';
}

export const BUILDINGS = MAP_BUILDINGS_RAW.filter((b) => !RUNWAY_IDX.has(b.index) && !DECK_IDX.has(b.index) && !(b.index in SLIP_IDX) && b.area >= 25).map(classify);

// Подпись на вывеске главной проходной — сторона, обращённая к площади Репина (на восток).
for (const b of BUILDINGS) {
  if (!b.sign) continue;
  let best = 0;
  let bi = 0;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i];
    const c = b.poly[(i + 1) % b.poly.length];
    const d = norm(sub(c, a));
    const out = [d[1], -d[0]];
    const score = out[0] * 0.8 + out[1] * 0.6; // восток-северо-восток
    if (score > best) {
      best = score;
      bi = i;
    }
  }
  b.sign.edge = bi;
}

// Три стальные трубы котельной завода «Судомех» (Z173, лит. ЕЧ) на берегу Мойки — по фото
// с противоположной набережной (citywalls.ru): самая высокая стоит перед фасадом, у внутреннего
// угла корпуса; две другие поднимаются над кровлей. Высоты оценены по трёхэтажной части корпуса.
const BOILER_INFO = 'Стальная дымовая труба на растяжках котельной завода «Судомех» (корпус Z173). Высота оценена по фото.';
export const CHIMNEYS = [
  { id: 'CH1', name: 'Дымовая труба котельной «Судомеха»', info: BOILER_INFO, style: 'steel', at: [97.7, 1297.9], h: 36, r: 0.85, guys: [[88.5, 1300], [100, 1308], [109, 1312.5]], guyZ: 12 },
  { id: 'CH2', name: 'Дымовая труба котельной «Судомеха»', info: BOILER_INFO, style: 'steel', at: [99.5, 1305.5], h: 32, r: 0.8, guys: [[88.5, 1300], [100, 1318], [92, 1310]], guyZ: 12 },
  { id: 'CH3', name: 'Дымовая труба котельной «Судомеха»', info: BOILER_INFO, style: 'steel', at: [107.5, 1311], h: 31, r: 0.65, platform: true, guys: [[100, 1318], [115, 1318], [100, 1308]], guyZ: 12 },
];

// ---------- стапели ----------

function slipFromRaw(idx, id, name) {
  const r = MAP_BUILDINGS_RAW.find((b) => b.index === idx);
  const [cx, cy, w, h, a] = r.rectPx;
  // ось — длинная сторона; голова — нижний (восточный) конец, вода — верхний
  const ang = (a * Math.PI) / 180;
  const ax = w >= h ? [Math.cos(ang), Math.sin(ang)] : [-Math.sin(ang), Math.cos(ang)];
  const L = Math.max(w, h);
  let e1 = [cx + (ax[0] * L) / 2, cy + (ax[1] * L) / 2];
  let e2 = [cx - (ax[0] * L) / 2, cy - (ax[1] * L) / 2];
  if (e1[1] < e2[1]) [e1, e2] = [e2, e1];
  const head = px(...e1);
  const end = px(...e2);
  return {
    id,
    name,
    info: `Открытый наклонный стапель: по карте ${Math.round(dist(head, end))}×${Math.round(Math.min(w, h) * GEOREF.scale)} м (паспорт — 259×35 м, суда дедвейтом до 70 000 т). Спуск — в Большую Неву.`,
    head,
    angle: angleOf(sub(end, head)),
    length: dist(head, end),
    water: 45,
    width: 35,
  };
}

export const SLIPWAYS = [slipFromRaw(8, 'S1', 'Открытый наклонный стапель № 1'), slipFromRaw(9, 'S2', 'Открытый наклонный стапель № 2')];

// ---------- подкрановые пути и краны ----------

function runwayLine(idx) {
  const r = MAP_BUILDINGS_RAW.find((b) => b.index === idx);
  const [cx, cy, w, h, a] = r.rectPx;
  const ang = (a * Math.PI) / 180;
  const ax = w >= h ? [Math.cos(ang), Math.sin(ang)] : [-Math.sin(ang), Math.cos(ang)];
  const L = Math.max(w, h) / 2;
  return [px(cx - ax[0] * L, cy - ax[1] * L), px(cx + ax[0] * L, cy + ax[1] * L)];
}

const RW = { galerny: runwayLine(31), matisov: runwayLine(40), pier: runwayLine(22), novo: runwayLine(34) };
const slipTrack = (sw, off, t0, t1) => {
  const d = dirOf(sw.angle);
  const n = perp(d);
  return [add(add(sw.head, mul(d, t0)), mul(n, off)), add(add(sw.head, mul(d, t1)), mul(n, off))];
};
// путь между стапелями и с внешней стороны стапеля № 1
const S1 = SLIPWAYS[0];
const S2 = SLIPWAYS[1];
const midOff = (() => {
  const d = dirOf(S1.angle);
  const n = perp(d);
  const v = sub(S2.head, S1.head);
  return (v[0] * n[0] + v[1] * n[1]) / 2;
})();
const TRACK_MID = slipTrack(S1, midOff, 10, S1.length - 10);
const TRACK_OUT = slipTrack(S1, -midOff, 10, S1.length - 10);

export const RAILS = [
  { id: 'T1', name: 'Подкрановый путь между стапелями', gauge: 7, line: TRACK_MID },
  { id: 'T2', name: 'Подкрановый путь стапеля № 1', gauge: 7, line: TRACK_OUT },
  { id: 'T3', name: 'Подкрановый путь достроечной набережной основной площадки', gauge: 10.5, line: RW.galerny },
  { id: 'T4', name: 'Подкрановый путь набережной Матисова острова', gauge: 10.5, line: RW.matisov },
  { id: 'T5', name: 'Подкрановый путь причала у устья Мойки', gauge: 10.5, line: RW.pier },
  { id: 'T6', name: 'Подкрановый путь Нового Адмиралтейства', gauge: 10.5, line: RW.novo },
];

const onTrack = (line, t) => {
  const L = polylineLength(line);
  return pointAt(line, L * t).p;
};
const trackAng = (line) => angleOf(sub(line[1], line[0]));
const toRiver = (line) => {
  // направление поперёк пути в сторону Невы (на запад/северо-запад)
  const d = norm(sub(line[1], line[0]));
  const n = perp(d);
  return angleOf(n[0] < 0 ? n : mul(n, -1));
};

export const CRANES = [
  { id: 'C1', type: 'tower', name: 'Стапельный кран (путь между стапелями)', at: onTrack(TRACK_MID, 0.25), track: trackAng(TRACK_MID), slew: S1.angle + 70, h: 50, jib: 40 },
  { id: 'C2', type: 'tower', name: 'Стапельный кран (путь между стапелями)', at: onTrack(TRACK_MID, 0.62), track: trackAng(TRACK_MID), slew: S1.angle - 110, h: 50, jib: 40 },
  { id: 'C3', type: 'tower', name: 'Стапельный кран стапеля № 1', at: onTrack(TRACK_OUT, 0.45), track: trackAng(TRACK_OUT), slew: S1.angle - 75, h: 46, jib: 36 },
  { id: 'C4', type: 'portal', name: 'Портальный кран достроечной набережной', at: onTrack(RW.galerny, 0.3), track: trackAng(RW.galerny), slew: toRiver(RW.galerny) + 20, h: 34, jib: 32 },
  { id: 'C5', type: 'portal', name: 'Портальный кран достроечной набережной', at: onTrack(RW.galerny, 0.75), track: trackAng(RW.galerny), slew: toRiver(RW.galerny) - 25, h: 34, jib: 32 },
  { id: 'C6', type: 'portal', name: 'Портальный кран (Матисов остров)', at: onTrack(RW.matisov, 0.35), track: trackAng(RW.matisov), slew: toRiver(RW.matisov) + 10, h: 36, jib: 34 },
  { id: 'C7', type: 'portal', name: 'Портальный кран (Матисов остров)', at: onTrack(RW.matisov, 0.8), track: trackAng(RW.matisov), slew: toRiver(RW.matisov) - 30, h: 36, jib: 34 },
  { id: 'C8', type: 'portal', name: 'Портальный кран причала у устья Мойки', at: onTrack(RW.pier, 0.3), track: trackAng(RW.pier), slew: toRiver(RW.pier) + 15, h: 36, jib: 34 },
  { id: 'C9', type: 'portal', name: 'Портальный кран причала у устья Мойки', at: onTrack(RW.pier, 0.72), track: trackAng(RW.pier), slew: toRiver(RW.pier) - 15, h: 36, jib: 34 },
  { id: 'C10', type: 'portal', name: 'Портальный кран (Новое Адмиралтейство)', at: onTrack(RW.novo, 0.5), track: trackAng(RW.novo), slew: toRiver(RW.novo), h: 32, jib: 30 },
];

// ---------- суда и плавдоки ----------

const slipShip = (sw, tFromHead, L) => ({ at: add(sw.head, mul(dirOf(sw.angle), tFromHead + L / 2)), angle: sw.angle + 180 });

// Берег Ново-Адмиралтейского острова (северо-западный) — для дока и подлодки
const NOVO_SHORE = [px(1290, 222), px(1420, 268), px(1500, 328)];
const novoOut = (() => {
  const d = norm(sub(NOVO_SHORE[2], NOVO_SHORE[0]));
  const n = perp(d);
  return n[0] < 0 ? n : mul(n, -1); // наружу — к Неве (северо-запад)
})();
const DOCK_LUGA_AT = add(px(1400, 258), mul(novoOut, 58));
const PIER_OUT = (() => {
  const d = norm(sub(RW.pier[1], RW.pier[0]));
  const n = perp(d);
  return n[0] < 0 ? n : mul(n, -1);
})();
const GAL_OUT = (() => {
  const d = norm(sub(RW.galerny[1], RW.galerny[0]));
  const n = perp(d);
  return n[0] < 0 ? n : mul(n, -1);
})();

export const SHIPS = [
  { id: 'V1', name: 'Корпус танкера ледового класса на стапеле № 1', info: 'Условный заказ на стадии формирования корпуса (≈180×30 м).', hull: 'tanker', L: 180, B: 30, D: 17, onSlip: 'S1', ...slipShip(S1, 35, 180), stage: 'hull' },
  { id: 'V2', name: 'Траулер на стапеле № 2', info: 'Условный заказ: большой морозильный траулер (≈105×21 м) перед спуском на воду.', hull: 'trawler', L: 105, B: 21, D: 12, onSlip: 'S2', ...slipShip(S2, 90, 105), stage: 'complete' },
  { id: 'V3', name: 'Ледокол у причала у устья Мойки', info: 'Условный заказ на достройке у глубоководного причала.', hull: 'icebreaker', L: 120, B: 26, D: 13, T: 7, at: add(onTrack(RW.pier, 0.5), mul(PIER_OUT, 30)), angle: trackAng(RW.pier), afloat: true, stage: 'complete' },
  { id: 'V4', name: 'Траулер в ковше основной площадки', info: 'Условный заказ на достройке в ковше.', hull: 'trawler', L: 80, B: 15, D: 10, T: 5, at: px(520, 300), angle: pxAngle(0, -1), afloat: true, stage: 'complete' },
  { id: 'V5', name: 'Подводная лодка на плавдоке «Луга»', info: 'Дизель-электрическая ПЛ пр. 636.3 (74×9,9 м) после вывода из эллинга.', hull: 'submarine', L: 74, B: 9.9, onDock: 'D1', at: DOCK_LUGA_AT, angle: angleOf(novoOut) },
  { id: 'V6', name: 'Подводная лодка у достроечной набережной', info: 'ДЭПЛ пр. 636.3 на швартовных испытаниях.', hull: 'submarine', L: 74, B: 9.9, T: 6.2, at: add(px(1230, 214), mul(novoOut, 12)), angle: angleOf(sub(px(1290, 222), px(1150, 218))), afloat: true },
];

export const DOCKS = [
  { id: 'D1', name: 'Плавучий док «Луга»', info: '92×27 м, грузоподъёмность 6000 т. Используется для спуска подводных лодок из эллингов.', at: DOCK_LUGA_AT, angle: angleOf(novoOut), L: 92, B: 27 },
  { id: 'D2', name: 'Плавучий док СПД-2М', info: '92×22 м, грузоподъёмность 2000 т.', at: add(onTrack(RW.galerny, 0.5), mul(GAL_OUT, 26)), angle: trackAng(RW.galerny), L: 92, B: 22 },
];

// ---------- мосты ----------

export const BRIDGES = [
  ...MAP_BRIDGES.map((b) => ({ id: b.id, name: b.name, info: 'Внутризаводской мост (по карте предприятия).', type: b.id === 'MB4' ? 'industrial' : 'industrial', from: b.from, to: b.to, w: Math.max(8, b.w) })),
];

// ---------- проезды ----------
// Трассы проложены автоматически по свободным от зданий полосам карты (tools/trace_map.py).

const L = (...pts) => pts.map(([x, y]) => px(x, y));
export const INTERNAL_ROADS = MAP_ROADS.map((r) => ({ id: r.id, name: r.name, w: r.w, line: r.line.map(([x, y]) => px(x, y)) }));

// ---------- ворота (вырезаются в автоматически построенной ограде) ----------

// Ворота из OpenStreetMap, которых на месте нет (проверено на месте): в ограде не вырезаются.
export const NO_GATES = [
  { at: [-222, 217], note: 'разрыв между Z162 и Yb16555 на Лоцманской ул.: ворот нет' },
];

export const GATES = [
  { name: 'Главная проходная (автотранспортные ворота)', at: px(516, 572), w: 8 },
  { name: 'Ворота Матисова острова', at: px(815, 462), w: 8 },
  { name: 'Проходная Нового Адмиралтейства (наб. Ново-Адмиралтейского канала)', at: px(1500, 503), w: 10 },
  { name: 'Ворота Галерного острова (Рижский пр.)', at: px(180, 281), w: 8 },
];

// Явные участки ограды (дополнительно к автоматической) — нет.
export const FENCES = [];

// ---------- площадки ----------

export const AREAS = [
  { id: 'A2', kind: 'apron', name: 'Площадка сборки секций у стапеля № 1', polygon: L([389, 130], [389, 188], [407, 188], [407, 130]) },
];

// Контейнеры (бытовки, склады) на открытых площадках
// Ближайшее к точке карты свободное место: не ближе need м к зданиям и проездам, внутри участка.
function freeSpot([x0, y0], need) {
  const blds = MAP_BUILDINGS_RAW.map((b) => b.poly);
  const roads = INTERNAL_ROADS.map((r) => ({ line: r.line, half: r.w / 2 }));
  const pieces = MAP_PIECES.map((p) => p.polygon);
  const segDist = (p, a, c) => {
    const ab = sub(c, a);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1] || 1)));
    return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
  };
  const ringDist = (p, r) => Math.min(...r.map((a, i) => segDist(p, a, r[(i + 1) % r.length])));
  const ok = (p) =>
    pieces.some((r) => pointInRing(p, r) && ringDist(p, r) >= need) &&
    blds.every((r) => !pointInRing(p, r) && ringDist(p, r) >= need) &&
    roads.every((r) => r.line.every((a, i) => i === 0 || segDist(p, r.line[i - 1], a) >= need + r.half));
  for (let rad = 0; rad <= 40; rad += 1.5) {
    for (let k = 0; k < Math.max(1, rad * 2); k++) {
      const a = (k / Math.max(1, rad * 2)) * Math.PI * 2;
      const p = px(x0 + Math.cos(a) * rad, y0 + Math.sin(a) * rad);
      if (ok(p)) return p;
    }
  }
  return null;
}

// Контейнеры (бытовки, склады) на открытых площадках
export const CONTAINERS = [
  { id: 'K1', at: freeSpot([150, 262], 9), angle: pxAngle(1, 0) - 90, n: 10, seed: 7 },
  { id: 'K2', at: freeSpot([1095, 262], 8), angle: pxAngle(1, 0) - 90, n: 8, seed: 8 },
  { id: 'K3', at: freeSpot([620, 400], 9), angle: pxAngle(1, 0), n: 6, seed: 9 },
].filter((c) => c.at);

// ---------- подписи ----------

export const LABELS = PIECE_INFO.map((z) => ({ text: z.name, at: z.label, kind: 'island' }));

export const SHIPYARD_META = {
  name: 'АО «Адмиралтейские верфи»',
  address: '190121, Санкт-Петербург, наб. реки Фонтанки, 203',
  area: '≈ 67 га',
};

export { area };
