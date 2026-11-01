// Общее состояние редактора: данные недели, вход, очередь правок, хранилище браузера, «сейчас».
// Модули редактора зависят друг от друга в одну сторону: state → ui → sync → экраны → admin.js.
// Где нижнему модулю нужно вызвать верхний (перерисовать неделю, открыть карточку пары),
// он зовёт функцию из hooks — её записывает admin.js при запуске.
import { mondayOf, addDays, weekday } from '../schedule.js';
import { moscowNow, parseNowOverride } from '../time.js';
import { createQueue } from '../store.js';

export const $ = (id) => document.getElementById(id);
export const TYPE = { lecture: 'лекция', seminar: 'семинар', other: 'занятие' };
const CODE_KEY = 'raspisanie-322:code';

// Хранилище браузера может быть недоступно (приватный режим) — тогда работаем в памяти.
function safeStorage(kind) { try { const s = window[kind]; s.getItem('x'); return s; } catch { return null; } }
export const local = safeStorage('localStorage');
const session = safeStorage('sessionStorage');
const memory = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; })();

export const S = {
  data: null, name: null, code: null, monday: null,
  status: 'idle', sending: false, fresh: false, refreshing: false, openLectures: {},
  queue: createQueue(local || memory),
};

/** Функции верхних модулей: неделя (render, renderBar), карточка пары, окно конфликта, что делать с новыми данными, вход. */
export const hooks = { render: () => {}, renderBar: () => {}, pairSheet: null, conflict: null, onData: () => {}, afterData: () => {}, start: () => {} };

// ---------------- код входа в браузере ----------------
export function savedCode() {
  try { return (local && local.getItem(CODE_KEY)) || (session && session.getItem(CODE_KEY)) || null; } catch { return null; }
}
export function rememberCode(code, remember) {
  try { const s = remember ? local : session; if (s) s.setItem(CODE_KEY, code); } catch { /* приватный режим */ }
}
export function forgetCode() {
  try { if (local) local.removeItem(CODE_KEY); if (session) session.removeItem(CODE_KEY); } catch { /* ок */ }
}

// ---------------- «сейчас» и неделя по умолчанию ----------------
// «?now=2026-11-03T10:00» в адресе подменяет текущее время — как на странице группы (для проверок и показа)
const NOW_OVERRIDE = parseNowOverride(location.search);
export const nowMsk = () => NOW_OVERRIDE || moscowNow();
export function defaultMonday() {
  const now = nowMsk(); const wd = weekday(now.date);
  // с пятницы 12:00 до воскресенья готовим следующую неделю, в остальное время — текущая
  if (wd === 0 || wd === 6 || (wd === 5 && now.minutes >= 12 * 60)) return addDays(mondayOf(now.date), 7);
  return mondayOf(now.date);
}
