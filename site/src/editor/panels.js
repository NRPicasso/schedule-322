// Общее для панелей изменений расписания (шаг 6): сетка звонков, наложения, переход «назад к паре».
import { buildDay, addDays } from '../schedule.js';
import { dayMonth, shortTime } from '../format.js';
import { h, tile, fullName } from '../dom.js';
import { newOpId } from '../editor-api.js';
import { versionAt, pairInVersion } from '../versions.js';
import { $, S, hooks } from './state.js';
import { dayLabel, findPair, renderSheet, sheetHead, flushText, SH } from './ui.js';

// Сетка звонков РГУП: из неё выбирают время переноса и доп. пары одним нажатием.
export const BELLS = [['08:00', '09:30'], ['09:40', '11:10'], ['11:40', '13:10'], ['13:20', '14:50'], ['15:00', '16:30'], ['16:50', '18:20'], ['18:30', '20:00'], ['20:10', '21:40']];
export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
export const timeOk = (t) => validTime(t[0]) && validTime(t[1]) && toMin(t[1]) > toMin(t[0]);
export const newExtraId = () => 'X-' + newOpId().replace(/^op-/, '').replace(/-/g, '').slice(0, 20);
const tplHalf = (p) => (pairInVersion(S.data, p.id, p.date) || {}).half;
export const halfSuffix = (p) => { const hf = tplHalf(p); return hf === 'top' ? ' — по верхним неделям' : hf === 'bottom' ? ' — по нижним неделям' : ''; };
export const FIELD_WORD = { room: 'аудитория', teacher: 'преподаватель', start: 'время', end: 'время' };
export const showValue = (field, v) => (field === 'start' || field === 'end' ? shortTime(v) : v);

export function backTo(date, id) { flushText(); SH.build = () => hooks.pairSheet(date, id); renderSheet(); $('sheet').scrollTop = 0; }
export function backBtn(p) { return h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => backTo(p.date, p.id), text: '‹ Назад к паре' }); }
export function goPanel(p, panel) { return () => { flushText(); SH.build = () => { const q = findPair(p.date, p.id); return q ? panel(q) : hooks.pairSheet(p.date, p.id); }; renderSheet(); $('sheet').scrollTop = 0; }; }
export const panelHead = (title, p) => sheetHead(title, `${fullName(p.subject, S.data.subjects)} · ${dayLabel(p.date)} · ${shortTime(p.start)}`, tile(p.subject, S.data.subjects));
// даты семестра — у версии шаблона, которая действует в эту дату
export const inSemester = (date) => { const v = versionAt(S.data, date); return !v.semesterStart || (date >= v.semesterStart && date <= v.semesterEnd); };
export const semesterBanner = (date) => { const v = versionAt(S.data, date); return h('p', { class: 'banner', text: `Дата вне семестра (${dayMonth(v.semesterStart)} — ${dayMonth(v.semesterEnd)}). Сохранить всё равно можно.` }); };

/** Сетка звонков + поля «Начало/Конец» для нестандартного времени (например, физкультура 14:30). */
export function timePicker(cur, onPick) {
  const custom = !BELLS.some((b) => b[0] === cur[0] && b[1] === cur[1]);
  const start = h('input', { class: 'input mono', id: 't-start', name: 'start', type: 'time', value: cur[0] });
  const end = h('input', { class: 'input mono', id: 't-end', name: 'end', type: 'time', value: cur[1] });
  const grid = h('div', { class: 'grid-times', role: 'group', 'aria-label': 'Сетка звонков' }, BELLS.map((b) => h('button', {
    type: 'button', 'aria-pressed': String(!custom && b[0] === cur[0]), 'data-start': b[0], text: `${shortTime(b[0])}–${shortTime(b[1])}`,
    onclick: (ev) => {
      grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      ev.currentTarget.setAttribute('aria-pressed', 'true');
      start.value = b[0]; end.value = b[1]; onPick([b[0], b[1]]);
    },
  })));
  const typed = () => {
    grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    onPick([start.value, end.value]);
  };
  start.addEventListener('change', typed); end.addEventListener('change', typed);
  return h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'lbl', style: 'margin:0', text: 'Время по сетке звонков' }), grid,
    h('div', { class: 'cols' }, h('div', {}, h('label', { class: 'lbl', for: 't-start', text: 'Начало' }), start), h('div', {}, h('label', { class: 'lbl', for: 't-end', text: 'Конец' }), end)));
}

/** Какая пара уже стоит в это время (кроме самой пары в этот же день). */
export function clashWith(date, t, self) {
  if (!timeOk(t)) return null;
  return buildDay(date, S.data).pairs.find((q) => !(self && q.id === self.id && q.date === self.date)
    && q.numbers.length && toMin(q.start) < toMin(t[1]) && toMin(t[0]) < toMin(q.end)) || null;
}
export const clashBanner = (c, tail = '', when = '') => h('p', { class: 'banner', text: `${when ? dayMonth(when) + ' в' : 'В'} это время уже стоит ${fullName(c.subject, S.data.subjects)} (${shortTime(c.start)}–${shortTime(c.end)}).${tail}` });

/** Ближайший следующий день, когда эта пара шаблона снова стоит в расписании (до 4 недель вперёд). */
export function nextSameDay(p) {
  for (let i = 7; i <= 28; i += 7) {
    const d = addDays(p.date, i);
    if (buildDay(d, S.data).pairs.some((q) => q.id === p.id && q.kind === 'template')) return d;
  }
  return null;
}
