// Редактор для активистов: вход по коду, неделя, мастер «Заполнить», карточка пары, пометки дня.
// Правки применяются на экране сразу и уходят на сервер из очереди (store.js) — без сети не теряются.
import { buildDay, weekDates, mondayOf, addDays, weekday } from './schedule.js';
import { moscowNow } from './time.js';
import { dayMonth, longDay, weekRange, shortTime, WEEKDAYS_SHORT } from './format.js';
import { h, icons, halfLabel, tile, fullName, safeLink } from './dom.js';
import { loadSchedule } from './api.js';
import { postRequest, newOpId } from './editor-api.js';
import { applyOp, inverseOf, createQueue, applyResult } from './store.js';
import { API_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const TYPE = { lecture: 'лекция', seminar: 'семинар', other: 'занятие' };
const CODE_KEY = 'raspisanie-322:code';
const NOTE_PRESETS = ['Сменка', 'Полная посещаемость', 'Сдаём КСУ', 'Принести кодекс', 'Контрольная'];

// Хранилище браузера может быть недоступно (приватный режим) — тогда работаем в памяти.
function safeStorage(kind) { try { const s = window[kind]; s.getItem('x'); return s; } catch { return null; } }
const local = safeStorage('localStorage');
const session = safeStorage('sessionStorage');
const memory = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();

const S = {
  data: null, name: null, code: null, monday: null,
  status: 'idle', sending: false, fresh: false, refreshing: false, openLectures: {},
  queue: createQueue(local || memory),
};

// ---------------- вход ----------------
function savedCode() {
  try { return (local && local.getItem(CODE_KEY)) || (session && session.getItem(CODE_KEY)) || null; } catch { return null; }
}
function rememberCode(code, remember) {
  try { const s = remember ? local : session; if (s) s.setItem(CODE_KEY, code); } catch { /* приватный режим */ }
}
function forgetCode() {
  try { if (local) local.removeItem(CODE_KEY); if (session) session.removeItem(CODE_KEY); } catch { /* ок */ }
}

async function tryLogin(code) {
  const res = await postRequest(API_URL, { action: 'login', code });
  if (!res.ok) return { error: res.message || 'Код не подошёл.', kind: res.error };
  return { name: res.name };
}

function renderLogin(message = '') {
  $('top').replaceChildren(); $('bar').hidden = true; document.body.classList.remove('has-bar');
  const input = h('input', { class: 'input mono', id: 'code', name: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: 'например, 123456', 'aria-describedby': 'code-err', style: 'font-size:1.4rem;letter-spacing:.3em;text-align:center' });
  const err = h('div', { class: 'err', id: 'code-err', role: 'alert', text: message });
  const remember = h('input', { type: 'checkbox', id: 'remember', name: 'remember', checked: true });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-big w100', text: 'Войти' });
  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) { err.textContent = 'Код — это 6 цифр.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Проверяю…'; err.textContent = '';
      try {
        const r = await tryLogin(code);
        if (r.error) { err.textContent = r.error; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        S.code = code; S.name = r.name; rememberCode(code, remember.checked);
        start();
      } catch {
        err.textContent = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
      } finally { btn.disabled = false; btn.textContent = 'Войти'; }
    },
  },
  h('div', {}, h('label', { class: 'lbl', for: 'code', text: 'Код доступа' }), input, err),
  h('label', { class: 'check' }, remember, 'Запомнить на этом телефоне'), btn);
  $('app').replaceChildren(h('div', { class: 'stack', style: 'padding-top:32px' },
    h('div', {}, h('div', { class: 'caps muted', text: 'Группа 322' }),
      h('h1', { class: 'display', style: 'font-size:2rem;line-height:1.05;margin-top:8px', text: 'Для активистов' }),
      h('p', { class: 'muted', style: 'margin:8px 0 0', text: 'Расписание уже собрано по шаблону. Останется вписать ДЗ и пометки.' })),
    h('div', { style: 'background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px' }, form),
    h('p', { class: 'small muted', style: 'margin:0', text: 'Нет кода? Напишите Еремею.' })));
  input.focus();
}

