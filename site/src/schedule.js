// Логика расписания: из шаблона и записей активистов собирает день.
// Только «чистые» функции: на входе данные, на выходе результат, без DOM и сети —
// поэтому один и тот же код работает в браузере и в тестах Node.

import { parseDate, formatDate, addDays, weekday, mondayOf } from './dates.js';
import { versionAt, isFirstVersion, halfIn, pairInVersion } from './versions.js';

export { parseDate, formatDate, addDays, weekday, mondayOf }; // прежние места импорта продолжают работать

export function weekDates(monday) {
  return [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
}
/**
 * Учебные дни недели для показа: пн–сб всегда, воскресенье — только если в нём что-то есть
 * (перенос или доп. пару на воскресенье поставить можно — она не должна пропадать).
 */
export function studyDates(monday, data) {
  const sunday = addDays(monday, 6);
  const sun = buildDay(sunday, data);
  return sun.pairs.length || sun.notes.length ? [...weekDates(monday), sunday] : weekDates(monday);
}
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------- верхняя / нижняя неделя ----------

/** Половина недели считается от опорной недели: чётное число недель от неё — та же половина. */
export function weekHalf(iso, settings) {
  return halfIn(settings, iso); // settings — любая запись с anchorWeek и anchorHalf (версия шаблона или старые «Настройки»)
}

// ---------- сборка дня ----------

const CHANGEABLE = ['room', 'start', 'end', 'teacher'];

// Постоянная замена действует, только если началась не раньше версии шаблона этой даты:
// замены прошлого семестра в новую версию не переходят (у первой версии нижней границы нет).
function activeRules(rules, pairId, iso, since) {
  return rules
    .filter((r) => r.pairId === pairId && r.from <= iso && (!r.to || iso <= r.to) && r.from >= since)
    .sort((a, b) => (a.from < b.from ? -1 : 1)); // более позднее правило применяется последним
}

function fromTemplate(t, iso, data, entriesByKey, since) {
  const pair = {
    id: t.id, date: iso, kind: 'template',
    subject: t.subject, tgName: t.tgName, type: t.type, slots: t.slots || 1,
    start: t.start, end: t.end, room: t.room, teacher: t.teacher, note: t.note || '',
    changed: {}, ruledFrom: {},
  };
  for (const r of activeRules(data.rules || [], t.id, iso, since)) {
    if (CHANGEABLE.includes(r.field)) { pair[r.field] = r.value; pair.ruledFrom[r.field] = r.from; }
  }
  const e = entriesByKey.get(iso + '|' + t.id) || {};
  for (const f of CHANGEABLE) {
    if (e[f]) { pair.changed[f] = pair[f]; pair[f] = e[f]; } // разовая замена сильнее правила
  }
  // защита от несогласованного времени (правило на начало без правила на конец, ручная правка
  // таблицы): если конец не позже начала — показываем время по шаблону, а не «15:00–13:10»
  if (toMinutes(pair.end) <= toMinutes(pair.start)) {
    pair.start = t.start; pair.end = t.end; delete pair.changed.start; delete pair.changed.end;
  }
  pair.hw = e.hw || '';
  pair.links = e.links || [];
  pair.noHw = !!e.noHw;
  pair.reason = e.reason || '';
  pair.updatedAt = e.updatedAt;

  const moved = (data.extras || []).find((x) => x.srcDate === iso && x.srcPairId === t.id && !x.cancelled);
  if (moved) {
    pair.status = 'moved-away';
    pair.movedTo = { date: moved.date, start: moved.start, room: moved.room || pair.room };
  } else {
    pair.status = e.cancelled ? 'cancelled' : 'normal';
  }
  return pair;
}

function fromExtra(x, data) {
  // перенос берёт предмет, тип и преподавателя у исходной пары шаблона, если они не указаны
  const src = x.srcPairId ? pairInVersion(data, x.srcPairId, x.srcDate) : null;
  const base = src || {};
  return {
    id: x.id, date: x.date, kind: 'extra',
    subject: x.subject || base.subject || '', tgName: x.tgName || base.tgName || x.subject || '',
    type: x.type || base.type || 'other', slots: x.slots || base.slots || 1,
    start: x.start, end: x.end, room: x.room || base.room || '', teacher: x.teacher || base.teacher || '', note: src ? base.note || '' : '',
    changed: {}, ruledFrom: {},
    hw: x.hw || '', links: x.links || [], noHw: !!x.noHw, reason: '',
    updatedAt: x.updatedAt,
    status: src ? 'moved-here' : 'extra',
    movedFrom: src ? x.srcDate : undefined,
  };
}

const isNumbered = (p) => p.status !== 'cancelled' && p.status !== 'moved-away';

/** Собирает день: версия шаблона этой даты, её половина недели → правила → разовые записи → переносы и доп. пары → нумерация. */
export function buildDay(iso, data) {
  const version = versionAt(data, iso);                // шаблон, действующий в эту дату
  const since = isFirstVersion(data, version) ? '' : version.from;
  const half = halfIn(version, iso);
  const wd = weekday(iso);
  const entriesByKey = new Map((data.entries || []).map((e) => [e.date + '|' + e.pairId, e]));

  // Шаблон действует и после конца семестра (решение владельца: потом начнётся следующий,
  // и шаблон просто заменят). Даты семестра нужны только для проверки переносов.
  const pairs = version.pairs
    .filter((t) => t.day === wd && (t.half === 'both' || t.half === half))
    .map((t) => fromTemplate(t, iso, data, entriesByKey, since));
  for (const x of data.extras || []) {
    if (x.date === iso && !x.cancelled) pairs.push(fromExtra(x, data));
  }
  pairs.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  // номера пар — по порядку в дне, как у активистов; сдвоенная пара занимает два номера
  let n = 1;
  for (const p of pairs) {
    if (!isNumbered(p)) { p.numbers = []; continue; }
    p.numbers = Array.from({ length: p.slots }, (_, i) => n + i);
    n += p.slots;
  }
  const notes = (data.dayNotes || []).filter((d) => d.date === iso).map((d) => d.text);
  return { date: iso, half, pairs, notes };
}
