// Даты расписания — строки ГГГГ-ММ-ДД. Считаем в UTC, чтобы часовой пояс телефона не сдвигал день.
// Отдельный модуль: им пользуются и сборка дня (schedule.js), и версии шаблона (versions.js).

const DAY_MS = 24 * 60 * 60 * 1000;

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
