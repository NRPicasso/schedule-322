// Предметы и цвета (экран 19): общий список для всех версий шаблона. Только с сетью, с «Отменить».
import { h, tile } from '../dom.js';
import { S } from './state.js';
import { toast, renderSheet, sheetHead } from './ui.js';
import { reload, sendNow } from './sync.js';
import { T, go, saveDraft, online, sendUndo } from './tpl-state.js';

// цвета плиток — те же, что в style.css (.t-mun … .t-fk), контраст проверен
const COLORS = [['gpp', 'синий'], ['mp', 'голубой'], ['mun', 'бирюзовый'], ['gp', 'зелёный'], ['tp', 'янтарный'], ['upp', 'терракотовый'], ['up', 'малиновый'], ['osd', 'фиолетовый'], ['fk', 'серый']];
const RESERVED = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];
const own = (key) => (Object.prototype.hasOwnProperty.call(S.data.subjects || {}, key) ? S.data.subjects[key] : null);
const back = () => (T.back === 'pair' ? go('pair') : go(T.back === 'list' ? 'list' : 'subjects'));

export function subjectsView() {
  const keys = Object.keys(S.data.subjects || {});
  const box = h('div', { class: 'stack' },
    h('p', { class: 'small muted', style: 'margin:0', text: 'Сокращение, полное название и цвет меняются во всех неделях, в том числе прошлых; ДЗ и аудитории прошлого не меняются.' }));
  if (!online()) box.append(h('p', { class: 'banner', text: 'Предметы меняются только с интернетом.' }));
  box.append(h('ul', { class: 'links', id: 'sj-list' }, keys.map((k) => {
    const s = own(k);
    return h('li', {}, tile(k, S.data.subjects), h('span', { class: 't', style: 'font-family:var(--f-body);font-size:var(--fs-s)', text: `${k}${s.full && s.full !== k ? ' — ' + s.full : ''}` }),
      h('button', { type: 'button', class: 'btn btn-ghost', disabled: !online(), 'aria-label': 'Изменить предмет ' + k, onclick: () => go('subject', { subject: k, back: 'subjects', sj: null }), text: 'Изменить' }));
  })),
  h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'sj-new', disabled: !online(), onclick: () => go('subject', { subject: null, back: 'subjects', sj: null }), text: '+ Новый предмет' }),
  h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => go('list'), text: '‹ К версиям шаблона' }));
  return [sheetHead('Предметы и цвета', `Всего: ${keys.length}`), box];
}

export function subjectView() {
  const key = T.subject, cur = key ? own(key) : null;
  const st = T.sj || (T.sj = { name: key || '', short: cur ? cur.short : '', full: cur ? cur.full || '' : '', color: cur ? cur.color : 'gpp', tried: false });
  const errs = {};
  const name = st.name.trim();
  if (!key) {
    if (!name) errs.name = 'Впишите название, например «Криминалистика».';
    else if (RESERVED.includes(name)) errs.name = 'Такое название нельзя.';
    else if (own(name)) errs.name = 'Такой предмет уже есть — выберите его в списке.';
    else if (name.length > 100) errs.name = 'Название — до 100 знаков.';
  }
  if (!st.short.trim() || st.short.trim().length > 6) errs.short = 'Сокращение — от 1 до 6 знаков.';
  const show = st.tried ? errs : {};
  const input = (id, label, k, max, ph, hint) => {
    const inp = h('input', { class: 'input', id, name: k, type: 'text', maxlength: String(max), placeholder: ph, value: st[k], 'aria-describedby': id + '-err', 'aria-invalid': show[k] ? 'true' : null });
    inp.addEventListener('input', () => { st[k] = inp.value; if (k === 'short') { const t = document.getElementById('sj-preview'); if (t) t.textContent = inp.value || '?'; } });
    return h('div', {}, h('label', { class: 'lbl', for: id, text: label }), inp, hint ? h('div', { class: 'xs muted', style: 'margin-top:4px', text: hint }) : null, h('div', { class: 'err', id: id + '-err', role: 'alert', text: show[k] || '' }));
  };
  const box = h('div', { class: 'stack' });
  if (key) box.append(h('p', { class: 'small', style: 'margin:0', text: `Название: ${key}. Его не меняют — на него ссылаются пары; нужен другой предмет — создайте новый.` }));
  else box.append(input('sj-name', 'Название', 'name', 100, 'например, Криминалистика', 'Так предмет будет называться в шаблоне и в тексте для Telegram.'));
  box.append(input('sj-short', 'Сокращение на плитке', 'short', 6, 'например, КРИМ'), input('sj-full', 'Полное название (необязательно)', 'full', 100, 'например, Криминалистика'),
    h('div', {}, h('div', { class: 'lbl', id: 'sj-color-l', text: 'Цвет' }),
      h('div', { class: 'radio', role: 'radiogroup', 'aria-labelledby': 'sj-color-l' }, COLORS.map(([c, word]) => h('label', {},
        h('input', { type: 'radio', name: 'sj-color', value: c, checked: st.color === c, onchange: () => { st.color = c; renderSheet(); } }),
        h('span', { class: `tile t-${c}`, 'aria-hidden': 'true', id: st.color === c ? 'sj-preview' : null, text: st.short || '?' }), word)))));
  if (T.err) box.append(h('p', { class: 'banner', role: 'alert', id: 'sj-err', text: T.err }));
  box.append(h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'sj-save', disabled: !online() || T.busy, text: T.busy ? 'Сохраняю…' : 'Сохранить', onclick: () => save(errs) }),
    h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => { T.sj = null; back(); }, text: '‹ Назад без изменений' }));
  return [sheetHead(key ? `Предмет: ${key}` : 'Новый предмет', 'Предметы и цвета'), box];
}

