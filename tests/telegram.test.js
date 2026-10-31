// Тексты для Telegram: эталон — сообщения активистов 43–48 (неделя 26–31.10.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { supTime, keycap, dayText, weekDays, weekText, pairChanges, weekChanges } from '../site/src/telegram.js';
import { buildDay } from '../site/src/schedule.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const seed = read('../site/data/seed.json');
const demo = read('../site/data/demo-entries.json');
const history = { ...seed, ...demo };
const { days: etalon } = read('./fixtures/telegram-43-48.json');
const data = (over = {}) => ({ ...seed, entries: [], rules: [], extras: [], dayNotes: [], ...over });
// активисты ставят пробелы по-разному («2⃣пара/ 115», «4⃣пара/219- ГПП», «1⃣ пара») и иногда эмодзи — их убираем,
// но строки и пустые строки между парами сравниваем как есть (лишние подряд сводим к одной)
const norm = (s) => s.replace(/🤩/g, '').split('\n').map((l) => l.trim().replace(/\s*([/-])\s*/g, '$1').replace(/\u20E3\s+/g, '\u20E3')).join('\n').replace(/\n{3,}/g, '\n\n');

test('время надстрочными цифрами и номера-«клавиши»', () => {
  assert.equal(supTime('15:00'), '15⁰⁰');
  assert.equal(supTime('09:40'), '9⁴⁰');
  assert.equal(supTime('16:50'), '16⁵⁰');
  assert.equal(keycap(3), '3⃣');
});

test('неделя 26–31.10 совпадает с сообщениями активистов 43–48', () => {
  for (const [date, expected] of Object.entries(etalon)) assert.equal(norm(dayText(date, history)), norm(expected), date);
  assert.deepEqual(weekDays('2026-10-26', history).map((d) => d.date), Object.keys(etalon));
});

test('точный вид дня: заголовок, дата, пустые строки между парами, пометки под последней парой', () => {
  assert.equal(dayText('2026-10-28', history), 'СРЕДА\n\n28.10.2026\n\n14³⁰-16⁰⁰\n1⃣пара/СПОРТЗАЛ - ФИЗ-РА\nСменка\nСдаём КСУ');
  assert.match(dayText('2026-10-27', history), /^ВТОРНИК\n\n27\.10\.2026\n\n11⁴⁰-13¹⁰\n1⃣пара\/222 - Муниципальное право\nАнализ Устава МО\nhttps:\/\/t\.me\/c\/4323463486\/39\/3732\n\n13²⁰-14⁵⁰\n2⃣пара\/115 - УПП \(лекция\)/);
  assert.match(dayText('2026-10-27', history, { emoji: true }), /^ВТОРНИК🌹\n/);
  assert.equal(dayText('2026-11-01', history), null);                         // воскресенье — нечего публиковать
});

test('сдвоенная пара — два номера; неделя одним сообщением', () => {
  const t = dayText('2026-11-05', data());
  assert.match(t, /16⁵⁰-20⁰⁰\n3⃣4⃣пара\/222 - ТП/);
  const w = weekText('2026-11-02', data());
  assert.match(w, /^ПОНЕДЕЛЬНИК[\s\S]*\n\n\nВТОРНИК[\s\S]*СУББОТА|^ПОНЕДЕЛЬНИК[\s\S]*ПЯТНИЦА/);
});

