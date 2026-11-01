// Пометки дня («Сменка», «Сдаём КСУ»).
import { longDay } from '../format.js';
import { h } from '../dom.js';
import { S } from './state.js';
import { toast, openSheet, sheetHead } from './ui.js';
import { commit } from './sync.js';

const NOTE_PRESETS = ['Сменка', 'Полная посещаемость', 'Сдаём КСУ', 'Принести кодекс', 'Контрольная'];

export function openNotes(date, ret) { openSheet(() => notesSheet(date), ret); }
function notesSheet(date) {
  const notes = S.data.dayNotes.filter((n) => n.date === date).map((n) => n.text);
  const input = h('input', { class: 'input', id: 'note', name: 'note', type: 'text', maxlength: '200', placeholder: 'например, Сдаём КСУ' });
  const add = (text) => {
    const t = text.trim();
    if (!t) return;
    if (notes.length >= 10) { toast('Не больше 10 пометок в день'); return; }
    commit({ type: 'note.add', date, text: t }, 'Пометка добавлена');
  };
  return [sheetHead('Пометки дня', longDay(date)), h('div', { class: 'stack' },
    notes.length
      ? h('ul', { class: 'links' }, notes.map((t) => h('li', {}, h('span', { class: 't', style: 'font-family:var(--f-body);font-size:var(--fs-m)', text: t }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Удалить пометку ' + t, onclick: () => commit({ type: 'note.remove', date, text: t }, 'Пометка удалена'), text: '✕' }))))
      : h('p', { class: 'small muted', style: 'margin:0', text: 'Пометок пока нет. «Сменка» на физкультуре появляется сама — её вписывать не нужно.' }),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Частые пометки' }, NOTE_PRESETS.filter((c) => !notes.includes(c)).map((c) => h('button', { type: 'button', class: 'chip', onclick: () => add(c), text: c }))),
    h('div', {}, h('label', { class: 'lbl', for: 'note', text: 'Своя пометка' }), input),
    h('button', { type: 'button', class: 'btn btn-primary w100', onclick: () => { add(input.value); input.value = ''; }, text: 'Добавить' }))];
}