// ---------------- данные ----------------
function defaultMonday() {
  const now = moscowNow(); const wd = weekday(now.date);
  // с пятницы 12:00 до воскресенья готовим следующую неделю, в остальное время — текущая
  if (wd === 0 || wd === 6 || (wd === 5 && now.minutes >= 12 * 60)) return addDays(mondayOf(now.date), 7);
  return mondayOf(now.date);
}
function withQueue(fresh) {
  // свежие данные с сервера + правки, которые ещё не дошли, — чтобы они не «исчезли» с экрана
  for (const op of S.queue.list()) applyOp(fresh, op, {});
  return fresh;
}
function reload() {
  return loadSchedule({
    apiUrl: API_URL, storage: local || null,
    onData: (data, info) => {
      S.data = withQueue(JSON.parse(JSON.stringify(data)));
      S.fresh = info.source === 'network'; // сохранённая в телефоне копия может быть старой — версии в ней устарели
      render({ sheet: false }); flush();
    },
    onStatus: (status) => {
      if (!S.data) {
        $('app').replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Не удалось загрузить неделю' }),
          h('span', { class: 'muted', text: 'Проверьте интернет и обновите страницу.' })));
      } else if (status === 'offline') setStatus('offline');
    },
  });
}

// ---------------- сохранение ----------------
function setStatus(s) { S.status = s; renderBar(); }
function localVersion(date, pairId) {
  const e = S.data.entries.find((x) => x.date === date && x.pairId === pairId);
  return e ? e.version || 0 : 0;
}

/** Главная точка правок: сразу на экран, в очередь, на сервер; плашка «Отменить». */
function commit(op, label, { undoable = true, rerenderSheet = true } = {}) {
  const full = { ...op, opId: newOpId() };
  if (full.type === 'entry') full.baseVersion = localVersion(full.date, full.pairId);
  const undo = inverseOf(S.data, full);
  applyOp(S.data, full, { name: S.name });
  S.queue.add(full);
  render({ sheet: rerenderSheet });
  flush();
  if (label) toast(label, undoable && undo ? () => commit(undo, 'Изменение отменено', { undoable: false }) : null);
}

// повтор после ошибки — с нарастающей паузой: 2, 4, 8 … 60 секунд (не долбим сервер)
let retryDelay = 0, retryTimer = null;
function scheduleRetry() {
  retryDelay = Math.min(retryDelay ? retryDelay * 2 : 2000, 60000);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; flush(); }, retryDelay);
}
function retryNow() { retryDelay = 0; clearTimeout(retryTimer); retryTimer = null; flush(); }

async function flush() {
  if (S.sending || !S.code || !S.data) return; // без загруженной недели ответ сервера некуда применить
  // неделя загружена из старой копии (открыли без сети) — сначала свежие данные, иначе версии устарели
  // и каждая правка получит ложный «конфликт»; flush вызовется снова из onData
  if (!S.fresh) { if (!S.refreshing) { S.refreshing = true; reload().finally(() => { S.refreshing = false; }); } return; }
  const batch = S.queue.takeBatch();
  if (!batch.length) return;
  S.sending = true; setStatus('saving');
  const ids = batch.map((o) => o.opId);
  let ok = false;
  try {
    const res = await postRequest(API_URL, { code: S.code, ops: batch });
    if (!res.ok) {
      S.queue.release(ids);
      if (res.error === 'bad-code') {
        forgetCode(); S.code = null; S.name = null;
        renderLogin('Ваш код больше не действует. Напишите Еремею. Несохранённые правки остались на телефоне — войдите с новым кодом.');
        return;
      }
      if (res.error === 'locked') { toast(res.message); setStatus('error'); scheduleRetry(); return; }
      setStatus('error'); scheduleRetry(); return;
    }
    for (const r of res.results) {
      const op = batch.find((o) => o.opId === r.opId);
      if (!op) continue;
      if (r.ok) applyResult(S.data, S.queue, op, r);
      else if (r.error === 'conflict') {
        S.queue.remove(op.opId);
        // правки этой пары, ждущие за конфликтной, — часть «моего варианта»
        const pending = S.queue.takePendingFor(op);
        const patch = Object.assign({}, op.patch, ...pending.map((x) => x.patch));
        conflicts.push({ op: { ...op, patch }, current: r.current || null });
      } else { S.queue.remove(op.opId); showRejected(op, r.message); }
    }
    ok = true; retryDelay = 0;
    setStatus(S.queue.size() ? 'saving' : 'saved');
    render({ sheet: false });
    nextConflict();
  } catch {
    S.queue.release(ids); setStatus('offline'); scheduleRetry();
  } finally {
    S.sending = false;
    if (ok && S.queue.size()) setTimeout(flush, 300); // следующая пачка (например, правка, ждавшая свою пару)
  }
}
window.addEventListener('online', () => { if (!S.fresh) reload(); else retryNow(); });
setInterval(() => { if (S.queue.size() && !retryTimer && !S.sending) flush(); }, 20000);

