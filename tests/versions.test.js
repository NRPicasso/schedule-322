// Версии шаблона «с даты»: новая версия меняет только свои недели, прошлое остаётся как было.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDay, addDays } from '../site/src/schedule.js';
import { versionsOf, versionAt, nextVersionAfter, pairInVersion, copyForNewVersion, templateImpact } from '../site/src/versions.js';
import { weekChanges } from '../site/src/telegram.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const seed = read('../site/data/seed.json');
const hist = read('../site/data/demo-entries.json');
const { days } = read('./fixtures/history.json');
const clone = (x) => JSON.parse(JSON.stringify(x));

const V1 = { id: 'V1', from: '2026-09-14', anchorWeek: '2026-09-14', anchorHalf: 'top', semesterStart: '2026-09-14', semesterEnd: '2026-12-31', pairs: seed.template };
/** Весенняя версия с 09.02.2027 (вторник): опорная неделя 08.02 — нижняя, ГПП-семинар уходит в 305, ТП-лекция исчезает. */
function spring() {
  const pairs = clone(seed.template).filter((t) => t.id !== 'TUE-1500-bot');
  pairs.find((t) => t.id === 'TUE-1500-top').room = '305';
  pairs.push({ id: 'P-new-1', half: 'both', day: 1, start: '09:40', end: '11:10', slots: 1, subject: 'Новый', tgName: 'Новый', type: 'lecture', room: '101', teacher: '', note: '' });
  return { id: 'V-20270209', from: '2027-02-09', anchorWeek: '2027-02-08', anchorHalf: 'bottom', semesterStart: '2027-02-09', semesterEnd: '2027-06-30', pairs };
}
const withSpring = (extra = {}) => ({ ...seed, ...clone(hist), versions: [V1, spring()], ...extra });

test('без поля versions (старый сервер, сохранённая копия) — одна версия из шаблона и настроек', () => {
  const data = { ...seed, ...hist };
  const [v] = versionsOf(data);
  assert.equal(versionsOf(data).length, 1);
  assert.equal(v.from, '2026-09-14');
  assert.equal(v.pairs, seed.template);
  assert.equal(versionsOf(data), versionsOf(data)); // не собирается заново на каждый день
});

test('версия «с 09.02.2027»: все 42 дня 14.09–31.10 совпадают с перепиской, как и без неё', () => {
  const data = withSpring();
  for (const [date, expected] of Object.entries(days)) {
    const got = buildDay(date, data).pairs.filter((p) => p.status === 'normal').map((p) => `${p.start} ${p.room} ${p.subject}`);
    assert.deepEqual(got, expected, date);
    assert.equal(buildDay(date, data).half, buildDay(date, { ...seed, ...hist }).half, date);
  }
});

test('после даты версии — её пары и её опорная неделя; накануне — прежняя версия', () => {
  const data = withSpring();
  // понедельник 08.02 — ещё осенняя версия: от 14.09 прошло 21 неделя → нижняя
  assert.equal(versionAt(data, '2027-02-08').id, 'V1');
  assert.equal(buildDay('2027-02-08', data).half, 'bottom');
  assert.ok(!buildDay('2027-02-08', data).pairs.some((p) => p.id === 'P-new-1'));
  // вторник 09.02 — весенняя: опорная неделя 08.02 — нижняя
  assert.equal(buildDay('2027-02-09', data).half, 'bottom');
  const tue = buildDay('2027-02-16', data);                               // следующая неделя — верхняя
  assert.equal(tue.half, 'top');
  assert.equal(tue.pairs.find((p) => p.id === 'TUE-1500-top').room, '305');
  assert.ok(buildDay('2027-02-15', data).pairs.some((p) => p.id === 'P-new-1'));
  assert.ok(!buildDay('2027-02-09', data).pairs.some((p) => p.id === 'TUE-1500-bot')); // ТП-лекции больше нет
  assert.equal(nextVersionAfter(data, '2026-11-03').from, '2027-02-09');
  assert.equal(nextVersionAfter(data, '2027-02-09'), null);
});

