// «Вставить из Telegram» (экраны 21–22): сообщения активистов → предпросмотр → «Записать».
// Записываются только ДЗ, ссылки и пометки дня — как обычные правки (работает и без сети, с «Отменить»).
import { mondayOf } from '../schedule.js';
import { longDay, shortTime, shortLink } from '../format.js';
import { h, tile, fullName } from '../dom.js';
import { parseMessages, planImport, mergedPatch } from '../importer.js';
import { S, hooks } from './state.js';
import { openSheet, closeSheet, renderSheet, sheetHead } from './ui.js';
import { commit, pairOp } from './sync.js';

const IM = { view: 'paste', text: '', plan: null, choice: {}, err: '' };
const key = (it) => `${it.date}|${it.pair.id}`;

export function openImport(ret) {
  IM.view = 'paste'; IM.err = '';
  openSheet(importSheet, ret, true);
}
function importSheet() { return IM.view === 'preview' && IM.plan ? previewView() : pasteView(); }
function show(view) {
  IM.view = view; renderSheet(); document.getElementById('sheet').scrollTop = 0;
  const t = document.getElementById('sheet-title'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } // новый экран — фокус на заголовок
}

// ---------- 21. вставка ----------
function pasteView() {
  const ta = h('textarea', { class: 'input', id: 'im-text', name: 'telegram', rows: '12', placeholder: 'ВТОРНИК\n27.10.2026\n11⁴⁰-13¹⁰\n1⃣пара/222 - Муниципальное право\n…', 'aria-describedby': 'im-err im-hint' });
  ta.value = IM.text;
  const err = h('div', { class: 'err', id: 'im-err', role: 'alert', text: IM.err });
  const parse = h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'im-parse', disabled: !IM.text.trim(), text: 'Разобрать' });
  const why = h('div', { class: 'xs muted', id: 'im-why', hidden: !!IM.text.trim(), text: 'Сначала вставьте текст сообщений.' });
  ta.addEventListener('input', () => { IM.text = ta.value; parse.disabled = !ta.value.trim(); why.hidden = !!ta.value.trim(); });
  parse.addEventListener('click', () => {
    const parsed = parseMessages(IM.text, S.monday);
    if (!parsed.days.length) { IM.err = 'Не нашёл ни одного дня. Нужны строки вида «ВТОРНИК», «27.10.2026» и «1⃣ пара/222 - …».'; renderSheet(); document.getElementById('im-text').focus(); return; }
    IM.plan = planImport(S.data, parsed); IM.choice = {}; IM.err = '';
    show('preview');
  });
  const pasteBtn = h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'im-paste', text: 'Вставить из буфера', onclick: async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) throw new Error('пусто');
      IM.text = IM.text ? IM.text + '\n\n' + t : t; IM.err = ''; renderSheet();
      document.getElementById('im-parse').focus(); // текст вставлен — следующий шаг «Разобрать»
    } catch { IM.err = 'Телефон не дал прочитать буфер. Вставьте текст в поле долгим нажатием.'; renderSheet(); }
  } });
  return [sheetHead('Вставить из Telegram', 'ДЗ, ссылки и пометки дня'), h('div', { class: 'stack' },
    h('div', {}, h('label', { class: 'lbl', for: 'im-text', text: 'Сообщения из Telegram' }), ta,
      h('div', { class: 'xs muted', id: 'im-hint', style: 'margin-top:4px', text: 'Можно вставить одно или несколько сообщений подряд, как они есть в группе. Аудитории и время из сообщений расписание не меняют.' }), err),
    pasteBtn, parse, why)];
}

// ---------- 22. предпросмотр ----------
/** Операции записи и итог для экрана — из одного расчёта, чтобы цифры совпадали с тем, что запишется. */
function planOps() {
  const { items, notes } = IM.plan;
  const ops = [];
  let hw = 0, links = 0;
  for (const it of items) {
    const patch = mergedPatch(it, IM.choice[key(it)] || 'keep');
    if (!patch) continue;
    ops.push(pairOp(it.pair, patch));
    if (patch.hw !== it.pair.hw) hw++;
    links += patch.links.filter((u) => !it.pair.links.includes(u)).length;
  }
  const perDay = {};
  for (const n of notes) {
    if (n.status !== 'new') continue;
    const have = S.data.dayNotes.filter((x) => x.date === n.date).length + (perDay[n.date] || 0);
    if (have >= 10) continue; // не больше 10 пометок в день — как на сервере
    perDay[n.date] = (perDay[n.date] || 0) + 1;
    ops.push({ type: 'note.add', date: n.date, text: n.text });
  }
  return { ops, hw, links, notes: ops.filter((o) => o.type === 'note.add').length };
}
const counts = () => planOps();

