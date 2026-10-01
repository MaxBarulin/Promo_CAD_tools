// Чтение папки доработок custom/ в Node: custom.json и модели *.glb.
// Используют сборка просмотрщика, выгрузка и проверка модели.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CUSTOM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'custom');

export async function readCustomDir(dir = CUSTOM_DIR) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return { dir, config: {}, files: [] };
  }
  let config = {};
  if (names.includes('custom.json')) {
    const text = await readFile(path.join(dir, 'custom.json'), 'utf8');
    try {
      config = JSON.parse(text.replace(/^﻿/, ''));
    } catch (e) {
      throw new Error(`custom/custom.json: ошибка в записи JSON — ${e.message}`);
    }
  }
  const files = [];
  for (const file of names.filter((n) => /\.glb$/i.test(n)).sort()) files.push({ file, bytes: new Uint8Array(await readFile(path.join(dir, file))) });
  return { dir, config, files };
}
