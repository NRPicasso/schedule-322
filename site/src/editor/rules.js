// Аудитория, преподаватель и время пары: «только в этот день» или «с этого дня и дальше» (постоянные замены).
import { buildDay, addDays } from '../schedule.js';
import { dayMonth, shortTime } from '../format.js';
import { h } from '../dom.js';
import { applyOp } from '../store.js';
import { S } from './state.js';
import { commit, pairOp } from './sync.js';
import { timeOk, halfSuffix, showValue, backTo, backBtn, panelHead, timePicker, clashWith, clashBanner, nextSameDay } from './panels.js';

// ---- постоянные замены (правила) ----
const rulesOf = (p, field) => (S.data.rules || []).filter((r) => r.pairId === p.id && r.field === field);
/** Более поздние постоянные замены, которые перекрыли бы новую «с этого дня и дальше» (до даты «по»). */
const laterRules = (p, field, to) => rulesOf(p, field).filter((r) => r.from > p.date && (!to || r.from <= to));

/**
 * Операции «постоянно с этого дня»: убрать разовую замену этого дня (она сильнее правила),
 * убрать более поздние постоянные замены (иначе они перекроют новую) и поставить правило.
 */
function ruleOps(p, values, to) {
  const ops = [];
  const dayPatch = {};
  for (const f of Object.keys(values)) if (p.changed[f]) dayPatch[f] = '';
  if (Object.keys(dayPatch).length) ops.push(pairOp(p, dayPatch));
  for (const f of Object.keys(values)) {
    for (const r of laterRules(p, f, to)) ops.push({ type: 'rule.remove', date: r.from, pairId: p.id, field: f });
    ops.push({ type: 'rule.set', date: p.date, pairId: p.id, field: f, value: values[f], to: to || '' });
  }
  return ops;
}
/** Предупреждение о более поздних заменах, которые будут сняты. */
function laterNote(p, fields, to) {
  const list = fields.flatMap((f) => laterRules(p, f, to).map((r) => `с ${dayMonth(r.from)} — ${showValue(f, r.value)}`));
  const uniq = [...new Set(list)];
  return uniq.length ? h('p', { class: 'banner', text: `Уже есть более поздняя постоянная замена (${uniq.join('; ')}). Она будет снята, чтобы действовала новая.` }) : null;
}
/**
 * Снять постоянную замену, не переписывая прошлое: если правило началось раньше этого дня,
 * оно обрывается накануне (прошлые недели остаются как были); если с этого дня — удаляется.
 */
function endRuleOps(p, field) {
  const from = p.ruledFrom[field];
  const r = from && rulesOf(p, field).find((x) => x.from === from);
  if (!r) return [];
  return from < p.date
    ? [{ type: 'rule.set', date: from, pairId: p.id, field, value: r.value, to: addDays(p.date, -1) }]
    : [{ type: 'rule.remove', date: from, pairId: p.id, field }];
}
/** Как будет выглядеть пара после операций — для честной подписи кнопки. */
function previewAfter(p, ops) {
  const d = JSON.parse(JSON.stringify(S.data));
  ops.forEach((o) => applyOp(d, o, {}));
  return buildDay(p.date, d).pairs.find((q) => q.id === p.id) || p;
}

/** Переключатель «Только этот день / С этого дня и дальше» + необязательная дата «по». */
function scopeControl(p, onChange) {
  const toIn = h('input', { class: 'input', id: 'scope-to', name: 'to', type: 'date', min: p.date });
  const toBox = h('div', { hidden: true }, h('label', { class: 'lbl', for: 'scope-to', text: 'По какую дату (необязательно)' }), toIn,
    h('div', { class: 'xs muted', style: 'margin-top:4px', text: 'Пусто — до конца, пока замену не снимут.' }));
  const state = { scope: 'day', to: '' };
  const set = (scope) => { state.scope = scope; toBox.hidden = scope !== 'from'; onChange(state); };
  toIn.addEventListener('change', () => { state.to = toIn.value; onChange(state); });
  const el = h('div', { class: 'stack', style: 'gap:8px' },
    h('div', { class: 'radio', role: 'radiogroup', 'aria-label': 'Когда действует' },
      h('label', {}, h('input', { type: 'radio', name: 'scope', value: 'day', checked: true, onchange: () => set('day') }), `Только ${dayMonth(p.date)}`),
      h('label', {}, h('input', { type: 'radio', name: 'scope', value: 'from', onchange: () => set('from') }), `С ${dayMonth(p.date)} и дальше${halfSuffix(p)}`)),
    toBox);
  return { el, state };
}
const scopeErr = (p, st) => (st.scope === 'from' && st.to && st.to < p.date ? `Дата «по» не может быть раньше ${dayMonth(p.date)}.` : '');
const untilWord = (st) => (st.to ? ` по ${dayMonth(st.to)}` : ' и дальше');

