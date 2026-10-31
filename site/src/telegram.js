// Тексты для Telegram в том виде, как их пишут активисты (сообщения 43–48 в переписке):
//
//   ВТОРНИК
//
//   27.10.2026
//
//   11⁴⁰-13¹⁰
//   1⃣пара/222 - Муниципальное право
//   Анализ Устава МО
//   https://t.me/c/…
//
// Чистые функции: получают данные, возвращают строку — проверяются тестами без браузера.
import { buildDay, weekDates, weekday, parseDate } from './schedule.js';
import { WEEKDAYS, dayMonth, dayMonthWeekday, longDay, shortTime } from './format.js';

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** «15:00» → «15⁰⁰», «09:40» → «9⁴⁰» (минуты надстрочными цифрами, как у активистов). */
export function supTime(hhmm) {
  const [hh, mm] = hhmm.split(':');
  return String(Number(hh)) + [...mm].map((d) => SUP[Number(d)]).join('');
}
/** 3 → «3⃣» (цифра + знак «клавиша» U+20E3, без варианта U+FE0F — как в последних сообщениях). */
export const keycap = (n) => [...String(n)].map((d) => d + '⃣').join('');

/** Эмодзи у названий дней — как в первых сообщениях Активиста 1; включаются по желанию. */
export const DAY_EMOJI = ['', '🍃', '🌹', '', '🍃', '☘️', ''];

const TYPE_WORD = { lecture: 'лекция' };
/** «ГПП (лекция)», «Муниципальное право (лекция-отмечает сама)», «ФИЗ-РА». */
export function pairName(p) {
  const name = p.tgName || p.subject;
  if (p.type !== 'lecture') return name;
  return `${name} (${TYPE_WORD.lecture}${p.note ? '-' + p.note : ''})`;
}
const dateLine = (iso) => { const d = parseDate(iso); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; };
const timeLine = (p) => `${supTime(p.start)}-${supTime(p.end)}`;

/** Строки одной пары: время, номер/аудитория/предмет, пометка, ДЗ, ссылки. */
export function pairLines(p) {
  if (p.status === 'cancelled') return [timeLine(p), `❌ ${pairName(p)} — отменена${p.reason ? ': ' + p.reason : ''}`];
  if (p.status === 'moved-away') {
    const m = p.movedTo;
    return [timeLine(p), `➡️ ${pairName(p)} — перенесена на ${dayMonthWeekday(m.date)}, ${shortTime(m.start)}, ауд. ${m.room}`];
  }
  const mark = p.status === 'moved-here' ? ` (перенос с ${dayMonthWeekday(p.movedFrom)})` : p.status === 'extra' ? ' (доп. пара)' : '';
  const out = [timeLine(p), `${p.numbers.map(keycap).join('')}пара/${p.room} - ${pairName(p)}${mark}`];
  if (p.note && p.type !== 'lecture') out.push(p.note);       // у лекции пометка уже в скобках
  if (p.changed && p.changed.teacher) out.push(`Ведёт: ${p.teacher}`);
  if (p.hw) out.push(...p.hw.split('\n').map((s) => s.trim()).filter(Boolean));
  out.push(...p.links);
  return out;
}

/** Текст одного дня или null, если в этот день нет ни пар, ни пометок. */
export function dayText(iso, data, { emoji = false } = {}) {
  const day = buildDay(iso, data);
  if (!day.pairs.length && !day.notes.length) return null;
  const wd = weekday(iso);
  const head = `${WEEKDAYS[wd].toUpperCase()}${emoji ? DAY_EMOJI[wd] : ''}\n\n${dateLine(iso)}`;
  const blocks = day.pairs.map((p) => pairLines(p).join('\n'));
  let body = blocks.join('\n\n');
  if (day.notes.length) body += (body ? '\n' : '') + day.notes.join('\n'); // пометки дня — сразу под последней парой
  return `${head}\n\n${body}`;
}

/** Дни недели (пн–сб), в которых есть что публиковать: [{date, text}]. */
export function weekDays(monday, data, opts) {
  return weekDates(monday).map((d) => ({ date: d, text: dayText(d, data, opts) })).filter((x) => x.text);
}
/** Вся неделя одним сообщением. */
export function weekText(monday, data, opts) {
  return weekDays(monday, data, opts).map((x) => x.text).join('\n\n\n');
}

