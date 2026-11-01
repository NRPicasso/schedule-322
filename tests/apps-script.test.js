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

test('новая запись ДЗ: версия 1, кто и когда — в таблицу и журнал, в ответ сайту — без имени', () => {
  const out = processOps_(fresh(), [op()], pairIds, meta, noSeen);
  const r = out.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.version, 1);
  assert.equal(r.entry.by, undefined);
  assert.equal(out.state.entries.at(-1).by, 'Активист 1');
  assert.equal(out.logs.length, 1);
  assert.equal(out.logs[0].by, 'Активист 1');
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
  const again = processOps_(s, [o], pairIds, meta, (x) => (x.opId === o.opId ? first : null));
  assert.deepEqual(again.results[0], first); // тот же ответ (копия без имён), а не новая запись
  assert.equal(again.logs.length, 0);
  assert.equal(s.entries.filter((e) => e.date === '2026-11-03').length, 1);
});

test('плохие данные отклоняются с понятной причиной', () => {
  const bad = [
    op({ pairId: 'NOPE' }), op({ date: '2026-13-01' }), op({ patch: { subject: 'Другое' } }),
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

// ---------- найдено при проверке шага 4 ----------
test('одна и та же операция дважды в одной пачке — применяется один раз', () => {
  const s = fresh(); const o = op();
  const out = processOps_(s, [o, o], pairIds, meta, noSeen);
  assert.equal(out.logs.length, 1);
  assert.equal(out.results[1].version, 1);
});

test('кэш забыл операцию, но журнал помнит: повтор не даёт конфликт с самим собой', () => {
  const s = fresh(); const o = op();
  processOps_(s, [o], pairIds, meta, noSeen);
  const replay = processOps_(s, [o], pairIds, meta, (x) => (x.opId === o.opId ? 'applied' : null));
  assert.equal(replay.results[0].ok, true);
  assert.equal(replay.results[0].version, 1);
  assert.equal(replay.logs.length, 0);
  const n = { opId: 'note-replay-1', type: 'note.remove', date: '2026-11-04', text: 'Сменка' };
  s.dayNotes.push({ date: '2026-11-04', text: 'Сменка' });          // пометку добавили заново после старого удаления
  processOps_(s, [n], pairIds, meta, () => 'applied');              // старое удаление пришло повторно
  assert.equal(s.dayNotes.length, 1);                                // и не стёрло новую пометку
});

test('нестроковые и «служебные» id пары отклоняются', () => {
  const out = processOps_(fresh(), [op({ pairId: ['TUE-1140-bot'] }), op({ pairId: '__proto__' }), op({ pairId: 'constructor' }), op({ date: ['2026-11-03'] })],
    Object.assign(Object.create(null), pairIds), meta, noSeen);
  assert.deepEqual([...out.results].map((r) => r.error), ['invalid', 'invalid', 'invalid', 'invalid']);
});

// ---------- шаг 6: замены, отмена, перенос, доп. пара ----------
const xop = (o) => ({ opId: 'op-' + Math.random().toString(36).slice(2, 12), ...o });
const fresh6 = () => ({ entries: JSON.parse(JSON.stringify(history.entries)), dayNotes: [], rules: JSON.parse(JSON.stringify(history.rules)), extras: [] });

test('разовая замена аудитории и отмена пары с причиной; отмена снимается вместе с причиной', () => {
  const s = fresh6();
  let r = processOps_(s, [op({ patch: { room: '305' } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.entry.room, '305');
  r = processOps_(s, [op({ baseVersion: 1, patch: { cancelled: true, reason: 'преподаватель заболел' } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.entry.cancelled, true);
  r = processOps_(s, [op({ baseVersion: 2, patch: { cancelled: false } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.entry.reason, '');
  const bad = processOps_(s, [op({ baseVersion: 3, patch: { start: '16:00', end: '15:00' } })], pairIds, meta, noSeen).results[0];
  assert.equal(bad.error, 'invalid');
});

test('правило «с этой даты»: ставится, заменяется, снимается; плохое время отклоняется', () => {
  const s = fresh6(); const n = s.rules.length;
  processOps_(s, [xop({ type: 'rule.set', date: '2026-11-10', pairId: 'TUE-1500-top', field: 'room', value: '305' })], pairIds, meta, noSeen);
  processOps_(s, [xop({ type: 'rule.set', date: '2026-11-10', pairId: 'TUE-1500-top', field: 'room', value: '306' })], pairIds, meta, noSeen);
  assert.equal(s.rules.length, n + 1);
  assert.equal(s.rules.at(-1).value, '306');
  processOps_(s, [xop({ type: 'rule.remove', date: '2026-11-10', pairId: 'TUE-1500-top', field: 'room' })], pairIds, meta, noSeen);
  assert.equal(s.rules.length, n);
  const bad = processOps_(s, [xop({ type: 'rule.set', date: '2026-11-10', pairId: 'TUE-1500-top', field: 'start', value: '25:00' }),
    xop({ type: 'rule.set', date: '2026-11-10', pairId: 'TUE-1500-top', field: 'hw', value: 'x' })], pairIds, meta, noSeen);
  assert.deepEqual([...bad.results].map((r) => r.error), ['invalid', 'invalid']);
});

test('перенос: доп. пара с источником; повторный перенос — та же запись; второй перенос той же пары запрещён; удаление', () => {
  const s = fresh6();
  const move = { id: 'X-move-0001', date: '2026-11-05', start: '18:30', end: '20:00', room: '219', srcDate: '2026-11-03', srcPairId: 'TUE-1140-bot', hw: 'Дебаты', links: [] };
  let r = processOps_(s, [xop({ type: 'extra.add', date: move.date, extra: move })], pairIds, meta, noSeen).results[0];
  assert.equal(r.ok, true); assert.equal(r.version, 1);
  r = processOps_(s, [xop({ type: 'extra.update', date: '2026-11-07', id: 'X-move-0001', baseVersion: 1, patch: { date: '2026-11-07', start: '11:40', end: '13:10' } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.extra.date, '2026-11-07'); assert.equal(r.version, 2);
  const dup = processOps_(s, [xop({ type: 'extra.add', date: '2026-11-06', extra: { ...move, id: 'X-move-0002', date: '2026-11-06' } })], pairIds, meta, noSeen).results[0];
  assert.match(dup.message, /уже перенесена/);
  const stale = processOps_(s, [xop({ type: 'extra.update', date: '2026-11-07', id: 'X-move-0001', baseVersion: 1, patch: { room: '101' } })], pairIds, meta, noSeen).results[0];
  assert.equal(stale.error, 'conflict');
  processOps_(s, [xop({ type: 'extra.remove', date: '2026-11-07', id: 'X-move-0001' })], pairIds, meta, noSeen);
  assert.equal(s.extras.length, 0);
});

test('дополнительная пара: нужен предмет и правильное время; не больше 8 в день', () => {
  const s = fresh6();
  const extra = (i, o = {}) => xop({ type: 'extra.add', date: '2026-11-07', extra: { id: 'X-add-000' + i, date: '2026-11-07', start: '10:00', end: '11:30', subject: 'Консультация', type: 'other', ...o } });
  const out = processOps_(s, [extra(1, { subject: '' }), extra(2, { end: '09:00' }), extra(3, { type: 'party' })], pairIds, meta, noSeen);
  assert.deepEqual([...out.results].map((r) => r.error), ['invalid', 'invalid', 'invalid']);
  const many = processOps_(s, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => extra(i)), pairIds, meta, noSeen);
  assert.equal([...many.results].filter((r) => r.ok).length, 8);
  assert.match(many.results[8].message, /не больше 8/);
});

test('перенос пары с отметкой «ДЗ нет» сохраняет отметку; неверная отметка отклоняется', () => {
  const s = fresh6();
  const base = { date: '2026-11-07', start: '16:50', end: '18:20', srcDate: '2026-11-05', srcPairId: 'THU-1500' };
  let r = processOps_(s, [xop({ type: 'extra.add', date: '2026-11-07', extra: { ...base, id: 'X-nohw-0001', noHw: true } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.ok, true); assert.equal(r.extra.noHw, true);
  r = processOps_(s, [xop({ type: 'extra.add', date: '2026-11-07', extra: { ...base, srcPairId: 'THU-1320', id: 'X-nohw-0002', noHw: 'да' } })], pairIds, meta, noSeen).results[0];
  assert.equal(r.error, 'invalid');
});

test('шаг 6, проверка: перенос с пустым типом (как его хранит сервер) принимается; пары нет в исходный день — отказ; лимит 8 при смене даты', () => {
  const s = fresh6();
  const days = { 'THU-1500': 4, 'THU-1320': 4 };
  let r = processOps_(s, [xop({ type: 'extra.add', date: '2026-11-07', extra: { id: 'X-type-0001', date: '2026-11-07', start: '16:50', end: '18:20', srcDate: '2026-11-05', srcPairId: 'THU-1500', type: '', subject: '' } })], days, meta, noSeen).results[0];
  assert.equal(r.ok, true);
  r = processOps_(s, [xop({ type: 'extra.add', date: '2026-11-07', extra: { id: 'X-type-0002', date: '2026-11-07', start: '10:00', end: '11:30', srcDate: '2026-11-06', srcPairId: 'THU-1320' } })], days, meta, noSeen).results[0];
  assert.match(r.message, /нет в исходный день/);
  const many = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => xop({ type: 'extra.add', date: '2026-11-08', extra: { id: 'X-full-000' + i, date: '2026-11-08', start: '10:00', end: '11:00', subject: 'Т', type: 'other' } }));
  processOps_(s, many, days, meta, noSeen);
  r = processOps_(s, [xop({ type: 'extra.update', date: '2026-11-08', id: 'X-type-0001', baseVersion: 1, patch: { date: '2026-11-08' } })], days, meta, noSeen).results[0];
  assert.match(r.message, /не больше 8/);
});

vm.runInContext('this.k = { nextLock_, lockedMessage_, replaceCodeFor_, removeCodesFor_, activistNames_ };', ctx);
const { nextLock_, lockedMessage_, replaceCodeFor_, removeCodesFor_, activistNames_ } = ctx.k;

test('проверка: пауза после перебора растёт 10 → 20 → 40 мин … до 6 часов; сутки без пауз — снова 10 минут', () => {
  const t = Date.parse('2026-11-01T12:00:00Z');
  let prev = null; const mins = [];
  for (let i = 0; i < 8; i++) { const l = nextLock_(prev, t + i * 1000); mins.push(l.seconds / 60); prev = { n: l.n, at: t + i * 1000 }; }
  assert.deepEqual(mins, [10, 20, 40, 80, 160, 320, 360, 360]);
  assert.equal(nextLock_({ n: 5, at: t }, t + 86400000 + 1).seconds, 600);
  assert.match(lockedMessage_(t + 25 * 60000, t), /примерно на 25 мин/);
  assert.match(lockedMessage_(t + 5 * 3600000, t), /примерно на 5 ч/);
});

test('проверка: замена кода одного активиста не трогает остальных; имена — только из свойств скрипта', () => {
  const codes = { h1: 'Активист 1', h2: 'Активист 2', h3: 'Проверка' };
  assert.deepEqual({ ...replaceCodeFor_(codes, 'Активист 1', 'hNew') }, { h2: 'Активист 2', h3: 'Проверка', hNew: 'Активист 1' });
  assert.deepEqual({ ...removeCodesFor_(codes, 'Активист 2') }, { h1: 'Активист 1', h3: 'Проверка' });
  assert.deepEqual([...activistNames_({ ...codes, h4: 'Активист 1' })], ['Активист 1', 'Активист 2']);
  assert.ok(!/ACTIVISTS\s*=/.test(code), 'список имён не должен лежать в коде');
});
