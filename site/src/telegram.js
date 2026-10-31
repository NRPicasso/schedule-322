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
import { buildDay, studyDates, weekday, parseDate, addDays } from './schedule.js';
import { WEEKDAYS, dayMonth, dayMonthWeekday, longDay, shortTime } from './format.js';

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** «15:00» → «15⁰⁰», «09:40» → «9⁴⁰» (минуты надстрочными цифрами, как у активистов). */
export function supTime(hhmm) {
  const [hh, mm] = hhmm.split(':');
  return String(Number(hh)) + [...mm].map((d) => SUP[Number(d)]).join('');
}
/** 3 → «3⃣» (цифра + знак «клавиша» U+20E3, без варианта U+FE0F — как в последних сообщениях). */
export const keycap = (n) => [...String(n)].map((d) => d + '⃣').join('');

/** Эмодзи у названий дней — как в первых сообщениях активистов; включаются по желанию. */
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
  // без вложенных скобок: «… (лекция) — перенос с 5 ноября (чт)»
  const mark = p.status === 'moved-here' ? ` — перенос с ${dayMonthWeekday(p.movedFrom)}` : p.status === 'extra' ? ' — доп. пара' : '';
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
  if (day.notes.length) {
    // как у активистов — сразу под последней парой; но если у неё ДЗ или она отменена/перенесена,
    // отделяем пустой строкой, чтобы пометку не приняли за ДЗ или причину отмены
    const last = day.pairs[day.pairs.length - 1];
    const glue = !last ? '' : last.status !== 'normal' && last.status !== 'moved-here' && last.status !== 'extra' || last.hw || last.links.length ? '\n\n' : '\n';
    body += glue + day.notes.join('\n');
  }
  return `${head}\n\n${body}`;
}

/** Дни недели, в которых есть что публиковать (воскресенье — если в нём что-то есть): [{date, text}]. */
export function weekDays(monday, data, opts) {
  return studyDates(monday, data).map((d) => ({ date: d, text: dayText(d, data, opts) })).filter((x) => x.text);
}
/** Ограничение Telegram на длину одного сообщения. */
export const TG_LIMIT = 4096;
/** Вся неделя одним сообщением. */
export function weekText(monday, data, opts) {
  return weekDays(monday, data, opts).map((x) => x.text).join('\n\n\n');
}

// ---------------- сообщения об изменениях ----------------
/**
 * Как назвать пару в сообщении. Номер — тот же, что в тексте дня («3–4 пара» у сдвоенной);
 * у отменённой и перенесённой номера в дне нет, поэтому называем время.
 */
function who(p) {
  const name = p.tgName || p.subject;
  return p.numbers.length ? `${p.numbers.join('–')} пара ${name}` : `${name} в ${shortTime(p.start)}`;
}
const VALUE = { room: (v) => `в аудитории ${v}`, teacher: (v) => `ведёт ${v}` };

/** Изменения одной пары в её день — по строке на изменение. */
export function pairChanges(p, data) {
  const head = `❗ ${longDay(p.date)}: ${who(p)}`;
  const out = [];
  if (p.status === 'cancelled') out.push(`${head} отменена${p.reason ? ` (${p.reason.replace(/[.\s]+$/, '')})` : ''}.`);
  else if (p.status === 'moved-away') out.push(`${head} перенесена на ${dayMonthWeekday(p.movedTo.date)}, ${shortTime(p.movedTo.start)}, ауд. ${p.movedTo.room}.`);
  else if (p.status === 'extra') out.push(`❗ ${longDay(p.date)}: дополнительная пара — ${pairName(p)}, ${shortTime(p.start)}, ауд. ${p.room}.`);
  else if (p.status === 'moved-here') out.push(`❗ ${longDay(p.date)}: ${p.tgName || p.subject} — перенос с ${dayMonthWeekday(p.movedFrom)}, ${shortTime(p.start)}, ауд. ${p.room}.`);
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

/** Значение поля по шаблону и постоянным заменам на дату (без разовых замен дня). */
function ruledValue(data, t, field, date) {
  const rs = (data.rules || []).filter((r) => r.pairId === t.id && r.field === field && r.from <= date && (!r.to || date <= r.to))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  return rs.length ? rs[rs.length - 1].value : t[field];
}
/** Ближайший день с этой парой шаблона, начиная с даты (до 5 недель вперёд). */
function nextOccurrence(data, t, date) {
  for (let i = 0; i <= 35; i++) {
    const d = addDays(date, i);
    if (buildDay(d, data).pairs.some((q) => q.id === t.id && q.kind === 'template')) return d;
  }
  return null;
}
const FIELD_NAME = { room: 'аудитория', teacher: 'преподаватель' };
const groupKey = (f) => (f === 'end' ? 'start' : f); // начало и конец времени — одно изменение
function describe(data, t, field, date) {
  if (field === 'start') return `время ${shortTime(ruledValue(data, t, 'start', date))}–${shortTime(ruledValue(data, t, 'end', date))}`;
  return `${FIELD_NAME[field]} ${ruledValue(data, t, field, date)}`;
}

/**
 * Постоянные замены, которые начинаются или заканчиваются на этой неделе.
 * «Вместо» — то, что действовало раньше (а не шаблон: замен могло быть несколько подряд).
 */
function ruleChanges(dates, data) {
  const out = [];
  const starts = new Set();
  const items = (data.rules || []).map((r) => ({ r, t: data.template.find((x) => x.id === r.pairId), f: groupKey(r.field) })).filter((x) => x.t);
  // начало: первый день с этой парой, начиная с даты правила
  for (const { r, t, f } of items) {
    const start = nextOccurrence(data, t, r.from);
    const key = `${t.id}|${f}|${start}`;
    if (!start || !dates.includes(start) || starts.has(key)) continue;
    starts.add(key);
    const until = r.to ? `, по ${dayMonth(r.to)}` : ' и дальше';
    const was = describe(data, t, f, addDays(r.from, -1)).replace(/^\S+ /, '');
    out.push({ date: start, text: `❗ С ${dayMonthWeekday(start)}${until}: ${t.tgName || t.subject} — ${describe(data, t, f, start)} (вместо ${was}).` });
  }
  // конец: первый день с этой парой после даты «по» — объявляем, что стало
  // (если в этот же день начинается другая замена, о ней уже сказано выше)
  const ends = new Set();
  for (const { r, t, f } of items) {
    if (!r.to) continue;
    const after = nextOccurrence(data, t, addDays(r.to, 1));
    const key = `${t.id}|${f}|${after}`;
    if (!after || !dates.includes(after) || starts.has(key) || ends.has(key)) continue;
    ends.add(key);
    const now = describe(data, t, f, after);
    const back = now === describe({ ...data, rules: [] }, t, f, after) ? 'снова ' : '';
    out.push({ date: after, text: `❗ С ${dayMonthWeekday(after)}: ${t.tgName || t.subject} — ${back}${now}.` });
  }
  return out;
}

/** Все изменения недели по порядку дней: [{date, text}]. */
export function weekChanges(monday, data) {
  const dates = studyDates(monday, data);
  const all = [...studyDates(monday, data), addDays(monday, 6)];
  const out = [];
  for (const d of dates) {
    for (const p of buildDay(d, data).pairs) {
      // перенос, пришедший с этой же недели, уже описан строкой «перенесена на …»
      if (p.status === 'moved-here' && all.includes(p.movedFrom)) continue;
      for (const text of pairChanges(p, data)) out.push({ date: d, text });
    }
  }
  return [...out, ...ruleChanges(all, data)].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
