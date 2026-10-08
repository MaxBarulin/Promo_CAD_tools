// Замена контуров зданий верфи контурами из site.js: прежние здания
// модели отдают им коды, высоты, этажность и отделку там, где они совпадают по месту;
// здания, которых в site.js нет, из модели убираются.
//
// applySiteData(oldYard, { zoneOf }) → { buildings, dropped, idMap, notes }
//   oldYard  — здания верфи, собранные из открытых данных (real.js, yardBuildings)
//   zoneOf   — участок по точке

import pc from 'polygon-clipping';
import { SITE_BUILDINGS, SITE_TABLE, SITE_MIGRATED, PURPOSE_RU } from './site.js';
import { SITE_CHIMNEY_NUMS } from './site-structures.js';
import { decorate, minRect } from './decorate.js';
import * as Y from './shipyard.js';
import { ensureCCW, area, centroid, bbox } from '../geo.js';

const PURPOSE_TYPE = { production: 'hall', admin: 'office', warehouse: 'warehouse', engineering: 'utility', third: 'foreign' };
// прежний тип остаётся, если не противоречит назначению по схеме
const COMPAT = {
  production: ['hall', 'elling', 'elling_historic', 'historic_hall'],
  admin: ['office', 'checkpoint', 'historic'],
  warehouse: ['warehouse', 'warehouse_historic'],
  engineering: ['utility'],
  third: ['foreign'],
};
const TABLE = new Map();
for (const r of SITE_TABLE) (TABLE.get(r.num) || TABLE.set(r.num, []).get(r.num)).push(r);

const mpArea = (mp) => mp.reduce((s, poly) => s + poly.reduce((t, ring, i) => t + (i ? -area(ring) : area(ring)), 0), 0);
function overlap(a, b) {
  try {
    return mpArea(pc.intersection([[a]], [[b]]));
  } catch {
    return 0;
  }
}
const bbHit = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const clean = (s) => s.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/\(\s+/g, '(').replace(/"\s+/g, '"').replace(/\s+"/g, ' "').trim();

// Высота и этажность нового здания по назначению, названию и размерам (схема высот не содержит)
const hallHeight = (wid) => Math.max(9, Math.min(28, 6 + 0.5 * Math.min(wid, 36)));
export function estimateGp(purpose, name, A, len, wid) {
  const nm = name.toLowerCase();
  const m = /(\d+)\s*-?\s*(х\s*)?этаж/.exec(nm);
  const named = m ? +m[1] : null;
  if (/будк|бытовк|контейнер|ларёк|ларек|киоск/.test(nm)) return { h: named === 2 ? 5.6 : 2.9, floors: named || 1 };
  if (purpose === 'engineering') {
    if (/котельн/.test(nm)) return { h: 9, floors: 1 };
    if (/компрессорн|кислородн|ацетилен/.test(nm)) return { h: 7, floors: 1 };
    if (/градирн/.test(nm)) return { h: 9, floors: 1 };
    if (/цистерн|бак /.test(nm)) return { h: 7, floors: 1 };
    if (/очистн/.test(nm)) return { h: 5, floors: 1 };
    if (/подстанц|ктпн|бктп|тп-|пп-|трансформ/.test(nm)) return { h: 4.2, floors: 1 };
    if (/насосн|бкнс|овс|станци|водомерн/.test(nm)) return { h: 4.5, floors: 1 };
    return { h: A > 300 ? 6.5 : 4.5, floors: 1 };
  }
  if (purpose === 'warehouse') {
    if (/ангар/.test(nm)) return { h: 7, floors: 1 };
    if (/склад|кладов|магазин/.test(nm)) return { h: A > 800 ? 9 : A > 300 ? 7 : 5, floors: named || 1 };
    return { h: named ? named * 3.2 + 0.6 : A > 400 ? 7 : 4.5, floors: named || 1 };
  }
  if (purpose === 'admin') {
    const floors = named || (A > 700 ? 3 : A > 250 ? 2 : 1);
    return { h: +(floors * 3.4 + 0.8).toFixed(1), floors };
  }
  // производственное и стороннее
  if (A > 400) return { h: +hallHeight(wid).toFixed(1), floors: named || undefined };
  return { h: A > 120 ? 7 : 4.5, floors: named || 1 };
}

function pickType(purpose, donorType, name) {
  if (/проходн/i.test(name)) return 'checkpoint';
  if (purpose === 'production' && /эллинг/i.test(name)) return donorType === 'elling_historic' ? 'elling_historic' : 'elling';
  if (donorType && COMPAT[purpose].includes(donorType)) return donorType;
  return PURPOSE_TYPE[purpose];
}

// описание прежнего здания без заметок о контуре и высоте (они теперь другие)
function keepInfo(text) {
  if (!text) return '';
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/Контур\s*—|Высота\s*—|Высота оценена|ML Buildings|OpenStreetMap|по карте|Часть общего контура|Ранее в модели|назначение оценочное|Положение условное/i.test(s))
    .join(' ')
    .trim();
}
const GENERIC = /^(Вспомогательное здание|Цех|Склад|Административно-бытовой корпус|Производственный корпус|Эллинг|Пристройка к производственному комплексу|Производственное здание)$/;

