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
// Расписание (аудитории, время) из сообщений не меняется — только предупреждения.
import { buildDay, addDays, weekday } from './schedule.js';

const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const DAYS = ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА'];
const URL_RE = /https?:\/\/[^\s<>"«»]+/g;

/** Текст из буфера → строки: без «вариантов эмодзи» (U+FE0F), неразрывных и невидимых пробелов. */
function lines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/[️​-‍⁠]/g, '').replace(/[   ]/g, ' ')
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim());
}
// Заголовки копии нескольких сообщений: «Имя, [27.10.2026 18:05]» (Telegram Desktop) и «[27.10.2026 18:05] Имя: текст».
// Имя нигде не сохраняется: строка-заголовок пропускается, у второго вида берётся только текст после двоеточия.
const HEADER_RE = /^[^\n[\]]{1,80}, \[\d{1,2}\.\d{1,2}\.\d{2,4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?\]$/;
const PREFIX_RE = /^\[\d{1,2}\.\d{1,2}\.\d{2,4}[ ,]+\d{1,2}:\d{2}(?::\d{2})?\] [^:]{1,80}: ?/;
const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const sup = (s) => [...s].map((c) => SUP[c] ?? c).join('');
/** «11⁴⁰-13¹⁰», «9:40–11:10», «9.40 - 11.10» → ['11:40', '13:10']. */
function timeRange(s) {
  const m = /^(\d{1,2})[:.]?(\d{2})\s*[-–—]\s*(\d{1,2})[:.]?(\d{2})$/.exec(sup(s).replace(/\s+/g, ' '));
  if (!m) return null;
  const t = (hh, mm) => `${hh.padStart(2, '0')}:${mm}`;
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
  return [t(m[1], m[2]), t(m[3], m[4])];
}
/** «1⃣пара/222 - Муниципальное право», «3⃣4⃣ пара/ 115 - ГП (лекция)», «2 пара/219- ГПП». */
function pairLine(s) {
  const m = /^((?:\d⃣)+|\d+(?:\s*[-–,и]\s*\d+)?)\s*пара\s*\/\s*([^-–—]*?)\s*[-–—]\s*(.+)$/i.exec(s);
  if (!m) return null;
  return { numbers: (m[1].match(/\d/g) || []).map(Number), room: m[2].trim(), name: m[3].trim() };
}
const isChange = (s) => /^[❗❌➡⚠]/u.test(s) || /\b(отмен[её]н|перенес[её]н|перенос с|перенесена|отменена)/i.test(s);

/**
 * Разбор одного или нескольких сообщений. monday — понедельник открытой недели (для дней без даты).
 * Возвращает { days: [{date, blocks: [{start, end, numbers, room, name, lines}], loose: [строки вне пар]}], unassigned: [{line, reason}] }.
 */
export function parseMessages(text, monday) {
  const days = [], unassigned = [];
  let day = null, block = null, pendingWeekday = null;
  const startDay = (date) => { day = { date, blocks: [], loose: [] }; days.push(day); block = null; };
  for (let raw of lines(text)) {
    if (!raw || HEADER_RE.test(raw)) continue;
    raw = raw.replace(PREFIX_RE, '');
    if (!raw) continue;
    const word = raw.replace(/[^А-ЯЁа-яё]/g, '').toUpperCase();
    const wd = DAYS.indexOf(word);
    if (wd >= 0 && raw.length <= 30) { pendingWeekday = wd; startDay(monday ? addDays(monday, (wd + 6) % 7) : null); day.fromWeekday = true; continue; }
    const dm = DATE_RE.exec(raw);
    if (dm) {
      const iso = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      if (day && day.fromWeekday && !day.blocks.length && !day.loose.length) { day.date = iso; day.fromWeekday = false; }
      else startDay(iso);
      if (pendingWeekday != null && weekday(iso) !== pendingWeekday) unassigned.push({ line: raw, reason: `дата ${raw} — не ${DAYS[pendingWeekday].toLowerCase()}; взята дата` });
      pendingWeekday = null;
      continue;
    }
    if (!day) { unassigned.push({ line: raw, reason: 'до первого дня — нет строки с днём недели или датой' }); continue; }
    const tr = timeRange(raw);
    if (tr) { block = { start: tr[0], end: tr[1], numbers: [], room: '', name: '', lines: [] }; day.blocks.push(block); continue; }
    if (isChange(raw)) { unassigned.push({ line: raw, reason: 'отмены, переносы и замены из текста не применяются — сделайте их в карточке пары', date: day.date }); continue; }
    const pl = pairLine(raw);
    if (pl) {
      if (!block || block.name) { block = { start: '', end: '', numbers: [], room: '', name: '', lines: [] }; day.blocks.push(block); }
      Object.assign(block, pl);
      continue;
    }
    if (block) block.lines.push(raw); else day.loose.push(raw);
  }
  for (const d of days) {
    if (!d.date) { unassigned.push({ line: d.blocks.map((b) => b.name).join(', ') || 'день без даты', reason: 'нет даты и не открыта неделя' }); continue; }
    for (const l of d.loose) unassigned.push({ line: l, reason: 'строка до первой пары дня', date: d.date });
  }
  return { days: days.filter((d) => d.date), unassigned };
}

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
const sameLinks = (a, b) => a.length === b.length && a.every((u) => b.includes(u));

/**
 * Что запишется: по каждой паре сообщения — пара на сайте, новое ДЗ и ссылки, что уже вписано.
 * Возвращает { items: [{date, pair, hw, links, status: 'new'|'same'|'differs', warnings}], notes: [{date, text, status}], unassigned }.
 */
export function planImport(data, parsed) {
  const items = [], notes = [], unassigned = [...parsed.unassigned];
  for (const d of parsed.days) {
    const built = buildDay(d.date, data);
    const pairs = built.pairs.filter((p) => p.status !== 'moved-away');
    const used = new Set();
    for (const b of d.blocks) {
      // пара на сайте: по времени начала, иначе по названию предмета среди ещё не занятых
      let p = b.start && pairs.find((q) => q.start === b.start && !used.has(q));
      if (!p && b.name) {
        const n = norm(b.name.replace(/\(.*\)/, ''));
        p = pairs.find((q) => !used.has(q) && n && [q.subject, q.tgName, (data.subjects && data.subjects[q.subject] || {}).full].some((x) => x && (norm(x).startsWith(n) || n.startsWith(norm(x)))));
      }
      const text = b.lines.filter((l) => !l.match(URL_RE) || l.replace(URL_RE, '').trim());
      const allLinks = [...new Set(b.lines.flatMap((l) => l.match(URL_RE) || []))];
      const links = allLinks.filter((u) => u.length <= 500).slice(0, 10);
      if (!p) {
        if (text.length || links.length) unassigned.push({ line: [`${b.start || '?'} ${b.name}`.trim(), ...b.lines].join(' · '), reason: `в этот день на сайте нет такой пары${b.start ? ' в ' + b.start : ''}`, date: d.date });
        continue;
      }
      used.add(p);
      const warnings = [];
      if (b.room && norm(b.room) !== norm(p.room)) warnings.push(`в сообщении аудитория ${b.room}, на сайте ${p.room || '—'} — расписание не меняется`);
      if (b.start && b.start !== p.start) warnings.push(`в сообщении ${b.start}, на сайте ${p.start} — расписание не меняется`);
      if (p.status === 'cancelled') warnings.push('на сайте эта пара отменена — группа ДЗ к ней не увидит');
      // постоянная пометка пары («Сменка») уже есть на сайте — не дублируем
      const own = text.map((l) => l.replace(URL_RE, '').trim()).filter((l) => l && norm(l) !== norm(p.note));
      if (p.type === 'other') { // у «занятия» (физкультура) строки под парой — пометки дня, как у активистов
        own.forEach((t) => notes.push({ date: d.date, text: t }));
        if (!links.length) continue;
      }
      let hw = p.type === 'other' ? '' : own.join('\n');
      if (hw.length > 5000) { hw = hw.slice(0, 5000); warnings.push('подпись длиннее 5000 знаков — обрезана'); }
      if (allLinks.some((u) => u.length > 500)) warnings.push('ссылка длиннее 500 знаков пропущена');
      if (!hw && !links.length) continue;
      const status = !p.hw && !p.links.length ? 'new' : (p.hw.trim() === hw.trim() || !hw) && sameLinks(p.links, links.length ? links : p.links) ? 'same' : 'differs';
      items.push({ date: d.date, pair: p, hw, links, status, warnings });
    }
  }
  for (const n of notes) n.status = (data.dayNotes || []).some((x) => x.date === n.date && norm(x.text) === norm(n.text)) ? 'same' : 'new';
  return { items, notes, unassigned };
}

/** Новое значение ДЗ пары по выбору «оставить / заменить / объединить». null — ничего не менять. */
export function mergedPatch(item, choice) {
  const p = item.pair;
  if (item.status === 'same') return null;
  if (item.status === 'new' || choice === 'replace') return { hw: item.hw, links: item.links.slice(0, 10) };
  if (choice !== 'merge') return null;
  const hw = !item.hw || p.hw.includes(item.hw) ? p.hw : p.hw ? `${p.hw}\n${item.hw}` : item.hw;
  return { hw, links: [...new Set([...p.links, ...item.links])].slice(0, 10) };
}
