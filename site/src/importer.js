// Импорт из Telegram (v0.2): сообщения активистов в привычном формате → ДЗ, ссылки и пометки дня.
//
//   ВТОРНИК
//   27.10.2026
//   11⁴⁰-13¹⁰
//   1⃣пара/222 - Муниципальное право
//   Анализ Устава МО
//   https://t.me/c/…
//
// Чистые функции: parseMessages разбирает текст, planImport сопоставляет с парами на сайте.
// Расписание (аудитории, время, преподаватель) из сообщений не меняется — только предупреждения.
import { buildDay, addDays, weekday } from './schedule.js';

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const DAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];
const URL_RE = /https?:\/\/[^\s<>"«»]+/g;
const LIMITS = { hw: 5000, link: 500, links: 10, note: 200, notesPerDay: 10 };

/** Текст из буфера → строки: без «вариантов эмодзи» (U+FE0F), неразрывных и невидимых пробелов. Пустые строки сохраняются. */
function lines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[️​-‍⁠]/g, '').replace(/[   ]/g, ' ')
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim());
}
// Заголовки копии нескольких сообщений: «Имя, [27.10.2026 18:05]» (в т. ч. «9:01 AM», «27/10/2026 в 18:05»)
// и «[27.10.2026 18:05] Имя: текст». Имя нигде не сохраняется: заголовок пропускается, у второго вида
// остаётся только текст после двоеточия.
const STAMP = String.raw`\[[^\]\n]{0,12}\d{1,2}[./]\d{1,2}[./]\d{2,4}[^\]\n]{0,20}\]`;
const HEADER_RE = new RegExp(`^[^\\n\\[\\]]{1,80}, ${STAMP}$`);
const PREFIX_RE = new RegExp(`^${STAMP} [^:]{1,80}: ?`);
const DATE_IN = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;
const sup = (s) => [...s].map((c) => SUP[c] ?? c).join('');
/** «11⁴⁰-13¹⁰», «9:40–11:10», «9.40 - 11.10» → ['11:40', '13:10']. */
function timeRange(s) {
  const m = /^(\d{1,2})[:.]?(\d{2})\s*[-–—]\s*(\d{1,2})[:.]?(\d{2})$/.exec(sup(s).replace(/\s+/g, ' '));
  if (!m || Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
  const t = (hh, mm) => `${hh.padStart(2, '0')}:${mm}`;
  return [t(m[1], m[2]), t(m[3], m[4])];
}
// хвосты, которые добавляет наш же текст для Telegram: «(перенос с 5 ноября (чт))», «— перенос с …», «(доп. пара)»
const SUFFIX_RE = /\s*(?:[—-]\s*перенос с .*|\((?:перенос с [^()]*(?:\([^()]*\))?|доп\. пара)\)|[—-]\s*доп\. пара)\s*$/iu;
/** «1⃣пара/222 - Муниципальное право», «3⃣4⃣ пара/ 115 - ГП (лекция)», «2 пара/219- ГПП». */
function pairLine(s) {
  const m = /^((?:\d\u20E3)+|\d+(?:\s*[-–,и]\s*\d+)?)\s*пара\s*(?:\/\s*([^-–—]*?)\s*)?[-–—]\s*(.+)$/iu.exec(s); // аудитория может быть пропущена
  if (!m) return null;
  return { numbers: (m[1].match(/\d/g) || []).map(Number), room: (m[2] || '').trim(), name: m[3].replace(SUFFIX_RE, '').trim() };
}
// Строки об изменениях расписания: из текста они не применяются. «❗Доклады обязательно» — это ДЗ, не изменение.
const CHANGE_WORDS = /(?<![а-яё])(отмен(?:ен|ён)[аоы]?|перенесен[аоы]?\s+на|перенос\s+с|вместо|доп(?:\.|олнительная)\s+пара)(?![а-яё])/iu;
const isChange = (s) => /^[❌➡]/u.test(s) || (/^[❗⚠]/u.test(s) && CHANGE_WORDS.test(s)) || /^(?:пара\s+)?(?:отменена|перенесена\s+на)/iu.test(s);
const isTeacher = (s) => /^ведёт:|^ведет:/iu.test(s);
/** Ссылки строки без «прилипшей» пунктуации: «(https://…).» → «https://…». */
function linksOf(s) {
  return (s.match(URL_RE) || []).map((u) => {
    let x = u.replace(/[.,;:!?»"']+$/u, '');
    while (x.endsWith(')') && (x.match(/\(/g) || []).length < (x.match(/\)/g) || []).length) x = x.slice(0, -1).replace(/[.,;:!?]+$/u, '');
    return x;
  });
}
/** Текст строки без ссылок: «Методичка (https://…).» → «Методичка», «См. https://…/a.pdf, стр 5» → «См., стр 5». */
const textOf = (s) => s.replace(URL_RE, (u) => u.slice((linksOf(u)[0] || '').length)) // от ссылки остаётся только «прилипшая» пунктуация
  .replace(/\(\s*\)/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/[\s,;:(\-–—]+$/u, '').replace(/^[\s.,;:]+/u, '').trim();

/**
 * Разбор одного или нескольких сообщений. monday — понедельник открытой недели (для дней без даты).
 * Возвращает { days: [{date, blocks: [{start, end, numbers, room, name, lines, tail, teacher}], loose}], unassigned: [{line, reason, date?}] }.
 * tail — абзац после пустой строки у последней пары дня (так наш текст отделяет пометки дня).
 */
export function parseMessages(text, monday) {
  const days = [], unassigned = [];
  let day = null, block = null, gap = false;
  const startDay = (date, fromWeekday) => { day = { date, blocks: [], loose: [], fromWeekday, weekday: null }; days.push(day); block = null; gap = false; };
  for (let raw of lines(text)) {
    if (!raw) { gap = true; continue; }
    if (HEADER_RE.test(raw)) continue;
    raw = raw.replace(PREFIX_RE, '');
    if (!raw) continue;
    const word = raw.replace(/[^А-ЯЁа-яё]/g, '').toUpperCase();
    const wd = DAYS.indexOf(word);
    const dm = DATE_IN.exec(raw);
    const iso = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
    if ((wd >= 0 && raw.length <= 40) || (dm && raw.replace(DATE_IN, '').replace(/[^А-ЯЁа-яё0-9]/g, '') === '')) {
      const fresh = day && !day.blocks.length && !day.loose.length;
      if (iso && fresh && day.fromWeekday) { day.date = iso; day.fromWeekday = false; }          // «ВТОРНИК» и следом «27.10.2026»
      else if (wd >= 0 && !iso && fresh && !day.fromWeekday && day.weekday == null) { /* «27.10.2026», следом «ВТОРНИК» */ }
      else if (iso) startDay(iso, false);
      else startDay(monday ? addDays(monday, (wd + 6) % 7) : null, true);
      if (wd >= 0) day.weekday = wd;
      if (day.date && day.weekday != null && weekday(day.date) !== day.weekday) {
        unassigned.push({ line: raw, reason: `дата ${day.date.split('-').reverse().join('.')} — не ${DAYS[day.weekday].toLowerCase()}; взята дата`, date: day.date });
      }
      continue;
    }
    if (!day) { unassigned.push({ line: raw, reason: 'до первого дня — нет строки с днём недели или датой' }); continue; }
    const tr = timeRange(raw);
    if (tr) { block = { start: tr[0], end: tr[1], numbers: [], room: '', name: '', lines: [], tail: [], teacher: '' }; day.blocks.push(block); gap = false; continue; }
    const pl = pairLine(raw);
    if (pl) {
      if (!block || block.name) { block = { start: '', end: '', numbers: [], room: '', name: '', lines: [], tail: [], teacher: '' }; day.blocks.push(block); }
      Object.assign(block, pl); gap = false;
      continue;
    }
    if (isChange(raw)) { unassigned.push({ line: raw, reason: 'отмены, переносы и замены из текста не применяются — сделайте их в карточке пары', date: day.date }); continue; }
    if (block && isTeacher(raw)) { block.teacher = raw.replace(/^ведё?е?т:\s*/iu, ''); continue; }
    // после пустой строки — отдельный абзац: у последней пары дня это пометки дня (так пишет наш текст для Telegram)
    if (block) (gap ? block.tail : block.lines).push(raw);
    else day.loose.push(raw);
  }
  const out = [];
  for (const d of days) {
    if (!d.date) { unassigned.push({ line: d.blocks.map((b) => b.name).join(', ') || 'день без даты', reason: 'нет даты и не открыта неделя' }); continue; }
    for (const l of d.loose) unassigned.push({ line: l, reason: 'строка до первой пары дня', date: d.date });
    // абзац после пустой строки: у последней пары дня — пометки дня; у остальных — продолжение ДЗ
    d.notes = [];
    d.blocks.forEach((b, i) => { if (i === d.blocks.length - 1) d.notes.push(...b.tail); else b.lines.push(...b.tail); b.tail = []; });
    out.push(d);
  }
  return { days: out, unassigned };
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const sameLinks = (a, b) => a.length === b.length && a.every((u) => b.includes(u));
/** Название из сообщения подходит к паре: точно (предмет, как в Telegram, полное название) или длинное начало (не «УП» ↔ «УПП»). */
function nameMatches(name, p, subjects) {
  const n = norm(name.replace(/\(.*\)/, ''));
  if (!n) return false;
  const full = subjects && Object.prototype.hasOwnProperty.call(subjects, p.subject) ? subjects[p.subject].full : '';
  return [p.subject, p.tgName, full].filter(Boolean).map(norm).some((x) => x === n || (Math.min(x.length, n.length) >= 5 && (x.startsWith(n) || n.startsWith(x))));
}
const cut = (s, max) => Array.from(s).slice(0, max).join('').trimEnd();

/**
 * Что запишется: по каждой паре сообщения — пара на сайте, новое ДЗ и ссылки, что уже вписано.
 * Если один день вставили дважды (сообщение и исправление), берётся последнее.
 * Возвращает { items: [{date, pair, hw, links, status: 'new'|'same'|'differs', warnings}], notes: [{date, text, status}], unassigned }.
 */
export function planImport(data, parsed) {
  const byKey = new Map(), notes = [], unassigned = [...parsed.unassigned];
  const addNote = (date, text, warnings) => {
    let t = text;
    if (Array.from(t).length > LIMITS.note) { t = cut(t, LIMITS.note); if (warnings) warnings.push('пометка длиннее 200 знаков — обрезана'); }
    const i = notes.findIndex((n) => n.date === date && norm(n.text) === norm(t));
    if (i < 0) notes.push({ date, text: t });
  };
  for (const d of parsed.days) {
    const pairs = buildDay(d.date, data).pairs.filter((p) => p.status !== 'moved-away');
    const used = new Set();
    for (const b of d.blocks) {
      // пара на сайте: по времени начала, при нескольких — по названию и не отменённая; без времени — по названию
      const free = pairs.filter((q) => !used.has(q));
      const atTime = b.start ? free.filter((q) => q.start === b.start) : [];
      const named = b.name ? free.filter((q) => nameMatches(b.name, q, data.subjects)) : [];
      let p = atTime.find((q) => named.includes(q) && q.status !== 'cancelled') || atTime.find((q) => named.includes(q))
        || (!b.name ? atTime.find((q) => q.status !== 'cancelled') || atTime[0] : null)
        || (!b.start ? named[0] : null);
      const content = b.lines.filter((l) => textOf(l) || linksOf(l).length);
      if (!p) {
        if (content.length) {
          const other = atTime[0] ? ` (в ${b.start} на сайте ${atTime[0].subject})` : b.start ? ` в ${b.start}` : '';
          unassigned.push({ line: [`${b.start || '?'} ${b.name}`.trim(), ...b.lines].join(' · '), reason: `в этот день на сайте нет такой пары${other}`, date: d.date });
        }
        continue;
      }
      used.add(p);
      const warnings = [];
      if (b.room && norm(b.room) !== norm(p.room)) warnings.push(`в сообщении аудитория ${b.room}, на сайте ${p.room || '—'} — расписание не меняется`);
      if (b.start && b.start !== p.start) warnings.push(`в сообщении ${b.start}, на сайте ${p.start} — расписание не меняется`);
      if (b.teacher && norm(b.teacher) !== norm(p.teacher)) warnings.push(`в сообщении ведёт ${b.teacher}, на сайте ${p.teacher || '—'} — расписание не меняется`);
      if (p.status === 'cancelled') warnings.push('на сайте эта пара отменена — группа ДЗ к ней не увидит');
      // постоянная пометка пары («Сменка») уже есть на сайте — не дублируем
      const text = content.map(textOf).filter((l) => l && norm(l) !== norm(p.note));
      const allLinks = [...new Set(content.flatMap(linksOf))];
      let links = allLinks.filter((u) => u.length <= LIMITS.link);
      if (links.length < allLinks.length) warnings.push('ссылка длиннее 500 знаков пропущена');
      if (links.length > LIMITS.links) { links = links.slice(0, LIMITS.links); warnings.push('ссылок больше 10 — записаны первые 10'); }
      // у «занятия» шаблона (физкультура) строки под парой — пометки дня, как пишут активисты
      if (p.type === 'other' && p.kind === 'template') {
        text.forEach((t) => addNote(d.date, t, warnings));
        if (!links.length) continue;
      }
      let hw = p.type === 'other' && p.kind === 'template' ? '' : text.join('\n');
      if (hw.length > LIMITS.hw) { hw = cut(hw, LIMITS.hw); warnings.push('подпись длиннее 5000 знаков — обрезана'); }
      if (!hw && !links.length) continue;
      const status = !p.hw && !p.links.length ? 'new' : (p.hw.trim() === hw.trim() || !hw) && sameLinks(p.links, links.length ? links : p.links) ? 'same' : 'differs';
      byKey.set(`${d.date}|${p.id}`, { date: d.date, pair: p, hw, links, status, warnings }); // повтор дня — побеждает последнее
    }
    for (const t of d.notes || []) addNote(d.date, t);
  }
  const items = [...byKey.values()];
  for (const n of notes) n.status = (data.dayNotes || []).some((x) => x.date === n.date && norm(x.text) === norm(n.text)) ? 'same' : 'new';
  return { items, notes, unassigned };
}

/**
 * Новое значение ДЗ пары по выбору «оставить / заменить / объединить». null — ничего не менять.
 * «Заменить» без текста в сообщении меняет только ссылки (подпись на сайте не стирается).
 */
export function mergedPatch(item, choice) {
  const p = item.pair;
  if (item.status === 'same') return null;
  if (item.status === 'new' || choice === 'replace') return { hw: item.hw || (item.status === 'new' ? '' : p.hw), links: item.links.slice(0, LIMITS.links) };
  if (choice !== 'merge') return null;
  const hw = !item.hw || p.hw.includes(item.hw) ? p.hw : p.hw ? `${p.hw}\n${item.hw}` : item.hw;
  return { hw: cut(hw, LIMITS.hw), links: [...new Set([...p.links, ...item.links])].slice(0, LIMITS.links) };
}
