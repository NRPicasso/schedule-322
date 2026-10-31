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
    try {
      var payload = buildPayload_(readSheet_);
      payload.generatedAt = new Date().toISOString();
      body = JSON.stringify(payload);
      if (body.length < 90000) cache.put(CACHE_KEY, body, CACHE_SECONDS); // кэш хранит до 100 КБ на ключ
    } catch (err) {
      body = JSON.stringify({ error: 'Не удалось прочитать таблицу: ' + err.message });
    }
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
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
