import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayMonth, longDay, dayMonthWeekday, toDay, shortTime, weekRange, shortLink } from '../site/src/format.js';

test('даты по-русски без ошибок падежей', () => {
  assert.equal(dayMonth('2026-11-07'), '7 ноября');
  assert.equal(longDay('2026-11-03'), 'Вторник, 3 ноября');
  assert.equal(dayMonthWeekday('2026-11-07'), '7 ноября (сб)');
  assert.equal(toDay('2026-11-05'), 'К четвергу, 5 ноября');
  assert.equal(toDay('2026-11-04'), 'К среде, 4 ноября');
  assert.equal(weekRange('2026-10-26'), '26 октября — 31 октября');
});

test('время и ссылки', () => {
  assert.equal(shortTime('09:40'), '9:40');
  assert.equal(shortTime('15:00'), '15:00');
  assert.equal(shortLink('https://t.me/c/4323463486/39/3732'), 't.me/…/39/3732');
  assert.equal(shortLink('https://youtu.be/ju1YWiiVuKE'), 'youtu.be/ju1YWiiVuKE');
});
