// Проверка экрана группы в настоящем браузере (Playwright).
// Запуск: SITE=http://localhost:8766 node tests/e2e/group.e2e.cjs  (сайт отдаёт любой локальный сервер из папки site/)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const SITE = process.env.SITE || 'http://localhost:8766';
const path = require('node:path');
const fs = require('node:fs');
const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
// сервер Google имитируется данными из site/data (тот же формат, что отдаёт Apps Script)
const PAYLOAD = JSON.stringify({ ...readJson('site/data/seed.json'), ...readJson('site/data/demo-entries.json') });

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
  for (const [scheme, width] of [['light', 360], ['dark', 320], ['light', 375]]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: scheme });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/script\.google\.com\/macros/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: PAYLOAD }));
    const open = async (q) => { await page.goto(SITE + '/' + q); await page.waitForSelector('.tabs'); };

    await check(`${scheme} ${width}px: вт 3.11 в 10:00 — «Сегодня», 3 пары`, async () => {
      await open('?now=2026-11-03T10:00');
      assert.equal(await page.getAttribute('[role=tab][aria-selected=true]', 'textContent') ?? await page.textContent('[role=tab][aria-selected=true]'), 'Сегодня');
      assert.equal(await page.locator('.tl > li').count(), 3);
      assert.match(await page.textContent('.nowcard'), /Следующая · через 100 мин/);
    });
    await check(`${scheme} ${width}px: нет горизонтальной прокрутки`, async () => {
      for (const q of ['?now=2026-11-03T14:00', '?now=2026-10-02T12:00']) {
        await open(q);
        for (const tab of ['Сегодня', 'Завтра', 'Неделя', 'ДЗ']) {
          await page.click(`[role=tab]:has-text("${tab}")`);
          const sw = await page.evaluate(() => document.documentElement.scrollWidth);
          assert.ok(sw <= width, `${q} ${tab}: ширина ${sw}`);
        }
      }
    });
    await check(`${scheme} ${width}px: в 19:00 открывается следующий день`, async () => {
      await open('?now=2026-11-03T19:00');
      assert.equal(await page.textContent('[role=tab][aria-selected=true]'), 'Завтра');
      assert.match(await page.textContent('.g-head'), /СР 4/);
    });
    await check(`${scheme} ${width}px: «Идёт сейчас» в 14:00`, async () => {
      await open('?now=2026-11-03T14:00');
      assert.match(await page.textContent('.nowcard'), /Идёт сейчас · ещё 50 мин/);
      assert.equal(await page.locator('.gc.now').count(), 1);
    });
    await check(`${scheme} ${width}px: воскресенье → понедельник; пятница 2.10 с ДЗ и ссылками`, async () => {
      await open('?now=2026-11-01T12:00');
      assert.match(await page.textContent('.g-head'), /ПН 2/);
      await open('?now=2026-10-02T12:00');
      assert.match(await page.textContent('#app'), /Принципы уголовного судопроизводства/);
      const hrefs = await page.locator('.gc a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.getAttribute('rel')]));
      assert.ok(hrefs.length >= 6 && hrefs.every(([h, r]) => /^https:/.test(h) && r === 'noopener noreferrer'));
    });
    await check(`${scheme} ${width}px: вкладка ДЗ; после конца семестра шаблон продолжается`, async () => {
      await open('?now=2026-10-26T09:00');
      await page.click('[role=tab]:has-text("ДЗ")');
      assert.match(await page.textContent('#app'), /К вторнику, 27 октября/);
      await open('?now=2027-01-12T09:00');
      assert.equal(await page.locator('.tl > li').count(), 3);
    });
    if (width === 360) await page.goto(SITE + '/?now=2026-11-03T14:00').then(() => page.waitForSelector('.tl')).then(() => page.screenshot({ path: `/tmp/claude-0/-home-claude/cc8a014e-a473-5ff1-b0b2-4ac4853990a4/scratchpad/g-${scheme}.png`, fullPage: true }));
    await check(`${scheme} ${width}px: без ошибок в консоли`, async () => assert.deepEqual(errors, []));
    await page.close();
  }
  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