test('постоянная замена осени не действует в новой версии; замена, начатая в новой версии, — действует', () => {
  const data = withSpring({ rules: [
    { pairId: 'THU-1320', from: '2026-11-05', to: '', field: 'room', value: '400' },
    { pairId: 'THU-1500', from: '2027-02-11', to: '', field: 'room', value: '500' },
  ] });
  assert.equal(buildDay('2027-02-04', data).pairs.find((p) => p.id === 'THU-1320').room, '400');   // осень
  assert.equal(buildDay('2027-02-11', data).pairs.find((p) => p.id === 'THU-1320').room, '221');   // весна — шаблон
  assert.equal(buildDay('2027-02-11', data).pairs.find((p) => p.id === 'THU-1500').room, '500');
  // в первой версии нижней границы нет: правило «с 01.09» (до первой версии) по-прежнему действует
  const early = withSpring({ rules: [{ pairId: 'THU-1320', from: '2026-09-01', to: '', field: 'room', value: '401' }] });
  assert.equal(buildDay('2026-10-29', early).pairs.find((p) => p.id === 'THU-1320').room, '401');
});

test('перенос с пары, которой нет в новой версии, показывается с предметом из прежней версии', () => {
  const data = withSpring({ extras: [{ id: 'X-test-01', date: '2027-02-20', start: '18:30', end: '20:00', srcDate: '2027-02-09', srcPairId: 'TUE-1500-bot', room: '115', links: [] }] });
  const p = buildDay('2027-02-20', data).pairs.find((x) => x.id === 'X-test-01');
  assert.equal(p.subject, 'ТП');
  assert.equal(pairInVersion(data, 'TUE-1500-bot', '2027-02-09').subject, 'ТП');
  assert.equal(pairInVersion(data, 'P-new-1', '2026-10-01').subject, 'Новый'); // есть только в более поздней версии
});

test('тексты Telegram: «вместо» постоянной замены берётся из шаблона своей версии', () => {
  const data = withSpring({ rules: [{ pairId: 'TUE-1500-top', from: '2027-02-16', to: '', field: 'room', value: '219' }] });
  const list = weekChanges('2027-02-15', data).map((x) => x.text);
  assert.ok(list.some((t) => /аудитория 219 \(вместо 305\)/.test(t)), list.join('\n'));
});

test('копия для новой версии: id пар те же, бессрочные замены вписаны в пары, замены с датой «по» — в предупреждение', () => {
  const data = { ...seed, ...clone(hist), versions: [V1], rules: [
    { pairId: 'THU-1320', from: '2026-11-05', to: '', field: 'room', value: '400' },
    { pairId: 'THU-1320', from: '2026-12-03', to: '', field: 'room', value: '402' },  // более поздняя сильнее
    { pairId: 'FRI-1830', from: '2026-11-06', to: '2027-03-01', field: 'teacher', value: 'Временный' },
    { pairId: 'MON-1500', from: '2027-03-01', to: '', field: 'room', value: '999' },  // начнётся после даты версии
  ] };
  const { version, baked, limited } = copyForNewVersion(data, '2027-02-09');
  assert.deepEqual(version.pairs.map((t) => t.id), seed.template.map((t) => t.id));
  assert.equal(version.pairs.find((t) => t.id === 'THU-1320').room, '402');
  assert.equal(version.pairs.find((t) => t.id === 'MON-1500').room, seed.template.find((t) => t.id === 'MON-1500').room);
  assert.equal(baked.length, 2);
  assert.deepEqual(limited.map((r) => r.pairId), ['FRI-1830']);
  assert.equal(version.anchorWeek, '2027-02-08');
  assert.equal(version.anchorHalf, buildDay('2027-02-09', data).half); // половина недели продолжается
  assert.equal(seed.template.find((t) => t.id === 'THU-1320').room, '221');           // исходный шаблон не тронут
});

