// Конфликт двух правок одной пары: выбор варианта, ничего не затирается молча.
import { longDay, shortTime } from '../format.js';
import { h, fullName } from '../dom.js';
import { $, S, hooks } from './state.js';
import { toast, closeDialog, dayLabel, findPair } from './ui.js';
import { commit } from './sync.js';

// Для пары шаблона сравниваем записи дня, для переноса и доп. пары — саму доп. пару.
export function showConflict(op, current) {
  const isExtra = op.type === 'extra.update';
  const local = () => (isExtra ? (S.data.extras || []).find((x) => x.id === op.id) : S.data.entries.find((x) => x.date === op.date && x.pairId === op.pairId));
  const pair = (isExtra ? findPair((local() || current || op).date, op.id) : findPair(op.date, op.pairId)) || current || {};
  const mine = { subject: pair.subject, ...op.patch };
  const theirs = current || { hw: '', links: [] };
  const done = closeDialog;
  // показываем только то, что меняли: ДЗ, дату, аудиторию, время, преподавателя, отмену
  const keys = Object.keys(op.patch);
  const describe = (x) => {
    const out = [];
    if (keys.some((k) => k === 'hw' || k === 'links' || k === 'noHw')) out.push(x.hw || '(без подписи)', ...(x.links || []), x.noHw ? '«ДЗ нет»' : '');
    if (keys.includes('date')) out.push('Дата: ' + (x.date ? dayLabel(x.date) : '—'));
    if (keys.includes('room')) out.push('Аудитория: ' + (x.room || 'как обычно'));
    if (keys.includes('start') || keys.includes('end')) out.push('Время: ' + (x.start ? `${shortTime(x.start)}–${shortTime(x.end)}` : 'как обычно'));
    if (keys.includes('teacher')) out.push('Преподаватель: ' + (x.teacher || 'как обычно'));
    if (keys.includes('cancelled')) out.push(x.cancelled ? 'Пара отменена' + (x.reason ? ': ' + x.reason : '') : 'Пара не отменена');
    return out.filter(Boolean).join('\n');
  };
  const again = (patch) => (isExtra ? { type: 'extra.update', date: op.date, id: op.id, patch } : { type: 'entry', date: op.date, pairId: op.pairId, patch });
  const setServerVersion = () => { const e = local(); if (e) e.version = current ? current.version || 0 : 0; };
  const keepTheirs = () => {
    if (current) { const e = local(); if (e) Object.assign(e, current); else if (isExtra) S.data.extras.push({ ...current }); }
    else S.data.entries = S.data.entries.filter((x) => !(x.date === op.date && x.pairId === op.pairId)); // на сервере записи нет
    done(); hooks.render(); toast('Оставлен вариант другого активиста');
  };
  const keepMine = () => {
    setServerVersion(); done();
    commit(again(op.patch), 'Сохранён ваш вариант', { undoable: false });
  };
  const mergeLinks = () => {
    setServerVersion(); done();
    const links = [...new Set([...(theirs.links || []), ...(mine.links || [])])].slice(0, 10);
    commit(again({ ...op.patch, links }), 'Ссылки объединены', { undoable: false });
  };
  $('dialog').replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-title' }, h('div', { class: 'box' },
    h('h2', { id: 'cf-title', text: 'Эту пару уже изменил другой активист' }),
    h('p', { class: 'small muted', style: 'margin:0', text: `${fullName(mine.subject || '', S.data.subjects)} · ${longDay(op.date)}. Какой вариант оставить?` }),
    h('div', { class: 'cols' },
      h('div', { class: 'variant' }, h('b', { text: 'Вариант другого активиста' }), h('div', { style: 'white-space:pre-wrap', text: describe(theirs) })),
      h('div', { class: 'variant' }, h('b', { text: 'Ваш вариант' }), h('div', { style: 'white-space:pre-wrap', text: describe(mine) }))),
    h('div', { class: 'cols' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: keepTheirs, text: 'Оставить тот вариант' }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: keepMine, text: 'Оставить мой' })),
    'links' in op.patch ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: mergeLinks, text: 'Объединить ссылки' }) : null)));
  $('dialog').querySelector('button').focus();
}
