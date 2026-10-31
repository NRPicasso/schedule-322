// «Как приложение»: работа без сети (service worker), предложение обновиться и подсказка про главный экран.
const VISITS_KEY = 'raspisanie-322:visits';
const DISMISS_KEY = 'raspisanie-322:install-dismissed';
const store = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch { return null; } })();
const get = (k) => { try { return store ? store.getItem(k) : null; } catch { return null; } };
const set = (k, v) => { try { if (store) store.setItem(k, v); } catch { /* приватный режим */ } };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

/**
 * Подключить работу без сети. Когда на сайте вышла новая версия, внизу появляется
 * «Сайт обновился · Обновить · Позже» — перезагрузка только по нажатию (beforeReload — сохранить набранное).
 */
export function registerPWA({ beforeReload } = {}) {
  if (!('serviceWorker' in navigator)) return;
  let accepted = false;
  let reg = null;
  const hadController = !!navigator.serviceWorker.controller; // нет — это самая первая установка, не обновление
  const notice = (text, label, action) => {
    let bar = document.getElementById('sw-update');
    if (!bar) { bar = el('div', { class: 'sw-update', id: 'sw-update', role: 'status' }); document.body.append(bar); }
    bar.hidden = false;
    bar.replaceChildren(el('span', { text }),
      el('button', { type: 'button', class: 'go', text: label, onclick: action }),
      el('button', { type: 'button', class: 'later', text: 'Позже', onclick: () => { bar.hidden = true; } }));
  };
  const apply = () => {
    if (beforeReload) beforeReload();
    // берём ту версию, что ждёт СЕЙЧАС: пока плашка висела, могла выйти ещё одна или её включила другая вкладка
    const w = reg && reg.waiting;
    if (!w) { location.reload(); return; }
    accepted = true;
    w.postMessage('skip-waiting');
  };
  const offer = () => notice('Сайт обновился', 'Обновить', apply);
  navigator.serviceWorker.register('sw.js').then((r) => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) offer();
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(); });
    });
  }).catch(() => { /* без service worker сайт работает как обычно, просто не офлайн */ });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (accepted) { accepted = false; location.reload(); return; }
    // новую версию включили в другой вкладке: здесь ещё старая страница — предлагаем перезагрузить
    if (hadController) notice('Сайт обновился', 'Перезагрузить', () => { if (beforeReload) beforeReload(); location.reload(); });
  });
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Подсказка «добавить на главный экран» — с третьего посещения, пока не закроют.
 * Android/компьютер: кнопка «Установить» (если браузер разрешил); iPhone: как сделать через «Поделиться».
 */
export function installHint(container) {
  if (!container || standalone() || get(DISMISS_KEY)) return;
  const visits = Number(get(VISITS_KEY) || 0) + 1;
  set(VISITS_KEY, String(visits));
  if (visits < 3) return; // первые два раза не вмешиваемся: браузер может показать своё предложение установки
  const show = (body) => {
    const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Закрыть подсказку', text: '✕', onclick: () => { set(DISMISS_KEY, '1'); container.replaceChildren(); } });
    container.replaceChildren(el('div', { class: 'install' }, el('div', { class: 'install-body' }, el('b', { text: 'Открывать как приложение' }), body), close));
  };
  if (isIOS()) {
    show(el('span', { class: 'small muted', text: 'В Safari: «Поделиться» → «На экран „Домой“». Расписание будет открываться одним нажатием и без интернета.' }));
    return;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    show(el('span', {}, el('span', { class: 'small muted', text: 'Иконка на главном экране, открывается без интернета. ' }),
      el('button', { type: 'button', class: 'btn btn-secondary', id: 'install-btn', text: 'Установить', onclick: async () => {
        e.prompt();
        const choice = await e.userChoice.catch(() => null);
        if (choice && choice.outcome === 'accepted') container.replaceChildren();
      } })));
  });
}
