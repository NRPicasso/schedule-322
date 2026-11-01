// Мастер «Заполнить»: по всем семинарам недели по очереди.
import { weekRange, shortTime } from '../format.js';
import { h, tile, fullName } from '../dom.js';
import { $, S } from './state.js';
import { hasHw, isDone, dayLabel, weekSeminars, findPair, openSheet, closeSheet, renderSheet, sheetHead, flushText } from './ui.js';
import { commit, pairOp } from './sync.js';
import { hwBlock } from './hw.js';
import { openTelegram } from './telegram-sheet.js';

let wizard = { keys: [], i: 0 };
export function openWizard(ret) {
  const sems = weekSeminars();
  const first = sems.findIndex((p) => !isDone(p));
  wizard = { keys: sems.map((p) => [p.date, p.id]), i: first < 0 ? 0 : first };
  openSheet(wizardView, ret, true);
}
function wizardView() {
  const { keys } = wizard;
  if (wizard.i >= keys.length) {
    const ps = keys.map(([d, id]) => findPair(d, id)).filter(Boolean);
    return [sheetHead('Готово', weekRange(S.monday)), h('div', { class: 'big-check', 'aria-hidden': 'true', text: '✓' }),
      h('p', { style: 'text-align:center;margin:0 0 16px', text: `С ДЗ: ${ps.filter(hasHw).length} · «ДЗ нет»: ${ps.filter((p) => p.noHw && !hasHw(p)).length} · пропущено: ${ps.filter((p) => !isDone(p)).length}` }),
      h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'wz-telegram', onclick: (e) => { closeSheet(); openTelegram(e.currentTarget, 'days'); }, text: 'Текст для Telegram' }),
      h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: closeSheet, text: 'Вернуться к неделе' })];
  }
  const [date, id] = keys[wizard.i];
  const p = findPair(date, id);
  if (!p) { wizard.i++; return wizardView(); }
  const go = (n) => { flushText(); wizard.i = Math.max(0, n); renderSheet(); $('sheet').scrollTop = 0; };
  return [
    h('div', { class: 'steps', 'aria-hidden': 'true' }, keys.map(([d, k], i) => { const q = findPair(d, k); return h('i', { class: i === wizard.i ? 'cur' : (q && isDone(q) ? 'done' : '') }); })),
    sheetHead(fullName(p.subject, S.data.subjects), `Семинар ${wizard.i + 1} из ${keys.length} · ${dayLabel(date)} · ${shortTime(p.start)} · ауд. ${p.room}`, tile(p.subject, S.data.subjects)),
    hwBlock(p),
    h('div', { class: 'wz-foot' },
      p.noHw && !hasHw(p)
        ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => commit(pairOp(p, { noHw: false }), 'Отметка снята'), text: 'Вернуть' })
        : h('button', {
          type: 'button', class: 'btn btn-secondary', disabled: hasHw(p), title: hasHw(p) ? 'ДЗ уже вписано' : null,
          onclick: () => { commit(pairOp(p, { noHw: true }), null, { rerenderSheet: false }); go(wizard.i + 1); },
          text: 'ДЗ нет',
        }),
      h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => go(wizard.i + 1), text: wizard.i + 1 < keys.length ? 'Дальше ›' : 'Завершить' })),
    wizard.i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => go(wizard.i - 1), text: '‹ Предыдущий семинар' }) : null,
  ];
}
