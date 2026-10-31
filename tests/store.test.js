// Локальная модель редактора: правки применяются сразу, копятся в очереди и не теряются без сети.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, inverseOf, createQueue, applyResult } from '../site/src/store.js';

const base = () => ({ entries: [{ date: '2026-11-03', pairId: 'A', hw: 'Старое', links: [], version: 2 }], dayNotes: [] });
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('правка ДЗ видна сразу и помнит прежнее значение для «Отменить»', () => {
  const data = base();
  const op = { type: 'entry', date: '2026-11-03', pairId: 'A', patch: { hw: 'Доклады' } };
  const undo = inverseOf(data, op);
  applyOp(data, op, { name: 'Активист 1' });
  assert.equal(data.entries[0].hw, 'Доклады');
  assert.equal(data.entries[0].by, 'Активист 1');
  assert.deepEqual(undo.patch, { hw: 'Старое', noHw: false });
  applyOp(data, undo, { name: 'Активист 1' });
  assert.equal(data.entries[0].hw, 'Старое');
});

test('новая запись для пары без записей; пометки дня', () => {
  const data = base();
  applyOp(data, { type: 'entry', date: '2026-11-05', pairId: 'B', patch: { noHw: true } }, {});
  assert.equal(data.entries.find((e) => e.pairId === 'B').noHw, true);
  assert.deepEqual(inverseOf(data, { type: 'note.add', date: 'd', text: 'Сменка' }), { type: 'note.remove', date: 'd', text: 'Сменка' });
  applyOp(data, { type: 'note.add', date: 'd', text: 'Сменка' }, {});
  applyOp(data, { type: 'note.add', date: 'd', text: 'Сменка' }, {});
  assert.equal(data.dayNotes.length, 1);
});

test('очередь: несколько правок одной пары без сети сливаются в одну, базовая версия — первая', () => {
  const q = createQueue(mem());
  q.add({ opId: 'op-11111111', type: 'entry', date: 'd', pairId: 'A', baseVersion: 2, patch: { hw: 'a' } });
  q.add({ opId: 'op-22222222', type: 'entry', date: 'd', pairId: 'A', baseVersion: 3, patch: { links: ['https://x.example'] } });
  q.add({ opId: 'op-33333333', type: 'entry', date: 'd', pairId: 'B', baseVersion: 0, patch: { hw: 'b' } });
  const items = q.list();
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].patch, { hw: 'a', links: ['https://x.example'] });
  assert.equal(items[0].baseVersion, 2);
});

test('очередь переживает перезагрузку страницы (хранится в телефоне)', () => {
  const storage = mem();
  createQueue(storage).add({ opId: 'op-44444444', type: 'note.add', date: 'd', text: 'x' });
  assert.equal(createQueue(storage).list().length, 1);
});

test('отправленная правка не сливается с новой: новая ждёт и получит свежую версию', () => {
  const q = createQueue(mem());
  q.add({ opId: 'op-55555555', type: 'entry', date: 'd', pairId: 'A', baseVersion: 2, patch: { hw: 'a' } });
  const batch = q.takeBatch();
  q.add({ opId: 'op-66666666', type: 'entry', date: 'd', pairId: 'A', baseVersion: 2, patch: { hw: 'ab' } });
  assert.equal(q.list().length, 2);
  const data = base();
  applyResult(data, q, batch[0], { opId: 'op-55555555', ok: true, version: 3, entry: { date: 'd', pairId: 'A', hw: 'a', links: [], version: 3 } });
  assert.equal(q.list().length, 1);
  assert.equal(q.list()[0].baseVersion, 3);
});

test('ответ сервера обновляет версию, но не затирает более свежую локальную правку', () => {
  const q = createQueue(mem());
  const data = base();
  q.add({ opId: 'op-77777777', type: 'entry', date: '2026-11-03', pairId: 'A', baseVersion: 2, patch: { hw: 'Новое' } });
  const [sent] = q.takeBatch();
  q.add({ opId: 'op-88888888', type: 'entry', date: '2026-11-03', pairId: 'A', baseVersion: 2, patch: { hw: 'Ещё новее' } });
  applyOp(data, { type: 'entry', date: '2026-11-03', pairId: 'A', patch: { hw: 'Ещё новее' } }, {});
  applyResult(data, q, sent, { opId: sent.opId, ok: true, version: 3, entry: { date: '2026-11-03', pairId: 'A', hw: 'Новое', links: [], version: 3 } });
  assert.equal(data.entries[0].hw, 'Ещё новее');
  assert.equal(data.entries[0].version, 3);
});