/** Сервер отклонил правку (неверные данные): показываем причину и сам текст, чтобы его не потерять. */
function showRejected(op, message) {
  const text = op.type === 'entry'
    ? [op.patch.hw, ...(op.patch.links || [])].filter(Boolean).join('\n')
    : op.text || '';
  const close = () => { $('dialog').replaceChildren(); reload(); };
  const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Скопировать текст', onclick: async () => {
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'Скопировано'; } catch { copyBtn.textContent = 'Выделите текст вручную'; }
  } });
  $('dialog').replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'rj-title' }, h('div', { class: 'box' },
    h('h2', { id: 'rj-title', text: 'Правка не сохранилась' }),
    h('p', { style: 'margin:0', text: 'Причина: ' + (message || 'ошибка данных') + '.' }),
    text ? h('div', { class: 'variant', style: 'white-space:pre-wrap', text }) : null,
    h('div', { class: 'cols' }, text ? copyBtn : null, h('button', { type: 'button', class: 'btn btn-primary', onclick: close, text: 'Понятно' })))));
  $('dialog').querySelector('button').focus();
}

// ---------------- общие куски интерфейса ----------------
let toastTimer = null;
function toast(text, undo) {
  const t = $('toast');
  t.replaceChildren(h('span', { text }));
  if (undo) t.append(h('button', { type: 'button', onclick: () => { t.hidden = true; undo(); }, text: 'Отменить' }));
  t.hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 10000 : 3000);
}
const isActive = (p) => p.numbers.length > 0;
const hasHw = (p) => !!(p.hw || p.links.length);
const isDone = (p) => hasHw(p) || p.noHw;
const dayLabel = (date) => `${WEEKDAYS_SHORT[weekday(date)]} ${dayMonth(date)}`;
function weekSeminars() {
  return weekDates(S.monday).flatMap((d) => buildDay(d, S.data).pairs.filter((p) => p.type === 'seminar' && isActive(p) && p.kind === 'template'));
}
function findPair(date, id) { return buildDay(date, S.data).pairs.find((p) => p.id === id); }

