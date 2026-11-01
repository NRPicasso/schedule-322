// Черновик версии шаблона (экраны 16–17): даты семестра, опорная неделя, пары по дням,
// карточка пары и предпросмотр недели. Всё меняет только черновик на телефоне — на сервер
// версия уходит с экрана «Что изменится» (template.js).
import { buildDay, addDays, mondayOf } from '../schedule.js';
import { dayMonth, longDay, shortTime, weekRange, WEEKDAYS, WEEKDAYS_SHORT } from '../format.js';
import { h, tile, fullName } from '../dom.js';
import { versionsOf, sortVersions, halfIn, overlaps, pairErrors, draftErrors, newPairId } from '../versions.js';
import { S, nowMsk } from './state.js';
import { renderSheet, sheetHead, confirmButton } from './ui.js';
import { timePicker } from './panels.js';
import { T, go, saveDraft, dropDraft, pairsWord, TYPE_WORD } from './tpl-state.js';
const DAYS = [1, 2, 3, 4, 5, 6];
const HALF_WORD = { both: 'обе недели', top: 'верх', bottom: 'низ' };
const clone = (x) => JSON.parse(JSON.stringify(x));
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const byStart = (a, b) => toMin(a.start || '00:00') - toMin(b.start || '00:00');

/** Версия, которую сейчас показываем: черновик или (только просмотр) сохранённая. */
function shown() {
  if (T.readonly) return versionsOf(S.data).find((v) => v.id === T.readonly) || null;
  return T.draft;
}
/** Данные сайта, где вместо сохранённой версии — черновик (для предпросмотра). */
function dataWithDraft(v) {
  return { ...S.data, versions: sortVersions([...versionsOf(S.data).filter((x) => x.id !== v.id), v]) };
}

