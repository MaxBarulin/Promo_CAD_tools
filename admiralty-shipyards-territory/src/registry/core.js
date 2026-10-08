// Реестр зданий и сооружений верфи: состав, расчётные показатели по модели и поля
// технического учёта (ОПО, экспертиза промышленной безопасности, техническое состояние).
// Общий код для просмотрщика и для выгрузки в Node (scripts/export.mjs).

import { toLatLon, centroid, area } from '../geo.js';
import { PURPOSE_SHORT } from '../data/site.js';

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
// Порядок — как в таблице службы: здание, промэкспертиза, ОПО, состояние.
// alt — прежние заголовки столбца: старые выгрузки загружаются без правки.
// aliases — что ещё принимать при загрузке за значение из списка («+» → «да»).
const YES_NO = { options: ['', 'да', 'нет'], aliases: { да: ['+', 'есть', 'yes', '1', 'true', 'v', 'x', 'х'], нет: ['-', '—', '–', 'no', '0', 'false'] } };
export const FIELDS = [
  { key: 'invNo', label: 'Инвентарный №', type: 'text' },
  { key: 'year', label: 'Год постройки', type: 'number' },
  // промэкспертиза: номер заключения, его регистрационный номер в Ростехнадзоре, даты
  { key: 'epbNo', label: '№ заключения ЭПБ', type: 'text' },
  { key: 'epbReg', label: 'Рег. № заключения ЭПБ', type: 'text' },
  { key: 'epbDate', label: 'Дата заключения ЭПБ', type: 'date' },
  { key: 'epbUntil', label: 'Срок безопасной эксплуатации до', type: 'date' },
  // ОПО: класс, регистрационный номер объекта, по каким признакам здание в составе ОПО
  { key: 'opo', label: 'Класс ОПО', alt: ['Класс опасности ОПО'], type: 'select', options: ['', 'I', 'II', 'III', 'IV', 'не ОПО'] },
  { key: 'opoReg', label: 'Рег. № ОПО', type: 'text' },
  { key: 'opoGas', label: 'ОПО: газ', alt: ['ОПО ГАЗ'], type: 'select', flag: true, ...YES_NO },
  { key: 'opoCrane', label: 'ОПО: краны', alt: ['ОПО КРАН', 'ОПО: краны (ПС)'], type: 'select', flag: true, ...YES_NO },
  // состояние
  { key: 'state', label: 'Техническое состояние', type: 'select', options: ['', 'нормативное', 'работоспособное', 'ограниченно работоспособное', 'аварийное'] },
  { key: 'surveyDate', label: 'Дата обследования', type: 'date' },
  { key: 'conserved', label: 'Консервация', alt: ['Консерва', 'Законсервировано'], type: 'select', flag: true, ...YES_NO },
  { key: 'note', label: 'Примечание', type: 'text' },
];
export const FIELD_KEYS = FIELDS.map((f) => f.key);

// Состав реестра: здания верфи, стапели, краны, плавдоки, дымовые трубы, заводские мосты,
// площадки и плиты, объекты без контура.
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
      // габариты: заданные размеры, иначе стороны наименьшего прямоугольника вокруг контура
      const dims = i.dims ? [Math.max(...i.dims.slice(0, 2)), Math.min(...i.dims.slice(0, 2))] : poly && cat !== 'device' ? minRect(poly) : null;
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
        length: dims ? dims[0] : null,
        width: dims ? dims[1] : null,
        totalArea: cat === 'building' ? i.totalArea : null,
        volume: cat === 'building' ? i.volume : null,
        estimated: !!i.approx,
        // службы (столовая, медпункт, КПП…) — вместе с подразделениями
        occupants: [unitList(i.units, 'occupant'), ...(i.services || []).map((s) => s[0].toUpperCase() + s.slice(1))].filter(Boolean).join('; '),
        owners: unitList(i.units, 'owner'),
        lat: +lat.toFixed(6),
        lon: +lon.toFixed(6),
        center: c,
      });
    }
  }
  const order = { building: 0, structure: 1, device: 2 };
  return items.sort((a, b) => order[a.cat] - order[b.cat] || a.zone.localeCompare(b.zone, 'ru') || (b.footprint || 0) - (a.footprint || 0));
}

