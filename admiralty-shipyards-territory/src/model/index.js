// Сборка модели: из данных территории → слои объектов с геометрией (Sink) и
// метаданными для выбора/подписей/экспорта. Не зависит от окружения (браузер или Node).

import { Sink, setTriangulator } from './geom.js';
import { buildPlanar } from './planar.js';
import { buildGround, buildQuayEdges, buildRoads, buildAreas, buildRails } from './terrain.js';
import { buildBuilding, buildingSummary, archWallProxy } from './buildings.js';
import { buildFence, autoFences } from './fences.js';
import { buildCrane } from './cranes.js';
import { buildShip, buildDock, buildSlipway, slipProfile, slipPitch } from './ships.js';
import { buildBridge, buildChimney, buildArch, buildTree, scatterInPolygon, buildBlocks, buildContainers, buildBusStop } from './structures.js';
import { BUS_DIRS, stopTimes } from '../data/bus.js';
import { generateFrontage } from './frontage.js';
import { rect, dirOf, add, mul, perp, rng, ensureCCW, bufferPolyline, polylineLength, pointAt, pointInRing, DEG } from '../geo.js';
import { PALETTE } from './materials.js';
import { removeFromData, applyCustom, editBuildingsData } from './custom.js';

export const LAYERS = [
  { id: 'terrain', name: 'Рельеф, вода, набережные' },
  { id: 'roads', name: 'Дороги, площадки, рельсы' },
  { id: 'fence', name: 'Ограждение и ворота' },
  { id: 'shipyard', name: 'Здания верфи' },
  { id: 'production', name: 'Стапели, краны, оборудование' },
  { id: 'vessels', name: 'Суда и плавдоки' },
  { id: 'transport', name: 'Автобусы и остановки' },
  { id: 'bridges', name: 'Мосты' },
  { id: 'context', name: 'Окружающая застройка' },
  { id: 'greenery', name: 'Деревья' },
];

export function initModel(THREE) {
  setTriangulator((contour, holes) =>
    THREE.ShapeUtils.triangulateShape(
      contour.map((p) => new THREE.Vector2(p.x, p.y)),
      holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.y))),
    ),
  );
}

// Прокси для выбора объектов мышью: призма по контуру или ориентированный блок.
const prismProxy = (poly, z0, z1) => ({ poly: ensureCCW(poly), z0, z1 });
const boxProxy = (at, angle, L, B, z0, z1) => prismProxy(rect(at[0], at[1], L, B, angle), z0, z1);

const hashStr = (t) => {
  let h = 7;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return h % 100000;
};

