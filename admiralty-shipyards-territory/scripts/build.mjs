// Сборка просмотрщика в один самодостаточный HTML-файл (three.js и данные внутри).
//   npm run build        → dist/index.html (+ dist/artifact.html для публикации)
//   npm run dev          → пересборка при изменениях и локальный сервер http://localhost:8080

import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

const TITLE = 'Территория Адмиралтейских верфей';
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com" />\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Condensed:wght@500;600&display=swap" />';

async function writeHtml(js) {
  const css = await readFile(path.join(root, 'src/viewer/style.css'), 'utf8');
  const body = await readFile(path.join(root, 'src/viewer/body.html'), 'utf8');
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${TITLE}</title>
<meta name="description" content="Интерактивная 3D-модель территории АО «Адмиралтейские верфи» (Санкт-Петербург): здания, стапели, эллинги, краны, ограждение, дороги, Нева и окружающая застройка." />
${FONTS}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${safeJs}
</script>
</body>
</html>
`;
  // Вариант для публикации в виде Artifact: без обёртки документа, экспорт файлов скрыт.
  const artifact = `<title>${TITLE}</title>
${FONTS}
<style>
${css}
</style>
${body}
<script>window.__ARTIFACT__ = true;</script>
<script>
${safeJs}
</script>
`;
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'index.html'), full);
  await writeFile(path.join(dist, 'artifact.html'), artifact);
  return full.length;
}

const options = {
  entryPoints: [path.join(root, 'src/viewer/main.js')],
  bundle: true,
  format: 'iife',
  minify: !serve,
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
};

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'html',
        setup(build) {
          build.onEnd(async (res) => {
            if (res.errors.length) return;
            const size = await writeHtml(res.outputFiles[0].text);
            console.log(`dist/index.html обновлён (${(size / 1024).toFixed(0)} КБ)`);
          });
        },
      },
    ],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 8080 });
  console.log(`Откройте http://localhost:${port}/`);
} else {
  const res = await esbuild.build(options);
  const size = await writeHtml(res.outputFiles[0].text);
  console.log(`Готово: dist/index.html (${(size / 1024).toFixed(0)} КБ), dist/artifact.html`);
}
