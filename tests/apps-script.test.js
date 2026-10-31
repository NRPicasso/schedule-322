// Проверка бэкенда без Google: загружаем code.src.js в «песочницу» Node и подставляем
// заглушку Utilities — проверяем, что строки таблицы превращаются в данные, которые понимает сайт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildDay } from '../site/src/schedule.js';

const code = readFileSync(new URL('../apps-script/code.src.js', import.meta.url), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const Utilities = { formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : d.toISOString()) };
const ctx = vm.createContext({ Utilities });
vm.runInContext(code + '\nthis.api = { buildPayload_, objectsToRows_, SHEETS };', ctx);
const { buildPayload_, objectsToRows_, SHEETS } = ctx.api;

const seed = JSON.parse(readFileSync(new URL('../site/data/seed.json', import.meta.url)));
const history = JSON.parse(readFileSync(new URL('../site/data/demo-entries.json', import.meta.url)));

/** Имитация таблицы после setup(): заголовки + строки, записанные objectsToRows_. */
function fakeSheets() {
  const sheet = (k, items) => [SHEETS[k].cols.map((c) => c[0]), ...objectsToRows_(items, SHEETS[k].cols)];
  return {
    'Шаблон': sheet('template', seed.template),
    'Предметы': sheet('subjects', Object.entries(seed.subjects).map(([subject, s]) => ({ subject, ...s }))),
    'Правила': sheet('rules', history.rules),
    'Записи': sheet('entries', history.entries),
    'Доп_пары': sheet('extras', []),
    'Дни': sheet('dayNotes', history.dayNotes),
    'Настройки': [['ключ', 'значение'], ['опорная_неделя', '2026-09-14'], ['опорная_половина', 'верх'], ['начало_семестра', '2026-09-14'], ['конец_семестра', '2026-12-31'], ['завтра_после', '18:30']],
  };
}

test('туда и обратно: данные из таблицы дают тот же вторник 27.10, что и файлы', () => {
  const sheets = fakeSheets();
  const payload = JSON.parse(JSON.stringify(buildPayload_((name) => sheets[name] || [])));
  assert.equal(payload.template.length, 23);
  assert.deepEqual(payload.settings, seed.settings);
  assert.equal(payload.subjects['ОСД'].short, 'ОСД');
  const fromSheet = buildDay('2026-10-27', payload).pairs.map((p) => [p.start, p.room, p.subject, p.hw, p.links.join()]);
  const fromFiles = buildDay('2026-10-27', { ...seed, ...history }).pairs.map((p) => [p.start, p.room, p.subject, p.hw, p.links.join()]);
  assert.deepEqual(fromSheet, fromFiles);
});

test('таблица прислала Date, число и «9:40» — всё приводится к строкам сайта', () => {
  const sheets = fakeSheets();
  sheets['Шаблон'][1][3] = new Date(1899, 11, 30, 15, 0); // так Таблица хранит «15:00», если формат сбился
  sheets['Шаблон'][1][9] = 115;                           // номер аудитории стал числом
  sheets['Шаблон'][12][3] = '9:40';
  sheets['Записи'][1][0] = new Date(2026, 8, 15);          // дата стала датой
  const p = buildPayload_((name) => sheets[name] || []);
  assert.equal(p.template[0].start, '15:00');
  assert.equal(p.template[0].room, '115');
  assert.equal(p.template[11].start, '09:40');
  assert.equal(p.entries[0].date, '2026-09-15');
});

test('пустые строки пропускаются, «да» в флажках — true, ссылки делятся по строкам', () => {
  const sheets = fakeSheets();
  sheets['Записи'].push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  sheets['Записи'].push(['2026-11-03', 'TUE-1140-bot', '', 'https://a.example/1\nhttps://a.example/2', 'да', '', '', '', '', '', '', '', '', '']);
  const p = buildPayload_((name) => sheets[name] || []);
  const last = p.entries.at(-1);
  assert.equal(p.entries.length, history.entries.length + 1);
  assert.equal(last.noHw, true);
  assert.deepEqual([...last.links], ['https://a.example/1', 'https://a.example/2']);
});