// custom — доработки из папки custom/ (см. prepareCustom в custom.js): удаление, замена, новые здания
export function buildModel(data, { frontage = true, contextDetail = 'auto', custom = null } = {}) {
  const t0 = Date.now();
  const removedFromData = custom ? removeFromData(data, custom.remove) : new Set();
  const P = buildPlanar(data);
  const inYardMP = (p) => P.shipyardMP.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h)));
  const zoneOf = (p) => (data.zones || []).find((z) => pointInRing(p, z.polygon))?.id;
  // правки зданий и новые здания из custom.json / редактора — до сборки зданий
  const pre = custom ? editBuildingsData(data, custom, { inYard: inYardMP, zoneOf }) : null;
  const layers = Object.fromEntries(LAYERS.map((l) => [l.id, { ...l, objects: [] }]));
  // scope: 'yard' — относится к верфи, 'city' — окружение (скрывается кнопкой «Только верфь»),
  // 'base' — земля и вода (видны всегда)
  const DEFAULT_SCOPE = { terrain: 'base', roads: 'city', fence: 'yard', shipyard: 'yard', production: 'yard', vessels: 'yard', transport: 'yard', bridges: 'city', context: 'city', greenery: 'city' };
  const add_ = (layer, obj) => {
    obj.scope ??= DEFAULT_SCOPE[layer] || 'city';
    layers[layer].objects.push(obj);
    return obj;
  };
  const signs = [];

  // ---------- рельеф ----------
  {
    const s = new Sink();
    buildGround(s, data, P);
    add_('terrain', { id: 'ground', name: 'Суша и акватория', sink: s });
    const sp = new Sink();
    const sb = new Sink();
    buildQuayEdges(sp, sb, data, P);
    add_('terrain', { id: 'parapets', name: 'Гранитные парапеты набережных', sink: sp, scope: 'city' });
    add_('terrain', { id: 'bollards', name: 'Кнехты и отбойный брус причалов', sink: sb, scope: 'yard' });
  }

  // ---------- дороги и площадки ----------
  {
    const s = new Sink();
    const m = new Sink();
    const yr = new Sink();
    buildRoads(s, m, data, P, yr);
    add_('roads', { id: 'roads', name: 'Улицы и тротуары', sink: s, scope: 'city' });
    add_('roads', { id: 'yard-roads', name: 'Внутризаводские проезды', sink: yr, scope: 'yard' });
    add_('roads', { id: 'markings', name: 'Дорожная разметка', sink: m, scope: 'city' });
    const yardArea = (a) => /^A\d/.test(a.id);
    const a = new Sink();
    buildAreas(a, data, P, (x) => !yardArea(x));
    add_('roads', { id: 'areas', name: 'Площади и скверы', sink: a, scope: 'city' });
    const ya = new Sink();
    buildAreas(ya, data, P, yardArea);
    add_('roads', { id: 'yard-areas', name: 'Площадки верфи', sink: ya, scope: 'yard' });
    const r = new Sink();
    buildRails(r, data);
    add_('roads', { id: 'rails', name: 'Подкрановые и железнодорожные пути', sink: r, scope: 'yard' });
  }

  // ---------- ограждение ----------
  // автоматическая ограда по контуру участков (один раз на набор данных — её видят и экспорты)
  if (data.autoFence && !data.autoFenced) {
    data.fences = [...data.fences, ...autoFences(data, P)];
    data.autoFenced = true;
  }
  if (custom) for (const f of data.fences) if (custom.remove.has(f.id)) removedFromData.add(f.id);
  if (custom) data.fences = data.fences.filter((f) => !custom.remove.has(f.id));
  for (const f of data.fences) {
    const s = new Sink();
    buildFence(s, f);
    add_('fence', {
      id: f.id,
      name: f.name,
      sink: s,
      info: {
        name: f.name,
        info: `${{ concrete: 'Железобетонный забор с колючей проволокой', mesh: 'Сетчатое ограждение по кромке набережной', wall: 'Исторический кирпичный забор с пилястрами', sheet: 'Забор из профлиста вокруг участка, который заводу больше не принадлежит' }[f.type]}, высота ${f.h} м, длина ${Math.round(polylineLength(f.line))} м.${(f.gates || []).length ? ' Ворота: ' + f.gates.map((g) => g.name).join(', ') + '.' : ''}`,
        kind: 'fence',
      },
      proxy: { line: f.line, h: (f.h || 2.5) + 0.6 },
      // забор соседнего участка — не верфь: скрывается вместе с городом
      ...(f.foreign ? { scope: 'city' } : {}),
    });
  }

  // ---------- здания ----------
  // contextDetail: 'low' — окружение без окон (для лёгкого экспорта)
  // оставленные здания соседних участков (СПбГМТУ, башня Берда) — с окнами и всегда подробно
  const explicit = contextDetail === 'low' ? data.buildings.map((b) => (b.kind === 'context' && !b.foreign ? { ...b, detail: 'low' } : b)) : data.buildings;
  const generated = frontage && data.frontage !== false ? generateFrontage(data, P, explicit, { contextDetail }) : [];
  for (const b of [...explicit, ...generated]) add_(buildingLayer(b), makeBuildingObject(b, signs));

  // ---------- стапели, суда на стапелях ----------
  const slipById = {};
  for (const sw of data.slipways) {
    const s = new Sink();
    const res = buildSlipway(s, sw);
    slipById[sw.id] = { sw, ...res };
    const end = add(sw.head, mul(dirOf(sw.angle), sw.length));
    add_('production', {
      id: sw.id,
      name: sw.name,
      sink: s,
      info: { name: sw.name, info: sw.info, kind: 'slipway', dims: [sw.length, sw.width] },
      proxy: prismProxy(bufferPolyline([sw.head, end], sw.width / 2), 0, 6),
    });
  }

  for (const c of data.cranes) {
    const s = new Sink();
    buildCrane(s, c);
    const size = c.type === 'gantry' ? [c.len + 4, c.span + 4] : [14, 14];
    const ang = c.type === 'gantry' ? c.angle : c.track;
    add_('production', {
      id: c.id,
      name: c.name,
      sink: s,
      info: {
        name: c.name,
        info: { portal: 'Портальный кран на рельсовом ходу', tower: 'Башенный стапельный кран на рельсовом ходу', gantry: 'Козловой кран' }[c.type] + `, высота ≈ ${Math.round(c.h + (c.type === 'tower' ? 9 : 0))} м.`,
        kind: 'crane',
      },
      proxy: boxProxy(c.at, ang, size[0], size[1], 0, c.h + 8),
    });
  }

  for (const ch of data.chimneys) {
    const s = new Sink();
    buildChimney(s, ch);
    add_('production', { id: ch.id, name: ch.name, sink: s, info: { name: ch.name, info: `${ch.info ? ch.info + ' ' : ''}Высота ≈ ${ch.h} м.`, kind: 'chimney' }, proxy: boxProxy(ch.at, 0, Math.max(ch.r * 2.4, 3), Math.max(ch.r * 2.4, 3), 0, ch.h) });
  }

  // укрупнённые секции корпуса на предстапельной площадке и контейнеры — каждый объект
  // отдельно: их можно выбрать, сдвинуть, заменить моделью и удалить
  const A2 = data.areas.find((x) => x.id === 'A2');
  if (A2) {
    const [c0, c1, , c3] = A2.polygon;
    const ctr = [(c1[0] + c3[0]) / 2, (c1[1] + c3[1]) / 2];
    const along = Math.atan2(c1[1] - c0[1], c1[0] - c0[0]) / DEG;
    const ca = Math.cos(along * DEG);
    const sa = Math.sin(along * DEG);
    [
      [-40, 0, 14, 12, 7],
      [-18, 1, 12, 14, 9],
      [8, 0, 16, 12, 6],
      [34, 0, 12, 12, 8],
    ].forEach(([u, v, w, d, h], i) => {
      const s = new Sink();
      buildBlocks(s, ctr, along, [[u, v, w, d, h]]);
      const p = [ctr[0] + ca * u - sa * v, ctr[1] + sa * u + ca * v];
      const name = 'Укрупнённая секция корпуса';
      add_('production', {
        id: `SB${i + 1}`,
        name,
        sink: s,
        info: { name, info: `Секция на кильблоках, ≈ ${w} × ${d} × ${h} м. Предстапельная площадка у стапеля № 1.`, kind: 'misc' },
        proxy: boxProxy(p, along, w, d, 0, h + 0.6),
      });
    });
  }
  for (const c of data.containers || []) {
    const s = new Sink();
    buildContainers(s, c.at, c.angle, c.n, c.seed);
    // ряд до четырёх контейнеров поперёк направления angle, ярусами
    const row = Math.min(c.n, 4);
    const tiers = Math.ceil(c.n / 4);
    const off = ((row - 1) * 2.7) / 2;
    const ctr = [c.at[0] - Math.sin(c.angle * DEG) * off, c.at[1] + Math.cos(c.angle * DEG) * off];
    const name = 'Контейнеры (бытовки, склады)';
    add_('production', {
      id: c.id,
      name,
      sink: s,
      info: { name, info: `${c.n} контейнеров 20 футов (6,1 × 2,4 м), ${tiers} ${tiers === 1 ? 'ярус' : 'яруса'}.`, kind: 'misc' },
      proxy: boxProxy(ctr, c.angle, 6.3, (row - 1) * 2.7 + 2.6, 0, tiers * 2.6 + 0.1),
    });
  }

  // ---------- плавдоки ----------
  const dockTop = {};
  for (const d of data.docks) {
    const s = new Sink();
    dockTop[d.id] = buildDock(s, d);
    add_('vessels', { id: d.id, name: d.name, sink: s, info: { name: d.name, info: d.info, kind: 'dock', dims: [d.L, d.B] }, proxy: boxProxy(d.at, d.angle, d.L, d.B, -2.4, 14) });
  }

  // ---------- суда ----------
  for (const sh of data.ships) {
    const s = new Sink();
    let opts = {};
    let shp = sh;
    if (sh.onSlip) {
      const S = slipById[sh.onSlip];
      const tMid = Math.hypot(sh.at[0] - S.sw.head[0], sh.at[1] - S.sw.head[1]);
      const z = S.zAt(tMid) + 1.4;
      opts = { pitch: slipPitch(S.sw) };
      shp = { ...sh, z };
      // кильблоки под корпусом
      for (let u = tMid - sh.L / 2 + 4; u < tMid + sh.L / 2 - 4; u += 5) {
        const p = add(S.sw.head, mul(dirOf(S.sw.angle), u));
        s.box('keelblock', [p[0], p[1], S.zAt(u) + 0.7], [1.4, 3.0, 1.4], S.sw.angle);
        for (const v of [-1, 1]) {
          const q = add(p, mul(perp(dirOf(S.sw.angle)), v * sh.B * 0.3));
          s.box('keelblock', [q[0], q[1], S.zAt(u) + 1.2], [1.2, 1.2, 2.4], S.sw.angle);
        }
      }
    } else if (sh.onDock) {
      shp = { ...sh, z: dockTop[sh.onDock] + sh.B / 2 };
    }
    buildShip(s, shp, opts);
    const isSub = sh.hull === 'submarine';
    const zBase = sh.afloat ? -2.4 - (sh.T || 0) : shp.z ?? 0;
    add_(sh.id === 'KR' ? 'context' : 'vessels', {
      id: sh.id,
      name: sh.name,
      sink: s,
      info: { name: sh.name, info: sh.info, kind: 'vessel', dims: [sh.L, sh.B] },
      proxy: boxProxy(sh.at, sh.angle, sh.L, sh.B, zBase, zBase + (isSub ? sh.B + 6 : (sh.D || 10) + 18)),
    });
  }

  // ---------- внутризаводской автобус: остановки ----------
  // сами автобусы движутся по расписанию — их рисует просмотрщик (main.js)
  for (const st of data.bus?.stops || []) {
    const s = new Sink();
    buildBusStop(s, st);
    const fmt = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    let info;
    if (st.ring) info = 'Кольцо внутризаводских автобусов у Северной проходной. Утром первый автобус выходит на линию в 7:00, второй в 7:30 (рейс от цеха № 33); после обеда в 12:30 и 13:00. Здесь автобусы ждут рейсов и стоят в обед.';
    else {
      const all = stopTimes(st.stop, st.dir, 1).map(fmt);
      const fri = stopTimes(st.stop, st.dir, 5);
      info = `Внутризаводские автобусы, направление «${BUS_DIRS[st.dir].name}». Отправление с понедельника по четверг: ${all.join(', ')}. В пятницу последнее отправление в ${fmt(fri[fri.length - 1])}.`;
    }
    const right = [Math.sin(st.zone.angle * DEG), -Math.cos(st.zone.angle * DEG)];
    add_('transport', {
      id: st.id,
      name: st.ring ? 'Кольцо у Северной проходной' : `Остановка «${st.name}»`,
      sink: s,
      info: { name: st.ring ? 'Кольцо у Северной проходной' : `Остановка «${st.name}»`, info, kind: 'bus_stop' },
      proxy: boxProxy(add(st.zone.at, mul(right, 1.2)), st.zone.angle, st.zone.L, st.zone.W + 2.6, 0, 3),
    });
  }

  // ---------- мосты и арка ----------
  for (const br of data.bridges) {
    const s = new Sink();
    buildBridge(s, br);
    add_('bridges', { id: br.id, name: br.name, sink: s, scope: br.type === 'industrial' ? 'yard' : 'city', info: { name: br.name, info: br.info, kind: 'bridge' }, proxy: prismProxy(bufferPolyline([br.from, br.to], br.w / 2, { capExtend: 3 }), -1, br.type === 'kalinkin' ? 10 : 2.5) });
  }
  for (const a of data.arches) {
    const s = new Sink();
    buildArch(s, a);
    add_('context', { id: a.id, name: a.name, sink: s, info: { name: a.name, info: a.info, kind: 'landmark' }, proxy: boxProxy(a.at, a.angle, a.w + 9, 28, 0, a.h) });
  }

  // ---------- озеленение ----------
  {
    const s = new Sink();
    const sY = new Sink();
    const R = rng(77);
    const keys = ['foliage', 'foliage2', 'foliage3'];
    const B = data.meta.bounds;
    const onLand = (p) =>
      p[0] > B.minX + 3 && p[0] < B.maxX - 3 && p[1] > B.minY + 3 && p[1] < B.maxY - 3 &&
      P.land.some((poly) => pointInRing(p, poly[0]) && !poly.slice(1).some((h) => pointInRing(p, h))) &&
      !P.carriageways.some((poly) => pointInRing(p, poly[0]));
    const plant = (pts, hMin = 9, hMax = 15) => {
      for (const p of pts) {
        if (!onLand(p)) continue;
        const h = hMin + R() * (hMax - hMin);
        buildTree(inYardMP(p) ? sY : s, p, h, 2.4 + R() * 1.6, keys[Math.floor(R() * 3)]);
      }
    };
    // деревья в скверах и на газонах (с ограничением общего числа — модель смотрят и с телефона)
    let budget = 1400;
    for (const a of data.areas) {
      if (budget <= 0) break;
      const pts = a.kind === 'garden' ? scatterInPolygon(a.polygon, 11, hashStr(a.id) + 7, 3) : a.kind === 'lawn' ? scatterInPolygon(a.polygon, 14, hashStr(a.id) + 3, 3) : [];
      const sel = pts.slice(0, Math.min(pts.length, budget, a.kind === 'lawn' ? 6 : 60));
      budget -= sel.length;
      if (a.kind === 'garden') plant(sel);
      else plant(sel, 6, 10);
    }
    add_('greenery', { id: 'trees', name: 'Деревья', sink: s, scope: 'city' });
    add_('greenery', { id: 'trees-yard', name: 'Деревья на территории верфи', sink: sY, scope: 'yard' });
  }

  // ---------- доработки вручную: замена моделью из Blender, новые здания ----------
  const customReport = custom
    ? applyCustom(custom, { layers, signs, data, removedFromData, pre, inYard: inYardMP, zoneOf, summary: buildingSummary, Sink })
    : null;

  // статистика
  let tris = 0;
  for (const l of Object.values(layers)) for (const o of l.objects) tris += o.sink.triangleCount();
  return {
    planar: P,
    layers: LAYERS.map((l) => layers[l.id]),
    signs,
    generatedCount: generated.length,
    custom: customReport,
    stats: { triangles: tris, ms: Date.now() - t0, buildings: explicit.length + generated.length },
  };
}