async function save(errs) {
  const st = T.sj;
  st.tried = true;
  if (Object.keys(errs).length) { renderSheet(); const f = document.querySelector('#sheet [aria-invalid="true"]'); if (f) f.focus(); return; }
  const key = T.subject || st.name.trim();
  const prev = own(key);
  const subject = { subject: key, short: st.short.trim(), full: st.full.trim(), color: st.color };
  T.busy = true; T.err = ''; renderSheet();
  try {
    const [r] = await sendNow([{ type: 'subject.set', date: new Date().toISOString().slice(0, 10), subject, prev: prev ? { short: prev.short, full: prev.full || '', color: prev.color } : undefined }]);
    T.busy = false;
    if (r.ok) {
      S.data.subjects[key] = { short: subject.short, full: subject.full, color: subject.color }; // сразу на экране; данные с сервера придут следом
      T.sj = null;
      if (T.back === 'pair' && T.pair) { T.pair.subject = key; saveDraft(); }
      back();
      const usedInDraft = T.back === 'pair'; // новый предмет уже стоит в паре черновика — отменять нельзя
      const undo = usedInDraft && !prev ? null : prev
        ? () => sendUndo([{ type: 'subject.set', date: new Date().toISOString().slice(0, 10), subject: { subject: key, short: prev.short, full: prev.full || '', color: prev.color }, prev: { short: subject.short, full: subject.full, color: subject.color } }], 'Предмет возвращён как был')
        : () => sendUndo([{ type: 'subject.remove', date: new Date().toISOString().slice(0, 10), name: key, prev: { short: subject.short, full: subject.full, color: subject.color } }], 'Предмет удалён');
      toast(prev ? `Предмет «${key}» сохранён` : `Предмет «${key}» добавлен`, undo);
      reload();
    } else if (r.error === 'conflict') {
      T.err = r.current ? `Этот предмет уже изменил другой активист: ${r.current.short}${r.current.full ? ' — ' + r.current.full : ''}. Проверьте и сохраните ещё раз.` : 'Этот предмет удалил другой активист.';
      if (r.current) S.data.subjects[key] = { short: r.current.short, full: r.current.full, color: r.current.color };
      T.subject = r.current ? key : null; renderSheet();
    } else { T.err = 'Не сохранилось: ' + (r.message || 'ошибка данных') + '.'; renderSheet(); }
  } catch (e) {
    T.busy = false; T.err = e && e.kind === 'locked' ? e.message : 'Не сохранилось: нет связи. Попробуйте, когда появится интернет.'; renderSheet();
  }
}
