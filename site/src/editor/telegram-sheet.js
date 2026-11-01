// Текст для Telegram (шаг 7): по дням, вся неделя, изменения; копирование с запасными способами.
import { weekday } from '../schedule.js';
import { weekRange, WEEKDAYS_SHORT } from '../format.js';
import { h } from '../dom.js';
import { weekDays, weekText, weekChanges, pairChanges, TG_LIMIT } from '../telegram.js';
import { $, S, local } from './state.js';
import { queueDialog, closeDialog, isDone, weekSeminars, openSheet, renderSheet, sheetHead } from './ui.js';

const EMOJI_KEY = 'raspisanie-322:tg-emoji';
// что уже скопировано на этой неделе: дата → скопированный текст (если день потом изменили — видно)
const tg = { tab: 'days', monday: null, copied: new Map(), view: null };
function tgEmoji() { try { return (local && local.getItem(EMOJI_KEY)) === '1'; } catch { return false; } }
function setTgEmoji(on) { try { if (local) local.setItem(EMOJI_KEY, on ? '1' : '0'); } catch { /* приватный режим */ } }

/** Старый способ копирования — через скрытое поле; работает там, где нет доступа к буферу (http, встроенные браузеры). */
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.append(ta);
  ta.select(); ta.setSelectionRange(0, text.length); // iPhone выделяет только так
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
/** Последний вариант: окно с выделенным текстом — остаётся нажать «Копировать» в меню телефона. */
function showCopyDialog(text) {
  queueDialog(() => {
    const ta = h('textarea', { class: 'input tg-preview', rows: String(Math.min(14, text.split('\n').length + 1)), 'aria-label': 'Текст для копирования' });
    ta.value = text;
    $('dialog').replaceChildren(h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cp-title' }, h('div', { class: 'box' },
      h('h2', { id: 'cp-title', text: 'Скопируйте вручную' }),
      h('p', { class: 'small muted', style: 'margin:0', text: 'Телефон не дал скопировать автоматически. Текст выделен — нажмите «Копировать» в меню (или долгое нажатие → «Выбрать всё»).' }),
      ta, h('button', { type: 'button', class: 'btn btn-primary', onclick: closeDialog, text: 'Готово' }))));
    ta.focus(); ta.setSelectionRange(0, text.length);
  });
}
/** Скопировать текст: буфер обмена → старый способ → окно для ручного копирования. */
async function copyText(text, btn, doneLabel = 'Скопировано ✓') {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
  if (!ok) { showCopyDialog(text); return false; }
  const old = btn.textContent; btn.textContent = doneLabel; btn.classList.add('done');
  setTimeout(() => { if (document.contains(btn)) { btn.textContent = old; btn.classList.remove('done'); } }, 2000);
  return true;
}
const preview = (text, id) => {
  const ta = h('textarea', { class: 'input tg-preview', id, readonly: true, rows: String(Math.min(18, text.split('\n').length + 1)), 'aria-label': 'Текст для Telegram' });
  ta.value = text;
  return ta;
};
const tooLong = (text, hint) => (text.length > TG_LIMIT
  ? h('p', { class: 'banner', text: `Текст длиннее ${TG_LIMIT} знаков (${text.length}) — Telegram не примет его одним сообщением. ${hint}` }) : null);

