// Редактор для активистов: вход по коду, неделя, мастер «Заполнить», карточка пары, пометки дня.
// Правки применяются на экране сразу и уходят на сервер из очереди (store.js) — без сети не теряются.
import { buildDay, studyDates, mondayOf, addDays, weekday } from './schedule.js';
import { moscowNow } from './time.js';
import { dayMonth, longDay, weekRange, shortTime, shortLink, WEEKDAYS_SHORT } from './format.js';
import { h, icons, halfLabel, tile, fullName, safeLink } from './dom.js';
import { loadSchedule } from './api.js';
import { postRequest, newOpId } from './editor-api.js';
import { applyOp, inverseOf, createQueue, applyResult } from './store.js';
import { API_URL } from './config.js';
import { splitPaste, learnTopics, linkInfo, previousHomework, frequentPhrases } from './helpers.js';
import { weekDays, weekText, weekChanges, pairChanges, TG_LIMIT } from './telegram.js';
import { registerPWA } from './pwa.js';

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
      // открытый лист Telegram перерисовываем: в нём нет полей ввода, а тексты должны быть свежими
      render({ sheet: sheetBuild === telegramSheet }); flush();
      if (!S.coachChecked) { S.coachChecked = true; if (!hintsSeen()) startCoach(); } // подсказки — при самом первом входе
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
/** Версия объекта на экране — сервер сверит её, чтобы не затереть чужую правку. */
function localVersion(op) {
  const obj = op.type === 'entry'
    ? S.data.entries.find((x) => x.date === op.date && x.pairId === op.pairId)
    : (S.data.extras || []).find((x) => x.id === op.id);
  return obj ? obj.version || 0 : 0;
}

/**
 * Главная точка правок: сразу на экран, в очередь, на сервер; плашка «Отменить».
 * Можно передать несколько операций — это одно действие активиста (например, новое время =
 * правило для начала + правило для конца), и «Отменить» откатывает их все сразу.
 */
function commit(opOrOps, label, { undoable = true, rerenderSheet = true, afterUndo = null } = {}) {
  const ops = Array.isArray(opOrOps) ? opOrOps : [opOrOps];
  const undos = [];
  for (const op of ops) {
    const full = { ...op, opId: newOpId() };
    if (full.type === 'entry' || full.type === 'extra.update') full.baseVersion = localVersion(full);
    const undo = inverseOf(S.data, full); // считаем до применения правки
    applyOp(S.data, full, { name: S.name });
    S.queue.add(full);
    if (undo) undos.unshift(undo);      // откатывать — в обратном порядке
  }
  render({ sheet: rerenderSheet });
  flush();
  const undo = () => { commit(undos, 'Изменение отменено', { undoable: false }); if (afterUndo) afterUndo(); };
  if (label) toast(label, undoable && undos.length ? undo : null);
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
        // правки этого объекта, ждущие за конфликтной, — часть «моего варианта»
        const pending = S.queue.takePendingFor(op);
        const merged = { ...op, patch: Object.assign({}, op.patch, ...pending.map((x) => x.patch || {})) };
        if (op.type === 'extra.update' && !r.current) queueDialog(() => showRejected(merged, 'эту пару успел удалить другой активист'));
        else queueDialog(() => showConflict(merged, r.current || null));
      } else { S.queue.remove(op.opId); queueDialog(() => showRejected(op, r.message)); }
    }
    ok = true; retryDelay = 0;
    setStatus(S.queue.size() ? 'saving' : 'saved');
    render({ sheet: false });
  } catch {
    S.queue.release(ids); setStatus('offline'); scheduleRetry();
  } finally {
    S.sending = false;
    if (ok && S.queue.size()) setTimeout(flush, 300); // следующая пачка (например, правка, ждавшая свою пару)
  }
}
window.addEventListener('online', () => { if (!S.fresh) reload(); else retryNow(); });
setInterval(() => { if (S.queue.size() && !retryTimer && !S.sending) flush(); }, 20000);

