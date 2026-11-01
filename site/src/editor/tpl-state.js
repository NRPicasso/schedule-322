// Общее состояние листа «Шаблон и семестр»: какой экран открыт, черновик версии на телефоне.
// Отдельный модуль, чтобы экраны шаблона (template.js, version-edit.js, subjects.js) не импортировали друг друга по кругу.
import { local } from './state.js';
import { renderSheet, toast } from './ui.js';
import { reload, sendNow } from './sync.js';

const DRAFT_KEY = 'raspisanie-322:tpl-draft';

/** Экран листа и черновик версии. */
export const T = { view: 'list', draft: null, readonly: null, day: 1, pair: null, pairNew: false, pairTried: false, err: '', newFrom: '', basedOn: null, del: null, choice: {}, subject: null, back: null, busy: false, previewMonday: null };

export function saveDraft() { try { if (local && T.draft) local.setItem(DRAFT_KEY, JSON.stringify(T.draft)); } catch { /* приватный режим */ } }
export function storedDraft() { try { return JSON.parse((local && local.getItem(DRAFT_KEY)) || 'null'); } catch { return null; } }
export function dropDraft() { try { if (local) local.removeItem(DRAFT_KEY); } catch { /* ок */ } T.draft = null; }

/** Перейти на экран листа и перерисовать; фокус — на заголовок нового экрана. */
export function go(view, patch = {}) {
  Object.assign(T, patch, { view, err: patch.err || '' });
  renderSheet();
  const sh = document.getElementById('sheet'); sh.scrollTop = 0;
  const title = document.getElementById('sheet-title');
  if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
}

export const online = () => navigator.onLine !== false;
/** «1 пара», «3 пары», «23 пары», «12 пар». */
export const pairsWord = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'пара' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'пары' : 'пар'}`;
export const TYPE_WORD = { lecture: 'лекция', seminar: 'семинар', other: 'занятие' };

/** Текст ошибки отправки шаблона: блокировка, код, нет сети. */
export const failText = (e) => (e && e.kind === 'locked' ? e.message : e && e.kind === 'bad-code' ? 'Код больше не действует — войдите заново.' : 'Не сохранилось: нет связи. Черновик остался на телефоне — сохраните, когда появится интернет.');

/** «Отменить» для шаблона и предметов — тоже только с сетью. */
export async function sendUndo(ops, doneText) {
  try {
    const res = await sendNow(ops);
    const bad = res.find((r) => !r.ok);
    toast(bad ? 'Отменилось не всё: ' + (bad.message || 'другой активист успел изменить') : doneText);
  } catch (e) { toast('Не отменилось: ' + failText(e).replace(/^Не сохранилось: /, '').replace(/ Черновик.*$/, '')); }
  reload();
  if (!document.getElementById('sheet').hidden) renderSheet();
}

