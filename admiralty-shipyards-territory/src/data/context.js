// Прилегающая городская застройка: Коломна (Лоцманская ул., пл. Репина, наб. Пряжки и Мойки),
// жилая часть Матисова острова, Новая Голландия и Английская наб., южный берег Фонтанки
// (Калинкина пл., Рижский и Старо-Петергофский пр.), Васильевский остров
// (наб. Лейтенанта Шмидта, Горный университет, Балтийский завод).
// Улицы привязаны к ограде верфи по карте предприятия; рядовые дома генерируются
// вдоль улиц (model/frontage.js). Координаты — метры модели.

import { rect, offsetPolyline, pointAt, perp, add, sub, mul, norm, dist } from '../geo.js';
import { px, MAP_PIECES } from './mapdata.js';
import { besideLine } from './shipyard.js';
import { NEVA_RIGHT_BANK } from './water.js';

// Лоцманская ул. идёт вдоль ограды основной площадки от пл. Репина до Пряжки: ось улицы
// проводится параллельно линии ограды так, чтобы тротуар не заходил на территорию.
function streetAlong(ring, A, B, clearance, { trimStart = 0, trimEnd = 0 } = {}) {
  const d = norm(sub(B, A));
  const n = [d[1], -d[0]];
  const L = dist(A, B);
  let off = -Infinity;
  for (const v of ring) {
    const t = (v[0] - A[0]) * d[0] + (v[1] - A[1]) * d[1];
    if (t < trimStart - 5 || t > L - trimEnd + 5) continue;
    off = Math.max(off, (v[0] - A[0]) * n[0] + (v[1] - A[1]) * n[1]);
  }
  const k = off + clearance;
  return [add(A, mul(n, k)), add(B, mul(n, k))];
}
function intersect([a, b], [c, e]) {
  const r = sub(b, a);
  const q = sub(e, c);
  const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / (r[0] * q[1] - r[1] * q[0]);
  return add(a, mul(r, t));
}
const GALERNY_RING = MAP_PIECES.find((p) => Math.abs(p.cxPx - 495) < 60).polygon;
const LOTS_1 = streetAlong(GALERNY_RING, px(530, 582), px(640, 392), 10, { trimEnd: 35 });
const LOTS_2 = streetAlong(GALERNY_RING, px(640, 392), px(728, 418), 10, { trimStart: 35 });
const LOTSMANSKAYA = [LOTS_1[0], intersect(LOTS_1, LOTS_2), add(LOTS_2[1], mul(norm(sub(LOTS_2[1], LOTS_2[0])), -8))];
// наб. Лейтенанта Шмидта — в 14 м от правого берега Невы (Васильевский остров)
const SCHMIDTA = offsetPolyline(NEVA_RIGHT_BANK.slice(7, 12), 14);
// линии Васильевского острова — перпендикулярно набережной, вглубь острова
function lineFromSchmidta(s) {
  const { p, dir } = pointAt(SCHMIDTA, s);
  const n = perp(dir);
  return [add(p, mul(n, 7)), add(p, mul(n, 400))];
}

