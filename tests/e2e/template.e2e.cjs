// «Шаблон и семестр» (v0.2) в браузере с имитацией сервера (тот же processOps_, что в Apps Script).
// Запуск: SITE=http://localhost:8766 ROOT=<папка проекта> node tests/e2e/template.e2e.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { makeServer } = require('./mock-server.cjs');

const SITE = process.env.SITE || 'http://localhost:8766';
const API = /script\.google\.com\/macros\/s\/.+\/exec/;

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = async (name, fn) => { try { await fn(); results.push('OK   ' + name); } catch (e) { results.push('FAIL ' + name + ' — ' + e.message.split('\n')[0]); } };
  const srv = makeServer();
  const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(API, async (route) => {
    if (srv.offline) return route.abort('internetdisconnected');
    const req = route.request();
    const body = req.method() === 'POST' ? srv.post(JSON.parse(req.postData())) : srv.payload();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  const sheet = () => page.textContent('#sheet');
  const noScroll = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'горизонтальная прокрутка');
  const versions = () => srv.state.versions.map((v) => `${v.id}@${v.version}`);
  const undoToast = async () => { await page.waitForSelector('#toast:not([hidden]) button'); await page.click('#toast button'); };
  const waitFor = (fn, timeout = 8000) => (async () => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > timeout) throw new Error('не дождались: ' + fn); await page.waitForTimeout(100); } })();

  await page.goto(SITE + '/admin.html?now=2026-11-02T10:00');
  await page.fill('#code', '123456'); await page.click('button[type=submit]');
  await page.waitForSelector('.fill');
  if (await page.locator('#coach-skip').count()) await page.click('#coach-skip');

  await check('список версий: действующая — только просмотр, кнопки новой версии и предметов', async () => {
    await page.click('#tpl-open');
    await page.waitForSelector('#tpl-new');
    const t = await sheet();
    assert.match(t, /Сейчас действует: с 14 сентября 2026/);
    assert.match(t, /23 пары/);
    assert.match(t, /Эта неделя — нижняя/);                      // 2 ноября — 7 недель от 14.09
    assert.match(t, /Действующую версию не меняют/);
    await noScroll();
  });

  await check('новая версия с 09.02.2027: дата не раньше завтра, черновик из копии, половина недели продолжается', async () => {
    await page.click('#tpl-new');
    await page.fill('#tpl-from', '2026-11-02');
    assert.match(await page.textContent('#tpl-from-err'), /не раньше завтрашнего дня/);
    assert.equal(await page.isDisabled('#tpl-create'), true);
    await page.fill('#tpl-from', '2027-02-09');
    await page.waitForFunction(() => /За основу — версия с 14 сентября 2026 \(23 пары\)/.test(document.querySelector('#sheet').textContent));
    await page.click('#tpl-create');
    await page.waitForSelector('#tpl-next');
    const t = await sheet();
    assert.match(t, /Версия с 9 февраля 2027/);
    assert.match(t, /Черновик · не сохранён/);
    assert.equal(await page.isChecked('input[name=tpl-half][value=bottom]'), true);   // неделя с 8 февраля — нижняя (21 неделя от 14.09)
    assert.match(t, /Значит, 15 февраля — верхняя, 22 февраля — нижняя/);
    assert.deepEqual(versions(), ['V1@1']);                                          // на сервере ничего не изменилось
  });

  await check('пары черновика: изменить аудиторию, удалить пару, добавить новую; ошибка времени у поля; наложение — предупреждение', async () => {
    await page.click('#tpl-day-2');
    await page.click('.tpl-pair[data-id="TUE-1500-top"]');
    await page.fill('#pf-room', '305'); await page.click('#pf-done');
    await page.waitForSelector('.tpl-pair[data-id="TUE-1500-top"]');
    assert.match(await page.textContent('.tpl-pair[data-id="TUE-1500-top"]'), /ауд\. 305/);
    await page.click('.tpl-pair[data-id="TUE-1500-bot"]');
    await page.click('#pf-delete'); await page.click('#pf-delete');
    await page.waitForSelector('#tpl-next');
    assert.equal(await page.locator('.tpl-pair[data-id="TUE-1500-bot"]').count(), 0);
    // новая пара в понедельник — с ошибкой времени, потом исправленная, и наложение на ГПП 15:00
    await page.click('#tpl-day-1'); await page.click('#tpl-add-pair');
    await page.selectOption('#pf-subject', 'ОСД');
    await page.check('input[name=pf-type][value=lecture]');
    await page.fill('#t-start', '16:00'); await page.fill('#t-end', '15:00'); await page.dispatchEvent('#t-end', 'change');
    await page.click('#pf-done');
    assert.match(await page.textContent('#pf-err-time'), /Время окончания должно быть позже начала/);
    await page.click('#sheet .grid-times button[data-start="15:00"]');
    await page.fill('#pf-room', '101'); await page.click('#pf-done');
    await page.waitForSelector('#tpl-overlap');
    assert.match(await page.textContent('#tpl-overlap'), /пн верх: .*15:00–16:30 и ОСД 15:00–16:30|пн верх: ОСД 15:00–16:30 и .*15:00–16:30/);
    assert.match(await page.textContent('#tpl-day-1'), /пн · 4/);
    await noScroll();
  });

  await check('черновик переживает перезагрузку страницы; предпросмотр недели по черновику', async () => {
    await page.reload(); await page.waitForSelector('.fill');
    await page.click('#tpl-open'); await page.waitForSelector('#tpl-continue');
    assert.match(await sheet(), /Есть несохранённый черновик версии с 9 февраля 2027/);
    await page.click('#tpl-continue'); await page.waitForSelector('#tpl-preview');
    await page.click('#tpl-preview'); await page.waitForSelector('#pv-days');
    let t = await page.textContent('#pv-days');
    assert.match(t, /Понедельник, 8 февраля · прежняя версия/);
    assert.match(t, /Вторник, 9 февраля[^]*ТП|Вторник, 9 февраля/);
    await page.click('#pv-next');
    t = await page.textContent('#pv-days');
    assert.match(t, /Вторник, 16 февраля[^]*Гражданский процесс · семинар · ауд\. 305/);
    assert.match(t, /Понедельник, 15 февраля[^]*Организация судебной деятельности · лекция · ауд\. 101/);
    await page.click('#sheet button:has-text("Назад к версии")');
  });

  await check('«что изменится» → сохранить → на сервере 2 версии; «Отменить» удаляет новую', async () => {
    await page.click('#tpl-next'); await page.waitForSelector('#tpl-save');
    const diff = await page.textContent('#tpl-diff');
    assert.match(diff, /\+ ОСД \(лекция\), пн верх 15:00|\+ ОСД \(лекция\), пн 15:00/);
    assert.match(diff, /− ТП \(лекция\), вт низ 15:00/);
    assert.match(diff, /аудитория 219 → 305/);
    assert.match(await sheet(), /С 9 февраля 2027 расписание пойдёт по этой версии\. Недели до 8 февраля не изменятся/);
    await page.click('#tpl-save');
    await page.waitForSelector('#tpl-new');
    assert.deepEqual(versions(), ['V1@1', 'V-20270209@1']);
    assert.match(srv.logs.at(-1).action, /версия шаблона \+/);
    await page.waitForFunction(() => /Будущие версии[^]*с 9 февраля 2027/.test(document.querySelector('#sheet').textContent));
    assert.doesNotMatch(await sheet(), /несохранённый черновик/);
    await undoToast();
    await waitFor(() => srv.state.versions.length === 1);
    await page.waitForFunction(() => !/Будущие версии/.test(document.querySelector('#sheet').textContent));
  });

  await check('ДЗ пары, сменившей день, переезжает вместе с версией; без сети — понятный отказ, черновик цел', async () => {
    srv.state.entries.push({ date: '2026-11-20', pairId: 'FRI-1830', hw: 'Задачи 1–5', links: [], version: 1 });
    await page.reload(); await page.waitForSelector('.fill'); await page.click('#tpl-open');
    await page.click('#tpl-new'); await page.fill('#tpl-from', '2026-11-16');
    await page.waitForSelector('#tpl-create:not([disabled])'); await page.click('#tpl-create');
    await page.click('#tpl-day-5'); await page.click('.tpl-pair[data-id="FRI-1830"]');
    await page.selectOption('#pf-day', '4'); await page.click('#pf-done');
    await page.click('#tpl-next'); await page.waitForSelector('.tpl-impact');
    const imp = await page.textContent('.tpl-impact');
    assert.match(imp, /Пятница, 20 ноября · УПП — Задачи 1–5/);
    assert.match(imp, /Перенести на четверг, 19 ноября/);
    assert.equal(await page.isChecked('.tpl-impact input[value=move]'), true);
    srv.offline = true;
    await page.click('#tpl-save');
    await page.waitForSelector('#tpl-err');
    assert.match(await page.textContent('#tpl-err'), /нет связи\. Черновик остался на телефоне/);
    srv.offline = false;
    await page.click('#tpl-save'); await page.waitForSelector('#tpl-new');
    assert.equal(srv.entry('2026-11-19', 'FRI-1830').hw, 'Задачи 1–5');
    assert.equal(srv.entry('2026-11-20', 'FRI-1830').hw, '');
    await undoToast();                                                    // отмена возвращает и версию, и запись
    await waitFor(() => srv.state.versions.length === 1 && srv.entry('2026-11-20', 'FRI-1830').hw === 'Задачи 1–5');
    assert.equal(srv.entry('2026-11-19', 'FRI-1830').hw, '');
  });

  await check('правка будущей версии; одновременная правка — выбор, имя другого не показано; удаление и «Отменить»', async () => {
    await page.click('#tpl-new'); await page.fill('#tpl-from', '2027-02-09');
    await page.waitForSelector('#tpl-create:not([disabled])'); await page.click('#tpl-create');
    await page.click('#tpl-next'); await page.click('#tpl-save'); await page.waitForSelector('#tpl-edit-V-20270209');
    await page.click('#tpl-edit-V-20270209'); await page.waitForSelector('#tpl-sem-end');
    await page.fill('#tpl-sem-end', '2027-06-20'); await page.dispatchEvent('#tpl-sem-end', 'change');
    // тем временем другой активист сохранил эту же версию
    const other = JSON.parse(JSON.stringify(srv.state.versions[1])); delete other.by; delete other.updatedAt; delete other.version;
    srv.post({ code: '654321', ops: [{ opId: 'op-other-tpl-01', type: 'version.save', date: other.from, baseVersion: 1, tplVersion: { ...other, semesterEnd: '2027-06-25' } }] });
    await page.click('#tpl-next'); await page.click('#tpl-save');
    await page.waitForSelector('.dialog');
    const d = await page.textContent('.dialog');
    assert.match(d, /Эту версию шаблона уже изменил другой активист/);
    assert.doesNotMatch(d, /Активист \d/);
    await page.click('#vc-mine'); await page.waitForSelector('#tpl-save'); await page.click('#tpl-save');
    await page.waitForSelector('#tpl-new');
    assert.equal(srv.state.versions[1].semesterEnd, '2027-06-20');
    assert.equal(srv.state.versions[1].version, 3);
    await page.click('#tpl-del-V-20270209'); await page.waitForSelector('#tpl-save');
    assert.match(await sheet(), /С 9 февраля 2027 снова пойдёт версия с 14 сентября 2026/);
    await page.click('#tpl-save'); await page.waitForSelector('#tpl-new');
    assert.deepEqual(versions(), ['V1@1']);
    await undoToast();
    await waitFor(() => srv.state.versions.length === 2);
  });

  await check('предметы: новый с цветом и «Отменить»; правка поверх чужой — конфликт с текущим значением', async () => {
    await page.click('#tpl-subjects'); await page.waitForSelector('#sj-new');
    await page.click('#sj-new'); await page.click('#sj-save');
    assert.match(await page.textContent('#sj-name-err'), /Впишите название/);
    await page.fill('#sj-name', 'Криминалистика'); await page.fill('#sj-short', 'КРИМ');
    await page.check('input[name=sj-color][value=tp]');
    await page.click('#sj-save'); await page.waitForSelector('#sj-new');
    assert.ok(srv.state.subjects.some((s) => s.subject === 'Криминалистика' && s.color === 'tp'));
    assert.match(await page.textContent('#sj-list'), /Криминалистика/);
    await undoToast();
    await waitFor(() => !srv.state.subjects.some((s) => s.subject === 'Криминалистика'));
    // правка ГПП, а другой активист успел поменять его раньше
    await page.click('#sj-list button[aria-label="Изменить предмет ГПП"]');
    srv.post({ code: '654321', ops: [{ opId: 'op-other-sj-01', type: 'subject.set', date: '2026-11-02', subject: { subject: 'ГПП', short: 'ГПП', full: 'Гражданский процесс (их)', color: 'gpp' }, prev: { short: 'ГПП', full: 'Гражданский процесс', color: 'gpp' } }] });
    await page.fill('#sj-full', 'Гражданский процесс (мой)'); await page.click('#sj-save');
    await page.waitForSelector('#sj-err');
    assert.match(await page.textContent('#sj-err'), /уже изменил другой активист: ГПП — Гражданский процесс \(их\)/);
    await page.click('#sj-save'); await page.waitForSelector('#sj-new');
    assert.equal(srv.state.subjects.find((s) => s.subject === 'ГПП').full, 'Гражданский процесс (мой)');
    await noScroll();
  });

  await check('без сети: кнопки изменения недоступны с объяснением, просмотр работает', async () => {
    await page.click('#sheet button:has-text("К версиям шаблона")');
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.click('#tpl-subjects'); await page.click('#sheet button:has-text("К версиям шаблона")');   // перерисовать
    assert.equal(await page.isDisabled('#tpl-new'), true);
    assert.match(await sheet(), /Шаблон меняется только с интернетом/);
    await context.setOffline(false);
  });

  await check('без ошибок в консоли', async () => { assert.deepEqual(errors, []); });
  await browser.close();
  console.log(results.join('\n'));
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
})();
