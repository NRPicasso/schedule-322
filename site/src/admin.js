// Редактор для активистов: вход по коду, неделя, мастер «Заполнить», карточка пары, пометки дня.
// Сам редактор — в папке editor/ (по файлу на экран); здесь только запуск и связи между модулями.
import { h } from './dom.js';
import { API_URL } from './config.js';
import { registerPWA } from './pwa.js';
import { $, S, savedCode, forgetCode, defaultMonday, hooks } from './editor/state.js';
import { flushText, SH } from './editor/ui.js';
import { reload, setStatus } from './editor/sync.js';
import { tryLogin, renderLogin } from './editor/login.js';
import { render, renderBar } from './editor/week.js';
import { pairSheet } from './editor/pair.js';
import { showConflict } from './editor/conflict.js';
import { telegramSheet } from './editor/telegram-sheet.js';
import { hintsSeen, startCoach } from './editor/coach.js';

// ---------------- связи: нижние модули вызывают верхние через hooks ----------------
hooks.render = render;
hooks.renderBar = renderBar;
hooks.pairSheet = pairSheet;
hooks.conflict = showConflict;
hooks.start = start;
// открытый лист Telegram перерисовываем: в нём нет полей ввода, а тексты должны быть свежими
hooks.onData = () => render({ sheet: SH.build === telegramSheet });
hooks.afterData = () => { if (!S.coachChecked) { S.coachChecked = true; if (!hintsSeen()) startCoach(); } };

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