export function applySiteData(oldYard, { zoneOf }) {
  const yard = oldYard.filter((b) => b.kind === 'shipyard');
  const rest = oldYard.filter((b) => b.kind !== 'shipyard');
  const olds = yard.map((b) => ({ b, ring: ensureCCW(b.poly), bb: bbox(b.poly), A: area(b.poly), hits: [] }));
  // контуры дымовых труб — сооружения (site-structures.js), не здания
  const gps = SITE_BUILDINGS.filter((g) => !SITE_CHIMNEY_NUMS.has(g.nums[0])).map((g) => {
    const rings = [ensureCCW(g.poly), ...g.parts.map((p) => ensureCCW(p.poly))];
    const pts = rings.flat();
    return { g, rings, bb: bbox(pts), A: rings.reduce((s, r) => s + area(r), 0), hits: [] };
  });
  for (const G of gps) {
    for (const O of olds) {
      if (!bbHit(G.bb, O.bb)) continue;
      const inter = G.rings.reduce((s, r) => s + overlap(r, O.ring), 0);
      if (inter > 1) {
        G.hits.push({ O, inter });
        O.hits.push({ G, inter });
      }
    }
  }
  // код прежнего здания переходит к тому новому контуру, который накрывает его больше всего
  const idOf = new Map();
  const idMap = {};
  const dropped = [];
  for (const O of olds.sort((a, b) => b.A - a.A)) {
    const best = O.hits.sort((a, b) => b.inter - a.inter)[0];
    if (!best || best.inter < 0.3 * Math.min(O.A, best.G.A) || best.inter < 0.15 * O.A) {
      const covered = +((O.hits.reduce((s, h) => s + h.inter, 0) / O.A).toFixed(2));
      if (!zoneOf(centroid(O.ring))) {
        // за границей участков верфи: не завода, остаётся как окружающая застройка
        rest.push({ ...O.b, kind: 'context', zone: undefined, detail: 'full', info: [O.b.info, 'За территорией завода.'].filter(Boolean).join(' ') });
        dropped.push({ id: O.b.id, name: O.b.name, area: Math.round(O.A), covered, kept: 'context' });
      } else dropped.push({ id: O.b.id, name: O.b.name, area: Math.round(O.A), covered });
      continue;
    }
    if (!idOf.has(best.G)) idOf.set(best.G, O.b.id);
    idMap[O.b.id] = idOf.get(best.G);
  }
  const notes = [];
  const buildings = [];
  let unnamed = 0;
  const ordered = gps.slice().sort((a, b) => Math.round(a.bb.minY / 10) - Math.round(b.bb.minY / 10) || a.bb.minX - b.bb.minX);
  for (const G of ordered) {
    const g = G.g;
    const main = ensureCCW(g.poly);
    const c = centroid(main);
    const rows = g.nums.flatMap((n) => TABLE.get(n) || []);
    const row = rows[0];
    const fanLetter = g.fan ? 'абвгдежзик'[g.fanIdx] : '';
    const id = idOf.get(G) || (g.nums.length ? `G${g.nums.join('-')}${fanLetter}` : `GN${++unnamed}`);
    const donor = G.hits.sort((a, b) => b.inter - a.inter).find((h) => h.inter >= 0.25 * G.A || h.inter >= 0.6 * h.O.A)?.O.b || null;
    const donorFits = donor && (G.A < 0.35 * area(donor.poly) ? donor.type && COMPAT[g.purpose].includes(donor.type) : true);
    const mr = minRect(main);
    const len = Math.max(mr.w, mr.d);
    const wid = Math.min(mr.w, mr.d);
    const purpose = g.purpose;
    const migrated = idOf.get(G) ? SITE_MIGRATED[idOf.get(G)] : null;
    const officialName = row ? clean(row.name) : `${PURPOSE_RU[purpose][0].toUpperCase()}${PURPOSE_RU[purpose].slice(1)} здание без номера`;
    const name = row ? officialName : purpose === 'third' ? 'Объект сторонней организации' : 'Здание без номера объектов';
    const est = estimateGp(purpose, name, G.A, len, wid);
    // будки, бытовки, контейнеры: тип и высота — по названию, а не по прежнему (оценочному) зданию
    const lowByName = /будк|бытовк|контейнер|ларёк|ларек|киоск/i.test(name);
    const type = lowByName && purpose !== 'third' ? 'utility' : pickType(purpose, donorFits && !lowByName ? donor.type : null, name);
    // проходные и КПП — низкие павильоны: высота прежнего многоэтажного контура к ним не относится
    const lowCheckpoint = type === 'checkpoint' && G.A < 600 && donorFits && donor.h > 9;
    const useDonorH = donorFits && donor.h && !lowByName && !lowCheckpoint && (!donor.approx || (G.A >= 0.5 * area(donor.poly) && purpose !== 'engineering'));
    const h = useDonorH ? donor.h : lowCheckpoint ? 4.2 : est.h;
    const floors = useDonorH ? donor.floors || est.floors : lowCheckpoint ? 1 : est.floors;
    const idx = g.nums.length ? +g.nums[0] : unnamed + 500;
    const wall = (donorFits && donor.wall) || (type === 'office' || type === 'checkpoint' ? Y.OFFICE_WALLS[idx % Y.OFFICE_WALLS.length] : type === 'utility' ? (idx % 3 ? 'light' : 'brick_dark') : type === 'foreign' ? 'gray' : type === 'warehouse' ? (idx % 2 ? 'light' : 'panel') : Y.HALL_WALLS[idx % Y.HALL_WALLS.length]);
    const roofColor = (donorFits && donor.roof?.color) || (type === 'office' || type === 'utility' || type === 'checkpoint' ? 'r_dark' : type === 'foreign' ? 'r_gray' : Y.HALL_ROOFS[idx % Y.HALL_ROOFS.length]);
    // описание: сведения из таблицы, прежнее описание и название, источник контура и высоты
    const parts = [];
    const extraNums = g.nums.slice(1).flatMap((n) => (TABLE.get(n) || []).map((r) => `№ ${n} — ${clean(r.name)}${r.lit ? ` (литера ${r.lit})` : ''}`));
    if (rows.length > 1 && rows.filter((r) => r.num === g.nums[0]).length > 1) parts.push(`Под этим номером несколько объектов: ${rows.filter((r) => r.num === g.nums[0]).map((r) => `«${clean(r.name)}»`).join(', ')}.`);
    if (extraNums.length) parts.push((g.nums.slice(1).every((n) => /^(Сооружение|Здание)/i.test(TABLE.get(n)?.[0]?.name || '') && /здание/i.test(TABLE.get(n)?.[0]?.name || '')) ? 'Два объекта в одном контуре, граница между ними не показана: ' : 'В том же контуре: ') + extraNums.join('; ') + '.');
    if (g.fan) parts.push(`Одна из ${g.fan} построек под этим номером.`);
    const oldName = migrated?.name || donor?.name;
    if (donorFits && oldName && oldName !== name && !GENERIC.test(oldName)) parts.push(`Прежнее название в модели: «${oldName}».`);
    const prior = keepInfo(migrated?.info) || (donorFits ? keepInfo(donor.info) : '');
    if (prior) parts.push(prior);
    parts.push(useDonorH ? (donor.approx ? 'Высота оценена.' : donor.geomSrc === 'osm' || /OpenStreetMap/.test(donor.info || '') ? 'Высота — по OpenStreetMap.' : 'Высота — по прежним данным модели.') : 'Высота оценена по назначению и размерам.');
    const b = {
      kind: 'shipyard',
      id,
      zone: zoneOf(c) || (donorFits && donor.zone) || 'kolomna',
      name,
      info: parts.join(' '),
      poly: main,
      holes: g.holes?.length ? g.holes.map(ensureCCW) : undefined,
      geomSrc: 'site',
      h,
      floors,
      type,
      wall,
      roofColor,
      approx: !useDonorH || !!donor.approx,
      refined: migrated?.src || (donorFits ? donor.refined : undefined),
      units: donorFits ? donor.units : undefined,
      sign: donorFits ? donor.sign : undefined,
      reg: { num: g.nums[0] || null, nums: g.nums, inv: row?.inv || null, lit: row?.lit || null, purpose, gid: g.gid, fan: g.fan || null },
    };
    if (/Центральн(ая|ой) проходн/i.test(name) && !b.sign) b.sign = { edge: 0, text: 'АДМИРАЛТЕЙСКИЕ ВЕРФИ' };
    const hints = donorFits && donor.roof ? { roofH: donor.roof.type === 'gable' ? donor.roof.h : undefined, lantern: donor.roof.lantern, hip: donor.roof.type === 'hip' } : null;
    decorate(b, hints);
    // пристройки без номера — части здания: своей высоты (не выше основного объёма)
    if (g.parts.length) {
      const mk = (ring, hh, ff, isMain) => decorate({ ...b, poly: ensureCCW(ring), holes: isMain ? b.holes : undefined, parts: undefined, h: hh, floors: ff, roof: undefined, doors: undefined, roofColor, sign: isMain ? b.sign : undefined }, isMain ? hints : null);
      const list = [mk(main, h, floors, true)];
      for (const p of g.parts) {
        const pr = minRect(ensureCCW(p.poly));
        const pe = estimateGp(purpose, 'пристройка', area(p.poly), Math.max(pr.w, pr.d), Math.min(pr.w, pr.d));
        const ph = Math.min(h, Math.max(3.2, pe.h));
        list.push(mk(p.poly, ph, Math.max(1, Math.min(floors || 1, Math.round(ph / 3.4))), false));
      }
      b.parts = list;
      b.partsCustom = true;
    }
    buildings.push(b);
  }
  // пересечения новых контуров со старыми — для сверки
  for (const G of gps) {
    const id = idOf.get(G);
    if (!id) continue;
    const O = olds.find((o) => o.b.id === id);
    const inter = G.hits.find((h) => h.O === O)?.inter || 0;
    notes.push({ id, iou: +(inter / (G.A + O.A - inter)).toFixed(2) });
  }
  return { buildings: [...buildings, ...rest], dropped, idMap, notes };
}