// ---------- найдено при проверке шага 4 ----------

test('операцию, которую уже отправляли, нельзя менять: новая правка встаёт отдельной операцией', () => {
  const q = createQueue(mem());
  q.add({ opId: 'op-a0000001', type: 'entry', date: 'd', pairId: 'A', baseVersion: 2, patch: { hw: 'A' } });
  const [sent] = q.takeBatch();
  q.release([sent.opId]);                 // ответ потерялся — сервер мог уже применить «A»
  q.add({ opId: 'op-a0000002', type: 'entry', date: 'd', pairId: 'A', baseVersion: 2, patch: { hw: 'AB' } });
  const items = q.list();
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].patch, { hw: 'A' });
  assert.deepEqual(items[1].patch, { hw: 'AB' });
});

test('то же после перезагрузки страницы: отметка «отправлялась» сохраняется', () => {
  const storage = mem();
  const q = createQueue(storage);
  q.add({ opId: 'op-b0000001', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { hw: 'A' } });
  q.takeBatch();
  const q2 = createQueue(storage);         // перезагрузка
  q2.add({ opId: 'op-b0000002', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { hw: 'AB' } });
  assert.equal(q2.list().length, 2);
});

test('в одну отправку — не больше одной операции на пару', () => {
  const q = createQueue(mem());
  q.add({ opId: 'op-c0000001', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { hw: 'A' } });
  q.takeBatch(); q.release(['op-c0000001']);
  q.add({ opId: 'op-c0000002', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { hw: 'AB' } });
  q.add({ opId: 'op-c0000003', type: 'entry', date: 'd', pairId: 'B', baseVersion: 0, patch: { hw: 'B' } });
  const batch = q.takeBatch();
  assert.deepEqual(batch.map((o) => o.opId), ['op-c0000001', 'op-c0000003']);
});

test('«Отменить» возвращает и отметку «ДЗ нет»; повторная пометка не отменяется', () => {
  const data = { entries: [{ date: 'd', pairId: 'A', hw: '', links: [], noHw: true, version: 1 }], dayNotes: [{ date: 'd', text: 'Сменка' }] };
  const undo = inverseOf(data, { type: 'entry', date: 'd', pairId: 'A', patch: { hw: 'Доклады' } });
  assert.deepEqual(undo.patch, { hw: '', noHw: true });
  assert.equal(inverseOf(data, { type: 'note.add', date: 'd', text: 'Сменка' }), null);
  assert.equal(inverseOf(data, { type: 'note.remove', date: 'd', text: 'Нет такой' }), null);
});

test('две вкладки не затирают очередь друг друга', () => {
  const storage = mem();
  const tab1 = createQueue(storage); const tab2 = createQueue(storage);
  tab1.add({ opId: 'op-d0000001', type: 'note.add', date: 'd', text: 'x' });
  tab2.add({ opId: 'op-d0000002', type: 'note.add', date: 'd', text: 'y' });
  assert.deepEqual(createQueue(storage).list().map((o) => o.opId).sort(), ['op-d0000001', 'op-d0000002']);
  tab2.remove('op-d0000002');
  tab1.add({ opId: 'op-d0000003', type: 'note.add', date: 'd', text: 'z' }); // tab1 ещё «помнит» y? — нет, y не воскресает
  assert.deepEqual(createQueue(storage).list().map((o) => o.opId).sort(), ['op-d0000001', 'op-d0000003']);
});

test('при конфликте ожидающие правки пары забираются вместе с ним', () => {
  const q = createQueue(mem());
  q.add({ opId: 'op-e0000001', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { hw: 'A' } });
  const [sent] = q.takeBatch();
  q.add({ opId: 'op-e0000002', type: 'entry', date: 'd', pairId: 'A', baseVersion: 0, patch: { links: ['https://x.example'] } });
  q.remove(sent.opId);
  const pending = q.takePendingFor(sent);
  assert.equal(pending.length, 1);
  assert.equal(q.size(), 0);
});
