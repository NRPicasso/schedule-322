/**
 * Бэкенд «Расписания 322» — Google Apps Script, привязанный к таблице.
 * Этот файл — исходник; apps-script/Code.gs собирается из него командой
 * «node tools/build-gs.mjs» (добавляются данные для первого заполнения таблицы).
 *
 * @OnlyCurrentDoc  — скрипт видит только эту таблицу, а не весь Google Диск.
 */
var TZ = 'Europe/Moscow';
var CACHE_KEY = 'payload-v1';
var CACHE_SECONDS = 60; // правка ячейки руками видна на сайте не позже чем через минуту
var TEXT_ROWS = 2000;   // сколько строк заранее делаем «текстовыми», чтобы Таблица не превращала 15:00 и 2026-10-27 в даты

// Листы: [заголовок столбца по-русски, ключ в данных сайта]
var SHEETS = {
  template: { name: 'Шаблон', cols: [['id', 'id'], ['неделя', 'half'], ['день', 'day'], ['начало', 'start'], ['конец', 'end'], ['слотов', 'slots'], ['предмет', 'subject'], ['для_telegram', 'tgName'], ['тип', 'type'], ['аудитория', 'room'], ['преподаватель', 'teacher'], ['пометка', 'note']] },
  subjects: { name: 'Предметы', cols: [['предмет', 'subject'], ['сокращение', 'short'], ['полное', 'full'], ['цвет', 'color']] },
  rules:    { name: 'Правила', cols: [['id_пары', 'pairId'], ['с_даты', 'from'], ['по_дату', 'to'], ['поле', 'field'], ['значение', 'value'], ['кто', 'by'], ['обновлено', 'updatedAt']] },
  entries:  { name: 'Записи', cols: [['дата', 'date'], ['id_пары', 'pairId'], ['дз', 'hw'], ['ссылки', 'links'], ['нет_дз', 'noHw'], ['аудитория', 'room'], ['начало', 'start'], ['конец', 'end'], ['преподаватель', 'teacher'], ['отменена', 'cancelled'], ['причина', 'reason'], ['версия', 'version'], ['кто', 'by'], ['обновлено', 'updatedAt']] },
  extras:   { name: 'Доп_пары', cols: [['id', 'id'], ['дата', 'date'], ['начало', 'start'], ['конец', 'end'], ['слотов', 'slots'], ['предмет', 'subject'], ['для_telegram', 'tgName'], ['тип', 'type'], ['аудитория', 'room'], ['преподаватель', 'teacher'], ['источник_дата', 'srcDate'], ['источник_id', 'srcPairId'], ['дз', 'hw'], ['ссылки', 'links'], ['нет_дз', 'noHw'], ['отменена', 'cancelled'], ['версия', 'version'], ['кто', 'by'], ['обновлено', 'updatedAt']] },
  dayNotes: { name: 'Дни', cols: [['дата', 'date'], ['пометка', 'text'], ['кто', 'by'], ['обновлено', 'updatedAt']] },
  log:      { name: 'Журнал', cols: [['когда', 'at'], ['кто', 'by'], ['действие', 'action'], ['лист', 'sheet'], ['ключ', 'key'], ['было', 'before'], ['стало', 'after'], ['op_id', 'opId']] },
  settings: { name: 'Настройки', cols: [['ключ', 'key'], ['значение', 'value']] }
};
var SETTINGS_KEYS = [['опорная_неделя', 'anchorWeek'], ['опорная_половина', 'anchorHalf'], ['начало_семестра', 'semesterStart'], ['конец_семестра', 'semesterEnd'], ['завтра_после', 'tomorrowAfter']];

// Русские значения в таблице ↔ значения в коде сайта
var VALUES = {
  half: { 'верх': 'top', 'низ': 'bottom', 'обе': 'both' },
  type: { 'лекция': 'lecture', 'семинар': 'seminar', 'занятие': 'other' },
  field: { 'аудитория': 'room', 'начало': 'start', 'конец': 'end', 'преподаватель': 'teacher' }
};
var TIME_KEYS = { start: 1, end: 1 };
var NUMBER_KEYS = { day: 1, slots: 1, version: 1 };
var BOOL_KEYS = { noHw: 1, cancelled: 1 };