// Стороны наименьшего по площади прямоугольника, описанного вокруг контура: [длина, ширина], м.
// Для Г-образных и сложных контуров — габариты по внешним граням.
export function minRect(ring) {
  const pts = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
  if (pts.length < 2) return null;
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < 1e-9) continue;
    const ux = (b[0] - a[0]) / d;
    const uy = (b[1] - a[1]) / d;
    let lo1 = Infinity;
    let hi1 = -Infinity;
    let lo2 = Infinity;
    let hi2 = -Infinity;
    for (const p of hull) {
      const s1 = p[0] * ux + p[1] * uy;
      const s2 = -p[0] * uy + p[1] * ux;
      if (s1 < lo1) lo1 = s1;
      if (s1 > hi1) hi1 = s1;
      if (s2 < lo2) lo2 = s2;
      if (s2 > hi2) hi2 = s2;
    }
    const w = hi1 - lo1;
    const h = hi2 - lo2;
    if (!best || w * h < best[0] * best[1]) best = [w, h];
  }
  if (!best) return null;
  const r = (v) => Math.round(v * 10) / 10;
  return [r(Math.max(best[0], best[1])), r(Math.min(best[0], best[1]))];
}

// Выпуклая оболочка (Эндрю), точки против часовой стрелки
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
  // несуществующая дата (31.02.2025) — не дата, а не «3 марта»
  const ymd = (y, mo, d) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
  };
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
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

// Столбцы таблицы и выгрузки. Порядок — как в таблице службы эксплуатации: сначала здание
// и промэкспертиза, расчётные размеры и сведения модели — в конце. group — заголовок группы
// (вторая строка шапки в Excel), field — заполняет служба, list/range — проверка ввода.
const fieldCol = (key, group, extra = {}) => {
  const f = FIELDS.find((x) => x.key === key);
  return { key, label: f.label, w: f.type === 'date' ? 16 : f.flag ? 10 : key === 'note' ? 30 : 18, date: f.type === 'date', num: f.type === 'number', field: true, flag: !!f.flag, list: f.type === 'select' ? f.options.filter(Boolean) : undefined, range: key === 'year' ? [1700, 2100] : undefined, group, ...extra };
};
export const COLUMNS = [
  { key: 'name', label: 'Наименование', w: 42, group: 'Здание' },
  { key: 'regNum', label: '№ объекта', w: 10, group: 'Здание' },
  { key: 'lit', label: 'Литера', w: 8, group: 'Здание' },
  // инвентарный номер один: из данных модели, служба эксплуатации может уточнить
  fieldCol('invNo', 'Здание', { w: 14, fallback: (it) => it.inv }),
  { key: 'purpose', label: 'Назначение', w: 24, group: 'Здание' },
  fieldCol('year', 'Здание', { w: 12 }),
  fieldCol('epbNo', 'Промэкспертиза'),
  fieldCol('epbReg', 'Промэкспертиза'),
  fieldCol('epbDate', 'Промэкспертиза'),
  fieldCol('epbUntil', 'Промэкспертиза', { w: 20 }),
  { key: 'epbStatus', label: 'Статус ЭПБ', w: 13, group: 'Промэкспертиза' },
  fieldCol('opo', 'ОПО', { w: 11 }),
  fieldCol('opoReg', 'ОПО'),
  fieldCol('opoGas', 'ОПО'),
  fieldCol('opoCrane', 'ОПО'),
  fieldCol('state', 'Состояние', { w: 22 }),
  fieldCol('surveyDate', 'Состояние'),
  fieldCol('conserved', 'Состояние', { w: 12 }),
  fieldCol('note', 'Состояние'),
  { key: 'length', label: 'Длина, м', w: 11, num: true, group: 'Размеры по модели' },
  { key: 'width', label: 'Ширина, м', w: 11, num: true, group: 'Размеры по модели' },
  { key: 'height', label: 'Высота, м', w: 11, num: true, group: 'Размеры по модели' },
  { key: 'floors', label: 'Этажность', w: 10, num: true, group: 'Размеры по модели' },
  { key: 'footprint', label: 'Площадь застройки, м²', w: 14, num: true, group: 'Размеры по модели' },
  { key: 'totalArea', label: 'Общая площадь (оценка), м²', w: 16, num: true, group: 'Размеры по модели' },
  { key: 'volume', label: 'Строительный объём (оценка), м³', w: 18, num: true, group: 'Размеры по модели' },
  { key: 'zone', label: 'Участок', w: 24, group: 'Размещение' },
  { key: 'occupants', label: 'Подразделения в здании', w: 36, group: 'Размещение' },
  { key: 'owners', label: 'Отвечает за здание', w: 30, group: 'Размещение' },
  { key: 'kind', label: 'Тип в модели', w: 26, group: 'Модель' },
  { key: 'lat', label: 'Широта', w: 11, num: true, group: 'Модель' },
  { key: 'lon', label: 'Долгота', w: 11, num: true, group: 'Модель' },
  { key: 'id', label: 'Код в модели', w: 12, group: 'Модель' },
];
// Группы столбцов подряд: [{ label, from, to }] (индексы столбцов)
export function columnGroups(columns = COLUMNS) {
  const out = [];
  columns.forEach((c, i) => {
    const last = out[out.length - 1];
    if (last && last.label === (c.group || '') && last.to === i - 1) last.to = i;
    else out.push({ label: c.group || '', from: i, to: i });
  });
  return out;
}

