// Склейка GLB: в выгрузку модели добавляются модели объектов из custom/ (из Blender)
// вместе с материалами и текстурами — без перекодирования картинок и сторонних библиотек.
// Каждая модель попадает внутрь узла своего слоя под именем «код название».

import { parseGlb } from '../model/custom.js';

const align4 = (n) => (n + 3) & ~3;
const LISTS = ['accessors', 'bufferViews', 'images', 'materials', 'meshes', 'nodes', 'samplers', 'textures', 'skins', 'cameras'];

// Индексы текстур в материале: любое поле «…Texture» с { index } на любой глубине
// (pbrMetallicRoughness.baseColorTexture, normalTexture, расширения KHR_materials_*).
function shiftTextures(obj, off) {
  for (const [k, v] of Object.entries(obj)) {
    if (!v || typeof v !== 'object') continue;
    if (/Texture$/.test(k) && typeof v.index === 'number') v.index += off;
    shiftTextures(v, off);
  }
  return obj;
}

// Узел glTF для сдвига и поворота модели на плане (см. placeModel в model/custom.js):
// p' = R·(p − pivot) + pivot + move; в glTF (Y вверх, север = −Z) — поворот вокруг Y.
export function placementTRS(t) {
  if (!t) return {};
  const a = ((t.rotate || 0) * Math.PI) / 180;
  const [cx, cy] = t.pivot;
  const [dx, dy] = t.move || [0, 0];
  const P = [cx, 0, -cy];
  const RP = [P[0] * Math.cos(a) + P[2] * Math.sin(a), 0, -P[0] * Math.sin(a) + P[2] * Math.cos(a)];
  // узел: T·R·S, центр поворота и масштаба — pivot на уровне земли
  const sc = t.scale || 1;
  const out = { translation: [cx + dx - RP[0] * sc, t.lift || 0, -(cy + dy) - RP[2] * sc] };
  if (a) out.rotation = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  if (sc !== 1) out.scale = [sc, sc, sc];
  return out;
}

// target — GLB выгрузки; parts — [{ bytes, nodeName, parentName, extras, transform }]
export function mergeGlb(target, parts) {
  const { json: J, bin: tbin } = parseGlb(target);
  const pieces = [{ at: 0, data: tbin || new Uint8Array(0) }];
  let binLen = align4(tbin ? tbin.byteLength : 0);
  const warnings = [];

  for (const part of parts) {
    const { json: S, bin } = parseGlb(part.bytes);
    if ((S.buffers || []).some((b) => b.uri)) throw new Error(`${part.nodeName}: модель ссылается на внешние файлы — экспортируйте из Blender в формате .glb`);
    const off = {};
    for (const k of LISTS) off[k] = (J[k] ||= []).length;

    const binAt = binLen;
    if (bin) {
      pieces.push({ at: binAt, data: bin });
      binLen = align4(binAt + bin.byteLength);
    }
    for (const bv of S.bufferViews || []) J.bufferViews.push({ ...bv, buffer: 0, byteOffset: (bv.byteOffset || 0) + binAt });
    for (const a of S.accessors || []) {
      const c = structuredClone(a);
      if (c.bufferView != null) c.bufferView += off.bufferViews;
      if (c.sparse) {
        c.sparse.indices.bufferView += off.bufferViews;
        c.sparse.values.bufferView += off.bufferViews;
      }
      J.accessors.push(c);
    }
    for (const im of S.images || []) {
      const c = { ...im };
      if (c.bufferView != null) c.bufferView += off.bufferViews;
      J.images.push(c);
    }
    for (const s of S.samplers || []) J.samplers.push(s);
    for (const t of S.textures || []) {
      const c = structuredClone(t);
      if (c.source != null) c.source += off.images;
      if (c.sampler != null) c.sampler += off.samplers;
      for (const ext of Object.values(c.extensions || {})) if (typeof ext.source === 'number') ext.source += off.images;
      J.textures.push(c);
    }
    for (const m of S.materials || []) J.materials.push(shiftTextures(structuredClone(m), off.textures));
    for (const me of S.meshes || []) {
      const c = structuredClone(me);
      for (const p of c.primitives) {
        for (const k of Object.keys(p.attributes)) p.attributes[k] += off.accessors;
        if (p.indices != null) p.indices += off.accessors;
        if (p.material != null) p.material += off.materials;
        for (const tg of p.targets || []) for (const k of Object.keys(tg)) tg[k] += off.accessors;
        const draco = p.extensions?.KHR_draco_mesh_compression;
        if (draco) draco.bufferView += off.bufferViews;
      }
      J.meshes.push(c);
    }
    for (const n of S.nodes || []) {
      const c = structuredClone(n);
      if (c.mesh != null) c.mesh += off.meshes;
      if (c.camera != null) c.camera += off.cameras;
      if (c.skin != null) c.skin += off.skins;
      if (c.children) c.children = c.children.map((i) => i + off.nodes);
      if (c.extensions?.KHR_lights_punctual) {
        // источники света из Blender в выгрузку модели не переносятся
        delete c.extensions.KHR_lights_punctual;
        warnings.push(`${part.nodeName}: источник света пропущен`);
      }
      J.nodes.push(c);
    }
    for (const s of S.skins || []) {
      const c = structuredClone(s);
      c.joints = c.joints.map((i) => i + off.nodes);
      if (c.skeleton != null) c.skeleton += off.nodes;
      if (c.inverseBindMatrices != null) c.inverseBindMatrices += off.accessors;
      J.skins.push(c);
    }
    for (const cam of S.cameras || []) J.cameras.push(cam);
    for (const an of S.animations || []) {
      const c = structuredClone(an);
      for (const ch of c.channels) if (ch.target.node != null) ch.target.node += off.nodes;
      for (const s of c.samplers) {
        s.input += off.accessors;
        s.output += off.accessors;
      }
      (J.animations ||= []).push(c);
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
      const add = (S[key] || []).filter((e) => e !== 'KHR_lights_punctual');
      if (add.length) J[key] = [...new Set([...(J[key] || []), ...add])];
    }

    // узел-обёртка «код название» внутри узла слоя
    const roots = (S.scenes?.[S.scene ?? 0]?.nodes || []).map((i) => i + off.nodes);
    J.nodes.push({ name: part.nodeName, children: roots, ...placementTRS(part.transform), ...(part.extras ? { extras: part.extras } : {}) });
    const wrapper = J.nodes.length - 1;
    const parent = J.nodes.findIndex((n) => n.name === part.parentName);
    if (parent >= 0) (J.nodes[parent].children ||= []).push(wrapper);
    else J.scenes[J.scene ?? 0].nodes.push(wrapper);
  }

  // glTF не допускает пустых списков
  for (const k of [...LISTS, 'animations']) if (Array.isArray(J[k]) && !J[k].length) delete J[k];
  const bin = new Uint8Array(binLen);
  for (const p of pieces) bin.set(p.data, p.at);
  J.buffers = [{ byteLength: binLen }];
  return { bytes: writeGlb(J, bin), warnings };
}

export function writeGlb(json, bin) {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = align4(enc.byteLength);
  const binLen = align4(bin.byteLength);
  const total = 12 + 8 + jsonLen + (binLen ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(enc, 20);
  out.fill(0x20, 20 + enc.byteLength, 20 + jsonLen);
  if (binLen) {
    const at = 20 + jsonLen;
    dv.setUint32(at, binLen, true);
    dv.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out;
}
