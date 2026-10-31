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

// ---------- запись ----------
vm.runInContext('this.w = { processOps_, validateOp_ };', ctx);
const { processOps_ } = ctx.w;
const pairIds = Object.fromEntries(seed.template.map((t) => [t.id, true]));
const meta = { name: 'Активист 1', now: '2026-11-01T12:00:00+03:00' };
const fresh = () => ({ entries: JSON.parse(JSON.stringify(history.entries)), dayNotes: [] });
const noSeen = () => null;
const op = (o) => ({ opId: 'op-' + Math.random().toString(36).slice(2, 12), type: 'entry', date: '2026-11-03', pairId: 'TUE-1140-bot', baseVersion: 0, patch: { hw: 'Доклады' }, ...o });

test('новая запись ДЗ: версия 1, кто и когда, строка в журнал', () => {
  const out = processOps_(fresh(), [op()], pairIds, meta, noSeen);
  const r = out.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.equal(r.entry.by, 'Активист 1');
  assert.equal(out.logs.length, 1);
  assert.equal(out.state.entries.at(-1).hw, 'Доклады');
});

test('правка поверх чужой версии — конфликт, данные не меняются', () => {
  const s = fresh();
  processOps_(s, [op()], pairIds, meta, noSeen);                       // версия стала 1
  const out = processOps_(s, [op({ baseVersion: 0, patch: { hw: 'Другое' } })], pairIds, { ...meta, name: 'Активист 2' }, noSeen);
  assert.equal(out.results[0].ok, false);
  assert.equal(out.results[0].error, 'conflict');
  assert.equal(out.results[0].current.hw, 'Доклады');
  assert.equal(out.logs.length, 0);
});

test('повторная отправка той же операции не создаёт дубль', () => {
  const s = fresh(); const o = op();
  const first = processOps_(s, [o], pairIds, meta, noSeen).results[0];
  const again = processOps_(s, [o], pairIds, meta, (id) => (id === o.opId ? first : null));
  assert.equal(again.results[0], first);
  assert.equal(again.logs.length, 0);
  assert.equal(s.entries.filter((e) => e.date === '2026-11-03').length, 1);
});

test('плохие данные отклоняются с понятной причиной', () => {
  const bad = [
    op({ pairId: 'NOPE' }), op({ date: '2026-13-01' }), op({ patch: { room: '101' } }),
    op({ patch: { links: ['javascript:alert(1)'] } }), op({ patch: { hw: 'x'.repeat(5001) } }), op({ opId: '!' }),
  ];
  const out = processOps_(fresh(), bad, pairIds, meta, noSeen);
  assert.deepEqual([...out.results].map((r) => r.error), Array(6).fill('invalid'));
  assert.match(out.results[3].message, /http/);
  assert.equal(out.logs.length, 0);
});

test('«ДЗ нет» снимается, когда ДЗ вписано; пометки дня добавляются без повторов и удаляются', () => {
  const s = fresh();
  processOps_(s, [op({ patch: { noHw: true } })], pairIds, meta, noSeen);
  const r = processOps_(s, [op({ baseVersion: 1, patch: { hw: 'Доклады' } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.entry.noHw, false);
  const n = (type, text) => ({ opId: 'note-' + Math.random().toString(36).slice(2, 12), type, date: '2026-11-04', text });
  processOps_(s, [n('note.add', 'Сменка'), n('note.add', 'Сменка'), n('note.add', 'КСУ')], pairIds, meta, noSeen);
  assert.deepEqual([...s.dayNotes].map((x) => x.text), ['Сменка', 'КСУ']);
  const out = processOps_(s, [n('note.remove', 'Сменка')], pairIds, meta, noSeen);
  assert.deepEqual([...out.state.dayNotes].map((x) => x.text), ['КСУ']);
});
