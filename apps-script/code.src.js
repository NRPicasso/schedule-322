/**
 * Бэкенд «Расписания 322» — Google Apps Script, привязанный к таблице.
 * Этот файл — исходник; apps-script/Code.gs собирается из него командой
 * «node tools/build-gs.mjs» (добавляются данные для первого заполнения таблицы).
 *
 * @OnlyCurrentDoc  — скрипт видит только эту таблицу, а не весь Google Диск.
 */
var TZ = 'Europe/Moscow';
var CACHE_KEY = 'payload-v2';  // v2: в ответе больше нет имён активистов (старый ответ из кэша сразу не годится)
var CACHE_SECONDS = 60; // правка ячейки руками видна на сайте не позже чем через минуту
var CACHE_CHUNK = 30000; // символов в одном куске кэша: даже 3 байта на символ — 90 КБ < лимита 100 КБ на значение
var CACHE_MAX_CHUNKS = 30;
var TEXT_ROWS = 2000;   // сколько строк заранее делаем «текстовыми», чтобы Таблица не превращала 15:00 и 2026-10-27 в даты

// Листы: [заголовок столбца по-русски, ключ в данных сайта]
var SHEETS = {
  template: { name: 'Шаблон', cols: [['id', 'id'], ['неделя', 'half'], ['день', 'day'], ['начало', 'start'], ['конец', 'end'], ['слотов', 'slots'], ['предмет', 'subject'], ['для_telegram', 'tgName'], ['тип', 'type'], ['аудитория', 'room'], ['преподаватель', 'teacher'], ['пометка', 'note'], ['версия_шаблона', 'versionId']] },
  versions: { name: 'Версии', cols: [['id', 'id'], ['с_даты', 'from'], ['опорная_неделя', 'anchorWeek'], ['опорная_половина', 'anchorHalf'], ['начало_семестра', 'semesterStart'], ['конец_семестра', 'semesterEnd'], ['версия', 'version'], ['кто', 'by'], ['обновлено', 'updatedAt']] },
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
  if (key === 'half' || key === 'anchorHalf') return VALUES.half[s] || s;
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

// ---------- версии шаблона (v0.2) ----------
// Шаблон хранится версиями «с даты»: лист «Версии» (даты, опорная неделя) + столбец «версия_шаблона»
// в «Шаблоне». До перехода (migrateV2) листа «Версии» нет — тогда одна версия из «Настроек».

/** Версия, действующая в дату iso (до первой версии — первая). versions отсортированы по from. */
function versionAt_(versions, iso) {
  var cur = versions[0];
  versions.forEach(function (v) { if (v.from <= iso) cur = v; });
  return cur;
}
var byFrom_ = function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; };

/** Версии с парами из строк листов. kv — «Настройки» (для одной версии до перехода). */
function versionsFrom_(tplRows, verRows, kv) {
  var list = verRows.map(function (v) { var o = copy_(v); o.pairs = []; return o; }).sort(byFrom_);
  if (!list.length) {
    list = [{ id: 'V1', from: kv['начало_семестра'] || kv['опорная_неделя'] || '2000-01-01', anchorWeek: kv['опорная_неделя'],
      anchorHalf: VALUES.half[kv['опорная_половина']] || kv['опорная_половина'], semesterStart: kv['начало_семестра'], semesterEnd: kv['конец_семестра'], version: 0, pairs: [] }];
  }
  var byId = Object.create(null);
  list.forEach(function (v) { byId[v.id] = v; });
  tplRows.forEach(function (t) {
    // строка без версии (так было до перехода) — первая версия; строка с неизвестной версией
    // (версию удалили руками или запись оборвалась на середине) пропускается, а не попадает в V1
    var v = t.versionId ? byId[t.versionId] : list[0];
    if (!v || !has_(byId, v.id)) return;
    var pair = copy_(t); delete pair.versionId;
    v.pairs.push(pair);
  });
  return list;
}