function invert_(map) { var out = {}; for (var k in map) out[map[k]] = k; return out; }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Значение ячейки → значение для сайта. Таблица может прислать Date, число или строку. */
function normCell_(v, key) {
  if (Object.prototype.toString.call(v) === '[object Date]') { // надёжнее instanceof
    if (TIME_KEYS[key]) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
    return Utilities.formatDate(v, TZ, key === 'updatedAt' || key === 'at' ? "yyyy-MM-dd'T'HH:mm:ssXXX" : 'yyyy-MM-dd');
  }
  if (BOOL_KEYS[key]) return v === true || /^(да|true|1)$/i.test(String(v).trim());
  if (NUMBER_KEYS[key]) return v === '' ? undefined : Number(v);
  var s = String(v == null ? '' : v).trim();
  if (key === 'links') return s ? s.split(/\s*\n\s*/).filter(Boolean) : [];
  if (TIME_KEYS[key] && /^\d:\d\d$/.test(s)) s = '0' + s; // «9:40» → «09:40»
  if (key === 'half') return VALUES.half[s] || s;
  if (key === 'type') return VALUES.type[s] || s;
  if (key === 'field') return VALUES.field[s] || s;
  return s;
}

/** Строки листа (первая — заголовки) → массив объектов. Пустые строки пропускаются. */
function rowsToObjects_(values, cols) {
  if (!values || values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var index = cols.map(function (c) { return [header.indexOf(c[0]), c[1]]; });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c == null; })) continue;
    var obj = {};
    index.forEach(function (pair) {
      if (pair[0] < 0) return;
      var val = normCell_(row[pair[0]], pair[1]);
      if (val !== '' && val !== undefined) obj[pair[1]] = val;
    });
    out.push(obj);
  }
  return out;
}

/** Собирает данные для сайта. read(name) возвращает значения листа — так функцию можно проверить без Google. */
function buildPayload_(read) {
  var p = {};
  ['template', 'rules', 'entries', 'extras', 'dayNotes'].forEach(function (k) { p[k] = rowsToObjects_(read(SHEETS[k].name), SHEETS[k].cols); });
  p.subjects = {};
  rowsToObjects_(read(SHEETS.subjects.name), SHEETS.subjects.cols).forEach(function (s) {
    p.subjects[s.subject] = { short: s.short, full: s.full, color: s.color };
  });
  var kv = {};
  rowsToObjects_(read(SHEETS.settings.name), SHEETS.settings.cols).forEach(function (r) { kv[r.key] = r.value; });
  p.settings = {};
  SETTINGS_KEYS.forEach(function (pair) {
    var v = kv[pair[0]];
    if (pair[1] === 'anchorHalf') v = VALUES.half[v] || v;
    if (v !== undefined) p.settings[pair[1]] = v;
  });
  p.entries.forEach(function (e) { if (!e.links) e.links = []; });
  p.extras.forEach(function (e) { if (!e.links) e.links = []; });
  return p;
}

function readSheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

