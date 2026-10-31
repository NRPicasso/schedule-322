// Логика расписания: из шаблона и записей активистов собирает день.
// Только «чистые» функции: на входе данные, на выходе результат, без DOM и сети —
// поэтому один и тот же код работает в браузере и в тестах Node.

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- даты (строки ГГГГ-ММ-ДД, считаем в UTC, чтобы часовой пояс не сдвигал день) ----------

export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  return formatDate(new Date(parseDate(iso).getTime() + n * DAY_MS));
}
/** День недели: 0 — воскресенье, 1 — понедельник … 6 — суббота. */
export function weekday(iso) {
  return parseDate(iso).getUTCDay();
}
/** Понедельник той недели, к которой относится дата (воскресенье — к прошедшей неделе). */
export function mondayOf(iso) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}
export function weekDates(monday) {
  return [0, 1, 2, 3, 4, 5].map((i) => addDays(monday, i));
}
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------- верхняя / нижняя неделя ----------

/** Половина недели считается от опорной недели: чётное число недель от неё — та же половина. */
export function weekHalf(iso, settings) {
  const weeks = Math.round((parseDate(mondayOf(iso)) - parseDate(mondayOf(settings.anchorWeek))) / (7 * DAY_MS));
  const same = ((weeks % 2) + 2) % 2 === 0;
  if (same) return settings.anchorHalf;
  return settings.anchorHalf === 'top' ? 'bottom' : 'top';
}

// ---------- сборка дня ----------

const CHANGEABLE = ['room', 'start', 'end', 'teacher'];

function activeRules(rules, pairId, iso) {
  return rules
    .filter((r) => r.pairId === pairId && r.from <= iso && (!r.to || iso <= r.to))
    .sort((a, b) => (a.from < b.from ? -1 : 1)); // более позднее правило применяется последним
}

function fromTemplate(t, iso, data, entriesByKey) {
  const pair = {
    id: t.id, date: iso, kind: 'template',
    subject: t.subject, tgName: t.tgName, type: t.type, slots: t.slots || 1,
    start: t.start, end: t.end, room: t.room, teacher: t.teacher, note: t.note || '',
    changed: {}, ruledFrom: {},
  };
  for (const r of activeRules(data.rules || [], t.id, iso)) {
    if (CHANGEABLE.includes(r.field)) { pair[r.field] = r.value; pair.ruledFrom[r.field] = r.from; }
  }
  const e = entriesByKey.get(iso + '|' + t.id) || {};
  for (const f of CHANGEABLE) {
    if (e[f]) { pair.changed[f] = pair[f]; pair[f] = e[f]; } // разовая замена сильнее правила
  }
  pair.hw = e.hw || '';
  pair.links = e.links || [];
  pair.noHw = !!e.noHw;
  pair.reason = e.reason || '';
  pair.updatedBy = e.by; pair.updatedAt = e.updatedAt;

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
  const src = x.srcPairId ? data.template.find((t) => t.id === x.srcPairId) : null;
  const base = src || {};
  return {
    id: x.id, date: x.date, kind: 'extra',
    subject: x.subject || base.subject || '', tgName: x.tgName || base.tgName || x.subject || '',
    type: x.type || base.type || 'other', slots: x.slots || base.slots || 1,
    start: x.start, end: x.end, room: x.room || base.room || '', teacher: x.teacher || base.teacher || '', note: '',
    changed: {}, ruledFrom: {},
    hw: x.hw || '', links: x.links || [], noHw: !!x.noHw, reason: '',
    updatedBy: x.by, updatedAt: x.updatedAt,
    status: src ? 'moved-here' : 'extra',
    movedFrom: src ? x.srcDate : undefined,
  };
}

const isNumbered = (p) => p.status !== 'cancelled' && p.status !== 'moved-away';

/** Собирает день: шаблон нужной половины → правила → разовые записи → переносы и доп. пары → нумерация. */
export function buildDay(iso, data) {
  const half = weekHalf(iso, data.settings);
  const wd = weekday(iso);
  const entriesByKey = new Map((data.entries || []).map((e) => [e.date + '|' + e.pairId, e]));

  const pairs = data.template
    .filter((t) => t.day === wd && (t.half === 'both' || t.half === half))
    .map((t) => fromTemplate(t, iso, data, entriesByKey));
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
