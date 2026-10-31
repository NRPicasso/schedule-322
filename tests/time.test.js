// Тесты выбора дня: «сегодня» по Москве, «завтра» после 18:30, воскресенье → понедельник.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moscowNow, defaultView, nextStudyDay, nowAndNext, isRecent, parseNowOverride } from '../site/src/time.js';
import { buildDay } from '../site/src/schedule.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = { ...read('../site/data/seed.json'), ...read('../site/data/demo-entries.json') };

test('московское время не зависит от часового пояса устройства', () => {
  assert.deepEqual(moscowNow(new Date('2026-11-03T11:00:00Z')), { date: '2026-11-03', minutes: 14 * 60 });
  assert.deepEqual(moscowNow(new Date('2026-11-03T22:30:00Z')), { date: '2026-11-04', minutes: 1 * 60 + 30 });
});

test('днём показываем сегодня, после 18:30 — следующий учебный день', () => {
  assert.deepEqual(defaultView({ date: '2026-11-03', minutes: 10 * 60 }, data), { tab: 'today', date: '2026-11-03' });
  assert.deepEqual(defaultView({ date: '2026-11-03', minutes: 19 * 60 }, data), { tab: 'tomorrow', date: '2026-11-04' });
  assert.deepEqual(defaultView({ date: '2026-11-03', minutes: 18 * 60 + 29 }, data).tab, 'today');
});

test('суббота вечером и воскресенье → понедельник', () => {
  assert.deepEqual(defaultView({ date: '2026-10-31', minutes: 19 * 60 }, data), { tab: 'tomorrow', date: '2026-11-02' });
  assert.deepEqual(defaultView({ date: '2026-11-01', minutes: 12 * 60 }, data), { tab: 'tomorrow', date: '2026-11-02' });
});

test('следующий учебный день пропускает дни без пар', () => {
  assert.equal(nextStudyDay('2026-11-06', data), '2026-11-09'); // пт нижней недели → сб без пар → пн
  assert.equal(nextStudyDay('2026-10-30', data), '2026-10-31');
});

test('идёт сейчас и следующая пара', () => {
  const day = buildDay('2026-11-03', data);
  const at14 = nowAndNext(day, 14 * 60);
  assert.equal(at14.current.subject, 'УПП');
  assert.equal(at14.minutesLeft, 50);
  assert.equal(at14.next.subject, 'ТП');
  const at1455 = nowAndNext(day, 14 * 60 + 55);
  assert.equal(at1455.current, null);
  assert.equal(at1455.minutesToNext, 5);
});

test('метка «изменено» — только за последние 48 часов', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.equal(isRecent('2026-11-02T12:00:00Z', now), true);
  assert.equal(isRecent('2026-10-31T11:00:00Z', now), false);
  assert.equal(isRecent(undefined, now), false);
});

test('?now= для проверки и демонстрации; мусор игнорируется', () => {
  assert.deepEqual(parseNowOverride('?now=2026-11-03T14:05'), { date: '2026-11-03', minutes: 14 * 60 + 5 });
  assert.equal(parseNowOverride('?now=завтра'), null);
  assert.equal(parseNowOverride(''), null);
});
