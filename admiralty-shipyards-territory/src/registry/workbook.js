// Книга Excel реестра: лист «Реестр» (все поля, статус ЭПБ с заливкой) и лист «Справка».

import { writeXlsx } from './xlsx.js';
import { COLUMNS, FIELDS, toRows, parseDate } from './core.js';

const STATUS_STYLE = { 'Срок истёк': 4, Истекает: 5, 'В порядке': 6 };

export function registryXlsx(items, records, { years = 2, demo = false, filterNote = '' } = {}) {
  const rows = toRows(items, records, years);
  const columns = COLUMNS.map((c) => ({
    ...c,
    parseDate: c.date ? parseDate : undefined,
    statusStyle: c.key === 'epbStatus' ? (v) => STATUS_STYLE[v] || 0 : undefined,
    wrap: c.key === 'note',
  }));
  const today = new Date();
  const info = [
    ['Выгрузка', `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`],
    ['Объектов в выгрузке', String(rows.length)],
    ...(filterNote ? [['Отбор', filterNote]] : []),
    ...(demo ? [['ВНИМАНИЕ', 'Демо-режим: поля ЭПБ и технического состояния заполнены условными значениями для показа возможностей. Это не реальные данные предприятия.']] : []),
    ['Статус ЭПБ', `По сроку безопасной эксплуатации: «Срок истёк» — дата уже прошла; «Истекает» — в ближайшие ${years} г.; «В порядке» — позже; «Нет данных» — срок не указан.`],
    ['Как заполнить', `Впишите данные в столбцы: ${FIELDS.map((f) => f.label).join(', ')}. Столбец «Код в модели» не меняйте — по нему строки сопоставляются с объектами. Даты — в формате ДД.ММ.ГГГГ. Затем загрузите файл в реестр кнопкой «Загрузить таблицу».`],
    ['Расчётные показатели', 'Площадь застройки — по контуру здания (за вычетом дворов). Этажность — по OpenStreetMap, для цехов и складов без данных — 1, для остальных — по высоте. Общая площадь — площадь застройки × этажность. Строительный объём — площадь застройки × высоту до средней отметки кровли. Высоты цехов верфи в открытых данных отсутствуют и оценены — такие строки отмечены в столбце «Высота/объём — оценка».'],
    ['Источники контуров', 'OpenStreetMap и Microsoft ML Buildings (через Overture Maps, лицензия ODbL), карта предприятия.'],
  ];
  return writeXlsx([
    { name: 'Реестр', columns, rows },
    {
      name: 'Справка',
      columns: [
        { key: 'k', label: 'Параметр', w: 26 },
        { key: 'v', label: 'Значение', w: 110, wrap: true },
      ],
      rows: info.map(([k, v]) => ({ k, v })),
      freeze: false,
      filter: false,
    },
  ]);
}
