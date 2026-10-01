// Интерактивный просмотр модели территории АО «Адмиралтейские верфи».

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { getTerritory } from '../data/index.js';
import { initModel, buildModel, toMergedGroups, buildPickMesh, toObjectHierarchy, LAYERS } from '../model/index.js';
import { createMaterialFactory } from '../model/materials.js';
import { toLatLon, centroid, area } from '../geo.js';
import { buildDXF } from '../export/dxf.js';
import { buildGeoJSON } from '../export/geojson.js';

const IS_ARTIFACT = !!window.__ARTIFACT__;
const $ = (id) => document.getElementById(id);

// модель (x восток, y север, z вверх) → three (X, Y вверх, Z = −север)
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const VIEWS = [
  { id: 'overview', name: 'Общий вид', eye: [-1720, -1040, 1480], target: [-200, 720, 0] },
  { id: 'plan', name: 'План', eye: [-255, 692, 3150], target: [-255, 700, 0] },
  { id: 'checkpoint', name: 'Главная проходная', eye: [110, 40, 70], target: [-50, 15, 5] },
  { id: 'slipways', name: 'Стапели', eye: [-760, 330, 150], target: [-330, 240, 8] },
  { id: 'novo', name: 'Новое Адмиралтейство', eye: [-160, 1880, 230], target: [60, 1420, 10] },
  { id: 'matisov', name: 'Матисов остров', eye: [-820, 860, 230], target: [-250, 760, 5] },
  { id: 'neva', name: 'Вид с Невы', eye: [-720, 600, 48], target: [-380, 760, 16] },
  { id: 'south', name: 'Со стороны Фонтанки', eye: [-180, -700, 600], target: [-240, 480, 0] },
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

const ZONE_LABEL = { galerny: 'Галерный остров', matisov: 'Матисов остров', novo: 'Ново-Адмиралтейский остров' };

// Короткие подписи-«булавки»: id объекта → [текст, дальность видимости, м]
const PINS = {
  G1: ['Главная проходная', 2600],
  G2: ['Заводоуправление', 1600],
  G4: ['Мастерская 1910 г.', 1400],
  G10: ['Корпусосборочный цех', 1400],
  S1: ['Стапель № 1', 2600],
  S2: ['Стапель № 2', 2600],
  M1: ['Корпусообрабатывающий цех', 1600],
  M2: ['Сборочно-сварочный цех', 1600],
  N1: ['Большой каменный эллинг', 2600],
  N2: ['Малый каменный эллинг', 1800],
  N3: ['Крытый эллинг', 2600],
  N6: ['Северная проходная', 1800],
  D1: ['Плавдок «Луга»', 1800],
  D2: ['Плавдок СПД-2М', 1600],
  K1: ['Поликлиника верфей', 1200],
  K2: ['Музей-квартира Блока', 1200],
  GU: ['Горный университет', 1800],
  'NH-arch': ['Арка Новой Голландии', 1400],
  B1: ['Старо-Калинкин мост', 1400],
  KR: ['Ледокол «Красин»', 1600],
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
  const model = buildModel(data);
  await step('материалы и освещение');
  const getMaterial = createMaterialFactory(THREE);
  const groups = toMergedGroups(THREE, model, getMaterial);
  const root = new THREE.Group();
  for (const g of groups) root.add(g);
  scene.add(root);
  const pickMesh = buildPickMesh(THREE, model);
  scene.add(pickMesh);
  const center = V3(-255, 700, 0);
  sun.target.position.copy(center);

  // вывеска на главной проходной
  for (const s of model.signs) addSignText(s);

  // ---------- управление камерой ----------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 15;
  controls.maxDistance = 4200;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;

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
  function addLabel(text, at, z, cls, minDist = 0, maxDist = Infinity) {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(V3(at[0], at[1], z));
    o.userData = { minDist, maxDist };
    scene.add(o);
    labelObjs.push(o);
    return o;
  }
  for (const l of data.labels) {
    if (l.kind === 'island') addLabel(l.text, l.at, 60, 'island', 0, 3600);
    else if (l.kind === 'district') addLabel(l.text, l.at, 40, 'district', 0, 3600);
    else if (l.kind === 'street') addLabel(l.text, l.at, 3, 'street', 0, 1300);
    else addLabel(l.text, l.at, 14, 'street', 0, 1300);
  }
  for (const l of data.water.labels) addLabel(l.text, l.at, 1, 'water' + (l.size === 'xl' ? ' xl' : ''), 0, l.size === 'xl' || l.size === 'l' ? 4000 : 1800);
  for (const o of pickMesh.userData.objects) {
    const pin = PINS[o.id];
    if (!pin) continue;
    const p = o.proxy;
    const c = centroid(p.poly);
    addLabel(pin[0], c, p.z1 + 4, 'pin', 0, pin[1]);
  }

  // ---------- интерфейс ----------
  const shipyardArea = (data.zones.filter((z) => z.kind === 'shipyard').reduce((s, z) => s + mpArea(model.planar.zones[z.id]), 0) / 1e4).toFixed(0);
  const nShip = model.layers.find((l) => l.id === 'shipyard').objects.length;
  const nCranes = data.cranes.filter((c) => !c.id.startsWith('BC')).length;
  $('facts').innerHTML = [`≈${shipyardArea} га`, `${nShip} зданий`, `${data.slipways.length} стапеля`, `${nCranes} кранов`, `3 острова`].map((t) => `<span class="fact">${t}</span>`).join('');
  $('note').innerHTML = data.meta.source === 'osm'
    ? `<b>Источник геометрии.</b> Контуры зданий, вода, улицы и ограждения — OpenStreetMap (© участники OSM, ODbL)${data.meta.osm?.fetched ? ', данные на ' + data.meta.osm.fetched.slice(0, 10) : ''}. Названия и описания объектов верфи — по открытым источникам.` +
      `<br /><span style="font-family:var(--font-data);font-size:11px">${model.stats.buildings} зданий · ${(model.stats.triangles / 1e6).toFixed(2)} млн треугольников</span>`
    : '<b>Точность.</b> Схема собрана по открытым источникам: адресам, описаниям и размерам объектов (стапели 259×35 м, эллинги, плавдоки). Берега и улицы привязаны к опорным точкам с точностью около ±30–80 м. Внутренняя планировка верфи условная, такие объекты помечены в карточке. ' +
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
  $('menuToggle').addEventListener('click', () => {
    const p = $('panel');
    const c = p.classList.toggle('collapsed');
    $('menuToggle').setAttribute('aria-expanded', String(!c));
  });
  if (window.matchMedia('(max-width: 760px)').matches) $('panel').classList.add('collapsed');
  $('compass').addEventListener('click', () => {
    const t = controls.target.clone();
    const d = camera.position.distanceTo(t);
    const polar = controls.getPolarAngle();
    const e = new THREE.Vector3(t.x, t.y + d * Math.cos(polar), t.z + d * Math.sin(polar));
    flyTo([e.x, -e.z, e.y], [t.x, -t.z, t.y], 700);
  });

  if (IS_ARTIFACT) {
    $('exportGroup').innerHTML =
      '<h2>Файлы модели</h2><p class="note" style="border:0;padding:0;margin:0">GLB (3D), DXF (генплан) и GeoJSON лежат в репозитории в папке <code>admiralty-shipyards-territory/dist</code>; там же локальная версия этой страницы с кнопками экспорта.</p>';
  } else {
    $('expGLB').addEventListener('click', exportGLB);
    $('expDXF').addEventListener('click', () => download(new Blob([buildDXF(data, model)], { type: 'application/dxf' }), 'admiralty-shipyards-plan.dxf'));
    $('expGEO').addEventListener('click', () =>
      download(new Blob([JSON.stringify(buildGeoJSON(data, model))], { type: 'application/geo+json' }), 'admiralty-shipyards.geojson'),
    );
  }

  // ---------- выбор объектов ----------
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let selected = null;
  let highlight = null;
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    setMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(pickMesh, false);
    const objs = pickMesh.userData.objects;
    const fo = pickMesh.userData.faceObj;
    const hit = hits.find((h) => !hiddenLayers[objs[fo[h.faceIndex]].layer]);
    select(hit ? objs[fo[hit.faceIndex]] : null);
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

  function select(o) {
    selected = o;
    if (highlight) {
      scene.remove(highlight);
      highlight.traverse((c) => c.geometry && c.geometry.dispose());
      highlight = null;
    }
    const card = $('card');
    if (!o) {
      card.hidden = true;
      return;
    }
    highlight = makeHighlight(o.proxy);
    scene.add(highlight);
    const i = o.info;
    const rows = [];
    if (i.zone && ZONE_LABEL[i.zone]) rows.push(['Участок', ZONE_LABEL[i.zone]]);
    if (i.dims) rows.push(['Размеры', `${i.dims[0]} × ${i.dims[1]} м`]);
    if (i.height) rows.push(['Высота', `${i.height} м`]);
    if (i.floors) rows.push(['Этажей', i.floors]);
    if (i.footprint) rows.push(['Площадь застройки', `${i.footprint.toLocaleString('ru-RU')} м²`]);
    const c = o.proxy.poly ? centroid(o.proxy.poly) : o.proxy.line[0];
    const [lat, lon] = toLatLon(c);
    rows.push(['Координаты', `${lat.toFixed(5)}, ${lon.toFixed(5)}`]);
    card.innerHTML = `
      <button class="x" type="button" aria-label="Закрыть">×</button>
      <div class="kind">${KIND_LABEL[i.kind] || 'Объект'}</div>
      <h3>${escapeHtml(o.name)}</h3>
      ${i.approx || o.generated ? '<span class="badge">Положение условное</span>' : ''}
      ${i.info ? `<p>${escapeHtml(i.info)}</p>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
      <div class="row"><button class="btn" type="button" id="cardFly">Приблизить</button></div>`;
    card.hidden = false;
    card.querySelector('.x').addEventListener('click', () => select(null));
    card.querySelector('#cardFly').addEventListener('click', () => {
      const h = o.proxy.z1 ?? o.proxy.h ?? 10;
      const r = Math.max(60, Math.sqrt(o.proxy.poly ? area(o.proxy.poly) : 400) * 1.6 + h * 1.5);
      const dir = new THREE.Vector3().subVectors(camera.position, controls.target).setY(0).normalize();
      const eye = [c[0] + dir.x * r, c[1] - dir.z * r, h + r * 0.55];
      flyTo(eye, [c[0], c[1], h * 0.4], 900);
      setActiveView(null);
    });
  }

  function makeHighlight(p) {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: getComputedStyle(document.documentElement).getPropertyValue('--signal').trim() || '#d4500f', depthTest: false, transparent: true });
    const pts = [];
    if (p.line) {
      for (let i = 0; i < p.line.length - 1; i++) {
        const a = p.line[i];
        const b = p.line[i + 1];
        pts.push(V3(a[0], a[1], p.h), V3(b[0], b[1], p.h), V3(a[0], a[1], 0.3), V3(b[0], b[1], 0.3));
      }
    } else {
      const r = p.poly;
      const z0 = Math.max(p.z0, 0.3);
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        pts.push(V3(a[0], a[1], z0), V3(b[0], b[1], z0), V3(a[0], a[1], p.z1), V3(b[0], b[1], p.z1), V3(a[0], a[1], z0), V3(a[0], a[1], p.z1));
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 10;
    g.add(lines);
    return g;
  }

  // ---------- освещение: день / вечер ----------
  const sky = makeSky(false);
  scene.background = sky.day;
  scene.fog = new THREE.Fog(0xcfdbe5, 4200, 11000);
  function setEvening(on) {
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
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    // смещаем центр проекции вправо, чтобы модель не пряталась под левой панелью
    const panel = $('panel');
    const pr = w > 760 && panel ? panel.getBoundingClientRect().right : 0;
    camera.aspect = (w + pr) / h;
    if (pr > 0) camera.setViewOffset(w + pr, h, 0, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const startView = VIEWS.find((v) => '#' + v.id === location.hash) || VIEWS[0];
  setActiveView(startView.id);
  flyTo(startView.eye, startView.target, 0);

  const compassSvg = $('compass').querySelector('svg');
  let frame = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (tween) {
      const t = Math.min(1, (now - tween.start) / tween.ms);
      const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(tween.e0, tween.e1, k);
      controls.target.lerpVectors(tween.t0, tween.t1, k);
      if (t >= 1) tween = null;
    }
    controls.update();
    // компас: азимут камеры
    const az = controls.getAzimuthalAngle();
    compassSvg.style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
    for (const o of labelObjs) {
      const show = camera.position.distanceTo(o.position) <= o.userData.maxDist;
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
  window.__viewer = { scene, camera, controls, flyTo, model, VIEWS, setEvening, select, pickMesh };
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
  }

  async function exportGLB() {
    const btn = $('expGLB');
    btn.textContent = '…';
    await new Promise((r) => setTimeout(r, 30));
    const hier = toObjectHierarchy(THREE, model, createMaterialFactory(THREE, { forExport: true }));
    new GLTFExporter().parse(
      hier,
      (buf) => {
        download(new Blob([buf], { type: 'model/gltf-binary' }), 'admiralty-shipyards.glb');
        btn.textContent = 'GLB';
      },
      (err) => {
        console.error(err);
        btn.textContent = 'GLB';
      },
      { binary: true },
    );
  }
}

function download(blob, name) {
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
