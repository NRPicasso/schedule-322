// Сохранение: правка сразу на экран и в очередь, отправка пачками, повторы, ответы сервера.
// Правки применяются на экране сразу и уходят на сервер из очереди (store.js) — без сети не теряются.
import { h } from '../dom.js';
import { loadSchedule } from '../api.js';
import { postRequest, newOpId } from '../editor-api.js';
import { applyOp, inverseOf, applyResult } from '../store.js';
import { API_URL } from '../config.js';
import { $, S, local, forgetCode, hooks } from './state.js';
import { toast, queueDialog, closeDialog } from './ui.js';
import { renderLogin } from './login.js';

// ---------------- данные ----------------
function withQueue(fresh) {
  // свежие данные с сервера + правки, которые ещё не дошли, — чтобы они не «исчезли» с экрана
  for (const op of S.queue.list()) applyOp(fresh, op, {});
  return fresh;
}
export function reload() {
  return loadSchedule({
    apiUrl: API_URL, storage: local || null,
    onData: (data, info) => {
      S.data = withQueue(JSON.parse(JSON.stringify(data)));
      S.fresh = info.source === 'network'; // сохранённая в телефоне копия может быть старой — версии в ней устарели
      // открытый лист Telegram перерисовываем: в нём нет полей ввода, а тексты должны быть свежими
      hooks.onData(); flush();
      hooks.afterData(); // подсказки — при самом первом входе
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
export function setStatus(s) { S.status = s; hooks.renderBar(); }
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
export function commit(opOrOps, label, { undoable = true, rerenderSheet = true, afterUndo = null } = {}) {
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
  hooks.render({ sheet: rerenderSheet });
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
export function retryNow() { retryDelay = 0; clearTimeout(retryTimer); retryTimer = null; flush(); }

export async function flush() {
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
        else queueDialog(() => hooks.conflict(merged, r.current || null));
      } else { S.queue.remove(op.opId); queueDialog(() => showRejected(op, r.message)); }
    }
    ok = true; retryDelay = 0;
    setStatus(S.queue.size() ? 'saving' : 'saved');
    hooks.render({ sheet: false });
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
export function showRejected(op, message) {
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

/** Операция правки пары: для пары шаблона — запись дня, для переноса и доп. пары — она сама. */
export function pairOp(p, patch) {
  return p.kind === 'extra'
    ? { type: 'extra.update', date: p.date, id: p.id, patch }
    : { type: 'entry', date: p.date, pairId: p.id, patch };
}

/**
 * Отправить сразу, мимо очереди (шаблон, версии и предметы — только с сетью, чтобы два телефона
 * не разошлись в версиях шаблона). Возвращает результаты операций; без сети — бросает ошибку.
 */
export async function sendNow(ops) {
  const full = ops.map((o) => ({ ...o, opId: newOpId() }));
  const res = await postRequest(API_URL, { code: S.code, ops: full });
  if (!res.ok) {
    const e = new Error(res.message || 'не сохранилось'); e.kind = res.error; e.message = res.message || '';
    if (res.error === 'bad-code') { forgetCode(); S.code = null; S.name = null; renderLogin('Ваш код больше не действует. Напишите Еремею.'); }
    throw e;
  }
  return full.map((o) => res.results.find((r) => r.opId === o.opId) || { ok: false, message: 'нет ответа сервера' });
}