/** GET-запрос сайта: отдаёт всё расписание одним JSON. */
function doGet() {
  var cache = CacheService.getScriptCache();
  var body = cache.get(CACHE_KEY);
  if (!body) {
    var lock = LockService.getScriptLock();
    var locked = lock.tryLock(10000);
    try {
      var payload = buildPayload_(readSheet_);
      payload.generatedAt = new Date().toISOString();
      body = JSON.stringify(payload);
      if (body.length < 90000) cache.put(CACHE_KEY, body, CACHE_SECONDS); // кэш хранит до 100 КБ на ключ
    } catch (err) {
      body = JSON.stringify({ error: 'Не удалось прочитать таблицу: ' + err.message });
    } finally {
      if (locked) lock.releaseLock();
    }
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// ---------- запись (редактор активистов) ----------

var CODES_PROP = 'CODES';          // Script Properties: {sha256(код): имя}
var FAIL_KEY = 'login-fails';
var LOCK_KEY = 'login-locked';
var MAX_FAILS = 10;                // 10 неверных кодов подряд …
var LOCK_SECONDS = 600;            // … — пауза 10 минут для всех (IP в Apps Script не виден)
var LIMITS = { hw: 5000, link: 500, links: 10, note: 200, notesPerDay: 10, opsPerRequest: 50 };
var ACTIVISTS = ['Активист 1', 'Активист 2', 'Еремей'];
var DATE_RE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Хеш кода: в настройках скрипта лежат только хеши, сами коды нигде не хранятся. */
function hashCode_(code) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'raspisanie-322:' + String(code || '').trim(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

/** Проверка одной операции. Возвращает текст ошибки или null. */
function validateOp_(op, pairIds) {
  if (!op || typeof op !== 'object') return 'пустая операция';
  if (typeof op.opId !== 'string' || !/^[\w-]{8,64}$/.test(op.opId)) return 'нет номера операции';
  if (typeof op.date !== 'string' || !DATE_RE.test(op.date)) return 'неверная дата';
  if (op.type === 'entry') {
    if (typeof op.pairId !== 'string' || !Object.prototype.hasOwnProperty.call(pairIds, op.pairId)) return 'такой пары нет в шаблоне';
    if (typeof op.baseVersion !== 'number' || op.baseVersion < 0) return 'нет версии';
    var p = op.patch;
    if (!p || typeof p !== 'object') return 'нет изменений';
    for (var k in p) if (['hw', 'links', 'noHw'].indexOf(k) < 0) return 'поле нельзя менять: ' + k;
    if ('hw' in p && (typeof p.hw !== 'string' || p.hw.length > LIMITS.hw)) return 'текст ДЗ длиннее 5000 знаков';
    if ('noHw' in p && typeof p.noHw !== 'boolean') return 'неверная отметка «ДЗ нет»';
    if ('links' in p) {
      if (!Array.isArray(p.links) || p.links.length > LIMITS.links) return 'не больше 10 ссылок';
      for (var i = 0; i < p.links.length; i++) {
        var u = p.links[i];
        if (typeof u !== 'string' || u.length > LIMITS.link || !/^https?:\/\/[^\s]+$/i.test(u)) return 'ссылка должна начинаться с http:// или https://';
      }
    }
    return null;
  }
  if (op.type === 'note.add' || op.type === 'note.remove') {
    if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > LIMITS.note) return 'пометка — от 1 до 200 знаков';
    return null;
  }
  return 'неизвестная операция';
}

/**
 * Применяет операции к данным (без Google — проверяется тестами).
 * state: {entries, dayNotes}; meta: {name, now};
 * seen(op) → прошлый результат, 'applied' (операция уже есть в журнале) или null.
 */
function processOps_(state, ops, pairIds, meta, seen) {
  var results = [], logs = [], thisBatch = {};
  ops.forEach(function (op) {
    var id = op && op.opId;
    var prev = (id && thisBatch[id]) || seen(op);
    if (prev === 'applied') prev = replayResult_(state, op); // результат давно забыт кэшем, но журнал помнит
    if (prev) { results.push(prev); return; } // повторная отправка той же операции — без дублей
    var err = validateOp_(op, pairIds);
    if (err) { results.push({ opId: op && op.opId, ok: false, error: 'invalid', message: err }); return; }
    if (op.type === 'entry') {
      var idx = -1;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].date === op.date && state.entries[i].pairId === op.pairId) { idx = i; break; }
      var row = idx >= 0 ? state.entries[idx] : null;
      var version = row ? (row.version || 0) : 0;
      if (op.baseVersion !== version) {
        results.push({ opId: op.opId, ok: false, error: 'conflict', current: row });
        return;
      }
      var before = row ? JSON.parse(JSON.stringify(row)) : null;
      var next = row ? JSON.parse(JSON.stringify(row)) : { date: op.date, pairId: op.pairId, links: [] };
      for (var k in op.patch) next[k] = op.patch[k];
      if (next.hw || (next.links && next.links.length)) next.noHw = false; // ДЗ вписано — отметка «нет» снимается
      next.version = version + 1; next.by = meta.name; next.updatedAt = meta.now;
      if (idx >= 0) state.entries[idx] = next; else state.entries.push(next);
      results.push(thisBatch[op.opId] = { opId: op.opId, ok: true, version: next.version, entry: next });
      logs.push({ at: meta.now, by: meta.name, action: 'ДЗ', sheet: SHEETS.entries.name, key: op.date + ' ' + op.pairId, before: before, after: next, opId: op.opId });
      return;
    }
    var notesOfDay = state.dayNotes.filter(function (n) { return n.date === op.date; });
    if (op.type === 'note.add') {
      var exists = notesOfDay.some(function (n) { return n.text === op.text.trim(); });
      if (!exists) {
        if (notesOfDay.length >= LIMITS.notesPerDay) { results.push({ opId: op.opId, ok: false, error: 'invalid', message: 'не больше 10 пометок в день' }); return; }
        state.dayNotes.push({ date: op.date, text: op.text.trim(), by: meta.name, updatedAt: meta.now });
      }
    } else {
      state.dayNotes = state.dayNotes.filter(function (n) { return !(n.date === op.date && n.text === op.text); });
    }
    results.push(thisBatch[op.opId] = { opId: op.opId, ok: true });
    logs.push({ at: meta.now, by: meta.name, action: op.type === 'note.add' ? 'пометка +' : 'пометка −', sheet: SHEETS.dayNotes.name, key: op.date, before: null, after: op.text, opId: op.opId });
  });
  return { state: state, results: results, logs: logs };
}

