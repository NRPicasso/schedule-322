// Импорт из Telegram: сообщения 43–48 дают те же ДЗ, ссылки и пометки, что в истории проекта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMessages, planImport, mergedPatch } from '../site/src/importer.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const seed = read('../site/data/seed.json');
const hist = read('../site/data/demo-entries.json');
const { days } = read('./fixtures/telegram-43-48.json');
const WEEK = (d) => d >= '2026-10-26' && d <= '2026-10-31';
const noEmoji = (s) => s.replace(/\p{Extended_Pictographic}/gu, '').trim();
// сайт до импорта: неделя 26–31.10 пустая (ДЗ и пометки этой недели убраны)
const empty = () => ({ ...seed, ...JSON.parse(JSON.stringify(hist)), entries: hist.entries.filter((e) => !WEEK(e.date)), dayNotes: hist.dayNotes.filter((n) => !WEEK(n.date)) });
const allMessages = Object.values(days).join('\n\n');

test('сообщения 43–48 одной вставкой → те же ДЗ, ссылки и пометки, что в истории за 26–31.10', () => {
  const parsed = parseMessages(allMessages, '2026-11-02');
  assert.deepEqual(parsed.days.map((d) => d.date), Object.keys(days));
  const plan = planImport(empty(), parsed);
  const got = plan.items.map((i) => ({ date: i.date, pairId: i.pair.id, hw: i.hw, links: i.links })).sort((a, b) => (a.date + a.pairId < b.date + b.pairId ? -1 : 1));
  const want = hist.entries.filter((e) => WEEK(e.date) && (e.hw || (e.links || []).length)).map((e) => ({ date: e.date, pairId: e.pairId, hw: e.hw || '', links: e.links || [] }))
    .sort((a, b) => (a.date + a.pairId < b.date + b.pairId ? -1 : 1));
  assert.deepEqual(got, want);
  assert.ok(plan.items.every((i) => i.status === 'new'));
  // пометка дня — как написали («Сдаём КСУ🤩»); в истории эмодзи было убрано вручную, сравниваем без него.
  // «Сменка» — постоянная пометка физкультуры, её не дублируем
  assert.deepEqual(plan.notes.map((n) => [n.date, noEmoji(n.text)]), hist.dayNotes.filter((n) => WEEK(n.date)).map((n) => [n.date, n.text]));
  assert.equal(plan.notes[0].text, 'Сдаём КСУ🤩');
  assert.deepEqual(plan.unassigned, []);
});

test('клавиши с U+FE0F и без, лишние пробелы, неразрывные пробелы, обычное время и обычные номера', () => {
  const text = 'вторник \n 27.10.2026 \n11:40 – 13:10\n1️⃣  пара / 222 -  Муниципальное право \n  Анализ  Устава МО \n\n15.00-16.30\n3 пара/219- ГПП\nЗадачи';
  const plan = planImport(empty(), parseMessages(text, null));
  assert.deepEqual(plan.items.map((i) => [i.pair.id, i.hw]), [['TUE-1140-top', 'Анализ Устава МО'], ['TUE-1500-top', 'Задачи']]);
});

test('заголовки копии нескольких сообщений пропускаются, имя нигде не остаётся', () => {
  const text = `Активист 1, [27.10.2026 18:05]\n${days['2026-10-27']}\n\nАктивист 2, [28.10.2026 9:01]\n${days['2026-10-28']}\n[29.10.2026 10:00] Активист 1: ${days['2026-10-29']}`;
  const parsed = parseMessages(text, null);
  const plan = planImport(empty(), parsed);
  assert.deepEqual(parsed.days.map((d) => d.date), ['2026-10-27', '2026-10-28', '2026-10-29']);
  assert.equal(JSON.stringify(plan).includes('Активист'), false);
  assert.equal(plan.items.length, 4);
  assert.deepEqual(plan.unassigned, []);
});

test('отмены и переносы — в «не удалось отнести»; пара, которой нет, тоже; расхождение аудитории — предупреждение', () => {
  const text = 'ПЯТНИЦА\n30.10.2026\n❗ ГП перенесена на 7 ноября\n13²⁰-14⁵⁰\n1⃣ пара/301 - ГП\nЧитать главу 3\n\n21¹⁰-22⁴⁰\n5⃣пара/100 - Неизвестное\nчто-то';
  const plan = planImport(empty(), parseMessages(text, null));
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0].warnings, ['в сообщении аудитория 301, на сайте 220 — расписание не меняется']);
  assert.deepEqual(plan.unassigned.map((u) => u.reason.split(' — ')[0]), ['отмены, переносы и замены из текста не применяются', 'в этот день на сайте нет такой пары в 21:10']);
});