function previewView() {
  const { items, notes, unassigned } = IM.plan;
  const c = counts();
  const box = h('div', { class: 'stack' });
  const summary = h('p', { id: 'im-summary', style: 'margin:0;font-weight:600', text: `Будет записано: ДЗ — ${c.hw}, ссылок — ${c.links}, пометок — ${c.notes}` });
  box.append(summary);
  const dates = [...new Set([...items.map((i) => i.date), ...notes.map((n) => n.date)])].sort();
  for (const date of dates) {
    const sec = h('section', { class: 'variant im-day', 'aria-label': longDay(date) }, h('b', { text: longDay(date) }));
    for (const it of items.filter((i) => i.date === date)) {
      const idx = items.indexOf(it);
      const p = it.pair;
      const badge = it.status === 'new' ? h('span', { class: 'pill', text: 'новое' }) : it.status === 'same' ? h('span', { class: 'pill', style: 'opacity:.7', text: 'уже есть, то же самое' }) : h('span', { class: 'pill warn', text: 'уже вписано другое ДЗ' });
      const row = h('div', { class: 'im-item', 'data-id': key(it), style: 'margin-top:10px;display:flex;flex-direction:column;gap:6px' },
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, tile(p.subject, S.data.subjects),
          h('span', { style: 'flex:1;min-width:0', text: `${shortTime(p.start)} · ${fullName(p.subject, S.data.subjects)}` })),
        h('div', {}, badge),
        it.hw ? h('div', { class: 'small', style: 'white-space:pre-wrap', text: it.hw }) : null,
        it.links.length ? h('div', { class: 'xs mono', text: it.links.map(shortLink).join('\n'), style: 'white-space:pre-wrap' }) : null);
      if (it.status === 'differs') {
        const cur = IM.choice[key(it)] || 'keep';
        row.append(h('div', { class: 'small muted', style: 'white-space:pre-wrap', text: 'Сейчас на сайте: ' + ([p.hw, ...p.links.map(shortLink)].filter(Boolean).join('\n') || '—') }),
          h('div', { class: 'radio', role: 'radiogroup', 'aria-label': `${fullName(p.subject, S.data.subjects)}, ${longDay(date)}: что сделать с уже вписанным ДЗ` },
            ...[['keep', 'Оставить как на сайте'], ['replace', 'Заменить'], ['merge', 'Объединить']].map(([v, label]) => h('label', {},
              h('input', { type: 'radio', name: 'im-' + key(it), id: `im-${idx}-${v}`, value: v, checked: cur === v, onchange: () => {
                IM.choice[key(it)] = v; renderSheet(); // итог и «Записать» пересчитываются
                const back = document.getElementById(`im-${idx}-${v}`); if (back) back.focus(); // фокус — на тот же переключатель
              } }), label))));
      }
      for (const w of it.warnings) row.append(h('p', { class: 'banner', style: 'margin:0', text: w }));
      sec.append(row);
    }
    const dn = notes.filter((n) => n.date === date);
    if (dn.length) sec.append(h('div', { class: 'small', style: 'margin-top:10px' }, 'Пометка дня: ', ...dn.map((n, i) => h('span', { text: `${i ? '; ' : ''}${n.text}${n.status === 'same' ? ' (уже есть)' : ''}` }))));
    box.append(sec);
  }
  if (unassigned.length) {
    box.append(h('div', { class: 'caps muted', text: 'Не удалось отнести' }),
      h('ul', { class: 'small', id: 'im-unassigned', style: 'margin:0;padding-left:18px' }, unassigned.map((u) => h('li', {}, h('span', { class: 'mono', text: u.line }), ' — ', u.reason))));
  }
  const nothing = !c.hw && !c.links && !c.notes;
  if (nothing) {
    const why = !items.length && !notes.length ? 'Нечего записать: ни одна строка не подошла к парам на сайте — см. «Не удалось отнести».'
      : items.some((i) => i.status === 'differs') ? 'Ничего не изменится: для уже вписанного выбрано «Оставить как на сайте».'
        : 'Всё из сообщений уже есть на сайте.';
    box.append(h('p', { class: 'small muted', id: 'im-nothing', style: 'margin:0', text: why }));
  }
  box.append(h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'im-write', disabled: nothing, text: 'Записать', onclick: write }),
    h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => show('paste'), text: '‹ Изменить текст' }));
  return [sheetHead('Что запишется', 'Вставить из Telegram'), box];
}

function write() {
  const { items, notes } = IM.plan;
  const { ops, hw, links, notes: n } = planOps();
  if (!ops.length) return;
  const first = [...items.map((i) => i.date), ...notes.map((x) => x.date)].sort()[0];
  IM.text = ''; IM.plan = null; IM.view = 'paste';
  closeSheet();
  S.monday = mondayOf(first); // показать неделю, куда записали
  commit(ops, `Записано: ДЗ — ${hw}, ссылок — ${links}, пометок — ${n}`, { rerenderSheet: false }); // одно действие — «Отменить» откатывает весь импорт
  hooks.render();
}