// ---------- 16. версия: даты и пары ----------
export function editView() {
  const v = shown();
  if (!v) { go('list'); return []; }
  const ro = !!T.readonly;
  const box = h('div', { class: 'stack' });
  const out = [sheetHead(`Версия с ${dayMonth(v.from)} ${v.from.slice(0, 4)}`, ro ? 'Только просмотр' : 'Черновик · не сохранён'), box];
  if (T.err) box.append(h('p', { class: 'banner', role: 'alert', id: 'tpl-err', text: T.err }));

  // семестр и недели
  const monday = mondayOf(v.from);
  const sec = h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'caps muted', text: 'Семестр и недели' }));
  const errs = ro ? {} : draftErrors(S.data, v, nowMsk().date);
  if (ro) {
    sec.append(h('p', { class: 'small', style: 'margin:0', text: `Семестр: ${v.semesterStart ? dayMonth(v.semesterStart) : '—'} — ${v.semesterEnd ? dayMonth(v.semesterEnd) : '—'}. Неделя с ${dayMonth(mondayOf(v.anchorWeek))} — ${v.anchorHalf === 'top' ? 'верхняя' : 'нижняя'}.` }));
  } else {
    const field = (id, label, key) => {
      const inp = h('input', { class: 'input', id, name: key, type: 'date', value: v[key] || '', 'aria-describedby': 'tpl-sem-err' });
      inp.addEventListener('change', () => { v[key] = inp.value; saveDraft(); renderSheet(); });
      return h('div', {}, h('label', { class: 'lbl', for: id, text: label }), inp);
    };
    const hint = (half) => {
      const other = half === 'top' ? 'нижняя' : 'верхняя', same = half === 'top' ? 'верхняя' : 'нижняя';
      return `Значит, ${dayMonth(addDays(monday, 7))} — ${other}, ${dayMonth(addDays(monday, 14))} — ${same}.`;
    };
    const setHalf = (half) => { v.anchorWeek = monday; v.anchorHalf = half; saveDraft(); renderSheet(); };
    sec.append(h('div', { class: 'cols' }, field('tpl-sem-start', 'Начало семестра', 'semesterStart'), field('tpl-sem-end', 'Конец семестра', 'semesterEnd')),
      h('div', { class: 'err', id: 'tpl-sem-err', role: 'alert', text: errs.semester || '' }),
      h('div', { class: 'lbl', id: 'tpl-half-l', style: 'margin:0', text: `Неделя с ${dayMonth(monday)} —` }),
      h('div', { class: 'radio', role: 'radiogroup', 'aria-labelledby': 'tpl-half-l' },
        ...['top', 'bottom'].map((half) => h('label', {}, h('input', { type: 'radio', name: 'tpl-half', value: half, checked: v.anchorWeek === monday ? v.anchorHalf === half : halfIn(v, monday) === half, onchange: () => setHalf(half) }), half === 'top' ? 'верхняя' : 'нижняя'))),
      h('div', { class: 'xs muted', text: hint(halfIn(v, monday)) }));
  }
  box.append(sec);

  // пары по дням
  const pairsSec = h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'caps muted', text: `Пары · ${pairsWord(v.pairs.length)}` }),
    h('div', { class: 'chips wrap', role: 'group', 'aria-label': 'День недели' }, DAYS.map((d) => h('button', {
      type: 'button', class: 'chip', id: 'tpl-day-' + d, 'aria-pressed': String(T.day === d), onclick: () => { T.day = d; renderSheet(); },
      text: `${WEEKDAYS_SHORT[d]} · ${v.pairs.filter((t) => t.day === d).length}` }))));
  const dayPairs = v.pairs.filter((t) => t.day === T.day).sort(byStart);
  if (!dayPairs.length) pairsSec.append(h('p', { class: 'small muted', style: 'margin:0', text: 'В этот день пар нет.' }));
  pairsSec.append(...dayPairs.map((t) => {
    const bad = !ro && Object.keys(pairErrors(t)).length;
    const label = `${shortTime(t.start || '—')}–${shortTime(t.end || '—')}, ${fullName(t.subject || '', S.data.subjects)}, ${TYPE_WORD[t.type] || ''}, ${HALF_WORD[t.half]}${t.room ? ', аудитория ' + t.room : ''}`;
    return h('button', { type: 'button', class: 'prow tpl-pair', 'data-id': t.id, disabled: ro, 'aria-label': label + (bad ? ', есть ошибка' : ''),
      onclick: () => go('pair', { pair: clone(t), pairNew: false }) },
      h('span', { class: 'tm' }, shortTime(t.start || '—'), h('span', { text: shortTime(t.end || '—') })), tile(t.subject || '?', S.data.subjects),
      h('span', { class: 'mid' }, h('span', { class: 'subj', text: fullName(t.subject || '—', S.data.subjects) }),
        h('span', { class: 'meta' }, h('span', { text: TYPE_WORD[t.type] || '' }), t.room ? h('span', { text: 'ауд. ' + t.room }) : null,
          t.half !== 'both' ? h('span', { class: 'pill', text: HALF_WORD[t.half] }) : null, t.slots === 2 ? h('span', { class: 'pill', text: 'сдвоенная' }) : null,
          bad ? h('span', { class: 'pill warn', text: 'ошибка' }) : null)));
  }));
  if (!ro) {
    pairsSec.append(h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'tpl-add-pair', onclick: () => {
      const subj = Object.keys(S.data.subjects || {})[0] || '';
      go('pair', { pairNew: true, pair: { id: newPairId(S.data, v.pairs), day: T.day, half: 'both', start: '09:40', end: '11:10', slots: 1, subject: subj, tgName: '', type: 'seminar', room: '', teacher: '', note: '' } });
    }, text: `+ Пара: ${WEEKDAYS_SHORT[T.day]}` }));
    const ov = overlaps(v.pairs);
    if (ov.length) pairsSec.append(h('p', { class: 'banner', id: 'tpl-overlap', text: 'Накладываются (сохранить можно): ' + ov.map((o) => `${WEEKDAYS_SHORT[o.day]}${o.half === 'top' ? ' верх' : ' низ'}: ${o.a.subject} ${shortTime(o.a.start)}–${shortTime(o.a.end)} и ${o.b.subject} ${shortTime(o.b.start)}–${shortTime(o.b.end)}`).join('; ') + '.' }));
    if (errs.pairs) pairsSec.append(h('p', { class: 'err', role: 'alert', text: errs.pairs }));
  }
  box.append(pairsSec);

  // кнопки
  box.append(h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'tpl-preview', onclick: () => go('preview', { previewMonday: mondayOf(v.from) }), text: 'Предпросмотр недели' }));
  if (ro) {
    box.append(h('button', { type: 'button', class: 'btn btn-primary w100', id: 'tpl-based', disabled: navigator.onLine === false, onclick: () => go('new', { newFrom: '', basedOn: v.id }), text: 'Сделать новую версию на основе этой' }));
  } else {
    box.append(h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tpl-next', onclick: () => {
      const e = draftErrors(S.data, v, nowMsk().date);
      if (Object.keys(e).length) { go('edit', { err: Object.values(e)[0] }); return; }
      go('changes', { del: null, choice: {} });
    }, text: 'Дальше: что изменится' }),
    confirmButton({ class: 'btn btn-ghost w100', id: 'tpl-discard' }, 'Отменить изменения', 'Нажмите ещё раз — черновик удалится', () => {
      dropDraft(); go('list');
    }));
  }
  box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => go('list', { readonly: null }), text: '‹ К списку версий' }));
  return out;
}

