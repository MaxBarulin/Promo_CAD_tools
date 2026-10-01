// Территория АО «Адмиралтейские верфи»: зоны, здания, ограждение, дороги,
// стапели, эллинги, краны, суда, плавдоки.
//
// Общая схема (с юга на север):
//   • Галерный остров — у устья Фонтанки: главная проходная (пл. Репина / Садовая, 126),
//     заводоуправление, исторические мастерские 1910 г., два открытых наклонных стапеля
//     259×35 м с выходом в Большую Неву, достроечная набережная.
//   • Матисов остров — большая часть занята верфью: корпусообрабатывающее
//     и сборочно-сварочное производство, достроечная набережная на Неве, плавдок СПД-2М.
//     Юго-восточная часть — жилая застройка и мастерские (вне ограды).
//   • Ново-Адмиралтейский остров (17 га) — «Новое Адмиралтейство»: Малый каменный
//     эллинг (1833–38), Большой каменный эллинг (1890–93), крытые эллинги «Судомеха»,
//     Караульный дом (северная проходная), плавдок «Луга».
//
// Расположение отдельных построек внутри территории восстановлено по описаниям
// и типовой организации верфи — это схема, а не обмерный чертёж. Каждый объект
// снабжён полем info; поля approx отмечают особо условные элементы.

import { rect, pointAt, perp, add, mul, dirOf, angleOf, polylineLength } from '../geo.js';

// ---------- вспомогательные построения ----------

// Прямоугольник, примыкающий к линии слева по ходу: сторона 0 (фасад) лежит на линии.
// s — расстояние вдоль линии до центра, w — длина вдоль линии, d — глубина, gap — отступ.
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

// Береговая линия Ново-Адмиралтейского острова (с востока на запад; суша слева).
export const NOVO_SHORE = [
  [272, 1652],
  [100, 1565],
  [-100, 1450],
  [-240, 1376],
  [-330, 1318],
  [-370, 1250],
];

// Берег Галерного острова у достроечной набережной (с севера на юг; суша слева).
export const GALERNY_QUAY = [
  [-466, 360],
  [-478, 300],
  [-522, 150],
  [-575, -40],
  [-606, -125],
];

// Берег Матисова острова (с юга на север; суша справа → используем обратный порядок).
export const MATISOV_QUAY = [
  [-400, 1080],
  [-422, 900],
  [-446, 650],
  [-466, 360],
];

// Линия ограды вдоль Лоцманской улицы (с юга на север; территория слева).
export const LOTSMANSKAYA_FENCE = [
  [-41, 44],
  [-171, 381],
];

const L_LOTS = LOTSMANSKAYA_FENCE;
const lotsAt = (s) => pointAt(L_LOTS, s).p;

// ---------- зоны (участки) ----------
// Полигоны намеренно заходят в воду: при построении они обрезаются по суше.

export const ZONES = [
  {
    id: 'galerny',
    name: 'Галерный остров',
    kind: 'shipyard',
    label: [-330, 40],
    polygon: [
      [-680, -160],
      [-44, -82],
      [-41, 44],
      [-173, 386],
      [-300, 370],
      [-480, 350],
      [-680, 340],
    ],
  },
  {
    id: 'matisov',
    name: 'Матисов остров',
    kind: 'shipyard',
    label: [-260, 690],
    polygon: [
      [-560, 352],
      [-480, 350],
      [-220, 373],
      [-220, 722],
      [-10, 722],
      [-10, 1185],
      [-150, 1142],
      [-300, 1120],
      [-430, 1110],
      [-560, 1110],
    ],
  },
  {
    id: 'novo',
    name: 'Ново-Адмиралтейский остров',
    kind: 'shipyard',
    label: [-60, 1290],
    polygon: [
      [286, 1690],
      [286, 1270],
      [250, 1270],
      [100, 1210],
      [-150, 1142],
      [-300, 1120],
      [-430, 1110],
      [-520, 1110],
      [-450, 1300],
      [-300, 1420],
      [-100, 1520],
      [150, 1620],
    ],
  },
  {
    id: 'matisov-civil',
    name: 'Матисов остров (жилая часть)',
    kind: 'civil',
    polygon: [
      [-220, 373],
      [-125, 392],
      [-30, 420],
      [-10, 470],
      [-10, 722],
      [-220, 722],
    ],
  },
];

// ---------- ограждение ----------
// type: concrete — железобетонный забор с козырьком из колючей проволоки,
//       mesh — сетчатое ограждение по кромке набережной,
//       wall — исторический кирпичный забор Нового Адмиралтейства.
// gates: [{ s, w, name }] — ворота (s — расстояние вдоль линии до центра проёма).

const G2_S = [50, 120];
const G3_S = [185, 245];
const G14_S = [275, 315];

