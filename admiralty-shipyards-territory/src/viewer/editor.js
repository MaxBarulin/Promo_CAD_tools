// Редактор зданий на сайте: сведения (название, тип, этажность, высота, отделка, описание),
// положение (координаты, стрелки, поворот, точка на карте), удаление, замена моделью из Blender,
// новые здания — коробкой по размерам или моделью .glb.
//
// Правки — те же записи, что в custom/custom.json (см. model/custom.js). Где хранятся:
//   • опубликованная страница — общая база (capability `db`): коллекция `edits` (запись на объект),
//     модели .glb — в `edit-models` частями по 200 тыс. знаков base64 (документ базы — до 256 КиБ);
//     правки видят все, кому открыт доступ;
//   • локальный файл — этот браузер (localStorage, модели — IndexedDB).
// «Скачать изменения» — архив для папки custom/: после сборки правки становятся частью модели.

import { BUILDING_TYPES, WALLS, ROOF_TYPES, ROOF_COLORS, DATA_KEYS, UNIT_ROLES, cleanUnits, editBuilding, boxBuilding, placeModel, modelBuilding, modelObject, patchInfo, analyzeGlb, moveObject, moveDataItem, objectPivot, NEW_LAYERS, LAYER_KIND } from '../model/custom.js';
import { makeBuildingObject, buildingLayer } from '../model/index.js';
import { buildingSummary } from '../model/buildings.js';
import { Sink } from '../model/geom.js';
import { PALETTE } from '../model/materials.js';
import { zipStore, unzipFiles } from '../registry/xlsx.js';
import { centroid } from '../geo.js';