// ---------------- нижний лист ----------------
let sheetBuild = null, sheetReturn = null;
function openSheet(build, ret, full = false) {
  sheetBuild = build; sheetReturn = ret || document.activeElement;
  const sh = $('sheet'), sc = $('scrim');
  sh.classList.toggle('full', full); renderSheet();
  sh.hidden = false; sc.hidden = false;
  requestAnimationFrame(() => { sh.classList.add('open'); sc.classList.add('open'); (sh.querySelector('textarea,input,button') || sh).focus(); });
}
function closeSheet() {
  flushText();
  const sh = $('sheet'), sc = $('scrim');
  sh.classList.remove('open'); sc.classList.remove('open'); sheetBuild = null;
  setTimeout(() => { if (!sheetBuild) { sh.hidden = true; sc.hidden = true; } }, 220);
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus();
}
function renderSheet() {
  if (!sheetBuild) return;
  const sh = $('sheet'); const y = sh.scrollTop;
  sh.replaceChildren(h('div', { class: 'grab', 'aria-hidden': 'true' }), ...[].concat(sheetBuild()).filter(Boolean));
  sh.scrollTop = y;
}
function sheetHead(title, sub, lead) {
  return h('div', { class: 'sh-head' }, lead || null,
    h('div', { style: 'flex:1;min-width:0' }, h('h2', { id: 'sheet-title', text: title }), sub ? h('div', { class: 'small muted', text: sub }) : null),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть', onclick: closeSheet, text: '✕' }));
}
$('scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetBuild) closeSheet(); });

// текст ДЗ сохраняется через секунду после остановки ввода или при уходе из поля
let pendingText = null, textTimer = null;
function flushText() { if (pendingText) { const f = pendingText; pendingText = null; clearTimeout(textTimer); f(); } }

// ---------------- блок ДЗ (карточка и мастер) ----------------
function hwBlock(p) {
  const wrap = h('div', { class: 'stack', style: 'gap:12px' });
  const ta = h('textarea', { class: 'input', id: 'hw', name: 'hw', maxlength: '5000', placeholder: 'например: Доклады' });
  ta.value = p.hw;
  const counter = h('div', { class: 'xs muted', style: 'text-align:right' });
  const upd = () => { counter.textContent = ta.value.length > 4000 ? `${ta.value.length} / 5000` : ''; };
  upd();
  ta.addEventListener('input', () => {
    upd(); clearTimeout(textTimer);
    const value = ta.value;
    pendingText = () => commit({ type: 'entry', date: p.date, pairId: p.id, patch: { hw: value } }, 'ДЗ сохранено', { rerenderSheet: false });
    textTimer = setTimeout(flushText, 1000);
  });
  ta.addEventListener('blur', flushText);
  wrap.append(h('div', {}, h('label', { class: 'lbl', for: 'hw', text: 'Подпись к ДЗ' }), ta, counter));

  const links = h('ul', { class: 'links' }, p.links.map((u, i) => h('li', {}, safeLink(u),
    h('button', {
      type: 'button', class: 'icon-btn', 'aria-label': 'Удалить ссылку ' + u,
      onclick: () => { flushText(); commit({ type: 'entry', date: p.date, pairId: p.id, patch: { links: p.links.filter((_, j) => j !== i) } }, 'Ссылка удалена'); },
      text: '✕',
    }))));
  const linkErr = h('div', { class: 'err', id: 'link-err', role: 'alert' });
  const linkInput = h('input', { class: 'input', id: 'link', name: 'link', type: 'url', inputmode: 'url', placeholder: 'https://t.me/c/…', 'aria-describedby': 'link-err' });
  const addLink = () => {
    const url = linkInput.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      linkErr.textContent = 'Ссылка должна начинаться с https:// — скопируйте её в Telegram («Копировать ссылку»).';
      linkInput.setAttribute('aria-invalid', 'true'); linkInput.focus(); return;
    }
    if (url.length > 500) { linkErr.textContent = 'Ссылка длиннее 500 знаков. Скопируйте короткую ссылку на сообщение в Telegram.'; return; }
    const current = findPair(p.date, p.id);
    if (current.links.length >= 10) { linkErr.textContent = 'Не больше 10 ссылок на пару.'; return; }
    flushText();
    commit({ type: 'entry', date: p.date, pairId: p.id, patch: { links: [...current.links.filter((l) => l !== url), url] } }, 'Ссылка добавлена');
  };
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } });
  wrap.append(h('div', { class: 'stack', style: 'gap:8px' }, h('label', { class: 'lbl', for: 'link', style: 'margin:0', text: 'Ссылки' }), links,
    h('div', { style: 'display:flex;gap:8px' }, linkInput, h('button', { type: 'button', class: 'btn btn-secondary', onclick: addLink, text: 'Добавить' })), linkErr));
  return wrap;
}