// Окна (конфликт, отказ) показываются строго по одному: новое не затирает открытое, выбор не теряется.
const dialogs = [];
let dialogOpen = false;
function queueDialog(show) { dialogs.push(show); pumpDialog(); }
function pumpDialog() { if (dialogOpen || !dialogs.length) return; dialogOpen = true; dialogs.shift()(); }
function closeDialog() { $('dialog').replaceChildren(); dialogOpen = false; pumpDialog(); }

/** Сервер отклонил правку (неверные данные): показываем причину и сам текст, чтобы его не потерять. */
function showRejected(op, message) {
  const src = op.patch || op.extra || {};
  const text = op.text || [src.hw, ...(src.links || [])].filter(Boolean).join('\n');
  const close = () => { closeDialog(); reload(); };
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
  return studyDates(S.monday, S.data).flatMap((d) => buildDay(d, S.data).pairs.filter((p) => p.type === 'seminar' && isActive(p)));
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
// «Выученные» темы считаются один раз на загрузку недели
let learnedFor = null, learned = { groupChat: null, topics: {} };
function topics() { if (learnedFor !== S.data) { learned = learnTopics(S.data); learnedFor = S.data; } return learned; }
const keptLinks = new Set(); // ссылки, про которые активист сказал «всё верно, оставить»

function hwBlock(p) {
  const wrap = h('div', { class: 'stack', style: 'gap:12px' });
  const save = (patch, label, opts) => { flushText(); commit(pairOp(p, patch), label, opts); };

  // «Как в прошлый раз»: прошлое занятие того же предмета и типа
  const prev = previousHomework(S.data, p.date, p.subject, p.type);
  const same = prev && prev.hw === p.hw && JSON.stringify(prev.links) === JSON.stringify(p.links);
  if (prev && !same) {
    wrap.append(h('div', { class: 'prev' },
      h('div', { class: 'caps muted', text: `Прошлое занятие · ${dayLabel(prev.date)}` }),
      prev.hw ? h('div', { style: 'white-space:pre-wrap', text: prev.hw }) : null,
      prev.links.map((u) => h('div', { class: 'u', text: shortLink(u) })),
      h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'as-before', onclick: () => save({ hw: prev.hw, links: [...prev.links] }, 'Как ' + dayMonth(prev.date)), text: 'Как в прошлый раз' })));
  }

  // подпись + частые фразы
  const ta = h('textarea', { class: 'input', id: 'hw', name: 'hw', maxlength: '5000', placeholder: 'например: Доклады' });
  ta.value = p.hw;
  const counter = h('div', { class: 'xs muted', style: 'text-align:right' });
  const upd = () => { counter.textContent = ta.value.length > 4000 ? `${ta.value.length} / 5000` : ''; };
  upd();
  ta.addEventListener('input', () => {
    upd(); clearTimeout(textTimer);
    const value = ta.value;
    pendingText = () => commit(pairOp(p, { hw: value }), 'ДЗ сохранено', { rerenderSheet: false });
    textTimer = setTimeout(flushText, 1000);
  });
  ta.addEventListener('blur', flushText);
  const phrases = frequentPhrases(S.data, p.subject).filter((x) => x !== p.hw);
  wrap.append(h('div', {}, h('label', { class: 'lbl', for: 'hw', text: 'Подпись к ДЗ' }),
    phrases.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Частые подписи', style: 'margin-bottom:8px' }, phrases.map((ph) =>
      h('button', { type: 'button', class: 'chip', onclick: () => {
        const cur = (pendingText ? ta.value : findPair(p.date, p.id).hw).trim();
        const next = cur ? cur + '\n' + ph : ph;
        if (next.length > 5000) { toast('Подпись уже почти 5000 знаков — фраза не поместится'); return; }
        save({ hw: next }, 'Добавлено: ' + ph);
      }, text: ph }))) : null,
    ta, counter));

  // ссылки: метка темы у каждой, предупреждение о чужой теме
  const learnedTopics = topics();
  const list = h('ul', { class: 'links' }, p.links.map((u, i) => {
    const info = linkInfo(u, p.subject, learnedTopics);
    return h('li', {}, safeLink(u), h('span', { class: 'pill' + (info.kind === 'warn' && !keptLinks.has(u) ? ' warn' : ''), text: info.label }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Удалить ссылку ' + u, onclick: () => save({ links: p.links.filter((_, j) => j !== i) }, 'Ссылка удалена'), text: '✕' }));
  }));
  const warnings = p.links.map((u) => ({ u, info: linkInfo(u, p.subject, learnedTopics) })).filter((x) => x.info.kind === 'warn' && !keptLinks.has(x.u));
  const linkErr = h('div', { class: 'err', id: 'link-err', role: 'alert' });
  const linkInput = h('input', { class: 'input', id: 'link', name: 'link', type: 'url', inputmode: 'url', placeholder: 'или вставьте сюда долгим нажатием', 'aria-describedby': 'link-err' });

  /** Добавить всё, что вставили: ссылки — в список, остальной текст — в подпись. */
  const addFromText = (text) => {
    const { links, rest } = splitPaste(text);
    if (!links.length) {
      linkErr.textContent = 'В тексте нет ссылки. В Telegram нажмите на сообщение → «Копировать ссылку» и вставьте ещё раз.';
      linkInput.setAttribute('aria-invalid', 'true'); return;
    }
    const long = links.find((u) => u.length > 500);
    if (long) { linkErr.textContent = 'Ссылка длиннее 500 знаков. Скопируйте короткую ссылку на сообщение в Telegram.'; return; }
    const cur = findPair(p.date, p.id);
    const merged = [...cur.links, ...links.filter((u) => !cur.links.includes(u))];
    if (merged.length > 10) { linkErr.textContent = 'Не больше 10 ссылок на пару.'; return; }
    const patch = { links: merged };
    if (rest) {
      const hw = (pendingText ? ta.value : cur.hw).trim();
      patch.hw = hw ? hw + '\n' + rest : rest;
      if (patch.hw.length > 5000) { linkErr.textContent = 'Вместе с вставленным текстом подпись длиннее 5000 знаков. Сократите её или вставьте только ссылку.'; return; }
    }
    save(patch, links.length > 1 ? `Добавлено ссылок: ${links.length}` : 'Ссылка добавлена');
  };
  linkInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) { e.preventDefault(); addFromText(text); }
  });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromText(linkInput.value); } });

  const pasteBtn = h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'paste-link', text: 'Вставить ссылку', onclick: async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('пусто');
      addFromText(text);
    } catch {
      linkErr.textContent = 'Телефон не дал прочитать буфер. Вставьте ссылку в поле ниже долгим нажатием.';
      linkInput.focus();
    }
  } });

  wrap.append(h('div', { class: 'stack', style: 'gap:8px' }, h('label', { class: 'lbl', for: 'link', style: 'margin:0', text: 'Ссылки' }), list,
    warnings.map((w) => h('div', { class: 'banner', style: 'display:flex;flex-direction:column;gap:8px' },
      h('span', { text: `Ссылка из темы «${w.info.topicSubject}», а пара — ${fullName(p.subject, S.data.subjects)}. Всё верно?` }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { keptLinks.add(w.u); renderSheet(); }, text: 'Да, оставить' }),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => save({ links: findPair(p.date, p.id).links.filter((x) => x !== w.u) }, 'Ссылка удалена'), text: 'Удалить' })))),
    pasteBtn,
    h('div', { style: 'display:flex;gap:8px' }, linkInput, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => addFromText(linkInput.value), text: 'Добавить' })),
    linkErr));
  return wrap;
}

