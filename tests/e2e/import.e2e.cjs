// «Вставить из Telegram» (v0.2) в браузере с имитацией сервера.
// Запуск: SITE=http://localhost:8766 ROOT=<папка проекта> node tests/e2e/import.e2e.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeServer } = require('./mock-server.cjs');

const SITE = process.env.SITE || 'http://localhost:8766';
const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const API = /script\.google\.com\/macros\/s\/.+\/exec/;
const { days } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/telegram-43-48.json'), 'utf8'));
const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/demo-entries.json'), 'utf8'));
const WEEK = (d) => d >= '2026-10-26' && d <= '2026-10-31';

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
  const srv = makeServer();
  // неделя 26–31.10 на сайте пустая: её ДЗ и пометки будем вставлять из сообщений 43–48
  srv.state.entries = srv.state.entries.filter((e) => !WEEK(e.date));
  srv.state.dayNotes = srv.state.dayNotes.filter((n) => !WEEK(n.date));
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(API, async (route) => {
    if (srv.offline) return route.abort('internetdisconnected');
    const req = route.request();
    const body = req.method() === 'POST' ? srv.post(JSON.parse(req.postData())) : srv.payload();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  const waitFor = async (fn, timeout = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > timeout) throw new Error('не дождались: ' + fn); await page.waitForTimeout(100); } };
  const noScroll = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'горизонтальная прокрутка');
  let taps = 0;
  const tap = async (sel) => { taps++; await page.click(sel); };

  await page.goto(SITE + '/admin.html?now=2026-11-02T10:00');
  await page.fill('#code', '123456'); await page.click('button[type=submit]');
  await page.waitForSelector('.fill');
  if (await page.locator('#coach-skip').count()) await page.click('#coach-skip');

  await check('пустое поле — «Разобрать» недоступна с причиной; текст без дней — понятный отказ', async () => {
    await page.click('#fill-import'); await page.waitForSelector('#im-text');
    assert.equal(await page.isDisabled('#im-parse'), true);
    assert.equal(await page.isVisible('#im-why'), true);
    await page.fill('#im-text', 'Привет! Завтра пар нет.');
    await page.click('#im-parse');
    assert.match(await page.textContent('#im-err'), /Не нашёл ни одного дня/);
  });

  await check('6 сообщений одной вставкой (с заголовками копирования): предпросмотр, «Записать» — 2 нажатия после вставки; на сервере — как в истории', async () => {
    const text = Object.entries(days).map(([d, t], i) => `Активист ${i % 2 + 1}, [${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)} 18:0${i}]\n${t}`).join('\n\n');
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await page.fill('#im-text', '');
    await page.click('#im-paste');                                   // вставка из буфера
    taps = 0;
    await tap('#im-parse'); await page.waitForSelector('#im-summary');
    assert.equal(await page.textContent('#im-summary'), 'Будет записано: ДЗ — 4, ссылок — 8, пометок — 1');
    const t = await page.textContent('#sheet');
    assert.match(t, /Вторник, 27 октября[^]*Анализ Устава МО/);
    assert.match(t, /Пометка дня: Сдаём КСУ🤩/);
    assert.doesNotMatch(t, /Активист/);
    assert.equal(await page.locator('#im-unassigned').count(), 0);
    await noScroll();
    await tap('#im-write');
    assert.ok(taps <= 3, 'нажатий после вставки: ' + taps);
    await page.waitForSelector('#toast:not([hidden])');
    assert.match(await page.textContent('#toast'), /Записано: ДЗ — 4, ссылок — 8, пометок — 1/);
    assert.match(await page.textContent('.top h1'), /26 октября/);   // открылась неделя, куда записали
    await waitFor(() => srv.state.entries.filter((e) => WEEK(e.date)).length === 6 && !srv.offline && srv.state.dayNotes.some((n) => WEEK(n.date)));
    const got = srv.state.entries.filter((e) => WEEK(e.date)).map((e) => `${e.date} ${e.pairId} ${e.hw || ''} ${(e.links || []).join(' ')}`).sort();
    const want = hist.entries.filter((e) => WEEK(e.date)).map((e) => `${e.date} ${e.pairId} ${e.hw || ''} ${(e.links || []).join(' ')}`).sort();
    assert.deepEqual(got, want);
    assert.deepEqual(srv.state.dayNotes.filter((n) => WEEK(n.date)).map((n) => n.text), ['Сдаём КСУ🤩']);
  });

  await check('«Отменить» откатывает весь импорт', async () => {
    await page.click('#toast button');
    await waitFor(() => srv.state.entries.filter((e) => WEEK(e.date) && (e.hw || (e.links || []).length)).length === 0 && !srv.state.dayNotes.some((n) => WEEK(n.date)));
  });

  await check('уже вписанное другое ДЗ: по умолчанию «оставить», «объединить» — записывает оба; отмены — в «не удалось отнести»', async () => {
    srv.state.entries.push({ date: '2026-11-03', pairId: 'TUE-1140-bot', hw: 'Старое', links: [], version: 1 });
    await page.reload(); await page.waitForSelector('.fill');
    await page.click('#fill-import');
    await page.fill('#im-text', 'ВТОРНИК\n❗ УПП отменена\n11⁴⁰-13¹⁰\n1⃣пара/305 - Муниципальное право\nНовое');
    await page.click('#im-parse'); await page.waitForSelector('#im-summary');
    const t = await page.textContent('#sheet');
    assert.match(t, /уже вписано другое ДЗ/);
    assert.match(t, /Сейчас на сайте: Старое/);
    assert.match(t, /в сообщении аудитория 305, на сайте 211 — расписание не меняется/);
    assert.match(await page.textContent('#im-unassigned'), /❗ УПП отменена — отмены, переносы и замены из текста не применяются/);
    assert.equal(await page.textContent('#im-summary'), 'Будет записано: ДЗ — 0, ссылок — 0, пометок — 0');
    assert.equal(await page.isDisabled('#im-write'), true);
    await page.check('.im-item input[value=merge]');
    assert.equal(await page.textContent('#im-summary'), 'Будет записано: ДЗ — 1, ссылок — 0, пометок — 0');
    await page.click('#im-write');
    await waitFor(() => (srv.entry('2026-11-03', 'TUE-1140-bot') || {}).hw === 'Старое\nНовое');
  });

  await check('без сети импорт встаёт в очередь и уходит, когда сеть вернулась', async () => {
    srv.offline = true;
    await page.waitForSelector('#toast', { state: 'hidden', timeout: 12000 }); // плашка «Отменить» вверху держится 10 с
    await page.click('#fill-import');
    await page.fill('#im-text', 'ПЯТНИЦА\n06.11.2026\n16⁵⁰-18²⁰\n3⃣пара/115 - ГП (лекция)\nКонспект главы 5');
    await page.click('#im-parse'); await page.click('#im-write');
    await page.waitForSelector('.save.offline');
    assert.equal((srv.entry('2026-11-06', 'FRI-1650') || {}).hw, undefined);
    srv.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => (srv.entry('2026-11-06', 'FRI-1650') || {}).hw === 'Конспект главы 5', 15000);
  });

  await check('без ошибок в консоли', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})();
