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

// ---------- шаг 6 ----------
test('правило «с этой даты»: применяется, «Отменить» возвращает прежнее или снимает', () => {
  const data = { entries: [], dayNotes: [], rules: [], extras: [] };
  const set = { type: 'rule.set', date: '2026-11-10', pairId: 'A', field: 'room', value: '305' };
  const undo1 = inverseOf(data, set);
  assert.deepEqual(undo1, { type: 'rule.remove', date: '2026-11-10', pairId: 'A', field: 'room' });
  applyOp(data, set, {});
  const undo2 = inverseOf(data, { ...set, value: '306' });
  assert.equal(undo2.value, '305');
  applyOp(data, undo1, {});
  assert.equal(data.rules.length, 0);
});

test('перенос/доп. пара: добавить, изменить, удалить и отменить каждое', () => {
  const data = { entries: [], dayNotes: [], rules: [], extras: [] };
  const add = { type: 'extra.add', date: '2026-11-05', extra: { id: 'X-test-01', date: '2026-11-05', start: '18:30', end: '20:00', srcDate: '2026-11-03', srcPairId: 'A' } };
  assert.deepEqual(inverseOf(data, add), { type: 'extra.remove', date: '2026-11-05', id: 'X-test-01', srcDate: '2026-11-03', srcPairId: 'A' });
  applyOp(data, add, {});
  const upd = { type: 'extra.update', date: '2026-11-07', id: 'X-test-01', patch: { date: '2026-11-07', start: '11:40', end: '13:10' } };
  assert.deepEqual(inverseOf(data, upd).patch, { date: '2026-11-05', start: '18:30', end: '20:00' });
  applyOp(data, upd, {});
  assert.equal(data.extras[0].date, '2026-11-07');
  const back = inverseOf(data, { type: 'extra.remove', date: '2026-11-07', id: 'X-test-01' });
  applyOp(data, { type: 'extra.remove', date: '2026-11-07', id: 'X-test-01' }, {});
  assert.equal(data.extras.length, 0);
  applyOp(data, back, {});
  assert.equal(data.extras[0].srcPairId, 'A');
  assert.notEqual(data.extras[0].id, 'X-test-01'); // возвращённая пара — новая запись
});

test('отмена пары: «Отменить» возвращает и причину; снятие отмены очищает причину', () => {
  const data = { entries: [{ date: 'd', pairId: 'A', links: [], version: 1 }], dayNotes: [] };
  const cancel = { type: 'entry', date: 'd', pairId: 'A', patch: { cancelled: true, reason: 'болезнь' } };
  assert.deepEqual(inverseOf(data, cancel).patch, { cancelled: false, reason: '' });
  applyOp(data, cancel, {});
  applyOp(data, { type: 'entry', date: 'd', pairId: 'A', patch: { cancelled: false } }, {});
  assert.equal(data.entries[0].reason, '');
});

test('очередь: одна операция на доп. пару в отправке; ответ обновляет версию доп. пары', () => {
  const q = createQueue(mem());
  const data = { entries: [], dayNotes: [], extras: [{ id: 'X-q-0001', date: 'd', start: '10:00', end: '11:30', version: 0 }] };
  q.add({ opId: 'op-x0000001', type: 'extra.add', date: 'd', extra: { id: 'X-q-0001' } });
  q.add({ opId: 'op-x0000002', type: 'extra.update', date: 'd', id: 'X-q-0001', baseVersion: 0, patch: { room: '101' } });
  const batch = q.takeBatch();
  assert.deepEqual(batch.map((o) => o.opId), ['op-x0000001']);
  applyResult(data, q, batch[0], { opId: 'op-x0000001', ok: true, version: 1, extra: { id: 'X-q-0001', date: 'd', start: '10:00', end: '11:30', version: 1 } });
  assert.equal(q.list()[0].baseVersion, 1);
  assert.equal(data.extras[0].version, 1);
});

test('шаг 6, проверка: новый перенос той же пары не обгоняет удаление старого', () => {
  const q = createQueue(mem());
  const mv = (id, date) => ({ opId: 'op-' + id, type: 'extra.add', date, extra: { id, date, start: '15:00', end: '16:30', srcDate: '2026-11-05', srcPairId: 'THU-1500' } });
  q.add(mv('X-one-00001', '2026-11-12'));
  q.add({ opId: 'op-rm1', type: 'extra.remove', date: '2026-11-12', id: 'X-one-00001', srcDate: '2026-11-05', srcPairId: 'THU-1500' });
  q.add(mv('X-two-00002', '2026-11-07'));
  assert.deepEqual(q.takeBatch().map((o) => o.opId), ['op-X-one-00001']);
  q.remove('op-X-one-00001');
  assert.deepEqual(q.takeBatch().map((o) => o.opId), ['op-rm1']);
  q.remove('op-rm1');
  assert.deepEqual(q.takeBatch().map((o) => o.opId), ['op-X-two-00002']);
});

test('шаг 6, проверка: ответ сервера не воскрешает пару, удаление которой ждёт в очереди; обратная к удалению — без пустых полей', () => {
  const q = createQueue(mem());
  const data = { entries: [], dayNotes: [], rules: [], extras: [] };
  const add = { opId: 'op-a', type: 'extra.add', date: '2026-11-07', extra: { id: 'X-res-00001', date: '2026-11-07', start: '15:00', end: '16:30', srcDate: '2026-11-05', srcPairId: 'THU-1500' } };
  applyOp(data, add); q.add(add); q.takeBatch();
  const rm = { opId: 'op-r', type: 'extra.remove', date: '2026-11-07', id: 'X-res-00001', srcDate: '2026-11-05', srcPairId: 'THU-1500' };
  applyOp(data, rm); q.add(rm);
  applyResult(data, q, add, { ok: true, version: 1, extra: { ...add.extra, type: '', subject: '', version: 1 } });
  assert.equal(data.extras.length, 0);
  const back = inverseOf({ ...data, extras: [{ ...add.extra, type: '', subject: '', tgName: '', version: 1 }] }, rm);
  assert.equal('type' in back.extra, false); assert.equal('subject' in back.extra, false);
  assert.equal(back.extra.srcPairId, 'THU-1500');
});
