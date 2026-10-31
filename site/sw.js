// Работа без сети (service worker — фоновый скрипт браузера).
// Файл создаётся командой `node tools/build-sw.mjs` из tools/sw.template.js — руками не править.
//
// Как работает:
// • при первом открытии телефон сохраняет все файлы сайта (список PRECACHE);
// • страницы и код берутся из сети, а если сети нет или она не ответила за 4 секунды — из сохранённого;
//   так при обычной работе всегда свежая версия, а без сети сайт всё равно открывается;
// • шрифты и значки не меняются — берутся сразу из сохранённого;
// • запросы к Google (данные расписания) не трогаем: у них свой запас в браузере (api.js).
const VERSION = '300251b223c0';
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
  "src/dom.js",
  "src/editor-api.js",
  "src/format.js",
  "src/helpers.js",
  "src/pwa.js",
  "src/schedule.js",
  "src/store.js",
  "src/telegram.js",
  "src/time.js",
  "src/view.js"
];
const CACHE = 'raspisanie-322-' + VERSION;
const NET_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('raspisanie-322-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// страница просит включить новую версию сразу (кнопка «Обновить»)
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

const immutable = (url) => /\/(fonts|icons)\//.test(url.pathname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (immutable(url)) { e.respondWith(caches.match(req).then((hit) => hit || fetchAndStore(req))); return; }
  e.respondWith(networkFirst(req, e));
});

async function fetchAndStore(req) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}
async function fromCache(req) {
  const hit = await caches.match(req, { ignoreSearch: true }); // index.html?now=… — та же страница
  if (hit) return hit;
  if (req.mode === 'navigate') return caches.match(new URL(req.url).pathname.endsWith('admin.html') ? 'admin.html' : './');
  return undefined;
}
function networkFirst(req, e) {
  const net = fetchAndStore(req);
  e.waitUntil(net.catch(() => {}));                    // свежий ответ дописывается в запас даже после тайм-аута
  const late = new Promise((resolve) => setTimeout(() => resolve(null), NET_TIMEOUT));
  return Promise.race([net.catch(() => null), late]).then(async (res) => {
    if (res) return res;
    const hit = await fromCache(req);
    return hit || net;                                 // в запасе нет — ждём сеть до конца
  });
}