test('день без даты берётся из открытой недели по названию дня; уже вписанное — «то же» или «другое»', () => {
  const data = empty();
  data.entries.push({ date: '2026-11-03', pairId: 'TUE-1140-bot', hw: 'Старое', links: [] });
  const plan = planImport(data, parseMessages('ВТОРНИК\n11⁴⁰-13¹⁰\n1⃣пара/211 - Муниципальное право\nНовое\nhttps://t.me/c/1/2/3', '2026-11-02'));
  const [it] = plan.items;
  assert.equal(it.date, '2026-11-03');
  assert.equal(it.status, 'differs');
  assert.equal(mergedPatch(it, 'keep'), null);
  assert.deepEqual(mergedPatch(it, 'replace'), { hw: 'Новое', links: ['https://t.me/c/1/2/3'] });
  assert.deepEqual(mergedPatch(it, 'merge'), { hw: 'Старое\nНовое', links: ['https://t.me/c/1/2/3'] });
  data.entries.at(-1).hw = 'Новое'; data.entries.at(-1).links = ['https://t.me/c/1/2/3'];
  assert.equal(planImport(data, parseMessages('ВТОРНИК\n11⁴⁰-13¹⁰\n1⃣пара/211 - Муниципальное право\nНовое\nhttps://t.me/c/1/2/3', '2026-11-02')).items[0].status, 'same');
});

test('текст без дней — понятный отказ', () => {
  const parsed = parseMessages('Привет! Завтра пар нет.', '2026-11-02');
  assert.equal(parsed.days.length, 0);
  assert.match(parsed.unassigned[0].reason, /до первого дня/);
});

// ---------- проверка шага 5 (независимый ревьюер) ----------
import { weekText } from '../site/src/telegram.js';

test('наш же текст недели (с отменой, переносом, доп. парой, «Ведёт», пометками) разбирается обратно без потерь', () => {
  const full = { ...seed, rules: [], entries: [
    { date: '2026-11-03', pairId: 'TUE-1140-bot', cancelled: true, reason: 'Преподаватель заболел', links: [] },
    { date: '2026-11-03', pairId: 'TUE-1320', hw: 'Лекция ДЗ', links: ['https://t.me/c/1/2/3'] },
    { date: '2026-11-05', pairId: 'THU-1320', room: '401', teacher: 'Иванов И.И.', hw: 'ОСД ДЗ', links: [] },
  ], extras: [
    { id: 'X-1', date: '2026-11-07', start: '16:50', end: '18:20', room: '115', srcDate: '2026-11-05', srcPairId: 'THU-1500', hw: 'Глава 3', links: ['https://ex.com/a'] },
    { id: 'X-2', date: '2026-11-07', start: '18:30', end: '20:00', room: '101', subject: 'Консультация', tgName: 'Консультация', type: 'other', hw: 'Вопросы', links: [] },
  ], dayNotes: [{ date: '2026-11-03', text: 'Пометка вт' }, { date: '2026-11-05', text: 'Принести паспорт' }] };
  const blank = JSON.parse(JSON.stringify(full));
  blank.entries.forEach((e) => { e.hw = ''; e.links = []; }); blank.extras.forEach((x) => { x.hw = ''; x.links = []; }); blank.dayNotes = [];
  for (const emoji of [false, true]) {
    const plan = planImport(blank, parseMessages(weekText('2026-11-02', full, { emoji }).replace(/\n/g, '\r\n'), '2026-11-02'));
    assert.deepEqual(plan.items.map((i) => [i.date, i.pair.id, i.hw, i.links.join()]), [
      ['2026-11-03', 'TUE-1320', 'Лекция ДЗ', 'https://t.me/c/1/2/3'], ['2026-11-05', 'THU-1320', 'ОСД ДЗ', ''],
      ['2026-11-07', 'X-1', 'Глава 3', 'https://ex.com/a'], ['2026-11-07', 'X-2', 'Вопросы', '']]);
    assert.deepEqual(plan.notes.map((n) => [n.date, n.text]), [['2026-11-03', 'Пометка вт'], ['2026-11-05', 'Принести паспорт']]);
    assert.equal(plan.unassigned.length, 2);                                   // ❌ отмена и ➡ перенос
    assert.deepEqual(plan.items[1].warnings, []);                              // «Ведёт: …» совпадает с сайтом — не ДЗ и не предупреждение
  }
});

test('отмены словами, выделенные «❗» строки ДЗ, ссылки без пунктуации, пара без аудитории', () => {
  const day = (body) => planImport(empty(), parseMessages(`ВТОРНИК\n27.10.2026\n11⁴⁰-13¹⁰\n${body}`, null));
  let plan = day('1⃣пара/222 - Муниципальное право\nПара отменена\nПеренесена на 7 ноября\nПеренесли доклады на четверг');
  assert.equal(plan.unassigned.length, 2);
  assert.equal(plan.items[0].hw, 'Перенесли доклады на четверг');            // это ДЗ, а не перенос пары
  plan = day('1⃣пара/222 - Муниципальное право\n❗Доклады обязательно\nМетодичка (https://t.me/c/1/2/3).\nСм. https://ex.com/a.pdf, стр 5');
  assert.equal(plan.items[0].hw, '❗Доклады обязательно\nМетодичка.\nСм., стр 5');
  assert.deepEqual(plan.items[0].links, ['https://t.me/c/1/2/3', 'https://ex.com/a.pdf']);
  plan = day('1⃣пара - Муниципальное право\nАнализ');
  assert.equal(plan.items[0].hw, 'Анализ');
});

