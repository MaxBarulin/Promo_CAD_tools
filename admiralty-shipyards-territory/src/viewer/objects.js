// Вкладка «Объекты верфи» левой панели: список зданий, сооружений, кранов, судов и автобусов
// предприятия с поиском и отбором по типу, сгруппированный по участкам.
// Щелчок по строке — выбрать объект и подлететь к нему.
// Режим «Подразделения»: службы, отделы, бюро и их здания (кто размещается, кто отвечает),
// поиск по названию подразделения и ответственному, показ всех зданий службы на модели.

import { ZONE_NAMES, zoneByPoint } from '../registry/core.js';
import { centroid, area } from '../geo.js';

const HALLS = ['hall', 'elling', 'elling_historic'];
const OFFICES = ['office', 'checkpoint', 'historic'];
const STRUCTURES = ['slipway', 'crane', 'chimney', 'bridge'];

const TYPES = [
  { id: '', name: 'Все типы' },
  { id: 'hall', name: 'Цеха и эллинги', test: (i) => HALLS.includes(i.type) },
  { id: 'office', name: 'Административные, проходные', test: (i) => OFFICES.includes(i.type) },
  { id: 'warehouse', name: 'Склады', test: (i) => i.type === 'warehouse' },
  { id: 'utility', name: 'Вспомогательные здания', test: (i) => i.type === 'utility' },
  { id: 'foreign', name: 'Объекты сторонних организаций', test: (i) => i.type === 'foreign' },
  { id: 'structure', name: 'Стапели, краны, мосты', test: (i) => STRUCTURES.includes(i.kind) },
  { id: 'vessel', name: 'Суда и плавдоки', test: (i) => i.kind === 'vessel' || i.kind === 'dock' },
  { id: 'bus', name: 'Автобусы', test: (i) => i.kind === 'bus' },
];

