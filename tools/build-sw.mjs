// Собирает site/sw.js: список файлов, которые телефон сохраняет для работы без сети, и номер версии.
// Запуск из корня проекта: node tools/build-sw.mjs  (после любого изменения файлов сайта).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SITE = join(ROOT, 'site');
// data/ — только для работы без сервера на своём компьютере; лицензии шрифтов телефону не нужны
const SKIP = [/^sw\.js$/, /^data\//, /\.txt$/, /(^|\/)\./];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Текст sw.js для текущих файлов сайта (его же проверяет тест). */
export function swSource() {
  const files = walk(SITE).map((f) => relative(SITE, f).split(sep).join('/')).filter((f) => !SKIP.some((re) => re.test(f))).sort();
  const template = readFileSync(join(ROOT, 'tools', 'sw.template.js'), 'utf8');
  // версия меняется от любого файла сайта и от самой схемы работы (шаблона)
  const hash = createHash('sha256');
  hash.update(template);
  for (const f of files) { hash.update(f); hash.update(readFileSync(join(SITE, f))); }
  const version = hash.digest('hex').slice(0, 12);
  return template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...files], null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = swSource();
  writeFileSync(join(SITE, 'sw.js'), src);
  console.log('site/sw.js: версия', src.match(/VERSION = '(\w+)'/)[1]);
}
