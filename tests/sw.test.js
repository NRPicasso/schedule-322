// sw.js должен соответствовать файлам сайта: иначе телефон сохранит не всё для работы без сети.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { swSource } from '../tools/build-sw.mjs';

test('site/sw.js собран из текущих файлов (если нет — запустите node tools/build-sw.mjs)', () => {
  assert.equal(readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8'), swSource());
});

test('в списке для работы без сети — обе страницы, манифесты, значки и весь код', () => {
  const src = swSource();
  for (const f of ['"./"', '"index.html"', '"admin.html"', '"manifest.webmanifest"', '"admin.webmanifest"', '"icons/icon-512.png"', '"src/admin.js"', '"src/pwa.js"', '"fonts/fonts.css"']) assert.ok(src.includes(f), f);
  assert.ok(!src.includes('"data/'), 'демо-данные телефону не нужны');
});
