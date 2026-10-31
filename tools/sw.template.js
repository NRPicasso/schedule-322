// Работа без сети (service worker — фоновый скрипт браузера).
// Файл создаётся командой `node tools/build-sw.mjs` из tools/sw.template.js — руками не править.
//
// Как работает:
// • при первом открытии телефон сохраняет все файлы сайта (список PRECACHE);
// • страницы и код берутся из сети, а если сети нет или она не ответила за 4 секунды — из сохранённого;
//   так при обычной работе всегда свежая версия, а без сети сайт всё равно открывается;
// • шрифты и значки не меняются — берутся сразу из сохранённого;
// • запросы к Google (данные расписания) не трогаем: у них свой запас в браузере (api.js).
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
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
