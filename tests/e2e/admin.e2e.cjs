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
  vm.runInContext(read('apps-script/code.src.js') + '\nthis.api = { processOps_, publicData_ };', ctx);
  const seed = JSON.parse(read('site/data/seed.json'));
  const hist = JSON.parse(read('site/data/demo-entries.json'));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const state = { entries: clone(hist.entries), dayNotes: clone(hist.dayNotes), rules: clone(hist.rules), extras: [] };
  const pairIds = Object.fromEntries(seed.template.map((t) => [t.id, true]));
  const codes = { '123456': 'Активист 1', '654321': 'Активист 2' };
  const seen = new Map(); const logs = [];
  const srv = { state, logs, offline: false, dropResponse: 0, posts: 0,
    payload: () => clone(ctx.api.publicData_(clone({ ...seed, rules: state.rules, extras: state.extras, entries: state.entries, dayNotes: state.dayNotes }))), // как buildPayload_: без имён
    post(req) {
      srv.posts++;
      const name = codes[req.code];
      if (!name) return { ok: false, error: 'bad-code', message: 'Код не подошёл. Проверьте цифры.' };
      if (req.action === 'login') return { ok: true, name };
      if (srv.rejectAll) return { ok: true, name, results: req.ops.map((o) => ({ opId: o.opId, ok: false, error: 'invalid', message: 'проверка: отклонено' })) };
      const out = ctx.api.processOps_(state, clone(req.ops), pairIds, { name, now: new Date().toISOString() }, (o) => seen.get(o.opId) || null);
      out.results.forEach((r) => { if (r.ok) seen.set(r.opId, r); });
      logs.push(...out.logs);
      return JSON.parse(JSON.stringify({ ok: true, name, results: out.results }));
    },
    entry: (date, pairId) => state.entries.find((e) => e.date === date && e.pairId === pairId),
    rule: (pairId, field, from) => state.rules.find((r) => r.pairId === pairId && r.field === field && r.from === from),
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
  await page.goto(SITE + '/admin.html?now=2026-11-02T10:00');

  await check('неверный код — понятная ошибка, верный — открывается неделя 2–7 ноября', async () => {
    await page.fill('#code', '111111'); await page.click('button[type=submit]');
    await page.waitForSelector('#code-err:not(:empty)');
    assert.match(await page.textContent('#code-err'), /Код не подошёл/);
    await page.fill('#code', '123456'); await page.click('button[type=submit]');
    await page.waitForSelector('.fill');
    assert.match(await page.textContent('.top h1'), /2 ноября — 7 ноября/);
    assert.match(await page.textContent('.fill'), /ДЗ: 0 из 4 семинаров/);
    await page.waitForSelector('#coach', { timeout: 5000 });                  // подсказки первого входа (подробно — в pwa.e2e.cjs)
    await page.click('#coach-skip');
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
    assert.match(await page.textContent('.dialog'), /Эту пару уже изменил другой активист/);
    assert.doesNotMatch(await page.textContent('.dialog'), /Активист 2/);                    // имя другого не показывается
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


  // ---------------- шаг 6: изменения расписания ----------------
  const MONTHS = { 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12 };
  const ord = (txt) => { const m = txt.match(/(\d+) (\S+)/); return MONTHS[m[2]] * 100 + Number(m[1]); };
  const toWeek = async (label) => {   // label — начало недели, например «2 ноября»
    for (let i = 0; i < 10; i++) {
      const cur = ord(await page.textContent('.top h1'));
      if (cur === ord(label)) return;
      await page.click(`button[aria-label="${cur > ord(label) ? 'Предыдущая' : 'Следующая'} неделя"]`);
    }
    assert.fail('не дошли до недели ' + label);
  };
  const row = (date, text) => page.locator(`#day-${date} .prow:has-text("${text}")`).first();

  await check('шаг 6: аудитория «только в этот день» — меняется один день, на неделе видно подчёркивание', async () => {
    await page.reload(); await page.waitForSelector('.fill'); await toWeek('2 ноября');
    await row('2026-11-03', 'Муниципальное право').click();
    await page.click('#ch-room'); await page.fill('#f-value', '305'); await page.click('#f-save'); await saved();
    assert.equal(srv.entry('2026-11-03', 'TUE-1140-bot').room, '305');
    assert.equal(srv.state.rules.filter((r) => r.pairId === 'TUE-1140-bot' && r.from > '2026-10-06').length, 0);
    assert.match(await page.textContent('#sheet .sh-head'), /ауд\. 305/);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.equal(await row('2026-11-03', 'Муниципальное право').locator('.room.chg').textContent(), '305');
    await toWeek('16 ноября');
    assert.match(await row('2026-11-17', 'Муниципальное право').textContent(), /ауд\. 211/);
  });

  await check('шаг 6: аудитория «с этого дня и дальше» — правило, прошлые недели не тронуты, снимается одной кнопкой', async () => {
    await toWeek('2 ноября');
    await row('2026-11-05', 'Организация судебной').click();
    await page.click('#ch-room'); await page.fill('#f-value', '401');
    await page.check('input[name=scope][value=from]');
    assert.match(await page.textContent('#f-save'), /с 5 ноября и дальше/);
    await page.click('#f-save'); await saved();
    assert.equal(srv.rule('THU-1320', 'room', '2026-11-05').value, '401');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await toWeek('9 ноября');  assert.match(await row('2026-11-12', 'Организация судебной').textContent(), /ауд\. 401/);
    await toWeek('26 октября'); assert.match(await row('2026-10-29', 'Организация судебной').textContent(), /ауд\. 221/);
    await toWeek('9 ноября');
    await row('2026-11-12', 'Организация судебной').click(); await page.click('#ch-room');
    assert.match(await page.textContent('#f-unrule'), /с 12 ноября \(станет: 221\)/);
    await page.click('#f-unrule'); await saved();
    assert.equal(srv.rule('THU-1320', 'room', '2026-11-05').to, '2026-11-11');   // прошлое не переписано: правило оборвано накануне
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.match(await row('2026-11-12', 'Организация судебной').textContent(), /ауд\. 221/);
    await toWeek('2 ноября'); assert.match(await row('2026-11-05', 'Организация судебной').textContent(), /ауд\. 401/);
  });

  await check('шаг 6: время «с этого дня и дальше» — два правила одним действием, предупреждение о следующей неделе, «Отменить» откатывает оба', async () => {
    await toWeek('2 ноября');
    await row('2026-11-05', 'Организация судебной').click();
    await page.click('#ch-time'); await page.click('.grid-times button[data-start="11:40"]');
    await page.check('input[name=scope][value=from]');
    assert.match(await page.textContent('#sheet'), /12 ноября в это время уже стоит Международное право/);   // 12.11 — верхняя неделя, там МП в 11:40
    assert.match(await page.textContent('#t-save'), /с 5 ноября и дальше/);
    await page.click('#t-save'); await saved();
    assert.equal(srv.rule('THU-1320', 'start', '2026-11-05').value, '11:40');
    assert.equal(srv.rule('THU-1320', 'end', '2026-11-05').value, '13:10');
    await page.click('#toast button:has-text("Отменить")'); await page.waitForTimeout(500); await saved();
    assert.equal(srv.rule('THU-1320', 'start', '2026-11-05'), undefined);
    assert.equal(srv.rule('THU-1320', 'end', '2026-11-05'), undefined);
    // ещё раз — и снимаем кнопкой из карточки другой недели
    await page.click('#ch-time'); await page.click('.grid-times button[data-start="11:40"]');
    await page.check('input[name=scope][value=from]'); await page.click('#t-save'); await saved();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await toWeek('9 ноября');  assert.match(await row('2026-11-12', 'Организация судебной').textContent(), /11:40/);
    await toWeek('26 октября'); assert.match(await row('2026-10-29', 'Организация судебной').textContent(), /13:20/);
    await toWeek('9 ноября');
    await row('2026-11-12', 'Организация судебной').click(); await page.click('#ch-time'); await page.click('#t-unrule'); await saved();
    assert.equal(srv.rule('THU-1320', 'start', '2026-11-05').to, '2026-11-11');
    assert.equal(srv.rule('THU-1320', 'end', '2026-11-05').to, '2026-11-11');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.match(await row('2026-11-12', 'Организация судебной').textContent(), /13:20/);
    await toWeek('2 ноября'); assert.match(await row('2026-11-05', 'Организация судебной').textContent(), /11:40/);
  });

  await check('шаг 6: отмена пары с причиной и возврат одной кнопкой', async () => {
    await toWeek('2 ноября');
    await row('2026-11-05', 'Трудовое право').click();
    await page.click('#ch-cancel'); await page.click('#sheet .chip:has-text("Преподаватель заболел")'); await page.click('#c-save'); await saved();
    assert.equal(srv.entry('2026-11-05', 'THU-1650-bot').cancelled, true);
    assert.equal(srv.entry('2026-11-05', 'THU-1650-bot').reason, 'Преподаватель заболел');
    assert.match(await page.textContent('#sheet .banner'), /Пара отменена: Преподаватель заболел/);
    assert.match(await row('2026-11-05', 'Трудовое право').textContent(), /Отменено/);
    await page.click('#uncancel'); await saved();
    assert.equal(srv.entry('2026-11-05', 'THU-1650-bot').cancelled, false);
    assert.equal(srv.entry('2026-11-05', 'THU-1650-bot').reason, '');
    assert.doesNotMatch(await row('2026-11-05', 'Трудовое право').textContent(), /Отменено/);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 6: перенос с предпросмотром и предупреждением; ДЗ переезжает; отмена переноса возвращает пару с ДЗ', async () => {
    await row('2026-11-05', 'Уголовное право').click();
    await page.click('#ch-move'); await page.fill('#m-date', '2026-11-05'); await page.dispatchEvent('#m-date', 'change');
    assert.match(await page.textContent('#sheet'), /тот же день/);
    await page.fill('#m-date', '2026-11-07'); await page.dispatchEvent('#m-date', 'change');
    await page.click('.grid-times button[data-start="16:50"]');
    assert.match(await page.textContent('#sheet .ba'), /чт 5 ноября[\s\S]*15:00[\s\S]*сб 7 ноября[\s\S]*16:50/i);
    await page.click('#m-save'); await saved();
    const x = srv.state.extras.find((e) => e.srcPairId === 'THU-1500');
    assert.ok(x, 'перенос записан');
    assert.deepEqual([x.srcDate, x.date, x.start, x.end, x.room], ['2026-11-05', '2026-11-07', '16:50', '18:20', '115']);
    assert.match(await page.textContent('#sheet'), /Перенесена с чт 5 ноября/i);
    assert.match(await row('2026-11-05', 'Уголовное право').textContent(), /Перенесено/);
    assert.match(await row('2026-11-07', 'Уголовное право').textContent(), /перенос с 5 ноября/);
    // ДЗ у перенесённой пары
    await page.fill('#hw', 'Читать главу 3'); await page.waitForTimeout(1300); await saved();
    assert.equal(srv.state.extras.find((e) => e.id === x.id).hw, 'Читать главу 3');
    // повторный перенос той же пары с исходной даты сервер не допустит — в карточке исходной пары только «Отменить перенос»
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await row('2026-11-05', 'Уголовное право').click();
    assert.equal(await page.locator('#ch-move').count(), 0);
    await page.click('#open-moved');
    assert.match(await page.textContent('#sheet'), /Перенесена с/);
    await page.click('#ch-unmove'); await saved();
    assert.equal(srv.state.extras.length, 0);
    assert.equal(srv.entry('2026-11-05', 'THU-1500').hw, 'Читать главу 3');
    assert.doesNotMatch(await row('2026-11-05', 'Уголовное право').textContent(), /Перенесено/);
    assert.equal(await page.inputValue('#hw'), 'Читать главу 3');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 6: доп. пара «Другое…» в субботу, смена времени, удаление', async () => {
    await page.click('#day-2026-11-07 button:has-text("+ пара")');
    await page.selectOption('#a-subject', 'other'); await page.fill('#a-other', 'Консультация');
    await page.click('#a-save'); await saved();
    const x = srv.state.extras.find((e) => e.subject === 'Консультация');
    assert.ok(x); assert.deepEqual([x.date, x.start, x.end, x.type], ['2026-11-07', '18:30', '20:00', 'other']);
    assert.match(await row('2026-11-07', 'Консультация').textContent(), /доп\. пара/);
    await row('2026-11-07', 'Консультация').click();
    await page.click('#ch-time'); await page.click('.grid-times button[data-start="16:50"]'); await page.click('#t-save'); await saved();
    assert.equal(srv.state.extras.find((e) => e.id === x.id).start, '16:50');
    await page.click('#ch-delete');
    assert.match(await page.textContent('#ch-delete'), /ещё раз/);                  // удаление — со второго нажатия
    assert.equal(srv.state.extras.length, 1);
    await page.click('#ch-delete'); await saved();
    assert.equal(srv.state.extras.length, 0);
    assert.equal(await row('2026-11-07', 'Консультация').count(), 0);
  });

  await check('шаг 6: семинар-перенос попадает в мастер «Заполнить»', async () => {
    await row('2026-11-05', 'Организация судебной').click();
    await page.click('#ch-move'); await page.fill('#m-date', '2026-11-07'); await page.dispatchEvent('#m-date', 'change');
    await page.click('#m-save'); await saved();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('.fill button:has-text("Заполнить"), .fill button:has-text("Проверить")'); await page.waitForSelector('.wz-foot');
    let found = false;
    for (let i = 0; i < 6 && !found; i++) {
      found = /сб 7 ноября/i.test(await page.textContent('#sheet .sh-head'));
      if (!found) await page.click('.wz-foot .btn-primary');
    }
    assert.ok(found, 'перенесённый семинар есть в мастере');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });


  await check('шаг 6, проверка: преподаватель «по дату»; более поздняя замена снимается с предупреждением', async () => {
    await toWeek('16 ноября');
    await row('2026-11-19', 'Трудовое право').click();
    await page.click('#ch-teacher'); await page.fill('#f-value', 'Борисов Б. Б.'); await page.check('input[name=scope][value=from]');
    await page.click('#f-save'); await saved();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await toWeek('2 ноября');
    await row('2026-11-05', 'Трудовое право').click();
    await page.click('#ch-teacher'); await page.fill('#f-value', 'Петров П. П.'); await page.check('input[name=scope][value=from]');
    assert.match(await page.textContent('#sheet'), /более поздняя постоянная замена \(с 19 ноября — Борисов Б\. Б\.\)/);
    await page.fill('#scope-to', '2026-11-12'); await page.dispatchEvent('#scope-to', 'change');
    assert.doesNotMatch(await page.textContent('#sheet'), /более поздняя/);       // до 12.11 — поздняя замена не мешает
    assert.match(await page.textContent('#f-save'), /по 12 ноября/);
    await page.click('#f-save'); await saved();
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-05').to, '2026-11-12');
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-19').value, 'Борисов Б. Б.');
    await page.click('#ch-teacher'); await page.check('input[name=scope][value=from]'); await page.click('#f-save'); await saved();
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-05').to, '');
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-19'), undefined);         // поздняя снята
    await page.click('#toast button:has-text("Отменить")'); await page.waitForTimeout(500); await saved();
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-19').value, 'Борисов Б. Б.'); // «Отменить» вернул и её
    assert.equal(srv.rule('THU-1650-bot', 'teacher', '2026-11-05').to, '2026-11-12');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 6, проверка: без сети «перенос → вернуть → перенос заново» доходит без отказа и с ДЗ', async () => {
    srv.offline = true;
    await row('2026-11-05', 'Уголовное право').click();
    await page.click('#ch-move'); await page.fill('#m-date', '2026-11-12'); await page.dispatchEvent('#m-date', 'change'); await page.click('#m-save');
    await page.click('#ch-unmove');
    await page.click('#ch-move'); await page.fill('#m-date', '2026-11-07'); await page.dispatchEvent('#m-date', 'change'); await page.click('#m-save');
    await page.fill('#hw', 'Глава 7'); await page.waitForTimeout(1300);
    srv.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => /Сохранено/.test(document.querySelector('.save').textContent), null, { timeout: 25000 });
    assert.equal(await page.locator('.dialog').count(), 0);
    const live = srv.state.extras.filter((e) => e.srcPairId === 'THU-1500');
    assert.equal(live.length, 1); assert.equal(live[0].date, '2026-11-07'); assert.equal(live[0].hw, 'Глава 7');
  });

  await check('шаг 6, проверка: «Отменить» после «Вернуть перенос» снова переносит (без отказа сервера)', async () => {
    await page.click('#ch-unmove'); await saved();
    assert.equal(srv.state.extras.filter((e) => e.srcPairId === 'THU-1500').length, 0);
    assert.equal(srv.entry('2026-11-05', 'THU-1500').hw, 'Глава 7');
    await page.click('#toast button:has-text("Отменить")'); await page.waitForTimeout(500); await saved();
    assert.equal(await page.locator('.dialog').count(), 0);
    const live = srv.state.extras.filter((e) => e.srcPairId === 'THU-1500');
    assert.equal(live.length, 1); assert.equal(live[0].date, '2026-11-07');
  });

  await check('шаг 6, проверка: конфликт по перенесённой паре — выбор варианта, «Оставить мой» сохраняет мой текст', async () => {
    const x = srv.state.extras.find((e) => e.srcPairId === 'THU-1500');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await toWeek('2 ноября');
    await row('2026-11-07', 'Уголовное право').click();
    srv.post({ code: '654321', ops: [{ opId: 'op-other-0002', type: 'extra.update', date: x.date, id: x.id, baseVersion: x.version, patch: { hw: 'Глава 8 от Активист 2' } }] });
    await page.fill('#hw', 'Глава 7 и 8'); await page.waitForTimeout(1300);
    await page.waitForSelector('.dialog');
    assert.match(await page.textContent('.dialog'), /Эту пару уже изменил другой активист[\s\S]*Глава 8 от Активист 2[\s\S]*Глава 7 и 8/);
    await page.click('.dialog button:has-text("Оставить мой")'); await saved();
    assert.equal(srv.state.extras.find((e) => e.id === x.id).hw, 'Глава 7 и 8');
    assert.equal(await page.locator('.dialog').count(), 0);
  });

  await check('шаг 6, проверка: отменить перенесённую пару совсем — перенос снят, исходный день зачёркнут с причиной', async () => {
    await page.click('#ch-cancel'); await page.click('#sheet .chip:has-text("Мероприятие")'); await page.click('#c-save'); await saved();
    assert.equal(srv.state.extras.filter((e) => e.srcPairId === 'THU-1500').length, 0);
    assert.equal(srv.entry('2026-11-05', 'THU-1500').cancelled, true);
    assert.equal(srv.entry('2026-11-05', 'THU-1500').reason, 'Мероприятие');
    assert.match(await page.textContent('#sheet .banner'), /Пара отменена: Мероприятие/);
    await page.click('#uncancel'); await saved();
    assert.equal(srv.entry('2026-11-05', 'THU-1500').cancelled, false);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 6, проверка: два отказа подряд — окна по одному, ни одно не потеряно', async () => {
    srv.offline = true;
    await page.click('#day-2026-11-06 button:has-text("+ пометка")');
    await page.click('#sheet .chip:has-text("Сменка")'); await page.click('#sheet .chip:has-text("Контрольная")');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    srv.offline = false; srv.rejectAll = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('.dialog', { timeout: 15000 });
    assert.match(await page.textContent('.dialog'), /Сменка/);
    srv.rejectAll = false;
    await page.click('.dialog button:has-text("Понятно")'); await page.waitForTimeout(300);
    assert.match(await page.textContent('.dialog'), /Контрольная/);
    await page.click('.dialog button:has-text("Понятно")'); await page.waitForTimeout(800);
    assert.equal(await page.locator('.dialog').count(), 0);
    await page.reload(); await page.waitForSelector('.fill');
  });


  // ---------------- шаг 7: текст для Telegram ----------------
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  await check('шаг 7: «По дням» — копирование по очереди: понедельник → вторник → …, отметки ✓', async () => {
    await toWeek('2 ноября');
    await page.click('#bar-telegram');
    await page.waitForSelector('#tg-copy');
    assert.match(await page.textContent('#tg-copy'), /Скопировать понедельник/);
    assert.match(await page.inputValue('#tg-text'), /^ПОНЕДЕЛЬНИК\n\n02\.11\.2026\n\n15⁰⁰-16³⁰\n1⃣пара\/115 - ГПП \(лекция\)/);
    await page.click('#tg-copy');
    assert.match(await clip(), /^ПОНЕДЕЛЬНИК\n\n02\.11\.2026/);
    await page.waitForFunction(() => /вторник/.test(document.querySelector('#tg-copy').textContent));
    assert.match(await page.textContent('#sheet .chips'), /✓ пн 2/);
    assert.match(await page.inputValue('#tg-text'), /^ВТОРНИК\n\n03\.11\.2026/);
    await page.click('#tg-copy');
    const tue = await clip();
    assert.match(tue, /1⃣пара\/305 - Муниципальное право\nДебаты: аргументы сторон/);   // разовая аудитория и ДЗ из прошлых шагов
    await page.check('#tg-emoji');
    assert.match(await page.inputValue('#tg-text'), /^СРЕДА\n/);                // эмодзи у среды нет — как у активистов
    await page.click('#sheet .chips button:has-text("пн 2")');                // день выбирается, копирует главная кнопка
    assert.match(await page.textContent('#tg-copy'), /понедельник ещё раз/);
    await page.click('#tg-copy');
    assert.match(await clip(), /^ПОНЕДЕЛЬНИК🍃\n/);
    await page.uncheck('#tg-emoji');
    await page.waitForFunction(() => /среду/.test(document.querySelector('#tg-copy').textContent));
    // вторник изменили после копирования — это видно, и его предлагают скопировать заново
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await row('2026-11-03', 'Муниципальное право').click();
    await page.fill('#hw', 'Дебаты: аргументы сторон и регламент'); await page.waitForTimeout(1300); await saved();
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#bar-telegram');
    assert.match(await page.textContent('#sheet'), /После копирования изменились дни: 1/);
    assert.match(await page.textContent('#sheet .chips'), /! вт 3/);
    assert.match(await page.textContent('#tg-copy'), /вторник заново \(изменён\)/);
    await page.click('#tg-copy');
    assert.match(await clip(), /Дебаты: аргументы сторон и регламент/);
  });

  await check('шаг 7: «Вся неделя» и «Изменения» — тексты для группы, копирование по одному и всех сразу', async () => {
    await page.click('#tg-tab-week');
    await page.click('#tg-copy');
    const week = await clip();
    assert.match(week, /^ПОНЕДЕЛЬНИК[\s\S]*\n\n\nВТОРНИК[\s\S]*ПЯТНИЦА/);
    await page.click('#tg-tab-changes');
    const changes = await page.textContent('#sheet');
    assert.match(changes, /❗ Вторник, 3 ноября: 1 пара Муниципальное право — в аудитории 305 \(вместо 211\)\./);
    await page.click('#tg-ch-0');
    assert.match(await clip(), /^❗ /);
    if (await page.locator('#tg-copy-all').count()) { await page.click('#tg-copy-all'); assert.ok((await clip()).split('\n').length >= 2); }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 7: в карточке изменённой пары — готовое сообщение для группы', async () => {
    await row('2026-11-03', 'Муниципальное право').click();
    assert.match(await page.textContent('#sheet'), /Сообщение для группы[\s\S]*в аудитории 305/);
    await page.click('#tg-pair');
    assert.equal(await clip(), '❗ Вторник, 3 ноября: 1 пара Муниципальное право — в аудитории 305 (вместо 211).');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await row('2026-11-06', 'Уголовный процесс').click();
    await page.waitForSelector('#sheet:not([hidden]) #ch-room');
    assert.doesNotMatch(await page.textContent('#sheet'), /Сообщение для группы/); // у пары без изменений блока нет
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  });

  await check('шаг 7: буфер недоступен — сначала запасной способ, затем окно с выделенным текстом (и на вкладке «Изменения»)', async () => {
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('нет доступа')); window.__copied = null;
      document.execCommand = (cmd) => { window.__copied = cmd === 'copy' ? document.activeElement.value : null; return true; }; });
    await page.click('#bar-telegram'); await page.click('#tg-tab-week');
    await page.click('#tg-copy');
    assert.match(await page.evaluate(() => window.__copied), /^ПОНЕДЕЛЬНИК/);    // скопировано старым способом
    assert.equal(await page.locator('.dialog').count(), 0);
    await page.evaluate(() => { document.execCommand = () => false; });
    await page.click('#tg-tab-changes'); await page.click('#tg-ch-0');
    await page.waitForSelector('.dialog');
    assert.match(await page.textContent('.dialog'), /Скопируйте вручную/);
    const sel = await page.evaluate(() => { const t = document.querySelector('.dialog textarea'); return [document.activeElement === t, t.selectionEnd - t.selectionStart, t.value.length, t.value]; });
    assert.equal(sel[0], true); assert.equal(sel[1], sel[2]); assert.match(sel[3], /^❗ /);
    await page.click('.dialog button:has-text("Готово")');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForSelector('.fill');                   // вернуть настоящий буфер обмена
  });

  await check('360 px без горизонтальной прокрутки; группа видит новое ДЗ', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 360);
    await page.goto(SITE + '/?now=2026-11-03T09:00'); await page.waitForSelector('.tl');
    assert.match(await page.textContent('.tl'), /Дебаты: аргументы сторон/);
    await page.waitForFunction(() => /305/.test(document.querySelector('.tl').textContent), null, { timeout: 10000 }).catch(() => {}); // сначала показывается копия из телефона, потом свежие данные
    assert.match(await page.textContent('.tl'), /305/);                       // разовая аудитория видна группе
    await page.goto(SITE + '/?now=2026-11-07T09:00'); await page.waitForSelector('.tl');
    assert.match(await page.textContent('.tl'), /Организация судебной/);        // перенос виден группе
  });
  await check('без ошибок в консоли', async () => assert.deepEqual(errors, []));
  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
})();