const LS_KEY = 'admiralty-edits-v1';
const TYPE_NAMES = {
  hall: 'Производственный корпус',
  elling: 'Эллинг',
  elling_historic: 'Эллинг (исторический)',
  warehouse: 'Склад',
  office: 'Административно-бытовой корпус',
  checkpoint: 'Проходная, КПП',
  utility: 'Вспомогательное здание',
  historic: 'Историческое здание',
};
const EDITABLE_KINDS = new Set(['building', 'context', 'crane', 'vessel', 'dock', 'slipway', 'bridge', 'fence', 'chimney', 'landmark', 'misc']);
const BUILDING_KINDS = new Set(['building', 'context']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const wallName = (k) => (PALETTE[k]?.name || k).replace(/^Стена_/, '').replace(/_/g, ' ');
const roofColorName = (k) => (k ? (PALETTE[k]?.name || k).replace(/^Кровля_/, '').replace(/_/g, ' ') : '');
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const has = (v) => v !== undefined && v !== null && v !== '';

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Подтверждение повторным нажатием: первое нажатие меняет надпись, второе (в течение 4 с) — выполняет.
function armed(btn, question) {
  if (btn.dataset.armed) return true;
  const text = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = question;
  btn.classList.add('armed');
  setTimeout(() => {
    delete btn.dataset.armed;
    btn.textContent = text;
    btn.classList.remove('armed');
  }, 4000);
  return false;
}

// ---------- IndexedDB: модели .glb локальной версии ----------
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('admiralty-edits', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', mode);
    const req = fn(tx.objectStore('models'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const idbGet = (k) => idbOp('readonly', (s) => s.get(k));
const idbPut = (k, v) => idbOp('readwrite', (s) => s.put(v, k));
const idbDel = (k) => idbOp('readwrite', (s) => s.delete(k));

export function setupEditor(api) {
  const { $, THREE, V3, scene, camera, controls, model, data, getMaterial, origBuildings, origData, buildTime, contextDetail, artifactBuild } = api;
  const ctx = { inYard: api.inYard, zoneOf: api.zoneOf };

  // ---------- состояние ----------
  const base = {
    remove: new Set(buildTime.config.remove || []),
    buildings: buildTime.config.buildings || {},
    files: Object.fromEntries(Object.keys(buildTime.custom.models).map((id) => [id, buildTime.files.find((f) => f.file === buildTime.custom.models[id].file)])),
  };
  let ui = { remove: new Set(), buildings: {}, models: {} }; // models: код → { file, bytes, a, stored? }
  const analysisCache = new Map();
  const analysis = (bytes) => {
    if (!analysisCache.has(bytes)) analysisCache.set(bytes, analyzeGlb(bytes));
    return analysisCache.get(bytes);
  };
  // объекты после сборки (для восстановления кранов, судов и т. п. после отмены правок)
  const origObjects = new Map();
  for (const l of model.layers) for (const o of l.objects) if (o.info) origObjects.set(o.id, { layerId: l.id, o });

  let mode = 'local'; // local | shared
  let canWrite = true;
  let db = null;
  let downloads = null;
  const storedChunks = new Map(); // код → число частей модели в общей базе
  let storageNote = '';

  const effective = (id) => (base.buildings[id] || ui.buildings[id] ? { ...(base.buildings[id] || {}), ...(ui.buildings[id] || {}) } : null);
  const isRemoved = (id) => base.remove.has(id) || ui.remove.has(id);
  function modelFor(id) {
    if (ui.models[id]) return ui.models[id];
    const f = base.files[id];
    return f ? { file: f.file, bytes: f.bytes, a: analysis(f.bytes) } : null;
  }
  const bytesFor = (id) => modelFor(id)?.bytes || null;
  function findObject(id) {
    for (const l of model.layers) {
      const i = l.objects.findIndex((o) => o.id === id);
      if (i >= 0) return { layer: l, o: l.objects[i], index: i };
    }
    return null;
  }
  const lowDetail = (b) => (contextDetail === 'low' && b.kind === 'context' ? { ...b, detail: 'low' } : b);

  // ---------- перестройка одного объекта по правкам ----------
  function apply(id) {
    const dirty = new Set();
    const cur = findObject(id);
    if (cur) {
      cur.layer.objects.splice(cur.index, 1);
      dirty.add(cur.layer.id);
    }
    api.detachModel(id);
    api.removeSigns(id);
    syncData();
    if (isRemoved(id)) return dirty;
    const e = effective(id);
    const mdl = modelFor(id);
    const orig = origBuildings.get(id);
    let obj = null;
    let layerId = null;
    if (mdl) {
      const m = { file: mdl.file, ...placeModel(mdl.a, e) };
      if (orig) {
        const b = editBuilding(orig, e);
        obj = patchInfo(modelObject(makeBuildingObject(b), m, Sink), e);
        layerId = buildingLayer(b);
      } else if (origObjects.has(id)) {
        const oo = origObjects.get(id);
        obj = patchInfo(modelObject(oo.o, m, Sink), e);
        layerId = oo.layerId;
      } else {
        const b = modelBuilding(id, m, e, ctx);
        layerId = NEW_LAYERS[e?.layer] ? e.layer : buildingLayer(b);
        obj = { id, name: b.name, sink: new Sink(), custom: m.file, transform: m.transform, info: { ...buildingSummary(b), kind: LAYER_KIND[layerId] }, proxy: { poly: m.hull, z0: m.z0, z1: m.z1 }, scope: b.kind === 'shipyard' ? 'yard' : 'city' };
      }
    } else if (orig) {
      const b = lowDetail(editBuilding(orig, e));
      const signs = [];
      obj = makeBuildingObject(b, signs);
      layerId = buildingLayer(b);
      api.addSigns(signs);
    } else if (e?.box) {
      const b = boxBuilding(id, e, ctx);
      obj = makeBuildingObject(b);
      layerId = buildingLayer(b);
    } else if (origObjects.has(id)) {
      const oo = origObjects.get(id);
      obj = patchInfo(moveObject(oo.o, e), e);
      layerId = oo.layerId;
    }
    if (!obj) return dirty;
    model.layers.find((l) => l.id === layerId).objects.push(obj);
    dirty.add(layerId);
    if (obj.custom) api.attachModel(obj, layerId, mdl.bytes);
    return dirty;
  }
  // данные кранов, судов, мостов… — без удалённых (по ним строятся DXF и GeoJSON)
  function syncData() {
    for (const k of DATA_KEYS) {
      if (k === 'buildings' || !origData[k]) continue;
      data[k] = origData[k]
        .filter((o) => !isRemoved(o.id) && !(o.onSlip && isRemoved(o.onSlip)) && !(o.onDock && isRemoved(o.onDock)))
        .map((o) => {
          const e = effective(o.id);
          const oo = origObjects.get(o.id)?.o;
          return e && (e.move || e.rotate) && oo && !modelFor(o.id) ? moveDataItem(o, objectPivot((oo.unmoved || oo).proxy), e) : o;
        });
    }
  }
  function applyMany(ids, selectId) {
    const dirty = new Set();
    for (const id of ids) for (const l of apply(id)) dirty.add(l);
    api.rebuildLayers([...dirty]);
    api.refreshAll(selectId);
    renderSummary();
  }

  // ---------- хранение ----------
  function serializeLocal() {
    return JSON.stringify({ remove: [...ui.remove], buildings: ui.buildings, models: Object.fromEntries(Object.entries(ui.models).map(([id, m]) => [id, { file: m.file }])) });
  }
  async function loadLocal() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved) return;
    ui = { remove: new Set(saved.remove || []), buildings: saved.buildings || {}, models: {} };
    for (const [id, m] of Object.entries(saved.models || {})) {
      try {
        const buf = await idbGet(id);
        if (buf) {
          const bytes = new Uint8Array(buf);
          ui.models[id] = { file: m.file, bytes, a: analysis(bytes) };
        }
      } catch {
        storageNote = 'модели .glb из прошлого сеанса недоступны: браузер не даёт хранилище';
      }
    }
  }
  async function persistLocal(id) {
    try {
      localStorage.setItem(LS_KEY, serializeLocal());
    } catch {
      storageNote = 'браузер не даёт сохранить правки — они действуют до перезагрузки';
    }
    if (id === undefined) return;
    try {
      if (ui.models[id]) await idbPut(id, ui.models[id].bytes.buffer.slice(ui.models[id].bytes.byteOffset, ui.models[id].bytes.byteOffset + ui.models[id].bytes.byteLength));
      else await idbDel(id);
    } catch {
      storageNote = 'модели .glb хранятся только до перезагрузки: браузер не даёт хранилище';
    }
  }
  // общая база опубликованной страницы
  const CHUNK = 200000;
  const chunkRef = (id, i) => db.collection('edit-models').doc(`${id}--${i}`);
  async function dropChunks(id, from = 0) {
    const n = storedChunks.get(id) || 0;
    for (let i = from; i < n; i++) await chunkRef(id, i).delete();
    if (!from) storedChunks.delete(id);
  }
  async function persistShared(id) {
    const ref = db.collection('edits').doc(id);
    const e = ui.buildings[id];
    const m = ui.models[id];
    if (m && !m.stored) {
      const b64 = bytesToB64(m.bytes);
      const n = Math.ceil(b64.length / CHUNK);
      const key = `${b64.length}-${Date.now()}`;
      for (let i = 0; i < n; i++) await chunkRef(id, i).set({ data: b64.slice(i * CHUNK, (i + 1) * CHUNK), key });
      await dropChunks(id, n);
      storedChunks.set(id, n);
      m.stored = { chunks: n, key };
    } else if (!m && storedChunks.get(id)) await dropChunks(id);
    if (!e && !m && !ui.remove.has(id)) return ref.delete();
    return ref.set({ entry: e || null, removed: ui.remove.has(id), model: m ? { file: m.file, chunks: m.stored.chunks, key: m.stored.key } : null, updatedAt: new Date().toISOString() });
  }
  async function persist(ids) {
    for (const id of ids) {
      if (mode === 'shared') await persistShared(id);
      else await persistLocal(id);
    }
    if (mode === 'local' && !ids.length) await persistLocal();
  }
  async function onSharedSnapshot(snap) {
    const next = { remove: new Set(), buildings: {}, models: {} };
    for (const d of snap.docs) {
      const v = d.data() || {};
      if (v.removed) next.remove.add(d.id);
      if (v.entry) next.buildings[d.id] = v.entry;
      if (v.model?.key) {
        storedChunks.set(d.id, v.model.chunks);
        const old = ui.models[d.id];
        if (old && old.stored?.key === v.model.key) next.models[d.id] = old;
        else {
          try {
            let b64 = '';
            for (let i = 0; i < v.model.chunks; i++) b64 += (await chunkRef(d.id, i).get()).data()?.data || '';
            const bytes = b64ToBytes(b64);
            next.models[d.id] = { file: v.model.file, bytes, a: analysis(bytes), stored: { chunks: v.model.chunks, key: v.model.key } };
          } catch {
            storageNote = `не удалось загрузить модель ${v.model.file}`;
          }
        }
      }
    }
    const ids = new Set([...ui.remove, ...Object.keys(ui.buildings), ...Object.keys(ui.models), ...next.remove, ...Object.keys(next.buildings), ...Object.keys(next.models)]);
    const changed = [...ids].filter((id) => JSON.stringify([ui.remove.has(id), ui.buildings[id], ui.models[id]?.stored?.key]) !== JSON.stringify([next.remove.has(id), next.buildings[id], next.models[id]?.stored?.key]));
    ui = next;
    if (session && changed.includes(session.id)) endSession(false);
    if (changed.length) applyMany(changed, api.selectedId());
    else renderSummary();
  }

  // ---------- сеанс правки ----------
  let session = null;
  let pickPoint = false;

  function editableKind(o) {
    return o && o.info && EDITABLE_KINDS.has(o.info.kind);
  }
  function startEdit(id, preset = null) {
    if (session) endSession(false);
    const cur = findObject(id);
    const mdl = preset?.model || modelFor(id);
    const isBuilding = !cur || BUILDING_KINDS.has(cur.o.info?.kind) || !!effective(id)?.box;
    const oo = origObjects.get(id)?.o;
    // двигать и заменять моделью можно любой объект с контуром выбора: краны, трубы, суда, мосты…
    const movable = isBuilding || !!mdl || !!(oo && objectPivot((oo.unmoved || oo).proxy));
    session = {
      id,
      isNew: !cur,
      isBuilding,
      movable,
      draft: preset?.draft || { ...(effective(id) || {}) },
      hadUnits: !!(effective(id)?.units || cur?.o.info?.units?.length),
      model: preset?.model || null, // новая модель .glb (ещё не сохранена)
      dropModel: false,
      layerId: cur?.layer.id || null,
      preview: null,
      holder: null,
    };
    // здание на время правки рисуется отдельно (предпросмотр); у кранов, судов и т. п. правятся только сведения
    if (cur && movable) {
      api.rebuildLayers([cur.layer.id], new Set([id]));
      api.setModelVisible(id, false);
      api.setSignsVisible(id, false);
    }
    if (!session.draft.units && cur?.o.info?.units) session.draft.units = cur.o.info.units.map((u) => ({ ...u }));
    if (mdl && !session.dropModel) setPreviewModel(mdl);
    updatePreview();
    renderForm();
  }
  // все известные названия подразделений — для подсказок при вводе
  function knownUnits() {
    const names = new Set();
    for (const l of model.layers) for (const o of l.objects) for (const u of o.info?.units || []) names.add(u.name);
    for (const e of [...Object.values(base.buildings), ...Object.values(ui.buildings)]) for (const u of e.units || []) if (u?.name) names.add(u.name);
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }
  function unitsHtml() {
    const list = session.draft.units || [];
    return list
      .map(
        (u, i) => `<div class="ed-unit" data-i="${i}">
          <input class="field" data-u="name" list="edUnitNames" placeholder="Отдел, служба, управление, бюро" value="${esc(u.name || '')}" aria-label="Подразделение" />
          <button type="button" class="icon-btn" data-act="delunit" data-i="${i}" aria-label="Убрать подразделение" title="Убрать">×</button>
          <select class="field" data-u="role" aria-label="Роль">${Object.entries(UNIT_ROLES).map(([k, v]) => `<option value="${k}"${(u.role || 'occupant') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <input class="field" data-u="person" placeholder="Ответственный: ФИО, телефон" value="${esc(u.person || '')}" aria-label="Ответственный" />
        </div>`,
      )
      .join('');
  }
  function renderUnits() {
    const box = $('edUnits');
    if (box) box.innerHTML = unitsHtml() || '<p class="ed-hint">Подразделения не указаны.</p>';
  }
  function currentModel() {
    if (session.dropModel) return null;
    return session.model || modelFor(session.id);
  }
  function setPreviewModel(mdl) {
    if (session.holder) {
      scene.remove(session.holder);
      session.holder = null;
    }
    if (!mdl) return;
    session.holder = api.makeModelHolder(mdl.bytes);
    scene.add(session.holder);
  }
  // здание по черновику: { kind: 'model' | 'building' | 'other', proxy, … }
  function draftState() {
    const e = session.draft;
    const mdl = currentModel();
    if (mdl) {
      const p = placeModel(mdl.a, e);
      return { kind: 'model', proxy: { poly: p.hull, z0: p.z0, z1: p.z1 }, transform: p.transform, a: mdl.a };
    }
    const orig = origBuildings.get(session.id);
    if (orig) {
      const obj = makeBuildingObject(lowDetail(editBuilding(orig, e)));
      return { kind: 'building', obj, proxy: obj.proxy };
    }
    if (e.box) {
      const obj = makeBuildingObject(boxBuilding(session.id, e, ctx));
      return { kind: 'building', obj, proxy: obj.proxy };
    }
    const oo = origObjects.get(session.id)?.o;
    if (oo && session.movable) {
      const obj = moveObject(oo, e);
      return { kind: 'object', obj, proxy: obj.proxy };
    }
    const cur = findObject(session.id);
    return { kind: 'other', proxy: cur?.o.proxy || null };
  }
  function updatePreview() {
    const st = draftState();
    if (session.preview) {
      scene.remove(session.preview);
      session.preview.traverse((c) => c.geometry && c.geometry.dispose());
      session.preview = null;
    }
    if (st.kind === 'building' || st.kind === 'object') {
      const g = new THREE.Group();
      for (const { key, geometry } of st.obj.sink.toGeometries(THREE)) {
        const mesh = new THREE.Mesh(geometry, getMaterial(key));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      session.preview = g;
      scene.add(g);
    }
    if (session.holder) api.placeHolder(session.holder, st.kind === 'model' ? st.transform : null);
    api.highlightProxy(st.proxy);
    session.state = st;
    const f = $('edForm');
    if (f?.elements.roof && st.obj && !session.draft.roof && ROOF_TYPES[st.obj.info.roof]) f.elements.roof.value = st.obj.info.roof;
    return st;
  }
  function endSession(restore = true) {
    if (!session) return;
    const s = session;
    session = null;
    pickPoint = false;
    document.body.classList.remove('ed-picking');
    if (s.preview) {
      scene.remove(s.preview);
      s.preview.traverse((c) => c.geometry && c.geometry.dispose());
    }
    if (s.holder) scene.remove(s.holder);
    api.highlightProxy(null);
    if (restore && s.layerId && s.movable) {
      api.rebuildLayers([s.layerId]);
      api.setModelVisible(s.id, true);
      api.setSignsVisible(s.id, true);
    }
  }

  // ---------- положение ----------
  // X, Y — центр здания на плане (м), rot — поворот (°) относительно исходного положения
  function pivotAndBase() {
    const mdl = currentModel();
    if (mdl) return { pivot: centroid(mdl.a.hull) };
    const orig = origBuildings.get(session.id);
    if (orig) return { pivot: centroid(session.draft.poly || orig.poly) };
    const oo = origObjects.get(session.id)?.o;
    const pivot = oo && objectPivot((oo.unmoved || oo).proxy);
    return pivot ? { pivot } : null;
  }
  // z — подъём (+) или опускание (−) над исходным положением, м
  function getPos() {
    const e = session.draft;
    const z = +e.lift || 0;
    if (!currentModel() && !origBuildings.get(session.id) && e.box) return { x: +e.box.x, y: +e.box.y, rot: +e.box.angle || 0, z };
    const pb = pivotAndBase();
    if (!pb) return null;
    const [dx, dy] = e.move || [0, 0];
    return { x: pb.pivot[0] + dx, y: pb.pivot[1] + dy, rot: e.rotate || 0, z };
  }
  function setPos(x, y, rot, z = +session.draft.lift || 0) {
    const e = session.draft;
    const zz = round(z, 2);
    if (zz) e.lift = zz;
    else delete e.lift;
    if (!currentModel() && !origBuildings.get(session.id) && e.box) {
      e.box = { ...e.box, x: round(x, 2), y: round(y, 2), angle: round(norm360(rot), 2) };
    } else {
      const pb = pivotAndBase();
      if (!pb) return;
      const move = [round(x - pb.pivot[0], 2), round(y - pb.pivot[1], 2)];
      const r = round(norm360(rot), 2);
      if (move[0] || move[1]) e.move = move;
      else delete e.move;
      if (r) e.rotate = r;
      else delete e.rotate;
    }
    updatePreview();
    syncPosFields();
  }
  const norm360 = (a) => {
    let v = a % 360;
    if (v > 180) v -= 360;
    if (v <= -180) v += 360;
    return v;
  };
  // стрелки — относительно экрана: «вверх» — от камеры
  function nudge(fx, fy, k = 1) {
    const p = getPos();
    if (!p) return;
    const step = +($('edStep')?.value || 1) * k;
    const f = new THREE.Vector3().subVectors(controls.target, camera.position);
    let ax = f.x;
    let ay = -f.z;
    const L = Math.hypot(ax, ay) || 1;
    ax /= L;
    ay /= L;
    const rx = ay;
    const ry = -ax;
    setPos(p.x + (ax * fy + rx * fx) * step, p.y + (ay * fy + ry * fx) * step, p.rot);
  }
  function lift(sign, k = 1) {
    const p = getPos();
    if (!p) return;
    setPos(p.x, p.y, p.rot, p.z + sign * +($('edStep')?.value || 1) * k);
  }
  function turn(sign, k = 1) {
    const p = getPos();
    if (!p) return;
    setPos(p.x, p.y, p.rot + sign * (+($('edAStep')?.value || 5)) * k);
  }

  // ---------- форма ----------
  // Разделы формы сворачиваются; какие открыты — запоминается в браузере (только для удобства).
  const SEC_KEY = 'admiralty-ed-sections';
  let openSecs = {};
  try {
    openSecs = JSON.parse(localStorage.getItem(SEC_KEY) || '{}') || {};
  } catch {
    openSecs = {};
  }
  const isOpen = (k, def) => (k in openSecs ? !!openSecs[k] : def);
  const section = (k, title, sum, body, def = false) => `
        <details class="ed-sec" data-sec="${k}"${isOpen(k, def) ? ' open' : ''}>
          <summary><span>${title}</span><span class="ed-sum" data-sum="${k}">${esc(sum)}</span></summary>
          <div class="ed-sec-body">${body}</div>
        </details>`;
  const posSummary = (p) => (p ? `${Math.round(p.x)}, ${Math.round(p.y)}${Math.round(p.rot) ? ` · ${Math.round(p.rot)}°` : ''}${p.z ? ` · ${p.z > 0 ? '+' : '−'}${String(Math.abs(round(p.z))).replace('.', ',')} м` : ''}` : '');
  function renderForm() {
    const card = $('card');
    const s = session;
    const cur = findObject(s.id);
    const e = s.draft;
    const st = s.state || draftState();
    const name = e.name ?? cur?.o.name ?? `Новое здание ${s.id}`;
    const info = cur?.o.info || {};
    const orig = origBuildings.get(s.id);
    const mdl = currentModel();
    const procedural = !mdl && (orig || e.box);
    const pos = s.movable ? getPos() : null;
    const typeVal = e.type || info.type || (e.box ? 'warehouse' : '');
    const hVal = e.height ?? (procedural ? (orig ? orig.h : 10) : '');
    const wallVal = e.wall || orig?.wall || '';
    const roofVal = e.roof || st.obj?.info.roof || '';
    const nParts = (e.parts || []).filter((p) => p.poly).length;
    const uiOwned = !!(ui.buildings[s.id] || ui.models[s.id] || ui.remove.has(s.id));
    const modelLine = mdl ? `${esc(mdl.file)}${s.model ? ' (новая, не сохранена)' : ''}` : e.box && !orig ? 'коробка по размерам' : orig ? 'по данным' : 'прежняя';
    const units = e.units || [];
    card.classList.remove('min');
    card.hidden = false;
    card.innerHTML = `
      <div class="card-tools"><button class="icon-btn x" type="button" data-act="cancel" aria-label="Отменить правку" title="Отменить правку (Esc)">×</button></div>
      <div class="kind">${s.isNew ? 'Новое здание' : 'Редактирование'} · ${esc(s.id)}</div>
      <h3>${esc(name)}</h3>
      <form class="ed-form" id="edForm" autocomplete="off" novalidate>
        <label class="ed-f">Название<input class="field" name="name" value="${esc(name)}" /></label>
        ${s.isBuilding ? `
        <div class="ed-2">
          <label class="ed-f">Тип<select class="field" name="type">${BUILDING_TYPES.map((t) => `<option value="${t}"${t === typeVal ? ' selected' : ''}>${TYPE_NAMES[t]}</option>`).join('')}${typeVal && !BUILDING_TYPES.includes(typeVal) ? `<option value="" selected>${esc(info.type || 'прежний')}</option>` : ''}</select></label>
          <label class="ed-f">Этажей<input class="field" name="floors" type="number" min="1" max="60" step="1" value="${esc(e.floors ?? info.floors ?? '')}" /></label>
          <label class="ed-f">Высота, м<input class="field" name="height" type="number" min="2" max="200" step="any" value="${esc(hVal)}"${procedural ? '' : ' disabled title="Высота модели из Blender — по самой модели"'} /></label>
          <label class="ed-f">Фасад<select class="field" name="wall"${procedural ? '' : ' disabled'}>${!wallVal ? '<option value="">—</option>' : ''}${WALLS.map((w) => `<option value="${w}"${w === wallVal ? ' selected' : ''}>${esc(wallName(w))}</option>`).join('')}</select></label>
        </div>
        ${nParts > 1 ? `<p class="ed-hint">Здание из ${nParts} частей разной высоты: этажность и высота частей заданы в custom.json (поле parts).</p>` : ''}
        ${procedural ? section('look', 'Кровля и окна', [ROOF_TYPES[roofVal] || '', e.windows === false ? 'без окон' : ''].filter(Boolean).join(' · '), `
          <div class="ed-2">
            <label class="ed-f">Кровля<select class="field" name="roof">${!ROOF_TYPES[roofVal] ? `<option value="" selected>${roofVal ? 'прежняя' : '—'}</option>` : ''}${Object.entries(ROOF_TYPES).map(([k, n]) => `<option value="${k}"${k === roofVal ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
            <label class="ed-f">Высота кровли, м<input class="field" name="roofH" type="number" min="0" max="60" step="any" placeholder="авто" value="${esc(e.roofH ?? '')}" /></label>
            <label class="ed-f">Покрытие<select class="field" name="roofColor"><option value="">${esc(orig?.roof?.color ? roofColorName(orig.roof.color) : 'прежнее')}</option>${ROOF_COLORS.map((k) => `<option value="${k}"${k === e.roofColor ? ' selected' : ''}>${esc(roofColorName(k))}</option>`).join('')}</select></label>
            <label class="ed-f">Низ окон, м<input class="field" name="sill" type="number" min="0" max="6" step="any" placeholder="по типу" value="${esc(e.sill ?? '')}" title="Высота низа окон первого этажа над землёй" /></label>
          </div>
          <label class="toggle"><input type="checkbox" name="noWindows"${e.windows === false ? ' checked' : ''} /><span class="box"></span>Без окон (подстанция, техническое здание)</label>
          <p class="ed-hint" id="edRoofHint"${st.obj?.info.dims ? ' hidden' : ''}>Контур не прямоугольный: двускатная и вальмовая кровли пойдут скатами по контуру, остальные — плоской.</p>`) : ''}` : ''}
        ${pos ? section('pos', 'Положение', posSummary(pos), `
          <div class="ed-2">
            <label class="ed-f">X (восток), м<input class="field" name="x" type="number" step="any" value="${round(pos.x)}" /></label>
            <label class="ed-f">Y (север), м<input class="field" name="y" type="number" step="any" value="${round(pos.y)}" /></label>
            <label class="ed-f">Поворот, °<input class="field" name="rot" type="number" step="any" value="${round(pos.rot)}" /></label>
            <label class="ed-f">Выше / ниже, м<input class="field" name="z" type="number" step="any" value="${round(pos.z)}" title="Подъём (+) или опускание (−) над исходным положением" /></label>
          </div>
          ${e.box && !orig && !mdl ? `<div class="ed-2">
            <label class="ed-f">Длина, м<input class="field" name="length" type="number" min="2" max="600" step="any" value="${esc(e.box.length ?? 30)}" /></label>
            <label class="ed-f">Ширина, м<input class="field" name="width" type="number" min="2" max="300" step="any" value="${esc(e.box.width ?? 18)}" /></label>
          </div>` : ''}
          <div class="ed-move">
            <div class="ed-pad" role="group" aria-label="Сдвиг">
              <span></span><button type="button" class="btn" data-nudge="0,1" title="Вперёд, от камеры (↑)" aria-label="Вперёд">↑</button><span></span>
              <button type="button" class="btn" data-nudge="-1,0" title="Влево (←)" aria-label="Влево">←</button><button type="button" class="btn" data-nudge="0,-1" title="Назад (↓)" aria-label="Назад">↓</button><button type="button" class="btn" data-nudge="1,0" title="Вправо (→)" aria-label="Вправо">→</button>
            </div>
            <div class="ed-turn" role="group" aria-label="Поворот и высота">
              <button type="button" class="btn" data-turn="1" title="Против часовой стрелки (Q)" aria-label="Повернуть против часовой стрелки">⟲</button>
              <button type="button" class="btn" data-turn="-1" title="По часовой стрелке (E)" aria-label="Повернуть по часовой стрелке">⟳</button>
              <button type="button" class="btn" data-lift="1" title="Поднять (Page Up)" aria-label="Поднять">▲</button>
              <button type="button" class="btn" data-lift="-1" title="Опустить (Page Down)" aria-label="Опустить">▼</button>
            </div>
            <div class="ed-steps">
              <label>Шаг<select class="field" id="edStep">${[0.5, 1, 5, 10, 50].map((v) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${String(v).replace('.', ',')} м</option>`).join('')}</select></label>
              <label>Угол<select class="field" id="edAStep">${[1, 5, 15, 45, 90].map((v) => `<option value="${v}"${v === 5 ? ' selected' : ''}>${v}°</option>`).join('')}</select></label>
            </div>
          </div>
          <button type="button" class="btn" data-act="pick" aria-pressed="false">Указать центр на карте</button>
          <p class="ed-hint">Стрелки — сдвиг, Q / E — поворот, Page Up / Page Down — выше / ниже; с Shift — крупнее.</p>`, !s.isBuilding) : ''}
        ${section('about', 'Описание и источник', e.src ?? info.refined ? 'уточнено' : '', `
          <label class="ed-f">Описание<textarea class="field" name="info" rows="3">${esc(e.info ?? info.info ?? '')}</textarea></label>
          <label class="ed-f">Уточнено по<input class="field" name="src" placeholder="фото, обмер, документ" value="${esc(e.src ?? info.refined ?? '')}" /></label>`)}
        ${section('units', 'Подразделения', units.filter((u) => u?.name).length ? String(units.filter((u) => u?.name).length) : '', `
          <div id="edUnits"></div>
          <div class="ed-row"><button type="button" class="btn" data-act="addunit">Добавить подразделение</button></div>
          <datalist id="edUnitNames">${knownUnits().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`)}
        ${s.movable ? section('model', 'Модель', mdl ? '.glb' : '', `
          ${!orig && !origObjects.has(s.id) ? `<label class="ed-f">Слой<select class="field" name="layer"><option value="">по месту: здания верфи или город</option>${Object.entries(NEW_LAYERS).map(([k, v]) => `<option value="${k}"${k === e.layer ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>` : ''}
          <p class="ed-now">Сейчас: ${modelLine}</p>
          <div class="ed-row">
            <label class="btn ed-file">Заменить моделью .glb<input type="file" accept=".glb,model/gltf-binary" hidden data-act="glb" /></label>
            ${(s.model || ui.models[s.id]) && (orig || e.box) ? '<button type="button" class="btn" data-act="dropmodel">Вернуть модель по данным</button>' : ''}
          </div>
          <p class="ed-hint">Из Blender — .glb (Selected Objects, без сжатия). Построена не на месте — поправьте «Положение».</p>`) : ''}
        <p class="ed-msg" id="edMsg" aria-live="polite"></p>
        ${uiOwned && !s.isNew ? '<button type="button" class="btn link" data-act="revert">Вернуть как было до правок на сайте</button>' : ''}
        <div class="ed-row ed-actions">
          <button type="submit" class="btn active" title="Сохранить (Enter)">Сохранить</button>
          <button type="button" class="btn" data-act="cancel">Отмена</button>
          <span class="ed-grow"></span>
          ${!s.isNew ? '<button type="button" class="btn danger" data-act="delete">Удалить</button>' : ''}
        </div>
      </form>`;
    renderUnits();
    bindForm();
  }
  function syncPosFields() {
    const f = $('edForm');
    const p = session && getPos();
    if (!f || !p) return;
    for (const [k, v] of [['x', p.x], ['y', p.y], ['rot', p.rot], ['z', p.z]]) if (f.elements[k] && document.activeElement !== f.elements[k]) f.elements[k].value = round(v);
    const sum = f.querySelector('[data-sum="pos"]');
    if (sum) sum.textContent = posSummary(p);
  }
  function msg(t) {
    const m = $('edMsg');
    if (m) m.textContent = t;
  }
  function bindForm() {
    const f = $('edForm');
    const card = $('card');
    const e = session.draft;
    const setField = (k, v) => {
      if (has(v)) e[k] = v;
      else delete e[k];
    };
    const onUnit = (t) => {
      const row = t.closest('.ed-unit');
      const i = +row.dataset.i;
      e.units[i] = { ...e.units[i], [t.dataset.u]: t.value };
    };
    f.addEventListener('toggle', (ev) => {
      const d = ev.target.closest?.('details[data-sec]');
      if (!d) return;
      openSecs[d.dataset.sec] = d.open;
      try {
        localStorage.setItem(SEC_KEY, JSON.stringify(openSecs));
      } catch {
        /* только удобство */
      }
    }, true);
    f.addEventListener('input', (ev) => {
      const t = ev.target;
      if (t.dataset.u) return onUnit(t);
      const k = t.name;
      if (!k) return;
      if (k === 'name' || k === 'info' || k === 'src') setField(k, t.value.trim());
      else if (k === 'roofH' || k === 'sill') {
        if (t.value === '') delete e[k];
        else if (+t.value >= 0) setField(k, +t.value);
      }
      else if (k === 'floors') setField(k, t.value ? Math.max(1, Math.round(+t.value)) : '');
      else if (k === 'height') {
        if (+t.value >= 2) setField(k, +t.value);
        else if (!t.value) delete e.height;
      } else if (k === 'x' || k === 'y' || k === 'rot' || k === 'z') {
        const p = getPos();
        const v = +t.value;
        if (!p || !Number.isFinite(v) || t.value === '') return;
        setPos(k === 'x' ? v : p.x, k === 'y' ? v : p.y, k === 'rot' ? v : p.rot, k === 'z' ? v : p.z);
        return;
      } else if (k === 'length' || k === 'width') {
        if (+t.value >= 2) e.box = { ...e.box, [k]: +t.value };
      } else return;
      if (k === 'name') card.querySelector('h3').textContent = t.value || session.id;
      updatePreview();
    });
    f.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.u) return onUnit(t);
      if (t.name === 'type') {
        setField('type', t.value);
        updatePreview();
      } else if (t.name === 'layer') {
        setField('layer', t.value);
      } else if (t.name === 'wall' || t.name === 'roof' || t.name === 'roofColor') {
        setField(t.name, t.value);
        updatePreview();
      } else if (t.name === 'noWindows') {
        if (t.checked) e.windows = false;
        else delete e.windows;
        updatePreview();
      } else if (t.dataset.act === 'glb') loadModelFile(t.files && t.files[0], t);
    });
    f.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.nudge) {
        const [x, y] = b.dataset.nudge.split(',').map(Number);
        nudge(x, y, ev.shiftKey ? 10 : 1);
      } else if (b.dataset.turn) turn(+b.dataset.turn, ev.shiftKey ? 3 : 1);
      else if (b.dataset.lift) lift(+b.dataset.lift, ev.shiftKey ? 10 : 1);
      else if (b.dataset.act === 'addunit') {
        e.units = [...(e.units || []), { name: '', role: 'occupant' }];
        renderUnits();
        $('edUnits').querySelector('.ed-unit:last-child [data-u="name"]')?.focus();
      } else if (b.dataset.act === 'delunit') {
        e.units = e.units.filter((_, i) => i !== +b.dataset.i);
        renderUnits();
      } else if (b.dataset.act === 'pick') {
        pickPoint = !pickPoint;
        document.body.classList.toggle('ed-picking', pickPoint);
        b.setAttribute('aria-pressed', String(pickPoint));
        msg(pickPoint ? 'Щёлкните по карте — туда встанет центр.' : '');
      } else if (b.dataset.act === 'dropmodel') {
        session.model = null;
        session.dropModel = true;
        setPreviewModel(null);
        updatePreview();
        renderForm();
      } else if (b.dataset.act === 'cancel') cancel();
      else if (b.dataset.act === 'delete') {
        if (armed(b, 'Точно удалить?')) remove();
      } else if (b.dataset.act === 'revert') {
        if (armed(b, 'Точно вернуть как было?')) revert();
      }
    });
    card.querySelector('.card-tools [data-act="cancel"]').addEventListener('click', cancel);
    f.addEventListener('submit', (ev) => {
      ev.preventDefault();
      save();
    });
  }
  async function loadModelFile(file, input) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const a = analysis(bytes);
      session.model = { file: `${session.id}.glb`, bytes, a };
      session.dropModel = false;
      setPreviewModel(session.model);
      // модель построена не на своём месте (например, в начале координат) — поставить на место здания
      const c = centroid(a.hull);
      const B = data.meta.bounds;
      const outside = c[0] < B.minX || c[0] > B.maxX || c[1] < B.minY || c[1] > B.maxY;
      const cur = findObject(session.id);
      const target = cur ? objectPivot(cur.o.proxy) : session.draft.box ? [session.draft.box.x, session.draft.box.y] : null;
      delete session.draft.box;
      if (outside && target) session.draft.move = [round(target[0] - c[0], 2), round(target[1] - c[1], 2)];
      else delete session.draft.move;
      delete session.draft.rotate;
      updatePreview();
      renderForm();
      msg(`Модель ${file.name}: ${a.images ? `текстур ${a.images}` : 'без текстур'}${a.warnings.length ? ' · ' + a.warnings.join('; ') : ''}.`);
    } catch (err) {
      if (input) input.value = '';
      msg(`Не удалось прочитать ${file.name}: ${err.message}`);
    }
  }

  // ---------- сохранить, отменить, удалить ----------
  async function save() {
    const s = session;
    const id = s.id;
    const e = { ...s.draft };
    if (e.units) {
      e.units = cleanUnits(e.units);
      if (!e.units.length && !s.hadUnits) delete e.units;
    }
    for (const k of Object.keys(e)) if (!has(e[k])) delete e[k];
    // запись хранит только отличия от исходного объекта
    const cur = findObject(id);
    if (cur && e.name === cur.o.name && !ui.buildings[id]?.name && !base.buildings[id]?.name) delete e.name;
    ui.buildings[id] = e;
    if (!Object.keys(e).length) delete ui.buildings[id];
    if (s.model) ui.models[id] = s.model;
    if (s.dropModel) delete ui.models[id];
    ui.remove.delete(id);
    endSession(false);
    applyMany([id], id);
    try {
      await persist([id]);
    } catch (err) {
      showStatus(err?.code === 'permission_denied' || err?.code === 'not_granted' ? 'Нет прав на запись — правка действует до перезагрузки.' : err?.code === 'quota_exceeded' ? 'Общая база страницы заполнена — модель слишком большая. Добавьте её через папку custom/.' : 'Не удалось сохранить правку в общей базе.');
    }
  }
  function cancel() {
    const id = session?.id;
    endSession(true);
    api.selectById(id);
  }
  async function remove() {
    const id = session.id;
    const uiOnly = !origBuildings.has(id) && !origObjects.has(id) && !base.buildings[id] && !base.files[id];
    delete ui.buildings[id];
    delete ui.models[id];
    if (!uiOnly) ui.remove.add(id);
    endSession(false);
    applyMany([id], null);
    try {
      await persist([id]);
    } catch {
      showStatus('Не удалось сохранить удаление в общей базе.');
    }
  }
  async function revert() {
    const id = session.id;
    delete ui.buildings[id];
    delete ui.models[id];
    ui.remove.delete(id);
    endSession(false);
    applyMany([id], id);
    try {
      await persist([id]);
    } catch {
      showStatus('Не удалось сохранить в общей базе.');
    }
  }

  // ---------- новое здание ----------
  function nextId() {
    const used = new Set([...origBuildings.keys(), ...origObjects.keys(), ...Object.keys(base.buildings), ...Object.keys(base.files), ...Object.keys(ui.buildings), ...Object.keys(ui.models)]);
    for (const l of model.layers) for (const o of l.objects) used.add(o.id);
    let n = 1;
    while (used.has(`N${n}`)) n++;
    return `N${n}`;
  }
  function viewCenter() {
    const t = controls.target;
    return [round(t.x, 1), round(-t.z, 1)];
  }
  function newBuilding() {
    const id = nextId();
    const [x, y] = viewCenter();
    api.select(null);
    startEdit(id, { draft: { name: `Новое здание ${id}`, type: 'warehouse', height: 10, box: { x, y, length: 30, width: 18, angle: 0 } } });
  }
  async function newFromFile(file) {
    if (!file) return;
    const id = nextId();
    api.select(null);
    startEdit(id, { draft: { name: `Новое здание ${id}`, type: 'utility', box: { x: viewCenter()[0], y: viewCenter()[1], length: 30, width: 18, angle: 0 } } });
    await loadModelFile(file, null);
  }

  // ---------- архив для custom/ ----------
  function mergedConfig() {
    const ids = new Set([...Object.keys(base.buildings), ...Object.keys(ui.buildings)]);
    const buildings = {};
    for (const id of [...ids].sort()) {
      if (isRemoved(id)) continue;
      buildings[id] = effective(id);
    }
    return { remove: [...new Set([...base.remove, ...ui.remove])].sort(), buildings };
  }
  async function offerFile(name, blob) {
    if (artifactBuild) {
      if (!downloads) return showStatus('Скачивание недоступно в этом окне просмотра.');
      try {
        await downloads.save({ filename: name, data: blob });
      } catch (err) {
        showStatus(err?.code === 'declined' ? 'Скачивание отменено.' : 'Не удалось сохранить файл.');
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
  function exportZip() {
    const files = [{ name: 'custom.json', data: JSON.stringify(mergedConfig(), null, 2) + '\n' }];
    for (const [id, m] of Object.entries(ui.models)) if (!isRemoved(id)) files.push({ name: `${id}.glb`, data: m.bytes });
    const stamp = new Date().toISOString().slice(0, 10);
    offerFile(`custom-admiralty-shipyards-${stamp}.zip`, new Blob([zipStore(files)], { type: 'application/zip' }));
  }
  const inflateRaw = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  async function importFile(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let cfg = null;
      const glbs = {};
      if (/\.json$/i.test(file.name)) cfg = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ''));
      else {
        const files = await unzipFiles(bytes, inflateRaw, (n) => /(^|\/)custom\.json$|\.glb$/i.test(n));
        for (const [n, b] of Object.entries(files)) {
          const base = n.split('/').pop();
          if (/custom\.json$/i.test(base)) cfg = JSON.parse(new TextDecoder().decode(b).replace(/^﻿/, ''));
          else glbs[base.replace(/\.glb$/i, '').trim().split(/\s+/)[0]] = { file: base, bytes: b };
        }
      }
      if (!cfg) throw new Error('в архиве нет custom.json');
      const touched = new Set();
      for (const id of cfg.remove || []) {
        if (base.remove.has(id)) continue;
        ui.remove.add(id);
        touched.add(id);
      }
      for (const [id, e] of Object.entries(cfg.buildings || {})) {
        if (JSON.stringify(base.buildings[id] || null) === JSON.stringify(e)) continue;
        ui.buildings[id] = e;
        touched.add(id);
      }
      for (const [id, g] of Object.entries(glbs)) {
        ui.models[id] = { file: `${id}.glb`, bytes: g.bytes, a: analysis(g.bytes) };
        touched.add(id);
      }
      applyMany([...touched], api.selectedId());
      await persist([...touched]);
      showStatus(`Загружено правок: ${touched.size}.`);
    } catch (err) {
      showStatus(`Не удалось загрузить: ${err.message}`);
    }
  }
  async function resetAll() {
    const ids = [...new Set([...ui.remove, ...Object.keys(ui.buildings), ...Object.keys(ui.models)])];
    if (!ids.length) return;
    ui = { remove: new Set(), buildings: {}, models: {} };
    applyMany(ids, api.selectedId());
    try {
      await persist(ids);
    } catch {
      showStatus('Не удалось сохранить в общей базе.');
    }
  }

  // ---------- панель «Редактирование» ----------
  let statusTimer = null;
  function showStatus(t) {
    const el = $('edStatus');
    if (!el) return;
    el.textContent = t;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (el.textContent = ''), 9000);
  }
  function renderSummary() {
    const n = new Set([...ui.remove, ...Object.keys(ui.buildings), ...Object.keys(ui.models)]).size;
    const where = mode === 'shared' ? 'в общей базе страницы, их видят все с доступом' : 'в этом браузере';
    $('edSummary').textContent = canWrite ? `${n ? `Правок: ${n}, хранятся ${where}.` : 'Правок пока нет.'}${storageNote ? ' ' + storageNote + '.' : ''}` : 'У вас доступ только для просмотра.';
    $('edSummary').title = 'Чтобы правки вошли в модель насовсем, скачайте архив и распакуйте его в папку custom/.';
    for (const id of ['edNew', 'edNewGlbLabel', 'edImportLabel', 'edReset']) $(id).hidden = !canWrite;
    $('edReset').disabled = !n;
    $('edExport').hidden = artifactBuild && !downloads;
    $('editGroup').hidden = false;
  }
  $('edNew').addEventListener('click', newBuilding);
  $('edNewGlb').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    newFromFile(f);
  });
  $('edExport').addEventListener('click', exportZip);
  $('edImport').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    importFile(f);
  });
  $('edReset').addEventListener('click', (ev) => {
    if (armed(ev.currentTarget, 'Точно отменить все?')) resetAll();
  });

  // клавиатура в режиме правки
  window.addEventListener('keydown', (ev) => {
    if (!session) return;
    const t = ev.target;
    const typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancel();
      return;
    }
    if (typing || !session.movable) return;
    const k = ev.shiftKey ? 10 : 1;
    const map = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (map[ev.key]) {
      ev.preventDefault();
      nudge(map[ev.key][0], map[ev.key][1], k);
    } else if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      ev.preventDefault();
      lift(ev.key === 'PageUp' ? 1 : -1, k);
    } else if (/^[qй]$/i.test(ev.key)) turn(1, ev.shiftKey ? 3 : 1);
    else if (/^[eу]$/i.test(ev.key)) turn(-1, ev.shiftKey ? 3 : 1);
  });

  // ---------- кнопка «Изменить» в карточке ----------
  function decorateCard(card, o) {
    if (!canWrite || !editableKind(o) || session) return;
    const row = card.querySelector(':scope > .row');
    if (!row || row.querySelector('[data-act="edit"]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.dataset.act = 'edit';
    b.textContent = 'Изменить';
    b.addEventListener('click', () => startEdit(o.id));
    row.appendChild(b);
  }

  // ---------- запуск: правки из хранилища ----------
  (async () => {
    if (window.claude && typeof window.claude.use === 'function') {
      db = await window.claude.use('db');
      if (db) {
        mode = 'shared';
        const user = await window.claude.use('user');
        if (user) {
          const w = await user.can('data.write');
          if (w === false) canWrite = false;
        }
        db.collection('edits').onSnapshot(onSharedSnapshot, () => {
          storageNote = 'общая база недоступна';
          renderSummary();
        });
      }
      downloads = await window.claude.use('downloads');
    }
    if (mode === 'local') {
      await loadLocal();
      const ids = [...new Set([...ui.remove, ...Object.keys(ui.buildings), ...Object.keys(ui.models)])];
      if (ids.length) applyMany(ids, api.selectedId());
    }
    renderSummary();
  })();
  renderSummary();

  return {
    decorateCard,
    isEditing: () => !!session,
    // щелчок по карте во время правки: точка для центра здания
    onCanvasClick(point) {
      if (!session) return false;
      if (pickPoint && point) {
        const p = getPos();
        if (p) setPos(point[0], point[1], p.rot);
        pickPoint = false;
        document.body.classList.remove('ed-picking');
        const b = $('edForm')?.querySelector('[data-act="pick"]');
        if (b) b.setAttribute('aria-pressed', 'false');
        msg('');
      }
      return true;
    },
    bytesFor,
  };
}
