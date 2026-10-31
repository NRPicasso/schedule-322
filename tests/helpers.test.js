// Помощники ДЗ: разбор вставки, темы ссылок, «как в прошлый раз», частые фразы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitPaste, parseTelegramLink, learnTopics, linkInfo, previousHomework, frequentPhrases } from '../site/src/helpers.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = { ...read('../site/data/seed.json'), ...read('../site/data/demo-entries.json') };

test('вставка куска сообщения: ссылки отдельно, подпись отдельно', () => {
  const text = 'Тема: Принципы. Материал: глава 4\nhttps://youtu.be/ju1YWiiVuKE?si=Q78L4Z0W, https://t.me/c/4323463486/37/1646.\nСсылка: (https://znanium.ru/read?id=490776&pagenum=90)';
  const r = splitPaste(text);
  assert.deepEqual(r.links, ['https://youtu.be/ju1YWiiVuKE?si=Q78L4Z0W', 'https://t.me/c/4323463486/37/1646', 'https://znanium.ru/read?id=490776&pagenum=90']);
  assert.equal(r.rest, 'Тема: Принципы. Материал: глава 4 Ссылка:');
  assert.deepEqual(splitPaste('просто текст'), { links: [], rest: 'просто текст' });
  assert.deepEqual(splitPaste('https://t.me/c/1/2/3 https://t.me/c/1/2/3').links, ['https://t.me/c/1/2/3']); // без повторов
});

test('разбор ссылки Telegram: чат, тема, сообщение', () => {
  assert.deepEqual(parseTelegramLink('https://t.me/c/4323463486/39/3732'), { chat: '4323463486', topic: '39', message: '3732' });
  assert.deepEqual(parseTelegramLink('https://t.me/c/4323463486/4/1058?single'), { chat: '4323463486', topic: '4', message: '1058' });
  assert.deepEqual(parseTelegramLink('https://t.me/c/1671019187/611'), { chat: '1671019187', topic: null, message: '611' });
  assert.equal(parseTelegramLink('https://youtu.be/x'), null);
});

test('темы дисциплин выучены по прошлым записям', () => {
  const { groupChat, topics } = learnTopics(data);
  assert.equal(groupChat, '4323463486');
  assert.deepEqual(topics, { 39: 'Муниципальное', 26: 'ГПП', 38: 'МП', 40: 'ОСД', 34: 'ТП', 37: 'УПП', 35: 'УП', 4: 'ГП' });
});

test('метка ссылки: своя тема, чужая тема, другой чат, YouTube', () => {
  const learned = learnTopics(data);
  assert.deepEqual(linkInfo('https://t.me/c/4323463486/26/3137', 'ГПП', learned), { kind: 'ok', label: 'ГПП ✓' });
  assert.deepEqual(linkInfo('https://t.me/c/4323463486/40/9999', 'ГПП', learned), { kind: 'warn', label: 'тема ОСД?', topicSubject: 'ОСД' });
  assert.equal(linkInfo('https://t.me/c/1671019187/611', 'УПП', learned).label, 'другой чат');
  assert.equal(linkInfo('https://t.me/c/4323463486/99/1', 'УПП', learned).label, 'тема 99');
  assert.equal(linkInfo('https://youtu.be/abc', 'УПП', learned).label, 'YouTube');
  assert.equal(linkInfo('https://znanium.ru/x', 'УПП', learned).kind, 'neutral');
});

test('«как в прошлый раз» — последнее занятие того же предмета и типа', () => {
  const mun = previousHomework(data, '2026-11-03', 'Муниципальное', 'seminar');
  assert.equal(mun.date, '2026-10-27');
  assert.equal(mun.hw, 'Анализ Устава МО');
  const tp = previousHomework(data, '2026-11-05', 'ТП', 'seminar');
  assert.equal(tp.date, '2026-10-22');
  assert.equal(previousHomework(data, '2026-11-02', 'ГПП', 'lecture'), null); // у лекций ДЗ не было
});

test('частые фразы предмета: самые повторяемые короткие подписи + общие', () => {
  const extra = { ...data, entries: [...data.entries,
    { date: '2026-11-10', pairId: 'TUE-1500-top', hw: 'Задачи и доклады', links: [] },
    { date: '2026-11-24', pairId: 'TUE-1500-top', hw: 'Задачи и доклады', links: [] }] };
  const p = frequentPhrases(extra, 'ГПП');
  assert.equal(p[0], 'Задачи и доклады');
  assert.ok(p.includes('Доклады'));
  assert.ok(p.length <= 6);
  assert.ok(!p.some((x) => x.length > 60)); // длинные тексты не превращаются в кнопки
});