const KIND_NAMES = { vessel: 'Судно', dock: 'Плавучий док', crane: 'Кран', slipway: 'Стапель', bridge: 'Заводской мост', chimney: 'Дымовая труба', bus: 'Внутризаводской автобус', platform: 'Площадка, плита', marker: 'Сооружение без контура', service: 'Отметка' };
const LAYERS = new Set(['shipyard', 'production', 'vessels', 'bridges']);
const WATER = 'Акватория';
const TRANSPORT = 'Транспорт';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// extra — объекты не из призмы выбора (движущиеся автобусы)
export function setupObjectList({ $, data, pickMesh, registryItems, onPick, onShowMany, extra = () => [] }) {
  let list = [];
  let byId = new Map();
  let units = []; // [{ name, items: [{ it, role, person }] }]
  function collect(regItems) {
    const reg = new Map(regItems.map((i) => [i.id, i]));
    list = [];
    for (const o of pickMesh.userData.objects) {
      if (o.scope !== 'yard' || !LAYERS.has(o.layer)) continue;
      const r = reg.get(o.id);
      const c = o.proxy.poly ? centroid(o.proxy.poly) : o.proxy.line[0];
      const kind = r?.kind || KIND_NAMES[o.info.kind] || 'Объект';
      list.push({
        o,
        id: o.id,
        name: o.name,
        kind: kind.replace(/ \(сооружение\)$/, ''),
        zone: r?.zone || ZONE_NAMES[o.info.zone] || zoneByPoint(c, data) || WATER,
        size: r?.footprint ?? (o.proxy.poly ? Math.round(area(o.proxy.poly)) : 0),
        text: `${o.id} ${o.name} ${kind} ${o.info.reg?.num ? `№${o.info.reg.num} ${(o.info.reg.nums || []).join(' ')} ${o.info.reg.inv || ''} ${o.info.reg.lit || ''}` : ''} ${(o.info.units || []).map((u) => `${u.name} ${u.person || ''}`).join(' ')} ${(o.info.services || []).join(' ')}`.toLowerCase(),
      });
    }
    for (const o of extra()) {
      const kind = KIND_NAMES[o.info.kind] || 'Объект';
      list.push({ o, id: o.id, name: o.name, kind, zone: TRANSPORT, size: 0, text: `${o.id} ${o.name} ${kind} ${o.info.info || ''}`.toLowerCase() });
    }
    // подразделения — по всем объектам, где они указаны
    const map = new Map();
    for (const o of pickMesh.userData.objects) {
      for (const u of o.info?.units || []) {
        if (!map.has(u.name)) map.set(u.name, { name: u.name, items: [] });
        map.get(u.name).items.push({ o, role: u.role === 'owner' ? 'owner' : 'occupant', person: u.person || '' });
      }
    }
    units = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    // крупные объекты — выше: по ним чаще всего ищут
    list.sort((a, b) => b.size - a.size);
    byId = new Map(list.map((it) => [it.id, it]));
  }
  collect(registryItems);
  const zoneOrder = [...Object.values(ZONE_NAMES), WATER, TRANSPORT];

  const st = { q: '', type: '', mode: 'objects' };
  let activeId = null;

  $('objType').innerHTML = TYPES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  $('objQ').addEventListener('input', (e) => {
    st.q = e.target.value;
    render();
  });
  $('objType').addEventListener('change', (e) => {
    st.type = e.target.value;
    render();
  });
  $('objList').addEventListener('click', (e) => {
    const show = e.target.closest('button[data-unit]');
    if (show) {
      const u = units.find((x) => x.name === show.dataset.unit);
      if (u) onShowMany(u.items.map((x) => x.o));
      return;
    }
    const b = e.target.closest('button.obj');
    if (!b) return;
    const o = byId.get(b.dataset.id)?.o || pickMesh.userData.objects.find((x) => x.id === b.dataset.id);
    if (o) onPick(o);
  });
  const setMode = (mode) => {
    st.mode = mode;
    $('objModeObjects').setAttribute('aria-pressed', String(mode === 'objects'));
    $('objModeUnits').setAttribute('aria-pressed', String(mode === 'units'));
    $('objType').hidden = mode === 'units';
    $('objQ').placeholder = mode === 'units' ? 'Подразделение или ответственный' : 'Название или код, например Z129';
    $('objHint').textContent = mode === 'units' ? 'Щелчок по зданию — подлететь к нему; «Показать на модели» — все здания подразделения.' : 'Щелчок по строке — подлететь к объекту и открыть карточку.';
    render();
  };
  $('objModeObjects').addEventListener('click', () => setMode('objects'));
  $('objModeUnits').addEventListener('click', () => setMode('units'));

  const row = (it) => {
    const meta = [it.id, it.kind !== it.name ? it.kind : null, it.size ? `${it.size.toLocaleString('ru-RU')} м²` : null].filter(Boolean).join(' · ');
    return `<button class="obj" type="button" data-id="${esc(it.id)}"${it.id === activeId ? ' aria-current="true"' : ''}><span class="obj-name">${esc(it.name)}</span><span class="obj-meta">${esc(meta)}</span></button>`;
  };

  const ROLE = { occupant: 'размещается', owner: 'отвечает за здание' };
  function renderUnits(q) {
    const shown = units.filter((u) => !q || `${u.name} ${u.items.map((x) => `${x.person} ${x.o.name} ${x.o.id}`).join(' ')}`.toLowerCase().includes(q));
    $('objList').innerHTML = shown.length
      ? shown
          .map(
            (u) => `<details class="obj-group"${q || shown.length <= 3 ? ' open' : ''}><summary>${esc(u.name)}<span class="count">${u.items.length}</span></summary>
            <button type="button" class="btn unit-show" data-unit="${esc(u.name)}">Показать на модели</button>
            ${u.items
              .map((x) => `<button class="obj" type="button" data-id="${esc(x.o.id)}"${x.o.id === activeId ? ' aria-current="true"' : ''}><span class="obj-name">${esc(x.o.name)}</span><span class="obj-meta">${esc([x.o.id, ROLE[x.role], x.person].filter(Boolean).join(' · '))}</span></button>`)
              .join('')}</details>`,
          )
          .join('')
      : units.length
        ? '<p class="obj-empty">Ничего не найдено.</p>'
        : '<p class="obj-empty">Подразделения пока не указаны. Откройте здание, нажмите «Изменить» и заполните блок «Подразделения».</p>';
    const n = units.length;
    const word = n % 10 === 1 && n % 100 !== 11 ? 'подразделение' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'подразделения' : 'подразделений';
    $('objCount').textContent = n ? (shown.length === n ? `${n} ${word}` : `${shown.length} из ${n}`) : '';
  }

  function render() {
    const q = st.q.trim().toLowerCase();
    if (st.mode === 'units') return renderUnits(q);
    const type = TYPES.find((t) => t.id === st.type);
    const shown = list.filter((it) => (!type?.test || type.test(it.o.info)) && (!q || it.text.includes(q)));
    const groups = zoneOrder.map((z) => ({ z, items: shown.filter((it) => it.zone === z) })).filter((g) => g.items.length);
    $('objList').innerHTML = groups.length
      ? groups.map((g) => `<details class="obj-group" open><summary>${esc(g.z)}<span class="count">${g.items.length}</span></summary>${g.items.map(row).join('')}</details>`).join('')
      : '<p class="obj-empty">Ничего не найдено. Попробуйте другое название или код объекта.</p>';
    $('objCount').textContent = shown.length === list.length ? `${list.length} объектов` : `${shown.length} из ${list.length}`;
  }

  // отметить объект, выбранный на модели или в реестре
  function setActive(id) {
    activeId = id && byId.has(id) ? id : null;
    for (const b of $('objList').querySelectorAll('button.obj[aria-current]')) b.removeAttribute('aria-current');
    if (!activeId) return;
    const b = $('objList').querySelector(`button.obj[data-id="${CSS.escape(activeId)}"]`);
    if (!b) return;
    b.setAttribute('aria-current', 'true');
    const group = b.closest('details');
    if (group && !group.open) group.open = true;
    if (!$('searchDrop').hidden) b.scrollIntoView({ block: 'nearest' });
  }

  render();
  return {
    setActive,
    // после правок модели в редакторе
    refresh(regItems) {
      collect(regItems);
      render();
      setActive(activeId);
    },
  };
}
