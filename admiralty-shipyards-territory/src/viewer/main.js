// Интерактивный просмотр модели территории АО «Адмиралтейские верфи».

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import CUSTOM from 'custom:files';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { getTerritory } from '../data/index.js';
import { initModel, buildModel, toMergedGroups, fillLayerGroup, buildPickMesh } from '../model/index.js';
import { prepareCustom, DATA_KEYS, ROOF_TYPES } from '../model/custom.js';
import { createMaterialFactory } from '../model/materials.js';
import { toLatLon, centroid, area, pointInRing } from '../geo.js';
import { setupExports } from './exports.js';
import { setupRegistry } from './registry.js';
import { setupObjectList } from './objects.js';
import { setupEditor } from './editor.js';

/* global __ARTIFACT_BUILD__ */
// __ARTIFACT_BUILD__ подставляет esbuild: true — сборка для публикации в виде Artifact
// (в ней нет кода выгрузки файлов), false — обычная локальная версия с экспортом.
const $ = (id) => document.getElementById(id);

// модель (x восток, y север, z вверх) → three (X, Y вверх, Z = −север)
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const VIEWS = [
  { id: 'overview', name: 'Общий вид', eye: [950, -250, 1250], target: [-380, 620, 0] },
  { id: 'plan', name: 'План', eye: [-330, 592, 3700], target: [-330, 600, 0] },
  { id: 'checkpoint', name: 'Центральная проходная', eye: [60, -40, 75], target: [-110, 50, 5] },
  { id: 'slipways', name: 'Стапели', eye: [-1080, 280, 200], target: [-600, 60, 8] },
  { id: 'novo', name: 'Новое Адмиралтейство', eye: [-520, 1950, 300], target: [-20, 1360, 10] },
  { id: 'matisov', name: 'Матисов остров', eye: [-950, 900, 280], target: [-300, 640, 5] },
  { id: 'neva', name: 'Вид с Невы', eye: [-860, 250, 45], target: [-430, 600, 14] },
  { id: 'south', name: 'Со стороны Фонтанки', eye: [380, -850, 650], target: [-380, 450, 0] },
];

const KIND_LABEL = {
  building: 'Здание верфи',
  context: 'Окружающая застройка',
  crane: 'Грузоподъёмный кран',
  vessel: 'Судно',
  slipway: 'Стапель',
  dock: 'Плавучий док',
  bridge: 'Мост',
  fence: 'Ограждение',
  chimney: 'Дымовая труба',
  landmark: 'Достопримечательность',
  misc: 'Оборудование',
};

const ZONE_LABEL = { galerny: 'Галерный остров', kolomna: 'Основная площадка (между Фонтанкой и Пряжкой)', matisov: 'Матисов остров', novo: 'Ново-Адмиралтейский остров' };

// Короткие подписи-«булавки»: id объекта → [текст, дальность видимости, м]
const PINS = {
  Z199: ['Центральная проходная', 2600],
  Z182: ['СПбГМТУ', 1600],
  Z129: ['Главная судостроительная мастерская', 1600],
  Z3: ['Главный корпус Галерного острова', 1800],
  S1: ['Стапель № 1', 2600],
  S2: ['Стапель № 2', 2600],
  Z14: ['Корпусообрабатывающий цех', 1400],
  Z58: ['Сборочно-сварочный цех', 1600],
  Z68: ['Цех у устья Мойки', 1400],
  Z136: ['Большой каменный эллинг', 2600],
  Z171: ['Малый каменный эллинг', 1800],
  Z126: ['Крытый эллинг', 2600],
  D1: ['Плавдок «Луга»', 1800],
  D2: ['Плавдок СПД-2М', 1600],
  KR: ['Ледокол «Красин»', 1600],
};
// Подписи по названию объекта (мосты, достопримечательности из OpenStreetMap)
const PIN_NAMES = {
  'Старо-Калинкин мост': 1400,
  'Матисов мост': 1200,
  'Бердов мост': 1000,
  'Храповицкий мост': 1200,
  'Галерный мост': 1200,
  'Арка Новой Голландии': 1600,
  'Южная проходная АО «Адмиралтейские верфи»': 1600,
  'Северная проходная АО «Адмиралтейские верфи»': 1600,
};