export const STREETS = [
  { id: 'lotsmanskaya', name: 'Лоцманская ул.', w: 10, line: LOTSMANSKAYA, frontage: 'right' },
  { id: 'pryazhka-emb', name: 'наб. реки Пряжки', w: 9, line: [[-256, 270], [-150, 262], [-88, 296], [-50, 671], [-27, 973], [-14, 1150]], frontage: 'right' },
  { id: 'sadovaya', name: 'Садовая ул.', w: 16, line: [[40, -20], [250, 160], [470, 350]], frontage: 'both' },
  { id: 'rimskogo', name: 'пр. Римского-Корсакова', w: 14, line: [[70, -60], [470, 75]], frontage: 'both' },
  { id: 'fontanka-n', name: 'наб. реки Фонтанки', w: 9, line: [[45, -112], [220, -66], [470, 8]], frontage: 'left' },
  { id: 'pechatnikov', name: 'ул. Союза Печатников', w: 12, line: [[-160, 72], [470, 250]], frontage: 'both' },
  { id: 'dekabristov', name: 'ул. Декабристов', w: 14, line: [[-52, 520], [470, 690]], frontage: 'both' },
  { id: 'pisareva', name: 'ул. Писарева', w: 10, line: [[150, 120], [95, 600], [80, 1300]], frontage: 'both' },
  { id: 'masterskaya', name: 'Мастерская ул.', w: 10, line: [[330, 270], [300, 760], [285, 1330]], frontage: 'both' },
  { id: 'lane-1', name: 'внутриквартальный проезд', w: 7, line: [[-80, 320], [470, 470]], frontage: 'both' },
  { id: 'lane-2', name: 'внутриквартальный проезд', w: 7, line: [[-40, 860], [470, 1010]], frontage: 'both' },
  { id: 'moika-emb', name: 'наб. реки Мойки', w: 9, line: [[-282, 950], [-30, 1158], [95, 1270], [300, 1318], [470, 1326]], frontage: 'right' },
  { id: 'kanal-emb', name: 'наб. Ново-Адмиралтейского канала', w: 7, line: [[78, 1405], [-46, 1572]], frontage: 'none' },
  { id: 'galernaya', name: 'Галерная ул.', w: 10, line: [[5, 1502], [470, 1653]], frontage: 'both' },
  { id: 'english-emb', name: 'Английская наб.', w: 14, line: [[-48, 1572], [470, 1740]], frontage: 'right' },
  { id: 'fontanka-s', name: 'наб. реки Фонтанки', w: 9, line: [[-150, -258], [40, -205], [220, -146], [470, -70]], frontage: 'right' },
  { id: 'peterhofsky', name: 'Старо-Петергофский пр.', w: 18, line: [[38, -205], [25, -860]], frontage: 'both' },
  { id: 'rizhsky', name: 'Рижский пр.', w: 14, line: [[30, -235], [-200, -330], [-405, -492], [-605, -628], [-840, -705]], frontage: 'right' },
  { id: 'lane-3', name: 'внутриквартальный проезд', w: 8, line: [[-300, -560], [-150, -860]], frontage: 'both' },
  { id: 'schmidta', name: 'наб. Лейтенанта Шмидта', w: 14, line: SCHMIDTA, frontage: 'left' },
  { id: 'line-21', name: '21-я и 22-я линии В. О.', w: 10, line: lineFromSchmidta(330), frontage: 'both' },
  { id: 'line-17', name: '16-я и 17-я линии В. О.', w: 10, line: lineFromSchmidta(640), frontage: 'both' },
  { id: 'kosaya', name: 'Косая линия', w: 12, line: [[-1000, 1300], [-1180, 1000], [-1330, 650]], frontage: 'left' },
  { id: 'matisov-local', name: 'проезд Матисова острова', w: 7, line: [[-128, 500], [-140, 620], [-160, 800], [-100, 1000], [-60, 1140]], frontage: 'both', kind: 'local' },
];

export const CITY_AREAS = [
  { id: 'repina-sq', kind: 'square', name: 'Площадь Репина', polygon: [[-26, -112], [62, -98], [52, -26], [-30, -30]] },
  { id: 'repina-garden', kind: 'garden', name: 'Сад на площади Репина', polygon: rect(15, -66, 46, 40, 10) },
  { id: 'kalinkina-sq', kind: 'square', name: 'Калинкина площадь', polygon: [[0, -260], [80, -240], [75, -205], [5, -222]] },
  { id: 'parking-lots', kind: 'parking', name: 'Парковка у главной проходной', polygon: [[-58, -12], [-50, -2], [-140, 70], [-148, 60]] },
  { id: 'nh-basin', kind: 'pond', name: 'Внутренний бассейн Новой Голландии', polygon: rect(372, 1430, 110, 26, 12) },
  { id: 'nh-park', kind: 'garden', name: 'Сквер Новой Голландии', polygon: [[200, 1397], [255, 1399], [262, 1412], [226, 1418]] },
  { id: 'matisov-yard', kind: 'garden', name: 'Сквер на Матисовом острове', polygon: [px(960, 500), px(1010, 488), px(1015, 505), px(965, 512)] },
  { id: 'baltic', kind: 'industrial', name: 'Балтийский завод', polygon: [[-1420, -600], [-1370, -600], [-1300, -100], [-1220, 400], [-1140, 800], [-1050, 1050], [-1420, 1050]] },
];

