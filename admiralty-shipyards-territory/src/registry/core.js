// Реестр зданий и сооружений верфи: состав, расчётные показатели по модели и поля
// технического учёта (ОПО, экспертиза промышленной безопасности, техническое состояние).
// Общий код для просмотрщика и для выгрузки в Node (scripts/export.mjs).

import { toLatLon, centroid, area } from '../geo.js';
import { PURPOSE_SHORT } from '../data/plant.js';

export const ZONE_NAMES = {
  galerny: 'Галерный остров',
  kolomna: 'Основная площадка',
  matisov: 'Матисов остров',
  novo: 'Ново-Адмиралтейский остров',
};

const TYPE_NAMES = {
  hall: 'Производственный корпус',
  elling: 'Эллинг',
  elling_historic: 'Эллинг (исторический)',
  warehouse: 'Склад',
  office: 'Административно-бытовой корпус',
  checkpoint: 'Проходная, КПП',
  utility: 'Вспомогательное здание',
  historic: 'Историческое здание',
  foreign: 'Объект сторонней организации',
};

// Поля технического учёта, заполняемые службой эксплуатации зданий.
export const FIELDS = [
  { key: 'invNo', label: 'Инвентарный №', type: 'text' },
  { key: 'year', label: 'Год постройки', type: 'number' },
  // alt — прежние заголовки столбца: старые выгрузки загружаются без правки
  { key: 'opo', label: 'Класс ОПО', alt: ['Класс опасности ОПО'], type: 'select', options: ['', 'I', 'II', 'III', 'IV', 'не ОПО'] },
  { key: 'opoReg', label: 'Рег. № ОПО', type: 'text' },
  { key: 'epbNo', label: '№ заключения ЭПБ', type: 'text' },
  { key: 'epbDate', label: 'Дата заключения ЭПБ', type: 'date' },
  { key: 'epbUntil', label: 'Срок безопасной эксплуатации до', type: 'date' },
  { key: 'state', label: 'Техническое состояние', type: 'select', options: ['', 'нормативное', 'работоспособное', 'ограниченно работоспособное', 'аварийное'] },
  { key: 'surveyDate', label: 'Дата обследования', type: 'date' },
  { key: 'note', label: 'Примечание', type: 'text' },
];
export const FIELD_KEYS = FIELDS.map((f) => f.key);

