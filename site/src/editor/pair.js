// Карточка пары: ДЗ, «ДЗ нет», сообщение для группы и кнопки изменений в этот день.
import { dayMonth, shortTime } from '../format.js';
import { h, tile, fullName } from '../dom.js';
import { S, TYPE } from './state.js';
import { hasHw, dayLabel, findPair, openSheet, closeSheet, sheetHead, flushText, confirmButton } from './ui.js';
import { commit, pairOp } from './sync.js';
import { goPanel } from './panels.js';
import { hwBlock } from './hw.js';
import { fieldPanel, timePanel } from './rules.js';
import { showPairAt, cancelMove, extraById, moveOf, cancelPanel, movePanel } from './move.js';
import { changeNotice } from './telegram-sheet.js';

/** Блок «Изменения в этот день» внизу карточки пары. */
function changesSection(p) {
  const sec = h('div', { class: 'sec' }, h('div', { class: 'caps muted', text: 'Изменения в этот день' }));
  sec.append(h('div', { class: 'cols' },
    h('button', { type: 'button', class: 'btn btn-secondary', id: 'ch-room', onclick: goPanel(p, fieldPanel('room')), text: 'Аудитория' }),
    h('button', { type: 'button', class: 'btn btn-secondary', id: 'ch-time', onclick: goPanel(p, timePanel), text: 'Время' }),
    h('button', { type: 'button', class: 'btn btn-secondary', id: 'ch-teacher', onclick: goPanel(p, fieldPanel('teacher')), text: 'Преподаватель' }),
    h('button', { type: 'button', class: 'btn btn-secondary', id: 'ch-move', onclick: goPanel(p, movePanel), text: p.status === 'moved-here' ? 'Перенести ещё раз' : 'Перенести' })));
  if (p.kind === 'template') {
    if (p.status !== 'cancelled') sec.append(h('button', { type: 'button', class: 'btn btn-danger w100', id: 'ch-cancel', onclick: goPanel(p, cancelPanel), text: 'Отменить пару' }));
  } else if (p.status === 'moved-here') {
    sec.append(h('div', { class: 'cols' },
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'ch-unmove', onclick: () => cancelMove(extraById(p.id)), text: `Вернуть на ${dayMonth(p.movedFrom)}` }),
      h('button', { type: 'button', class: 'btn btn-danger', id: 'ch-cancel', onclick: goPanel(p, cancelPanel), text: 'Отменить пару' })));
  } else {
    sec.append(confirmButton({ class: 'btn btn-danger w100', id: 'ch-delete' }, 'Удалить пару', 'Нажмите ещё раз, чтобы удалить', () => {
      commit({ type: 'extra.remove', date: p.date, id: p.id }, 'Пара удалена'); closeSheet();
    }));
  }
  return sec;
}

export function openPair(date, id, ret) { openSheet(() => pairSheet(date, id), ret); }
export function pairSheet(date, id) {
  const p = findPair(date, id);
  if (!p) return [sheetHead('Пара не найдена'), h('p', { text: 'Возможно, её перенесли или удалили. Закройте карточку.' })];
  const out = [sheetHead(`${fullName(p.subject, S.data.subjects)} · ${TYPE[p.type] || ''}`,
    `${dayLabel(date)} · ${shortTime(p.start)}–${shortTime(p.end)} · ауд. ${p.room}${p.teacher ? ' · ' + p.teacher : ''}`, tile(p.subject, S.data.subjects))];
  if (p.note) out.push(h('p', { class: 'small muted', style: 'margin:-8px 0 12px', text: 'Всегда: ' + p.note }));
  if (p.status === 'moved-here') out.push(h('p', { class: 'small muted', style: 'margin:-8px 0 12px', text: `Перенесена с ${dayLabel(p.movedFrom)}` }));
  if (p.status === 'extra') out.push(h('p', { class: 'small muted', style: 'margin:-8px 0 12px', text: 'Дополнительная пара' }));
  if (p.status === 'moved-away') {
    const x = moveOf(p);
    out.push(h('div', { class: 'banner', style: 'display:flex;flex-direction:column;gap:8px' },
      h('span', { text: `Пара перенесена на ${dayLabel(p.movedTo.date)}, ${shortTime(p.movedTo.start)}, ауд. ${p.movedTo.room}. ДЗ — у перенесённой пары.` }),
      x ? h('div', { class: 'cols' },
        h('button', { type: 'button', class: 'btn btn-secondary', id: 'open-moved', onclick: () => showPairAt(x.date, x.id), text: 'Открыть новую дату' }),
        h('button', { type: 'button', class: 'btn btn-danger', id: 'unmove', onclick: () => cancelMove(x), text: 'Отменить перенос' })) : null));
    out.push(changeNotice(p));
    return out;
  }
  if (p.status === 'cancelled') {
    out.push(h('div', { class: 'banner', style: 'display:flex;flex-direction:column;gap:8px' },
      h('span', { text: 'Пара отменена' + (p.reason ? ': ' + p.reason : '') + '. ДЗ к отменённой паре группа не видит: если задание остаётся, впишите его к следующему занятию.' }),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'uncancel', onclick: () => commit(pairOp(p, { cancelled: false }), 'Пара возвращена'), text: 'Вернуть пару' })));
  }
  out.push(hwBlock(p));
  out.push(h('div', { class: 'sec' },
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', id: 'nohw', checked: p.noHw && !hasHw(p), disabled: hasHw(p),
        onchange: (e) => { flushText(); commit(pairOp(p, { noHw: e.target.checked }), e.target.checked ? 'Отмечено: ДЗ нет' : 'Отметка снята'); },
      }),
      hasHw(p) ? 'ДЗ нет — недоступно: ДЗ уже вписано' : 'ДЗ нет (группа увидит «ДЗ нет»)')));
  out.push(changeNotice(p));
  out.push(changesSection(p));
  return out;
}