/** Ответ на повтор операции, которая уже применена (по журналу): текущее состояние строки. */
function replayResult_(state, op) {
  if (op.type !== 'entry') return { opId: op.opId, ok: true, replay: true };
  var row = null;
  for (var i = 0; i < state.entries.length; i++) if (state.entries[i].date === op.date && state.entries[i].pairId === op.pairId) row = state.entries[i];
  return row ? { opId: op.opId, ok: true, replay: true, version: row.version || 0, entry: row } : { opId: op.opId, ok: true, replay: true };
}

/**
 * Перезаписывает лист данными. Столбцы ищутся по заголовкам (владелец мог их переставить);
 * если заголовка нет — запись отменяется, чтобы не испортить данные. Сначала пишем, потом
 * очищаем «хвост» — пустого листа не бывает даже на мгновение.
 */
function writeObjects_(key, items) {
  var def = SHEETS[key];
  var sh = SpreadsheetApp.getActive().getSheetByName(def.name);
  var lastCol = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var pos = def.cols.map(function (c) { return header.indexOf(c[0]); });
  if (pos.some(function (p) { return p < 0; })) throw new Error('на листе «' + def.name + '» не хватает столбцов — запись отменена');
  var plain = objectsToRows_(items, def.cols);
  var rows = plain.map(function (r) { var row = new Array(lastCol).fill(''); pos.forEach(function (p, i) { row[p] = r[i]; }); return row; });
  var last = sh.getLastRow();
  if (rows.length) sh.getRange(2, 1, rows.length, lastCol).setNumberFormat('@').setValues(rows);
  if (last > rows.length + 1) sh.getRange(rows.length + 2, 1, last - rows.length - 1, lastCol).clearContent();
}

/** op_id из последних строк журнала — надёжная память «эта операция уже применена». */
function journalOpIds_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.log.name);
  var last = sh.getLastRow();
  var ids = {};
  if (last < 2) return ids;
  var col = SHEETS.log.cols.length; // op_id — последний столбец журнала
  var from = Math.max(2, last - 3000);
  sh.getRange(from, col, last - from + 1, 1).getValues().forEach(function (r) { if (r[0]) ids[String(r[0])] = true; });
  return ids;
}

function handleRequest_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // всё по очереди: и проверка кода со счётчиком ошибок, и запись
  try { return handleLocked_(req); } finally { lock.releaseLock(); }
}

function handleLocked_(req) {
  var cache = CacheService.getScriptCache();
  if (cache.get(LOCK_KEY)) return { ok: false, error: 'locked', message: 'Слишком много неверных попыток. Попробуйте через 10 минут или напишите Еремею.' };
  var codes = JSON.parse(PropertiesService.getScriptProperties().getProperty(CODES_PROP) || '{}');
  var name = codes[hashCode_(req && req.code)];
  if (!name) {
    var fails = Number(cache.get(FAIL_KEY) || 0) + 1;
    if (fails >= MAX_FAILS) { cache.put(LOCK_KEY, '1', LOCK_SECONDS); cache.remove(FAIL_KEY); }
    else cache.put(FAIL_KEY, String(fails), LOCK_SECONDS);
    return { ok: false, error: 'bad-code', message: 'Код не подошёл. Проверьте цифры.' };
  }
  if (req.action === 'login') return { ok: true, name: name };
  var ops = Array.isArray(req.ops) ? req.ops.slice(0, LIMITS.opsPerRequest) : [];
  {
    var pairIds = Object.create(null);
    rowsToObjects_(readSheet_(SHEETS.template.name), SHEETS.template.cols).forEach(function (t) { pairIds[t.id] = true; });
    var state = {
      entries: rowsToObjects_(readSheet_(SHEETS.entries.name), SHEETS.entries.cols),
      dayNotes: rowsToObjects_(readSheet_(SHEETS.dayNotes.name), SHEETS.dayNotes.cols)
    };
    var meta = { name: name, now: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX") };
    var journal = null; // читаем журнал, только если кэш не помнит операцию
    var seen = function (op) {
      var id = op && op.opId;
      if (!id) return null;
      var v = cache.get('op:' + id);
      if (v) return JSON.parse(v);
      if (!journal) journal = journalOpIds_();
      return journal[id] ? 'applied' : null;
    };
    var out = processOps_(state, ops, pairIds, meta, seen);
    if (out.logs.length) {
      writeObjects_('entries', out.state.entries);
      writeObjects_('dayNotes', out.state.dayNotes);
      var logSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.log.name);
      out.logs.forEach(function (l) {
        logSheet.appendRow([l.at, l.by, l.action, l.sheet, l.key, JSON.stringify(l.before), JSON.stringify(l.after), l.opId]);
      });
      cache.remove(CACHE_KEY);
    }
    out.results.forEach(function (r) { if (r.ok && r.opId) cache.put('op:' + r.opId, JSON.stringify(r), 21600); });
    return { ok: true, name: name, results: out.results };
  }
}