// Состав реестра: здания верфи, стапели, краны, плавдоки, дымовые трубы, заводские мосты,
// площадки и плиты, объекты, учтённые номером без контура.
const MARKER_KINDS = { quay: 'Набережная, берегоукрепление (сооружение)', pier: 'Причал, пирс (сооружение)', trestle: 'Эстакада (сооружение)', pit: 'Яма трансбордерная (сооружение)', monument: 'Монумент, памятный знак', storage: 'Открытый склад (площадка)', structure: 'Сооружение' };
export function registryItems(model, data) {
  const yardBridges = new Set((data.bridges || []).filter((b) => b.type === 'industrial' || b.yard || b.reg).map((b) => b.id));
  const items = [];
  for (const layer of model.layers) {
    for (const o of layer.objects) {
      const i = o.info;
      if (!i || !o.proxy) continue;
      let cat;
      let kind;
      if (layer.id === 'shipyard') {
        cat = 'building';
        kind = TYPE_NAMES[i.type] || 'Здание';
      } else if (i.kind === 'slipway') {
        cat = 'structure';
        kind = 'Стапель (сооружение)';
      } else if (i.kind === 'crane') {
        cat = 'device';
        kind = 'Грузоподъёмный кран';
      } else if (i.kind === 'chimney') {
        cat = 'structure';
        kind = 'Дымовая труба (сооружение)';
      } else if (i.kind === 'dock') {
        cat = 'structure';
        kind = 'Плавучий док';
      } else if (i.kind === 'bridge' && yardBridges.has(o.id)) {
        cat = 'structure';
        kind = 'Заводской мост (сооружение)';
      } else if (i.kind === 'platform') {
        cat = 'structure';
        kind = i.surface === 'pit' ? 'Яма трансбордерная (сооружение)' : 'Площадка, плита (сооружение)';
      } else if (i.kind === 'marker') {
        cat = 'structure';
        kind = MARKER_KINDS[i.markerKind] || 'Сооружение без контура';
      } else continue;
      const poly = o.proxy.poly;
      const c = poly ? centroid(poly) : o.proxy.line[0];
      const [lat, lon] = toLatLon(c);
      const footprint = cat === 'building' ? i.footprint : i.dims && cat === 'structure' ? Math.round(i.dims[0] * i.dims[1]) : poly && cat === 'structure' ? Math.round(area(poly)) : null;
      items.push({
        id: o.id,
        name: o.name,
        regNum: i.reg?.num ?? '',
        regNums: i.reg?.nums?.length > 1 ? i.reg.nums.join(', ') : '',
        inv: i.reg?.inv || '',
        lit: i.reg?.lit || '',
        purpose: i.reg ? PURPOSE_SHORT[i.reg.purpose] || '' : '',
        cat,
        kind,
        zone: ZONE_NAMES[i.zone] || zoneByPoint(c, data) || '',
        floors: cat === 'building' ? i.floorsEst : null,
        floorsKnown: !!i.floorsKnown,
        floorsText: cat === 'building' ? i.floorsText : null,
        height: i.height ?? (o.proxy.z1 ? Math.round(o.proxy.z1) : null),
        footprint,
        totalArea: cat === 'building' ? i.totalArea : null,
        volume: cat === 'building' ? i.volume : null,
        estimated: !!i.approx,
        // службы по данным предприятия (столовая, медпункт, КПП…) — вместе с подразделениями
        occupants: [unitList(i.units, 'occupant'), ...(i.services || []).map((s) => s[0].toUpperCase() + s.slice(1))].filter(Boolean).join('; '),
        owners: unitList(i.units, 'owner'),
        source: i.geomSrc === 'plant' || (!i.geomSrc && i.reg) ? 'данные предприятия' : i.geomSrc === 'custom' ? 'модель из Blender (custom/)' : i.geomSrc === 'map' ? 'уточнённый контур' : i.geomSrc === 'osm' ? 'OpenStreetMap' : i.geomSrc === 'ml' ? 'Microsoft ML Buildings' : '',
        lat: +lat.toFixed(6),
        lon: +lon.toFixed(6),
        center: c,
      });
    }
  }
  const order = { building: 0, structure: 1, device: 2 };
  return items.sort((a, b) => order[a.cat] - order[b.cat] || a.zone.localeCompare(b.zone, 'ru') || (b.footprint || 0) - (a.footprint || 0));
}

// Подразделения строкой: «Отдел главного механика (Иванов И. И.); Бюро …»
function unitList(units, role) {
  return (units || [])
    .filter((u) => (u.role === 'owner' ? 'owner' : 'occupant') === role)
    .map((u) => (u.person ? `${u.name} (${u.person})` : u.name))
    .join('; ');
}

export function zoneByPoint(p, data) {
  for (const z of data.zones || []) {
    const r = z.polygon;
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
    }
    if (inside) return ZONE_NAMES[z.id];
  }
  return null;
}

// ---------- сроки экспертизы ----------

export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return Number.isNaN(+s) ? null : s;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

export const fmtDate = (s) => {
  const d = parseDate(s);
  return d ? `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}` : '';
};

// Статус по сроку безопасной эксплуатации: overdue / soon (в пределах years лет) / ok / none
export function epbStatus(rec, years, now = new Date()) {
  const d = parseDate(rec && rec.epbUntil);
  if (!d) return 'none';
  if (d < now) return 'overdue';
  const lim = new Date(now);
  lim.setFullYear(lim.getFullYear() + years);
  return d <= lim ? 'soon' : 'ok';
}

export const STATUS_NAMES = { overdue: 'Срок истёк', soon: 'Истекает', ok: 'В порядке', none: 'Нет данных' };

// ---------- табличное представление ----------

