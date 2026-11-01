// Перенос, отмена пары и дополнительная пара.
import { buildDay, mondayOf, weekday } from '../schedule.js';
import { dayMonth, longDay, shortTime } from '../format.js';
import { h, halfLabel, fullName } from '../dom.js';
import { versionAt } from '../versions.js';
import { $, S, TYPE, hooks } from './state.js';
import { dayLabel, openSheet, closeSheet, sheetHead, SH } from './ui.js';
import { commit, pairOp } from './sync.js';
import { timeOk, newExtraId, backTo, backBtn, panelHead, inSemester, semesterBanner, timePicker, clashWith, clashBanner } from './panels.js';

/** Вернуть перенесённую пару на исходную дату — вместе с ДЗ, вписанным уже после переноса. */
function moveBackOps(x) {
  const src = S.data.entries.find((e) => e.date === x.srcDate && e.pairId === x.srcPairId) || {};
  const hw = x.hw || '', links = x.links || [], noHw = !!x.noHw && !hw && !links.length;
  const ops = [{ type: 'extra.remove', date: x.date, id: x.id, srcDate: x.srcDate, srcPairId: x.srcPairId }];
  if (hw !== (src.hw || '') || JSON.stringify(links) !== JSON.stringify(src.links || []) || noHw !== !!src.noHw) {
    ops.push({ type: 'entry', date: x.srcDate, pairId: x.srcPairId, patch: { hw, links, noHw } });
  }
  return ops;
}
/** Открыть карточку пары на другой неделе (после переноса и его отмены). */
export function showPairAt(date, id) { S.monday = mondayOf(date); if (SH.build) SH.build = () => hooks.pairSheet(date, id); hooks.render(); $('sheet').scrollTop = 0; }

export function cancelMove(x) {
  if (!x) return;
  commit(moveBackOps(x), `Перенос отменён — пара снова ${dayMonth(x.srcDate)}`, { rerenderSheet: false, afterUndo: () => showPairAt(x.srcDate, x.srcPairId) });
  showPairAt(x.srcDate, x.srcPairId);
}
export const extraById = (id) => (S.data.extras || []).find((x) => x.id === id);
export const moveOf = (p) => (S.data.extras || []).find((x) => x.srcDate === p.date && x.srcPairId === p.id && !x.cancelled);

export function cancelPanel(p) {
  const input = h('input', { class: 'input', id: 'reason', name: 'reason', type: 'text', maxlength: '200', placeholder: 'например, преподаватель заболел' });
  const moved = p.status === 'moved-here' ? extraById(p.id) : null;
  const explain = moved
    ? `Перенос снимется, а пара ${dayMonth(moved.srcDate)} останется в расписании зачёркнутой с причиной. Вернуть — кнопкой «Вернуть пару» в той карточке.`
    : 'Пара останется в расписании со штампом «Отменено» и причиной. Вернуть её можно одной кнопкой.';
  return [panelHead('Отменить пару', p), h('div', { class: 'stack' },
    h('div', {}, h('label', { class: 'lbl', for: 'reason', text: 'Причина (необязательно)' }),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Частые причины', style: 'margin-bottom:8px' }, ['Преподаватель заболел', 'Перенос — дата позже', 'Мероприятие'].map((r) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = r; }, text: r }))), input),
    h('p', { class: 'small muted', style: 'margin:0', text: explain }),
    h('button', { type: 'button', class: 'btn btn-danger btn-big w100', id: 'c-save', text: `Отменить пару ${dayMonth(p.date)}`, onclick: () => {
      const reason = input.value.trim();
      if (moved) {
        const ops = moveBackOps(moved);
        ops.push({ type: 'entry', date: moved.srcDate, pairId: moved.srcPairId, patch: { cancelled: true, reason } });
        commit(ops, 'Пара отменена', { rerenderSheet: false, afterUndo: () => showPairAt(moved.srcDate, moved.srcPairId) });
        showPairAt(moved.srcDate, moved.srcPairId);
        return;
      }
      commit(pairOp(p, { cancelled: true, reason }), 'Пара отменена');
      backTo(p.date, p.id);
    } }), backBtn(p))];
}

export function movePanel(p) {
  let date = ''; let t = [p.start, p.end];
  const dIn = h('input', { class: 'input', id: 'm-date', name: 'date', type: 'date' });
  const hint = h('div', { class: 'xs muted', style: 'margin-top:4px' });
  const room = h('input', { class: 'input mono', id: 'm-room', name: 'room', type: 'text', maxlength: '30', value: p.room });
  const err = h('div', { class: 'err', role: 'alert' }); const warn = h('div', { class: 'stack', style: 'gap:8px' }); const preview = h('div');
  const fromDate = p.status === 'moved-here' ? p.movedFrom : p.date;
  const upd = () => {
    warn.replaceChildren(); preview.replaceChildren(); hint.replaceChildren(); err.textContent = '';
    if (!date) return;
    hint.append(longDay(date) + ' · ', halfLabel(buildDay(date, S.data).half));
    if (!inSemester(date)) warn.append(semesterBanner(date));
    if (weekday(date) === 0) warn.append(h('p', { class: 'banner', text: 'Это воскресенье. Перенести всё равно можно.' }));
    if (date === p.date && p.kind === 'template') warn.append(h('p', { class: 'banner', text: 'Это тот же день. Чтобы поменять только время, вернитесь к паре и нажмите «Время».' }));
    const c = clashWith(date, t, p);
    if (c) warn.append(clashBanner(c));
    preview.append(h('div', { class: 'lbl', text: 'Было → стало' }), h('div', { class: 'ba' },
      h('div', { class: 'variant' }, h('b', { text: dayLabel(fromDate) }), h('div', { class: 'mono', text: `${shortTime(p.start)} · ауд. ${p.room}` })),
      h('span', { 'aria-hidden': 'true', text: '→' }),
      h('div', { class: 'variant' }, h('b', { text: dayLabel(date) }), h('div', { class: 'mono', text: `${shortTime(t[0] || p.start)} · ауд. ${room.value.trim() || p.room}` }))));
  };
  dIn.addEventListener('change', () => { date = dIn.value; upd(); });
  room.addEventListener('input', upd);
  const picker = timePicker(t, (v) => { t = v; upd(); });
  return [panelHead(p.status === 'moved-here' ? 'Перенести ещё раз' : 'Перенести пару', p), h('div', { class: 'stack' },
    h('div', {}, h('label', { class: 'lbl', for: 'm-date', text: 'Новая дата' }), dIn, hint), picker,
    h('div', {}, h('label', { class: 'lbl', for: 'm-room', text: 'Аудитория' }), room), preview, warn, err,
    h('p', { class: 'small muted', style: 'margin:0', text: 'На старой дате пара останется со штампом «Перенесено». ДЗ переедет вместе с парой.' }),
    h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'm-save', text: 'Перенести', onclick: () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = 'Выберите новую дату.'; dIn.focus(); return; }
      if (!timeOk(t)) { err.textContent = 'Время окончания должно быть позже начала.'; return; }
      const r = room.value.trim() || p.room;
      const label = `Перенесено на ${dayMonth(date)}, ${shortTime(t[0])}`;
      const back = () => showPairAt(p.date, p.id); // «Отменить» в плашке — вернуться к паре на старой дате
      let id = p.id;
      if (p.kind === 'extra') commit({ type: 'extra.update', date, id: p.id, patch: { date, start: t[0], end: t[1], room: r } }, label, { rerenderSheet: false, afterUndo: back });
      else {
        id = newExtraId();
        commit({ type: 'extra.add', date, extra: { id, date, start: t[0], end: t[1], room: r, teacher: p.teacher, slots: p.slots, srcDate: p.date, srcPairId: p.id, hw: p.hw, links: [...p.links], noHw: p.noHw } }, label, { rerenderSheet: false, afterUndo: back });
      }
      showPairAt(date, id);
    } }), backBtn(p))];
}