test('последствия правки: ДЗ у исчезнувшей пары, ДЗ у пары с новым днём (с датой для переноса), перенос, замена', () => {
  const v2 = { ...spring(), pairs: clone(spring().pairs) };
  v2.from = '2026-11-16'; v2.id = 'V-20261116'; v2.anchorWeek = '2026-11-16'; v2.anchorHalf = 'bottom'; // та же чётность, что у осени (16.11 — нижняя)
  v2.pairs.find((t) => t.id === 'FRI-1830').day = 4;                                        // УПП-семинар — с пятницы на четверг
  const data = { ...seed, ...clone(hist), versions: [V1],
    entries: [
      { date: '2026-11-17', pairId: 'TUE-1500-bot', hw: '', links: [], noHw: true },        // нижняя неделя: ТП исчезает
      { date: '2026-11-20', pairId: 'FRI-1830', hw: 'Задачи 1–5', links: [] },             // пара переезжает на четверг 19.11
      { date: '2026-11-10', pairId: 'TUE-1500-bot', hw: 'До версии', links: [] },          // до даты версии — не задета
      { date: '2026-11-24', pairId: 'TUE-1500-top', hw: 'Остаётся', links: [] },           // пара остаётся в этот день
    ],
    extras: [{ id: 'X-test-02', date: '2026-11-21', start: '18:30', end: '20:00', srcDate: '2026-11-17', srcPairId: 'TUE-1500-bot', links: [] }],
    rules: [
      { pairId: 'TUE-1500-bot', from: '2026-11-17', to: '', field: 'room', value: '300' },  // правило у исчезающей пары
      { pairId: 'TUE-1500-top', from: '2026-11-24', to: '', field: 'room', value: '219' },  // сильнее шаблона (там 305)
      { pairId: 'THU-1320', from: '2026-10-01', to: '', field: 'room', value: '400' },      // осеннее — не перейдёт
    ],
  };
  const { items, stronger, notCarried } = templateImpact(data, v2);
  const brief = items.map((i) => `${i.kind} ${i.date} ${i.pairId} ${i.reason} ${i.target || '-'}`);
  assert.deepEqual(brief, [
    'entry 2026-11-17 TUE-1500-bot removed -',
    'move 2026-11-17 TUE-1500-bot removed -',
    'rule 2026-11-17 TUE-1500-bot removed -',
    'entry 2026-11-20 FRI-1830 moved 2026-11-19',
  ]);
  assert.deepEqual(stronger.map((r) => `${r.pairId} ${r.value} вместо ${r.template}`), ['TUE-1500-top 219 вместо 305']);
  assert.deepEqual(notCarried.map((r) => r.pairId), ['THU-1320']);
});

test('последствия: версию ограничивает следующая; день, где пара и так не стоит, не считается', () => {
  const v2 = spring();
  const v3 = { ...spring(), id: 'V-20270301', from: '2027-03-01' };
  const data = { ...seed, versions: [V1, v3], rules: [], extras: [],
    entries: [
      { date: '2027-02-16', pairId: 'TUE-1500-bot', hw: 'в верхнюю неделю этой пары нет', links: [] },
      { date: '2027-02-23', pairId: 'TUE-1500-bot', hw: 'нижняя неделя — пара есть', links: [] },
      { date: '2027-03-09', pairId: 'TUE-1500-bot', hw: 'это уже версия с 01.03', links: [] },
    ] };
  // по осенней версии: от 14.09 до 16.02 — 22 недели (верхняя), 23.02 — нижняя
  assert.deepEqual(templateImpact(data, v2).items.map((i) => i.date), ['2027-02-23']);
});

test('после последней версии правила продолжают работать до конца (следующей версии нет)', () => {
  const data = withSpring({ rules: [{ pairId: 'MON-1500', from: '2027-02-15', to: '', field: 'room', value: '777' }] });
  assert.equal(buildDay(addDays('2027-02-15', 70), data).pairs.find((p) => p.id === 'MON-1500').room, '777');
});
