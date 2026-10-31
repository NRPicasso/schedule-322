// Проверка редактора активистов в браузере с имитацией сервера.
// Сервер имитируется тем же кодом, что работает в Apps Script (processOps_ из apps-script/code.src.js).
// Запуск: SITE=http://localhost:8766 ROOT=<папка проекта> node tests/e2e/admin.e2e.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SITE = process.env.SITE || 'http://localhost:8766';
const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const API = /script\.google\.com\/macros\/s\/.+\/exec/;

function makeServer() {
  const ctx = vm.createContext({ Utilities: { formatDate: (d) => d.toISOString() } });
  vm.runInContext(read('apps-script/code.src.js') + '\nthis.api = { processOps_ };', ctx);
  const seed = JSON.parse(read('site/data/seed.json'));
  const hist = JSON.parse(read('site/data/demo-entries.json'));
  const state = { entries: JSON.parse(JSON.stringify(hist.entries)), dayNotes: JSON.parse(JSON.stringify(hist.dayNotes)) };
  const pairIds = Object.fromEntries(seed.template.map((t) => [t.id, true]));
  const codes = { '123456': 'Активист 1', '654321': 'Активист 2' };
  const seen = new Map(); const logs = [];
  const srv = { state, logs, offline: false, dropResponse: 0, posts: 0,
    payload: () => ({ ...seed, rules: hist.rules, extras: [], entries: state.entries, dayNotes: state.dayNotes }),
    post(req) {
      srv.posts++;
      const name = codes[req.code];
      if (!name) return { ok: false, error: 'bad-code', message: 'Код не подошёл. Проверьте цифры.' };
      if (req.action === 'login') return { ok: true, name };
      const out = ctx.api.processOps_(state, req.ops, pairIds, { name, now: new Date().toISOString() }, (o) => seen.get(o.opId) || null);
      out.results.forEach((r) => { if (r.ok) seen.set(r.opId, r); });
      logs.push(...out.logs);
      return JSON.parse(JSON.stringify({ ok: true, name, results: out.results }));
    },
    entry: (date, pairId) => state.entries.find((e) => e.date === date && e.pairId === pairId),
  };
  return srv;
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
  const srv = makeServer();
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(API, async (route) => {
    if (srv.offline) return route.abort('internetdisconnected');
    const req = route.request();
    const body = req.method() === 'POST' ? srv.post(JSON.parse(req.postData())) : srv.payload();
    if (req.method() === 'POST' && srv.dropResponse > 0) { srv.dropResponse--; return route.abort('connectionreset'); } // сервер применил, ответ потерялся
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  const saved = () => page.waitForSelector('.save.saved', { timeout: 8000 });
  await page.goto(SITE + '/admin.html');

  await check('неверный код — понятная ошибка, верный — открывается неделя 2–7 ноября', async () => {
    await page.fill('#code', '111111'); await page.click('button[type=submit]');
    await page.waitForSelector('#code-err:not(:empty)');
    assert.match(await page.textContent('#code-err'), /Код не подошёл/);
    await page.fill('#code', '123456'); await page.click('button[type=submit]');
    await page.waitForSelector('.fill');
    assert.match(await page.textContent('.top h1'), /2 ноября — 7 ноября/);
    assert.match(await page.textContent('.fill'), /ДЗ: 0 из 4 семинаров/);
  });

  await check('мастер: ДЗ, «ДЗ нет», ссылка — всё дошло до сервера и в журнал', async () => {
    await page.click('.fill button');
    await page.waitForSelector('.wz-foot');
    assert.match(await page.textContent('#sheet'), /Муниципальное право/);
    await page.fill('#hw', 'Подготовиться к дебатам');
    await page.waitForTimeout(1200); await saved();
    await page.click('.wz-foot .btn-primary');                        // → ОСД
    await page.click('.wz-foot button:has-text("ДЗ нет")');           // → ТП
    await page.fill('#link', 'https://t.me/c/4323463486/34/4000'); await page.press('#link', 'Enter');
    await saved();
    await page.click('.wz-foot .btn-primary');                        // → УПП
    await page.click('.wz-foot .btn-primary');                        // → готово
    await page.waitForSelector('.big-check');
    assert.match(await page.textContent('#sheet'), /С ДЗ: 2 · «ДЗ нет»: 1 · пропущено: 1/);
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').hw, 'Подготовиться к дебатам');
    assert.equal(srv.entry('2026-11-05', 'THU-1320').noHw, true);
    assert.deepEqual(srv.entry('2026-11-05', 'THU-1650-bot').links, ['https://t.me/c/4323463486/34/4000']);
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').by, 'Активист 1');
    assert.ok(srv.logs.length >= 3);
    await page.click('#sheet button:has-text("Вернуться к неделе")');
    assert.match(await page.textContent('.fill'), /ДЗ: 3 из 4 семинаров/);
  });

  await check('неверная ссылка не уходит на сервер', async () => {
    await page.click('.prow:has-text("Уголовный процесс")');
    const before = srv.posts;
    await page.fill('#link', 'javascript:alert(1)'); await page.press('#link', 'Enter');
    assert.match(await page.textContent('#link-err'), /нет ссылки/);
    assert.equal(srv.posts, before);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('пометка дня и «Отменить» в течение 10 секунд', async () => {
    await page.click('#day-2026-11-04 button:has-text("+ пометка")');
    await page.click('#sheet .chip:has-text("Контрольная")'); await saved();
    assert.ok(srv.state.dayNotes.some((n) => n.date === '2026-11-04' && n.text === 'Контрольная'));
    await page.click('#toast button:has-text("Отменить")'); await page.waitForTimeout(500); await saved();
    assert.ok(!srv.state.dayNotes.some((n) => n.date === '2026-11-04' && n.text === 'Контрольная'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('без сети правка копится, переживает перезагрузку и уходит один раз', async () => {
    srv.offline = true;
    await page.click('.prow:has-text("Уголовный процесс")');
    await page.fill('#hw', 'Глава 5 УПК'); await page.waitForTimeout(1300);
    await page.waitForSelector('.save.offline');
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForSelector('.fill');          // вход по запомненному коду невозможен без сети → режим без связи
    assert.match(await page.textContent('.prow:has-text("Уголовный процесс")'), /ДЗ ✓/);
    assert.equal(srv.entry('2026-11-06', 'FRI-1830'), undefined);
    srv.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelector('.save') && /Сохранено/.test(document.querySelector('.save').textContent), null, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(500);
    assert.equal(srv.entry('2026-11-06', 'FRI-1830').hw, 'Глава 5 УПК');
    assert.equal(srv.logs.filter((l) => l.key === '2026-11-06 FRI-1830').length, 1);
  });

  await check('ответ сервера потерялся, а активист продолжил печатать — сохраняется последнее, без «конфликта с собой»', async () => {
    await page.click('.prow:has-text("Организация судебной")');
    srv.dropResponse = 1;
    await page.fill('#hw', 'Доклады'); await page.waitForTimeout(1300);
    await page.waitForSelector('.save.offline');
    await page.fill('#hw', 'Доклады тема 5'); await page.waitForTimeout(1300);
    const retry = page.locator('#bar button:has-text("Повторить")');
    if (await retry.count()) await retry.click();                     // или дождёмся автоматического повтора
    await page.waitForFunction(() => /Сохранено/.test(document.querySelector('.save').textContent), null, { timeout: 15000 });
    assert.equal(await page.locator('.dialog').count(), 0);
    assert.equal(srv.entry('2026-11-05', 'THU-1320').hw, 'Доклады тема 5');
    assert.equal(await page.inputValue('#hw'), 'Доклады тема 5');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('конфликт: другой активист успел раньше — выбор варианта, ничего не затёрто молча', async () => {
    await page.reload(); await page.waitForSelector('.fill');
    // Активист 2 меняет муниципальное, пока у Активиста 1 открыта старая версия
    srv.post({ code: '654321', ops: [{ opId: 'op-other-0001', type: 'entry', date: '2026-11-03', pairId: 'TUE-1140-bot', baseVersion: 1, patch: { hw: 'Анализ Устава, часть 2' } }] });
    await page.click('.prow:has-text("Муниципальное право")');
    await page.fill('#hw', 'Дебаты: аргументы сторон'); await page.waitForTimeout(1300);
    await page.waitForSelector('.dialog');
    assert.match(await page.textContent('.dialog'), /Активист 2 уже изменил/);
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').hw, 'Анализ Устава, часть 2');
    await page.click('.dialog button:has-text("Оставить мой")'); await saved();
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').hw, 'Дебаты: аргументы сторон');
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').version, 3);
    await page.keyboard.press('Escape');
  });

  await check('шаг 5: ДЗ «фраза + ссылка» за 4 нажатия, «как в прошлый раз» — 1 нажатие в мастере', async () => {
    await page.reload(); await page.waitForSelector('.fill');
    await page.click('button[aria-label="Следующая неделя"]');               // 9–14 ноября, верхняя
    await page.waitForFunction(() => /9 ноября/.test(document.querySelector('.top h1').textContent));
    let clicks = 0; const click = async (sel) => { clicks++; await page.click(sel); };
    await page.evaluate(() => navigator.clipboard.writeText('https://t.me/c/4323463486/39/5001'));
    await click('.fill button');                                              // 1 «Заполнить» → муниципальное
    await page.waitForSelector('.wz-foot');
    await click('#sheet .chip >> nth=0');                                     // 2 частая фраза
    await click('#paste-link');                                               // 3 «Вставить ссылку»
    await page.waitForTimeout(300);
    const munPhrase = await page.inputValue('#hw');
    await click('.wz-foot .btn-primary');                                     // 4 «Дальше»
    assert.equal(clicks, 4);
    await page.waitForSelector('.save.saved', { timeout: 8000 });
    const mun = srv.entry('2026-11-10', 'TUE-1140-top');
    assert.equal(mun.hw, munPhrase);
    assert.deepEqual(mun.links, ['https://t.me/c/4323463486/39/5001']);
    // второй семинар — ГПП 15:00: прошлое занятие 27.10 «Задачи и доклады»
    assert.match(await page.textContent('#sheet .prev'), /Задачи и доклады/);
    await page.click('#as-before');                                           // 1 нажатие
    await page.waitForSelector('.save.saved', { timeout: 8000 });
    assert.equal(srv.entry('2026-11-10', 'TUE-1500-top').hw, 'Задачи и доклады');
    assert.deepEqual(srv.entry('2026-11-10', 'TUE-1500-top').links, ['https://t.me/c/4323463486/26/3137']);
  });

  await check('шаг 5: вставка куска сообщения делится на подпись и ссылки; чужая тема — предупреждение', async () => {
    await page.click('.wz-foot .btn-primary');                                // → ГПП 16:50
    await page.evaluate(() => navigator.clipboard.writeText('Задачи 1–5 из сборника\nhttps://t.me/c/4323463486/40/777, https://youtu.be/abc'));
    await page.focus('#link'); await page.keyboard.press('ControlOrMeta+V');
    await page.waitForSelector('.save.saved', { timeout: 8000 });
    const e = srv.entry('2026-11-10', 'TUE-1650-top');
    assert.equal(e.hw, 'Задачи 1–5 из сборника');
    assert.deepEqual(e.links, ['https://t.me/c/4323463486/40/777', 'https://youtu.be/abc']);
    assert.match(await page.textContent('#sheet'), /Ссылка из темы «ОСД», а пара — Гражданский процесс/);
    assert.match(await page.textContent('#sheet .links'), /YouTube/);
    await page.click('#sheet button:has-text("Да, оставить")');
    assert.doesNotMatch(await page.textContent('#sheet'), /Всё верно\?/);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('360 px без горизонтальной прокрутки; группа видит новое ДЗ', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await page.goto(SITE + '/?now=2026-11-03T09:00'); await page.waitForSelector('.tl');
    assert.match(await page.textContent('.tl'), /Дебаты: аргументы сторон/);
  });
  await check('без ошибок в консоли', async () => assert.deepEqual(errors, []));
  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
