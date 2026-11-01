// «Шаблон и семестр» (v0.2): список версий, новая версия с даты, «что изменится» и сохранение.
// Шаблон меняется только с сетью и только кнопкой: черновик хранится на телефоне до сохранения.
// Правка самих пар черновика — в version-edit.js, предметы — в subjects.js.
import { addDays, mondayOf } from '../schedule.js';
import { dayMonth, longDay, shortTime, WEEKDAYS_SHORT } from '../format.js';
import { h } from '../dom.js';
import { versionsOf, sortVersions, versionAt, halfIn, copyForNewVersion, templateImpact, versionDiff, removalDraft, draftErrors } from '../versions.js';
import { S, nowMsk } from './state.js';
import { toast, queueDialog, closeDialog, openSheet, renderSheet, sheetHead, confirmButton, SH } from './ui.js';
import { reload, sendNow } from './sync.js';
import { T, go, saveDraft, storedDraft, dropDraft, online, pairsWord, TYPE_WORD, sendUndo, failText } from './tpl-state.js';
import { editView, pairView, previewView } from './version-edit.js';
import { subjectsView, subjectView } from './subjects.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const today = () => nowMsk().date;

/** Список версий и предметов можно перерисовать, когда пришли свежие данные (в нём нет полей ввода). */
export const templateListOpen = () => SH.build === templateSheet && (T.view === 'list' || T.view === 'subjects');

/** Сразу показать результат на экране (свежие данные с сервера придут следом). */
function applyVersion(doc, removedId) {
  const list = versionsOf(S.data).filter((v) => v.id !== (doc ? doc.id : removedId));
  S.data.versions = sortVersions(doc ? [...list, doc] : list);
}

export function openTemplate(ret) {
  T.view = 'list'; T.err = '';
  if (!T.draft) T.draft = storedDraft();
  openSheet(templateSheet, ret, true);
}
function templateSheet() {
  switch (T.view) {
    case 'new': return newView();
    case 'edit': return editView();
    case 'pair': return pairView();
    case 'preview': return previewView();
    case 'changes': return changesView();
    case 'subjects': return subjectsView();
    case 'subject': return subjectView();
    default: return listView();
  }
}

const offlineBanner = () => (online() ? null : h('p', { class: 'banner', role: 'status', text: 'Шаблон меняется только с интернетом — так два телефона не разойдутся в версиях. Смотреть можно и без сети.' }));
const fullDate = (iso) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;

