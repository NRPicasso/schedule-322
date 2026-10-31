// Время и выбор дня. Группа учится в Санкт-Петербурге, поэтому «сегодня» — всегда по Москве,
// даже если телефон стоит в другом часовом поясе.
import { addDays, weekday, toMinutes, buildDay } from './schedule.js';

const SEARCH_DAYS = 21; // дальше трёх недель «следующий учебный день» не ищем (каникулы)

/** Дата и минуты от полуночи по московскому времени. */
export function moscowNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const hasPairs = (iso, data) => buildDay(iso, data).pairs.some((p) => p.numbers.length > 0);

/** Ближайший день после iso, в который есть хотя бы одна пара. */
export function nextStudyDay(iso, data) {
  for (let i = 1; i <= SEARCH_DAYS; i++) {
    const d = addDays(iso, i);
    if (hasPairs(d, data)) return d;
  }
  return addDays(iso, 1);
}

/** Какую вкладку открыть: днём — «Сегодня», после 18:30 и в воскресенье — следующий учебный день. */
export function defaultView(now, data) {
  const after = toMinutes(data.settings.tomorrowAfter || '18:30');
  if (weekday(now.date) === 0 || now.minutes >= after) {
    return { tab: 'tomorrow', date: nextStudyDay(now.date, data) };
  }
  return { tab: 'today', date: now.date };
}

/** Какая пара идёт сейчас и какая следующая (только пары, которые состоятся). */
export function nowAndNext(day, minutes) {
  const active = day.pairs.filter((p) => p.numbers.length > 0);
  const current = active.find((p) => toMinutes(p.start) <= minutes && minutes < toMinutes(p.end)) || null;
  const next = active.find((p) => toMinutes(p.start) > minutes) || null;
  return {
    current, next,
    minutesLeft: current ? toMinutes(current.end) - minutes : null,
    minutesPassed: current ? minutes - toMinutes(current.start) : null,
    minutesToNext: next ? toMinutes(next.start) - minutes : null,
  };
}

/** Изменение свежее, если сделано не раньше чем 48 часов назад. */
export function isRecent(updatedAt, nowMs = Date.now()) {
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) && nowMs - t <= 48 * 60 * 60 * 1000 && t <= nowMs + 60 * 1000;
}

/** «?now=2026-11-03T14:05» в адресе подменяет текущее время — для проверки и показа. */
export function parseNowOverride(search) {
  const m = /[?&]now=(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(search || '');
  if (!m) return null;
  const [, date, hh, mm] = m;
  if (Number(hh) > 23 || Number(mm) > 59) return null;
  return { date, minutes: Number(hh) * 60 + Number(mm) };
}
