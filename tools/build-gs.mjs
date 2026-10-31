// Собирает apps-script/Code.gs: исходник + данные для первого заполнения таблицы.
// Запуск: node tools/build-gs.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const seed = JSON.parse(read('../site/data/seed.json'));
const history = JSON.parse(read('../site/data/demo-entries.json'));
const strip = (rows) => rows.map(({ _note, ...rest }) => rest); // служебные пометки в таблицу не переносим
const SEED = { settings: seed.settings, template: seed.template, subjects: seed.subjects,
  rules: strip(history.rules), entries: strip(history.entries), dayNotes: history.dayNotes };

const out = read('../apps-script/code.src.js')
  + '\n// ---------- данные для первого заполнения (сгенерировано tools/build-gs.mjs, не править руками) ----------\n'
  + 'var SEED = ' + JSON.stringify(SEED) + ';\n';
writeFileSync(new URL('../apps-script/Code.gs', import.meta.url), out);
console.log('apps-script/Code.gs:', out.length, 'символов');