// ---------------- карточка пары ----------------
function openPair(date, id, ret) { openSheet(() => pairSheet(date, id), ret); }
function pairSheet(date, id) {
  const p = findPair(date, id);
  if (!p) return [sheetHead('Пара не найдена'), h('p', { text: 'Возможно, её перенесли. Закройте карточку.' })];
  const out = [sheetHead(`${fullName(p.subject, S.data.subjects)} · ${TYPE[p.type] || ''}`,
    `${dayLabel(date)} · ${shortTime(p.start)}–${shortTime(p.end)} · ауд. ${p.room}${p.teacher ? ' · ' + p.teacher : ''}`, tile(p.subject, S.data.subjects))];
  if (p.note) out.push(h('p', { class: 'small muted', style: 'margin:-8px 0 12px', text: 'Всегда: ' + p.note }));
  if (p.status === 'moved-away') {
    out.push(h('p', { class: 'banner', text: `Пара перенесена на ${dayMonth(p.movedTo.date)}, ${shortTime(p.movedTo.start)}. ДЗ — у перенесённой пары.` }));
    return out;
  }
  if (p.status === 'cancelled') out.push(h('p', { class: 'banner', text: 'Пара отменена' + (p.reason ? ': ' + p.reason : '') }));
  if (p.kind === 'extra') { out.push(h('p', { class: 'small muted', text: 'ДЗ для перенесённых и дополнительных пар появится на шаге 6.' })); return out; }
  out.push(hwBlock(p));
  out.push(h('div', { class: 'sec' },
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', id: 'nohw', checked: p.noHw && !hasHw(p), disabled: hasHw(p),
        onchange: (e) => { flushText(); commit({ type: 'entry', date, pairId: id, patch: { noHw: e.target.checked } }, e.target.checked ? 'Отмечено: ДЗ нет' : 'Отметка снята'); },
      }),
      hasHw(p) ? 'ДЗ нет — недоступно: ДЗ уже вписано' : 'ДЗ нет (группа увидит «ДЗ нет»)')));
  return out;
}

// ---------------- мастер «Заполнить» ----------------
let wizard = { keys: [], i: 0 };
function openWizard(ret) {
  const sems = weekSeminars();
  const first = sems.findIndex((p) => !isDone(p));
  wizard = { keys: sems.map((p) => [p.date, p.id]), i: first < 0 ? 0 : first };
  openSheet(wizardView, ret, true);
}
function wizardView() {
  const { keys } = wizard;
  if (wizard.i >= keys.length) {
    const ps = keys.map(([d, id]) => findPair(d, id)).filter(Boolean);
    return [sheetHead('Готово', weekRange(S.monday)), h('div', { class: 'big-check', 'aria-hidden': 'true', text: '✓' }),
      h('p', { style: 'text-align:center;margin:0 0 16px', text: `С ДЗ: ${ps.filter(hasHw).length} · «ДЗ нет»: ${ps.filter((p) => p.noHw && !hasHw(p)).length} · пропущено: ${ps.filter((p) => !isDone(p)).length}` }),
      h('button', { type: 'button', class: 'btn btn-primary btn-big w100', onclick: closeSheet, text: 'Вернуться к неделе' })];
  }
  const [date, id] = keys[wizard.i];
  const p = findPair(date, id);
  if (!p) { wizard.i++; return wizardView(); }
  const go = (n) => { flushText(); wizard.i = Math.max(0, n); renderSheet(); $('sheet').scrollTop = 0; };
  return [
    h('div', { class: 'steps', 'aria-hidden': 'true' }, keys.map(([d, k], i) => { const q = findPair(d, k); return h('i', { class: i === wizard.i ? 'cur' : (q && isDone(q) ? 'done' : '') }); })),
    sheetHead(fullName(p.subject, S.data.subjects), `Семинар ${wizard.i + 1} из ${keys.length} · ${dayLabel(date)} · ${shortTime(p.start)} · ауд. ${p.room}`, tile(p.subject, S.data.subjects)),
    hwBlock(p),
    h('div', { class: 'wz-foot' },
      p.noHw && !hasHw(p)
        ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => commit({ type: 'entry', date, pairId: id, patch: { noHw: false } }, 'Отметка снята'), text: 'Вернуть' })
        : h('button', {
          type: 'button', class: 'btn btn-secondary', disabled: hasHw(p), title: hasHw(p) ? 'ДЗ уже вписано' : null,
          onclick: () => { commit({ type: 'entry', date, pairId: id, patch: { noHw: true } }, null, { rerenderSheet: false }); go(wizard.i + 1); },
          text: 'ДЗ нет',
        }),
      h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => go(wizard.i + 1), text: wizard.i + 1 < keys.length ? 'Дальше ›' : 'Завершить' })),
    wizard.i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => go(wizard.i - 1), text: '‹ Предыдущий семинар' }) : null,
  ];
}