/** Дополнительная пара в выбранный день: предмет из шаблона или «другое». */
export function openAddPair(date, ret) { openSheet(() => addPairSheet(date), ret); }
function addPairSheet(date) {
  let t = ['18:30', '20:00'];
  const subjects = [...new Map(versionAt(S.data, date).pairs.map((x) => [x.subject + '|' + x.type, x])).values()]; // предметы шаблона этой даты
  const sel = h('select', { class: 'input', id: 'a-subject', name: 'subject' },
    subjects.map((x, i) => h('option', { value: String(i), text: `${fullName(x.subject, S.data.subjects)} · ${TYPE[x.type] || ''}` })), h('option', { value: 'other', text: 'Другое…' }));
  const other = h('input', { class: 'input', id: 'a-other', name: 'other', type: 'text', maxlength: '100', placeholder: 'например, Консультация к экзамену' });
  const otherBox = h('div', { hidden: true }, h('label', { class: 'lbl', for: 'a-other', text: 'Название' }), other);
  const room = h('input', { class: 'input mono', id: 'a-room', name: 'room', type: 'text', maxlength: '30', value: subjects[0] ? subjects[0].room : '' });
  const err = h('div', { class: 'err', role: 'alert' }); const warn = h('div', { class: 'stack', style: 'gap:8px' });
  const check = () => {
    warn.replaceChildren();
    if (!inSemester(date)) warn.append(semesterBanner(date));
    const c = clashWith(date, t, null); if (c) warn.append(clashBanner(c, ' Добавить всё равно можно.'));
  };
  sel.addEventListener('change', () => { otherBox.hidden = sel.value !== 'other'; if (sel.value !== 'other') room.value = subjects[Number(sel.value)].room; });
  const picker = timePicker(t, (v) => { t = v; check(); }); check();
  return [sheetHead('Дополнительная пара', longDay(date)), h('div', { class: 'stack' },
    h('div', {}, h('label', { class: 'lbl', for: 'a-subject', text: 'Предмет' }), sel), otherBox, picker, warn,
    h('div', {}, h('label', { class: 'lbl', for: 'a-room', text: 'Аудитория' }), room), err,
    h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'a-save', text: 'Добавить пару', onclick: () => {
      if ((S.data.extras || []).filter((x) => x.date === date && !x.cancelled).length >= 8) { err.textContent = 'В один день — не больше 8 дополнительных пар.'; return; }
      let base;
      if (sel.value === 'other') {
        const n = other.value.trim();
        if (!n) { err.textContent = 'Укажите название.'; other.focus(); return; }
        base = { subject: n, tgName: n, type: 'other', teacher: '' };
      } else base = subjects[Number(sel.value)];
      if (!timeOk(t)) { err.textContent = 'Время окончания должно быть позже начала.'; return; }
      commit({ type: 'extra.add', date, extra: { id: newExtraId(), date, start: t[0], end: t[1], slots: 1, subject: base.subject, tgName: base.tgName || base.subject, type: base.type, room: room.value.trim(), teacher: base.teacher || '', hw: '', links: [] } }, 'Пара добавлена');
      closeSheet();
    } }))];
}
