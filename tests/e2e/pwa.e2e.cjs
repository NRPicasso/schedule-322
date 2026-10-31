// Шаг 8: «как приложение» — работа без сети, значки и манифест, закрытие от поиска, подсказки, обновление сайта.
// Запуск: ROOT=<папка проекта> node tests/e2e/pwa.e2e.cjs
// Сайт копируется во временную папку и раздаётся своим сервером: в проверке обновления sw.js меняется на диске.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const PAYLOAD = JSON.stringify({ ...readJson('site/data/seed.json'), ...readJson('site/data/demo-entries.json') });
const API = /script\.google\.com\/macros/;

// простой статический сервер (как GitHub Pages: файлы как есть)
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
fs.cpSync(path.join(ROOT, 'site'), DIR, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
let down = false;
const server = http.createServer((req, res) => {
  if (down) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith('/repo/')) { res.writeHead(404); res.end(); return; }      // как GitHub Pages: сайт в подпапке
  p = p.slice('/repo'.length);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIR, p);
  if (!f.startsWith(DIR) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const SITE = `http://localhost:${server.address().port}/repo`;
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  let offline = false;
  await ctx.route(API, (route) => (offline ? route.abort('internetdisconnected')
    : route.request().method() === 'POST'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'Активист 1', results: (JSON.parse(route.request().postData()).ops || []).map((o) => ({ opId: o.opId, ok: true })) }) })
      : route.fulfill({ status: 200, contentType: 'application/json', body: PAYLOAD })));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const swReady = () => page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });

  await check('страница группы: манифест, значки, noindex; service worker включился и сохранил файлы', async () => {
    await page.goto(SITE + '/?now=2026-11-03T10:00'); await page.waitForSelector('.tl');
    assert.equal(await page.getAttribute('meta[name=robots]', 'content'), 'noindex, nofollow');
    const href = await page.getAttribute('link[rel=manifest]', 'href');
    const man = await (await page.request.get(SITE + '/' + href)).json();
    assert.equal(man.start_url, './'); assert.equal(man.display, 'standalone');
    for (const i of man.icons) assert.equal((await page.request.get(SITE + '/' + i.src)).status(), 200, i.src);
    assert.ok(man.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    assert.equal(await swReady(), true);
    const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return (await c.keys()).length; });
    assert.ok(cached >= 40, 'сохранено файлов: ' + cached);
  });

  await check('без сети страница группы открывается: последняя загруженная неделя и плашка «Нет связи»', async () => {
    down = true; offline = true; await ctx.setOffline(true);
    await page.reload(); await page.waitForSelector('.tl');
    assert.match(await page.textContent('body'), /Нет связи с сервером\. Показано сохранённое от/);
    assert.match(await page.textContent('.tl'), /Муниципальное право/);
    await page.goto(SITE + '/?now=2026-11-05T10:00'); await page.waitForSelector('.tl'); // другой адрес той же страницы
    assert.match(await page.textContent('.tl'), /ОСД|Организация судебной/);
    down = false; offline = false; await ctx.setOffline(false);
  });

  await check('редактор: noindex и свой манифест; подсказки первого входа — 3 шага с подсветкой, «Пропустить» запоминается, «?» показывает снова', async () => {
    await page.goto(SITE + '/admin.html');
    assert.equal(await page.getAttribute('meta[name=robots]', 'content'), 'noindex, nofollow');
    assert.equal(await page.getAttribute('link[rel=manifest]', 'href'), 'admin.webmanifest');
    await page.fill('#code', '123456'); await page.click('button[type=submit]');
    await page.waitForSelector('#coach');
    assert.match(await page.textContent('#coach'), /Подсказка 1 из 3[\s\S]*Нажмите на пару/);
    assert.equal(await page.locator('.prow.coach-target').count(), 1);
    await page.click('#coach-next');
    assert.match(await page.textContent('#coach'), /Вставьте ссылку/);
    assert.equal(await page.locator('.fill .btn.coach-target').count(), 1);
    await page.click('#coach-next');
    assert.match(await page.textContent('#coach'), /Telegram/);
    assert.equal(await page.locator('#bar-telegram.coach-target').count(), 1);
    await page.click('#coach-next');                                          // «Понятно»
    assert.equal(await page.locator('#coach').count(), 0);
    await page.reload(); await page.waitForSelector('.fill'); await page.waitForTimeout(800);
    assert.equal(await page.locator('#coach').count(), 0);                     // второй раз не показываются
    await page.click('#hints');
    assert.match(await page.textContent('#coach'), /Подсказка 1 из 3/);
    await page.click('#coach-skip');
    assert.equal(await page.locator('#coach').count(), 0);
    await page.click('#hints'); await page.keyboard.press('Escape');            // Escape тоже закрывает
    assert.equal(await page.locator('#coach').count(), 0);
  });

  await check('редактор без сети открывается с сохранённой неделей; правка ждёт сети и уходит', async () => {
    await swReady();
    down = true; offline = true; await ctx.setOffline(true);
    await page.reload(); await page.waitForSelector('.fill');
    await page.waitForSelector('.save.offline');
    await page.click('#day-2026-11-04 button:has-text("+ пометка")');
    await page.click('#sheet .chip:has-text("Контрольная")');
    assert.match(await page.textContent('.save'), /изменений на телефоне: 1/);
    await page.keyboard.press('Escape');
    let posted = null;
    await ctx.unroute(API);
    await ctx.route(API, (route) => {
      if (offline) return route.abort('internetdisconnected');
      if (route.request().method() === 'POST') { const b = JSON.parse(route.request().postData()); if (b.ops) posted = b.ops; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, name: 'Активист 1', results: (b.ops || []).map((o) => ({ opId: o.opId, ok: true })) }) }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: PAYLOAD });
    });
    down = false; offline = false; await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => /Сохранено/.test(document.querySelector('.save').textContent), null, { timeout: 25000 });
    assert.ok(posted && posted.some((o) => o.type === 'note.add' && o.text === 'Контрольная'));
  });

  await check('«Выйти» с неотправленными правками — предупреждение; «Выйти и удалить» очищает очередь', async () => {
    offline = true; await ctx.setOffline(true); down = true;
    await page.click('#day-2026-11-05 button:has-text("+ пометка")');
    await page.click('#sheet .chip:has-text("Принести кодекс")');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#logout');
    assert.match(await page.textContent('.dialog'), /ждут отправки изменений: 1/);
    await page.click('#lo-stay');
    assert.equal(await page.locator('.fill').count(), 1);                      // остались в редакторе
    await page.click('#logout'); await page.click('#lo-go');
    await page.waitForSelector('#code');
    assert.equal(await page.evaluate(() => localStorage.getItem('raspisanie-322:queue:v1')), '[]');
    offline = false; await ctx.setOffline(false); down = false;
    await page.fill('#code', '123456'); await page.click('button[type=submit]'); await page.waitForSelector('.fill');
  });

  const online = async () => { down = false; offline = false; await ctx.setOffline(false); }; // если проверка выше упала посередине
  await check('новая версия сайта: до «Обновить» работает старая целиком (без смешения), плашка внизу не закрывает «Отменить»; «Позже»; вторая вкладка', async () => {
    await online();
    if (!(await page.locator('.fill').count())) { await page.goto(SITE + '/admin.html'); await page.waitForSelector('.fill'); }
    // выкладываем версию, где страница редактора импортирует новый экспорт модуля, — смешение старого и нового сломало бы страницу
    fs.appendFileSync(path.join(DIR, 'src', 'time.js'), "\nexport const NEW_THING = 'новая версия';\n");
    const html = path.join(DIR, 'admin.html');
    fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<script type="module" src="src/admin.js"></script>',
      '<script type="module" src="src/admin.js"></script>\n  <script type="module">import { NEW_THING } from \'./src/time.js\'; document.documentElement.dataset.version = NEW_THING;</script>'));
    const sw = path.join(DIR, 'sw.js');
    fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/const VERSION = '(\w+)'/, "const VERSION = 'test-new-version'"));
    const page2 = await ctx.newPage(); await page2.goto(SITE + '/admin.html'); await page2.waitForSelector('.fill');
    await page.reload(); await page.waitForSelector('.fill');                    // сервер уже новый, но телефон — на старой версии целиком
    assert.equal(await page.evaluate(() => document.documentElement.dataset.version || null), null);
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
    await page.waitForSelector('#sw-update:not([hidden])', { timeout: 15000 });
    assert.match(await page.textContent('#sw-update'), /Сайт обновился/);
    // плашка «Отменить» (вверху) и плашка обновления (внизу, над панелью) не перекрываются
    await page.click('#day-2026-11-04 button:has-text("+ пометка")'); await page.click('#sheet .chip:has-text("Полная посещаемость")');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const [t, u] = await Promise.all(['#toast', '#sw-update'].map((sel) => page.locator(sel).boundingBox()));
    assert.ok(t && u && t.y + t.height <= u.y, `плашки перекрываются: ${JSON.stringify([t, u])}`);
    await page.click('#sw-update .later');
    assert.equal(await page.locator('#sw-update').isVisible(), false);
    await page2.waitForSelector('#sw-update:not([hidden])', { timeout: 15000 });
    await Promise.all([page2.waitForEvent('load'), page2.click('#sw-update .go')]);   // включили во второй вкладке
    await page2.waitForFunction(() => document.documentElement.dataset.version === 'новая версия');
    await page.waitForSelector('#sw-update:not([hidden])', { timeout: 15000 });      // первая вкладка узнала и предлагает перезагрузить
    assert.match(await page.textContent('#sw-update .go'), /Перезагрузить/);
    await Promise.all([page.waitForEvent('load'), page.click('#sw-update .go')]);
    await page.waitForFunction(() => document.documentElement.dataset.version === 'новая версия');
    assert.match(await page.evaluate(async () => (await caches.keys()).join()), /test-new-version/);
    await page2.close();
  });

  await check('подсказка «открывать как приложение» на iPhone — с 3-го посещения, закрывается навсегда', async () => {
    await online();
    const ios = await browser.newContext({ ...devices['iPhone 13'] });
    await ios.route(API, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: PAYLOAD }));
    const p = await ios.newPage();
    for (let i = 1; i <= 3; i++) { await p.goto(SITE + '/?now=2026-11-03T10:00'); await p.waitForSelector('.tl'); assert.equal(await p.locator('.install').count(), i < 3 ? 0 : 1, 'посещение ' + i); }
    assert.match(await p.textContent('.install'), /«Поделиться» → «На экран „Домой“»/);
    await p.click('.install .icon-btn');
    await p.reload(); await p.waitForSelector('.tl');
    assert.equal(await p.locator('.install').count(), 0);
    await ios.close();
  });

  await check('без ошибок в консоли', async () => assert.deepEqual(errors, []));
  await browser.close(); server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