export const FENCES = [
  {
    id: 'F1a',
    name: 'Ограда у главной проходной (пл. Репина)',
    type: 'concrete',
    h: 2.8,
    line: [
      [-44, -70],
      [-41, -15],
    ],
    gates: [{ s: 30, w: 8, name: 'Автотранспортные ворота КПП-1' }],
  },
  {
    id: 'F1b',
    name: 'Ограда по Лоцманской ул.',
    type: 'concrete',
    h: 2.8,
    line: [[-41, 19], ...[0, G2_S[0]].map((s) => lotsAt(s))],
  },
  {
    id: 'F1c',
    name: 'Ограда по Лоцманской ул.',
    type: 'concrete',
    h: 2.8,
    line: [lotsAt(G2_S[1]), lotsAt(G3_S[0])],
    gates: [{ s: 20, w: 8, name: 'Ворота КПП-2 (Лоцманская ул.)' }],
  },
  {
    id: 'F1d',
    name: 'Ограда по Лоцманской ул.',
    type: 'concrete',
    h: 2.8,
    line: [lotsAt(G3_S[1]), lotsAt(G14_S[0])],
  },
  {
    id: 'F1e',
    name: 'Ограда по Лоцманской ул. до наб. Пряжки',
    type: 'concrete',
    h: 2.8,
    line: [lotsAt(G14_S[1]), [-171, 381]],
  },
  {
    id: 'F2',
    name: 'Ограждение кромки Фонтанки',
    type: 'mesh',
    h: 2.2,
    line: [
      [-44, -72],
      [-150, -79],
      [-300, -89],
      [-450, -106],
      [-520, -118],
    ],
  },
  {
    id: 'F3',
    name: 'Ограда Матисова острова (граница с жилой частью)',
    type: 'concrete',
    h: 2.8,
    line: [
      [-220, 393],
      [-220, 722],
      [-22, 722],
    ],
    gates: [{ s: 369, w: 7, name: 'Проходная Матисова острова' }],
  },
  {
    id: 'F4',
    name: 'Ограждение кромки Пряжки (Матисов остров)',
    type: 'mesh',
    h: 2.2,
    line: [
      [-25, 722],
      [-25, 1157],
    ],
  },
  {
    id: 'F5',
    name: 'Ограда Нового Адмиралтейства по Ново-Адмиралтейскому каналу',
    type: 'wall',
    h: 3.6,
    line: [
      [270, 1300],
      [270, 1645],
    ],
    gates: [{ s: 280, w: 10, name: 'Северная проходная (Караульный дом)' }],
  },
  {
    id: 'F6',
    name: 'Ограждение кромки Мойки (Ново-Адмиралтейский остров)',
    type: 'mesh',
    h: 2.2,
    line: [
      [266, 1296],
      [250, 1294],
      [100, 1234],
      [-12, 1204],
    ],
  },
];

// ---------- здания ----------
// type: hall — производственный корпус; office — административный; historic — историческое;
// elling — эллинг; warehouse — склад; utility — инженерное; checkpoint — проходная;
// residential — жилой; dorm — общежитие.
// roof: { type: flat | gable | hip | multigable | vault, h, bays, lantern }
// doors: [{ edge, t, w, h, kind }] — edge: сторона многоугольника, t — положение 0…1.

const sy = { kind: 'shipyard' };

const lots = (s0, s1, d) => besideLine(L_LOTS, (s0 + s1) / 2, s1 - s0, d);