// ---------- 17. пара версии ----------
export function pairView() {
  const v = T.draft, t = T.pair;
  if (!v || !t) { go('edit'); return []; }
  const errs = pairErrors(t);
  const shown = { ...errs };
  if (!T.pairTried) Object.keys(shown).forEach((k) => delete shown[k]); // ошибки — после первой попытки «Готово»
  const err = (k) => h('div', { class: 'err', id: 'pf-err-' + k, role: 'alert', text: shown[k] || '' });
  const set = (k, val, rerender = false) => { t[k] = val; if (rerender) renderSheet(); };
  const subjects = Object.keys(S.data.subjects || {});
  const sel = h('select', { class: 'input', id: 'pf-subject', name: 'subject', 'aria-describedby': 'pf-err-subject', 'aria-invalid': shown.subject ? 'true' : null },
    ...subjects.map((k) => h('option', { value: k, selected: t.subject === k, text: fullName(k, S.data.subjects) })),
    t.subject && !subjects.includes(t.subject) ? h('option', { value: t.subject, selected: true, text: t.subject + ' (нет в списке предметов)' }) : null,
    h('option', { value: '__new', text: 'Новый предмет…' }));
  sel.addEventListener('change', () => {
    if (sel.value === '__new') { go('subject', { subject: null, back: 'pair', sj: null }); return; }
    set('subject', sel.value);
  });
  const text = (id, label, k, max, ph, mono) => {
    const inp = h('input', { class: 'input' + (mono ? ' mono' : ''), id, name: k, type: 'text', maxlength: String(max), placeholder: ph, value: t[k] || '', 'aria-describedby': 'pf-err-' + k });
    inp.addEventListener('input', () => set(k, inp.value));
    return h('div', {}, h('label', { class: 'lbl', for: id, text: label }), inp, err(k));
  };
  const radio = (name, label, k, opts, num) => h('div', {}, h('div', { class: 'lbl', id: name + '-l', text: label }),
    h('div', { class: 'radio', role: 'radiogroup', 'aria-labelledby': name + '-l' }, opts.map(([val, txt]) => h('label', {},
      h('input', { type: 'radio', name, value: String(val), checked: t[k] === val, onchange: () => set(k, num ? Number(val) : val) }), txt))));
  const daySel = h('select', { class: 'input', id: 'pf-day', name: 'day' }, DAYS.map((d) => h('option', { value: String(d), selected: t.day === d, text: WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1) })));
  daySel.addEventListener('change', () => set('day', Number(daySel.value)));
  const slots = h('input', { type: 'checkbox', id: 'pf-slots', checked: t.slots === 2, onchange: (e) => set('slots', e.target.checked ? 2 : 1) });
  const done = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'pf-done', text: 'Готово', onclick: () => {
    T.pairTried = true;
    if (Object.keys(pairErrors(t)).length) { renderSheet(); const first = document.querySelector('#sheet [aria-invalid="true"], #sheet .err:not(:empty)'); if (first) first.scrollIntoView({ block: 'center' }); return; }
    const i = v.pairs.findIndex((x) => x.id === t.id);
    const clean = { ...t, room: (t.room || '').trim(), teacher: (t.teacher || '').trim(), tgName: (t.tgName || '').trim(), note: (t.note || '').trim() };
    if (i >= 0) v.pairs[i] = clean; else v.pairs.push(clean);
    saveDraft(); T.pairTried = false;
    go('edit', { day: t.day });
  } });
  const box = h('div', { class: 'stack' },
    h('div', {}, h('label', { class: 'lbl', for: 'pf-day', text: 'День' }), daySel, err('day')),
    radio('pf-half', 'Неделя', 'half', [['both', 'Обе'], ['top', 'Верхняя'], ['bottom', 'Нижняя']]),
    timePicker([t.start, t.end], (val) => { t.start = val[0]; t.end = val[1]; }), err('time'),
    h('label', { class: 'check' }, slots, 'Сдвоенная пара (два номера подряд)'),
    h('div', {}, h('label', { class: 'lbl', for: 'pf-subject', text: 'Предмет' }), sel, err('subject')),
    radio('pf-type', 'Тип', 'type', [['lecture', 'Лекция'], ['seminar', 'Семинар'], ['other', 'Занятие']]),
    text('pf-room', 'Аудитория', 'room', 30, 'например, 219', true),
    text('pf-teacher', 'Преподаватель', 'teacher', 60, 'например, Иванова И. И.'),
    text('pf-tg', 'Как писать в Telegram (необязательно)', 'tgName', 100, 'по умолчанию — как предмет'),
    text('pf-note', 'Постоянная пометка (необязательно)', 'note', 200, 'например, Сменка'),
    done);
  if (!T.pairNew) {
    box.append(confirmButton({ class: 'btn btn-danger w100', id: 'pf-delete' }, 'Удалить пару из версии', 'Нажмите ещё раз, чтобы удалить', () => {
      v.pairs = v.pairs.filter((x) => x.id !== t.id); saveDraft(); T.pairTried = false; go('edit');
    }));
  }
  box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => { T.pairTried = false; go('edit'); }, text: '‹ Назад без изменений' }));
  return [sheetHead(T.pairNew ? 'Новая пара' : 'Пара версии', `Версия с ${dayMonth(v.from)}`), box];
}

