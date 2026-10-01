// Вкладка «Объекты верфи» левой панели: список зданий, сооружений, кранов и судов
// предприятия с поиском и отбором по типу, сгруппированный по участкам.
// Щелчок по строке — выбрать объект и подлететь к нему.

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
  { id: 'structure', name: 'Стапели, краны, мосты', test: (i) => STRUCTURES.includes(i.kind) },
  { id: 'vessel', name: 'Суда и плавдоки', test: (i) => i.kind === 'vessel' || i.kind === 'dock' },
];

const KIND_NAMES = { vessel: 'Судно', dock: 'Плавучий док', crane: 'Кран', slipway: 'Стапель', bridge: 'Заводской мост', chimney: 'Дымовая труба' };
const LAYERS = new Set(['shipyard', 'production', 'vessels', 'bridges']);
const WATER = 'Акватория';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function setupObjectList({ $, data, pickMesh, registryItems, onPick }) {
  const reg = new Map(registryItems.map((i) => [i.id, i]));
  const list = [];
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
      text: `${o.id} ${o.name} ${kind}`.toLowerCase(),
    });
  }
  // крупные объекты — выше: по ним чаще всего ищут
  list.sort((a, b) => b.size - a.size);
  const byId = new Map(list.map((it) => [it.id, it]));
  const zoneOrder = [...Object.values(ZONE_NAMES), WATER];

  const st = { q: '', type: '' };
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
    const b = e.target.closest('button.obj');
    if (b && byId.has(b.dataset.id)) onPick(byId.get(b.dataset.id).o);
  });

  const row = (it) => {
    const meta = [it.id, it.kind !== it.name ? it.kind : null, it.size ? `${it.size.toLocaleString('ru-RU')} м²` : null].filter(Boolean).join(' · ');
    return `<button class="obj" type="button" data-id="${esc(it.id)}"${it.id === activeId ? ' aria-current="true"' : ''}><span class="obj-name">${esc(it.name)}</span><span class="obj-meta">${esc(meta)}</span></button>`;
  };

  function render() {
    const q = st.q.trim().toLowerCase();
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
    if (!$('paneObjects').hidden) b.scrollIntoView({ block: 'nearest' });
  }

  render();
  return { setActive, total: list.length };
}