test('отмена, перенос, доп. пара и разовая замена — в тексте дня и в сообщениях об изменениях', () => {
  const d = data({
    entries: [
      { date: '2026-11-03', pairId: 'TUE-1140-bot', cancelled: true, reason: 'Преподаватель заболел', links: [] },
      { date: '2026-11-05', pairId: 'THU-1320', room: '401', links: [] },
    ],
    extras: [
      { id: 'X-1', date: '2026-11-07', start: '16:50', end: '18:20', room: '115', srcDate: '2026-11-05', srcPairId: 'THU-1500', hw: 'Глава 3', links: [] },
      { id: 'X-2', date: '2026-11-07', start: '18:30', end: '20:00', room: '101', subject: 'Консультация', tgName: 'Консультация', type: 'other', links: [] },
    ],
  });
  assert.match(dayText('2026-11-03', d), /11⁴⁰-13¹⁰\n❌ Муниципальное право — отменена: Преподаватель заболел\n\n13²⁰-14⁵⁰\n1⃣пара\/115 - УПП/);
  assert.match(dayText('2026-11-05', d), /15⁰⁰-16³⁰\n➡️ УП \(лекция\) — перенесена на 7 ноября \(сб\), 16:50, ауд\. 115/);
  assert.match(dayText('2026-11-05', d), /1⃣пара\/401 - ОСД/);
  assert.match(dayText('2026-11-07', d), /16⁵⁰-18²⁰\n1⃣пара\/115 - УП \(лекция\) — перенос с 5 ноября \(чт\)\nГлава 3\n\n18³⁰-20⁰⁰\n2⃣пара\/101 - Консультация — доп\. пара/);
  const ch = weekChanges('2026-11-02', d).map((x) => x.text);
  assert.deepEqual(ch, [
    '❗ Вторник, 3 ноября: Муниципальное право в 11:40 отменена (Преподаватель заболел).',
    '❗ Четверг, 5 ноября: 1 пара ОСД — в аудитории 401 (вместо 221).',
    '❗ Четверг, 5 ноября: УП в 15:00 перенесена на 7 ноября (сб), 16:50, ауд. 115.',
    '❗ Суббота, 7 ноября: дополнительная пара — Консультация, 18:30, ауд. 101.',
  ]);
});

test('постоянные замены, начатые на этой неделе: время одной строкой, «по дату»', () => {
  const d = data({ rules: [
    { pairId: 'THU-1320', from: '2026-11-05', to: '', field: 'start', value: '11:40' },
    { pairId: 'THU-1320', from: '2026-11-05', to: '', field: 'end', value: '13:10' },
    { pairId: 'FRI-1830', from: '2026-11-06', to: '2026-11-20', field: 'room', value: '305' },
  ] });
  assert.deepEqual(weekChanges('2026-11-02', d).map((x) => x.text), [
    '❗ С 5 ноября (чт) и дальше: ОСД — время 11:40–13:10 (вместо 13:20–14:50).',
    '❗ С 6 ноября (пт), по 20 ноября: УПП — аудитория 305 (вместо 219).',
  ]);
  assert.deepEqual(weekChanges('2026-11-09', d), []);                         // на следующей неделе это уже не новость
});

test('перенос с прошлой недели виден в изменениях новой недели; изменения одной пары', () => {
  const d = data({ extras: [{ id: 'X-1', date: '2026-11-09', start: '16:50', end: '18:20', room: '115', srcDate: '2026-11-05', srcPairId: 'THU-1500', links: [] }] });
  assert.deepEqual(weekChanges('2026-11-09', d).map((x) => x.text), ['❗ Понедельник, 9 ноября: УП — перенос с 5 ноября (чт), 16:50, ауд. 115.']);
  const p = buildDay('2026-11-05', d).pairs.find((x) => x.id === 'THU-1500');
  assert.deepEqual(pairChanges(p, d), ['❗ Четверг, 5 ноября: УП в 15:00 перенесена на 9 ноября (пн), 16:50, ауд. 115.']);
});

