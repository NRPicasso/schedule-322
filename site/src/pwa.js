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
 * Подключить работу без сети. Когда на сайте вышла новая версия, сверху появляется
 * «Сайт обновился · Обновить» — перезагрузка только по нажатию (beforeReload — сохранить набранное).
 */
export function registerPWA({ beforeReload } = {}) {
  if (!('serviceWorker' in navigator)) return;
  let accepted = false;
  const offer = (worker) => {
    if (document.getElementById('sw-update')) return;
    const bar = el('div', { class: 'toast', id: 'sw-update', role: 'status' }, el('span', { text: 'Сайт обновился' }),
      el('button', { type: 'button', text: 'Обновить', onclick: () => { accepted = true; if (beforeReload) beforeReload(); worker.postMessage('skip-waiting'); } }));
    document.body.append(bar);
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => { /* без service worker сайт работает как обычно, просто не офлайн */ });
  // перезагружаемся только после «Обновить» (при самой первой установке страница не мигает)
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (accepted) { accepted = false; location.reload(); } });
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
  const show = (body) => {
    if (visits < 3) return;
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