// ---------------- пометки дня ----------------
function openNotes(date, ret) { openSheet(() => notesSheet(date), ret); }
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

// ---------------- конфликт двух правок ----------------
const conflicts = [];               // показываем по одному, чтобы выбор не потерялся
let conflictOpen = false;
function nextConflict() {
  if (conflictOpen || !conflicts.length) return;
  const { op, current } = conflicts.shift();
  conflictOpen = true;
  showConflict(op, current);
}
function showConflict(op, current) {
  const pair = findPair(op.date, op.pairId) || {};
  const mine = { ...pair, ...op.patch };
  const theirs = current || { hw: '', links: [] };
  const who = theirs.by || 'другой активист';
  const entry = () => S.data.entries.find((x) => x.date === op.date && x.pairId === op.pairId);
  const done = () => { $('dialog').replaceChildren(); conflictOpen = false; nextConflict(); };
  const describe = (x) => [x.hw || '(без подписи)', ...(x.links || []), x.noHw ? '«ДЗ нет»' : ''].filter(Boolean).join('\n');
  const setServerVersion = () => { const e = entry(); if (e) e.version = current ? current.version || 0 : 0; };
  const keepTheirs = () => {
    if (current) { const e = entry(); if (e) Object.assign(e, current); }
    else S.data.entries = S.data.entries.filter((x) => !(x.date === op.date && x.pairId === op.pairId)); // на сервере записи нет
    done(); render(); toast('Оставлен вариант: ' + who);
  };
  const keepMine = () => {
    setServerVersion(); done();
    commit({ type: 'entry', date: op.date, pairId: op.pairId, patch: op.patch }, 'Сохранён ваш вариант', { undoable: false });
  };
  const mergeLinks = () => {
    setServerVersion(); done();
    const links = [...new Set([...(theirs.links || []), ...(mine.links || [])])].slice(0, 10);
    commit({ type: 'entry', date: op.date, pairId: op.pairId, patch: { ...op.patch, links } }, 'Ссылки объединены', { undoable: false });
  };
  $('dialog').replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-title' }, h('div', { class: 'box' },
    h('h2', { id: 'cf-title', text: `${who} уже изменил(а) эту пару` }),
    h('p', { class: 'small muted', style: 'margin:0', text: `${fullName(mine.subject || '', S.data.subjects)} · ${longDay(op.date)}. Какой вариант оставить?` }),
    h('div', { class: 'cols' },
      h('div', { class: 'variant' }, h('b', { text: 'Вариант: ' + who }), h('div', { style: 'white-space:pre-wrap', text: describe(theirs) })),
      h('div', { class: 'variant' }, h('b', { text: 'Ваш вариант' }), h('div', { style: 'white-space:pre-wrap', text: describe(mine) }))),
    h('div', { class: 'cols' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: keepTheirs, text: 'Оставить вариант ' + who }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: keepMine, text: 'Оставить мой' })),
    'links' in op.patch ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: mergeLinks, text: 'Объединить ссылки' }) : null)));
  $('dialog').querySelector('button').focus();
}

