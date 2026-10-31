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

// ---------- данные для первого заполнения (сгенерировано tools/build-gs.mjs, не править руками) ----------
var SEED = {"settings":{"anchorWeek":"2026-09-14","anchorHalf":"top","semesterStart":"2026-09-14","semesterEnd":"2026-12-31","tomorrowAfter":"18:30"},"template":[{"id":"MON-1500","half":"both","day":1,"start":"15:00","end":"16:30","slots":1,"subject":"ГПП","tgName":"ГПП","type":"lecture","room":"115","teacher":"Войтович Л.В.","note":""},{"id":"MON-1650-top","half":"top","day":1,"start":"16:50","end":"18:20","slots":1,"subject":"Муниципальное","tgName":"Муниципальное право","type":"lecture","room":"115","teacher":"Яхина Ю.Х.","note":"отмечает сама"},{"id":"MON-1650-bot","half":"bottom","day":1,"start":"16:50","end":"18:20","slots":1,"subject":"МП","tgName":"Международное право","type":"lecture","room":"113","teacher":"Алексеева Н.И.","note":""},{"id":"TUE-1140-top","half":"top","day":2,"start":"11:40","end":"13:10","slots":1,"subject":"Муниципальное","tgName":"Муниципальное право","type":"seminar","room":"222","teacher":"Яхина Ю.Х.","note":""},{"id":"TUE-1140-bot","half":"bottom","day":2,"start":"11:40","end":"13:10","slots":1,"subject":"Муниципальное","tgName":"Муниципальное право","type":"seminar","room":"211","teacher":"Яхина Ю.Х.","note":""},{"id":"TUE-1320","half":"both","day":2,"start":"13:20","end":"14:50","slots":1,"subject":"УПП","tgName":"УПП","type":"lecture","room":"115","teacher":"Смирнов А.В.","note":""},{"id":"TUE-1500-top","half":"top","day":2,"start":"15:00","end":"16:30","slots":1,"subject":"ГПП","tgName":"ГПП","type":"seminar","room":"219","teacher":"Войтович Л.В.","note":""},{"id":"TUE-1500-bot","half":"bottom","day":2,"start":"15:00","end":"16:30","slots":1,"subject":"ТП","tgName":"ТП","type":"lecture","room":"113","teacher":"Клепалова Ю.И.","note":""},{"id":"TUE-1650-top","half":"top","day":2,"start":"16:50","end":"18:20","slots":1,"subject":"ГПП","tgName":"ГПП","type":"seminar","room":"219","teacher":"Войтович Л.В.","note":""},{"id":"WED-1430-top","half":"top","day":3,"start":"14:30","end":"16:00","slots":1,"subject":"Физкультура","tgName":"ФИЗ-РА","type":"other","room":"СПОРТЗАЛ","teacher":"Крутой А.Н.","note":"Сменка"},{"id":"WED-1430-bot","half":"bottom","day":3,"start":"14:30","end":"16:00","slots":1,"subject":"Физкультура","tgName":"ФИЗ-РА","type":"other","room":"Алексеева","teacher":"Крутой А.Н.","note":"Сменка"},{"id":"THU-0940-top","half":"top","day":4,"start":"09:40","end":"11:10","slots":1,"subject":"МП","tgName":"Международное право","type":"seminar","room":"312","teacher":"Игнатьева М.В.","note":""},{"id":"THU-1140-top","half":"top","day":4,"start":"11:40","end":"13:10","slots":1,"subject":"МП","tgName":"Международное право","type":"seminar","room":"215","teacher":"Игнатьева М.В.","note":""},{"id":"THU-1320","half":"both","day":4,"start":"13:20","end":"14:50","slots":1,"subject":"ОСД","tgName":"ОСД","type":"seminar","room":"221","teacher":"Саяпин В.Г.","note":""},{"id":"THU-1500","half":"both","day":4,"start":"15:00","end":"16:30","slots":1,"subject":"УП","tgName":"УП","type":"lecture","room":"115","teacher":"Бычков С.Н.","note":""},{"id":"THU-1650-bot","half":"bottom","day":4,"start":"16:50","end":"20:00","slots":2,"subject":"ТП","tgName":"ТП","type":"seminar","room":"222","teacher":"Клепалова Ю.И.","note":""},{"id":"FRI-1320-top","half":"top","day":5,"start":"13:20","end":"14:50","slots":1,"subject":"ГП","tgName":"ГП","type":"seminar","room":"220","teacher":"Мамедов Э.Х.","note":""},{"id":"FRI-1500-top","half":"top","day":5,"start":"15:00","end":"16:30","slots":1,"subject":"ГП","tgName":"ГП","type":"seminar","room":"222","teacher":"Мамедов Э.Х.","note":""},{"id":"FRI-1500-bot","half":"bottom","day":5,"start":"15:00","end":"16:30","slots":1,"subject":"ОСД","tgName":"ОСД","type":"lecture","room":"115","teacher":"Шиплюк В.А.","note":""},{"id":"FRI-1650","half":"both","day":5,"start":"16:50","end":"18:20","slots":1,"subject":"ГП","tgName":"ГП","type":"lecture","room":"115","teacher":"Мамедов Э.Х.","note":""},{"id":"FRI-1830","half":"both","day":5,"start":"18:30","end":"20:00","slots":1,"subject":"УПП","tgName":"УПП","type":"seminar","room":"219","teacher":"Зашляпин Л.А.","note":""},{"id":"SAT-1320-top","half":"top","day":6,"start":"13:20","end":"14:50","slots":1,"subject":"УП","tgName":"УП","type":"seminar","room":"316","teacher":"Иванкова А.Ю.","note":""},{"id":"SAT-1500-top","half":"top","day":6,"start":"15:00","end":"16:30","slots":1,"subject":"УП","tgName":"УП","type":"seminar","room":"309","teacher":"Иванкова А.Ю.","note":""}],"subjects":{"Муниципальное":{"short":"МУН","full":"Муниципальное право","color":"mun"},"ГПП":{"short":"ГПП","full":"Гражданский процесс","color":"gpp"},"УПП":{"short":"УПП","full":"Уголовный процесс","color":"upp"},"УП":{"short":"УП","full":"Уголовное право","color":"up"},"ГП":{"short":"ГП","full":"Гражданское право","color":"gp"},"ТП":{"short":"ТП","full":"Трудовое право","color":"tp"},"ОСД":{"short":"ОСД","full":"Организация судебной деятельности","color":"osd"},"МП":{"short":"МП","full":"Международное право","color":"mp"},"Физкультура":{"short":"ФК","full":"Физкультура","color":"fk"}},"rules":[{"pairId":"TUE-1500-top","from":"2026-09-14","to":"2026-09-28","field":"room","value":"314"},{"pairId":"TUE-1650-top","from":"2026-09-14","to":"2026-09-28","field":"room","value":"318"},{"pairId":"TUE-1140-bot","from":"2026-09-14","to":"2026-10-05","field":"room","value":"114"}],"entries":[{"date":"2026-09-15","pairId":"TUE-1140-top","hw":"","links":["https://t.me/c/4323463486/39/875"]},{"date":"2026-09-15","pairId":"TUE-1500-top","hw":"Докладчики — по второй ссылке","links":["https://t.me/c/4323463486/26/877","https://t.me/c/4323463486/26/883"]},{"date":"2026-09-16","pairId":"WED-1430-top","room":"Алексеева"},{"date":"2026-09-17","pairId":"THU-0940-top","hw":"Темы 1–3: МП как особая система права; источники МП; субъекты МП (полный список вопросов — в сообщении)","links":[]},{"date":"2026-09-18","pairId":"FRI-1320-top","hw":"","links":["https://t.me/c/4323463486/4/1058?single"]},{"date":"2026-09-19","pairId":"SAT-1320-top","hw":"","links":["https://t.me/c/4323463486/35/1076"]},{"date":"2026-09-22","pairId":"TUE-1140-bot","hw":"6 вопросов для обсуждения из этого файла","links":["https://t.me/c/4323463486/39/875"]},{"date":"2026-09-24","pairId":"THU-1320","hw":"","links":["https://t.me/c/4323463486/40/1802","https://t.me/c/4323463486/40/1800"]},{"date":"2026-09-24","pairId":"THU-1650-bot","hw":"","links":["https://t.me/c/4323463486/34/1668","https://t.me/c/4323463486/34/1669","https://t.me/c/4323463486/34/536"]},{"date":"2026-09-25","pairId":"FRI-1830","hw":"","links":["https://t.me/c/4323463486/37/1646"]},{"date":"2026-09-29","pairId":"TUE-1140-top","hw":"","links":["https://t.me/c/4323463486/39/1996"]},{"date":"2026-09-29","pairId":"TUE-1500-top","hw":"Доклады. В конце файла задания — пока на них не смотрим","links":["https://t.me/c/4323463486/26/1059"]},{"date":"2026-09-29","pairId":"TUE-1650-top","hw":"Доклады","links":[]},{"date":"2026-10-01","pairId":"THU-0940-top","hw":"Доклады","links":["https://t.me/c/4323463486/38/977"]},{"date":"2026-10-01","pairId":"THU-1140-top","room":"308"},{"date":"2026-10-01","pairId":"THU-1320","hw":"","links":["https://t.me/c/4323463486/40/1957","https://t.me/c/4323463486/40/2234"]},{"date":"2026-10-02","pairId":"FRI-1320-top","hw":"Пока так, но нужен темплан, новых файлов пока нет","links":["https://t.me/c/4323463486/4/1058?single"]},{"date":"2026-10-02","pairId":"FRI-1830","hw":"Тема: Принципы уголовного судопроизводства. Материал: глава 4 учебника Смирнова — Калиновского, глава 2 УПК РФ. Лекции Калиновского — по ссылкам","links":["https://youtu.be/ju1YWiiVuKE","https://youtu.be/WoUTYPtf8ZQ","https://youtu.be/LtaAFdHIyf8","https://youtu.be/wFLyiVWdKos","https://znanium.ru/read?id=490776&pagenum=90"]},{"date":"2026-10-03","pairId":"SAT-1320-top","hw":"Прошлые доклады","links":["https://t.me/c/4323463486/35/2005"]},{"date":"2026-10-03","pairId":"SAT-1500-top","hw":"","links":["https://t.me/c/4323463486/35/2063"]},{"date":"2026-10-06","pairId":"TUE-1140-bot","hw":"Подготовиться к дебатам","links":["https://t.me/c/4323463486/39/1996"]},{"date":"2026-10-08","pairId":"THU-1320","hw":"","links":["https://t.me/c/4323463486/40/2676"]},{"date":"2026-10-08","pairId":"THU-1650-bot","hw":"","links":["https://t.me/c/4323463486/34/1670"]},{"date":"2026-10-09","pairId":"FRI-1830","hw":"","links":["https://t.me/c/4323463486/37/2443"]},{"date":"2026-10-13","pairId":"TUE-1140-top","hw":"","links":["https://t.me/c/4323463486/39/2730"]},{"date":"2026-10-13","pairId":"TUE-1500-top","hw":"","links":["https://t.me/c/4323463486/26/2310"]},{"date":"2026-10-15","pairId":"THU-1140-top","hw":"","links":["https://t.me/c/4323463486/38/2845"]},{"date":"2026-10-15","pairId":"THU-1320","hw":"","links":["https://t.me/c/4323463486/40/2676"]},{"date":"2026-10-16","pairId":"FRI-1320-top","hw":"","links":["https://t.me/c/4323463486/4/2440"]},{"date":"2026-10-16","pairId":"FRI-1830","hw":"","links":["https://t.me/c/4323463486/37/2853"]},{"date":"2026-10-17","pairId":"SAT-1320-top","hw":"","links":["https://t.me/c/4323463486/35/2005"]},{"date":"2026-10-17","pairId":"SAT-1500-top","hw":"","links":["https://t.me/c/4323463486/35/2899"]},{"date":"2026-10-20","pairId":"TUE-1140-bot","room":"114","hw":"Продолжаем представлять свои страны","links":[]},{"date":"2026-10-22","pairId":"THU-1320","hw":"Доклады по списку","links":["https://t.me/c/4323463486/40/3439"]},{"date":"2026-10-22","pairId":"THU-1650-bot","hw":"Принципы завершаем → источники","links":["https://t.me/c/4323463486/34/1670"]},{"date":"2026-10-23","pairId":"FRI-1830","hw":"","links":["https://t.me/c/1671019187/611"]},{"date":"2026-10-27","pairId":"TUE-1140-top","hw":"Анализ Устава МО","links":["https://t.me/c/4323463486/39/3732"]},{"date":"2026-10-27","pairId":"TUE-1500-top","hw":"Задачи и доклады","links":["https://t.me/c/4323463486/26/3137"]},{"date":"2026-10-29","pairId":"THU-0940-top","hw":"Доклады и игра","links":["https://t.me/c/4323463486/38/3721","https://t.me/c/4323463486/38/2845"]},{"date":"2026-10-29","pairId":"THU-1320","hw":"Доклады тема 4","links":["https://t.me/c/4323463486/40/3447"]},{"date":"2026-10-30","pairId":"FRI-1830","hw":"","links":["https://t.me/c/4323463486/37/3750"]},{"date":"2026-10-31","pairId":"SAT-1320-top","hw":"","links":["https://t.me/c/4323463486/35/2899","https://t.me/c/4323463486/35/3751"]}],"dayNotes":[{"date":"2026-10-28","text":"Сдаём КСУ"}]};