// ---------- 14. список версий ----------
function listView() {
  const list = versionsOf(S.data), now = today(), cur = versionAt(S.data, now);
  const future = list.filter((v) => v.from > now);
  const past = list.filter((v) => v.from <= now && v !== cur);
  const out = [sheetHead('Шаблон и семестр', 'Версии шаблона «с даты»'),
    h('p', { class: 'small muted', style: 'margin:0 0 12px', text: 'Новая версия меняет недели с её даты; прошлые недели остаются как были.' })];
  const box = h('div', { class: 'stack' });
  out.push(box);
  const off = offlineBanner(); if (off) box.append(off);
  if (T.err) box.append(h('p', { class: 'banner', role: 'alert', text: T.err }));
  if (T.draft) {
    box.append(h('div', { class: 'banner', style: 'display:flex;flex-direction:column;gap:8px' },
      h('span', { text: `Есть несохранённый черновик версии с ${fullDate(T.draft.from)}.` }),
      h('div', { class: 'cols' },
        h('button', { type: 'button', class: 'btn btn-secondary', id: 'tpl-continue', onclick: () => go('edit', { readonly: null, day: 1 }), text: 'Продолжить' }),
        confirmButton({ class: 'btn btn-ghost', id: 'tpl-drop' }, 'Удалить черновик', 'Нажмите ещё раз', () => { dropDraft(); go('list'); }))));
  }
  const card = (v, kind) => {
    const half = halfIn(v, kind === 'cur' ? now : v.from) === 'top' ? 'верхняя' : 'нижняя';
    const el = h('div', { class: 'variant tpl-ver', 'data-id': v.id },
      h('b', { text: `${kind === 'cur' ? 'Сейчас действует: ' : ''}с ${fullDate(v.from)}` }),
      h('div', { class: 'small muted', text: `${pairsWord(v.pairs.length)} · семестр ${v.semesterStart ? dayMonth(v.semesterStart) : '—'} — ${v.semesterEnd ? fullDate(v.semesterEnd) : '—'}` }),
      h('div', { class: 'small muted', text: kind === 'cur' ? `Эта неделя — ${half}` : kind === 'future' ? `Ещё не началась · неделя с ${dayMonth(mondayOf(v.from))} — ${half}` : 'Прошлая версия' }));
    const acts = h('div', { class: 'cols', style: 'margin-top:8px' },
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => go('edit', { readonly: v.id, day: 1 }), text: 'Посмотреть пары' }));
    if (kind === 'future') {
      acts.replaceChildren(
        h('button', { type: 'button', class: 'btn btn-secondary', id: 'tpl-edit-' + v.id, disabled: !online(), onclick: () => startEdit(v), text: 'Изменить' }),
        h('button', { type: 'button', class: 'btn btn-danger', id: 'tpl-del-' + v.id, disabled: !online(), onclick: () => go('changes', { del: v.id, choice: {} }), text: 'Удалить' }));
    }
    el.append(acts);
    if (kind === 'cur') el.append(h('p', { class: 'xs muted', style: 'margin:6px 0 0', text: 'Действующую версию не меняют — сделайте новую с завтрашнего дня.' }));
    return el;
  };
  box.append(card(cur, 'cur'));
  if (future.length) box.append(h('div', { class: 'caps muted', text: 'Будущие версии' }), ...future.map((v) => card(v, 'future')));
  if (past.length) box.append(h('details', {}, h('summary', { class: 'small', text: `Прошлые версии (${past.length})` }), ...past.map((v) => card(v, 'past'))));
  box.append(
    h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tpl-new', disabled: !online(), onclick: () => go('new', { newFrom: '', basedOn: null }), text: 'Новая версия с даты…' }),
    h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'tpl-subjects', onclick: () => go('subjects', { back: 'list', sj: null }), text: 'Предметы и цвета' }));
  if (!online()) box.append(h('p', { class: 'xs muted', style: 'margin:0', text: 'Кнопки изменения недоступны: нет связи.' }));
  return out;
}

/** Открыть будущую версию для правки: черновик из неё (или уже начатый черновик этой версии). */
function startEdit(v) {
  if (!T.draft || T.draft.id !== v.id) {
    T.draft = { ...clone(v), baseVersion: v.version || 0, basePairs: clone(v.pairs) };
    delete T.draft.by; delete T.draft.updatedAt;
    saveDraft();
  }
  go('edit', { readonly: null, day: 1 });
}

