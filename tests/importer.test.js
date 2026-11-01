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