/** Аудитория или преподаватель. */
export function fieldPanel(field) {
  return function panel(p) {
    const isRoom = field === 'room';
    const title = isRoom ? 'Аудитория' : 'Преподаватель';
    const tpl = p.kind === 'template';
    const input = h('input', { class: 'input' + (isRoom ? ' mono' : ''), id: 'f-value', name: field, type: 'text', autocomplete: 'off', maxlength: isRoom ? '30' : '60', placeholder: isRoom ? 'например, 305' : 'например, Иванова И. И.', 'aria-describedby': 'f-err' });
    input.value = p[field] || '';
    const err = h('div', { class: 'err', id: 'f-err', role: 'alert' });
    const note = h('div');
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'f-save' });
    const sc = tpl ? scopeControl(p, () => upd()) : null;
    const st = () => (sc ? sc.state : { scope: 'day', to: '' });
    const upd = () => {
      err.textContent = scopeErr(p, st());
      btn.textContent = !tpl ? 'Сохранить' : st().scope === 'day' ? `Сохранить на ${dayMonth(p.date)}` : `Заменить с ${dayMonth(p.date)}${untilWord(st())}`;
      note.replaceChildren(...[st().scope === 'from' ? laterNote(p, [field], st().to) : null].filter(Boolean));
    };
    upd();
    btn.addEventListener('click', () => {
      const v = input.value.trim();
      if (!v) { err.textContent = isRoom ? 'Введите номер аудитории, например 305.' : 'Введите фамилию и инициалы.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      if (scopeErr(p, st())) return;
      if (st().scope === 'day') commit(pairOp(p, { [field]: v }), `${title}${tpl ? ' на ' + dayMonth(p.date) : ''}: ${v}`);
      else commit(ruleOps(p, { [field]: v }, st().to), `С ${dayMonth(p.date)}${untilWord(st())}: ${v}`);
      backTo(p.date, p.id);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
    const box = h('div', { class: 'stack' }, h('div', {}, h('label', { class: 'lbl', for: 'f-value', text: isRoom ? 'Новая аудитория' : 'Кто ведёт' }), input, err));
    if (sc) box.append(sc.el);
    box.append(note, btn);
    if (tpl && p.changed[field]) {
      box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => { commit(pairOp(p, { [field]: '' }), 'Разовая замена убрана'); backTo(p.date, p.id); },
        text: `Убрать замену на ${dayMonth(p.date)} (обычно ${p.changed[field]})` }));
    }
    if (tpl && p.ruledFrom[field]) {
      const ops = endRuleOps(p, field);
      const after = previewAfter(p, ops);
      box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', id: 'f-unrule', onclick: () => { commit(ops, 'Постоянная замена снята'); backTo(p.date, p.id); },
        text: `Снять постоянную замену с ${dayMonth(p.date)} (станет: ${after[field] || '—'})` }));
    }
    box.append(backBtn(p));
    return [panelHead(title, p), box];
  };
}

export function timePanel(p) {
  let t = [p.start, p.end];
  const tpl = p.kind === 'template';
  const err = h('div', { class: 'err', role: 'alert' }); const warn = h('div', { class: 'stack', style: 'gap:8px' });
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 't-save' });
  const sc = tpl ? scopeControl(p, () => upd()) : null;
  const st = () => (sc ? sc.state : { scope: 'day', to: '' });
  /** Наложение проверяем в этот день, а для «с этого дня» — ещё и в ближайший такой же день. */
  const upd = () => {
    btn.textContent = st().scope === 'day' ? `Сохранить время на ${dayMonth(p.date)}` : `Новое время с ${dayMonth(p.date)}${untilWord(st())}`;
    warn.replaceChildren();
    const c = clashWith(p.date, t, p);
    if (c) warn.append(clashBanner(c, ' Сохранить всё равно можно.'));
    if (st().scope === 'from') {
      const next = nextSameDay(p);
      const c2 = next && (!st().to || next <= st().to) && clashWith(next, t, { id: p.id, date: next });
      if (c2) warn.append(clashBanner(c2, ' Сохранить всё равно можно.', next));
      const ln = laterNote(p, ['start', 'end'], st().to);
      if (ln) warn.append(ln);
    }
    err.textContent = scopeErr(p, st());
  };
  const picker = timePicker(t, (v) => { t = v; upd(); });
  upd();
  btn.addEventListener('click', () => {
    if (!timeOk(t)) { err.textContent = 'Время окончания должно быть позже начала.'; return; }
    if (scopeErr(p, st())) return;
    const label = `${shortTime(t[0])}–${shortTime(t[1])}`;
    if (st().scope === 'day') commit(pairOp(p, { start: t[0], end: t[1] }), `Время${tpl ? ' на ' + dayMonth(p.date) : ''}: ${label}`);
    else commit(ruleOps(p, { start: t[0], end: t[1] }, st().to), `С ${dayMonth(p.date)}${untilWord(st())}: ${label}`); // начало и конец — одним действием
    backTo(p.date, p.id);
  });
  const box = h('div', { class: 'stack' }, picker);
  if (sc) box.append(sc.el);
  box.append(warn, err, btn);
  if (tpl && (p.changed.start || p.changed.end)) {
    box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => { commit(pairOp(p, { start: '', end: '' }), 'Обычное время возвращено'); backTo(p.date, p.id); },
      text: `Убрать замену на ${dayMonth(p.date)} (обычно ${shortTime(p.changed.start || p.start)}–${shortTime(p.changed.end || p.end)})` }));
  }
  if (tpl && (p.ruledFrom.start || p.ruledFrom.end)) {
    const ops = [...endRuleOps(p, 'start'), ...endRuleOps(p, 'end')];
    const after = previewAfter(p, ops);
    box.append(h('button', { type: 'button', class: 'btn btn-ghost w100', id: 't-unrule', onclick: () => { commit(ops, 'Постоянное время снято'); backTo(p.date, p.id); },
      text: `Снять постоянное время с ${dayMonth(p.date)} (станет: ${shortTime(after.start)}–${shortTime(after.end)})` }));
  }
  box.append(backBtn(p));
  return [panelHead('Время', p), box];
}