// Объект слоя для здания: геометрия, сведения для карточки и реестра, прокси для выбора.
// Используется при сборке и редактором на сайте (перестройка одного здания).
export const buildingLayer = (b) => (b.kind === 'shipyard' ? 'shipyard' : 'context');
export function makeBuildingObject(b, signs = []) {
  let s = new Sink();
  buildBuilding(s, b, { signs });
  const roofH = b.roof && b.roof.type !== 'flat' ? (b.roof.h ?? 3) : 0;
  // поднятое или опущенное здание (lift, м)
  const lift = b.lift || 0;
  if (lift) {
    const up = new Sink();
    up.mergeShifted(s, lift);
    s = up;
    for (const sg of signs) if (sg.id === b.id && sg.center) sg.center = [sg.center[0], sg.center[1], sg.center[2] + lift];
  }
  const shift = (p) => ({ ...p, z0: p.z0 + lift, z1: p.z1 + lift });
  return {
    id: b.id,
    name: b.name,
    sink: s,
    info: { ...buildingSummary(b), kind: b.kind === 'shipyard' ? 'building' : 'context' },
    proxy: { ...shift(prismProxy(b.poly, 0, b.h + roofH)), ...(b.walls?.length ? { extra: b.walls.map((w) => shift(archWallProxy(w))) } : {}) },
    generated: !!b.generated,
    edited: !!b.edited,
    scope: b.kind === 'shipyard' ? 'yard' : 'city',
  };
}

