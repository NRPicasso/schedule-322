// Общие куски интерфейса редактора: плашка-тост, окна по одному, нижний лист, отложенное сохранение текста.
import { buildDay, studyDates, weekday } from '../schedule.js';
import { dayMonth, WEEKDAYS_SHORT } from '../format.js';
import { h } from '../dom.js';
import { $, S } from './state.js';

// Окна (конфликт, отказ) показываются строго по одному: новое не затирает открытое, выбор не теряется.
const dialogs = [];
let dialogOpen = false;
export function queueDialog(show) { dialogs.push(show); pumpDialog(); }
function pumpDialog() { if (dialogOpen || !dialogs.length) return; dialogOpen = true; dialogs.shift()(); }
export function closeDialog() { $('dialog').replaceChildren(); dialogOpen = false; pumpDialog(); }

let toastTimer = null;
export function toast(text, undo) {
  const t = $('toast');
  t.replaceChildren(h('span', { text }));
  if (undo) t.append(h('button', { type: 'button', onclick: () => { t.hidden = true; undo(); }, text: 'Отменить' }));
  t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 10000 : 3000);
}
export const isActive = (p) => p.numbers.length > 0;
export const hasHw = (p) => !!(p.hw || p.links.length);
export const isDone = (p) => hasHw(p) || p.noHw;
export const dayLabel = (date) => `${WEEKDAYS_SHORT[weekday(date)]} ${dayMonth(date)}`;
export function weekSeminars() {
  return studyDates(S.monday, S.data).flatMap((d) => buildDay(d, S.data).pairs.filter((p) => p.type === 'seminar' && isActive(p)));
}
export function findPair(date, id) { return buildDay(date, S.data).pairs.find((p) => p.id === id); }

// ---------------- нижний лист ----------------
/** Что сейчас открыто в нижнем листе: build — функция, которая рисует содержимое; ret — куда вернуть фокус. */
export const SH = { build: null, ret: null };
export function openSheet(build, ret, full = false) {
  SH.build = build; SH.ret = ret || document.activeElement;
  const sh = $('sheet'), sc = $('scrim');
  sh.classList.toggle('full', full); renderSheet();
  sh.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { sh.classList.add('open'); sc.classList.add('open'); (sh.querySelector('textarea,input,button') || sh).focus(); });
}
export function closeSheet() {
  flushText();
  const sh = $('sheet'), sc = $('scrim');
  sh.classList.remove('open'); sc.classList.remove('open'); SH.build = null;
  setTimeout(() => { if (!SH.build) { sh.hidden = true; sc.hidden = true; } }, 220);
  if (SH.ret && document.contains(SH.ret)) SH.ret.focus();
}
export function renderSheet() {
  if (!SH.build) return;
  const sh = $('sheet'); const y = sh.scrollTop;
  sh.replaceChildren(h('div', { class: 'grab', 'aria-hidden': 'true' }), ...[].concat(SH.build()).filter(Boolean));
  sh.scrollTop = y;
}
export function sheetHead(title, sub, lead) {
  return h('div', { class: 'sh-head' }, lead || null,
    h('div', { style: 'flex:1;min-width:0' }, h('h2', { id: 'sheet-title', text: title }), sub ? h('div', { class: 'small muted', text: sub }) : null),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onclick: closeSheet, text: '✕' }));
}
$('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SH.build) closeSheet(); });

// текст ДЗ сохраняется через секунду после остановки ввода или при уходе из поля
export const TX = { pending: null, timer: null };
export function flushText() { if (TX.pending) { const f = TX.pending; TX.pending = null; clearTimeout(TX.timer); f(); } }

/** Кнопка, которая срабатывает со второго нажатия (для необратимого на вид: удаление доп. пары). */
export function confirmButton(attrs, text, confirmText, action) {
  let armed = false, timer = null;
  const btn = h('button', { type: 'button', ...attrs, text });
  btn.addEventListener('click', () => {
    if (armed) { clearTimeout(timer); action(); return; }
    armed = true; btn.textContent = confirmText; btn.classList.add('armed');
    timer = setTimeout(() => { armed = false; btn.textContent = text; btn.classList.remove('armed'); }, 5000);
  });
  return btn;
}