export const COLUMNS = [
  { key: 'id', label: 'Код в модели', w: 12 },
  { key: 'name', label: 'Наименование', w: 42 },
  { key: 'regNum', label: '№ объекта', w: 10 },
  // инвентарный номер один: по данным предприятия, служба эксплуатации может уточнить
  { key: 'invNo', label: 'Инвентарный №', w: 14, field: true, fallback: (it) => it.inv },
  { key: 'lit', label: 'Литера', w: 8 },
  { key: 'purpose', label: 'Назначение', w: 24 },
  { key: 'kind', label: 'Тип в модели', w: 26 },
  { key: 'zone', label: 'Участок', w: 24 },
  { key: 'floors', label: 'Этажность', w: 10, num: true },
  { key: 'height', label: 'Высота, м', w: 10, num: true },
  { key: 'footprint', label: 'Площадь застройки, м²', w: 14, num: true },
  { key: 'totalArea', label: 'Общая площадь (оценка), м²', w: 16, num: true },
  { key: 'volume', label: 'Строительный объём (оценка), м³', w: 18, num: true },
  { key: 'occupants', label: 'Подразделения в здании', w: 36 },
  { key: 'owners', label: 'Отвечает за здание', w: 30 },
  ...FIELDS.filter((f) => f.key !== 'invNo').map((f) => ({ key: f.key, label: f.label, w: f.type === 'date' ? 14 : f.key === 'note' ? 30 : 18, date: f.type === 'date', num: f.type === 'number', field: true })),
  { key: 'epbStatus', label: 'Статус ЭПБ', w: 14 },
  { key: 'estimated', label: 'Высота оценена', w: 12 },
  { key: 'lat', label: 'Широта', w: 11, num: true },
  { key: 'lon', label: 'Долгота', w: 11, num: true },
];

export function toRows(items, records, years) {
  return items.map((it) => {
    const r = records[it.id] || {};
    const row = {};
    for (const c of COLUMNS) {
      if (c.field) row[c.key] = (r[c.key] ?? '') !== '' ? r[c.key] : c.fallback ? c.fallback(it) ?? '' : '';
      else if (c.key === 'epbStatus') row[c.key] = STATUS_NAMES[epbStatus(r, years)];
      else if (c.key === 'estimated') row[c.key] = it.estimated ? 'да' : '';
      else row[c.key] = it[c.key] ?? '';
    }
    return row;
  });
}

export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = COLUMNS.map((c) => esc(c.label)).join(';');
  const body = rows.map((r) => COLUMNS.map((c) => esc(c.date ? fmtDate(r[c.key]) : c.num && r[c.key] !== '' ? String(r[c.key]).replace('.', ',') : r[c.key])).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}

// Разбор загруженной таблицы (строки — массивы ячеек): сопоставление по заголовкам.
export function rowsToRecords(table) {
  if (!table.length) return {};
  const head = table[0].map((h) => String(h ?? '').trim().toLowerCase());
  const col = (label) => head.indexOf(label.toLowerCase());
  const idCol = col('Код в модели');
  if (idCol < 0) throw new Error('В таблице нет столбца «Код в модели» — используйте выгрузку из реестра как шаблон.');
  const map = FIELDS.map((f) => ({ f, i: [f.label, ...(f.alt || [])].map(col).find((i) => i >= 0) ?? -1 })).filter((x) => x.i >= 0);
  const out = {};
  for (const row of table.slice(1)) {
    const id = String(row[idCol] ?? '').trim();
    if (!id) continue;
    const rec = {};
    for (const { f, i } of map) {
      let v = row[i];
      if (v === undefined || v === null || v === '') continue;
      if (f.type === 'date') {
        const d = typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000) : parseDate(v);
        if (!d) continue;
        v = d.toISOString().slice(0, 10);
      } else if (f.type === 'number') {
        v = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(v)) continue;
      } else v = String(v).trim();
      rec[f.key] = v;
    }
    if (Object.keys(rec).length) out[id] = rec;
  }
  return out;
}

// Условные значения для демонстрации фильтров (не сохраняются и помечаются в выгрузке).
export function demoRecords(items) {
  const out = {};
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = new Date();
  for (const it of items) {
    if (rnd() < 0.12) continue;
    const until = new Date(Date.UTC(now.getUTCFullYear() - 1 + Math.floor(rnd() * 8), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)));
    const date = new Date(until);
    date.setUTCFullYear(date.getUTCFullYear() - (it.cat === 'device' ? 3 : 5));
    out[it.id] = {
      opo: it.cat === 'device' ? 'IV' : it.cat === 'structure' ? 'III' : rnd() < 0.5 ? 'III' : rnd() < 0.5 ? 'IV' : 'не ОПО',
      epbNo: `ДЕМО-${String(Math.floor(rnd() * 9000) + 1000)}`,
      epbDate: date.toISOString().slice(0, 10),
      epbUntil: until.toISOString().slice(0, 10),
      state: ['работоспособное', 'работоспособное', 'ограниченно работоспособное', 'нормативное'][Math.floor(rnd() * 4)],
      note: 'ДЕМО — условные данные',
    };
  }
  return out;
}
