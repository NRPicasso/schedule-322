// Работа без сети (service worker — фоновый скрипт браузера).
// Файл создаётся командой `node tools/build-sw.mjs` из tools/sw.template.js — руками не править.
//
// Как работает (классическая схема «версия целиком»):
// • при установке телефон скачивает ВСЕ файлы сайта этой версии (список PRECACHE) — мимо HTTP-кэша,
//   чтобы не взять устаревшую копию; если хоть один файл не скачался, установка повторится позже;
// • дальше страницы и код всегда берутся из сохранённой версии — HTML и модули друг другу
//   соответствуют, при плохой сети не бывает «новая страница + старый модуль»;
// • новая версия на сайте (другой VERSION) скачивается в фоне и ждёт; страница показывает
//   «Сайт обновился · Обновить», и только по нажатию включается целиком;
// • запросы к Google (данные расписания) не трогаем: данные всегда свежие, у них свой запас (api.js).
const VERSION = '864fc8afae2c';
const PRECACHE = [
  "./",
  "admin.html",
  "admin.webmanifest",
  "css/style.css",
  "css/tokens.css",
  "fonts/fonts.css",
  "fonts/jetbrains-mono-cyrillic-500-normal.woff2",
  "fonts/jetbrains-mono-cyrillic-700-normal.woff2",
  "fonts/jetbrains-mono-latin-500-normal.woff2",
  "fonts/jetbrains-mono-latin-700-normal.woff2",
  "fonts/onest-cyrillic-400-normal.woff2",
  "fonts/onest-cyrillic-500-normal.woff2",
  "fonts/onest-cyrillic-600-normal.woff2",
  "fonts/onest-cyrillic-700-normal.woff2",
  "fonts/onest-latin-400-normal.woff2",
  "fonts/onest-latin-500-normal.woff2",
  "fonts/onest-latin-600-normal.woff2",
  "fonts/onest-latin-700-normal.woff2",
  "fonts/unbounded-cyrillic-500-normal.woff2",
  "fonts/unbounded-cyrillic-700-normal.woff2",
  "fonts/unbounded-latin-500-normal.woff2",
  "fonts/unbounded-latin-700-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-192.png",
  "icons/maskable-512.png",
  "index.html",
  "manifest.webmanifest",
  "src/admin.js",
  "src/api.js",
  "src/config.js",
  "src/dates.js",
  "src/dom.js",
  "src/editor-api.js",
  "src/editor/coach.js",
  "src/editor/conflict.js",
  "src/editor/hw.js",
  "src/editor/login.js",
  "src/editor/move.js",
  "src/editor/notes.js",
  "src/editor/pair.js",
  "src/editor/panels.js",
  "src/editor/rules.js",
  "src/editor/state.js",
  "src/editor/sync.js",
  "src/editor/telegram-sheet.js",
  "src/editor/ui.js",
  "src/editor/week.js",
  "src/editor/wizard.js",
  "src/format.js",
  "src/helpers.js",
  "src/pwa.js",
  "src/schedule.js",
  "src/store.js",
  "src/telegram.js",
  "src/time.js",
  "src/versions.js",
  "src/view.js"
];
const CACHE = 'raspisanie-322-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('raspisanie-322-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// страница просит включить новую версию (кнопка «Обновить»)
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fromVersion(req));
});

async function fromVersion(req) {
  const cache = await caches.open(CACHE);
  // index.html?now=…, ?utm=… — та же страница; параметры не плодят записей
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const page = await cache.match(new URL(req.url).pathname.endsWith('admin.html') ? 'admin.html' : './');
    if (page) return page;
  }
  return fetch(req); // файла нет в версии (например, data/ при работе на своём компьютере) — просто из сети
}
