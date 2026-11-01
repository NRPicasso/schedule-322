// Имена активистов не уходят с сервера: ни в данных для сайта, ни в ответах на правки
// (в том числе в «варианте другого» при конфликте). В таблице и журнале имена остаются.
// И кэш ответа: большой ответ кладётся кусками, ошибка кэша не ломает ответ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/code.src.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Utilities: { formatDate: (d) => d.toISOString() } });
vm.runInContext(code + '\nthis.api = { buildPayload_, objectsToRows_, SHEETS, processOps_, cachePut_, cacheGet_, CACHE_KEY };', ctx);
const { buildPayload_, objectsToRows_, SHEETS, processOps_, cachePut_, cacheGet_, CACHE_KEY } = ctx.api;

const seed = JSON.parse(readFileSync(new URL('../site/data/seed.json', import.meta.url)));
const history = JSON.parse(readFileSync(new URL('../site/data/demo-entries.json', import.meta.url)));
const NAMES = ['Активист 1', 'Активист 2'];
const hasName = (x) => NAMES.some((n) => JSON.stringify(x).includes(n));
const clone = (x) => JSON.parse(JSON.stringify(x));

test('данные для сайта: в таблице «кто» заполнено везде, в ответе имён нет; «обновлено» осталось', () => {
  const by = (list) => list.map((x, i) => ({ ...x, by: NAMES[i % 2], updatedAt: '2026-10-31T12:00:00+03:00' }));
  const extra = { id: 'X-1', date: '2026-11-05', start: '18:30', end: '20:00', subject: 'Консультация', type: 'other', room: '115', links: [], version: 1 };
  const sheet = (k, items) => [SHEETS[k].cols.map((c) => c[0]), ...objectsToRows_(items, SHEETS[k].cols)];
  const sheets = {
    'Шаблон': sheet('template', seed.template),
    'Предметы': sheet('subjects', Object.entries(seed.subjects).map(([subject, s]) => ({ subject, ...s }))),
    'Правила': sheet('rules', by(history.rules)),
    'Записи': sheet('entries', by(history.entries)),
    'Доп_пары': sheet('extras', by([extra])),
    'Дни': sheet('dayNotes', by(history.dayNotes)),
    'Настройки': [['ключ', 'значение'], ['опорная_неделя', '2026-09-14'], ['опорная_половина', 'верх']],
  };
  assert.ok(hasName(sheets), 'в имитации таблицы имена есть');
  const p = clone(buildPayload_((name) => sheets[name] || []));
  assert.equal(hasName(p), false);
  assert.equal(p.entries.length, history.entries.length);
  assert.equal(p.entries[0].updatedAt, '2026-10-31T12:00:00+03:00');
  assert.equal(p.extras[0].room, '115');
});

test('ответы на правки всех видов — без имён; в листах и журнале имя есть', () => {
  const pairIds = Object.fromEntries(seed.template.map((t) => [t.id, t.day]));
  const state = { entries: [], dayNotes: [], rules: [], extras: [] };
  const run = (name, ops, seen = () => null) => processOps_(state, clone(ops), pairIds, { name, now: '2026-11-01T12:00:00+03:00' }, seen);
  const ops = [
    { opId: 'op-test-a1', type: 'entry', date: '2026-11-03', pairId: 'TUE-1140-bot', baseVersion: 0, patch: { hw: 'Доклады' } },
    { opId: 'op-test-a2', type: 'note.add', date: '2026-11-04', text: 'Сменка' },
    { opId: 'op-test-a3', type: 'rule.set', date: '2026-11-05', pairId: 'THU-1320', field: 'room', value: '305', to: '' },
    { opId: 'op-test-a4', type: 'extra.add', date: '2026-11-06', extra: { id: 'X-test-a4', date: '2026-11-06', start: '18:30', end: '20:00', subject: 'Консультация', type: 'other', room: '115', links: [] } },
    { opId: 'op-test-a5', type: 'extra.update', date: '2026-11-06', id: 'X-test-a4', baseVersion: 1, patch: { room: '116' } },
  ];
  const first = run('Активист 1', ops);
  assert.ok(first.results.every((r) => r.ok), JSON.stringify(first.results));
  assert.equal(hasName(first.results), false);
  assert.ok(first.logs.every((l) => l.by === 'Активист 1'));
  assert.equal(state.entries[0].by, 'Активист 1');
  assert.equal(state.extras[0].by, 'Активист 1');

  // конфликты: «вариант другого» — без имени (и для записи дня, и для доп. пары)
  const second = run('Активист 2', [
    { opId: 'op-test-b1', type: 'entry', date: '2026-11-03', pairId: 'TUE-1140-bot', baseVersion: 0, patch: { hw: 'Другое' } },
    { opId: 'op-test-b2', type: 'extra.update', date: '2026-11-06', id: 'X-test-a4', baseVersion: 1, patch: { room: '117' } },
  ]);
  assert.deepEqual([...second.results.map((r) => r.error)], ['conflict', 'conflict']);
  assert.equal(second.results[0].current.hw, 'Доклады');
  assert.equal(second.results[1].current.room, '116');
  assert.equal(hasName(second.results), false);

  // повтор уже применённых операций (из кэша со старым ответом и «по журналу») — тоже без имён
  const oldCached = { opId: 'op-test-a1', ok: true, version: 1, entry: { ...state.entries[0] } }; // ответ, сохранённый до обновления сервера
  const replay = run('Активист 1', ops, (o) => (o.opId === 'op-test-a1' ? oldCached : 'applied'));
  assert.ok(replay.results.every((r) => r.ok));
  assert.equal(hasName(replay.results), false);
  assert.equal(replay.logs.length, 0);
});

/** Имитация CacheService: значение больше 100 КБ (в байтах UTF-8) — ошибка, как у Google. */
function fakeCache({ broken = false } = {}) {
  const m = new Map();
  const size = (v) => Buffer.byteLength(v, 'utf8');
  return {
    m,
    get: (k) => { if (broken) throw new Error('сбой'); return m.has(k) ? m.get(k) : null; },
    getAll: (keys) => Object.fromEntries(keys.filter((k) => m.has(k)).map((k) => [k, m.get(k)])),
    putAll: (obj) => {
      if (broken) throw new Error('сбой');
      for (const [k, v] of Object.entries(obj)) if (size(v) > 100 * 1024) throw new Error('Argument too large: value');
      for (const [k, v] of Object.entries(obj)) m.set(k, v);
    },
    remove: (k) => m.delete(k),
  };
}

test('кэш: ответ 150 тысяч символов (кириллица, эмодзи) кладётся кусками и читается целиком', () => {
  const body = JSON.stringify({ hw: 'Доклады по теме 4 🤩 '.repeat(7500) });
  assert.ok(body.length > 150000 && Buffer.byteLength(body) > 250000);
  const cache = fakeCache();
  assert.equal(cachePut_(cache, body), true);
  assert.equal(cacheGet_(cache), body);
  cache.remove(CACHE_KEY);                         // так сервер сбрасывает кэш после правки
  assert.equal(cacheGet_(cache), null);
});

test('кэш: пропавший кусок или сбой кэша — не ошибка, а чтение таблицы заново', () => {
  const body = 'Ж'.repeat(70000);
  const cache = fakeCache();
  cachePut_(cache, body);
  cache.m.delete(CACHE_KEY + ':1');
  assert.equal(cacheGet_(cache), null);
  const broken = fakeCache({ broken: true });
  assert.equal(cachePut_(broken, body), false);
  assert.equal(cacheGet_(broken), null);
});
