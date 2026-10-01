// Сборка модели: из данных территории → слои объектов с геометрией (Sink) и
// метаданными для выбора/подписей/экспорта. Не зависит от окружения (браузер или Node).

import { Sink, setTriangulator } from './geom.js';
import { buildPlanar } from './planar.js';
import { buildGround, buildQuayEdges, buildRoads, buildAreas, buildRails } from './terrain.js';
import { buildBuilding, buildingSummary } from './buildings.js';
import { buildFence } from './fences.js';
import { buildCrane } from './cranes.js';
import { buildShip, buildDock, buildSlipway, slipProfile, slipPitch } from './ships.js';
import { buildBridge, buildChimney, buildArch, buildTree, scatterInPolygon, buildCar, buildStock, buildBlocks, buildContainers } from './structures.js';
import { generateFrontage } from './frontage.js';
import { rect, dirOf, add, mul, perp, rng, ensureCCW, bufferPolyline, polylineLength, pointAt, pointInRing, DEG } from '../geo.js';
import { PALETTE } from './materials.js';

export const LAYERS = [
  { id: 'terrain', name: 'Рельеф, вода, набережные' },
  { id: 'roads', name: 'Дороги, площадки, рельсы' },
  { id: 'fence', name: 'Ограждение и ворота' },
  { id: 'shipyard', name: 'Здания верфи' },
  { id: 'production', name: 'Стапели, краны, оборудование' },
  { id: 'vessels', name: 'Суда и плавдоки' },
  { id: 'bridges', name: 'Мосты' },
  { id: 'context', name: 'Окружающая застройка' },
  { id: 'greenery', name: 'Деревья и автомобили' },
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

export function buildModel(data, { frontage = true, contextDetail = 'auto' } = {}) {
  const t0 = Date.now();
  const P = buildPlanar(data);
  const layers = Object.fromEntries(LAYERS.map((l) => [l.id, { ...l, objects: [] }]));
  const add_ = (layer, obj) => {
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
    add_('terrain', { id: 'parapets', name: 'Гранитные парапеты набережных', sink: sp });
    add_('terrain', { id: 'bollards', name: 'Кнехты и отбойный брус причалов', sink: sb });
  }

  // ---------- дороги и площадки ----------
  {
    const s = new Sink();
    const m = new Sink();
    buildRoads(s, m, data, P);
    add_('roads', { id: 'roads', name: 'Улицы, тротуары, внутризаводские проезды', sink: s });
    add_('roads', { id: 'markings', name: 'Дорожная разметка', sink: m });
    const a = new Sink();
    buildAreas(a, data, P);
    add_('roads', { id: 'areas', name: 'Площади, скверы, площадки', sink: a });
    const r = new Sink();
    buildRails(r, data);
    add_('roads', { id: 'rails', name: 'Подкрановые и железнодорожные пути', sink: r });
  }

  // ---------- ограждение ----------
  for (const f of data.fences) {
    const s = new Sink();
    buildFence(s, f);
    add_('fence', {
      id: f.id,
      name: f.name,
      sink: s,
      info: {
        name: f.name,
        info: `${{ concrete: 'Железобетонный забор с колючей проволокой', mesh: 'Сетчатое ограждение по кромке набережной', wall: 'Исторический кирпичный забор с пилястрами' }[f.type]}, высота ${f.h} м, длина ${Math.round(polylineLength(f.line))} м.${(f.gates || []).length ? ' Ворота: ' + f.gates.map((g) => g.name).join(', ') + '.' : ''}`,
        kind: 'fence',
      },
      proxy: { line: f.line, h: (f.h || 2.5) + 0.6 },
    });
  }

  // ---------- здания ----------
  const explicit = data.buildings;
  const generated = frontage && data.frontage !== false ? generateFrontage(data, P, explicit, { contextDetail }) : [];
  for (const b of [...explicit, ...generated]) {
    const s = new Sink();
    buildBuilding(s, b, { signs });
    const sum = buildingSummary(b);
    const roofH = b.roof && b.roof.type !== 'flat' ? (b.roof.h ?? 3) : 0;
    add_(b.kind === 'shipyard' ? 'shipyard' : 'context', {
      id: b.id,
      name: b.name,
      sink: s,
      info: { ...sum, kind: b.kind === 'shipyard' ? 'building' : 'context' },
      proxy: prismProxy(b.poly, 0, b.h + roofH),
      generated: !!b.generated,
    });
  }

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
    add_('production', { id: ch.id, name: ch.name, sink: s, info: { name: ch.name, info: `Высота ≈ ${ch.h} м.`, kind: 'chimney' }, proxy: boxProxy(ch.at, 0, ch.r * 2.4, ch.r * 2.4, 0, ch.h) });
  }

  // металлопрокат, секции, контейнеры
  {
    const s = new Sink();
    const A1 = data.areas.find((a) => a.id === 'A1');
    if (A1) buildStock(s, A1.polygon, 11);
    const A3 = data.areas.find((a) => a.id === 'A3');
    if (A3) buildStock(s, A3.polygon, 12);
    buildBlocks(s, [-236, 236], 96, [
      [-40, 0, 14, 12, 7],
      [-18, 1, 12, 14, 9],
      [8, 0, 16, 12, 6],
      [34, 0, 12, 12, 8],
    ]);
    buildContainers(s, [-500, 30], 254, 10, 7);
    buildContainers(s, [-335, 1015], 86, 8, 8);
    add_('production', {
      id: 'stock',
      name: 'Складируемый металл, секции корпуса, контейнеры',
      sink: s,
      info: { name: 'Секции корпуса и металлопрокат', info: 'Предстапельная площадка: укрупнённые секции корпуса; открытые склады металлопроката.', kind: 'misc' },
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

  // ---------- мосты и арка ----------
  for (const br of data.bridges) {
    const s = new Sink();
    buildBridge(s, br);
    add_('bridges', { id: br.id, name: br.name, sink: s, info: { name: br.name, info: br.info, kind: 'bridge' }, proxy: prismProxy(bufferPolyline([br.from, br.to], br.w / 2, { capExtend: 3 }), -1, br.type === 'kalinkin' ? 10 : 2.5) });
  }
  for (const a of data.arches) {
    const s = new Sink();
    buildArch(s, a);
    add_('context', { id: a.id, name: a.name, sink: s, info: { name: a.name, info: a.info, kind: 'landmark' }, proxy: boxProxy(a.at, a.angle, a.w + 9, 28, 0, a.h) });
  }

  // ---------- озеленение и автомобили ----------
  {
    const s = new Sink();
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
        buildTree(s, p, h, 2.4 + R() * 1.6, keys[Math.floor(R() * 3)]);
      }
    };
    for (const a of data.areas) {
      if (a.kind === 'garden') plant(scatterInPolygon(a.polygon, a.id === 'repina-garden' ? 12 : 9, a.id.length * 31 + 7, 3));
      if (a.kind === 'lawn') plant(scatterInPolygon(a.polygon, 8, a.id.length * 13 + 3, 2), 6, 10);
    }
    // аллеи вдоль улиц
    for (const id of ['rizhsky', 'peterhofsky', 'fontanka-s', 'sadovaya']) {
      const st = data.streets.find((x) => x.id === id);
      if (!st) continue;
      const L = polylineLength(st.line);
      for (let d = 8; d < L - 8; d += 13) {
        const { p, dir } = pointAt(st.line, d);
        for (const side of id === 'fontanka-s' ? [-1] : [1, -1]) {
          const q = add(p, mul(perp(dir), side * (st.w / 2 + 1.2)));
          if (P.carriageways.length && R() < 0.85) plant([q], 8, 13);
        }
      }
    }
    // деревья во дворах Коломны и на Матисовом острове
    plant(
      [
        [205, 120], [230, 150], [260, 260], [310, 300], [380, 330], [140, 470], [180, 520], [330, 610],
        [360, 660], [250, 980], [300, 1020], [210, 1100], [470, 1040], [520, 990], [560, 620], [520, 560],
        [-90, 520], [-110, 600], [-170, 520], [-45, 690],
      ],
      8,
      12,
    );
    add_('greenery', { id: 'trees', name: 'Деревья', sink: s });

    const c = new Sink();
    const carKeys = ['car', 'car2', 'car3', 'car', 'car3'];
    const park = data.areas.find((a) => a.id === 'parking-lots');
    if (park) {
      const [p0, p1, p2, p3] = park.polygon;
      const L = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
      const dir = [(p3[0] - p0[0]) / L, (p3[1] - p0[1]) / L];
      const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI + 90;
      for (let d = 3; d < L - 2; d += 2.6) {
        if (R() < 0.25) continue;
        const p = add(add(p0, mul(dir, d)), [(p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2]);
        buildCar(c, p, ang, carKeys[Math.floor(R() * carKeys.length)]);
      }
    }
    // автомобили на внутренних проездах и у корпусов
    for (const [x, y, a] of [
      [-120, 98, 96], [-125, 104, 96], [-130, 110, 96], [-175, 200, 96], [-245, 705, 0], [-250, 698, 0],
      [-190, 1240, 28], [-100, 1290, 28], [150, 1385, 22], [-60, 130, 21], [-66, 145, 21],
    ]) buildCar(c, [x, y], a, carKeys[Math.floor(R() * carKeys.length)]);
    // движение на городских улицах
    for (const id of ['sadovaya', 'dekabristov', 'rimskogo', 'peterhofsky', 'english-emb', 'lotsmanskaya', 'rizhsky']) {
      const st = data.streets.find((x) => x.id === id);
      if (!st) continue;
      const L = polylineLength(st.line);
      for (let d = 20 + R() * 30; d < L - 10; d += 35 + R() * 50) {
        const { p, dir } = pointAt(st.line, d);
        const lane = R() < 0.5 ? -1 : 1;
        const q = add(p, mul(perp(dir), (lane * st.w) / 4));
        const ang = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI + (lane > 0 ? 180 : 0);
        buildCar(c, q, ang, carKeys[Math.floor(R() * carKeys.length)]);
      }
    }
    add_('greenery', { id: 'cars', name: 'Автомобили', sink: c });
  }

  // статистика
  let tris = 0;
  for (const l of Object.values(layers)) for (const o of l.objects) tris += o.sink.triangleCount();
  return {
    planar: P,
    layers: LAYERS.map((l) => layers[l.id]),
    signs,
    generatedCount: generated.length,
    stats: { triangles: tris, ms: Date.now() - t0, buildings: explicit.length + generated.length },
  };
}

// ---------- преобразование в объекты three.js ----------

// Для просмотра: по каждому слою объединить геометрию по материалам (мало вызовов отрисовки).
export function toMergedGroups(THREE, model, getMaterial) {
  const groups = [];
  for (const layer of model.layers) {
    const merged = new Sink();
    for (const o of layer.objects) merged.merge(o.sink);
    const g = new THREE.Group();
    g.name = layer.name;
    g.userData.layer = layer.id;
    for (const { key, geometry } of merged.toGeometries(THREE)) {
      const mesh = new THREE.Mesh(geometry, getMaterial(key));
      mesh.name = `${layer.id}:${key}`;
      const tr = PALETTE[key]?.opacity != null;
      mesh.castShadow = !tr && layer.id !== 'terrain' && layer.id !== 'roads';
      mesh.receiveShadow = true;
      if (key === 'water') mesh.userData.water = true;
      g.add(mesh);
    }
    groups.push(g);
  }
  return groups;
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

function cleanUserData(info) {
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
      objs.push({ id: o.id, name: o.name, layer: layer.id, info: o.info, proxy: o.proxy, generated: o.generated });
      if (o.proxy.line) {
        const line = o.proxy.line;
        for (let i = 0; i < line.length - 1; i++) {
          const a = line[i];
          const b = line[i + 1];
          const h = o.proxy.h;
          pushTri([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], h], k);
          pushTri([a[0], a[1], 0], [b[0], b[1], h], [a[0], a[1], h], k);
        }
        continue;
      }
      const { poly, z0, z1 } = o.proxy;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        pushTri([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], k);
        pushTri([a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], k);
      }
      for (let i = 1; i < poly.length - 1; i++) pushTri([poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1], k);
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