// ---------------- неделя ----------------
function renderTop() {
  const days = weekDates(S.monday).map((d) => buildDay(d, S.data));
  const today = moscowNow().date;
  const moveWeek = (n) => { S.monday = addDays(S.monday, n); render(); window.scrollTo(0, 0); };
  $('top').replaceChildren(h('div', { class: 'top' }, h('div', { class: 'wrap' },
    h('div', { class: 'weekline' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущая неделя', onclick: () => moveWeek(-7) }, icons.prev()),
      h('div', { class: 't' }, h('h1', { class: 'display', text: weekRange(S.monday) }), h('div', { class: 'xs muted' }, halfLabel(days[0].half))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующая неделя', onclick: () => moveWeek(7) }, icons.next())),
    h('nav', { class: 'days', 'aria-label': 'Дни недели' }, days.map((d) => {
      const sems = d.pairs.filter((p) => p.type === 'seminar' && isActive(p));
      const dot = !sems.length ? 'none' : sems.every(isDone) ? 'full' : '';
      return h('button', {
        type: 'button', disabled: !d.pairs.length, 'aria-current': d.date === today ? 'date' : null,
        'aria-label': longDay(d.date) + (sems.length ? (dot === 'full' ? ', всё заполнено' : ', есть семинары без ДЗ') : ''),
        onclick: () => { const el = $('day-' + d.date); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); },
      }, h('span', { class: 'd', text: WEEKDAYS_SHORT[weekday(d.date)].toUpperCase() }), h('span', { class: 'n', text: Number(d.date.slice(8)) }), h('span', { class: 'dot ' + dot }));
    })))));
}

function pairRow(p) {
  const active = isActive(p);
  const st = h('span', { class: 'st' });
  if (active) {
    if (p.type === 'seminar') st.append(hasHw(p) ? h('span', { class: 'ok', text: 'ДЗ ✓' }) : p.noHw ? h('span', { class: 'muted', text: 'ДЗ нет' }) : h('span', { class: 'need', text: 'нет ДЗ' }));
    else if (hasHw(p)) st.append(h('span', { class: 'ok', text: 'ДЗ ✓' }));
    if (p.updatedBy) st.append(h('span', { class: 'muted', text: p.updatedBy }));
  }
  const label = `${p.numbers.length ? p.numbers.join(' и ') + ' пара, ' : ''}${shortTime(p.start)}, ${fullName(p.subject, S.data.subjects)}, ${TYPE[p.type] || ''}, аудитория ${p.room}`
    + (p.status === 'cancelled' ? ', отменена' : '') + (p.status === 'moved-away' ? ', перенесена' : '');
  const row = h('button', { type: 'button', class: 'prow' + (active ? '' : ' dim'), onclick: (e) => openPair(p.date, p.id, e.currentTarget), 'aria-label': label },
    h('span', { class: 'tm' }, shortTime(p.start), h('span', { text: shortTime(p.end) })), tile(p.subject, S.data.subjects),
    h('span', { class: 'mid' }, h('span', { class: 'subj', text: fullName(p.subject, S.data.subjects) }),
      h('span', { class: 'meta' }, h('span', {}, 'ауд. ', h('span', { class: 'room', text: p.room })), h('span', { text: TYPE[p.type] || '' }))),
    active ? st : null);
  if (p.status === 'moved-away') row.append(h('span', { class: 'stamp move', 'aria-hidden': 'true', text: 'Перенесено' }));
  if (p.status === 'cancelled') row.append(h('span', { class: 'stamp cancel', 'aria-hidden': 'true', text: 'Отменено' }));
  return row;
}

function renderEditor() {
  renderTop();
  const days = weekDates(S.monday).map((d) => buildDay(d, S.data));
  const sems = weekSeminars(); const done = sems.filter(isDone).length; const allDone = sems.length > 0 && done === sems.length;
  const out = [h('div', { class: 'userline' }, h('span', { class: 'small muted', text: S.name }),
    h('a', { class: 'btn btn-ghost', href: './', text: 'Как видит группа' }),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { forgetCode(); S.code = null; S.name = null; renderLogin(); }, text: 'Выйти' }))];
  if (sems.length) {
    out.push(h('section', { class: 'fill' + (allDone ? ' done' : ''), 'aria-label': 'Заполнение ДЗ' },
      h('div', {}, h('h2', { text: allDone ? 'Все семинары заполнены' : `ДЗ: ${done} из ${sems.length} семинаров` }),
        h('div', { class: 'small', style: 'opacity:.85', text: allDone ? 'Можно проверить, как видит группа.' : 'Пройдём по семинарам по очереди — около минуты.' })),
      h('button', { type: 'button', class: 'btn', onclick: (e) => openWizard(e.currentTarget), text: allDone ? 'Проверить' : 'Заполнить' }),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, sems.map((p) => h('i', { class: isDone(p) ? 'on' : '' })))));
  } else {
    out.push(h('div', { class: 'empty' }, h('b', { text: 'На этой неделе семинаров нет' }), h('span', { class: 'muted', text: 'Можно добавить пометки дня.' })));
  }
  for (const d of days) {
    const box = h('section', { class: 'day', id: 'day-' + d.date, 'aria-label': longDay(d.date) });
    const active = d.pairs.filter(isActive);
    box.append(h('div', { class: 'day-head' }, h('span', { class: 'dn', text: WEEKDAYS_SHORT[weekday(d.date)].toUpperCase() }),
      h('span', { class: 'dd' }, h('b', { text: dayMonth(d.date) }),
        h('span', { class: 'xs muted mono', text: active.length ? `${shortTime(active[0].start)}–${shortTime(active[active.length - 1].end)}` : 'пар нет' })),
      h('button', { type: 'button', class: 'btn btn-ghost', style: 'padding:0 10px;font-size:.875rem', 'aria-label': 'Пометки дня: ' + longDay(d.date), onclick: (e) => openNotes(d.date, e.currentTarget), text: '+ пометка' })));
    if (d.notes.length) box.append(h('div', { class: 'notes' }, d.notes.map((n) => h('button', { type: 'button', class: 'note-btn', onclick: (e) => openNotes(d.date, e.currentTarget), text: n }))));
    if (!d.pairs.length) box.append(h('p', { class: 'small muted', style: 'padding:0 16px 14px;margin:0', text: 'По шаблону пар нет.' }));
    const quiet = d.pairs.filter((p) => p.type === 'lecture' && isActive(p) && !hasHw(p) && p.kind === 'template' && !Object.keys(p.changed).length);
    const fold = quiet.length >= 2 && !S.openLectures[d.date];
    for (const p of d.pairs) { if (fold && quiet.includes(p)) continue; box.append(pairRow(p)); }
    if (fold) {
      box.append(h('button', { type: 'button', class: 'lect', 'aria-expanded': 'false', onclick: () => { S.openLectures[d.date] = true; render(); },
        text: `+ ${quiet.length} лекции без изменений: ${quiet.map((p) => p.subject).join(', ')}` }));
    }
    out.push(box);
  }
  $('app').replaceChildren(h('div', { class: 'stack' }, out));
}