// ---------- преобразование в объекты three.js ----------

// Для просмотра: по каждому слою объединить геометрию по материалам (мало вызовов отрисовки).
export function toMergedGroups(THREE, model, getMaterial) {
  return model.layers.map((layer) => {
    const g = new THREE.Group();
    g.name = layer.name;
    g.userData.layer = layer.id;
    fillLayerGroup(THREE, g, layer, getMaterial);
    return g;
  });
}

// (Пере)заполнить группу слоя; exclude — коды объектов, которые не рисовать (их правят в редакторе).
// Подгруппы с моделями из custom/ (userData.custom) и подвижные объекты (userData.keep) не трогаются.
export function fillLayerGroup(THREE, g, layer, getMaterial, exclude = null) {
  for (const c of [...g.children]) {
    if (c.userData.custom || c.userData.keep) continue;
    g.remove(c);
    c.traverse((m) => m.geometry && m.geometry.dispose());
  }
  // внутри слоя — подгруппы по принадлежности (верфь / город / основа), чтобы город
  // можно было скрыть одним переключателем
  for (const scope of ['base', 'yard', 'city']) {
    const objs = layer.objects.filter((o) => (o.scope || 'city') === scope && !(exclude && exclude.has(o.id)));
    if (!objs.length) continue;
    const merged = new Sink();
    for (const o of objs) merged.merge(o.sink);
    const sg = new THREE.Group();
    sg.name = `${layer.id}:${scope}`;
    sg.userData.scope = scope;
    for (const { key, geometry } of merged.toGeometries(THREE)) {
      const mesh = new THREE.Mesh(geometry, getMaterial(key));
      mesh.name = `${layer.id}:${scope}:${key}`;
      const tr = PALETTE[key]?.opacity != null;
      mesh.castShadow = !tr && layer.id !== 'terrain' && layer.id !== 'roads';
      mesh.receiveShadow = true;
      if (key === 'water') mesh.userData.water = true;
      sg.add(mesh);
    }
    g.add(sg);
  }
  return g;
}

