// Форматирование дат и текста по-русски. Чистые функции — проверяются тестами.
import { parseDate, addDays } from './schedule.js';

export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_DATIVE = ['воскресенью', 'понедельнику', 'вторнику', 'среде', 'четвергу', 'пятнице', 'субботе'];
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function dayMonth(iso) {
  const d = parseDate(iso);
  return `${d.getUTCDate()} ${MONTHS_GENITIVE[d.getUTCMonth()]}`;
}
export function monthName(iso) {
  return MONTHS_GENITIVE[parseDate(iso).getUTCMonth()];
}
/** «Вторник, 3 ноября» — для заголовков. */
export function longDay(iso) {
  return `${capitalize(WEEKDAYS[parseDate(iso).getUTCDay()])}, ${dayMonth(iso)}`;
}
/** «7 ноября (сб)» — внутри фразы, чтобы не склонять день недели. */
export function dayMonthWeekday(iso) {
  return `${dayMonth(iso)} (${WEEKDAYS_SHORT[parseDate(iso).getUTCDay()]})`;
}
/** «К четвергу, 5 ноября» — для списка ДЗ. */
export function toDay(iso) {
  return `К ${WEEKDAYS_DATIVE[parseDate(iso).getUTCDay()]}, ${dayMonth(iso)}`;
}
export function weekRange(monday) {
  return `${dayMonth(monday)} — ${dayMonth(addDays(monday, 5))}`;
}
/** «09:40» → «9:40». */
export function shortTime(hhmm) {
  return hhmm.replace(/^0(\d)/, '$1');
}
/** Ссылка для показа: без протокола, длинный номер чата группы заменён на «…». */
export function shortLink(url) {
  return url.replace(/^https?:\/\//, '').replace(/^t\.me\/c\/\d+\//, 't.me/…/');
}