export const CONTEXT_BUILDINGS = [
  {
    kind: 'context',
    id: 'K1',
    name: 'Медицинский центр «Адмиралтейские верфи»',
    info: 'Садовая ул., 126 — поликлиника предприятия у площади Репина. Положение условное.',
    poly: rect(5, 12, 50, 16, 37),
    h: 19,
    floors: 5,
    type: 'office',
    wall: 'light',
    roof: { type: 'flat', color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 3.5, h: 3, kind: 'main', canopy: 3 }],
    approx: true,
  },
  {
    kind: 'context',
    id: 'K2',
    name: 'Музей-квартира А. А. Блока',
    info: 'ул. Декабристов, 57 — дом на набережной Пряжки, где в 1912–1921 гг. жил поэт. Положение условное.',
    poly: rect(-42, 560, 40, 16, 84),
    h: 20,
    floors: 5,
    type: 'residential',
    wall: 'ochre',
    roof: { type: 'gable', h: 3.5, color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 1.8, h: 2.8, kind: 'main' }],
    approx: true,
  },
  {
    kind: 'context',
    id: 'K3',
    name: 'Больница Святого Николая Чудотворца',
    info: 'наб. реки Мойки, 126 — комплекс XIX в. у слияния Мойки и Пряжки. Положение условное.',
    poly: rect(40, 1190, 70, 16, 40),
    h: 15,
    floors: 3,
    type: 'historic',
    wall: 'yellow',
    roof: { type: 'hip', h: 3.5, color: 'r_green' },
    doors: [{ edge: 2, t: 0.5, w: 2.4, h: 3.2, kind: 'main' }],
    approx: true,
  },
  {
    kind: 'context',
    id: 'K3a',
    name: 'Больница Святого Николая Чудотворца (корпус)',
    info: 'Корпус больничного комплекса.',
    poly: rect(40, 1115, 16, 80, -50),
    h: 15,
    floors: 3,
    type: 'historic',
    wall: 'cream',
    roof: { type: 'hip', h: 3.5, color: 'r_green' },
  },
  // Новая Голландия
  {
    kind: 'context',
    id: 'NH1',
    name: 'Новая Голландия — склады вдоль Мойки',
    info: 'Остров-склад корабельного леса (XVIII в.), ныне общественное пространство.',
    poly: rect(365, 1394, 190, 22, 3.5),
    h: 20,
    floors: 4,
    type: 'warehouse_historic',
    wall: 'brick',
    roof: { type: 'hip', h: 4, color: 'r_dark' },
  },
  {
    kind: 'context',
    id: 'NH1c',
    name: 'Новая Голландия — склад у арки',
    info: 'Кирпичный склад XVIII в.',
    poly: rect(220, 1384, 40, 22, 3.8),
    h: 20,
    floors: 4,
    type: 'warehouse_historic',
    wall: 'brick',
    roof: { type: 'hip', h: 4, color: 'r_dark' },
  },
  {
    kind: 'context',
    id: 'NH2',
    name: 'Новая Голландия — склады вдоль Адмиралтейского канала',
    info: 'Кирпичные склады XVIII–XIX вв.',
    poly: rect(355, 1471, 200, 22, 29.9),
    h: 20,
    floors: 4,
    type: 'warehouse_historic',
    wall: 'brick',
    roof: { type: 'hip', h: 4, color: 'r_dark' },
  },
  // Васильевский остров
  {
    kind: 'context',
    id: 'GU',
    name: 'Санкт-Петербургский горный университет',
    info: 'наб. Лейтенанта Шмидта / 21-я линия В. О.; главное здание — арх. А. Н. Воронихин, 1806–1811, портик из 12 дорических колонн.',
    poly: besideLine(SCHMIDTA, 250, 110, 36, 12),
    h: 20,
    floors: 3,
    type: 'historic',
    wall: 'cream',
    roof: { type: 'hip', h: 4, color: 'r_gray' },
    portico: { edge: 0, columns: 12, depth: 6 },
    doors: [{ edge: 0, t: 0.5, w: 3, h: 4, kind: 'main' }],
  },
  {
    kind: 'context',
    id: 'BZ1',
    name: 'Балтийский завод — эллинг',
    info: 'АО «Балтийский завод» на Васильевском острове — напротив Адмиралтейских верфей.',
    poly: rect(-1300, 300, 180, 56, 80),
    h: 28,
    type: 'hall',
    wall: 'blue_gray',
    roof: { type: 'gable', h: 5, color: 'r_light' },
  },
  {
    kind: 'context',
    id: 'BZ2',
    name: 'Балтийский завод — цех',
    info: 'АО «Балтийский завод».',
    poly: rect(-1365, -60, 160, 46, 81),
    h: 20,
    type: 'hall',
    wall: 'light',
    roof: { type: 'gable', h: 4, color: 'r_gray' },
  },
  {
    kind: 'context',
    id: 'BZ3',
    name: 'Балтийский завод — цех',
    info: 'АО «Балтийский завод».',
    poly: rect(-1150, 900, 130, 50, 66),
    h: 22,
    type: 'hall',
    wall: 'blue',
    roof: { type: 'gable', h: 4, color: 'r_light' },
  },
  // Матисов остров — жилая часть
  {
    kind: 'context',
    id: 'MR1',
    name: 'Жилой дом (Матисов остров)',
    info: 'Жилая застройка восточной части Матисова острова.',
    poly: rect(-114, 465, 14, 80, 2),
    h: 17,
    floors: 5,
    type: 'residential',
    wall: 'ochre',
    roof: { type: 'gable', h: 3, color: 'r_gray', ridge: 'd' },
    doors: [{ edge: 1, t: 0.3, w: 1.6, h: 2.6 }, { edge: 1, t: 0.7, w: 1.6, h: 2.6 }],
  },
  {
    kind: 'context',
    id: 'MR2',
    name: 'Общежитие',
    info: 'Общежитие для студентов и прикомандированных специалистов.',
    poly: rect(-118, 760, 16, 54, 2),
    h: 28,
    floors: 9,
    type: 'residential',
    wall: 'panel',
    roof: { type: 'flat', color: 'r_bitumen' },
    doors: [{ edge: 1, t: 0.5, w: 2.4, h: 2.6, kind: 'main', canopy: 2 }],
  },
  {
    kind: 'context',
    id: 'MR3',
    name: 'Творческие мастерские',
    info: 'Бывший производственный корпус — мастерские художников.',
    poly: rect(-120, 610, 20, 60, 2),
    h: 12,
    floors: 3,
    type: 'historic',
    wall: 'brick',
    roof: { type: 'gable', h: 3, color: 'r_rust', ridge: 'd' },
    doors: [{ edge: 1, t: 0.5, w: 2.4, h: 2.8, kind: 'main' }],
  },
  {
    kind: 'context',
    id: 'MR4',
    name: 'Жилой дом (Матисов остров)',
    info: 'Жилая застройка восточной части Матисова острова.',
    poly: rect(-125, 1000, 16, 70, 2),
    h: 17,
    floors: 5,
    type: 'residential',
    wall: 'pink',
    roof: { type: 'gable', h: 3, color: 'r_gray', ridge: 'd' },
    doors: [{ edge: 1, t: 0.5, w: 1.6, h: 2.6 }],
  },
];

