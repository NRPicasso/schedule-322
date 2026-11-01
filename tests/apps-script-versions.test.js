// Сервер и версии шаблона (v0.2): чтение листов «Версии» + «Шаблон», правка версий и предметов,
// проверка пар по версии на дату операции. Без Google — code.src.js в «песочнице» Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildDay } from '../site/src/schedule.js';

const code = readFileSync(new URL('../apps-script/code.src.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ Utilities: { formatDate: (d) => d.toISOString() } });
vm.runInContext(code + '\nthis.api = { buildPayload_, objectsToRows_, rowsToObjects_, SHEETS, processOps_, versionsFrom_ };', ctx);
const { buildPayload_, objectsToRows_, rowsToObjects_, SHEETS, processOps_, versionsFrom_ } = ctx.api;

const seed = JSON.parse(readFileSync(new URL('../site/data/seed.json', import.meta.url)));
const hist = JSON.parse(readFileSync(new URL('../site/data/demo-entries.json', import.meta.url)));
const clone = (x) => JSON.parse(JSON.stringify(x));
const plain = (x) => JSON.parse(JSON.stringify(x)); // объекты из «песочницы» → обычные (для deepEqual)
const sheet = (k, items) => [SHEETS[k].cols.map((c) => c[0]), ...objectsToRows_(items, SHEETS[k].cols)];
const SETTINGS = [['ключ', 'значение'], ['опорная_неделя', '2026-09-14'], ['опорная_половина', 'верх'], ['начало_семестра', '2026-09-14'], ['конец_семестра', '2026-12-31'], ['завтра_после', '18:30']];
const SUBJECTS = Object.entries(seed.subjects).map(([subject, s]) => ({ subject, ...s }));

const V1 = { id: 'V1', from: '2026-09-14', anchorWeek: '2026-09-14', anchorHalf: 'top', semesterStart: '2026-09-14', semesterEnd: '2026-12-31', version: 1, by: 'переход v0.2' };
const springPairs = () => clone(seed.template).filter((t) => t.id !== 'TUE-1500-bot').map((t) => (t.id === 'FRI-1830' ? { ...t, day: 4 } : t));
const V2 = { id: 'V-20270209', from: '2027-02-09', anchorWeek: '2027-02-08', anchorHalf: 'bottom', semesterStart: '2027-02-09', semesterEnd: '2027-06-30', version: 1, by: 'Активист 1' };

function sheetsWithVersions() {
  const tpl = [...seed.template.map((t) => ({ ...t, versionId: 'V1' })), ...springPairs().map((t) => ({ ...t, versionId: V2.id }))];
  return {
    'Шаблон': sheet('template', tpl), 'Версии': sheet('versions', [V1, V2]), 'Предметы': sheet('subjects', SUBJECTS),
    'Правила': sheet('rules', hist.rules), 'Записи': sheet('entries', hist.entries), 'Доп_пары': sheet('extras', []),
    'Дни': sheet('dayNotes', hist.dayNotes), 'Настройки': SETTINGS,
  };
}

test('до перехода (нет листа «Версии»): одна версия V1 из «Настроек» со всеми парами; прежние поля — те же', () => {
  const sheets = { ...sheetsWithVersions(), 'Шаблон': sheet('template', seed.template), 'Версии': [] };
  const p = plain(buildPayload_((n) => sheets[n] || [], '2026-11-01'));
  assert.equal(p.versions.length, 1);
  assert.equal(p.versions[0].from, '2026-09-14');
  assert.equal(p.versions[0].pairs.length, 23);
  assert.deepEqual(p.template, p.versions[0].pairs);
  assert.deepEqual(p.settings, seed.settings);
});

test('после перехода: версии со своими парами; «шаблон» для старых версий сайта — версия, действующая сегодня; без имён', () => {
  const sheets = sheetsWithVersions();
  const autumn = plain(buildPayload_((n) => sheets[n] || [], '2026-11-01'));
  assert.deepEqual(autumn.versions.map((v) => [v.id, v.pairs.length, v.anchorHalf]), [['V1', 23, 'top'], ['V-20270209', 22, 'bottom']]);
  assert.equal(autumn.template.length, 23);
  assert.equal(autumn.settings.anchorWeek, '2026-09-14');
  assert.equal(autumn.settings.tomorrowAfter, '18:30');
  assert.equal(JSON.stringify(autumn).includes('"by"'), false);
  assert.ok(!('versionId' in autumn.versions[1].pairs[0]));
  const spring = plain(buildPayload_((n) => sheets[n] || [], '2027-02-10'));
  assert.equal(spring.template.length, 22);
  assert.deepEqual(spring.settings, { anchorWeek: '2027-02-08', anchorHalf: 'bottom', semesterStart: '2027-02-09', semesterEnd: '2027-06-30', tomorrowAfter: '18:30' });
  // сайт собирает день из этих данных: осень — как раньше, весна — по своей версии
  assert.equal(buildDay('2026-10-27', autumn).pairs.length, 4);
  assert.ok(buildDay('2027-02-18', autumn).pairs.some((p) => p.id === 'FRI-1830'));   // четверг весной
});

test('строка «Шаблона» без версии (ручная правка) относится к первой версии; «верх/низ» опорной недели читаются и пишутся', () => {
  const list = plain(versionsFrom_([{ id: 'A', day: 1 }, { id: 'B', day: 2, versionId: 'V2' }], [{ id: 'V2', from: '2027-01-01' }, { id: 'V1', from: '2026-01-01' }], {}));
  assert.deepEqual(list.map((v) => [v.id, v.pairs.map((t) => t.id).join()]), [['V1', 'A'], ['V2', 'B']]);
  const rows = sheet('versions', [V2]);
  assert.equal(rows[1][3], 'низ');
  assert.equal(rowsToObjects_(rows, SHEETS.versions.cols)[0].anchorHalf, 'bottom');
});

// ---------- правка версий ----------
const meta = (name = 'Активист 1') => ({ name, now: '2026-11-01T12:00:00+03:00', today: '2026-11-01' });
const state = (extra = {}) => ({ entries: [], dayNotes: [], rules: [], extras: [], subjects: clone(SUBJECTS), versionsReady: true,
  versions: [{ ...clone(V1), pairs: clone(seed.template) }], ...extra });
let n = 0;
const opId = () => 'op-test-' + String(++n).padStart(4, '0');
const save = (v, baseVersion = 0) => ({ opId: opId(), type: 'version.save', date: v.from, baseVersion, tplVersion: v });
const draft = (o = {}) => ({ id: 'V-20261116', from: '2026-11-16', anchorWeek: '2026-11-16', anchorHalf: 'bottom', semesterStart: '2026-11-16', semesterEnd: '2026-12-31', pairs: springPairs(), ...o });
const run = (st, ops, name) => processOps_(st, ops, null, meta(name), () => null);
const errors = (out) => [...out.results.map((r) => (r.ok ? 'ok' : `${r.error}: ${r.message}`))];

test('новая версия с завтра: сохраняется, в журнале с именем, в ответе без имени; пары проверяются по ней', () => {
  const st = state();
  const out = run(st, [
    save(draft()),
    { opId: opId(), type: 'entry', date: '2026-11-19', pairId: 'FRI-1830', baseVersion: 0, patch: { hw: 'Задачи' } },   // УПП теперь по четвергам
    { opId: opId(), type: 'entry', date: '2026-11-17', pairId: 'TUE-1500-bot', baseVersion: 0, patch: { hw: 'x' } },    // ТП больше нет
    { opId: opId(), type: 'entry', date: '2026-11-10', pairId: 'TUE-1500-bot', baseVersion: 0, patch: { hw: 'до версии' } },
  ]);
  assert.deepEqual(errors(out), ['ok', 'ok', 'invalid: такой пары нет в шаблоне на эту дату', 'ok']);
  assert.deepEqual(st.versions.map((v) => v.id), ['V1', 'V-20261116']);
  assert.equal(st.versions[1].version, 1);
  assert.equal(st.versions[1].by, 'Активист 1');
  assert.equal(out.results[0].tplVersion.by, undefined);
  assert.equal(out.logs[0].action, 'версия шаблона +');
  assert.equal(out.logs[0].by, 'Активист 1');
});

test('нельзя: версию с сегодня, вторую с той же даты, неизвестный предмет, плохую пару, опорную неделю не с понедельника', () => {
  const st = state();
  run(st, [save(draft())]);
  const out = run(st, [
    save(draft({ id: 'V-x1', from: '2026-11-01', semesterStart: '2026-11-01' })),
    save(draft({ id: 'V-x2' })),
    save(draft({ id: 'V-x3', from: '2026-11-20', pairs: [{ ...seed.template[0], subject: 'Неведомое' }] })),
    save(draft({ id: 'V-x4', from: '2026-11-21', pairs: [{ ...seed.template[0], start: '15:00', end: '14:00' }] })),
    save(draft({ id: 'V-x5', from: '2026-11-22', anchorWeek: '2026-11-17' })),
    save(draft({ id: 'V-x6', from: '2026-11-23', pairs: [seed.template[0], seed.template[0]] })),
  ]);
  assert.deepEqual(errors(out), [
    'invalid: новая версия шаблона — не раньше завтрашнего дня',
    'invalid: с этой даты уже есть версия шаблона',
    'invalid: нет такого предмета: Неведомое — сначала добавьте его в список предметов',
    'invalid: время пары: конец позже начала, в формате ЧЧ:ММ (пара 1)',
    'invalid: опорная неделя — дата понедельника',
    'invalid: две пары с одним номером',
  ]);
  assert.equal(st.versions.length, 2);
});

test('правка будущей версии: по версии строки; устаревшая — конфликт с вариантом другого без имени; начавшуюся править нельзя', () => {
  const st = state();
  run(st, [save(draft())]);
  const edited = draft({ semesterEnd: '2026-12-30' });
  const ok = run(st, [save(edited, 1)], 'Активист 2');
  assert.deepEqual(errors(ok), ['ok']);
  assert.equal(st.versions[1].version, 2);
  const stale = run(st, [save(draft({ semesterEnd: '2026-12-29' }), 1)]);
  assert.equal(stale.results[0].error, 'conflict');
  assert.equal(stale.results[0].current.semesterEnd, '2026-12-30');
  assert.equal(JSON.stringify(stale.results).includes('Активист'), false);
  const started = run(st, [save({ ...clone(V1), pairs: clone(seed.template) }, 1)]);
  assert.deepEqual(errors(started), ['invalid: эта версия шаблона уже действует — сделайте новую с завтрашнего дня']);
});

test('удаление: будущую версию можно, начавшуюся и единственную — нет; повтор удаления — не ошибка', () => {
  const st = state();
  run(st, [save(draft())]);
  assert.deepEqual(errors(run(st, [{ opId: opId(), type: 'version.remove', date: '2026-11-01', id: 'V1', baseVersion: 1 }])),
    ['invalid: эта версия шаблона уже действует — сделайте новую с завтрашнего дня']);
  const out = run(st, [{ opId: opId(), type: 'version.remove', date: '2026-11-01', id: 'V-20261116', baseVersion: 1 }]);
  assert.deepEqual(errors(out), ['ok']);
  assert.equal(out.logs[0].action, 'версия шаблона −');
  assert.equal(out.logs[0].before.pairs.length, 22);                    // удалённое — в журнале целиком
  assert.deepEqual(st.versions.map((v) => v.id), ['V1']);
  assert.deepEqual(errors(run(st, [{ opId: opId(), type: 'version.remove', date: '2026-11-01', id: 'V-20261116', baseVersion: 0 }])), ['ok']);
});

test('перенос проверяет день исходной пары по версии на исходную дату', () => {
  const st = state();
  run(st, [save(draft())]);
  const x = (srcDate, id) => ({ opId: opId(), type: 'extra.add', date: '2026-11-28', extra: { id, date: '2026-11-28', start: '18:30', end: '20:00', srcDate, srcPairId: 'FRI-1830', links: [] } });
  assert.deepEqual(errors(run(st, [x('2026-11-13', 'X-test-0001'), x('2026-11-19', 'X-test-0002'), x('2026-11-20', 'X-test-0003')])),
    ['ok', 'ok', 'invalid: этой пары нет в исходный день']);
});

test('до перехода версию сохранить нельзя (понятная причина), остальные правки работают', () => {
  const st = state({ versionsReady: false });
  assert.deepEqual(errors(run(st, [save(draft()), { opId: opId(), type: 'note.add', date: '2026-11-03', text: 'Сменка' }])),
    ['invalid: таблица ещё не переведена на версии шаблона — напишите Еремею', 'ok']);
});

test('предметы: новый — добавляется; цвет только из палитры; правка поверх чужой — конфликт', () => {
  const st = state();
  const set = (subject, prev) => ({ opId: opId(), type: 'subject.set', date: '2026-11-01', subject, prev });
  const out = run(st, [
    set({ subject: 'Криминалистика', short: 'КРИМ', full: 'Криминалистика', color: 'tp' }),
    set({ subject: 'Право', short: 'ПР', full: '', color: 'red' }),
    set({ subject: 'ГПП', short: 'ГПП', full: 'Гражданский процесс (изменено)', color: 'gpp' }, seed.subjects['ГПП']),
  ]);
  assert.deepEqual(errors(out), ['ok', 'invalid: цвет — из готовой палитры', 'ok']);
  assert.ok(st.subjects.some((s) => s.subject === 'Криминалистика'));
  const stale = run(st, [set({ subject: 'ГПП', short: 'ГП2', full: 'x', color: 'gpp' }, seed.subjects['ГПП'])]);
  assert.equal(stale.results[0].error, 'conflict');
  assert.equal(stale.results[0].current.full, 'Гражданский процесс (изменено)');
  // новая версия может сразу использовать новый предмет
  const pairs = [...springPairs(), { id: 'P-krim-1', half: 'both', day: 1, start: '09:40', end: '11:10', slots: 1, subject: 'Криминалистика', type: 'lecture', room: '101' }];
  assert.deepEqual(errors(run(st, [save(draft({ pairs }))])), ['ok']);
});

// ---------- переход migrateV2 на имитации Google Таблицы ----------
/** Минимальная имитация SpreadsheetApp: листы — двумерные массивы строк. */
function fakeSpreadsheet(init) {
  const sheets = new Map();
  const make = (name, rows) => {
    const data = rows.map((r) => r.slice());
    const width = () => Math.max(0, ...data.map((r) => r.length));
    const cell = (r, c) => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : '');
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
      setValues: (vals) => { vals.forEach((row, i) => row.forEach((v, j) => { while (data.length < r + i) data.push([]); const line = data[r + i - 1]; while (line.length < c + j - 1) line.push(''); line[c + j - 1] = v; })); return range(r, c, nr, nc); },
      setValue: (v) => range(r, c).setValues([[v]]),
      setNumberFormat: () => range(r, c, nr, nc), setFontWeight: () => range(r, c, nr, nc),
    });
    const sh = { data, getName: () => name, getRange: range, getLastRow: () => { let n = data.length; while (n && data[n - 1].every((v) => v === '' || v == null)) n--; return n; },
      getLastColumn: () => width(), getDataRange: () => range(1, 1, data.length, width()), appendRow: (row) => data.push(row.slice()),
      setFrozenRows: () => {}, autoResizeColumns: () => {} };
    sheets.set(name, sh);
    return sh;
  };
  for (const [name, rows] of Object.entries(init)) make(name, rows);
  return { sheets, getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => make(n, []) };
}

