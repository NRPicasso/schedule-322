// Загрузка расписания: сначала сохранённое, потом свежее; без сети — сохранённое с пометкой.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchedule, isValidPayload } from '../site/src/api.js';

const payload = { settings: { anchorWeek: '2026-09-14', anchorHalf: 'top' }, template: [{ id: 'A' }], subjects: {}, rules: [], entries: [], extras: [], dayNotes: [] };
function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), dump: () => Object.fromEntries(m) };
}
const okFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const failFetch = async () => { throw new TypeError('Failed to fetch'); };

test('первый запуск: данных нет → берём из сети и сохраняем', async () => {
  const storage = memoryStorage(); const calls = [];
  await loadSchedule({ apiUrl: 'https://x/exec', fetchFn: okFetch(payload), storage, now: () => 1000, onData: (d, info) => calls.push(info.source) });
  assert.deepEqual(calls, ['network']);
  assert.equal(JSON.parse(Object.values(storage.dump())[0]).savedAt, 1000);
});

test('есть сохранённое → показываем его сразу, затем свежее', async () => {
  const storage = memoryStorage(); const calls = [];
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch(payload), storage, now: () => 1, onData: () => {} });
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch({ ...payload, template: [{ id: 'B' }] }), storage, now: () => 2, onData: (d, info) => calls.push([info.source, d.template[0].id]) });
  assert.deepEqual(calls, [['cache', 'A'], ['network', 'B']]);
});

test('нет сети, но есть сохранённое → статус offline с датой сохранения', async () => {
  const storage = memoryStorage(); let status = null;
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch(payload), storage, now: () => 5, onData: () => {} });
  await loadSchedule({ apiUrl: 'u', fetchFn: failFetch, storage, onData: () => {}, onStatus: (s, info) => { status = [s, info.savedAt]; } });
  assert.deepEqual(status, ['offline', 5]);
});

test('нет сети и ничего не сохранено → статус error', async () => {
  let status = null;
  await loadSchedule({ apiUrl: 'u', fetchFn: failFetch, storage: memoryStorage(), onData: () => assert.fail('не должно быть данных'), onStatus: (s) => { status = s; } });
  assert.equal(status, 'error');
});

test('ответ с ошибкой скрипта или битый — не затирает сохранённое', async () => {
  const storage = memoryStorage(); const statuses = [];
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch(payload), storage, now: () => 7, onData: () => {} });
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch({ error: 'Не удалось прочитать таблицу' }), storage, onData: () => {}, onStatus: (s) => statuses.push(s) });
  assert.deepEqual(statuses, ['offline']);
  assert.equal(JSON.parse(Object.values(storage.dump())[0]).savedAt, 7);
  assert.equal(isValidPayload({ template: 'нет' }), false);
});

test('хранилище браузера недоступно (приватный режим) — всё равно работает', async () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const calls = [];
  await loadSchedule({ apiUrl: 'u', fetchFn: okFetch(payload), storage: broken, onData: (d, info) => calls.push(info.source) });
  assert.deepEqual(calls, ['network']);
});