// ---------------- изменения расписания (шаг 6) ----------------
// Сетка звонков РГУП: из неё выбирают время переноса и доп. пары одним нажатием.
const BELLS = [['08:00', '09:30'], ['09:40', '11:10'], ['11:40', '13:10'], ['13:20', '14:50'], ['15:00', '16:30'], ['16:50', '18:20'], ['18:30', '20:00'], ['20:10', '21:40']];
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
const timeOk = (t) => validTime(t[0]) && validTime(t[1]) && toMin(t[1]) > toMin(t[0]);
const newExtraId = () => 'X-' + newOpId().replace(/^op-/, '').replace(/-/g, '').slice(0, 20);
const tplHalf = (p) => (S.data.template.find((t) => t.id === p.id) || {}).half;
const halfSuffix = (p) => { const hf = tplHalf(p); return hf === 'top' ? ' — по верхним неделям' : hf === 'bottom' ? ' — по нижним неделям' : ''; };
const FIELD_WORD = { room: 'аудитория', teacher: 'преподаватель', start: 'время', end: 'время' };
const showValue = (field, v) => (field === 'start' || field === 'end' ? shortTime(v) : v);

/** Операция правки пары: для пары шаблона — запись дня, для переноса и доп. пары — она сама. */
function pairOp(p, patch) {
  return p.kind === 'extra'
    ? { type: 'extra.update', date: p.date, id: p.id, patch }
    : { type: 'entry', date: p.date, pairId: p.id, patch };
}
function backTo(date, id) { flushText(); sheetBuild = () => pairSheet(date, id); renderSheet(); $('sheet').scrollTop = 0; }
function backBtn(p) { return h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: () => backTo(p.date, p.id), text: '‹ Назад к паре' }); }
function goPanel(p, panel) { return () => { flushText(); sheetBuild = () => { const q = findPair(p.date, p.id); return q ? panel(q) : pairSheet(p.date, p.id); }; renderSheet(); $('sheet').scrollTop = 0; }; }
const panelHead = (title, p) => sheetHead(title, `${fullName(p.subject, S.data.subjects)} · ${dayLabel(p.date)} · ${shortTime(p.start)}`, tile(p.subject, S.data.subjects));
const inSemester = (date) => date >= S.data.settings.semesterStart && date <= S.data.settings.semesterEnd;
const semesterBanner = () => h('p', { class: 'banner', text: `Дата вне семестра (${dayMonth(S.data.settings.semesterStart)} — ${dayMonth(S.data.settings.semesterEnd)}). Сохранить всё равно можно.` });