test('переход migrateV2: V1 из «Настроек», всем парам — V1, ничего не удалено; повторный запуск ничего не меняет; данные сайта те же', () => {
  // «Шаблон» как в живой таблице v0.1 — без столбца «версия_шаблона»
  const oldCols = SHEETS.template.cols.filter((c) => c[1] !== 'versionId');
  const init = { ...sheetsWithVersions(), 'Шаблон': [oldCols.map((c) => c[0]), ...objectsToRows_(seed.template, oldCols)], 'Журнал': [SHEETS.log.cols.map((c) => c[0])] };
  delete init['Версии'];
  const ss = fakeSpreadsheet(init);
  const logs = [];
  const g = vm.createContext({
    Utilities: { formatDate: () => '2026-11-02T10:00:00+03:00' },
    SpreadsheetApp: { getActive: () => ss },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ remove: () => {} }) },
    Logger: { log: (s) => logs.push(s) },
  });
  vm.runInContext(code + '\nthis.api = { migrateV2, buildPayload_, readSheet_ };', g);
  const read = (n) => (ss.getSheetByName(n) ? ss.getSheetByName(n).data : []);
  const before = plain(g.api.buildPayload_(read, '2026-11-02'));
  const rowsBefore = ss.getSheetByName('Шаблон').data.length;

  g.api.migrateV2();
  assert.match(logs.at(-1), /Готово: версия V1 с 2026-09-14 \(опорная неделя 2026-09-14\), пар в шаблоне: 23/);
  const ver = ss.getSheetByName('Версии').data;
  assert.deepEqual([...ver[0]], [...SHEETS.versions.cols.map((c) => c[0])]);
  assert.deepEqual([...ver[1].slice(0, 7)], ['V1', '2026-09-14', '2026-09-14', 'верх', '2026-09-14', '2026-12-31', '1']);
  const tpl = ss.getSheetByName('Шаблон').data;
  assert.equal(tpl.length, rowsBefore);
  assert.equal(tpl[0].at(-1), 'версия_шаблона');
  assert.ok(tpl.slice(1).every((r) => r.at(-1) === 'V1'));
  assert.equal(ss.getSheetByName('Журнал').data.length, 2);
  assert.equal(ss.getSheetByName('Настройки').data.length, SETTINGS.length);   // настройки не тронуты (для отката)
  const after = plain(g.api.buildPayload_(read, '2026-11-02'));
  const meta = (p) => p.versions.forEach((v) => { delete v.version; delete v.updatedAt; });  // счётчик правок и время у V1 — новые
  meta(before); meta(after);
  assert.deepEqual(after, before);                                              // сайт видит то же самое

  g.api.migrateV2();                                                            // второй запуск
  assert.match(logs.at(-1), /Переход уже сделан/);
  assert.equal(ss.getSheetByName('Версии').data.length, 2);
  assert.equal(ss.getSheetByName('Журнал').data.length, 2);
});