export function openTelegram(ret, tab) {
  if (tg.monday !== S.monday) { tg.monday = S.monday; tg.copied = new Map(); tg.view = null; }
  if (tab) tg.tab = tab;
  openSheet(telegramSheet, ret, true);
}
export function telegramSheet() {
  const opts = { emoji: tgEmoji() };
  const tabs = [['days', 'По дням'], ['week', 'Вся неделя'], ['changes', 'Изменения']];
  const out = [sheetHead('Текст для Telegram', weekRange(S.monday)),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Какой текст', style: 'margin-bottom:12px' }, tabs.map(([k, label]) =>
      h('button', { type: 'button', role: 'tab', id: 'tg-tab-' + k, 'aria-selected': String(tg.tab === k), onclick: () => { tg.tab = k; renderSheet(); }, text: label })))];
  const box = h('div', { class: 'stack', role: 'tabpanel', 'aria-labelledby': 'tg-tab-' + tg.tab });
  out.push(box);

  if (tg.tab !== 'changes') {
    // напоминание: текст уходит группе — пустые ДЗ лучше заметить до копирования
    const empty = weekSeminars().filter((p) => !isDone(p)).length;
    if (empty) box.append(h('p', { class: 'banner', text: `ДЗ не заполнено у семинаров: ${empty}. Можно скопировать и так, но лучше сначала заполнить.` }));
    box.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'tg-emoji', checked: opts.emoji, onchange: (e) => { setTgEmoji(e.target.checked); renderSheet(); } }), 'Эмодзи у названий дней (🍃🌹☘️)'));
  }

  if (tg.tab === 'days') {
    const days = weekDays(S.monday, S.data, opts);
    if (!days.length) { box.append(h('div', { class: 'empty' }, h('b', { text: 'На этой неделе нечего публиковать' }))); return out; }
    // состояние дня: не скопирован / скопирован / изменён после копирования (нужно поправить сообщение в группе);
    // сравниваем текст без эмодзи — включение эмодзи не делает день «изменённым»
    const plain = new Map(weekDays(S.monday, S.data, { emoji: false }).map((d) => [d.date, d.text]));
    const state = (d) => (!tg.copied.has(d.date) ? 'new' : tg.copied.get(d.date) === plain.get(d.date) ? 'done' : 'changed');
    const next = days.find((d) => state(d) !== 'done');
    const cur = days.find((d) => d.date === tg.view) || next || days[days.length - 1];
    const changedCount = days.filter((d) => state(d) === 'changed').length;
    const ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу']; // «скопировать среду»
    const name = (d) => ACC[weekday(d.date)];
    const mainBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tg-copy',
      text: state(cur) === 'done' ? `Скопировать ${name(cur)} ещё раз` : state(cur) === 'changed' ? `Скопировать ${name(cur)} заново (изменён)` : `Скопировать ${name(cur)}`,
      onclick: async () => {
        // текст берём в момент нажатия: пока лист был открыт, другой активист мог что-то поменять
        const fresh = weekDays(S.monday, S.data, { emoji: tgEmoji() }).find((d) => d.date === cur.date);
        if (!fresh) { renderSheet(); return; }
        const base = weekDays(S.monday, S.data, { emoji: false }).find((d) => d.date === cur.date);
        if (await copyText(fresh.text, mainBtn)) { tg.copied.set(fresh.date, base.text); tg.view = null; setTimeout(renderSheet, 600); }
      } });
    if (!next) box.append(h('p', { class: 'small', style: 'margin:0;color:var(--ok);font-weight:600', text: 'Все дни скопированы ✓' }));
    if (changedCount) box.append(h('p', { class: 'banner', text: `После копирования изменились дни: ${changedCount}. Скопируйте их заново и поправьте сообщения в группе.` }));
    box.append(
      h('p', { class: 'small muted', style: 'margin:0', text: 'Каждый день — отдельным сообщением, как сейчас в группе. Скопируйте, вставьте в Telegram и вернитесь за следующим.' }),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Какой день показать' }, days.map((d) => h('button', {
        type: 'button', class: 'chip ' + state(d), 'aria-pressed': String(d.date === cur.date),
        onclick: () => { tg.view = d.date; renderSheet(); },
        text: `${state(d) === 'done' ? '✓ ' : state(d) === 'changed' ? '! ' : ''}${WEEKDAYS_SHORT[weekday(d.date)]} ${Number(d.date.slice(8))}`,
      }))),
      tooLong(cur.text, 'Сократите ДЗ или вынесите ссылки отдельным сообщением.') || '',
      mainBtn, preview(cur.text, 'tg-text')); // кнопка выше текста — нажать можно, не прокручивая
  } else if (tg.tab === 'week') {
    const text = weekText(S.monday, S.data, opts);
    if (!text) { box.append(h('div', { class: 'empty' }, h('b', { text: 'На этой неделе нечего публиковать' }))); return out; }
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'tg-copy', text: 'Скопировать всё',
      onclick: () => copyText(weekText(S.monday, S.data, { emoji: tgEmoji() }), btn) });
    box.append(h('p', { class: 'small muted', style: 'margin:0', text: 'Вся неделя одним сообщением.' }),
      tooLong(text, 'Скопируйте по дням (вкладка «По дням»).') || '', btn, preview(text, 'tg-text'));
  } else {
    const list = weekChanges(S.monday, S.data);
    if (!list.length) { box.append(h('div', { class: 'empty' }, h('b', { text: 'На этой неделе изменений не было' }), h('span', { class: 'muted', text: 'Здесь появятся замены, отмены, переносы и доп. пары.' }))); return out; }
    if (list.length > 1) {
      const allBtn = h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'tg-copy-all', text: `Скопировать все изменения (${list.length})`,
        onclick: () => copyText(weekChanges(S.monday, S.data).map((x) => x.text).join('\n'), allBtn) });
      box.append(allBtn);
    }
    box.append(...list.map((x, i) => {
      const btn = h('button', { type: 'button', class: 'btn btn-ghost', id: 'tg-ch-' + i, text: 'Скопировать', onclick: () => copyText(x.text, btn) });
      return h('div', { class: 'variant tg-change' }, h('div', { style: 'white-space:pre-wrap', text: x.text }), btn);
    }));
  }
  return out;
}

/** Блок «Сообщение для группы» в карточке изменённой пары. */
export function changeNotice(p) {
  const list = pairChanges(p, S.data);
  if (!list.length) return null;
  const text = list.join('\n');
  const btn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'tg-pair', text: 'Скопировать для Telegram', onclick: () => copyText(text, btn) });
  return h('div', { class: 'sec' }, h('div', { class: 'caps muted', text: 'Сообщение для группы' }),
    h('div', { class: 'variant', style: 'white-space:pre-wrap', text }), btn);
}