// ---------- 15. новая версия с даты ----------
function newView() {
  const now = today(), tomorrow = addDays(now, 1);
  const base = T.basedOn ? versionsOf(S.data).find((v) => v.id === T.basedOn) : null;
  const dIn = h('input', { class: 'input', id: 'tpl-from', name: 'from', type: 'date', min: tomorrow, value: T.newFrom || '', 'aria-describedby': 'tpl-from-err' });
  const err = h('div', { class: 'err', id: 'tpl-from-err', role: 'alert' });
  const info = h('div', { class: 'stack', style: 'gap:8px' });
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tpl-create', disabled: true, text: 'Создать черновик' });
  const check = () => {
    T.newFrom = dIn.value; err.textContent = ''; info.replaceChildren(); btn.disabled = true; dIn.removeAttribute('aria-invalid');
    if (!dIn.value) return;
    const e = draftErrors(S.data, { id: '', from: dIn.value, semesterStart: dIn.value, semesterEnd: dIn.value, pairs: [{}] }, now).from;
    if (e) { err.textContent = e; dIn.setAttribute('aria-invalid', 'true'); return; }
    const src = base || versionAt(S.data, dIn.value);
    const { baked, limited } = copyForNewVersion(S.data, dIn.value, src);
    info.append(h('p', { class: 'small', style: 'margin:0', text: `За основу — версия с ${fullDate(src.from)} (${pairsWord(src.pairs.length)}). Недели до ${dayMonth(dIn.value)} не изменятся.` }));
    if (baked.length) info.append(h('p', { class: 'small', style: 'margin:0', text: 'В пары вписаны постоянные замены: ' + baked.map(ruleText).join('; ') + '.' }));
    if (limited.length) info.append(h('p', { class: 'banner', text: 'Не перейдут (у них есть дата окончания): ' + limited.map(ruleText).join('; ') + '.' }));
    btn.disabled = !online();
  };
  dIn.addEventListener('change', check); dIn.addEventListener('input', check);
  btn.addEventListener('click', () => {
    const src = base || versionAt(S.data, dIn.value);
    const { version } = copyForNewVersion(S.data, dIn.value, src);
    T.draft = { ...version, baseVersion: 0, basePairs: clone(src.pairs), basedFrom: src.from };
    saveDraft();
    go('edit', { readonly: null, day: 1 });
  });
  queueMicrotask(check);
  return [sheetHead(base ? `Новая версия на основе версии с ${dayMonth(base.from)}` : 'Новая версия с даты', 'Шаблон и семестр'), h('div', { class: 'stack' },
    offlineBanner(),
    h('div', {}, h('label', { class: 'lbl', for: 'tpl-from', text: 'С какой даты' }), dIn, err,
      h('div', { class: 'xs muted', style: 'margin-top:4px', text: 'Не раньше завтрашнего дня. Пока черновик не сохранён, на сайте ничего не меняется.' })),
    info, btn,
    h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => go('list'), text: '‹ Назад' }))];
}
const FIELD = { room: 'аудитория', teacher: 'преподаватель', start: 'начало', end: 'конец' };
function ruleText(r) {
  const t = versionAt(S.data, r.from).pairs.find((x) => x.id === r.pairId) || {};
  const v = r.field === 'start' || r.field === 'end' ? shortTime(r.value) : r.value;
  return `${t.subject || r.pairId}${t.type ? ' (' + (TYPE_WORD[t.type] || '') + ')' : ''} — ${FIELD[r.field]} ${v}${r.to ? ' по ' + dayMonth(r.to) : ''}`;
}

// ---------- 18. что изменится → сохранить / удалить ----------
const WD = (d) => WEEKDAYS_SHORT[d % 7];
const HALF = { top: 'верх', bottom: 'низ', both: '' };
const pairLabel = (t) => `${t.subject}${t.type ? ' (' + (TYPE_WORD[t.type] || '') + ')' : ''}, ${WD(t.day)}${HALF[t.half] ? ' ' + HALF[t.half] : ''} ${shortTime(t.start)}`;
const FIELD_NAMES = { day: 'день', half: 'неделя', start: 'начало', end: 'конец', slots: 'сдвоенная', subject: 'предмет', type: 'тип', room: 'аудитория', teacher: 'преподаватель', tgName: 'для Telegram', note: 'пометка' };
const showField = (f, v) => (f === 'day' ? WD(v) : f === 'half' ? ({ top: 'верхняя', bottom: 'нижняя', both: 'обе' })[v] : f === 'type' ? TYPE_WORD[v] : f === 'slots' ? (v === 2 ? 'да' : 'нет') : (f === 'start' || f === 'end') && v ? shortTime(v) : v || '—');