// Для экспорта: иерархия Слой → Объект (один Mesh с группами материалов).
export function toObjectHierarchy(THREE, model, getMaterial) {
  const root = new THREE.Group();
  root.name = 'Адмиралтейские верфи — территория';
  for (const layer of model.layers) {
    const g = new THREE.Group();
    g.name = layer.name;
    for (const o of layer.objects) {
      const parts = o.sink.toGeometries(THREE);
      if (!parts.length) continue;
      const geoms = parts.map((p) => p.geometry);
      const mats = parts.map((p) => getMaterial(p.key));
      const geometry = mergeWithGroups(THREE, geoms);
      const mesh = new THREE.Mesh(geometry, mats);
      mesh.name = `${o.id} ${o.name}`.trim();
      if (o.info) mesh.userData = cleanUserData(o.info);
      g.add(mesh);
    }
    root.add(g);
  }
  return root;
}

export function cleanUserData(info) {
  const out = {};
  for (const [k, v] of Object.entries(info)) if (v != null && typeof v !== 'object') out[k] = v;
  if (info.dims) out.dims = info.dims.join(' × ');
  return out;
}

function mergeWithGroups(THREE, geoms) {
  let vtx = 0;
  let idx = 0;
  for (const g of geoms) {
    vtx += g.attributes.position.count;
    idx += g.index.count;
  }
  const pos = new Float32Array(vtx * 3);
  const nrm = new Float32Array(vtx * 3);
  const index = vtx > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const out = new THREE.BufferGeometry();
  let vo = 0;
  let io = 0;
  geoms.forEach((g, i) => {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) index[io + k] = gi[k] + vo;
    out.addGroup(io, gi.length, i);
    vo += g.attributes.position.count;
    io += gi.length;
  });
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