/** Сетка звонков + поля «Начало/Конец» для нестандартного времени (например, физкультура 14:30). */
function timePicker(cur, onPick) {
  const custom = !BELLS.some((b) => b[0] === cur[0] && b[1] === cur[1]);
  const start = h('input', { class: 'input mono', id: 't-start', name: 'start', type: 'time', value: cur[0] });
  const end = h('input', { class: 'input mono', id: 't-end', name: 'end', type: 'time', value: cur[1] });
  const grid = h('div', { class: 'grid-times', role: 'group', 'aria-label': 'Сетка звонков' }, BELLS.map((b) => h('button', {
    type: 'button', 'aria-pressed': String(!custom && b[0] === cur[0]), 'data-start': b[0], text: `${shortTime(b[0])}–${shortTime(b[1])}`,
    onclick: (ev) => {
      grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      ev.currentTarget.setAttribute('aria-pressed', 'true');
      start.value = b[0]; end.value = b[1]; onPick([b[0], b[1]]);
    },
  })));
  const typed = () => {
    grid.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    onPick([start.value, end.value]);
  };
  start.addEventListener('change', typed); end.addEventListener('change', typed);
  return h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'lbl', style: 'margin:0', text: 'Время по сетке звонков' }), grid,
    h('div', { class: 'cols' }, h('div', {}, h('label', { class: 'lbl', for: 't-start', text: 'Начало' }), start), h('div', {}, h('label', { class: 'lbl', for: 't-end', text: 'Конец' }), end)));
}

/** Какая пара уже стоит в это время (кроме самой пары в этот же день). */
function clashWith(date, t, self) {
  if (!timeOk(t)) return null;
  return buildDay(date, S.data).pairs.find((q) => !(self && q.id === self.id && q.date === self.date)
    && q.numbers.length && toMin(q.start) < toMin(t[1]) && toMin(t[0]) < toMin(q.end)) || null;
}
const clashBanner = (c, tail = '', when = '') => h('p', { class: 'banner', text: `${when ? dayMonth(when) + ' в' : 'В'} это время уже стоит ${fullName(c.subject, S.data.subjects)} (${shortTime(c.start)}–${shortTime(c.end)}).${tail}` });

