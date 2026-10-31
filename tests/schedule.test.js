// Тесты логики расписания: запуск — `node --test` из корня проекта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { weekHalf, buildDay, mondayOf, addDays } from '../site/src/schedule.js';

const seed = JSON.parse(readFileSync(new URL('../site/data/seed.json', import.meta.url)));
const demo = JSON.parse(readFileSync(new URL('../site/data/demo-entries.json', import.meta.url)));
const data = (over = {}) => ({ ...seed, entries: [], rules: [], extras: [], dayNotes: [], ...over });
const brief = (day) => day.pairs.map((p) => [p.numbers.join(''), p.start, p.room, p.subject, p.type, p.status]);

test('верхняя/нижняя неделя считается от опорной 14.09.2026', () => {
  const s = seed.settings;
  for (const d of ['2026-09-14', '2026-09-28', '2026-10-26', '2026-10-31']) assert.equal(weekHalf(d, s), 'top', d);
  for (const d of ['2026-09-21', '2026-10-19', '2026-11-02', '2026-11-04']) assert.equal(weekHalf(d, s), 'bottom', d);
});

test('даты: понедельник недели и сдвиг', () => {
  assert.equal(mondayOf('2026-10-31'), '2026-10-26');
  assert.equal(mondayOf('2026-11-01'), '2026-10-26'); // воскресенье относится к прошлой неделе
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('вторник 27.10 совпадает с сообщением 44 переписки', () => {
  const day = buildDay('2026-10-27', data(demo));
  assert.deepEqual(brief(day), [
    ['1', '11:40', '222', 'Муниципальное', 'seminar', 'normal'],
    ['2', '13:20', '115', 'УПП', 'lecture', 'normal'],
    ['3', '15:00', '219', 'ГПП', 'seminar', 'normal'],
    ['4', '16:50', '219', 'ГПП', 'seminar', 'normal'],
  ]);
  assert.equal(day.pairs[0].hw, 'Анализ Устава МО');
  assert.deepEqual(day.pairs[0].links, ['https://t.me/c/4323463486/39/3732']);
  assert.equal(day.pairs[2].hw, 'Задачи и доклады');
});

test('нижняя неделя: четверг 22.10, сдвоенная ТП получает номера 3 и 4', () => {
  const day = buildDay('2026-10-22', data(demo));
  assert.deepEqual(brief(day), [
    ['1', '13:20', '221', 'ОСД', 'seminar', 'normal'],
    ['2', '15:00', '115', 'УП', 'lecture', 'normal'],
    ['34', '16:50', '222', 'ТП', 'seminar', 'normal'],
  ]);
});

test('нумерация по порядку в дне: первая пара в 15:00 — это 1-я', () => {
  const day = buildDay('2026-10-26', data());
  assert.deepEqual(day.pairs.map((p) => [p.numbers.join(''), p.start]), [['1', '15:00'], ['2', '16:50']]);
  assert.equal(day.pairs[1].note, 'отмечает сама');
});

test('воскресенье — пар нет; пометка дня попадает в день', () => {
  assert.equal(buildDay('2026-11-01', data()).pairs.length, 0);
  assert.deepEqual(buildDay('2026-10-28', data(demo)).notes, ['Сдаём КСУ']);
});

test('разовая замена аудитории меняет только эту дату и помнит прежнюю', () => {
  const d = data({ entries: [{ date: '2026-11-03', pairId: 'TUE-1140-bot', room: '305' }] });
  const p = buildDay('2026-11-03', d).pairs[0];
  assert.equal(p.room, '305');
  assert.equal(p.changed.room, '211');
  assert.equal(buildDay('2026-11-17', d).pairs[0].room, '211');
});

test('правило «с этой даты» действует на будущие недели и не трогает прошлые', () => {
  const d = data({ rules: [{ pairId: 'TUE-1500-top', from: '2026-11-10', field: 'room', value: '305' }] });
  assert.equal(buildDay('2026-10-27', d).pairs[2].room, '219');
  assert.equal(buildDay('2026-11-10', d).pairs[2].room, '305');
  assert.equal(buildDay('2026-11-24', d).pairs[2].room, '305');
  // разовая замена сильнее правила
  const d2 = data({ rules: d.rules, entries: [{ date: '2026-11-24', pairId: 'TUE-1500-top', room: '101' }] });
  assert.equal(buildDay('2026-11-24', d2).pairs[2].room, '101');
});

test('правило с датой окончания перестаёт действовать после неё', () => {
  const d = data({ rules: [{ pairId: 'TUE-1500-top', from: '2026-11-10', to: '2026-11-10', field: 'room', value: '305' }] });
  assert.equal(buildDay('2026-11-24', d).pairs[2].room, '219');
});

test('отмена пары: остаётся в дне со статусом и причиной, без номера; номера остальных сдвигаются', () => {
  const d = data({ entries: [{ date: '2026-10-27', pairId: 'TUE-1140-top', cancelled: true, reason: 'преподаватель заболел' }] });
  const day = buildDay('2026-10-27', d);
  assert.equal(day.pairs[0].status, 'cancelled');
  assert.equal(day.pairs[0].reason, 'преподаватель заболел');
  assert.deepEqual(day.pairs.map((p) => p.numbers.join('')), ['', '1', '2', '3']);
});

const move = { id: 'X-1', date: '2026-11-05', start: '18:30', end: '20:00', room: '219', srcDate: '2026-11-03', srcPairId: 'TUE-1140-bot', hw: 'Подготовиться к дебатам', links: [] };

test('перенос: исходный день показывает «перенесена на…», новый — пару с пометкой и ДЗ', () => {
  const d = data({ extras: [move] });
  const src = buildDay('2026-11-03', d);
  assert.equal(src.pairs[0].status, 'moved-away');
  assert.deepEqual(src.pairs[0].movedTo, { date: '2026-11-05', start: '18:30', room: '219' });
  assert.deepEqual(src.pairs.map((p) => p.numbers.join('')), ['', '1', '2']);
  const dst = buildDay('2026-11-05', d);
  const moved = dst.pairs.find((p) => p.id === 'X-1');
  assert.equal(moved.status, 'moved-here');
  assert.equal(moved.subject, 'Муниципальное');
  assert.equal(moved.type, 'seminar');
  assert.equal(moved.movedFrom, '2026-11-03');
  assert.equal(moved.hw, 'Подготовиться к дебатам');
  assert.equal(dst.pairs.at(-1).id, 'X-1'); // по времени — последняя
});

test('повторный перенос правит ту же запись; отмена переноса возвращает оба дня', () => {
  const d = data({ extras: [{ ...move, date: '2026-11-07', start: '11:40', end: '13:10' }] });
  assert.equal(buildDay('2026-11-05', d).pairs.some((p) => p.id === 'X-1'), false);
  assert.equal(buildDay('2026-11-07', d).pairs[0].id, 'X-1');
  const back = data();
  assert.equal(buildDay('2026-11-03', back).pairs[0].status, 'normal');
});

test('дополнительная пара без источника — status extra', () => {
  const d = data({ extras: [{ id: 'X-2', date: '2026-11-07', start: '10:00', end: '11:30', subject: 'Консультация', type: 'other', room: '101' }] });
  const p = buildDay('2026-11-07', d).pairs.find((x) => x.id === 'X-2');
  assert.equal(p.status, 'extra');
  assert.deepEqual(p.numbers, [1]);
});

test('отметка «ДЗ нет» передаётся в пару', () => {
  const d = data({ entries: [{ date: '2026-11-03', pairId: 'TUE-1140-bot', noHw: true }] });
  assert.equal(buildDay('2026-11-03', d).pairs[0].noHw, true);
});