export function toRows(items, records, years) {
  return items.map((it) => {
    const r = records[it.id] || {};
    const row = {};
    for (const c of COLUMNS) {
      if (c.field) row[c.key] = (r[c.key] ?? '') !== '' ? r[c.key] : c.fallback ? c.fallback(it) ?? '' : '';
      else if (c.key === 'epbStatus') row[c.key] = STATUS_NAMES[epbStatus(r, years)];
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
// problems — сюда попадают пропущенные значения: не из списка, неверная дата или число
// ({ id, label, value, why }).
const YEAR_RANGE = [1700, 2100];
const latinRoman = (s) => s.replace(/[Іі]/g, 'I').replace(/[Vv]/g, 'V');
export function rowsToRecords(table, problems = []) {
  const norm = (h) => String(h ?? '').trim().toLowerCase();
  // строка заголовков — та, где есть «Код в модели» (в выгрузке над ней строка групп)
  const headIdx = table.slice(0, 5).findIndex((r) => (r || []).some((h) => norm(h) === 'код в модели'));
  if (headIdx < 0) throw new Error('В таблице нет столбца «Код в модели» — используйте выгрузку из реестра как шаблон.');
  const head = table[headIdx].map(norm);
  const col = (label) => head.indexOf(label.toLowerCase());
  const idCol = col('Код в модели');
  const map = FIELDS.map((f) => ({ f, i: [f.label, ...(f.alt || [])].map(col).find((i) => i >= 0) ?? -1 })).filter((x) => x.i >= 0);
  const out = {};
  for (const row of table.slice(headIdx + 1)) {
    const id = String(row[idCol] ?? '').trim();
    if (!id) continue;
    const rec = {};
    for (const { f, i } of map) {
      let v = row[i];
      if (v === undefined || v === null || v === '') continue;
      const bad = (why) => problems.push({ id, label: f.label, value: String(v).trim(), why });
      if (f.type === 'date') {
        const d = typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000) : parseDate(v);
        if (!d) {
          bad('не дата');
          continue;
        }
        v = d.toISOString().slice(0, 10);
      } else if (f.type === 'number') {
        const n = Number(String(v).replace(',', '.'));
        const [lo, hi] = f.key === 'year' ? YEAR_RANGE : [-Infinity, Infinity];
        if (!Number.isFinite(n) || n < lo || n > hi) {
          bad(Number.isFinite(n) ? `вне диапазона ${lo}–${hi}` : 'не число');
          continue;
        }
        v = n;
      } else if (f.type === 'select') {
        // значение из списка, без учёта регистра и латиницы/кириллицы в римских цифрах;
        // у полей «да/нет» принимаются и обозначения вроде «+», «есть»
        const key = latinRoman(String(v).trim()).toLowerCase();
        const opt = f.options.find((o) => o && (latinRoman(o).toLowerCase() === key || (f.aliases?.[o] || []).includes(key)));
        if (!opt) {
          bad('нет в списке: ' + f.options.filter(Boolean).join(', '));
          continue;
        }
        v = opt;
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
    const no = Math.floor(rnd() * 9000) + 1000;
    const hall = /Производственный|Эллинг/.test(it.kind);
    out[it.id] = {
      opo: it.cat === 'device' ? 'IV' : it.cat === 'structure' ? 'III' : rnd() < 0.5 ? 'III' : rnd() < 0.5 ? 'IV' : 'не ОПО',
      epbNo: `ДЕМО-${no}`,
      epbReg: `ДЕМО-19-${no}-${until.getUTCFullYear() - 5}`,
      epbDate: date.toISOString().slice(0, 10),
      epbUntil: until.toISOString().slice(0, 10),
      opoGas: rnd() < 0.15 ? 'да' : 'нет',
      opoCrane: hall && rnd() < 0.7 ? 'да' : 'нет',
      state: ['работоспособное', 'работоспособное', 'ограниченно работоспособное', 'нормативное'][Math.floor(rnd() * 4)],
      conserved: rnd() < 0.08 ? 'да' : 'нет',
      note: 'ДЕМО — условные данные',
    };
  }
  return out;
}