async function main() {
  const step = (t) => {
    $('loadingStep').textContent = t;
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  };

  // ---------- рендерер и сцена ----------
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 2, 12000);
  const labelRenderer = new CSS2DRenderer({ element: $('labels') });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envDay = pmrem.fromEquirectangular(skyEquirect(['#7fa6cb', '#bcd2e3', '#d9e3ea', '#8d8f8c'])).texture;
  const envEvening = pmrem.fromEquirectangular(skyEquirect(['#1d2b45', '#53587a', '#c58b6d', '#2a2c30'])).texture;
  scene.environment = envDay;
  scene.environmentIntensity = 0.8;

  const hemi = new THREE.HemisphereLight(0xdfe9f3, 0x6b6558, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -1150;
  sc.right = 1150;
  sc.top = 1150;
  sc.bottom = -1150;
  sc.near = 100;
  sc.far = 4500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);

  // ---------- данные и модель ----------
  await step('данные территории');
  const data = getTerritory();
  initModel(THREE);
  await step('геометрия: острова, здания, краны, суда');
  // на телефонах и планшетах окружение строится упрощённо (без окон) — меньше нагрузка на GPU
  const touch = window.matchMedia('(pointer: coarse)').matches;
  // доработки из папки custom/: модели из Blender, удаления, новые здания
  const customFiles = CUSTOM.files.map((f) => ({ file: f.file, bytes: Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) }));
  const custom = prepareCustom(CUSTOM.config, customFiles);
  const origBuildings = new Map(data.buildings.map((b) => [b.id, b]));
  const origData = Object.fromEntries(DATA_KEYS.map((k) => [k, data[k]]));
  const contextDetail = touch ? 'low' : 'auto';
  const model = buildModel(data, { contextDetail, custom });
  for (const w of model.custom?.warnings || []) console.warn('custom/: ' + w);
  await step('материалы и освещение');
  const getMaterial = createMaterialFactory(THREE);
  const groups = toMergedGroups(THREE, model, getMaterial);
  const root = new THREE.Group();
  for (const g of groups) root.add(g);
  scene.add(root);
  const pickMesh = buildPickMesh(THREE, model);
  scene.add(pickMesh);
  const center = V3(-330, 600, 0);
  sun.target.position.copy(center);

  // вывеска на главной проходной
  const signMeshes = new Map(); // код здания → [меши]
  const addSigns = (list) => {
    for (const s of list) {
      const m = addSignText(s);
      if (!signMeshes.has(s.id)) signMeshes.set(s.id, []);
      signMeshes.get(s.id).push(m);
    }
  };
  addSigns(model.signs);

  // ---------- управление камерой ----------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 15;
  controls.maxDistance = 4200;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  // как на карте: левая кнопка (один палец) — сдвиг, правая (Shift + левая, два пальца) — вращение
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };

  let shift = 0; // текущий сдвиг центра проекции, px
  let shiftTo = 0;
  const panelShift = () => (!narrow() && !$('panel').classList.contains('collapsed') ? $('panel').getBoundingClientRect().right : 0);

  let tween = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function flyTo(eye, target, ms = 1100) {
    const e1 = V3(...eye);
    const t1 = V3(...target);
    if (reduceMotion || ms === 0) {
      camera.position.copy(e1);
      controls.target.copy(t1);
      controls.update();
      return;
    }
    tween = { e0: camera.position.clone(), t0: controls.target.clone(), e1, t1, start: performance.now(), ms };
  }

  // ---------- подписи ----------
  const labelObjs = [];
  function addLabel(text, at, z, cls, minDist = 0, maxDist = Infinity, scope = 'base') {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(V3(at[0], at[1], z));
    o.userData = { minDist, maxDist, scope };
    scene.add(o);
    labelObjs.push(o);
    return o;
  }
  for (const l of data.labels) {
    if (l.kind === 'island') addLabel(l.text, l.at, 60, 'island', 0, 3600);
    else if (l.kind === 'district') addLabel(l.text, l.at, 40, 'district', 0, 3600, 'city');
    else if (l.kind === 'street') addLabel(l.text, l.at, 3, 'street', 0, 1300, 'city');
    else addLabel(l.text, l.at, 14, 'street', 0, 1300, 'city');
  }
  for (const l of data.water.labels) addLabel(l.text, l.at, 1, 'water' + (l.size === 'xl' ? ' xl' : ''), 0, l.size === 'xl' || l.size === 'l' ? 4000 : 1800);
  let pinLabels = [];
  function makePins() {
    for (const l of pinLabels) {
      scene.remove(l);
      l.element.remove();
      labelObjs.splice(labelObjs.indexOf(l), 1);
    }
    pinLabels = [];
    for (const o of pickMesh.userData.objects) {
      const pin = PINS[o.id] || (PIN_NAMES[o.name] ? [o.name.replace(' АО «Адмиралтейские верфи»', ''), PIN_NAMES[o.name]] : null);
      if (!pin) continue;
      const p = o.proxy;
      const c = centroid(p.poly);
      pinLabels.push(addLabel(pin[0], c, p.z1 + 4, 'pin', 0, pin[1], o.scope === 'city' ? 'city' : 'yard'));
    }
  }
  makePins();

  // ---------- интерфейс ----------
  const shipyardArea = (mpArea(model.planar.shipyardMP) / 1e4).toFixed(0);
  const plural = (n, one, few, many) => {
    const m10 = n % 10;
    const m100 = n % 100;
    return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
  };
  function updateFacts() {
    const nShip = model.layers.find((l) => l.id === 'shipyard').objects.length;
    const prod = model.layers.find((l) => l.id === 'production').objects;
    const nCranes = prod.filter((o) => o.info?.kind === 'crane' && !o.id.startsWith('BC')).length;
    const nSlip = prod.filter((o) => o.info?.kind === 'slipway').length;
    $('facts').innerHTML = [`≈${shipyardArea} га`, plural(nShip, 'здание', 'здания', 'зданий'), plural(nSlip, 'стапель', 'стапеля', 'стапелей'), plural(nCranes, 'кран', 'крана', 'кранов'), `3 острова и площадка`].map((t) => `<span class="fact">${t}</span>`).join('');
  }
  updateFacts();
  $('note').innerHTML = data.meta.source === 'osm'
    ? `<b>Источник геометрии.</b> Контуры зданий, вода, улицы и ограждения — OpenStreetMap (© участники OSM, ODbL)${data.meta.osm?.fetched ? ', данные на ' + data.meta.osm.fetched.slice(0, 10) : ''}. Названия и описания объектов верфи — по открытым источникам.` +
      `<br /><span style="font-family:var(--font-data);font-size:11px">${model.stats.buildings} зданий · ${(model.stats.triangles / 1e6).toFixed(2)} млн треугольников</span>`
    : '<b>Источники.</b> Граница территории, контуры зданий, вода, улицы и мосты — открытые данные OpenStreetMap и Microsoft ML Buildings (Overture Maps, ODbL). Этажность городских домов — из OSM; высоты цехов в открытых данных нет, они оценены. Назначение цехов, стапели и краны — с карты предприятия, совмещённой с реальной границей. ' +
    `<br /><span style="font-family:var(--font-data);font-size:11px">${model.stats.buildings} зданий · ${(model.stats.triangles / 1e6).toFixed(2)} млн треугольников</span>`;

  const viewsEl = $('views');
  for (const v of VIEWS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.type = 'button';
    b.textContent = v.name;
    b.dataset.view = v.id;
    b.addEventListener('click', () => {
      setActiveView(v.id);
      flyTo(v.eye, v.target);
    });
    viewsEl.appendChild(b);
  }
  function setActiveView(id) {
    for (const b of viewsEl.children) b.classList.toggle('active', b.dataset.view === id);
  }

  const layersEl = $('layers');
  for (const g of groups) {
    const layer = model.layers.find((l) => l.id === g.userData.layer);
    const count = layer.objects.filter((o) => o.info).length;
    const lab = document.createElement('label');
    lab.className = 'layer';
    lab.innerHTML = `<input type="checkbox" id="layer-${layer.id}" checked /><span class="box"></span>${layer.name}${count ? `<span class="count">${count}</span>` : ''}`;
    lab.querySelector('input').addEventListener('change', (e) => {
      g.visible = e.target.checked;
      hiddenLayers[layer.id] = !e.target.checked;
      if (selected && hiddenLayers[selected.layer]) select(null);
    });
    layersEl.appendChild(lab);
  }
  const hiddenLayers = {};

  $('optLabels').addEventListener('change', (e) => ($('labels').style.display = e.target.checked ? '' : 'none'));
  $('optShadows').addEventListener('change', (e) => {
    sun.castShadow = e.target.checked;
  });
  $('optEvening').addEventListener('change', (e) => setEvening(e.target.checked));

  // ---------- левая панель: вкладки и сворачивание ----------
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  const store = (k, v) => {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch {
      /* хранилище недоступно */
    }
    return null;
  };
  function setPanelCollapsed(c) {
    $('panel').classList.toggle('collapsed', c);
    document.body.classList.toggle('panel-collapsed', c);
    const t = c ? 'Развернуть панель' : 'Свернуть панель';
    $('menuToggle').setAttribute('aria-expanded', String(!c));
    $('menuToggle').setAttribute('aria-label', t);
    $('menuToggle').title = t;
    if (!narrow()) store('admiralty-panel-collapsed', c ? '1' : '0');
    shiftTo = panelShift();
  }
  function setTab(id) {
    const objects = id === 'objects';
    $('tabControls').setAttribute('aria-selected', String(!objects));
    $('tabObjects').setAttribute('aria-selected', String(objects));
    $('paneControls').hidden = objects;
    $('paneObjects').hidden = !objects;
    store('admiralty-panel-tab', id);
  }
  $('menuToggle').addEventListener('click', () => setPanelCollapsed(!$('panel').classList.contains('collapsed')));
  for (const [tab, id] of [['tabControls', 'controls'], ['tabObjects', 'objects']]) {
    $(tab).addEventListener('click', () => {
      setTab(id);
      if ($('panel').classList.contains('collapsed')) setPanelCollapsed(false);
      if (id === 'objects') objectList?.setActive(selected?.id);
    });
  }
  setTab(store('admiralty-panel-tab') === 'objects' ? 'objects' : 'controls');
  $('compass').addEventListener('click', () => {
    const t = controls.target.clone();
    const d = camera.position.distanceTo(t);
    const polar = controls.getPolarAngle();
    const e = new THREE.Vector3(t.x, t.y + d * Math.cos(polar), t.z + d * Math.sin(polar));
    flyTo([e.x, -e.z, e.y], [t.x, -t.z, t.y], 700);
  });

  if (__ARTIFACT_BUILD__) {
    $('exportGroup').innerHTML =
      '<h2>Файлы модели</h2><p class="note" style="border:0;padding:0;margin:0">GLB (3D), DXF (генплан) и GeoJSON лежат в репозитории в папке <code>admiralty-shipyards-territory/dist</code>; там же локальная версия этой страницы с кнопками экспорта.</p>';
  } else {
    // модели из custom/ и из редактора вклеиваются в GLB вместе с текстурами
    setupExports({
      $, data, model,
      customParts: () => model.layers.flatMap((layer) =>
        layer.objects.filter((o) => o.custom && editor?.bytesFor(o.id)).map((o) => ({ bytes: editor.bytesFor(o.id), nodeName: `${o.id} ${o.name}`.trim(), parentName: layer.name, transform: o.transform })),
      ),
    });
  }

  // ---------- выбор объектов ----------
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selected = null;
  let highlight = null;
  let downAt = null;
  let lastTap = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > (e.pointerType === 'touch' ? 10 : 5)) return;
    setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(pickMesh, false);
    const objs = pickMesh.userData.objects;
    const fo = pickMesh.userData.faceObj;
    const hit = hits.find((h) => {
      const ob = objs[fo[h.faceIndex]];
      return !hiddenLayers[ob.layer] && !(yardOnly && ob.scope === 'city');
    });
    // во время правки щелчок не выбирает объекты, а указывает точку: там, куда попал щелчок, —
    // на крыше или стене здания, иначе на земле (луч до земли за крышей уводит точку далеко назад)
    if (editor?.isEditing()) {
      const pt = hit ? hit.point : raycaster.ray.intersectPlane(groundPlane, tmp);
      editor.onCanvasClick(pt ? [pt.x, -pt.z] : null);
      return;
    }
    const o = hit ? objs[fo[hit.faceIndex]] : null;
    // двойной щелчок (на телефоне — двойное касание) по объекту — подлететь к нему
    const now = performance.now();
    const dbl = lastTap && now - lastTap.t < 450 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 16 && o && lastTap.o === o;
    lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY, o };
    if (o !== selected) select(o);
    if (dbl) flyToSelected(o);
  });
  function setMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmp = new THREE.Vector3();
  canvas.addEventListener('pointermove', (e) => {
    setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(groundPlane, tmp)) {
      const x = tmp.x;
      const y = -tmp.z;
      const [lat, lon] = toLatLon([x, y]);
      $('coords').innerHTML = `<span>Ш</span> ${lat.toFixed(5)}° <span>Д</span> ${lon.toFixed(5)}°<br /><span>x</span> ${x.toFixed(0).padStart(5)} м <span>y</span> ${y.toFixed(0).padStart(5)} м`;
    }
  });

  let registry = null;
  let objectList = null;
  let editor = null;
  // подлёт к выбранному объекту; на телефоне шторка и карточка сворачиваются, чтобы объект был виден
  function flyToSelected(o) {
    if (narrow()) {
      setPanelCollapsed(true);
      setCardMin(true);
    }
    focusObject(o);
  }
  function focusObject(o) {
    const c = o.proxy.poly ? centroid(o.proxy.poly) : o.proxy.line[0];
    const h = o.proxy.z1 ?? o.proxy.h ?? 10;
    // на узком вертикальном экране отходим дальше, чтобы объект поместился по ширине
    const narrowness = 1 / Math.min(1, Math.max(0.45, camera.aspect));
    const r = Math.max(60, Math.sqrt(o.proxy.poly ? area(o.proxy.poly) : 400) * 1.6 + h * 1.5) * narrowness;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
    const eye = [c[0] + dir.x * r, c[1] - dir.z * r, h + r * 0.55];
    flyTo(eye, [c[0], c[1], h * 0.4], 900);
    setActiveView(null);
  }

  const ROOF_NAMES = { ...ROOF_TYPES, dome: 'Купол', onion: 'Луковичная главка' };
  let cardMin = false;
  function setCardMin(on) {
    cardMin = on;
    const card = $('card');
    card.classList.toggle('min', on);
    const b = card.querySelector('[data-act="min"]');
    if (b) {
      const t = on ? 'Развернуть карточку' : 'Свернуть карточку';
      b.setAttribute('aria-expanded', String(!on));
      b.setAttribute('aria-label', t);
      b.title = t;
    }
  }
  let manyHighlight = null;
  function select(o) {
    selected = o;
    objectList?.setActive(o?.id);
    if (manyHighlight) {
      scene.remove(manyHighlight);
      manyHighlight.traverse((c) => c.geometry && c.geometry.dispose());
      manyHighlight = null;
    }
    if (highlight) {
      scene.remove(highlight);
      highlight.traverse((c) => c.geometry && c.geometry.dispose());
      highlight = null;
    }
    const card = $('card');
    if (!o) {
      card.hidden = true;
      registry?.decorateCard(card, null);
      return;
    }
    highlight = makeHighlight(o.proxy);
    scene.add(highlight);
    const i = o.info;
    const rows = [];
    rows.push(['Код', o.id]);
    if (i.zone && ZONE_LABEL[i.zone]) rows.push(['Участок', ZONE_LABEL[i.zone]]);
    if (i.dims) rows.push(['Размеры', `${i.dims[0]} × ${i.dims[1]} м`]);
    if (i.height) rows.push(['Высота', `${i.height} м`]);
    if (i.floors) rows.push(['Этажей', i.floorsText || i.floors]);
    if (i.footprint) rows.push(['Площадь застройки', `${i.footprint.toLocaleString('ru-RU')} м²`]);
    if (i.roof && ROOF_NAMES[i.roof]) rows.push(['Кровля', ROOF_NAMES[i.roof].toLowerCase()]);
    if (i.refined) rows.push(['Уточнено', i.refined]);
    const c = o.proxy.poly ? centroid(o.proxy.poly) : o.proxy.line[0];
    const [lat, lon] = toLatLon(c);
    rows.push(['Координаты', `${lat.toFixed(5)}, ${lon.toFixed(5)}`]);
    if (o.custom) rows.push(['Модель', `из Blender: custom/${o.custom}`]);
    card.innerHTML = `
      <div class="card-tools">
        <button class="icon-btn fold" type="button" data-act="min"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
        <button class="icon-btn x" type="button" aria-label="Закрыть" title="Закрыть">×</button>
      </div>
      <div class="kind">${KIND_LABEL[i.kind] || 'Объект'}</div>
      <h3>${escapeHtml(o.name)}</h3>
      ${i.approx || o.generated ? '<span class="badge">Положение условное</span>' : ''}
      ${i.info ? `<p>${escapeHtml(i.info)}</p>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
      ${unitsBlock(i.units)}
      <div class="row"><button class="btn" type="button" id="cardFly">Приблизить</button></div>`;
    card.hidden = false;
    card.querySelector('.x').addEventListener('click', () => select(null));
    card.querySelector('[data-act="min"]').addEventListener('click', () => setCardMin(!cardMin));
    setCardMin(cardMin);
    card.querySelector('#cardFly').addEventListener('click', () => focusObject(o));
    registry?.decorateCard(card, o);
    editor?.decorateCard(card, o);
  }

  // подразделения в карточке: кто размещается и кто отвечает за здание
  function unitsBlock(units) {
    if (!units || !units.length) return '';
    const occ = units.filter((u) => u.role !== 'owner');
    const own = units.filter((u) => u.role === 'owner');
    const li = (u) => `<li><span class="u-name">${escapeHtml(u.name)}</span>${u.person ? `<span class="u-person">${escapeHtml(u.person)}</span>` : ''}</li>`;
    return `<div class="units">
      <h4>Подразделения</h4>
      ${occ.length ? `<div class="u-role">Размещаются</div><ul>${occ.map(li).join('')}</ul>` : '<div class="u-empty">Здание не занято</div>'}
      ${own.length ? `<div class="u-role">Отвечает за здание</div><ul>${own.map(li).join('')}</ul>` : ''}
    </div>`;
  }

  function makeHighlight(p) {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#d4500f', depthTest: false, transparent: true });
    const pts = [];
    if (p.line) {
      for (let i = 0; i < p.line.length - 1; i++) {
        const a = p.line[i];
        const b = p.line[i + 1];
        const z0 = (p.z0 || 0) + 0.3;
        pts.push(V3(a[0], a[1], z0 - 0.3 + p.h), V3(b[0], b[1], z0 - 0.3 + p.h), V3(a[0], a[1], z0), V3(b[0], b[1], z0));
      }
    } else {
      for (const q of [p, ...(p.extra || [])]) {
        const r = q.poly;
        const z0 = Math.max(q.z0, 0.3);
        for (let i = 0; i < r.length; i++) {
          const a = r[i];
          const b = r[(i + 1) % r.length];
          pts.push(V3(a[0], a[1], z0), V3(b[0], b[1], z0), V3(a[0], a[1], q.z1), V3(b[0], b[1], q.z1), V3(a[0], a[1], z0), V3(a[0], a[1], q.z1));
        }
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 10;
    g.add(lines);
    return g;
  }

  // ---------- «Только верфь»: скрыть всё, что за территорией ----------
  let yardOnly = false;
  const cityGround = getMaterial('ground_city');
  const cityGroundColor = cityGround.color.clone();
  function setYardOnly(on) {
    yardOnly = on;
    for (const g of groups) for (const sg of g.children) if (sg.userData.scope === 'city') sg.visible = !on;
    // городская подложка — приглушённая, чтобы территория читалась отдельно
    cityGround.color.copy(cityGroundColor);
    if (on) cityGround.color.lerp(new THREE.Color(0xd9dde1), 0.6);
    $('scopeBtn').setAttribute('aria-pressed', String(on));
    if (on && selected && selected.scope === 'city') select(null);
    try {
      localStorage.setItem('admiralty-yard-only', on ? '1' : '0');
    } catch {
      /* хранилище недоступно */
    }
  }
  $('scopeBtn').addEventListener('click', () => setYardOnly(!yardOnly));
  // страховка для браузеров без overflow: clip — панель и сцена сами не прокручиваются
  for (const el of [$('panel'), $('app')]) el.addEventListener('scroll', () => el.scrollTop && (el.scrollTop = 0));
  // разделы левой панели сворачиваются; какие свёрнуты — запоминается (только удобство)
  {
    let closed = {};
    try {
      closed = JSON.parse(localStorage.getItem('admiralty-panel-groups') || '{}') || {};
    } catch {
      closed = {};
    }
    for (const d of document.querySelectorAll('details.group[data-grp]')) {
      if (closed[d.dataset.grp]) d.open = false;
      d.addEventListener('toggle', () => {
        closed[d.dataset.grp] = !d.open;
        try {
          localStorage.setItem('admiralty-panel-groups', JSON.stringify(closed));
        } catch {
          /* только удобство */
        }
      });
    }
  }
  // подсказка по управлению: закрывается и больше не показывается
  try {
    if (localStorage.getItem('admiralty-hint-closed') === '1') $('hint').hidden = true;
  } catch {
    /* только удобство */
  }
  $('hintClose').addEventListener('click', () => {
    $('hint').hidden = true;
    try {
      localStorage.setItem('admiralty-hint-closed', '1');
    } catch {
      /* только удобство */
    }
  });
  try {
    if (localStorage.getItem('admiralty-yard-only') === '1' || location.hash.includes('yard')) setYardOnly(true);
  } catch {
    /* хранилище недоступно */
  }

  // ---------- модели из custom/ (Blender): на место своего объекта, в свой слой ----------
  // Держатель модели: поворот и сдвиг на плане вокруг центра контура (как placeModel в model/custom.js).
  const gltfLoader = new GLTFLoader();
  const customScenes = new Map(); // код → держатель
  function placeHolder(holder, t) {
    holder.userData.placement = t;
    const inner = holder.children[0];
    if (!t) {
      holder.position.set(0, 0, 0);
      holder.rotation.set(0, 0, 0);
      holder.scale.setScalar(1);
      if (inner) inner.position.set(0, 0, 0);
      return;
    }
    const [cx, cy] = t.pivot;
    const [dx, dy] = t.move || [0, 0];
    holder.position.set(cx + dx, t.lift || 0, -(cy + dy));
    holder.rotation.set(0, ((t.rotate || 0) * Math.PI) / 180, 0);
    holder.scale.setScalar(t.scale || 1);
    if (inner) inner.position.set(-cx, 0, cy);
  }
  function makeModelHolder(bytes, label = '') {
    const holder = new THREE.Group();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    gltfLoader.parse(
      buf,
      '',
      (gltf) => {
        gltf.scene.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        holder.add(gltf.scene);
        placeHolder(holder, holder.userData.placement);
      },
      (err) => console.warn(`${label || 'модель'}: не удалось загрузить — ${err?.message || err}`),
    );
    return holder;
  }
  function customGroup(layerId, scope) {
    const g = groups.find((x) => x.userData.layer === layerId);
    let sg = g.children.find((x) => x.userData.custom && x.userData.scope === scope);
    if (!sg) {
      sg = new THREE.Group();
      sg.name = `${layerId}:${scope}:custom`;
      sg.userData = { scope, custom: true };
      sg.visible = !(yardOnly && scope === 'city');
      g.add(sg);
    }
    return sg;
  }
  function attachModel(o, layerId, bytes) {
    detachModel(o.id);
    const holder = makeModelHolder(bytes, `custom/${o.custom}`);
    holder.name = `${o.id} ${o.name}`;
    placeHolder(holder, o.transform);
    customScenes.set(o.id, holder);
    customGroup(layerId, o.scope || 'city').add(holder);
  }
  function detachModel(id) {
    const h = customScenes.get(id);
    if (!h) return;
    h.parent?.remove(h);
    customScenes.delete(id);
  }
  for (const layer of model.layers) {
    for (const o of layer.objects) {
      if (!o.custom) continue;
      attachModel(o, layer.id, customFiles.find((x) => x.file === o.custom).bytes);
    }
  }
  function rebuildLayers(ids, exclude = null) {
    for (const id of ids) {
      const g = groups.find((x) => x.userData.layer === id);
      const layer = model.layers.find((l) => l.id === id);
      if (!g || !layer) continue;
      fillLayerGroup(THREE, g, layer, getMaterial, exclude);
      for (const sg of g.children) if (sg.userData.scope === 'city') sg.visible = !yardOnly;
    }
  }
  // после правок: выбор мышью, булавки, счётчики, реестр, список объектов
  function refreshAll(selectId) {
    const fresh = buildPickMesh(THREE, model);
    pickMesh.geometry.dispose();
    pickMesh.geometry = fresh.geometry;
    pickMesh.userData = fresh.userData;
    makePins();
    updateFacts();
    registry?.refresh();
    objectList?.refresh(registry.items);
    selectById(selectId);
  }
  function selectById(id) {
    select(id ? pickMesh.userData.objects.find((o) => o.id === id) || null : null);
  }
  let editHighlight = null;
  function highlightProxy(p) {
    if (editHighlight) {
      scene.remove(editHighlight);
      editHighlight.traverse((c) => c.geometry && c.geometry.dispose());
      editHighlight = null;
    }
    if (highlight) highlight.visible = !p;
    if (!p) return;
    editHighlight = makeHighlight(p);
    scene.add(editHighlight);
  }

  // ---------- реестр зданий и сооружений ----------
  // при открытии реестра — ракурс, в котором территория видна над панелью
  const REGISTRY_VIEW = { eye: [1750, 600, 1650], target: [120, 600, 0] };
  registry = setupRegistry({
    $, THREE, V3, data, model, pickMesh, scene, select, focusObject: flyToSelected, artifactBuild: __ARTIFACT_BUILD__,
    onOpen: () => {
      if (!selected) {
        setActiveView(null);
        flyTo(REGISTRY_VIEW.eye, REGISTRY_VIEW.target);
      }
    },
  });

  // ---------- вкладка «Объекты верфи» ----------
  objectList = setupObjectList({
    $, data, pickMesh, registryItems: registry.items,
    onPick: (o) => {
      if (hiddenLayers[o.layer]) {
        const cb = $('layer-' + o.layer);
        cb.checked = true;
        cb.dispatchEvent(new Event('change'));
      }
      select(o);
      flyToSelected(o);
    },
    onShowMany: showMany,
  });

  // все здания подразделения: подсветка и вид, в котором они видны разом
  function showMany(objs) {
    select(null);
    const polys = objs.filter((o) => o.proxy?.poly);
    if (!polys.length) return;
    manyHighlight = new THREE.Group();
    for (const o of polys) manyHighlight.add(makeHighlight(o.proxy));
    scene.add(manyHighlight);
    const pts = polys.flatMap((o) => o.proxy.poly);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const r = Math.max(60, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2);
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
    const k = 1.9 / Math.min(1, Math.max(0.45, camera.aspect));
    flyTo([c[0] + dir.x * r * k, c[1] - dir.z * r * k, r * k * 0.75 + 40], [c[0], c[1], 0], 1000);
    setActiveView(null);
    if (narrow()) setPanelCollapsed(true);
  }

  // ---------- редактор зданий ----------
  editor = setupEditor({
    $, THREE, V3, scene, camera, controls, model, data, getMaterial, origBuildings, origData, contextDetail,
    buildTime: { config: CUSTOM.config, files: customFiles, custom },
    artifactBuild: __ARTIFACT_BUILD__,
    inYard: (p) => model.planar.shipyardMP.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h))),
    zoneOf: (p) => data.zones.find((z) => pointInRing(p, z.polygon))?.id,
    attachModel, detachModel, makeModelHolder, placeHolder,
    setModelVisible: (id, v) => {
      const h = customScenes.get(id);
      if (h) h.visible = v;
    },
    addSigns,
    removeSigns: (id) => {
      for (const m of signMeshes.get(id) || []) m.parent?.remove(m);
      signMeshes.delete(id);
    },
    setSignsVisible: (id, v) => {
      for (const m of signMeshes.get(id) || []) m.visible = v;
    },
    rebuildLayers, refreshAll, highlightProxy, select, selectById,
    selectedId: () => selected?.id || null,
  });

  // ---------- освещение: день / вечер ----------
  const sky = makeSky(false);
  scene.background = sky.day;
  scene.fog = new THREE.Fog(0xcfdbe5, 4200, 11000);
  function setEvening(on) {
    $('optEvening').checked = on;
    scene.background = on ? sky.evening : sky.day;
    scene.fog.color.set(on ? 0x2a3140 : 0xcfdbe5);
    sun.color.set(on ? 0xffb37a : 0xfff3e0);
    sun.intensity = on ? 1.35 : 2.6;
    hemi.intensity = on ? 0.85 : 1.15;
    hemi.color.set(on ? 0x9fb0d0 : 0xdfe9f3);
    hemi.groundColor.set(on ? 0x5a4a44 : 0x6b6558);
    scene.environment = on ? envEvening : envDay;
    scene.environmentIntensity = on ? 0.6 : 0.8;
    renderer.toneMappingExposure = on ? 1.15 : 1.0;
    placeSun(on);
    const lit = getMaterial('glass_lit');
    lit.emissiveIntensity = on ? 1.6 : 0;
    const water = getMaterial('water');
    water.color.set(on ? 0x2e4a60 : 0x3e5d70);
  }
  function placeSun(evening) {
    // день: солнце с юго-юго-запада, ~40°; вечер — низко с северо-запада (белые ночи)
    const az = evening ? 300 : 210;
    const el = evening ? 9 : 40;
    const d = 2600;
    const x = Math.sin((az * Math.PI) / 180) * Math.cos((el * Math.PI) / 180) * d;
    const y = Math.cos((az * Math.PI) / 180) * Math.cos((el * Math.PI) / 180) * d;
    const z = Math.sin((el * Math.PI) / 180) * d;
    sun.position.copy(center).add(V3(x, y, z));
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  const startEvening = prefersDark || document.documentElement.dataset.theme === 'dark';
  $('optEvening').checked = startEvening;
  setEvening(startEvening);

  // ---------- размер и цикл отрисовки ----------
  // центр проекции смещён вправо на ширину левой панели, чтобы модель не пряталась под ней;
  // у свёрнутой панели смещения нет
  function applyView() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = (w + shift) / h;
    if (shift > 0.5) camera.setViewOffset(w + shift, h, 0, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    shift = shiftTo = panelShift();
    applyView();
  }
  window.addEventListener('resize', resize);
  setPanelCollapsed(narrow() || store('admiralty-panel-collapsed') === '1');
  resize();

  const startView = VIEWS.find((v) => '#' + v.id === location.hash) || VIEWS[0];
  setActiveView(startView.id);
  flyTo(startView.eye, startView.target, 0);

  const compassSvg = $('compass').querySelector('svg');
  let frame = 0;
  let prevNow = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = prevNow ? Math.min(now - prevNow, 100) : 16;
    prevNow = now;
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.ms);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(tween.e0, tween.e1, k);
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      if (t >= 1) tween = null;
    }
    if (shift !== shiftTo) {
      shift = reduceMotion || Math.abs(shiftTo - shift) < 1 ? shiftTo : shift + (shiftTo - shift) * (1 - Math.exp(-dt / 70));
      applyView();
    }
    controls.update();
    // компас: азимут камеры
    const az = controls.getAzimuthalAngle();
    compassSvg.style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
    for (const o of labelObjs) {
      const show = camera.position.distanceTo(o.position) <= o.userData.maxDist && !(yardOnly && o.userData.scope === 'city');
      if (o.userData.shown !== show) {
        o.userData.shown = show;
        o.element.style.opacity = show ? '1' : '0';
      }
    }
    frame++;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
  controls.addEventListener('start', () => {
    tween = null;
    setActiveView(null);
  });

  $('loading').remove();
  window.__viewer = { scene, camera, controls, flyTo, model, VIEWS, setEvening, select, selectById, focusObject, pickMesh, registry, objectList, editor, setYardOnly, setPanelCollapsed, setTab };
  window.__ready = true;

  // ---------- вспомогательные ----------
  function addSignText(s) {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#1d4f8f';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 58px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.text, cv.width / 2, cv.height / 2 + 3);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h * 0.85), new THREE.MeshBasicMaterial({ map: tex }));
    m.position.copy(V3(s.center[0], s.center[1], s.center[2]));
    m.lookAt(V3(s.center[0] + s.normal[0], s.center[1] + s.normal[1], s.center[2]));
    root.add(m);
    return m;
  }


}


// Эквирект-панорама неба для отражений (зенит → горизонт → «земля»).
function skyEquirect([zenith, mid, horizon, ground]) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, zenith);
  g.addColorStop(0.32, mid);
  g.addColorStop(0.5, horizon);
  g.addColorStop(0.52, ground);
  g.addColorStop(1, ground);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function mpArea(mp) {
  let s = 0;
  for (const poly of mp) {
    s += area(poly[0]);
    for (let i = 1; i < poly.length; i++) s -= area(poly[i]);
  }
  return s;
}

// Небо: вертикальный градиент (день и вечер).
function makeSky() {
  const make = (stops) => {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    for (const [t, col] of stops) g.addColorStop(t, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return {
    day: make([
      [0, '#8fb4d6'],
      [0.55, '#c9dbe8'],
      [1, '#e6edf2'],
    ]),
    evening: make([
      [0, '#1b2a44'],
      [0.5, '#3d4a6a'],
      [0.82, '#b8826b'],
      [1, '#e0a77d'],
    ]),
  };
}

main().catch((e) => {
  console.error(e);
  const l = document.getElementById('loading');
  if (l) l.innerHTML = `<div>Не удалось построить модель<small>${String(e && e.message ? e.message : e)}</small></div>`;
});