export const ARCH_NEW_HOLLAND = {
  id: 'NH-arch',
  name: 'Арка Новой Голландии',
  info: 'Арх. Ж.-Б. Валлен-Деламот, 1765–1780-е.',
  at: [252, 1386],
  angle: 3.7,
  w: 14,
  h: 23,
};

export const CONTEXT_SHIPS = [
  {
    id: 'KR',
    name: 'Ледокол «Красин» (музейное судно)',
    info: 'Ледокол 1917 г., ныне музей; стоит у наб. Лейтенанта Шмидта.',
    hull: 'icebreaker',
    L: 99.8,
    B: 21.6,
    D: 12,
    T: 6,
    at: [-600, 1618],
    angle: 38,
    afloat: true,
    stage: 'complete',
    hullColor: 'hull_black',
  },
];

export const CONTEXT_CRANES = [
  { id: 'BC1', type: 'portal', name: 'Портальный кран Балтийского завода', at: [-1170, 560], track: 75, slew: 350, h: 36, jib: 34 },
  { id: 'BC2', type: 'portal', name: 'Портальный кран Балтийского завода', at: [-1250, 130], track: 80, slew: 10, h: 36, jib: 34 },
];

export const CONTEXT_BRIDGES = [
  { id: 'B1', name: 'Старо-Калинкин мост', info: 'Каменный трёхпролётный мост через Фонтанку (1786–1788) с башнями-павильонами.', type: 'kalinkin', from: [27, -112], to: [36, -205], w: 24 },
  { id: 'B2', name: 'Матисов мост', info: 'Мост через Пряжку на Матисов остров. Положение условное.', type: 'beam', from: [-86, 820], to: [-32, 822], w: 9 },
  { id: 'B3', name: 'Бердов мост', info: 'Мост через Пряжку у Лоцманской улицы. Положение условное.', type: 'beam', from: [-142, 252], to: [-140, 322], w: 8 },
  { id: 'B6', name: 'Мост к Северной проходной', info: 'Мост через Ново-Адмиралтейский канал к Галерной ул. Положение условное.', type: 'beam', from: [2, 1420], to: [32, 1442], w: 10 },
  { id: 'B8', name: 'Мост через Пряжку (наб. Мойки)', info: 'Мост в створе набережной Мойки у слияния с Пряжкой.', type: 'beam', from: [-60, 1140], to: [5, 1180], w: 9 },
];