// ---------------- сообщения об изменениях ----------------
/** Номер пары «как обычно» — для отменённых и перенесённых (у них в дне номера нет). */
function usualNumber(day, p) {
  if (p.kind !== 'template') return p.numbers[0] || null;
  let n = 1;
  for (const q of day.pairs) {
    if (q.kind !== 'template') continue;
    if (q.id === p.id) return n;
    n += q.slots;
  }
  return null;
}
const who = (day, p) => { const n = usualNumber(day, p); return `${n ? n + ' пара ' : ''}${p.tgName || p.subject}`; };
const VALUE = { room: (v) => `в аудитории ${v}`, teacher: (v) => `ведёт ${v}` };

/** Изменения одной пары в её день — по строке на изменение. */
export function pairChanges(p, data) {
  const day = buildDay(p.date, data);
  const head = `❗ ${longDay(p.date)}: ${who(day, p)}`;
  const out = [];
  if (p.status === 'cancelled') out.push(`${head} отменена${p.reason ? ` (${p.reason.replace(/[.\s]+$/, '')})` : ''}.`);
  else if (p.status === 'moved-away') out.push(`${head} перенесена на ${dayMonthWeekday(p.movedTo.date)}, ${shortTime(p.movedTo.start)}, ауд. ${p.movedTo.room}.`);
  else if (p.status === 'extra') out.push(`❗ ${longDay(p.date)}: дополнительная пара — ${pairName(p)}, ${shortTime(p.start)}, ауд. ${p.room}.`);
  else if (p.status === 'moved-here') out.push(`❗ ${longDay(p.date)}: ${p.tgName || p.subject} (перенос с ${dayMonthWeekday(p.movedFrom)}) — ${shortTime(p.start)}, ауд. ${p.room}.`);
  else {
    if (p.changed.room) out.push(`${head} — ${VALUE.room(p.room)} (вместо ${p.changed.room}).`);
    if (p.changed.start || p.changed.end) {
      const was = `${shortTime(p.changed.start || p.start)}–${shortTime(p.changed.end || p.end)}`;
      out.push(`${head} — в ${shortTime(p.start)}–${shortTime(p.end)} (вместо ${was}).`);
    }
    if (p.changed.teacher) out.push(`${head} — ${VALUE.teacher(p.teacher)} (вместо ${p.changed.teacher}).`);
  }
  return out;
}

/** Постоянные замены, которые начинаются на этой неделе (время — одной строкой). */
function ruleChanges(monday, data) {
  const dates = weekDates(monday);
  const starts = (data.rules || []).filter((r) => dates.includes(r.from));
  const out = [];
  const seen = new Set();
  for (const r of starts) {
    const key = `${r.pairId}|${r.from}|${r.field === 'end' ? 'start' : r.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = data.template.find((x) => x.id === r.pairId);
    if (!t) continue;
    const until = r.to ? `, по ${dayMonth(r.to)}` : ' и дальше';
    let what;
    if (r.field === 'start' || r.field === 'end') {
      const same = starts.filter((x) => x.pairId === r.pairId && x.from === r.from);
      const s = (same.find((x) => x.field === 'start') || {}).value || t.start;
      const e = (same.find((x) => x.field === 'end') || {}).value || t.end;
      what = `время ${shortTime(s)}–${shortTime(e)} (вместо ${shortTime(t.start)}–${shortTime(t.end)})`;
    } else what = `${r.field === 'room' ? 'аудитория' : 'преподаватель'} ${r.value} (вместо ${t[r.field]})`;
    out.push({ date: r.from, text: `❗ С ${dayMonthWeekday(r.from)}${until}: ${t.tgName || t.subject} — ${what}.` });
  }
  return out;
}

/** Все изменения недели по порядку дней: [{date, text}]. */
export function weekChanges(monday, data) {
  const out = [];
  for (const d of weekDates(monday)) {
    for (const p of buildDay(d, data).pairs) {
      // перенос, пришедший с этой же недели, уже описан строкой «перенесена на …»
      if (p.status === 'moved-here' && weekDates(monday).includes(p.movedFrom)) continue;
      for (const text of pairChanges(p, data)) out.push({ date: d, text });
    }
  }
  return [...out, ...ruleChanges(monday, data)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