// ---------- проверка 01.11: исправления после независимого ревью ----------
test('строка «Шаблона» с неизвестной версией не попадает в первую версию', () => {
  const list = plain(versionsFrom_([{ id: 'A', day: 1 }, { id: 'X', day: 2, versionId: 'V-удалена' }], [{ id: 'V1', from: '2026-01-01' }], {}));
  assert.deepEqual(list.map((v) => [v.id, v.pairs.map((t) => t.id).join()]), [['V1', 'A']]);
});

test('предметы: новый с уже занятым названием — конфликт; удалить можно только неиспользуемый; служебные имена нельзя', () => {
  const st = state();
  const out = run(st, [
    { opId: opId(), type: 'subject.set', date: '2026-11-01', subject: { subject: 'ГПП', short: 'X', full: '', color: 'gpp' } },          // без prev
    { opId: opId(), type: 'subject.set', date: '2026-11-01', subject: { subject: 'toString', short: 'T', full: '', color: 'gpp' } },
    { opId: opId(), type: 'subject.set', date: '2026-11-01', subject: { subject: 'Криминалистика', short: 'КРИМ', full: '', color: 'tp' } },
    { opId: opId(), type: 'subject.remove', date: '2026-11-01', name: 'ГПП', prev: seed.subjects['ГПП'] },
    { opId: opId(), type: 'subject.remove', date: '2026-11-01', name: 'Криминалистика', prev: { short: 'КРИМ', full: '', color: 'tp' } },
  ]);
  assert.deepEqual(errors(out), ['conflict: ', 'invalid: такое название предмета нельзя', 'ok', 'invalid: предмет есть в шаблоне — сначала уберите его из пар', 'ok']);
  assert.ok(!st.subjects.some((s) => s.subject === 'Криминалистика'));
  assert.equal(out.logs.at(-1).action, 'предмет −');
  // пара с «предметом» toString в версии не проходит проверку списка предметов
  const bad = run(st, [save(draft({ pairs: [{ ...seed.template[0], subject: 'toString' }] }))]);
  assert.match(errors(bad)[0], /нет такого предмета: toString/);
});