export const BUILDINGS = [
  // ===================== Галерный остров =====================
  {
    ...sy,
    id: 'G1',
    zone: 'galerny',
    name: 'Главная проходная',
    info: 'Главная проходная предприятия у площади Репина (адрес предприятия: наб. реки Фонтанки, 203; Садовая ул., 126). Турникетный зал, бюро пропусков.',
    poly: rect(-48, 2, 14, 34, 0),
    h: 7.5,
    floors: 2,
    type: 'checkpoint',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [
      { edge: 1, t: 0.5, w: 7, h: 3.2, kind: 'main', canopy: 4 },
      { edge: 3, t: 0.5, w: 7, h: 3.2, kind: 'main', canopy: 3 },
    ],
    sign: { edge: 1, text: 'АДМИРАЛТЕЙСКИЕ ВЕРФИ' },
  },
  {
    ...sy,
    id: 'G2',
    zone: 'galerny',
    name: 'Заводоуправление',
    info: 'Административный корпус: дирекция, службы управления. Фасад выходит на Лоцманскую улицу.',
    poly: lots(G2_S[0], G2_S[1], 18),
    h: 19,
    floors: 5,
    type: 'office',
    wall: 'sand',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 0, t: 0.5, w: 4, h: 3, kind: 'main', canopy: 3 }, { edge: 2, t: 0.3, w: 2.4, h: 2.4 }],
    approx: true,
  },
  {
    ...sy,
    id: 'G3',
    zone: 'galerny',
    name: 'Инженерно-конструкторский корпус',
    info: 'Конструкторское бюро и технологические службы.',
    poly: lots(G3_S[0], G3_S[1], 18),
    h: 22,
    floors: 6,
    type: 'office',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 0, t: 0.35, w: 3.5, h: 3, kind: 'main', canopy: 3 }, { edge: 2, t: 0.6, w: 2.4, h: 2.4 }],
    approx: true,
  },
  {
    ...sy,
    id: 'G14',
    zone: 'galerny',
    name: 'Учебный центр',
    info: 'Корпоративный учебный центр, подготовка рабочих кадров.',
    poly: lots(G14_S[0], G14_S[1], 15),
    h: 15,
    floors: 4,
    type: 'office',
    wall: 'cream',
    roof: { type: 'flat', color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 3, h: 2.8, kind: 'main', canopy: 2.5 }],
    approx: true,
  },
  {
    ...sy,
    id: 'G4',
    zone: 'galerny',
    name: 'Главная судостроительная мастерская с кузницей',
    info: '1910 г., архитектор А. И. Дмитриев, кирпич. Наб. реки Фонтанки, 203 лит. АЦ. Входит в выявленный объект культурного наследия «Комплекс построек Адмиралтейского судостроительного завода».',
    poly: rect(-290, -42, 130, 30, 6),
    h: 15,
    type: 'historic_hall',
    wall: 'brick',
    roof: { type: 'gable', h: 6, color: 'r_gray', lantern: true },
    doors: [
      { edge: 3, t: 0.5, w: 6, h: 6, kind: 'gate' },
      { edge: 1, t: 0.5, w: 6, h: 6, kind: 'gate' },
      { edge: 2, t: 0.3, w: 2.2, h: 2.6 },
      { edge: 2, t: 0.7, w: 2.2, h: 2.6 },
    ],
  },
  {
    ...sy,
    id: 'G5',
    zone: 'galerny',
    name: 'Механосборочный цех',
    info: 'Механическая обработка, изготовление деталей судовых систем и устройств.',
    poly: rect(-300, 70, 120, 42, 6),
    h: 16,
    type: 'hall',
    wall: 'blue_gray',
    roof: { type: 'gable', h: 5, color: 'r_light', lantern: true },
    doors: [
      { edge: 1, t: 0.5, w: 8, h: 8, kind: 'gate' },
      { edge: 3, t: 0.5, w: 8, h: 8, kind: 'gate' },
      { edge: 0, t: 0.25, w: 2.2, h: 2.6 },
      { edge: 0, t: 0.75, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'G6',
    zone: 'galerny',
    name: 'Трубомедницкий цех',
    info: 'Изготовление трубопроводов судовых систем.',
    poly: rect(-150, -38, 60, 26, 6),
    h: 12,
    type: 'hall',
    wall: 'panel',
    roof: { type: 'gable', h: 3, color: 'r_gray' },
    doors: [
      { edge: 3, t: 0.5, w: 6, h: 6, kind: 'gate' },
      { edge: 2, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'G7',
    zone: 'galerny',
    name: 'Котельная',
    info: 'Заводская котельная с дымовой трубой.',
    poly: rect(-140, 72, 32, 20, 6),
    h: 12,
    type: 'utility',
    wall: 'brick_dark',
    roof: { type: 'flat', color: 'r_bitumen' },
    doors: [{ edge: 0, t: 0.5, w: 4, h: 4, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'G8',
    zone: 'galerny',
    name: 'Столовая',
    info: 'Заводская столовая.',
    poly: rect(-100, 45, 36, 20, 6),
    h: 8,
    floors: 2,
    type: 'office',
    wall: 'cream',
    roof: { type: 'flat', color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 3, h: 2.8, kind: 'main', canopy: 2.5 }],
    approx: true,
  },
  {
    ...sy,
    id: 'G9',
    zone: 'galerny',
    name: 'Склад № 1',
    info: 'Склад материалов и оборудования.',
    poly: rect(-445, -66, 50, 22, 6),
    h: 8,
    type: 'warehouse',
    wall: 'panel',
    roof: { type: 'gable', h: 2, color: 'r_light' },
    doors: [
      { edge: 2, t: 0.3, w: 5, h: 5, kind: 'gate' },
      { edge: 2, t: 0.7, w: 5, h: 5, kind: 'gate' },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'G10',
    zone: 'galerny',
    name: 'Корпусосборочный цех (предстапельная сборка)',
    info: 'Сборка и сварка секций и блоков корпуса перед подачей на открытые стапели.',
    poly: rect(-180, 235, 46, 96, 6),
    h: 24,
    type: 'hall',
    wall: 'blue',
    roof: { type: 'gable', h: 5, color: 'r_light', lantern: true },
    doors: [
      { edge: 3, t: 0.3, w: 14, h: 16, kind: 'gate' },
      { edge: 3, t: 0.75, w: 14, h: 16, kind: 'gate' },
      { edge: 1, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'G13',
    zone: 'galerny',
    name: 'Окрасочно-сушильная камера',
    info: 'Окраска секций корпуса перед монтажом на стапеле.',
    poly: rect(-165, 125, 40, 30, 6),
    h: 18,
    type: 'hall',
    wall: 'gray',
    roof: { type: 'gable', h: 3, color: 'r_gray' },
    doors: [{ edge: 3, t: 0.5, w: 12, h: 12, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'G15',
    zone: 'galerny',
    name: 'Трансформаторная подстанция',
    info: 'ТП 10/0,4 кВ.',
    poly: rect(-420, 30, 14, 10, 6),
    h: 5,
    type: 'utility',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 0, t: 0.5, w: 2, h: 2.4 }],
  },
  {
    ...sy,
    id: 'G16',
    zone: 'galerny',
    name: 'Склад достроечной набережной',
    info: 'Склад и мастерские при достроечной набережной у устья Фонтанки.',
    poly: rect(-524, -5, 44, 18, 254.4),
    h: 9,
    type: 'warehouse',
    wall: 'blue_gray',
    roof: { type: 'gable', h: 2, color: 'r_light' },
    doors: [
      { edge: 2, t: 0.3, w: 5, h: 5, kind: 'gate' },
      { edge: 2, t: 0.7, w: 5, h: 5, kind: 'gate' },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'G17',
    zone: 'galerny',
    name: 'КПП-2 (автотранспорт)',
    info: 'Будка охраны у ворот на Лоцманской улице.',
    poly: besideLine(L_LOTS, G2_S[1] + 30, 5, 4, 1),
    h: 3,
    type: 'checkpoint',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 2, t: 0.5, w: 1, h: 2.2 }],
  },

  // ===================== Матисов остров =====================
  {
    ...sy,
    id: 'M1',
    zone: 'matisov',
    name: 'Корпусообрабатывающий цех',
    info: 'Правка, резка и гибка листового и профильного проката; изготовление деталей корпуса.',
    poly: rect(-300, 560, 100, 180, -4),
    h: 20,
    type: 'hall',
    wall: 'blue_gray',
    roof: { type: 'multigable', h: 4, bays: 4, along: 'd', color: 'r_light' },
    doors: [
      { edge: 0, t: 0.2, w: 10, h: 10, kind: 'gate' },
      { edge: 0, t: 0.8, w: 10, h: 10, kind: 'gate' },
      { edge: 2, t: 0.4, w: 10, h: 10, kind: 'gate' },
      { edge: 1, t: 0.5, w: 2.2, h: 2.6 },
      { edge: 3, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'M2',
    zone: 'matisov',
    name: 'Сборочно-сварочный цех',
    info: 'Сборка и сварка плоскостных и объёмных секций, укрупнение в блоки.',
    poly: rect(-300, 820, 100, 140, -4),
    h: 26,
    type: 'hall',
    wall: 'light',
    roof: { type: 'multigable', h: 4, bays: 3, along: 'd', color: 'r_gray' },
    doors: [
      { edge: 3, t: 0.3, w: 14, h: 16, kind: 'gate' },
      { edge: 3, t: 0.7, w: 14, h: 16, kind: 'gate' },
      { edge: 0, t: 0.5, w: 12, h: 14, kind: 'gate' },
      { edge: 1, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'M3',
    zone: 'matisov',
    name: 'Окрасочный цех',
    info: 'Подготовка поверхности и окраска секций и изделий.',
    poly: rect(-95, 840, 60, 50, 0),
    h: 18,
    type: 'hall',
    wall: 'gray',
    roof: { type: 'gable', h: 3, color: 'r_gray' },
    doors: [{ edge: 3, t: 0.5, w: 10, h: 10, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'M4',
    zone: 'matisov',
    name: 'Механомонтажный цех',
    info: 'Изготовление и монтаж судовых механизмов и оборудования.',
    poly: rect(-95, 960, 70, 44, 0),
    h: 15,
    type: 'hall',
    wall: 'blue_gray',
    roof: { type: 'gable', h: 3, color: 'r_light', lantern: true },
    doors: [
      { edge: 3, t: 0.5, w: 8, h: 8, kind: 'gate' },
      { edge: 0, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'M5',
    zone: 'matisov',
    name: 'Склад материально-технического снабжения',
    info: 'Центральный склад.',
    poly: rect(-300, 1000, 80, 30, -4),
    h: 10,
    type: 'warehouse',
    wall: 'panel',
    roof: { type: 'gable', h: 2, color: 'r_light' },
    doors: [
      { edge: 0, t: 0.25, w: 5, h: 5, kind: 'gate' },
      { edge: 0, t: 0.75, w: 5, h: 5, kind: 'gate' },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'M6',
    zone: 'matisov',
    name: 'Компрессорная станция',
    info: 'Снабжение цехов сжатым воздухом.',
    poly: rect(-60, 1062, 30, 20, 0),
    h: 9,
    type: 'utility',
    wall: 'brick_dark',
    roof: { type: 'flat', color: 'r_bitumen' },
    doors: [{ edge: 3, t: 0.5, w: 3, h: 3.5, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'M7',
    zone: 'matisov',
    name: 'Административно-бытовой корпус',
    info: 'АБК производства Матисова острова: раздевалки, душевые, службы цехов.',
    poly: rect(-130, 752, 70, 16, 0),
    h: 15,
    floors: 4,
    type: 'office',
    wall: 'cream',
    roof: { type: 'flat', color: 'r_gray' },
    doors: [
      { edge: 0, t: 0.5, w: 3, h: 2.8, kind: 'main', canopy: 2.5 },
      { edge: 2, t: 0.5, w: 2.4, h: 2.4 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'M8',
    zone: 'matisov',
    name: 'Проходная Матисова острова',
    info: 'Проходная на производственную площадку Матисова острова.',
    poly: rect(-195, 730, 12, 8, 0),
    h: 3.5,
    type: 'checkpoint',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [
      { edge: 0, t: 0.5, w: 2, h: 2.4, kind: 'main' },
      { edge: 2, t: 0.5, w: 2, h: 2.4 },
    ],
  },
  {
    ...sy,
    id: 'M9',
    zone: 'matisov',
    name: 'Трансформаторная подстанция',
    info: 'ТП 10/0,4 кВ.',
    poly: rect(-210, 940, 14, 10, 0),
    h: 5,
    type: 'utility',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 0, t: 0.5, w: 2, h: 2.4 }],
  },

  // ===================== Ново-Адмиралтейский остров =====================
  {
    ...sy,
    id: 'N1',
    zone: 'novo',
    name: 'Большой каменный эллинг',
    info: '1890–1893 гг., инженеры С. Н. Будзынский, Н. П. Дуткин, Н. Д. Куторга; подрядные работы — арх. Н. П. Козлов. Длина 132 м, ширина между стенами ≈28 м. Ориентирован торцом к Неве.',
    poly: besideLine(NOVO_SHORE, 181.5, 32, 136, 15),
    h: 20,
    type: 'elling',
    wall: 'brick',
    roof: { type: 'gable', h: 12, color: 'r_gray', lantern: true },
    doors: [
      { edge: 0, t: 0.5, w: 22, h: 24, kind: 'gate' },
      { edge: 2, t: 0.5, w: 6, h: 6, kind: 'gate' },
      { edge: 1, t: 0.2, w: 2.2, h: 2.8 },
      { edge: 3, t: 0.8, w: 2.2, h: 2.8 },
    ],
  },
  {
    ...sy,
    id: 'N2',
    zone: 'novo',
    name: 'Малый каменный эллинг (эллинг № 1)',
    info: '1833–1838 гг. Один из старейших сохранившихся эллингов России; входит в «Комплекс построек Адмиралтейского судостроительного завода».',
    poly: besideLine(NOVO_SHORE, 91.9, 26, 100, 15),
    h: 16,
    type: 'elling_historic',
    wall: 'ochre',
    roof: { type: 'gable', h: 9, color: 'r_green' },
    doors: [
      { edge: 0, t: 0.5, w: 16, h: 18, kind: 'gate' },
      { edge: 2, t: 0.5, w: 4, h: 4.5, kind: 'gate' },
    ],
  },
  {
    ...sy,
    id: 'N3',
    zone: 'novo',
    name: 'Крытый эллинг (бывш. завод «Судомех»)',
    info: '5 крытых построечных мест 120×20 м — строительство подводных лодок (в т. ч. пр. 636.3). Спуск — через плавдок «Луга». Габариты корпуса условные.',
    poly: besideLine(NOVO_SHORE, 331.1, 110, 126, 18),
    h: 30,
    type: 'elling',
    wall: 'blue_gray',
    roof: { type: 'multigable', h: 6, bays: 5, along: 'd', color: 'r_light' },
    doors: [
      { edge: 0, t: 0.1, w: 16, h: 22, kind: 'gate' },
      { edge: 0, t: 0.3, w: 16, h: 22, kind: 'gate' },
      { edge: 0, t: 0.5, w: 16, h: 22, kind: 'gate' },
      { edge: 0, t: 0.7, w: 16, h: 22, kind: 'gate' },
      { edge: 0, t: 0.9, w: 16, h: 22, kind: 'gate' },
      { edge: 2, t: 0.5, w: 8, h: 8, kind: 'gate' },
      { edge: 1, t: 0.5, w: 2.2, h: 2.8 },
      { edge: 3, t: 0.5, w: 2.2, h: 2.8 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'N4',
    zone: 'novo',
    name: 'Крытый эллинг 100×10 м (№ 1)',
    info: 'Малый крытый эллинг для небольших заказов.',
    poly: besideLine(NOVO_SHORE, 417.6, 14, 104, 15),
    h: 14,
    type: 'elling',
    wall: 'light',
    roof: { type: 'gable', h: 4, color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 10, h: 11, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'N5',
    zone: 'novo',
    name: 'Крытый эллинг 100×10 м (№ 2)',
    info: 'Малый крытый эллинг для небольших заказов.',
    poly: besideLine(NOVO_SHORE, 451.7, 14, 104, 15),
    h: 14,
    type: 'elling',
    wall: 'light',
    roof: { type: 'gable', h: 4, color: 'r_gray' },
    doors: [{ edge: 0, t: 0.5, w: 10, h: 11, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'N6',
    zone: 'novo',
    name: 'Караульный дом (Северная проходная)',
    info: '1830-е гг., классицизм. Наб. Ново-Адмиралтейского канала, 3. Входит в «Комплекс построек Адмиралтейского судостроительного завода».',
    poly: rect(256, 1612, 14, 32, 0),
    h: 9,
    floors: 2,
    type: 'historic',
    wall: 'yellow',
    roof: { type: 'hip', h: 3, color: 'r_green' },
    portico: { edge: 1, columns: 4, depth: 3.5 },
    doors: [{ edge: 1, t: 0.5, w: 2.4, h: 3.2, kind: 'main' }, { edge: 3, t: 0.5, w: 2.4, h: 3.2 }],
  },
  {
    ...sy,
    id: 'N7',
    zone: 'novo',
    name: 'Мастерские Нового Адмиралтейства',
    info: 'Историческое производственное здание XIX в.',
    poly: rect(95, 1330, 80, 18, 27),
    h: 11,
    floors: 2,
    type: 'historic',
    wall: 'ochre',
    roof: { type: 'hip', h: 3.5, color: 'r_gray' },
    doors: [{ edge: 2, t: 0.5, w: 4, h: 4, kind: 'gate' }, { edge: 0, t: 0.3, w: 2.2, h: 2.8 }],
    approx: true,
  },
  {
    ...sy,
    id: 'N8',
    zone: 'novo',
    name: 'Инженерный корпус Нового Адмиралтейства',
    info: 'Административно-инженерный корпус площадки (бывш. завод «Судомех»).',
    poly: rect(150, 1275, 70, 16, 22),
    h: 18,
    floors: 5,
    type: 'office',
    wall: 'light',
    roof: { type: 'flat', color: 'r_dark' },
    doors: [{ edge: 2, t: 0.5, w: 3.5, h: 3, kind: 'main', canopy: 3 }],
    approx: true,
  },
  {
    ...sy,
    id: 'N10',
    zone: 'novo',
    name: 'Склад',
    info: 'Складской корпус.',
    poly: rect(-290, 1290, 70, 30, 28),
    h: 10,
    type: 'warehouse',
    wall: 'panel',
    roof: { type: 'gable', h: 2, color: 'r_light' },
    doors: [
      { edge: 0, t: 0.3, w: 5, h: 5, kind: 'gate' },
      { edge: 0, t: 0.7, w: 5, h: 5, kind: 'gate' },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'N11',
    zone: 'novo',
    name: 'Цех достройки',
    info: 'Цех насыщения и достройки заказов.',
    poly: rect(-180, 1300, 60, 24, 28),
    h: 12,
    type: 'hall',
    wall: 'blue_gray',
    roof: { type: 'gable', h: 3, color: 'r_light' },
    doors: [
      { edge: 3, t: 0.5, w: 6, h: 6, kind: 'gate' },
      { edge: 0, t: 0.5, w: 2.2, h: 2.6 },
    ],
    approx: true,
  },
  {
    ...sy,
    id: 'N12',
    zone: 'novo',
    name: 'Котельная Нового Адмиралтейства',
    info: 'Котельная с дымовой трубой.',
    poly: rect(-60, 1262, 30, 20, 28),
    h: 10,
    type: 'utility',
    wall: 'brick_dark',
    roof: { type: 'flat', color: 'r_bitumen' },
    doors: [{ edge: 0, t: 0.5, w: 4, h: 4, kind: 'gate' }],
    approx: true,
  },
  {
    ...sy,
    id: 'N14',
    zone: 'novo',
    name: 'Лабораторный корпус',
    info: 'Центральная заводская лаборатория.',
    poly: rect(30, 1290, 40, 14, 25),
    h: 12,
    floors: 3,
    type: 'office',
    wall: 'cream',
    roof: { type: 'flat', color: 'r_gray' },
    doors: [{ edge: 2, t: 0.5, w: 2.6, h: 2.8, kind: 'main', canopy: 2 }],
    approx: true,
  },
];

// Дымовые трубы
export const CHIMNEYS = [
  { id: 'CH1', name: 'Дымовая труба котельной', at: [-118, 84], h: 55, r: 2.4 },
  { id: 'CH2', name: 'Дымовая труба котельной Нового Адмиралтейства', at: [-37, 1275], h: 45, r: 2 },
];

// ---------- дороги и площадки внутри территории ----------
// kind: internal — внутризаводская дорога (бетон).

export const INTERNAL_ROADS = [
  { id: 'RG1', name: 'Главный проезд Галерного острова', w: 10, line: [[-57, 5], [-300, -21], [-548, -47]] },
  { id: 'RG2', name: 'Проезд к стапелям', w: 8, line: [[-218, -25], [-212, 100], [-214, 200], [-216, 345]] },
  { id: 'RG3', name: 'Проезд у склада металла', w: 8, line: [[-500, 150], [-214, 178]] },
  { id: 'RG4', name: 'Проезд вдоль Пряжки', w: 8, line: [[-450, 320], [-330, 335], [-216, 345], [-180, 352]] },
  { id: 'RG6', name: 'Проезд вдоль Фонтанки', w: 7, line: [[-55, -52], [-200, -66], [-420, -88], [-520, -100]] },
  { id: 'RG7', name: 'Проезд к воротам КПП-2', w: 7, line: [[-214, 160], [-140, 168], [-95, 174]] },
  { id: 'RM1', name: 'Проезд вдоль достроечной набережной (Матисов о.)', w: 9, line: [[-418, 395], [-402, 700], [-382, 1060]] },
  { id: 'RM3', name: 'Поперечный проезд (Матисов о.)', w: 8, line: [[-402, 700], [-232, 702], [-232, 738], [-180, 740]] },
  { id: 'RM4', name: 'Проезд от проходной Матисова о.', w: 8, line: [[-180, 712], [-180, 1080], [-200, 1100]] },
  { id: 'RM5', name: 'Поперечный проезд у склада', w: 8, line: [[-392, 905], [-180, 905]] },
  { id: 'RM6', name: 'Проезд вдоль Мойки', w: 7, line: [[-382, 1060], [-300, 1072], [-180, 1080]] },
  { id: 'RM7', name: 'Подъезд к мосту через Пряжку', w: 8, line: [[-331, 385], [-330, 410], [-415, 420]] },
  { id: 'RN1', name: 'Продольный проезд Нового Адмиралтейства', w: 8, line: [[262, 1578], [262, 1420], [200, 1405], [120, 1370], [0, 1320], [-150, 1250], [-300, 1210], [-350, 1195]] },
  { id: 'RN2', name: 'Подъезд к мосту через Мойку', w: 8, line: [[-200, 1162], [-196, 1238]] },
  { id: 'RN3', name: 'Проезд к Большому эллингу', w: 7, line: [[120, 1370], [160, 1425]] },
];

// Площадки (бетон, складирование, газоны)
export const AREAS = [
  { id: 'A1', kind: 'storage', name: 'Склад металлопроката (открытый)', polygon: rect(-430, 110, 90, 40, 6) },
  { id: 'A2', kind: 'apron', name: 'Предстапельная площадка', polygon: rect(-235, 255, 30, 110, 6) },
  { id: 'A3', kind: 'storage', name: 'Открытая площадка складирования (Матисов о.)', polygon: rect(-382, 560, 26, 150, -4) },
  { id: 'A4', kind: 'lawn', name: 'Газон у заводоуправления', polygon: rect(-62, 55, 12, 34, 21) },
  { id: 'A5', kind: 'lawn', name: 'Сквер у главного проезда', polygon: rect(-95, -22, 40, 14, 6) },
  { id: 'A6', kind: 'apron', name: 'Площадка у эллингов', polygon: rect(60, 1440, 40, 70, 28) },
];

// ---------- рельсовые пути ----------
// gauge — ширина колеи (портальные краны ≈10,5 м, башенные стапельные ≈8 м, ж/д 1,52 м).

const SLIP_DIR = dirOf(186);
const slipAxis = (head, t) => add(head, mul(SLIP_DIR, t));
const SLIP1_HEAD = [-230, 296];
const SLIP2_HEAD = [-250, 220];
const slipNormal = perp(SLIP_DIR); // влево по ходу к воде (на юг)

const offsetLine = (head, off, t0, t1) => [
  add(slipAxis(head, t0), mul(slipNormal, off)),
  add(slipAxis(head, t1), mul(slipNormal, off)),
];

const MID_TRACK = offsetLine(SLIP1_HEAD, 36.75, 8, 252); // между стапелями
const NORTH_TRACK = offsetLine(SLIP1_HEAD, -27, 8, 250);
const SOUTH_TRACK = offsetLine(SLIP2_HEAD, 27, 8, 255);

const quayTrack = (line, s0, s1, off) => {
  const pts = [];
  for (let s = s0; s <= s1 + 1e-6; s += (s1 - s0) / 6) {
    const f = frameOnLine(line, s, off);
    pts.push(f.p);
  }
  return pts;
};

const GALERNY_TRACK_LINE = quayTrack(GALERNY_QUAY, 230, 400, 11);
const MATISOV_TRACK_LINE = quayTrack(MATISOV_QUAY, 20, 640, 11);
const NOVO_TRACK_LINE = quayTrack(NOVO_SHORE, 240, 410, 9);

export const RAILS = [
  { id: 'T1', name: 'Подкрановый путь между стапелями', gauge: 8, line: MID_TRACK },
  { id: 'T2', name: 'Подкрановый путь стапеля № 1', gauge: 8, line: NORTH_TRACK },
  { id: 'T3', name: 'Подкрановый путь стапеля № 2', gauge: 8, line: SOUTH_TRACK },
  { id: 'T4', name: 'Подкрановый путь достроечной набережной (Галерный о.)', gauge: 10.5, line: GALERNY_TRACK_LINE },
  { id: 'T5', name: 'Подкрановый путь достроечной набережной (Матисов о.)', gauge: 10.5, line: MATISOV_TRACK_LINE },
  { id: 'T6', name: 'Подкрановый путь Нового Адмиралтейства', gauge: 10.5, line: NOVO_TRACK_LINE },
  { id: 'T7', name: 'Заводской железнодорожный путь', gauge: 1.52, line: [[-60, 14], [-300, -12], [-520, -36]] },
];

// ---------- стапели ----------

export const SLIPWAYS = [
  {
    id: 'S1',
    name: 'Открытый наклонный стапель № 1',
    info: 'Длина 259 м, ширина 35 м; суда дедвейтом до 70 000 т. Спуск — в Большую Неву.',
    head: SLIP1_HEAD,
    angle: 186,
    length: 258,
    water: 45,
    width: 35,
  },
  {
    id: 'S2',
    name: 'Открытый наклонный стапель № 2',
    info: 'Длина 259 м, ширина 35 м; суда дедвейтом до 70 000 т. Спуск — в Большую Неву.',
    head: SLIP2_HEAD,
    angle: 186,
    length: 261,
    water: 45,
    width: 35,
  },
];

// ---------- краны ----------
// portal — портальный кран (набережная); tower — стапельный башенный кран на рельсах;
// gantry — козловой кран. slew — направление стрелы (градусы), track — ориентация рельсов.

const onTrack = (line, s) => pointAt(line, s).p;
const trackAngle = (line) => angleOf([line[1][0] - line[0][0], line[1][1] - line[0][1]]);

export const CRANES = [
  { id: 'C1', type: 'tower', name: 'Стапельный кран (путь между стапелями)', at: onTrack(MID_TRACK, 70), track: trackAngle(MID_TRACK), slew: 120, h: 52, jib: 42 },
  { id: 'C2', type: 'tower', name: 'Стапельный кран (путь между стапелями)', at: onTrack(MID_TRACK, 175), track: trackAngle(MID_TRACK), slew: 255, h: 52, jib: 42 },
  { id: 'C3', type: 'tower', name: 'Стапельный кран стапеля № 1', at: onTrack(NORTH_TRACK, 125), track: trackAngle(NORTH_TRACK), slew: 290, h: 48, jib: 38 },
  { id: 'C4', type: 'tower', name: 'Стапельный кран стапеля № 2', at: onTrack(SOUTH_TRACK, 60), track: trackAngle(SOUTH_TRACK), slew: 95, h: 48, jib: 38 },
  { id: 'C5', type: 'portal', name: 'Портальный кран достроечной набережной', at: onTrack(GALERNY_TRACK_LINE, 35), track: angleOf(pointAt(GALERNY_TRACK_LINE, 35).dir), slew: 165, h: 34, jib: 32 },
  { id: 'C6', type: 'portal', name: 'Портальный кран достроечной набережной', at: onTrack(GALERNY_TRACK_LINE, 120), track: angleOf(pointAt(GALERNY_TRACK_LINE, 120).dir), slew: 200, h: 34, jib: 32 },
  { id: 'C7', type: 'portal', name: 'Портальный кран (Матисов о.)', at: onTrack(MATISOV_TRACK_LINE, 120), track: angleOf(pointAt(MATISOV_TRACK_LINE, 120).dir), slew: 175, h: 36, jib: 34 },
  { id: 'C8', type: 'portal', name: 'Портальный кран (Матисов о.)', at: onTrack(MATISOV_TRACK_LINE, 260), track: angleOf(pointAt(MATISOV_TRACK_LINE, 260).dir), slew: 200, h: 36, jib: 34 },
  { id: 'C9', type: 'portal', name: 'Портальный кран (Матисов о.)', at: onTrack(MATISOV_TRACK_LINE, 480), track: angleOf(pointAt(MATISOV_TRACK_LINE, 480).dir), slew: 150, h: 36, jib: 34 },
  { id: 'C10', type: 'portal', name: 'Портальный кран (Новое Адмиралтейство)', at: onTrack(NOVO_TRACK_LINE, 30), track: angleOf(pointAt(NOVO_TRACK_LINE, 30).dir), slew: 140, h: 32, jib: 30 },
  { id: 'C11', type: 'portal', name: 'Портальный кран (Новое Адмиралтейство)', at: onTrack(NOVO_TRACK_LINE, 150), track: angleOf(pointAt(NOVO_TRACK_LINE, 150).dir), slew: 95, h: 32, jib: 30 },
  { id: 'C12', type: 'gantry', name: 'Козловой кран склада металла', at: [-430, 110], angle: 6, span: 44, len: 12, h: 18 },
  { id: 'C13', type: 'gantry', name: 'Козловой кран площадки складирования', at: [-382, 560], angle: 86, span: 30, len: 10, h: 16 },
];

// ---------- суда и плавсредства ----------
// hull: tanker | trawler | icebreaker | submarine.
// at — центр, angle — направление носа, z — уровень киля (0 — уровень земли, вода −2,4 м).

const slipShip = (head, tFromHead, L) => {
  const c = slipAxis(head, tFromHead + L / 2);
  return { at: c, angle: 186 + 180 }; // нос к голове стапеля, корма к воде
};

const NOVO_DOCK = frameOnLine(NOVO_SHORE, 331.1, -48);
const MATISOV_DOCK = frameOnLine(MATISOV_QUAY, 150, -17);
const MATISOV_SHIP = frameOnLine(MATISOV_QUAY, 470, -20);
const GALERNY_SHIP = frameOnLine(GALERNY_QUAY, 315, -12);
const NOVO_SUB = frameOnLine(NOVO_SHORE, 40, -10);

export const SHIPS = [
  {
    id: 'V1',
    name: 'Корпус танкера ледового класса на стапеле № 1',
    info: 'Условный заказ: крупнотоннажное судно на стадии формирования корпуса (Д×Ш ≈ 180×30 м).',
    hull: 'tanker',
    L: 180,
    B: 30,
    D: 17,
    T: 0,
    onSlip: 'S1',
    ...slipShip(SLIP1_HEAD, 30, 180),
    z: 1.8,
    stage: 'hull',
  },
  {
    id: 'V2',
    name: 'Траулер на стапеле № 2',
    info: 'Условный заказ: большой морозильный траулер (≈ 105×21 м) перед спуском на воду.',
    hull: 'trawler',
    L: 105,
    B: 21,
    D: 12,
    T: 0,
    onSlip: 'S2',
    ...slipShip(SLIP2_HEAD, 70, 105),
    z: 1.6,
    stage: 'complete',
  },
  {
    id: 'V3',
    name: 'Траулер у достроечной набережной',
    info: 'Условный заказ: траулер на достройке у устья Фонтанки.',
    hull: 'trawler',
    L: 82,
    B: 16,
    D: 10,
    T: 5,
    at: GALERNY_SHIP.p,
    angle: GALERNY_SHIP.angle + 180,
    afloat: true,
    stage: 'complete',
  },
  {
    id: 'V4',
    name: 'Ледокол у достроечной набережной Матисова острова',
    info: 'Условный заказ на достройке у глубоководной набережной.',
    hull: 'icebreaker',
    L: 120,
    B: 26,
    D: 13,
    T: 7,
    at: MATISOV_SHIP.p,
    angle: MATISOV_SHIP.angle,
    afloat: true,
    stage: 'complete',
  },
  {
    id: 'V5',
    name: 'Подводная лодка на плавдоке «Луга»',
    info: 'Дизель-электрическая ПЛ пр. 636.3 (74×9,9 м) после вывода из эллинга.',
    hull: 'submarine',
    L: 74,
    B: 9.9,
    onDock: 'D1',
    at: NOVO_DOCK.p,
    angle: NOVO_DOCK.angle - 90,
  },
  {
    id: 'V6',
    name: 'Подводная лодка у достроечной набережной',
    info: 'ДЭПЛ пр. 636.3 на швартовных испытаниях.',
    hull: 'submarine',
    L: 74,
    B: 9.9,
    T: 6.2,
    at: NOVO_SUB.p,
    angle: NOVO_SUB.angle,
    afloat: true,
  },
];

export const DOCKS = [
  {
    id: 'D1',
    name: 'Плавучий док «Луга»',
    info: '92×27 м, грузоподъёмность 6000 т. Используется для спуска подводных лодок из крытого эллинга.',
    at: NOVO_DOCK.p,
    angle: NOVO_DOCK.angle - 90,
    L: 92,
    B: 27,
  },
  {
    id: 'D2',
    name: 'Плавучий док СПД-2М',
    info: '92×22 м, грузоподъёмность 2000 т.',
    at: MATISOV_DOCK.p,
    angle: MATISOV_DOCK.angle,
    L: 92,
    B: 22,
  },
];

// ---------- мосты ----------
// type: kalinkin (каменный с башнями), beam (балочный городской), industrial (заводской).

export const BRIDGES = [
  { id: 'B1', name: 'Старо-Калинкин мост', info: 'Каменный трёхпролётный мост через Фонтанку (1786–1788) с башнями-павильонами.', type: 'kalinkin', from: [36, -56], to: [36, -126], w: 24 },
  { id: 'B2', name: 'Матисов мост', info: 'Мост через Пряжку на Матисов остров.', type: 'beam', from: [-28, 560], to: [10, 560], w: 9 },
  { id: 'B3', name: 'Бердов мост', info: 'Мост через Пряжку у Лоцманской улицы.', type: 'beam', from: [-150, 370], to: [-153, 408], w: 8, approx: true },
  { id: 'B4', name: 'Заводской мост через Пряжку', info: 'Внутризаводской мост: Галерный остров — Матисов остров.', type: 'industrial', from: [-330, 348], to: [-331, 388], w: 10 },
  { id: 'B5', name: 'Заводской мост через Мойку', info: 'Внутризаводской мост: Матисов остров — Ново-Адмиралтейский остров.', type: 'industrial', from: [-200, 1106], to: [-200, 1164], w: 10 },
  { id: 'B6', name: 'Мост к Северной проходной', info: 'Мост через Ново-Адмиралтейский канал к Караульному дому.', type: 'beam', from: [266, 1580], to: [306, 1580], w: 10 },
  { id: 'B7', name: 'Мост через Екатерингофку', info: 'Рижский проспект.', type: 'beam', from: [-382, -252], to: [-445, -264], w: 16, approx: true },
];

// ---------- подписи ----------

export const LABELS = [
  { text: 'Ново-Адмиралтейский остров', at: [-120, 1330], kind: 'island' },
  { text: 'Матисов остров', at: [-330, 690], kind: 'island' },
  { text: 'Галерный остров', at: [-380, 20], kind: 'island' },
];

export const SHIPYARD_META = {
  name: 'АО «Адмиралтейские верфи»',
  address: '190121, Санкт-Петербург, наб. реки Фонтанки, 203',
  area: '≈ 67 га (по открытым данным 67–77,5 га)',
};

// Длина ограды (для информации в интерфейсе)
export const fenceLength = () => FENCES.reduce((s, f) => s + polylineLength(f.line), 0);
