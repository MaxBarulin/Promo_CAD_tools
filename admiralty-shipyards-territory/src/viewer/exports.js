// Выгрузка модели из просмотрщика: GLB, DXF, GeoJSON (только в локальной версии).

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { toObjectHierarchy } from '../model/index.js';
import { createMaterialFactory } from '../model/materials.js';
import { buildDXF } from '../export/dxf.js';
import { buildGeoJSON } from '../export/geojson.js';
import { mergeGlb } from '../export/glb-merge.js';

export function setupExports({ $, data, model, customParts = () => [] }) {
  $('expGLB').addEventListener('click', async () => {
    const btn = $('expGLB');
    btn.textContent = '…';
    await new Promise((r) => setTimeout(r, 30));
    const hier = toObjectHierarchy(THREE, model, createMaterialFactory(THREE, { forExport: true }));
    new GLTFExporter().parse(
      hier,
      (buf) => {
        const parts = customParts();
        const out = parts.length ? mergeGlb(new Uint8Array(buf), parts).bytes : buf;
        download(new Blob([out], { type: 'model/gltf-binary' }), 'admiralty-shipyards.glb');
        btn.textContent = 'GLB';
      },
      (err) => {
        console.error(err);
        btn.textContent = 'GLB';
      },
      { binary: true },
    );
  });
  $('expDXF').addEventListener('click', () => download(new Blob([buildDXF(data, model)], { type: 'application/dxf' }), 'admiralty-shipyards-plan.dxf'));
  $('expGEO').addEventListener('click', () =>
    download(new Blob([JSON.stringify(buildGeoJSON(data, model))], { type: 'application/geo+json' }), 'admiralty-shipyards.geojson'),
  );
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
