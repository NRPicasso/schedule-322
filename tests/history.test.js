// Сверка: сайт собирает каждую неделю 14.09–31.10 так же, как активисты писали в группе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDay } from '../site/src/schedule.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const data = { ...read('../site/data/seed.json'), ...read('../site/data/demo-entries.json') };
const { days } = read('./fixtures/history.json');

test('все 42 учебных дня 14.09–31.10 совпадают с перепиской', () => {
  assert.equal(Object.keys(days).length, 42);
  for (const [date, expected] of Object.entries(days)) {
    const got = buildDay(date, data).pairs
      .filter((p) => p.status === 'normal')
      .map((p) => `${p.start} ${p.room} ${p.subject}`);
    assert.deepEqual(got, expected, date);
  }
});