function renderBar() {
  const bar = $('bar');
  if (!S.name || !S.data) { bar.hidden = true; return; }
  bar.hidden = false; document.body.classList.add('has-bar');
  const n = S.queue.size();
  const [cls, text] = {
    idle: ['idle', 'Все изменения сохранены'],
    saving: ['saving', 'Сохраняю…'],
    saved: ['saved', 'Сохранено'],
    offline: ['offline', `Нет связи — изменений на телефоне: ${n}. Отправлю, когда появится сеть`],
    error: ['error', 'Не сохранилось. Повторю автоматически'],
  }[S.status];
  bar.replaceChildren(h('div', { class: 'inner' }, h('div', { class: 'save ' + cls, role: 'status', text }),
    S.status === 'error' || S.status === 'offline' ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => retryNow(), text: 'Повторить' }) : null));
}

function render({ sheet = true } = {}) {
  if (!S.name || !S.data) return;
  renderEditor(); renderBar();
  if (sheet && sheetBuild) renderSheet();
}

// ---------------- запуск ----------------
function start() {
  S.monday = S.monday || defaultMonday();
  reload();
}

async function boot() {
  if (!API_URL) {
    $('app').replaceChildren(h('div', { class: 'empty' }, h('b', { text: 'Редактор не подключён к серверу' }),
      h('span', { class: 'muted', text: 'В site/src/config.js не указан адрес веб-приложения.' })));
    return;
  }
  const code = savedCode();
  if (!code) { renderLogin(); return; }
  S.code = code;
  try {
    const r = await tryLogin(code);
    if (r.error) {
      // забываем код только если он неверный; при временной блокировке он ещё пригодится
      if (r.kind === 'bad-code') { forgetCode(); S.code = null; }
      renderLogin(r.error); return;
    }
    S.name = r.name; start();
  } catch {
    // нет сети: пускаем к сохранённой неделе, правки встанут в очередь и уйдут позже
    S.name = 'вы (нет связи)'; start(); setStatus('offline');
  }
}
boot();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { flushText(); return; }               // свернули приложение — сохранить набранное
  if (S.name && !S.queue.size()) reload();
});
window.addEventListener('pagehide', flushText);