test('заголовки с 12-часовым временем; день и дата в одной строке и в обратном порядке', () => {
  const p1 = parseMessages('Активист 2, [28.10.2026 9:01 AM]\nСРЕДА 28.10.2026\n14³⁰-16⁰⁰\n1⃣пара/СПОРТЗАЛ - ФИЗ-РА\nКСУ\n[27.10.2026 6:05 PM] Активист 1: 27.10.2026\nВТОРНИК\n11⁴⁰-13¹⁰\n1⃣пара/222 - Муниципальное право\nАнализ', '2026-11-02');
  assert.deepEqual(p1.days.map((d) => d.date), ['2026-10-28', '2026-10-27']);
  const plan = planImport(empty(), p1);
  assert.equal(JSON.stringify(plan).includes('Активист'), false);
  assert.deepEqual(plan.items.map((i) => [i.date, i.hw]), [['2026-10-27', 'Анализ']]);
  assert.deepEqual(plan.notes.map((n) => n.text), ['КСУ']);
});

test('сопоставление: при одном времени — по предмету, не отменённая; чужой предмет в это время — не записывается; «УП» не равно «УПП»', () => {
  const data = { ...empty(), entries: [{ date: '2026-11-06', pairId: 'FRI-1830', cancelled: true, links: [] }],
    extras: [{ id: 'X-t', date: '2026-11-06', start: '18:30', end: '20:00', room: '101', subject: 'ТП', type: 'seminar', links: [] },
      { id: 'X-k', date: '2026-11-06', start: '15:00', end: '16:30', room: '101', subject: 'ГП', tgName: 'Консультация по ГП', type: 'other', links: [] }] };
  const plan = planImport(data, parseMessages('ПЯТНИЦА\n06.11.2026\n15⁰⁰-16³⁰\n1⃣пара/101 - Консультация по ГП — доп. пара\nВопросы\n\n18³⁰-20⁰⁰\n3⃣пара/101 - ТП (доп. пара)\nДЗ по ТП', null));
  assert.deepEqual(plan.items.map((i) => [i.pair.id, i.hw]), [['X-k', 'Вопросы'], ['X-t', 'ДЗ по ТП']]);   // доп. «занятие» — ДЗ, а не пометка дня
  const wrong = planImport(empty(), parseMessages('ПЯТНИЦА\n06.11.2026\n15⁰⁰-16³⁰\n2⃣пара/222 - ГП\nЗадачи ГП\n\nЧЕТВЕРГ\n05.11.2026\n3⃣пара/219 - УПП\nЗадачи', null));
  assert.equal(wrong.items.length, 0);
  assert.match(wrong.unassigned[0].reason, /в 15:00 на сайте ОСД/);
});

test('один день вставлен дважды — берётся последнее; пометки без повторов; лимиты ссылок и длины', () => {
  const twice = 'ВТОРНИК\n27.10.2026\n11⁴⁰-13¹⁰\n1⃣пара/222 - Муниципальное право\nА\n\nВТОРНИК\n27.10.2026\n11⁴⁰-13¹⁰\n1⃣пара/222 - Муниципальное право\nБ\n' + Array.from({ length: 11 }, (_, i) => 'https://ex.com/' + i).join('\n');
  const plan = planImport(empty(), parseMessages(twice, null));
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0].hw, 'Б');
  assert.equal(plan.items[0].links.length, 10);
  assert.match(plan.items[0].warnings.join(), /ссылок больше 10/);
  const it = { ...plan.items[0], status: 'differs', hw: 'х'.repeat(3000), pair: { ...plan.items[0].pair, hw: 'у'.repeat(3000), links: [] } };
  assert.equal(mergedPatch(it, 'merge').hw.length, 5000);
  const onlyLinks = { ...it, hw: '' };
  assert.equal(mergedPatch(onlyLinks, 'replace').hw, 'у'.repeat(3000));       // «Заменить» без текста не стирает подпись
});

test('«Ведёт: …» не попадает в ДЗ; другой преподаватель — только предупреждение', () => {
  const plan = planImport(empty(), parseMessages('ЧЕТВЕРГ\n29.10.2026\n13²⁰-14⁵⁰\n3⃣пара/221 - ОСД\nВедёт: Петров П. П.\nДоклады', null));
  assert.equal(plan.items[0].hw, 'Доклады');
  assert.match(plan.items[0].warnings.join(), /в сообщении ведёт Петров П\. П\., на сайте .* — расписание не меняется/);
});