test('повтор удаления версии с прежним номером правки — не конфликт; пустое «слотов» сохраняется как 1', () => {
  const st = state();
  const pairs = springPairs().map((t, i) => (i === 0 ? { ...t, slots: '' } : t));
  assert.deepEqual(errors(run(st, [save(draft({ pairs }))])), ['ok']);
  assert.equal(st.versions[1].pairs[0].slots, 1);
  const rm = { opId: opId(), type: 'version.remove', date: '2026-11-01', id: 'V-20261116', baseVersion: 1 };
  assert.deepEqual(errors(run(st, [rm])), ['ok']);
  assert.deepEqual(errors(run(st, [{ ...rm, opId: opId() }])), ['ok']);
});

test('запись версий в листы: «Шаблон» и «Версии» читаются обратно теми же; чужой столбец с данными — запись отменяется', () => {
  const init = { ...sheetsWithVersions(), 'Журнал': [SHEETS.log.cols.map((c) => c[0])] };
  const ss = fakeSpreadsheet(init);
  const g = vm.createContext({ Utilities: { formatDate: () => '2026-11-02T10:00:00+03:00' }, SpreadsheetApp: { getActive: () => ss } });
  vm.runInContext(code + '\nthis.api = { writeVersions_, buildPayload_ };', g);
  const read = (n) => (ss.getSheetByName(n) ? ss.getSheetByName(n).data : []);
  const before = plain(g.api.buildPayload_(read, '2026-11-02'));
  g.api.writeVersions_(plain(before.versions).map((v) => ({ ...v, version: v.version || 1 })));
  const after = plain(g.api.buildPayload_(read, '2026-11-02'));
  assert.deepEqual(after.versions, before.versions);
  assert.equal(ss.getSheetByName('Шаблон').data[1][1], 'обе');               // половина недели — по-русски, как была
  // владелец добавил свой столбец «комментарий» с данными — сервер не пишет и объясняет почему
  const tpl = ss.getSheetByName('Шаблон').data;
  tpl[0].push('комментарий'); tpl[1].push('важно');
  assert.throws(() => g.api.writeVersions_(plain(before.versions)), /есть свои столбцы с данными \(комментарий\)/);
  assert.equal(tpl[1].at(-1), 'важно');
});