/** POST-запрос редактора. Тело — JSON как text/plain (так браузер не делает лишний предварительный запрос). */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad-request', message: 'Не удалось разобрать запрос.' }); }
  try { return json_(handleRequest_(req)); }
  catch (err) { return json_({ ok: false, error: 'server', message: 'Сервер занят или произошла ошибка. Изменение сохранено на телефоне и будет отправлено позже.' }); }
}

/** 6 цифр из случайного UUID (Utilities.getUuid надёжнее Math.random). */
function randomCode_() {
  return String(100000 + parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000);
}

/** Временный код «Проверка» для тестов редактора; удаляется removeTestCode(). */
function createTestCode() {
  var props = PropertiesService.getScriptProperties();
  var codes = JSON.parse(props.getProperty(CODES_PROP) || '{}');
  var code = randomCode_();
  codes[hashCode_(code)] = 'Проверка';
  props.setProperty(CODES_PROP, JSON.stringify(codes));
  Logger.log('Тестовый код: ' + code);
}
function removeTestCode() {
  var props = PropertiesService.getScriptProperties();
  var codes = JSON.parse(props.getProperty(CODES_PROP) || '{}');
  Object.keys(codes).forEach(function (h) { if (codes[h] === 'Проверка') delete codes[h]; });
  props.setProperty(CODES_PROP, JSON.stringify(codes));
  Logger.log('Тестовый код удалён');
}

/** Владелец запускает вручную: выдаёт новые коды активистам (старые перестают работать) и пишет их в журнал выполнения. */
function createActivistCodes() {
  var codes = {}, lines = [];
  ACTIVISTS.forEach(function (name) {
    var code = randomCode_();
    codes[hashCode_(code)] = name;
    lines.push(name + ': ' + code);
  });
  PropertiesService.getScriptProperties().setProperty(CODES_PROP, JSON.stringify(codes));
  Logger.log('Новые коды (передайте лично, старые больше не действуют):\n' + lines.join('\n'));
}

// ---------- первое заполнение таблицы ----------

function objectsToRows_(items, cols) {
  var back = { half: invert_(VALUES.half), type: invert_(VALUES.type), field: invert_(VALUES.field) };
  return items.map(function (o) {
    return cols.map(function (c) {
      var v = o[c[1]];
      if (v == null) return '';
      if (back[c[1]] && back[c[1]][v]) return back[c[1]][v];
      if (c[1] === 'links') return v.join('\n');
      if (BOOL_KEYS[c[1]]) return v ? 'да' : '';
      return String(v);
    });
  });
}

/** Создаёт листы и заполняет пустые данными из SEED. Запускать вручную один раз; повторный запуск ничего не стирает. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var seed = SEED;
  var fill = {
    template: seed.template,
    subjects: Object.keys(seed.subjects).map(function (k) { var s = seed.subjects[k]; return { subject: k, short: s.short, full: s.full, color: s.color }; }),
    rules: seed.rules, entries: seed.entries, extras: [], dayNotes: seed.dayNotes, log: [],
    settings: SETTINGS_KEYS.map(function (pair) {
      var v = seed.settings[pair[1]];
      if (pair[1] === 'anchorHalf') v = invert_(VALUES.half)[v];
      return { key: pair[0], value: v };
    })
  };
  Object.keys(SHEETS).forEach(function (k) {
    var def = SHEETS[k];
    var sh = ss.getSheetByName(def.name) || ss.insertSheet(def.name);
    var width = def.cols.length;
    sh.getRange(1, 1, TEXT_ROWS, width).setNumberFormat('@');
    sh.getRange(1, 1, 1, width).setValues([def.cols.map(function (c) { return c[0]; })]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (sh.getLastRow() < 2 && fill[k].length) {
      sh.getRange(2, 1, fill[k].length, width).setValues(objectsToRows_(fill[k], def.cols));
    }
    sh.autoResizeColumns(1, width);
  });
  var first = ss.getSheets()[0];
  if (first.getName() === 'Лист1' || first.getName() === 'Sheet1') { if (first.getLastRow() === 0) ss.deleteSheet(first); }
  CacheService.getScriptCache().remove(CACHE_KEY);
}