test('проверка шага 7: номер в сообщении — тот же, что в тексте дня (доп. пара раньше, отменённая пара не считается)', () => {
  const d = data({
    entries: [{ date: '2026-11-03', pairId: 'TUE-1140-bot', cancelled: true, links: [] }, { date: '2026-11-03', pairId: 'TUE-1320', room: '300', links: [] },
      { date: '2026-11-05', pairId: 'THU-1320', room: '401', links: [] }, { date: '2026-11-05', pairId: 'THU-1650-bot', cancelled: true, links: [] }],
    extras: [{ id: 'X-e', date: '2026-11-05', start: '09:40', end: '11:10', room: '101', subject: 'Консультация', type: 'other', links: [] }],
  });
  assert.match(dayText('2026-11-03', d), /1⃣пара\/300 - УПП/);
  assert.match(dayText('2026-11-05', d), /2⃣пара\/401 - ОСД/);
  const ch = weekChanges('2026-11-02', d).map((x) => x.text);
  assert.ok(ch.includes('❗ Вторник, 3 ноября: 1 пара УПП — в аудитории 300 (вместо 115).'), ch.join('\n'));
  assert.ok(ch.includes('❗ Четверг, 5 ноября: 2 пара ОСД — в аудитории 401 (вместо 221).'), ch.join('\n'));
  assert.ok(ch.includes('❗ Четверг, 5 ноября: ТП в 16:50 отменена.'), ch.join('\n'));
});

test('проверка шага 7: сдвоенная пара — «3–4 пара»; перенос на воскресенье попадает в тексты', () => {
  const d = data({
    entries: [{ date: '2026-11-05', pairId: 'THU-1650-bot', room: '300', links: [] }],
    extras: [{ id: 'X-s', date: '2026-11-08', start: '10:00', end: '11:30', room: '115', srcDate: '2026-11-05', srcPairId: 'THU-1320', hw: 'Глава 5', links: [] }],
  });
  assert.ok(weekChanges('2026-11-02', d).some((x) => x.text === '❗ Четверг, 5 ноября: 2–3 пара ТП — в аудитории 300 (вместо 222).'));
  assert.deepEqual(weekDays('2026-11-02', d).map((x) => x.date).slice(-1), ['2026-11-08']);
  assert.match(weekText('2026-11-02', d), /ВОСКРЕСЕНЬЕ\n\n08\.11\.2026\n\n10⁰⁰-11³⁰\n1⃣пара\/115 - ОСД — перенос с 5 ноября \(чт\)\nГлава 5/);
  assert.equal(weekDays('2026-10-26', history).length, 6);                        // пустое воскресенье не показываем
});

test('проверка шага 7: конец постоянной замены объявляется; «вместо» — прежнее значение, а не шаблон', () => {
  const d = data({ rules: [
    { pairId: 'FRI-1830', from: '2026-11-06', to: '2026-11-12', field: 'room', value: '305' },
    { pairId: 'THU-1320', from: '2026-11-05', to: '', field: 'room', value: '305' },
    { pairId: 'THU-1320', from: '2026-11-19', to: '', field: 'room', value: '401' },
  ] });
  assert.deepEqual(weekChanges('2026-11-09', d).map((x) => x.text), ['❗ С 13 ноября (пт): УПП — снова аудитория 219.']);
  assert.deepEqual(weekChanges('2026-11-16', d).map((x) => x.text), ['❗ С 19 ноября (чт) и дальше: ОСД — аудитория 401 (вместо 305).']);
});

test('проверка шага 7: пометка дня отделена от отменённой пары; у перенесённой лекции сохраняется пометка', () => {
  const d = data({
    entries: [{ date: '2026-11-05', pairId: 'THU-1650-bot', cancelled: true, reason: 'болеет', links: [] }],
    dayNotes: [{ date: '2026-11-05', text: 'Сменка' }],
    extras: [{ id: 'X-m', date: '2026-11-07', start: '15:00', end: '16:30', room: '115', srcDate: '2026-11-02', srcPairId: 'MON-1650-bot', links: [] }],
  });
  assert.match(dayText('2026-11-05', d), /❌ ТП — отменена: болеет\n\nСменка$/);
  const top = data({ extras: [{ id: 'X-n', date: '2026-10-31', start: '18:30', end: '20:00', room: '115', srcDate: '2026-10-26', srcPairId: 'MON-1650-top', links: [] }] });
  assert.match(dayText('2026-10-31', top), /Муниципальное право \(лекция-отмечает сама\) — перенос с 26 октября \(пн\)/);
});