test('сохранение версии с переносом записей: ДЗ пары, сменившей день, переезжает вместе с версией (и обратно при отмене)', () => {
  const st = state({ entries: [
    { date: '2026-11-20', pairId: 'FRI-1830', hw: 'Задачи 1–5', links: ['https://t.me/c/1/2/3'], version: 2 },
    { date: '2026-11-19', pairId: 'FRI-1830', hw: '', links: ['https://t.me/c/1/2/9'], version: 1 },
  ] });
  const op = { ...save(draft()), moves: [{ date: '2026-11-20', pairId: 'FRI-1830', to: '2026-11-19' }] };
  const out = run(st, [op]);
  assert.deepEqual(errors(out), ['ok']);
  const at = (d) => st.entries.find((e) => e.date === d && e.pairId === 'FRI-1830');
  assert.equal(at('2026-11-19').hw, 'Задачи 1–5');
  assert.deepEqual([...at('2026-11-19').links], ['https://t.me/c/1/2/9', 'https://t.me/c/1/2/3']);
  assert.equal(at('2026-11-20').hw, '');
  assert.equal(at('2026-11-20').links.length, 0);
  assert.equal(out.logs.filter((l) => l.sheet === 'Записи').length, 2);
  assert.ok(out.logs.every((l) => l.by === 'Активист 1'));
  // отмена: прежняя версия удаляется, записи — обратно
  const undo = run(st, [{ opId: opId(), type: 'version.remove', date: '2026-11-01', id: 'V-20261116', baseVersion: 1 },
    { opId: opId(), type: 'entry', date: '2026-11-20', pairId: 'FRI-1830', baseVersion: at('2026-11-20').version, patch: { hw: 'Задачи 1–5', links: ['https://t.me/c/1/2/3'] } },
    { opId: opId(), type: 'entry', date: '2026-11-19', pairId: 'FRI-1830', baseVersion: at('2026-11-19').version, patch: { hw: '', links: ['https://t.me/c/1/2/9'] } }]);
  assert.deepEqual(errors(undo), ['ok', 'ok', 'ok']);
  assert.equal(at('2026-11-20').hw, 'Задачи 1–5');
  // плохой список переносов отклоняется целиком
  assert.match(errors(run(st, [{ ...save(draft({ id: 'V-x9', from: '2026-11-30' })), moves: [{ date: 'вчера', pairId: 'A', to: '2026-11-19' }] }]))[0], /неверный перенос записи/);
});