/** Ближайший следующий день, когда эта пара шаблона снова стоит в расписании (до 4 недель вперёд). */
function nextSameDay(p) {
  for (let i = 7; i <= 28; i += 7) {
    const d = addDays(p.date, i);
    if (buildDay(d, S.data).pairs.some((q) => q.id === p.id && q.kind === 'template')) return d;
  }
  return null;
}

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
function fieldPanel(field) {
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

function timePanel(p) {
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
function showPairAt(date, id) { S.monday = mondayOf(date); if (sheetBuild) sheetBuild = () => pairSheet(date, id); render(); $('sheet').scrollTop = 0; }

function cancelMove(x) {
  if (!x) return;
  commit(moveBackOps(x), `Перенос отменён — пара снова ${dayMonth(x.srcDate)}`, { rerenderSheet: false, afterUndo: () => showPairAt(x.srcDate, x.srcPairId) });
  showPairAt(x.srcDate, x.srcPairId);
}
const extraById = (id) => (S.data.extras || []).find((x) => x.id === id);
const moveOf = (p) => (S.data.extras || []).find((x) => x.srcDate === p.date && x.srcPairId === p.id && !x.cancelled);

function cancelPanel(p) {
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

function movePanel(p) {
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
    if (!inSemester(date)) warn.append(semesterBanner());
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
function openAddPair(date, ret) { openSheet(() => addPairSheet(date), ret); }
function addPairSheet(date) {
  let t = ['18:30', '20:00'];
  const subjects = [...new Map(S.data.template.map((x) => [x.subject + '|' + x.type, x])).values()];
  const sel = h('select', { class: 'input', id: 'a-subject', name: 'subject' },
    subjects.map((x, i) => h('option', { value: String(i), text: `${fullName(x.subject, S.data.subjects)} · ${TYPE[x.type] || ''}` })), h('option', { value: 'other', text: 'Другое…' }));
  const other = h('input', { class: 'input', id: 'a-other', name: 'other', type: 'text', maxlength: '100', placeholder: 'например, Консультация к экзамену' });
  const otherBox = h('div', { hidden: true }, h('label', { class: 'lbl', for: 'a-other', text: 'Название' }), other);
  const room = h('input', { class: 'input mono', id: 'a-room', name: 'room', type: 'text', maxlength: '30', value: subjects[0] ? subjects[0].room : '' });
  const err = h('div', { class: 'err', role: 'alert' }); const warn = h('div', { class: 'stack', style: 'gap:8px' });
  const check = () => {
    warn.replaceChildren();
    if (!inSemester(date)) warn.append(semesterBanner());
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

/** Кнопка, которая срабатывает со второго нажатия (для необратимого на вид: удаление доп. пары). */
function confirmButton(attrs, text, confirmText, action) {
  let armed = false, timer = null;
  const btn = h('button', { type: 'button', ...attrs, text });
  btn.addEventListener('click', () => {
    if (armed) { clearTimeout(timer); action(); return; }
    armed = true; btn.textContent = confirmText; btn.classList.add('armed');
    timer = setTimeout(() => { armed = false; btn.textContent = text; btn.classList.remove('armed'); }, 5000);
  });
  return btn;
}

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

// ---------------- текст для Telegram (шаг 7) ----------------
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

function openTelegram(ret, tab) {
  if (tg.monday !== S.monday) { tg.monday = S.monday; tg.copied = new Map(); tg.view = null; }
  if (tab) tg.tab = tab;
  openSheet(telegramSheet, ret, true);
}
function telegramSheet() {
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
function changeNotice(p) {
  const list = pairChanges(p, S.data);
  if (!list.length) return null;
  const text = list.join('\n');
  const btn = h('button', { type: 'button', class: 'btn btn-secondary', id: 'tg-pair', text: 'Скопировать для Telegram', onclick: () => copyText(text, btn) });
  return h('div', { class: 'sec' }, h('div', { class: 'caps muted', text: 'Сообщение для группы' }),
    h('div', { class: 'variant', style: 'white-space:pre-wrap', text }), btn);
}

// ---------------- карточка пары ----------------
function openPair(date, id, ret) { openSheet(() => pairSheet(date, id), ret); }
function pairSheet(date, id) {
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
      h('button', { type: 'button', class: 'btn btn-primary btn-big w100', id: 'wz-telegram', onclick: (e) => { closeSheet(); openTelegram(e.currentTarget, 'days'); }, text: 'Текст для Telegram' }),
      h('button', { type: 'button', class: 'btn btn-ghost w100', onclick: closeSheet, text: 'Вернуться к неделе' })];
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
        ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => commit(pairOp(p, { noHw: false }), 'Отметка снята'), text: 'Вернуть' })
        : h('button', {
          type: 'button', class: 'btn btn-secondary', disabled: hasHw(p), title: hasHw(p) ? 'ДЗ уже вписано' : null,
          onclick: () => { commit(pairOp(p, { noHw: true }), null, { rerenderSheet: false }); go(wizard.i + 1); },
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
// Для пары шаблона сравниваем записи дня, для переноса и доп. пары — саму доп. пару.
function showConflict(op, current) {
  const isExtra = op.type === 'extra.update';
  const local = () => (isExtra ? (S.data.extras || []).find((x) => x.id === op.id) : S.data.entries.find((x) => x.date === op.date && x.pairId === op.pairId));
  const pair = (isExtra ? findPair((local() || current || op).date, op.id) : findPair(op.date, op.pairId)) || current || {};
  const mine = { subject: pair.subject, ...op.patch };
  const theirs = current || { hw: '', links: [] };
  const who = theirs.by || 'другой активист';
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
    done(); render(); toast('Оставлен вариант: ' + who);
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
  const days = studyDates(S.monday, S.data).map((d) => buildDay(d, S.data));
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
      h('span', { class: 'meta' }, h('span', {}, 'ауд. ', h('span', { class: 'room' + (p.changed.room || p.ruledFrom.room ? ' chg' : ''), text: p.room })), h('span', { text: TYPE[p.type] || '' }),
        p.status === 'moved-here' ? h('span', { class: 'pill', text: 'перенос с ' + dayMonth(p.movedFrom) }) : null,
        p.status === 'extra' ? h('span', { class: 'pill', text: 'доп. пара' }) : null,
        p.changed.start || p.changed.teacher ? h('span', { class: 'pill', text: 'изменено' }) : null)),
    active ? st : null);
  if (p.status === 'moved-away') row.append(h('span', { class: 'stamp move', 'aria-hidden': 'true', text: 'Перенесено' }));
  if (p.status === 'cancelled') row.append(h('span', { class: 'stamp cancel', 'aria-hidden': 'true', text: 'Отменено' }));
  return row;
}

function renderEditor() {
  renderTop();
  const days = studyDates(S.monday, S.data).map((d) => buildDay(d, S.data));
  const sems = weekSeminars(); const done = sems.filter(isDone).length; const allDone = sems.length > 0 && done === sems.length;
  const out = [h('div', { class: 'userline' }, h('span', { class: 'small muted', text: S.name }),
    h('a', { class: 'btn btn-ghost', href: './', text: 'Как видит группа' }),
    h('button', { type: 'button', class: 'icon-btn', id: 'hints', 'aria-label': 'Подсказки', title: 'Подсказки', onclick: startCoach, text: '?' }),
    h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { endCoach(false); forgetCode(); S.code = null; S.name = null; renderLogin(); }, text: 'Выйти' }))];
  if (sems.length) {
    out.push(h('section', { class: 'fill' + (allDone ? ' done' : ''), 'aria-label': 'Заполнение ДЗ' },
      h('div', {}, h('h2', { text: allDone ? 'Все семинары заполнены' : `ДЗ: ${done} из ${sems.length} семинаров` }),
        h('div', { class: 'small', style: 'opacity:.85', text: allDone ? 'Осталось скопировать текст в Telegram.' : 'Пройдём по семинарам по очереди — около минуты.' })),
      allDone
        ? h('div', { class: 'fill-acts' },
          h('button', { type: 'button', class: 'btn', id: 'fill-telegram', onclick: (e) => openTelegram(e.currentTarget, 'days'), text: 'Telegram' }),
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: (e) => openWizard(e.currentTarget), text: 'Проверить' }))
        : h('button', { type: 'button', class: 'btn', onclick: (e) => openWizard(e.currentTarget), text: 'Заполнить' }),
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
      h('span', { class: 'day-acts' },
        h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Дополнительная пара: ' + longDay(d.date), onclick: (e) => openAddPair(d.date, e.currentTarget), text: '+ пара' }),
        h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Пометки дня: ' + longDay(d.date), onclick: (e) => openNotes(d.date, e.currentTarget), text: '+ пометка' }))));
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
    S.status === 'error' || S.status === 'offline' ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => retryNow(), text: 'Повторить' }) : null,
    h('button', { type: 'button', class: 'btn btn-primary', id: 'bar-telegram', onclick: (e) => openTelegram(e.currentTarget), text: 'Telegram' })));
}

function render({ sheet = true } = {}) {
  if (!S.name || !S.data) return;
  renderEditor(); renderBar();
  if (coachStep >= 0) markCoachTarget(false); // неделя перерисована — вернуть подсветку подсказки
  if (sheet && sheetBuild) renderSheet();
}

// ---------------- подсказки первого входа (шаг 8) ----------------
// Три шага поверх недели, не мешают работать: карточка внизу, нужное место подсвечено.
const HINTS_KEY = 'raspisanie-322:hints-v1';
const COACH = [
  { target: () => document.querySelector('.prow:not(.dim)'), title: 'Нажмите на пару',
    text: 'Откроется карточка: подпись к ДЗ и ссылки, а ниже — изменения в этот день (аудитория, время, перенос, отмена).' },
  { target: () => document.querySelector('.fill .btn'), title: 'Вставьте ссылку',
    text: '«Заполнить» проведёт по всем семинарам недели. В Telegram: сообщение → «Копировать ссылку», здесь — кнопка «Вставить ссылку». Тема проверится сама.' },
  { target: () => $('bar-telegram'), title: 'Скопируйте текст для Telegram',
    text: 'Когда неделя готова — кнопка «Telegram»: тексты по дням в привычном оформлении, по одному нажатию на день.' },
];
let coachStep = -1;
function hintsSeen() { try { return !local || local.getItem(HINTS_KEY) === '1'; } catch { return true; } }
function markCoachTarget(scroll) {
  document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
  const step = COACH[coachStep];
  const t = step && step.target();
  if (!t) return;
  t.classList.add('coach-target');
  if (scroll) t.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function startCoach() { coachStep = 0; showCoach(); }
function endCoach(remember = true) {
  coachStep = -1;
  if (remember) { try { if (local) local.setItem(HINTS_KEY, '1'); } catch { /* приватный режим */ } }
  document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
  const c = $('coach'); if (c) c.remove();
}
function showCoach() {
  const step = COACH[coachStep];
  if (!step) { endCoach(); return; }
  markCoachTarget(true);
  let c = $('coach');
  if (!c) { c = h('div', { class: 'coach', id: 'coach', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'coach-title' }); document.body.append(c); }
  const last = coachStep === COACH.length - 1;
  c.replaceChildren(
    h('div', { class: 'xs muted', text: `Подсказка ${coachStep + 1} из ${COACH.length}` }),
    h('b', { id: 'coach-title', text: step.title }),
    h('p', { class: 'small', style: 'margin:0', text: step.text }),
    h('div', { class: 'row', style: 'justify-content:flex-end' },
      last ? null : h('button', { type: 'button', class: 'btn btn-ghost', id: 'coach-skip', onclick: () => endCoach(), text: 'Пропустить' }),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'coach-next', onclick: () => { coachStep += 1; showCoach(); }, text: last ? 'Понятно' : 'Дальше' })));
  c.querySelector('#coach-next').focus({ preventScroll: true });
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
registerPWA({ beforeReload: () => flushText() }); // работа без сети; перед обновлением сайта — сохранить набранное
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { flushText(); return; }               // свернули приложение — сохранить набранное
  if (S.name && !S.queue.size()) reload();
});
window.addEventListener('pagehide', flushText);