function changesView() {
  const del = T.del ? versionsOf(S.data).find((v) => v.id === T.del) : null;
  const draft = del ? removalDraft(S.data, del.id) : T.draft;
  if (!draft) return listView();
  const impact = templateImpact(S.data, draft);
  const box = h('div', { class: 'stack' });
  const out = [sheetHead(del ? 'Удалить версию' : 'Что изменится', del ? `Версия с ${fullDate(del.from)}` : `Версия с ${fullDate(draft.from)}`), box];
  const off = offlineBanner(); if (off) box.append(off);
  if (del) {
    box.append(h('p', { style: 'margin:0', text: `С ${fullDate(del.from)} снова пойдёт версия с ${fullDate(draft.prevFrom)}. Недели до этой даты не изменятся.` }));
  } else {
    const prevDay = addDays(draft.from, -1);
    box.append(h('p', { style: 'margin:0', text: `С ${fullDate(draft.from)} расписание пойдёт по этой версии. Недели до ${dayMonth(prevDay)} не изменятся.` }));
    const d = versionDiff(draft.basePairs || [], draft.pairs);
    const lines = [...d.added.map((t) => '+ ' + pairLabel(t)), ...d.removed.map((t) => '− ' + pairLabel(t)),
      ...d.changed.map((c) => `${pairLabel(c.t)}: ${c.fields.map((f) => `${FIELD_NAMES[f.field]} ${showField(f.field, f.was)} → ${showField(f.field, f.now)}`).join(', ')}`)];
    box.append(h('div', { class: 'caps muted', text: draft.baseVersion ? 'Изменения в версии' : `Изменения относительно версии с ${dayMonth(draft.basedFrom || draft.from)}` }),
      lines.length ? h('ul', { class: 'small', id: 'tpl-diff', style: 'margin:0;padding-left:18px' }, lines.map((l) => h('li', { text: l }))) : h('p', { class: 'small muted', style: 'margin:0', text: 'Пары те же.' }));
  }
  if (impact.items.length) {
    box.append(h('div', { class: 'caps muted', text: 'Что уже вписано на эти даты' }));
    for (const it of impact.items) {
      const key = `${it.kind}|${it.date}|${it.pairId}`;
      const text = `${longDay(it.date)} · ${it.subject} — ${it.what}`;
      const row = h('div', { class: 'variant tpl-impact' }, h('div', { text }));
      if (!del && it.kind === 'entry' && it.target) {
        const cur = T.choice[key] || 'move'; T.choice[key] = cur;
        row.append(h('div', { class: 'radio', role: 'radiogroup', 'aria-label': text, style: 'margin-top:8px' },
          h('label', {}, h('input', { type: 'radio', name: 'imp-' + key, value: 'move', checked: cur === 'move', onchange: () => { T.choice[key] = 'move'; } }), `Перенести на ${longDay(it.target).toLowerCase()}`),
          h('label', {}, h('input', { type: 'radio', name: 'imp-' + key, value: 'keep', checked: cur === 'keep', onchange: () => { T.choice[key] = 'keep'; } }), 'Оставить в таблице')));
      }
      row.append(h('div', { class: 'xs muted', style: 'margin-top:6px', text: del || it.reason === 'removed' || !it.target || it.kind !== 'entry'
        ? 'Останется в таблице, но на сайте не будет видно и с сайта не исправить; вернётся, если отменить.'
        : '«Оставить в таблице» — на сайте не будет видно; вернётся, если отменить.' }));
      box.append(row);
    }
  }
  if (impact.notCarried.length) box.append(h('p', { class: 'banner', text: 'Постоянные замены прежней версии в эту не переходят: ' + impact.notCarried.map(ruleText).join('; ') + '.' }));
  if (impact.stronger.length) box.append(h('p', { class: 'banner', text: 'Останутся сильнее шаблона (это замены «с этого дня» внутри версии): ' + impact.stronger.map(ruleText).join('; ') + '.' }));
  if (T.err) box.append(h('p', { class: 'banner', role: 'alert', id: 'tpl-err', text: T.err }));
  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tpl-save', disabled: !online() || T.busy,
    text: T.busy ? 'Сохраняю…' : del ? 'Удалить версию' : 'Сохранить версию', onclick: () => (del ? removeVersion(del) : saveVersion(impact)) });
  box.append(btn, h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => (del ? go('list', { del: null }) : go('edit')), text: del ? '‹ Не удалять' : '‹ Вернуться к правке' }));
  return out;
}

/** Черновик для отправки: только поля версии. */
const docOf = (d) => ({ id: d.id, from: d.from, anchorWeek: d.anchorWeek, anchorHalf: d.anchorHalf, semesterStart: d.semesterStart, semesterEnd: d.semesterEnd,
  pairs: d.pairs.map((t) => { const o = { ...t }; if (!o.slots) o.slots = 1; return o; }) });