// Прокси-сетка для выбора объектов: треугольники + индекс объекта для каждого треугольника.
export function buildPickMesh(THREE, model) {
  const pos = [];
  const faceObj = [];
  const objs = [];
  const pushTri = (a, b, c, k) => {
    pos.push(a[0], a[2], -a[1], b[0], b[2], -b[1], c[0], c[2], -c[1]);
    faceObj.push(k);
  };
  for (const layer of model.layers) {
    for (const o of layer.objects) {
      if (!o.proxy || !o.info) continue;
      const k = objs.length;
      objs.push({ id: o.id, name: o.name, layer: layer.id, scope: o.scope, info: o.info, proxy: o.proxy, generated: o.generated, custom: o.custom });
      if (o.proxy.line) {
        const line = o.proxy.line;
        const z0 = o.proxy.z0 || 0;
        const h = z0 + o.proxy.h;
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i];
          const b = line[i + 1];
          pushTri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], h], k);
          pushTri([a[0], a[1], z0], [b[0], b[1], h], [a[0], a[1], h], k);
        }
        continue;
      }
      // призма выбора; extra — стены двора и прочие части объекта вне основного контура
      for (const { poly, z0, z1 } of [o.proxy, ...(o.proxy.extra || [])]) {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          pushTri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], k);
          pushTri([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], k);
        }
        for (let i = 1; i < poly.length - 1; i++) pushTri([poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1], k);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  mesh.name = 'pick-proxies';
  mesh.userData.faceObj = faceObj;
  mesh.userData.objects = objs;
  return mesh;
}

export { DEG };
