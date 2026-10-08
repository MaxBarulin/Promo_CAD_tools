// Реестр зданий и сооружений в просмотрщике: таблица с отбором по сроку экспертизы
// промышленной безопасности, подсветка на модели, правка полей в карточке объекта,
// загрузка и выгрузка Excel/CSV.
//
// Хранение полей технического учёта:
//   • опубликованная страница — общая база (capability `db`, коллекция `registry`):
//     правки видны всем, кому открыт доступ;
//   • локальный файл — localStorage этого браузера (обмен — через Excel).

import { registryItems, FIELDS, FIELD_KEYS, epbStatus, STATUS_NAMES, fmtDate, toRows, toCSV, rowsToRecords, demoRecords, ZONE_NAMES, COLUMNS } from '../registry/core.js';
import { registryXlsx } from '../registry/workbook.js';
import { readXlsx, readCsv } from '../registry/xlsx.js';
import { offsetRing } from '../model/buildings.js';
import { ensureCCW } from '../geo.js';

const LS_KEY = 'admiralty-registry-v1';
const STATUS_COLORS = { overdue: 0xd23c2a, soon: 0xe8a317, ok: 0x2f9a5a, none: 0x7d8a96 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('ru-RU'));

export function setupRegistry({ $, THREE, V3, data, model, pickMesh, scene, select, focusObject, artifactBuild, onOpen }) {
  let items = registryItems(model, data);
  let byId = new Map(items.map((i) => [i.id, i]));
  let objById = new Map(pickMesh.userData.objects.map((o) => [o.id, o]));
  let demoRecs = demoRecords(items);

  let saved = {}; // id → поля учёта (из хранилища)
  let demo = false;
  let canWrite = true;
  let shared = false;
  let db = null;
  let downloads = null;
  const st = { q: '', cat: '', zone: '', opo: '', epb: '', years: 2, sort: { key: 'name', dir: 1 }, show: true, open: false, min: false };
  const records = () => (demo ? demoRecs : saved);

  // ---------- хранилище ----------
  try {
    saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  async function saveRecord(id, rec) {
    const clean = Object.fromEntries(FIELD_KEYS.filter((k) => rec[k] !== undefined && rec[k] !== '').map((k) => [k, rec[k]]));
    if (shared && db) {
      try {
        await db.doc('registry/' + id).set({ ...clean, name: byId.get(id)?.name || '', updatedAt: new Date().toISOString() });
      } catch (e) {
        if (e && e.code === 'invalid_argument') {
          canWrite = false;
          renderAll();
        }
        throw e;
      }
    } else {
      saved = { ...saved, [id]: clean };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(saved));
      } catch {
        /* хранилище браузера недоступно — правки живут до перезагрузки */
      }
    }
    if (!shared) renderAll();
  }

  // общая база опубликованной страницы
  if (window.claude && typeof window.claude.use === 'function') {
    (async () => {
      db = await window.claude.use('db');
      if (db) {
        shared = true;
        db.collection('registry').onSnapshot(
          (snap) => {
            const next = {};
            for (const d of snap.docs) {
              const body = d.data() || {};
              next[d.id] = Object.fromEntries(FIELD_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
            }
            saved = next;
            renderAll();
          },
          () => {
            shared = false;
            renderAll();
          },
        );
        const user = await window.claude.use('user');
        if (user) {
          const w = await user.can('data.write');
          if (w === false) canWrite = false;
        }
        renderAll();
      }
      downloads = await window.claude.use('downloads');
      renderAll();
    })();
  }

  // ---------- отбор ----------
  function filtered() {
    const recs = records();
    const q = st.q.trim().toLowerCase();
    const list = items.filter((it) => {
      const r = recs[it.id] || {};
      if (st.cat && it.cat !== st.cat) return false;
      if (st.zone && it.zone !== st.zone) return false;
      if (st.opo === '-' ? r.opo : st.opo && r.opo !== st.opo) return false;
      if (st.epb) {
        const s = epbStatus(r, st.years);
        if (st.epb === 'due' ? s !== 'soon' && s !== 'overdue' : s !== st.epb) return false;
      }
      if (q && !`${it.id} ${it.name} ${it.kind} №${it.regNum} ${it.regNums} ${it.inv} ${it.lit} ${it.purpose} ${it.occupants} ${r.invNo || ''} ${r.opoReg || ''} ${r.epbNo || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const { key, dir } = st.sort;
    const val = (it) => {
      const r = recs[it.id] || {};
      if (key === 'epbUntil') return r.epbUntil || '9999';
      if (key === 'opo') return r.opo || 'я';
      return it[key] ?? '';
    };
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'ru', { numeric: true })) * dir;
    });
  }
  const filterNote = () =>
    [
      st.cat && { building: 'здания', structure: 'сооружения', device: 'краны' }[st.cat],
      st.zone,
      st.opo && (st.opo === '-' ? 'класс ОПО не указан' : `класс ОПО: ${st.opo}`),
      st.epb && { due: `ЭПБ истекает в ближайшие ${st.years} г. или истекла`, soon: `ЭПБ истекает в ближайшие ${st.years} г.`, overdue: 'срок ЭПБ истёк', none: 'нет данных об ЭПБ', ok: 'ЭПБ в порядке' }[st.epb],
      st.q && `поиск: «${st.q}»`,
    ]
      .filter(Boolean)
      .join('; ');

  // ---------- подсветка на модели ----------
  let overlay = null;
  function updateOverlay(list) {
    if (overlay) {
      scene.remove(overlay);
      overlay.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      overlay = null;
    }
    if (!st.open || !st.show) return;
    const recs = records();
    const buckets = {};
    for (const it of list) {
      const o = objById.get(it.id);
      if (!o || !o.proxy.poly) continue;
      const s = epbStatus(recs[it.id], st.years);
      (buckets[s] ||= []).push(o.proxy);
    }
    overlay = new THREE.Group();
    overlay.name = 'registry-overlay';
    for (const [s, proxies] of Object.entries(buckets)) {
      const pos = [];
      for (const p of proxies) {
        const ring = offsetRing(ensureCCW(p.poly), 0.8);
        const z0 = Math.max(0.2, p.z0);
        const z1 = p.z1 + 0.6;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const A0 = V3(a[0], a[1], z0);
          const B0 = V3(b[0], b[1], z0);
          const A1 = V3(a[0], a[1], z1);
          const B1 = V3(b[0], b[1], z1);
          pos.push(A0.x, A0.y, A0.z, B0.x, B0.y, B0.z, B1.x, B1.y, B1.z, A0.x, A0.y, A0.z, B1.x, B1.y, B1.z, A1.x, A1.y, A1.z);
        }
        for (let i = 1; i < ring.length - 1; i++) {
          for (const q of [ring[0], ring[i], ring[i + 1]]) {
            const v = V3(q[0], q[1], z1);
            pos.push(v.x, v.y, v.z);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: STATUS_COLORS[s], transparent: true, opacity: s === 'none' ? 0.28 : 0.55, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 5;
      overlay.add(m);
    }
    scene.add(overlay);
  }

  // ---------- интерфейс ----------
  const panel = $('registry');
  const zones = [...new Set(items.map((i) => i.zone).filter(Boolean))];
  panel.innerHTML = `
    <div class="reg-head">
      <h2>Реестр зданий и сооружений</h2>
      <span class="reg-store" id="regStore"></span>
      <button class="icon-btn fold" type="button" id="regMin" aria-expanded="true" title="Свернуть реестр" aria-label="Свернуть реестр"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
      <button class="x" type="button" id="regClose" aria-label="Закрыть реестр" title="Закрыть реестр">×</button>
    </div>
    <div class="reg-demo" id="regDemo" hidden>Демо-режим: поля ОПО, ЭПБ и технического состояния заполнены условными значениями для показа возможностей. Это условные значения, они не сохраняются.</div>
    <div class="reg-filters">
      <input type="search" id="regQ" placeholder="Поиск: название, код, № объекта, инв. №, № ЭПБ" aria-label="Поиск" />
      <select id="regCat" aria-label="Вид объекта"><option value="">Все объекты</option><option value="building">Здания</option><option value="structure">Сооружения</option><option value="device">Краны</option></select>
      <select id="regZone" aria-label="Участок"><option value="">Все участки</option>${zones.map((z) => `<option>${esc(z)}</option>`).join('')}</select>
      <select id="regOpo" aria-label="Класс ОПО"><option value="">Любой класс ОПО</option>${['I', 'II', 'III', 'IV', 'не ОПО'].map((c) => `<option value="${c}">${c === 'не ОПО' ? 'Не ОПО' : 'Класс ' + c}</option>`).join('')}<option value="-">Класс не указан</option></select>
      <select id="regEpb" aria-label="Срок ЭПБ"><option value="">ЭПБ: все</option><option value="due">ЭПБ истекает или истекла</option><option value="soon">ЭПБ истекает</option><option value="overdue">Срок ЭПБ истёк</option><option value="ok">ЭПБ в порядке</option><option value="none">Нет данных об ЭПБ</option></select>
      <select id="regYears" aria-label="Горизонт"><option value="1">в течение 1 года</option><option value="2" selected>в течение 2 лет</option><option value="3">в течение 3 лет</option><option value="5">в течение 5 лет</option></select>
      <label class="toggle"><input type="checkbox" id="regShow" checked /><span class="box"></span>На модели</label>
    </div>
    <div class="reg-stats" id="regStats"></div>
    <div class="reg-table-wrap"><table class="reg-table"><thead id="regHead"></thead><tbody id="regBody"></tbody></table></div>
    <div class="reg-actions">
      <button class="btn" type="button" id="regXlsx">Скачать Excel</button>
      <button class="btn" type="button" id="regCsv">CSV</button>
      <label class="btn reg-file" id="regImportLabel">Загрузить таблицу<input type="file" id="regFile" accept=".xlsx,.csv,text/csv" hidden /></label>
      <button class="btn" type="button" id="regDemoBtn" aria-pressed="false">Демо-данные</button>
      <span class="reg-msg" id="regMsg" aria-live="polite"></span>
    </div>`;

  const COLS = [
    ['id', 'Код'],
    ['name', 'Наименование'],
    ['regNum', '№ объекта'],
    ['purpose', 'Назначение'],
    ['zone', 'Участок'],
    ['floors', 'Эт.'],
    ['height', 'H, м'],
    ['footprint', 'S застр., м²'],
    ['volume', 'V, м³'],
    ['opo', 'Класс ОПО'],
    ['epbUntil', 'ЭПБ до'],
  ];
  $('regHead').innerHTML = `<tr>${COLS.map(([k, l]) => `<th data-k="${k}" scope="col"><button type="button">${l}</button></th>`).join('')}</tr>`;
  $('regHead').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const k = th.dataset.k;
    st.sort = { key: k, dir: st.sort.key === k ? -st.sort.dir : 1 };
    renderTable();
  });

  const bind = (id, key, conv = (v) => v) =>
    $(id).addEventListener(id === 'regQ' ? 'input' : 'change', (e) => {
      st[key] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value);
      renderAll();
    });
  bind('regQ', 'q');
  bind('regCat', 'cat');
  bind('regZone', 'zone');
  bind('regOpo', 'opo');
  bind('regEpb', 'epb');
  bind('regYears', 'years', Number);
  bind('regShow', 'show');
  $('regClose').addEventListener('click', () => toggle(false));
  $('regMin').addEventListener('click', () => setMin(!st.min));
  $('regDemoBtn').addEventListener('click', () => {
    demo = !demo;
    $('regDemoBtn').setAttribute('aria-pressed', String(demo));
    $('regDemoBtn').classList.toggle('active', demo);
    renderAll();
  });

  $('regBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const o = objById.get(tr.dataset.id);
    if (o) {
      if (window.matchMedia('(max-width: 760px)').matches) setMin(true); // на телефоне — к карточке объекта
      select(o);
      focusObject(o);
    }
  });

  // выгрузка
  async function offerFile(name, blobOrText, mime) {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
    if (artifactBuild) {
      if (!downloads) return msg('Скачивание недоступно в этом окне просмотра.');
      try {
        await downloads.save({ filename: name, data: blob });
        msg('Файл сохранён.');
      } catch (e) {
        if (e && e.code === 'declined') msg('Скачивание отменено.');
        else if (e && e.code === 'rate_limited') msg('Подождите немного и повторите.');
        else msg('Не удалось сохранить файл.');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('regXlsx').addEventListener('click', () => {
    const list = filtered();
    const bytes = registryXlsx(list, records(), { years: st.years, demo, filterNote: filterNote() });
    offerFile(`reestr-zdaniy-admiralty-shipyards-${stamp()}${demo ? '-DEMO' : ''}.xlsx`, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });
  $('regCsv').addEventListener('click', () => {
    const list = filtered();
    offerFile(`reestr-zdaniy-admiralty-shipyards-${stamp()}${demo ? '-DEMO' : ''}.csv`, toCSV(toRows(list, records(), st.years)), 'text/csv');
  });

  // загрузка
  const inflateRaw = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  $('regFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (demo) return msg('Выключите демо-режим перед загрузкой реальных данных.');
    if (!canWrite) return msg('У вас доступ только для просмотра реестра.');
    try {
      const table = /\.csv$/i.test(f.name) ? readCsv(await f.text()) : await readXlsx(new Uint8Array(await f.arrayBuffer()), inflateRaw);
      const problems = [];
      const recs = rowsToRecords(table, problems);
      const ids = Object.keys(recs).filter((id) => byId.has(id));
      const unknown = Object.keys(recs).length - ids.length;
      let n = 0;
      for (const id of ids) {
        const rec = { ...recs[id] };
        // инвентарный номер из выгрузки, совпадающий с исходным, — не правка
        if (rec.invNo && rec.invNo === (byId.get(id)?.inv || '')) delete rec.invNo;
        if (!Object.keys(rec).length) continue;
        await saveRecord(id, { ...(saved[id] || {}), ...rec });
        n++;
        if (n % 10 === 0) msg(`Загружено ${n} из ${ids.length}…`);
      }
      const bad = problems.length ? `; пропущено значений с ошибкой: ${problems.length} (${problems.slice(0, 4).map((p) => `${p.id}, «${p.label}»: «${p.value}» — ${p.why}`).join('; ')}${problems.length > 4 ? '; …' : ''})` : '';
      msg(`Обновлено объектов: ${n}${unknown ? `; не найдено в модели: ${unknown}` : ''}${bad}.`, problems.length ? 40000 : 8000);
    } catch (err) {
      msg(err && err.message ? err.message : 'Не удалось прочитать файл.');
    }
  });

  let msgTimer = null;
  function msg(t, ms = 8000) {
    $('regMsg').textContent = t;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => ($('regMsg').textContent = ''), ms);
  }

  function renderTable() {
    const list = filtered();
    const recs = records();
    const counts = { overdue: 0, soon: 0, ok: 0, none: 0 };
    for (const it of list) counts[epbStatus(recs[it.id], st.years)]++;
    $('regStats').innerHTML = `Показано <b>${list.length}</b> из ${items.length} · <span class="st overdue">срок истёк: ${counts.overdue}</span> · <span class="st soon">истекает за ${st.years} г.: ${counts.soon}</span> · <span class="st ok">в порядке: ${counts.ok}</span> · <span class="st none">нет данных: ${counts.none}</span>`;
    for (const th of $('regHead').querySelectorAll('th')) th.setAttribute('aria-sort', th.dataset.k === st.sort.key ? (st.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    $('regBody').innerHTML = list
      .map((it) => {
        const r = recs[it.id] || {};
        const s = epbStatus(r, st.years);
        return `<tr data-id="${esc(it.id)}" tabindex="0">
          <td class="mono">${esc(it.id)}</td>
          <td>${esc(it.name)}${it.kind !== it.name ? `<small>${esc(it.kind)}</small>` : ''}</td>
          <td class="mono">${esc(it.regNum === '' ? '—' : it.regNum)}${it.regNums ? `<small>${esc(it.regNums)}</small>` : ''}</td>
          <td>${esc(it.purpose || '—')}${r.invNo || it.inv ? `<small>инв. ${esc(r.invNo || it.inv)}${it.lit ? `, лит. ${esc(it.lit)}` : ''}</small>` : ''}</td>
          <td>${esc(it.zone)}</td>
          <td class="n">${it.floors ?? '—'}</td>
          <td class="n">${num(it.height)}</td>
          <td class="n">${num(it.footprint)}</td>
          <td class="n">${num(it.volume)}</td>
          <td>${esc(r.opo || '—')}</td>
          <td><span class="st ${s}">${r.epbUntil ? fmtDate(r.epbUntil) : STATUS_NAMES.none}</span></td>
        </tr>`;
      })
      .join('');
    updateOverlay(list);
  }

  function renderAll() {
    $('regDemo').hidden = !demo;
    $('regStore').textContent = demo ? 'демо' : shared ? (canWrite ? 'общий реестр — правки видны всем с доступом' : 'общий реестр — только просмотр') : 'данные хранятся в этом браузере';
    $('regImportLabel').hidden = !canWrite;
    const dlOff = artifactBuild && !downloads;
    $('regXlsx').hidden = dlOff;
    $('regCsv').hidden = dlOff;
    renderTable();
    refreshCard();
    updateBadge();
  }

  // свёрнутый реестр — одна строка заголовка; отбор и подсветка на модели остаются
  function setMin(on) {
    st.min = on;
    panel.classList.toggle('min', on);
    document.body.classList.toggle('reg-min', on);
    const t = on ? 'Развернуть реестр' : 'Свернуть реестр';
    $('regMin').setAttribute('aria-expanded', String(!on));
    $('regMin').setAttribute('aria-label', t);
    $('regMin').title = t;
  }

  function toggle(on) {
    st.open = on ?? !st.open;
    panel.hidden = !st.open;
    setMin(false);
    if (st.open && onOpen) onOpen();
    document.body.classList.toggle('reg-open', st.open);
    $('regOpen').setAttribute('aria-expanded', String(st.open));
    renderTable();
  }
  $('regOpen').addEventListener('click', () => toggle());

  function updateBadge() {
    const recs = records();
    let due = 0;
    let none = 0;
    for (const it of items) {
      const s = epbStatus(recs[it.id], st.years);
      if (s === 'soon' || s === 'overdue') due++;
      if (s === 'none') none++;
    }
    // сводка — в подсказке кнопки «Учёт»
    $('regOpen').title = `Реестр зданий и сооружений: ${items.length} объектов · ЭПБ истекает за ${st.years} г. или истекла: ${due}${none === items.length ? ' · сроки ещё не внесены' : ''}`;
  }

  // ---------- блок в карточке объекта ----------
  let cardObj = null;
  let cardEl = null;
  let editing = false;
  function refreshCard() {
    if (cardObj && cardEl && !editing) decorateCard(cardEl, cardObj);
  }
  function decorateCard(card, o) {
    cardObj = o;
    cardEl = card;
    card.querySelector('.reg-card')?.remove();
    if (!o || !byId.has(o.id)) return;
    const it = byId.get(o.id);
    const r = records()[o.id] || {};
    const s = epbStatus(r, st.years);
    const box = document.createElement('div');
    box.className = 'reg-card';
    const rows = [
      ['Общая площадь', it.totalArea ? `${num(it.totalArea)} м² (оценка)` : null],
      ['Строительный объём', it.volume ? `${num(it.volume)} м³${it.estimated ? ' (оценка)' : ''}` : null],
      // инвентарный номер по умолчанию — из данных модели
      ...FIELDS.map((f) => [f.label, f.type === 'date' ? fmtDate(r[f.key]) : r[f.key] ?? (f.key === 'invNo' ? it.inv || undefined : undefined)]),
    ].filter(([, v]) => v !== null);
    box.innerHTML = `<h4>Технический учёт <span class="st ${s}">${STATUS_NAMES[s]}</span></h4>
      ${demo ? '<p class="reg-demo-note">Демо: условные значения</p>' : ''}
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === undefined || v === '' ? '<span class="empty">не указано</span>' : esc(v)}</dd>`).join('')}</dl>
      ${canWrite && !demo ? '<div class="row"><button class="btn" type="button" data-act="edit">Заполнить данные</button></div>' : ''}`;
    box.querySelector('[data-act="edit"]')?.addEventListener('click', () => editForm(box, o, r));
    card.appendChild(box);
  }
  function editForm(box, o, r) {
    editing = true;
    box.innerHTML = `<h4>Технический учёт — правка</h4>
      <form class="reg-form">${FIELDS.map((f) => {
        const v = r[f.key] ?? (f.key === 'invNo' ? byId.get(o.id)?.inv || '' : '');
        const id = `rf-${f.key}`;
        const input =
          f.type === 'select'
            ? `<select id="${id}" name="${f.key}">${f.options.map((op) => `<option value="${esc(op)}"${op === v ? ' selected' : ''}>${op || '—'}</option>`).join('')}</select>`
            : `<input id="${id}" name="${f.key}" type="${f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" />`;
        return `<label for="${id}">${esc(f.label)}</label>${input}`;
      }).join('')}
      <div class="row"><button class="btn active" type="submit">Сохранить</button><button class="btn" type="button" data-act="cancel">Отмена</button></div></form>`;
    const form = box.querySelector('form');
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      editing = false;
      decorateCard(cardEl, o);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const rec = {};
      for (const f of FIELDS) {
        let v = String(fd.get(f.key) ?? '').trim();
        if (f.type === 'number' && v !== '') v = Number(v);
        rec[f.key] = v;
      }
      // совпадает с исходным — отдельно не хранится
      if (rec.invNo === (byId.get(o.id)?.inv || '')) rec.invNo = '';
      form.querySelector('[type="submit"]').disabled = true;
      try {
        await saveRecord(o.id, rec);
        editing = false;
        decorateCard(cardEl, o);
      } catch {
        form.querySelector('[type="submit"]').disabled = false;
        box.insertAdjacentHTML('beforeend', '<p class="reg-demo-note">Не удалось сохранить: нет прав на запись.</p>');
      }
    });
  }

  // после правок модели в редакторе: состав и расчётные показатели — заново
  function refresh() {
    items = registryItems(model, data);
    byId = new Map(items.map((i) => [i.id, i]));
    objById = new Map(pickMesh.userData.objects.map((o) => [o.id, o]));
    demoRecs = demoRecords(items);
    renderAll();
  }

  renderAll();
  return {
    decorateCard,
    toggle,
    isOpen: () => st.open,
    refresh,
    get items() {
      return items;
    },
  };
}

export { ZONE_NAMES, COLUMNS };
