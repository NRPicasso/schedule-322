// Рисует картинку карточки ссылки для Telegram (site/icons/og.png, 1200×630) из tools/og.html.
// Нужен Playwright (devDependency): npm ci && npx playwright install chromium && node tools/build-og.cjs
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + path.join(__dirname, 'og.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, '..', 'site', 'icons', 'og.png') });
  await browser.close();
  console.log('site/icons/og.png готова');
})();