// Пешеходные переходы (улица, расстояние от начала, м)
export const CROSSINGS = [
  { street: 'lotsmanskaya', s: 16 },
  { street: 'sadovaya', s: 14 },
  { street: 'rimskogo', s: 12 },
];

export const CONTEXT_LABELS = [
  { text: 'Новая Голландия', at: [330, 1440], kind: 'district' },
  { text: 'Коломна', at: [200, 520], kind: 'district' },
  { text: 'Васильевский остров', at: [-850, 1650], kind: 'district' },
  { text: 'Балтийский завод', at: [-1300, 500], kind: 'district' },
  { text: 'Екатерингоф', at: [-250, -700], kind: 'district' },
  { text: 'пл. Репина', at: [15, -66], kind: 'street' },
  { text: 'Лоцманская ул.', at: [-185, 70], kind: 'street' },
  { text: 'ул. Декабристов', at: [200, 600], kind: 'street' },
  { text: 'Садовая ул.', at: [260, 175], kind: 'street' },
  { text: 'Английская наб.', at: [300, 1690], kind: 'street' },
  { text: 'наб. Лейтенанта Шмидта', at: [-380, 1740], kind: 'street' },
  { text: 'Старо-Петергофский пр.', at: [30, -560], kind: 'street' },
  { text: 'Рижский пр.', at: [-300, -405], kind: 'street' },
  { text: 'Старо-Калинкин мост', at: [32, -158], kind: 'landmark' },
];