async function saveVersion(impact) {
  const d = T.draft;
  const errs = draftErrors(S.data, d, today());
  if (Object.keys(errs).length) { go('edit', { err: Object.values(errs)[0] }); return; }
  const moves = impact.items.filter((it) => it.kind === 'entry' && it.target && (T.choice[`${it.kind}|${it.date}|${it.pairId}`] || 'move') === 'move')
    .map((it) => ({ date: it.date, pairId: it.pairId, to: it.target }));
  // для «Отменить»: как было (версия и переносимые записи)
  const before = { version: versionsOf(S.data).find((v) => v.id === d.id) || null,
    entries: moves.flatMap((m) => [m.date, m.to].map((date) => clone(S.data.entries.find((e) => e.date === date && e.pairId === m.pairId) || { date, pairId: m.pairId, hw: '', links: [], noHw: false }))) };
  T.busy = true; T.err = ''; renderSheet();
  try {
    const [r] = await sendNow([{ type: 'version.save', date: d.from, baseVersion: d.baseVersion || 0, tplVersion: docOf(d), moves }]);
    if (r.ok) {
      dropDraft(); T.busy = false; applyVersion(r.tplVersion); go('list');
      toast(`Версия с ${dayMonth(d.from)} сохранена`, () => undoSave(r.tplVersion, before));
      reload();
    } else if (r.error === 'conflict') { T.busy = false; renderSheet(); queueDialog(() => versionConflict(r.current)); }
    else { T.busy = false; go('changes', { err: 'Не сохранилось: ' + (r.message || 'ошибка данных') + '. Черновик остался.' }); }
  } catch (e) { T.busy = false; go('changes', { err: failText(e) }); }
}

async function undoSave(saved, before) {
  const ops = before.version
    ? [{ type: 'version.save', date: before.version.from, baseVersion: saved.version, tplVersion: docOf(before.version) }]
    : [{ type: 'version.remove', date: today(), id: saved.id, baseVersion: saved.version }];
  // записи — как были до переноса (версии строк — свежие, после перезагрузки данных)
  for (const e of before.entries) {
    const curE = S.data.entries.find((x) => x.date === e.date && x.pairId === e.pairId);
    ops.push({ type: 'entry', date: e.date, pairId: e.pairId, baseVersion: curE ? curE.version || 0 : 0, patch: { hw: e.hw || '', links: e.links || [], noHw: !!e.noHw } });
  }
  await sendUndo(ops, 'Версия отменена');
}

async function removeVersion(v) {
  T.busy = true; T.err = ''; renderSheet();
  try {
    const [r] = await sendNow([{ type: 'version.remove', date: today(), id: v.id, baseVersion: v.version || 0 }]);
    T.busy = false;
    if (r.ok) {
      if (T.draft && T.draft.id === v.id) dropDraft();
      applyVersion(null, v.id);
      go('list', { del: null });
      toast(`Версия с ${dayMonth(v.from)} удалена`, () => sendUndo([{ type: 'version.save', date: v.from, baseVersion: 0, tplVersion: docOf(v) }], 'Версия возвращена'));
      reload();
    } else if (r.error === 'conflict') go('changes', { err: 'Эту версию только что изменил другой активист. Вернитесь к списку и посмотрите её ещё раз.' });
    else go('changes', { err: 'Не удалилось: ' + (r.message || 'ошибка') + '.' });
  } catch (e) { T.busy = false; go('changes', { err: failText(e).replace('Не сохранилось', 'Не удалилось').replace(' Черновик остался на телефоне — сохраните, когда появится интернет.', '') }); }
}

// ---------- 20. конфликт версии ----------
function versionConflict(current) {
  const done = closeDialog;
  const theirs = () => {
    done();
    if (!current) { dropDraft(); go('list', { err: 'Эту версию удалил другой активист.' }); return; }
    T.draft = { ...clone(current), baseVersion: current.version || 0, basePairs: clone(current.pairs) };
    saveDraft(); go('edit', { readonly: null });
  };
  const mine = () => { done(); if (current) { T.draft.baseVersion = current.version || 0; saveDraft(); } else T.draft.baseVersion = 0; go('changes'); };
  document.getElementById('dialog').replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'vc-title' }, h('div', { class: 'box' },
    h('h2', { id: 'vc-title', text: current ? 'Эту версию шаблона уже изменил другой активист' : 'Эту версию шаблона удалил другой активист' }),
    h('p', { class: 'small muted', style: 'margin:0', text: 'Ваш черновик не потерян. Какой вариант оставить?' }),
    h('div', { class: 'cols' },
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'vc-theirs', onclick: theirs, text: current ? 'Открыть его вариант' : 'Удалить мой черновик' }),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'vc-mine', onclick: mine, text: current ? 'Сохранить мой поверх' : 'Сохранить мой заново' })))));
  document.getElementById('vc-theirs').focus();
}