// ---------- предпросмотр недели по черновику ----------
export function previewView() {
  const v = shown();
  if (!v) { go('list'); return []; }
  const data = T.readonly ? S.data : dataWithDraft(v);
  const monday = T.previewMonday || mondayOf(v.from);
  const move = (n) => { T.previewMonday = addDays(monday, n); renderSheet(); };
  const days = [0, 1, 2, 3, 4, 5].map((i) => buildDay(addDays(monday, i), data));
  const out = [sheetHead('Предпросмотр недели', `${weekRange(monday)} · ${days[0].half === 'top' ? 'верхняя' : 'нижняя'} неделя`),
    h('p', { class: 'banner', style: 'margin-bottom:12px', text: `Предпросмотр версии с ${dayMonth(v.from)}${T.readonly ? '' : ' (черновик)'} — так увидит группа. Дни до ${dayMonth(v.from)} — по прежней версии.` }),
    h('div', { class: 'cols', style: 'margin-bottom:12px' },
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'pv-prev', onclick: () => move(-7), text: '‹ Неделя назад' }),
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'pv-next', onclick: () => move(7), text: 'Неделя вперёд ›' }))];
  const list = h('div', { class: 'stack', id: 'pv-days' });
  for (const d of days) {
    const before = d.date < v.from;
    list.append(h('section', { class: 'variant', 'aria-label': longDay(d.date) },
      h('b', { text: longDay(d.date) + (before ? ' · прежняя версия' : '') }),
      d.pairs.length ? h('ul', { class: 'small', style: 'margin:6px 0 0;padding-left:18px' }, d.pairs.map((p) => h('li', {
        text: `${p.numbers.length ? p.numbers.join(' и ') + ' пара, ' : ''}${shortTime(p.start)}–${shortTime(p.end)} · ${fullName(p.subject, S.data.subjects)} · ${TYPE_WORD[p.type] || ''}${p.room ? ' · ауд. ' + p.room : ''}` })))
        : h('div', { class: 'small muted', text: 'Пар нет' })));
  }
  out.push(list, h('button', { type: 'button', class: 'btn btn-ghost w100', style: 'margin-top:12px', onclick: () => go('edit'), text: '‹ Назад к версии' }));
  return out;
}