/** Собирает данные для сайта. read(name) возвращает значения листа — так функцию можно проверить без Google. */
function buildPayload_(read, today) {
  var p = {};
  ['rules', 'entries', 'extras', 'dayNotes'].forEach(function (k) { p[k] = rowsToObjects_(read(SHEETS[k].name), SHEETS[k].cols); });
  p.subjects = {};
  rowsToObjects_(read(SHEETS.subjects.name), SHEETS.subjects.cols).forEach(function (s) {
    if (!s.subject || RESERVED_NAMES[s.subject]) return; // «__proto__» и т. п. не могут быть ключом
    p.subjects[s.subject] = { short: s.short, full: s.full, color: s.color };
  });
  var kv = {};
  rowsToObjects_(read(SHEETS.settings.name), SHEETS.settings.cols).forEach(function (r) { kv[r.key] = r.value; });
  p.versions = versionsFrom_(rowsToObjects_(read(SHEETS.template.name), SHEETS.template.cols), rowsToObjects_(read(SHEETS.versions.name), SHEETS.versions.cols), kv);
  // Для открытых у кого-то старых версий сайта: шаблон и «настройки» версии, действующей сегодня.
  var cur = versionAt_(p.versions, today || Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  p.template = cur.pairs;
  p.settings = {};
  ['anchorWeek', 'anchorHalf', 'semesterStart', 'semesterEnd'].forEach(function (k) { if (cur[k] !== undefined) p.settings[k] = cur[k]; });
  if (kv['завтра_после'] !== undefined) p.settings.tomorrowAfter = kv['завтра_после'];
  p.entries.forEach(function (e) { if (!e.links) e.links = []; });
  p.extras.forEach(function (e) { if (!e.links) e.links = []; });
  return publicData_(p);
}

// ---------- имена активистов не уходят с сервера ----------
// Кто правил — видно только в таблице (столбцы «кто» и журнал). Сайт открыт всем по ссылке,
// поэтому из данных и из ответов на правки поле by убирается.
function withoutName_(row) {
  if (!row || typeof row !== 'object') return row;
  var out = {};
  for (var k in row) if (k !== 'by') out[k] = row[k];
  return out;
}
/** Данные для сайта без имён (правила, записи, доп. пары, пометки). */
function publicData_(p) {
  ['rules', 'entries', 'extras', 'dayNotes', 'versions'].forEach(function (k) { if (p[k]) p[k] = p[k].map(withoutName_); });
  return p;
}
/** Ответ на операцию без имён: строка после правки и «вариант другого» в конфликте. */
function publicResult_(r) {
  if (!r || typeof r !== 'object') return r;
  var out = {};
  for (var k in r) out[k] = (k === 'entry' || k === 'extra' || k === 'rule' || k === 'current' || k === 'tplVersion' || k === 'subject') ? withoutName_(r[k]) : r[k];
  return out;
}

// ---------- кэш ответа по кускам ----------
// У CacheService лимит 100 КБ на значение (в байтах; русская буква — 2 байта). Большой ответ
// кладём кусками, а любая ошибка кэша не должна ломать сам ответ сайту.
function cachePut_(cache, body) {
  try {
    // поколение в ключах: читатель не склеит куски двух разных ответов
    var gen = String(Date.now()) + Math.floor(Math.random() * 1000);
    var parts = {}, n = 0, pos = 0;
    while (pos < body.length) {
      var end = Math.min(pos + CACHE_CHUNK, body.length);
      var c = body.charCodeAt(end - 1);
      if (end < body.length && c >= 0xD800 && c <= 0xDBFF) end -= 1; // не разрезать эмодзи (суррогатную пару) между кусками
      parts[CACHE_KEY + ':' + gen + ':' + n] = body.slice(pos, end);
      pos = end; n++;
      if (n > CACHE_MAX_CHUNKS) return false;
    }
    if (!n) return false;
    parts[CACHE_KEY] = n + '|' + gen; // сколько кусков и какого поколения; удалить этот ключ = сбросить кэш
    cache.putAll(parts, CACHE_SECONDS);
    return true;
  } catch (err) {
    return false;
  }
}
function cacheGet_(cache) {
  try {
    var head = String(cache.get(CACHE_KEY) || '').split('|');
    var n = Number(head[0]), gen = head[1];
    if (!n || !gen) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(CACHE_KEY + ':' + gen + ':' + i);
    var got = cache.getAll(keys);
    var body = '';
    for (var j = 0; j < keys.length; j++) {
      if (typeof got[keys[j]] !== 'string') return null; // кусок успел пропасть — читаем таблицу заново
      body += got[keys[j]];
    }
    return body;
  } catch (err) {
    return null;
  }
}

function readSheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

/** GET-запрос сайта: отдаёт всё расписание одним JSON. */
function doGet() {
  var cache = CacheService.getScriptCache();
  var body = cacheGet_(cache);
  if (!body) {
    var lock = LockService.getScriptLock();
    var locked = lock.tryLock(10000);
    try {
      var payload = buildPayload_(readSheet_);
      payload.generatedAt = new Date().toISOString();
      body = JSON.stringify(payload);
      cachePut_(cache, body);
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
var MAX_FAILS = 10;                // 10 неверных кодов …
var LOCK_SECONDS = 600;            // … — пауза для всех (IP в Apps Script не виден): 10 минут,
var LOCK_MAX_SECONDS = 21600;      // при повторах — 20, 40, 80 … минут, но не больше 6 часов
var LOCK_LEVEL_PROP = 'LOCK_LEVEL'; // Script Properties: {n: номер паузы подряд, at: когда началась}
var DAY_MS = 86400000;
var LIMITS = { hw: 5000, link: 500, links: 10, note: 200, notesPerDay: 10, opsPerRequest: 50 };
var DATE_RE = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Хеш кода: в настройках скрипта лежат только хеши, сами коды нигде не хранятся. */
function hashCode_(code) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'raspisanie-322:' + String(code || '').trim(), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var OVERRIDE_FIELDS = { room: 30, start: 0, end: 0, teacher: 60 }; // поля, которые меняет замена (0 — время)
var EXTRA_TYPES = { lecture: 1, seminar: 1, other: 1 };

function str_(v, max) { return typeof v === 'string' && v.length <= max; }
function validLinks_(links) {
  if (!Array.isArray(links) || links.length > LIMITS.links) return 'не больше 10 ссылок';
  for (var i = 0; i < links.length; i++) {
    var u = links[i];
    if (typeof u !== 'string' || u.length > LIMITS.link || !/^https?:\/\/[^\s]+$/i.test(u)) return 'ссылка должна начинаться с http:// или https://';
  }
  return null;
}
/** Проверка полей ДЗ и замен в patch. allowed — какие ключи можно. */
function validPatch_(p, allowed) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'нет изменений';
  for (var k in p) if (allowed.indexOf(k) < 0) return 'поле нельзя менять: ' + k;
  if ('hw' in p && !str_(p.hw, LIMITS.hw)) return 'текст ДЗ длиннее 5000 знаков';
  if ('noHw' in p && typeof p.noHw !== 'boolean') return 'неверная отметка «ДЗ нет»';
  if ('cancelled' in p && typeof p.cancelled !== 'boolean') return 'неверная отметка отмены';
  if ('reason' in p && !str_(p.reason, LIMITS.note)) return 'причина — до 200 знаков';
  if ('links' in p) { var e = validLinks_(p.links); if (e) return e; }
  if ('room' in p && !str_(p.room, 30)) return 'аудитория — до 30 знаков';
  if ('teacher' in p && !str_(p.teacher, 60)) return 'преподаватель — до 60 знаков';
  if ('start' in p && !(p.start === '' || TIME_RE.test(p.start))) return 'время — в формате ЧЧ:ММ';
  if ('end' in p && !(p.end === '' || TIME_RE.test(p.end))) return 'время — в формате ЧЧ:ММ';
  if ('date' in p && !(typeof p.date === 'string' && DATE_RE.test(p.date))) return 'неверная дата';
  return null;
}
var has_ = function (obj, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key); };

// Цвета плиток предметов — те же, что в style.css (.t-mun … .t-fk): контраст проверен.
// Имена, которые нельзя делать ключами объектов (иначе «предмет» совпадёт со служебным свойством JS)
var OWNED_SHEETS = { template: 1, subjects: 1 }; // листы, которые сервер переписывает целиком при правке шаблона
var RESERVED_NAMES = { '__proto__': 1, 'constructor': 1, 'prototype': 1, 'toString': 1, 'valueOf': 1, 'hasOwnProperty': 1 };
var COLORS = { mun: 1, gpp: 1, upp: 1, up: 1, gp: 1, tp: 1, osd: 1, mp: 1, fk: 1 };
var PAIR_HALVES = { top: 1, bottom: 1, both: 1 };
var MAX_VERSIONS = 20, MAX_PAIRS = 60;

/** Проверка одной пары версии шаблона. */
function validPair_(t) {
  if (!t || typeof t !== 'object') return 'пустая пара';
  if (typeof t.id !== 'string' || !/^[\w-]{1,40}$/.test(t.id)) return 'неверный номер пары';
  if (!has_(PAIR_HALVES, t.half)) return 'неделя пары — верхняя, нижняя или обе';
  if (typeof t.day !== 'number' || t.day < 1 || t.day > 6 || t.day % 1) return 'день пары — с понедельника по субботу';
  if (!TIME_RE.test(t.start) || !TIME_RE.test(t.end) || t.end <= t.start) return 'время пары: конец позже начала, в формате ЧЧ:ММ';
  if (t.slots != null && t.slots !== '' && t.slots !== 1 && t.slots !== 2) return 'пара обычная или сдвоенная'; // пусто = обычная
  if (!str_(t.subject, 100) || !t.subject.trim()) return 'у пары не указан предмет';
  if (!has_(EXTRA_TYPES, t.type)) return 'неверный тип занятия';
  if (t.tgName != null && !str_(t.tgName, 100)) return 'название для Telegram — до 100 знаков';
  if (!str_(t.room || '', 30)) return 'аудитория — до 30 знаков';
  if (!str_(t.teacher || '', 60)) return 'преподаватель — до 60 знаков';
  if (!str_(t.note || '', LIMITS.note)) return 'пометка пары — до 200 знаков';
  return null;
}
/** Проверка версии шаблона целиком (без сравнения с другими версиями — это в processOps_). */
function validVersion_(v) {
  if (!v || typeof v !== 'object') return 'нет данных версии';
  if (typeof v.id !== 'string' || !/^V[\w-]{0,40}$/.test(v.id)) return 'неверный номер версии';
  if (typeof v.from !== 'string' || !DATE_RE.test(v.from)) return 'неверная дата начала версии';
  if (typeof v.anchorWeek !== 'string' || !DATE_RE.test(v.anchorWeek) || new Date(v.anchorWeek + 'T12:00:00Z').getUTCDay() !== 1) return 'опорная неделя — дата понедельника';
  if (v.anchorHalf !== 'top' && v.anchorHalf !== 'bottom') return 'опорная неделя — верхняя или нижняя';
  if (!DATE_RE.test(v.semesterStart || '') || !DATE_RE.test(v.semesterEnd || '') || v.semesterEnd < v.semesterStart) return 'даты семестра: конец не раньше начала';
  if (!Array.isArray(v.pairs) || !v.pairs.length || v.pairs.length > MAX_PAIRS) return 'в версии от 1 до ' + MAX_PAIRS + ' пар';
  var ids = {};
  for (var i = 0; i < v.pairs.length; i++) {
    var e = validPair_(v.pairs[i]);
    if (e) return e + ' (пара ' + (i + 1) + ')';
    if (ids[v.pairs[i].id]) return 'две пары с одним номером';
    ids[v.pairs[i].id] = true;
  }
  return null;
}

/**
 * Проверка одной операции. Возвращает текст ошибки или null.
 * pairAt(id, date) — пара шаблона, действующая в эту дату (или null). Для старых тестов можно
 * передать объект {id: день недели} — тогда пара ищется без учёта даты.
 */
function validateOp_(op, pairIds) {
  var pairAt = typeof pairIds === 'function' ? pairIds : function (id) { return has_(pairIds, id) ? { day: pairIds[id] } : null; };
  if (!op || typeof op !== 'object') return 'пустая операция';
  if (typeof op.opId !== 'string' || !/^[\w-]{8,64}$/.test(op.opId)) return 'нет номера операции';
  if (typeof op.date !== 'string' || !DATE_RE.test(op.date)) return 'неверная дата';
  switch (op.type) {
    case 'entry':
      if (typeof op.pairId !== 'string' || !pairAt(op.pairId, op.date)) return 'такой пары нет в шаблоне на эту дату';
      if (typeof op.baseVersion !== 'number' || op.baseVersion < 0) return 'нет версии';
      return validPatch_(op.patch, ['hw', 'links', 'noHw', 'room', 'start', 'end', 'teacher', 'cancelled', 'reason']);
    case 'note.add': case 'note.remove':
      if (typeof op.text !== 'string' || !op.text.trim() || op.text.length > LIMITS.note) return 'пометка — от 1 до 200 знаков';
      return null;
    case 'rule.set': case 'rule.remove':
      if (typeof op.pairId !== 'string' || !pairAt(op.pairId, op.date)) return 'такой пары нет в шаблоне на эту дату';
      if (!has_(OVERRIDE_FIELDS, op.field)) return 'это поле нельзя менять правилом';
      if (op.type === 'rule.remove') return null;
      if (op.to != null && op.to !== '' && !(typeof op.to === 'string' && DATE_RE.test(op.to) && op.to >= op.date)) return 'дата окончания должна быть не раньше начала';
      if (op.field === 'start' || op.field === 'end') return TIME_RE.test(op.value) ? null : 'время — в формате ЧЧ:ММ';
      return str_(op.value, OVERRIDE_FIELDS[op.field]) && op.value.trim() ? null : 'значение пустое или слишком длинное';
    case 'extra.add': {
      var x = op.extra;
      if (!x || typeof x !== 'object') return 'нет данных пары';
      if (typeof x.id !== 'string' || !/^X-[\w-]{6,64}$/.test(x.id)) return 'неверный номер пары';
      if (x.date !== op.date) return 'неверная дата';
      if (!TIME_RE.test(x.start) || !TIME_RE.test(x.end) || x.end <= x.start) return 'время окончания должно быть позже начала';
      if (x.srcPairId != null && x.srcPairId !== '') {
        if (typeof x.srcPairId !== 'string' || typeof x.srcDate !== 'string' || !DATE_RE.test(x.srcDate)) return 'неверная исходная пара переноса';
        var src = pairAt(x.srcPairId, x.srcDate);
        if (!src) return 'неверная исходная пара переноса';
        // день недели пары шаблона (0 — вс … 6 — сб): перенести можно только пару, которая в этот день стоит
        var wd = src.day;
        if (typeof wd === 'number' && wd === wd && new Date(x.srcDate + 'T12:00:00Z').getUTCDay() !== wd) return 'этой пары нет в исходный день';
        if (x.subject != null && !str_(x.subject, 100)) return 'название предмета — до 100 знаков';
      } else if (!str_(x.subject, 100) || !x.subject.trim()) return 'укажите название предмета';
      if (x.type != null && x.type !== '' && !has_(EXTRA_TYPES, x.type)) return 'неверный тип занятия';
      if (x.slots != null && x.slots !== 1 && x.slots !== 2) return 'неверное число пар';
      var err = validPatch_({ room: x.room || '', teacher: x.teacher || '', hw: x.hw || '', links: x.links || [], noHw: x.noHw === undefined ? false : x.noHw }, ['room', 'teacher', 'hw', 'links', 'noHw']);
      if (err) return err;
      return x.tgName == null || str_(x.tgName, 100) ? null : 'название для Telegram — до 100 знаков';
    }
    case 'extra.update':
      if (typeof op.id !== 'string') return 'неверный номер пары';
      if (typeof op.baseVersion !== 'number' || op.baseVersion < 0) return 'нет версии';
      return validPatch_(op.patch, ['date', 'start', 'end', 'room', 'teacher', 'hw', 'links', 'noHw']);
    case 'extra.remove':
      return typeof op.id === 'string' ? null : 'неверный номер пары';
    case 'version.save': {
      var ve = validVersion_(op.tplVersion);
      if (ve) return ve;
      if (op.tplVersion.from !== op.date) return 'неверная дата';
      if (op.moves != null) {
        if (!Array.isArray(op.moves) || op.moves.length > 100) return 'неверный список переносов';
        for (var mi = 0; mi < op.moves.length; mi++) {
          var mv = op.moves[mi];
          if (!mv || typeof mv.pairId !== 'string' || !DATE_RE.test(mv.date || '') || !DATE_RE.test(mv.to || '')) return 'неверный перенос записи';
        }
      }
      return typeof op.baseVersion === 'number' && op.baseVersion >= 0 ? null : 'нет версии';
    }
    case 'version.remove':
      if (typeof op.id !== 'string' || !/^V[\w-]{0,40}$/.test(op.id)) return 'неверный номер версии';
      return typeof op.baseVersion === 'number' && op.baseVersion >= 0 ? null : 'нет версии';
    case 'subject.remove':
      if (typeof op.name !== 'string' || !op.name.trim() || op.name.length > 100) return 'нет названия предмета';
      return op.prev && typeof op.prev === 'object' ? null : 'нет прежних данных предмета';
    case 'subject.set': {
      var sj = op.subject;
      if (!sj || typeof sj !== 'object' || !str_(sj.subject, 100) || !sj.subject.trim()) return 'нет названия предмета';
      if (has_(RESERVED_NAMES, sj.subject.trim())) return 'такое название предмета нельзя';
      if (!str_(sj.short, 6) || !sj.short.trim()) return 'сокращение предмета — от 1 до 6 знаков';
      if (!str_(sj.full || '', 100)) return 'полное название — до 100 знаков';
      return has_(COLORS, sj.color) ? null : 'цвет — из готовой палитры';
    }
  }
  return 'неизвестная операция';
}

function findIndex_(list, pred) { for (var i = 0; i < list.length; i++) if (pred(list[i])) return i; return -1; }
function copy_(x) { return x == null ? null : JSON.parse(JSON.stringify(x)); }

/**
 * Применяет операции к данным (без Google — проверяется тестами).
 * state: {entries, dayNotes, rules, extras, versions?, subjects?, versionsReady?}; meta: {name, now, today};
 * seen(op) → прошлый результат, 'applied' (операция уже есть в журнале) или null.
 * Если в state есть версии шаблона, пары проверяются по версии на дату операции; иначе — по pairIds.
 */
function processOps_(state, ops, pairIds, meta, seen) {
  state.rules = state.rules || []; state.extras = state.extras || [];
  var pairAt = state.versions ? function (id, date) {
    var v = versionAt_(state.versions, date);                       // state.versions меняется внутри пачки — читаем каждый раз
    for (var i = 0; i < v.pairs.length; i++) if (v.pairs[i].id === id) return v.pairs[i];
    return null;
  } : pairIds;
  var results = [], logs = [], thisBatch = {};
  var done = function (op, result, action, sheet, key, before, after) {
    results.push(thisBatch[op.opId] = result);
    if (action) logs.push({ at: meta.now, by: meta.name, action: action, sheet: sheet, key: key, before: before, after: after, opId: op.opId });
  };
  var fail = function (op, error, message, extra) { var r = { opId: op && op.opId, ok: false, error: error, message: message }; if (extra) for (var k in extra) r[k] = extra[k]; results.push(r); };

  // ---- шаблон и предметы (v0.2): правка только версии, которая ещё не началась ----
  var templateOp_ = function (op) {
    if (!state.versionsReady || !state.versions) { fail(op, 'invalid', 'таблица ещё не переведена на версии шаблона — напишите Еремею'); return; }
    if (!meta.today) { fail(op, 'invalid', 'нет текущей даты'); return; }
    if (op.type === 'subject.set' || op.type === 'subject.remove') {
      var list = state.subjects = state.subjects || [];
      var key = op.type === 'subject.set' ? op.subject.subject.trim() : op.name.trim();
      var si = findIndex_(list, function (x) { return x.subject === key; });
      var prevS = si >= 0 ? copy_(list[si]) : null;
      // «что было на экране» не совпало с таблицей — другой активист успел поменять предмет
      // (или добавил предмет с тем же названием: новый предмет приходит без prev)
      var same = function (a, b) { return a.short === b.short && (a.full || '') === (b.full || '') && a.color === b.color; };
      if (prevS && (!op.prev || !same(prevS, op.prev))) { fail(op, 'conflict', '', { current: prevS }); return; }
      if (!prevS && op.prev) { fail(op, 'conflict', '', { current: null }); return; }        // предмет успели удалить
      if (op.type === 'subject.remove') {
        if (!prevS) { done(op, { opId: op.opId, ok: true }); return; }
        var used = state.versions.some(function (v) { return v.pairs.some(function (t) { return t.subject === key; }); });
        if (used) { fail(op, 'invalid', 'предмет есть в шаблоне — сначала уберите его из пар'); return; }
        list.splice(si, 1);
        done(op, { opId: op.opId, ok: true }, 'предмет −', SHEETS.subjects.name, key, prevS, null);
        return;
      }
      var sj = op.subject;
      var nextS = { subject: sj.subject.trim(), short: sj.short.trim(), full: (sj.full || '').trim(), color: sj.color };
      if (si >= 0) list[si] = nextS; else list.push(nextS);
      done(op, { opId: op.opId, ok: true, subject: nextS }, 'предмет', SHEETS.subjects.name, nextS.subject, prevS, nextS);
      return;
    }
    var id = op.type === 'version.save' ? op.tplVersion.id : op.id;
    var vi = findIndex_(state.versions, function (v) { return v.id === id; });
    var cur = vi >= 0 ? state.versions[vi] : null;
    if (op.type === 'version.remove' && !cur) { done(op, { opId: op.opId, ok: true }); return; }  // уже удалена
    if (cur && cur.from <= meta.today) { fail(op, 'invalid', 'эта версия шаблона уже действует — сделайте новую с завтрашнего дня'); return; }
    if ((cur ? cur.version || 0 : 0) !== op.baseVersion) { fail(op, 'conflict', '', { current: cur }); return; }
    if (op.type === 'version.remove') {
      if (state.versions.length < 2) { fail(op, 'invalid', 'нельзя удалить единственную версию шаблона'); return; }
      state.versions.splice(vi, 1);
      done(op, { opId: op.opId, ok: true }, 'версия шаблона −', SHEETS.versions.name, cur.id + ' с ' + cur.from, cur, null);
      return;
    }
    var v = op.tplVersion;
    if (v.from <= meta.today) { fail(op, 'invalid', 'новая версия шаблона — не раньше завтрашнего дня'); return; }
    if (state.versions.some(function (x) { return x.id !== v.id && x.from === v.from; })) { fail(op, 'invalid', 'с этой даты уже есть версия шаблона'); return; }
    if (!cur && state.versions.length >= MAX_VERSIONS) { fail(op, 'invalid', 'не больше ' + MAX_VERSIONS + ' версий шаблона'); return; }
    if (state.subjects) {
      var known = Object.create(null);
      state.subjects.forEach(function (x) { known[x.subject] = true; });
      var unknown = v.pairs.filter(function (t) { return known[t.subject.trim()] !== true || has_(RESERVED_NAMES, t.subject.trim()); })[0];
      if (unknown) { fail(op, 'invalid', 'нет такого предмета: ' + unknown.subject + ' — сначала добавьте его в список предметов'); return; }
    }
    var KEEP = ['id', 'half', 'day', 'start', 'end', 'slots', 'subject', 'tgName', 'type', 'room', 'teacher', 'note'];
    var doc = { id: v.id, from: v.from, anchorWeek: v.anchorWeek, anchorHalf: v.anchorHalf, semesterStart: v.semesterStart, semesterEnd: v.semesterEnd,
      version: (cur ? cur.version || 0 : 0) + 1, by: meta.name, updatedAt: meta.now,
      pairs: v.pairs.map(function (t) {
        var o = {};
        KEEP.forEach(function (k) { if (t[k] !== undefined && t[k] !== null && t[k] !== '') o[k] = typeof t[k] === 'string' ? t[k].trim() : t[k]; });
        o.slots = o.slots || 1;
        return o;
      }) };
    if (vi >= 0) state.versions[vi] = doc; else state.versions.push(doc);
    state.versions.sort(byFrom_);
    done(op, { opId: op.opId, ok: true, version: doc.version, tplVersion: doc }, cur ? 'версия шаблона' : 'версия шаблона +', SHEETS.versions.name, doc.id + ' с ' + doc.from, copy_(cur), doc);
    (op.moves || []).forEach(function (m) { moveEntry_(m, op); });
  };

  // ДЗ, ссылки и «ДЗ нет» записи (дата, пара) → та же пара в другой день (при смене дня пары в версии).
  // Если там уже что-то вписано — подпись добавляется строкой ниже, ссылки — без повторов.
  var moveEntry_ = function (m, op) {
    var si = findIndex_(state.entries, function (e) { return e.date === m.date && e.pairId === m.pairId; });
    if (si < 0) return;
    var src = state.entries[si];
    if (!src.hw && !(src.links && src.links.length) && !src.noHw) return;
    var ti = findIndex_(state.entries, function (e) { return e.date === m.to && e.pairId === m.pairId; });
    var oldT = ti >= 0 ? copy_(state.entries[ti]) : null;
    var t = oldT ? copy_(oldT) : { date: m.to, pairId: m.pairId, links: [], version: 0 };
    if (src.hw && t.hw !== src.hw) t.hw = t.hw ? t.hw + '\n' + src.hw : src.hw;
    t.links = (t.links || []).concat((src.links || []).filter(function (u) { return (t.links || []).indexOf(u) < 0; })).slice(0, LIMITS.links);
    t.noHw = !t.hw && !t.links.length && (!!t.noHw || !!src.noHw);
    t.version = (t.version || 0) + 1; t.by = meta.name; t.updatedAt = meta.now;
    if (ti >= 0) state.entries[ti] = t; else state.entries.push(t);
    var oldS = copy_(src), ns = copy_(src);
    ns.hw = ''; ns.links = []; ns.noHw = false; ns.version = (ns.version || 0) + 1; ns.by = meta.name; ns.updatedAt = meta.now;
    state.entries[si] = ns;
    logs.push({ at: meta.now, by: meta.name, action: 'пара (ДЗ перенесено с версией шаблона)', sheet: SHEETS.entries.name, key: m.to + ' ' + m.pairId, before: oldT, after: t, opId: op.opId });
    logs.push({ at: meta.now, by: meta.name, action: 'пара (ДЗ перенесено с версией шаблона)', sheet: SHEETS.entries.name, key: m.date + ' ' + m.pairId, before: oldS, after: ns, opId: op.opId });
  };

  ops.forEach(function (op) {
    var id = op && op.opId;
    var prev = (id && thisBatch[id]) || seen(op);
    if (prev === 'applied') prev = replayResult_(state, op); // результат давно забыт кэшем, но журнал помнит
    if (prev) { results.push(prev); return; }               // повторная отправка той же операции — без дублей
    var err = validateOp_(op, pairAt);
    if (err) { fail(op, 'invalid', err); return; }
    if (/^(version|subject)\./.test(op.type)) { templateOp_(op); return; }

    if (op.type === 'entry') {
      var idx = findIndex_(state.entries, function (e) { return e.date === op.date && e.pairId === op.pairId; });
      var row = idx >= 0 ? state.entries[idx] : null;
      var version = row ? (row.version || 0) : 0;
      if (op.baseVersion !== version) { fail(op, 'conflict', '', { current: row }); return; }
      var next = row ? copy_(row) : { date: op.date, pairId: op.pairId, links: [] };
      for (var k in op.patch) next[k] = op.patch[k];
      if (next.hw || (next.links && next.links.length)) next.noHw = false; // ДЗ вписано — отметка «нет» снимается
      if (!next.cancelled) next.reason = '';
      if (next.start && next.end && next.end <= next.start) { fail(op, 'invalid', 'время окончания должно быть позже начала'); return; }
      next.version = version + 1; next.by = meta.name; next.updatedAt = meta.now;
      if (idx >= 0) state.entries[idx] = next; else state.entries.push(next);
      done(op, { opId: op.opId, ok: true, version: next.version, entry: next }, 'пара', SHEETS.entries.name, op.date + ' ' + op.pairId, copy_(row), next);
      return;
    }

    if (op.type === 'note.add' || op.type === 'note.remove') {
      var text = op.text.trim();
      var notesOfDay = state.dayNotes.filter(function (n) { return n.date === op.date; });
      if (op.type === 'note.add') {
        if (!notesOfDay.some(function (n) { return n.text === text; })) {
          if (notesOfDay.length >= LIMITS.notesPerDay) { fail(op, 'invalid', 'не больше 10 пометок в день'); return; }
          state.dayNotes.push({ date: op.date, text: text, by: meta.name, updatedAt: meta.now });
        }
      } else {
        state.dayNotes = state.dayNotes.filter(function (n) { return !(n.date === op.date && n.text === op.text); });
      }
      done(op, { opId: op.opId, ok: true }, op.type === 'note.add' ? 'пометка +' : 'пометка −', SHEETS.dayNotes.name, op.date, null, op.text);
      return;
    }

    if (op.type === 'rule.set' || op.type === 'rule.remove') {
      var ri = findIndex_(state.rules, function (r) { return r.pairId === op.pairId && r.field === op.field && r.from === op.date; });
      var beforeRule = ri >= 0 ? copy_(state.rules[ri]) : null;
      if (op.type === 'rule.remove') {
        if (ri >= 0) state.rules.splice(ri, 1);
        done(op, { opId: op.opId, ok: true }, 'правило −', SHEETS.rules.name, op.date + ' ' + op.pairId + ' ' + op.field, beforeRule, null);
        return;
      }
      var rule = { pairId: op.pairId, from: op.date, to: op.to || '', field: op.field, value: op.value.trim(), by: meta.name, updatedAt: meta.now };
      if (ri >= 0) state.rules[ri] = rule; else state.rules.push(rule);
      done(op, { opId: op.opId, ok: true, rule: rule }, 'правило', SHEETS.rules.name, op.date + ' ' + op.pairId + ' ' + op.field, beforeRule, rule);
      return;
    }

    if (op.type === 'extra.add') {
      var x = op.extra;
      if (findIndex_(state.extras, function (e) { return e.id === x.id; }) >= 0) { fail(op, 'invalid', 'пара с таким номером уже есть'); return; }
      if (state.extras.filter(function (e) { return e.date === x.date && !e.cancelled; }).length >= 8) { fail(op, 'invalid', 'не больше 8 дополнительных пар в день'); return; }
      if (x.srcPairId && findIndex_(state.extras, function (e) { return e.srcDate === x.srcDate && e.srcPairId === x.srcPairId && !e.cancelled; }) >= 0) { fail(op, 'invalid', 'эта пара уже перенесена — перенесите её ещё раз из новой даты'); return; }
      var added = { id: x.id, date: x.date, start: x.start, end: x.end, slots: x.slots || 1, subject: x.subject || '', tgName: x.tgName || '', type: x.type || '',
        room: x.room || '', teacher: x.teacher || '', srcDate: x.srcPairId ? x.srcDate : '', srcPairId: x.srcPairId || '', hw: x.hw || '', links: x.links || [],
        noHw: !!x.noHw && !x.hw && !(x.links || []).length, version: 1, by: meta.name, updatedAt: meta.now };
      state.extras.push(added);
      done(op, { opId: op.opId, ok: true, version: 1, extra: added }, added.srcPairId ? 'перенос' : 'доп. пара', SHEETS.extras.name, x.date + ' ' + x.id, null, added);
      return;
    }

    var xi = findIndex_(state.extras, function (e) { return e.id === op.id; });
    if (op.type === 'extra.remove') {
      var removed = xi >= 0 ? state.extras.splice(xi, 1)[0] : null;
      done(op, { opId: op.opId, ok: true }, 'пара удалена', SHEETS.extras.name, op.date + ' ' + op.id, removed, null);
      return;
    }
    // extra.update
    if (xi < 0) { fail(op, 'conflict', '', { current: null }); return; }
    var cur = state.extras[xi];
    if ((cur.version || 0) !== op.baseVersion) { fail(op, 'conflict', '', { current: cur }); return; }
    if (op.patch.date && op.patch.date !== cur.date && state.extras.filter(function (e) { return e.date === op.patch.date && !e.cancelled; }).length >= 8) {
      fail(op, 'invalid', 'не больше 8 дополнительных пар в день'); return;
    }
    var upd = copy_(cur);
    for (var f in op.patch) upd[f] = op.patch[f];
    if (upd.hw || (upd.links && upd.links.length)) upd.noHw = false;
    if (!upd.start || !upd.end || upd.end <= upd.start) { fail(op, 'invalid', 'время окончания должно быть позже начала'); return; }
    upd.version = (cur.version || 0) + 1; upd.by = meta.name; upd.updatedAt = meta.now;
    state.extras[xi] = upd;
    done(op, { opId: op.opId, ok: true, version: upd.version, extra: upd }, 'доп./перенос', SHEETS.extras.name, upd.date + ' ' + upd.id, copy_(cur), upd);
  });
  return { state: state, results: results.map(publicResult_), logs: logs }; // в листы и журнал — с именем, сайту — без
}

/** Ответ на повтор операции, которая уже применена (по журналу): текущее состояние строки. */
function replayResult_(state, op) {
  var base = { opId: op.opId, ok: true, replay: true };
  if (op.type === 'entry') {
    var row = null;
    (state.entries || []).forEach(function (e) { if (e.date === op.date && e.pairId === op.pairId) row = e; });
    if (row) { base.version = row.version || 0; base.entry = row; }
  } else if (op.type === 'extra.add' || op.type === 'extra.update') {
    var xid = op.type === 'extra.add' ? op.extra && op.extra.id : op.id;
    (state.extras || []).forEach(function (e) { if (e.id === xid) { base.version = e.version || 0; base.extra = e; } });
  } else if (op.type === 'version.save' && op.tplVersion) {
    (state.versions || []).forEach(function (v) { if (v.id === op.tplVersion.id) { base.version = v.version || 0; base.tplVersion = v; } });
  }
  return base;
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
  // «Шаблон» и «Предметы» сервер переписывает целиком (с v0.2): свой столбец владельца с данными
  // был бы стёрт — тогда не пишем ничего и говорим, что мешает
  if (OWNED_SHEETS[key] && sh.getLastRow() > 1) {
    var extra = header.map(function (h, i) { return pos.indexOf(i) < 0 ? i : -1; }).filter(function (i) { return i >= 0; });
    if (extra.length) {
      var vals = sh.getRange(1, 1, sh.getLastRow(), lastCol).getValues();
      var busy = extra.filter(function (i) { return vals.some(function (r, ri) { return ri > 0 && String(r[i]).trim() !== ''; }); });
      if (busy.length) throw new Error('на листе «' + def.name + '» есть свои столбцы с данными (' + busy.map(function (i) { return header[i] || ('столбец ' + (i + 1)); }).join(', ') + ') — перенесите их на другой лист, иначе запись их сотрёт');
    }
  }
  var plain = objectsToRows_(items, def.cols);
  var rows = plain.map(function (r) { var row = new Array(lastCol).fill(''); pos.forEach(function (p, i) { row[p] = r[i]; }); return row; });
  var last = sh.getLastRow();
  if (rows.length) sh.getRange(2, 1, rows.length, lastCol).setNumberFormat('@').setValues(rows);
  if (last > rows.length + 1) sh.getRange(rows.length + 2, 1, last - rows.length - 1, lastCol).clearContent();
}

/** Версии шаблона → листы «Версии» и «Шаблон» (пары всех версий, столбец «версия_шаблона»). */
function writeVersions_(versions) {
  var pairs = [];
  versions.forEach(function (v) { v.pairs.forEach(function (t) { var o = copy_(t); o.versionId = v.id; pairs.push(o); }); });
  writeObjects_('template', pairs); // сначала пары: если столбцов не хватит, запись остановится до изменения «Версий»
  writeObjects_('versions', versions.map(function (v) { var o = copy_(v); delete o.pairs; return o; }));
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
  var lockedUntil = cache.get(LOCK_KEY);
  if (lockedUntil) return { ok: false, error: 'locked', message: lockedMessage_(Number(lockedUntil) || Date.now() + LOCK_SECONDS * 1000, Date.now()) };
  var codes = JSON.parse(PropertiesService.getScriptProperties().getProperty(CODES_PROP) || '{}');
  var name = codes[hashCode_(req && req.code)];
  if (!name) {
    var fails = Number(cache.get(FAIL_KEY) || 0) + 1;
    if (fails >= MAX_FAILS) {
      var props = PropertiesService.getScriptProperties();
      var prev = null;
      try { prev = JSON.parse(props.getProperty(LOCK_LEVEL_PROP) || 'null'); } catch (e) { prev = null; }
      var lock = nextLock_(prev, Date.now());
      cache.put(LOCK_KEY, String(Date.now() + lock.seconds * 1000), lock.seconds);
      props.setProperty(LOCK_LEVEL_PROP, JSON.stringify({ n: lock.n, at: Date.now() }));
      cache.remove(FAIL_KEY);
    }
    else cache.put(FAIL_KEY, String(fails), LOCK_SECONDS);
    return { ok: false, error: 'bad-code', message: 'Код не подошёл. Проверьте цифры.' };
  }
  if (req.action === 'login') return { ok: true, name: name };
  var ops = Array.isArray(req.ops) ? req.ops.slice(0, LIMITS.opsPerRequest) : [];
  {
    var kv = {};
    rowsToObjects_(readSheet_(SHEETS.settings.name), SHEETS.settings.cols).forEach(function (r) { kv[r.key] = r.value; });
    var verRows = rowsToObjects_(readSheet_(SHEETS.versions.name), SHEETS.versions.cols);
    var state = {
      entries: rowsToObjects_(readSheet_(SHEETS.entries.name), SHEETS.entries.cols),
      dayNotes: rowsToObjects_(readSheet_(SHEETS.dayNotes.name), SHEETS.dayNotes.cols),
      rules: rowsToObjects_(readSheet_(SHEETS.rules.name), SHEETS.rules.cols),
      extras: rowsToObjects_(readSheet_(SHEETS.extras.name), SHEETS.extras.cols),
      // пары проверяются по версии шаблона на дату операции
      versions: versionsFrom_(rowsToObjects_(readSheet_(SHEETS.template.name), SHEETS.template.cols), verRows, kv),
      versionsReady: verRows.length > 0, // править шаблон с сайта можно только после перехода (migrateV2)
      subjects: rowsToObjects_(readSheet_(SHEETS.subjects.name), SHEETS.subjects.cols)
    };
    var nowDate = new Date();
    var meta = { name: name, now: Utilities.formatDate(nowDate, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"), today: Utilities.formatDate(nowDate, TZ, 'yyyy-MM-dd') };
    var journal = null; // читаем журнал, только если кэш не помнит операцию
    var seen = function (op) {
      var id = op && op.opId;
      if (!id) return null;
      var v = cache.get('op:' + id);
      if (v) return JSON.parse(v);
      if (!journal) journal = journalOpIds_();
      return journal[id] ? 'applied' : null;
    };
    var out = processOps_(state, ops, null, meta, seen);
    if (out.logs.length) {
      var touched = {};
      out.logs.forEach(function (l) { touched[l.sheet] = true; });   // перезаписываем только изменённые листы
      if (touched[SHEETS.entries.name]) writeObjects_('entries', out.state.entries);
      if (touched[SHEETS.dayNotes.name]) writeObjects_('dayNotes', out.state.dayNotes);
      if (touched[SHEETS.rules.name]) writeObjects_('rules', out.state.rules);
      if (touched[SHEETS.extras.name]) writeObjects_('extras', out.state.extras);
      if (touched[SHEETS.versions.name]) writeVersions_(out.state.versions);
      if (touched[SHEETS.subjects.name]) writeObjects_('subjects', out.state.subjects);
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

/**
 * Длина следующей паузы. Каждая новая пауза в течение суток после предыдущей — вдвое длиннее
 * (10 → 20 → 40 мин … до 6 часов); сутки без пауз — снова 10 минут.
 * Так перебор кода замедляется с ~1440 до ~40 попыток в сутки.
 */
function nextLock_(prev, nowMs) {
  var n = prev && typeof prev.n === 'number' && nowMs - prev.at < DAY_MS ? prev.n + 1 : 1;
  return { n: n, seconds: Math.min(LOCK_SECONDS * Math.pow(2, n - 1), LOCK_MAX_SECONDS) };
}
function lockedMessage_(untilMs, nowMs) {
  var min = Math.max(1, Math.ceil((untilMs - nowMs) / 60000));
  var when = min >= 60 ? Math.ceil(min / 60) + ' ч' : min + ' мин';
  return 'Слишком много неверных попыток. Вход и сохранение закрыты ещё примерно на ' + when + '. Правки не пропадут — они ждут на телефоне. Если это не вы ошибались, напишите Еремею.';
}
/**
 * Имена активистов в коде не хранятся (репозиторий открытый): они есть только в свойствах
 * скрипта — рядом с отпечатками кодов {отпечаток: имя}. Отсюда же берётся список.
 */
var TEST_NAME = 'Проверка';
function activistNames_(codes) {
  var seen = {}, out = [];
  Object.keys(codes).forEach(function (h) { var n = codes[h]; if (n !== TEST_NAME && !seen[n]) { seen[n] = true; out.push(n); } });
  return out;
}
function readCodes_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty(CODES_PROP) || '{}'); }
/** Убрать человека: все его коды перестают работать. */
function removeCodesFor_(codes, name) {
  var out = {};
  Object.keys(codes).forEach(function (h) { if (codes[h] !== name) out[h] = codes[h]; });
  return out;
}
/** Заменить код одного человека: его старые коды удаляются, остальные не трогаются. */
function replaceCodeFor_(codes, name, newHash) {
  var out = removeCodesFor_(codes, name);
  out[newHash] = name;
  return out;
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
  codes[hashCode_(code)] = TEST_NAME;
  props.setProperty(CODES_PROP, JSON.stringify(codes));
  Logger.log('Тестовый код: ' + code);
}
function removeTestCode() {
  var props = PropertiesService.getScriptProperties();
  var codes = JSON.parse(props.getProperty(CODES_PROP) || '{}');
  Object.keys(codes).forEach(function (h) { if (codes[h] === TEST_NAME) delete codes[h]; });
  props.setProperty(CODES_PROP, JSON.stringify(codes));
  Logger.log('Тестовый код удалён');
}

// ---------- меню владельца в таблице ----------
// Таблица → меню «Расписание 322». Коды показываются только тому, кто нажал (владельцу таблицы).

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Расписание 322')
    .addItem('Новый код для активиста…', 'menuNewCode')
    .addItem('Убрать активиста…', 'menuRemove')
    .addItem('Новые коды всем активистам…', 'menuAllCodes')
    .addToUi();
}
function saveCodes_(update) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var props = PropertiesService.getScriptProperties();
    var codes = JSON.parse(props.getProperty(CODES_PROP) || '{}');
    props.setProperty(CODES_PROP, JSON.stringify(update(codes)));
  } finally { lock.releaseLock(); }
}
function askName_(ui, title, text) {
  var r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  var name = r.getResponseText().trim();
  if (!name || name.length > 40 || name === TEST_NAME) { ui.alert('Имя — от 1 до 40 знаков (и не «' + TEST_NAME + '»).'); return null; }
  var known = activistNames_(readCodes_()).filter(function (n) { return n.toLowerCase() === name.toLowerCase(); })[0];
  return known || name;
}
function menuNewCode() {
  var ui = SpreadsheetApp.getUi();
  var names = activistNames_(readCodes_());
  var name = askName_(ui, 'Новый код', (names.length ? 'Сейчас активисты: ' + names.join(', ') + '.\n' : '') +
    'Впишите имя: для кого-то из списка — его старый код перестанет работать; новое имя — добавится активист. Коды остальных не изменятся.');
  if (!name) return;
  if (names.indexOf(name) < 0 && ui.alert('Новый активист', 'Добавить активиста «' + name + '»? Имя будет в журнале таблицы; на сайте его видит только сам активист после входа.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var code = randomCode_();
  saveCodes_(function (codes) { return replaceCodeFor_(codes, name, hashCode_(code)); });
  ui.alert('Код для «' + name + '»: ' + code + '\n\nПередайте лично; код больше нигде не сохраняется (в таблице — только его отпечаток).');
}
function menuRemove() {
  var ui = SpreadsheetApp.getUi();
  var names = activistNames_(readCodes_());
  if (!names.length) { ui.alert('Активистов пока нет.'); return; }
  var name = askName_(ui, 'Убрать активиста', 'Сейчас активисты: ' + names.join(', ') + '.\nВпишите имя — его код перестанет работать.');
  if (!name) return;
  if (names.indexOf(name) < 0) { ui.alert('Такого имени нет: ' + names.join(', ') + '.'); return; }
  saveCodes_(function (codes) { return removeCodesFor_(codes, name); });
  ui.alert('Готово: код «' + name + '» больше не работает.');
}
function menuAllCodes() {
  var ui = SpreadsheetApp.getUi();
  var names = activistNames_(readCodes_());
  if (!names.length) { ui.alert('Активистов пока нет — добавьте через «Новый код для активиста…».'); return; }
  if (ui.alert('Новые коды всем', 'Старые коды (' + names.join(', ') + ') перестанут работать. Продолжить?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var codes = {}, lines = [];
  names.forEach(function (name) { var code = randomCode_(); codes[hashCode_(code)] = name; lines.push(name + ': ' + code); });
  saveCodes_(function () { return codes; });
  ui.alert('Новые коды (передайте лично, старые больше не действуют):\n\n' + lines.join('\n'));
}

/**
 * Владелец запускает вручную из редактора: новые коды всем активистам из списка (старые перестают
 * работать) — в журнал выполнения. Удобнее то же самое через меню таблицы «Расписание 322».
 */
function createActivistCodes() {
  var names = activistNames_(readCodes_());
  if (!names.length) { Logger.log('Активистов пока нет: таблица → меню «Расписание 322» → «Новый код для активиста…».'); return; }
  var codes = {}, lines = [];
  names.forEach(function (name) { var code = randomCode_(); codes[hashCode_(code)] = name; lines.push(name + ': ' + code); });
  saveCodes_(function () { return codes; });
  Logger.log('Новые коды (передайте лично, старые больше не действуют):\n' + lines.join('\n'));
}

// ---------- первое заполнение таблицы ----------

function objectsToRows_(items, cols) {
  var back = { half: invert_(VALUES.half), anchorHalf: invert_(VALUES.half), type: invert_(VALUES.type), field: invert_(VALUES.field) };
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
    template: seed.template.map(function (t) { var o = copy_(t); o.versionId = 'V1'; return o; }),
    versions: [{ id: 'V1', from: seed.settings.semesterStart, anchorWeek: seed.settings.anchorWeek, anchorHalf: seed.settings.anchorHalf,
      semesterStart: seed.settings.semesterStart, semesterEnd: seed.settings.semesterEnd, version: 1 }],
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

/**
 * Переход на версии шаблона (v0.2). Запускается владельцем один раз из редактора скрипта.
 * Ничего не удаляет: создаёт лист «Версии» с одной версией V1 (даты и опорная неделя — из «Настроек»)
 * и проставляет V1 всем парам «Шаблона» в новом столбце «версия_шаблона». Повторный запуск ничего не меняет.
 * Строки опорной недели и семестра в «Настройках» остаются — для отката на прежний сервер; после перехода не используются.
 */
function migrateV2() {
  var ss = SpreadsheetApp.getActive();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ver = ss.getSheetByName(SHEETS.versions.name);
    if (ver && ver.getLastRow() >= 2) { Logger.log('Переход уже сделан: лист «Версии» заполнен, ничего не меняю.'); return; }
    var kv = {};
    rowsToObjects_(readSheet_(SHEETS.settings.name), SHEETS.settings.cols).forEach(function (r) { kv[r.key] = r.value; });
    var v1 = versionsFrom_([], [], kv)[0];
    if (!DATE_RE.test(v1.from || '') || !DATE_RE.test(v1.anchorWeek || '') || (v1.anchorHalf !== 'top' && v1.anchorHalf !== 'bottom')) {
      throw new Error('В «Настройках» не хватает опорной недели или начала семестра — переход остановлен, ничего не изменено.');
    }
    // 1. столбец «версия_шаблона» в «Шаблоне»: V1 у каждой строки с id
    var tpl = ss.getSheetByName(SHEETS.template.name);
    var lastCol = tpl.getLastColumn();
    var header = tpl.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = header.indexOf('версия_шаблона') + 1;
    if (!col) { col = lastCol + 1; tpl.getRange(1, col).setValue('версия_шаблона').setFontWeight('bold'); }
    var idCol = header.indexOf('id') + 1;
    var n = tpl.getLastRow() - 1, pairs = 0;
    if (n > 0) {
      var ids = tpl.getRange(2, idCol, n, 1).getValues();
      var marks = ids.map(function (r) { if (String(r[0]).trim()) { pairs++; return ['V1']; } return ['']; });
      tpl.getRange(2, col, n, 1).setNumberFormat('@').setValues(marks);
    }
    // 2. лист «Версии»
    if (!ver) ver = ss.insertSheet(SHEETS.versions.name);
    var cols = SHEETS.versions.cols, width = cols.length;
    ver.getRange(1, 1, TEXT_ROWS, width).setNumberFormat('@');
    ver.getRange(1, 1, 1, width).setValues([cols.map(function (c) { return c[0]; })]).setFontWeight('bold');
    ver.setFrozenRows(1);
    var now = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
    delete v1.pairs; v1.version = 1; v1.by = 'переход v0.2'; v1.updatedAt = now;
    ver.getRange(2, 1, 1, width).setValues(objectsToRows_([v1], cols));
    ver.autoResizeColumns(1, width);
    // 3. журнал и сброс кэша ответа сайту
    ss.getSheetByName(SHEETS.log.name).appendRow([now, 'переход v0.2', 'версии шаблона', SHEETS.versions.name, 'V1 с ' + v1.from, '', JSON.stringify(v1), '']);
    CacheService.getScriptCache().remove(CACHE_KEY);
    Logger.log('Готово: версия V1 с ' + v1.from + ' (опорная неделя ' + v1.anchorWeek + '), пар в шаблоне: ' + pairs + '.');
  } finally {
    lock.releaseLock();
  }
}
