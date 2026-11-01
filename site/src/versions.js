// Версии шаблона «с даты» (v0.2). Чистые функции — проверяются тестами без браузера.
//
// Шаблон хранится версиями: у каждой своя дата начала, опорная неделя (верх/низ) и даты семестра.
// День собирается по версии, которая действует в эту дату, поэтому новая версия не меняет прошлое.
// id пары при копировании версии сохраняется — ДЗ и замены привязаны к «id пары + дата».
import { parseDate, addDays, mondayOf, weekday } from './dates.js';

const DAY_MS = 86400000;

// Данные без поля versions (старый сервер, сохранённая в телефоне копия, тесты) — одна версия
// из шаблона и настроек. Запоминаем по объекту шаблона, чтобы не собирать её на каждый день.
const legacy = new WeakMap();

/** Все версии по возрастанию даты начала. */
export function versionsOf(data) {
  if (Array.isArray(data.versions) && data.versions.length) return data.versions;
  const tpl = data.template || [];
  if (!legacy.has(tpl)) {
    const s = data.settings || {};
    legacy.set(tpl, [{
      id: 'V1', from: s.semesterStart || s.anchorWeek || '2000-01-01',
      anchorWeek: s.anchorWeek, anchorHalf: s.anchorHalf,
      semesterStart: s.semesterStart, semesterEnd: s.semesterEnd, pairs: tpl,
    }]);
  }
  return legacy.get(tpl);
}

/** Сортировка версий по дате начала (сервер и редактор держат их в этом порядке). */
export const sortVersions = (list) => list.slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

/** Версия, действующая в дату iso; до первой версии — первая (шаблон действует и вне семестра). */
export function versionAt(data, iso) {
  const list = versionsOf(data);
  let cur = list[0];
  for (const v of list) if (v.from <= iso) cur = v;
  return cur;
}
/** Индекс версии в списке (0 — первая: у неё нет нижней границы для постоянных замен). */
export const isFirstVersion = (data, v) => versionsOf(data)[0] === v;

/** Ближайшая версия, которая начинается позже даты iso (или null). */
export function nextVersionAfter(data, iso) {
  return versionsOf(data).find((v) => v.from > iso) || null;
}

/** Верхняя или нижняя неделя по опорной неделе версии. */
export function halfIn(version, iso) {
  const weeks = Math.round((parseDate(mondayOf(iso)) - parseDate(mondayOf(version.anchorWeek))) / (7 * DAY_MS));
  const same = ((weeks % 2) + 2) % 2 === 0;
  if (same) return version.anchorHalf;
  return version.anchorHalf === 'top' ? 'bottom' : 'top';
}

/**
 * Пара шаблона по id для даты iso: сначала в версии этой даты, потом в ближайшей более ранней,
 * потом в любой (пара могла исчезнуть из новой версии, а перенос с неё остался).
 */
export function pairInVersion(data, id, iso) {
  const list = versionsOf(data);
  const at = versionAt(data, iso);
  const own = at.pairs.find((t) => t.id === id);
  if (own) return own;
  const i = list.indexOf(at);
  for (let k = i - 1; k >= 0; k--) { const t = list[k].pairs.find((x) => x.id === id); if (t) return t; }
  for (let k = i + 1; k < list.length; k++) { const t = list[k].pairs.find((x) => x.id === id); if (t) return t; }
  return null;
}

/**
 * Постоянные замены этого поля пары, начинающиеся позже from (и не позже to, если задано), — их
 * снимает новая замена «с этого дня и дальше», иначе они её перекроют. Замены следующей версии
 * шаблона не трогаем: новая замена до неё всё равно не дойдёт.
 */
export function laterRules(data, pairId, field, from, to) {
  const nv = nextVersionAfter(data, from);
  return (data.rules || []).filter((r) => r.pairId === pairId && r.field === field && r.from > from
    && (!to || r.from <= to) && (!nv || r.from < nv.from));
}

/** Стоит ли пара шаблона (по описанию t из версии v) в дату iso. */
export const pairOnDate = (v, t, iso) => !!t && t.day === weekday(iso) && (t.half === 'both' || t.half === halfIn(v, iso));

/** Постоянная замена действует в версии, только если началась не раньше версии (кроме первой версии). */
export const ruleInVersion = (data, v, r) => isFirstVersion(data, v) || r.from >= v.from;

const FIELDS = ['room', 'start', 'end', 'teacher'];

/**
 * Копия версии для новой версии «с даты from»: пары те же (id сохраняются), значения бессрочных
 * постоянных замен, действующих на from, вписываются в пары. Замены с датой «по» не переносятся —
 * они возвращаются списком для предупреждения.
 */
export function copyForNewVersion(data, from, base = versionAt(data, from)) {
  const current = base === versionAt(data, from); // замены вписываем только из версии, которая действует на эту дату
  const pairs = base.pairs.map((t) => ({ ...t }));
  const baked = [], limited = [];
  for (const r of data.rules || []) {
    const t = pairs.find((x) => x.id === r.pairId);
    if (!current || !t || !FIELDS.includes(r.field) || !ruleInVersion(data, base, r)) continue;
    if (r.from > from || (r.to && r.to < from)) continue; // не действует на дату новой версии
    if (r.to) { limited.push(r); continue; }
    baked.push({ ...r, was: t[r.field] });
  }
  // правила применяются по порядку начала: более позднее сильнее
  baked.sort((a, b) => (a.from < b.from ? -1 : 1)).forEach((r) => { pairs.find((x) => x.id === r.pairId)[r.field] = r.value; });
  const half = halfIn(base, from);
  return {
    version: {
      id: 'V-' + from.replace(/-/g, ''), from,
      anchorWeek: mondayOf(from), anchorHalf: half, // половина недели продолжается как в прежней версии
      semesterStart: from, semesterEnd: base.semesterEnd && base.semesterEnd > from ? base.semesterEnd : addDays(from, 140),
      pairs,
    },
    baked, limited,
  };
}

/**
 * Что заденет сохранение версии draft: ДЗ, разовые замены, отмены, переносы и постоянные замены
 * на датах этой версии у пар, которые исчезают или больше не стоят в эту дату.
 * Возвращает:
 *  - items: [{kind: 'entry'|'move'|'rule', date, pairId, subject, what, reason: 'removed'|'moved', target}]
 *    target — дата той же недели, где пара стоит в новой версии (для «Перенести»), или null;
 *  - stronger: постоянные замены на датах версии у пар, которые остаются, — они сильнее шаблона;
 *  - notCarried: постоянные замены прежней версии, действующие на дату начала, — в новую версию не перейдут.
 */
export function templateImpact(data, draft) {
  const others = versionsOf(data).filter((v) => v.id !== draft.id);
  const next = others.find((v) => v.from > draft.from);
  const inRange = (d) => d >= draft.from && (!next || d < next.from);
  const before = (iso) => versionAt(data, iso);
  const describe = (e) => [e.hw, ...(e.links || [])].filter(Boolean).join(' ') || (e.cancelled ? 'отмена' : e.noHw ? '«ДЗ нет»' : 'разовая замена');
  const meaningful = (e) => !!(e.hw || (e.links && e.links.length) || e.noHw || e.cancelled || e.room || e.start || e.end || e.teacher);

  // как пара изменилась на эту дату: null — по-прежнему стоит; 'removed' — её нет в версии; 'moved' — в этот день её нет
  const status = (pairId, iso) => {
    const oldV = before(iso);
    const oldT = oldV.pairs.find((t) => t.id === pairId);
    if (!pairOnDate(oldV, oldT, iso)) return { skip: true }; // и сейчас в этот день не видна — ничего не меняется
    const t = draft.pairs.find((x) => x.id === pairId);
    if (!t) return { reason: 'removed', subject: oldT.subject };
    if (pairOnDate(draft, t, iso)) return { reason: null, subject: t.subject, t };
    // та же неделя, новый день пары — если в него пара стоит по новой версии
    const d = addDays(mondayOf(iso), (t.day + 6) % 7);
    const target = inRange(d) && pairOnDate(draft, t, d) ? d : null;
    return { reason: 'moved', subject: oldT.subject, target };
  };

  const items = [], stronger = [];
  for (const e of data.entries || []) {
    if (!inRange(e.date) || !meaningful(e)) continue;
    const s = status(e.pairId, e.date);
    if (s.skip || !s.reason) continue;
    items.push({ kind: 'entry', date: e.date, pairId: e.pairId, subject: s.subject, what: describe(e), reason: s.reason, target: s.target || null });
  }
  for (const x of data.extras || []) {
    if (!x.srcPairId || x.cancelled || !inRange(x.srcDate)) continue;
    const s = status(x.srcPairId, x.srcDate);
    if (s.skip || !s.reason) continue;
    items.push({ kind: 'move', date: x.srcDate, pairId: x.srcPairId, subject: s.subject, what: `перенос на ${x.date}`, reason: s.reason, target: null, extraId: x.id });
  }
  for (const r of data.rules || []) {
    if (!inRange(r.from)) continue;
    const t = draft.pairs.find((p) => p.id === r.pairId);
    const oldT = pairInVersion(data, r.pairId, r.from);
    if (!t) { items.push({ kind: 'rule', date: r.from, pairId: r.pairId, subject: oldT ? oldT.subject : '', what: `${r.field}: ${r.value}`, reason: 'removed', target: null }); continue; }
    if (t[r.field] !== r.value) stronger.push({ ...r, subject: t.subject, template: t[r.field] });
  }
  // постоянные замены прежней версии, которые ещё действуют на дату начала
  const prev = before(addDays(draft.from, -1));
  const notCarried = prev === draft || prev.id === draft.id ? [] : (data.rules || []).filter((r) =>
    ruleInVersion(data, prev, r) && r.from < draft.from && (!r.to || r.to >= draft.from) && prev.pairs.some((t) => t.id === r.pairId));

  const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { items: items.sort(order), stronger: stronger.sort((a, b) => (a.from < b.from ? -1 : 1)), notCarried };
}

// ---------- черновик версии: проверки и сравнение (экраны «Шаблон и семестр») ----------
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^20\d\d-\d\d-\d\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Ошибки пары версии: {поле: текст} (пусто — ошибок нет). Те же правила, что на сервере. */
export function pairErrors(t) {
  const e = {};
  if (!(t.subject || '').trim()) e.subject = 'Выберите предмет.';
  if (!TIME_RE.test(t.start || '') || !TIME_RE.test(t.end || '') || toMin(t.end) <= toMin(t.start)) e.time = 'Время окончания должно быть позже начала.';
  if (!(t.day >= 1 && t.day <= 6)) e.day = 'День — с понедельника по субботу.';
  if ((t.room || '').length > 30) e.room = 'Аудитория — до 30 знаков.';
  if ((t.teacher || '').length > 60) e.teacher = 'Преподаватель — до 60 знаков.';
  if ((t.tgName || '').length > 100) e.tgName = 'Название для Telegram — до 100 знаков.';
  if ((t.note || '').length > 200) e.note = 'Пометка — до 200 знаков.';
  return e;
}

/** Ошибки черновика версии целиком: {поле: текст}; today — сегодняшняя дата (по Москве). */
export function draftErrors(data, draft, today) {
  const e = {};
  if (!DATE_RE.test(draft.from || '') || draft.from <= today) e.from = 'Дата начала — не раньше завтрашнего дня.';
  else if (versionsOf(data).some((v) => v.id !== draft.id && v.from === draft.from)) e.from = 'С этой даты уже есть версия — откройте её.';
  if (!DATE_RE.test(draft.semesterStart || '') || !DATE_RE.test(draft.semesterEnd || '') || draft.semesterEnd < draft.semesterStart) e.semester = 'Конец семестра не раньше начала.';
  if (!draft.pairs.length) e.pairs = 'В версии нет ни одной пары.';
  else if (draft.pairs.length > 60) e.pairs = 'В версии не больше 60 пар.';
  const bad = draft.pairs.find((t) => Object.keys(pairErrors(t)).length);
  if (bad && !e.pairs) e.pairs = `Исправьте пару: ${WEEKDAY_NAMES[bad.day] || 'день?'}, ${bad.start || '—'} ${bad.subject || ''}`.trim();
  return e;
}
const WEEKDAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Накладывающиеся пары одного дня и одной недели (верх/низ): [{day, half, a, b}]. */
export function overlaps(pairs) {
  const out = [];
  for (let day = 1; day <= 6; day++) {
    for (const half of ['top', 'bottom']) {
      const list = pairs.filter((t) => t.day === day && (t.half === 'both' || t.half === half) && TIME_RE.test(t.start || '') && TIME_RE.test(t.end || ''))
        .sort((a, b) => toMin(a.start) - toMin(b.start));
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (toMin(b.start) < toMin(a.end) && !out.some((o) => o.day === day && o.a === a && o.b === b)) out.push({ day, half, a, b });
      }
    }
  }
  // пара «обе недели» с «обе недели» нашлась бы дважды (верх и низ) — оставляем одну запись
  return out.filter((o, i) => !(o.half === 'bottom' && o.a.half === 'both' && o.b.half === 'both' && out.some((x, j) => j < i && x.a === o.a && x.b === o.b)));
}

const DIFF_FIELDS = ['day', 'half', 'start', 'end', 'slots', 'subject', 'type', 'room', 'teacher', 'tgName', 'note'];
/** Чем черновик отличается от версии-основы: {added, removed, changed: [{t, fields: [{field, was, now}]}]}. */
export function versionDiff(basePairs, pairs) {
  const byId = new Map(basePairs.map((t) => [t.id, t]));
  const ids = new Set(pairs.map((t) => t.id));
  const changed = [];
  for (const t of pairs) {
    const b = byId.get(t.id);
    if (!b) continue;
    const fields = DIFF_FIELDS.filter((f) => (b[f] ?? '') !== (t[f] ?? '') && !(f === 'slots' && (b.slots || 1) === (t.slots || 1)))
      .map((f) => ({ field: f, was: b[f] ?? '', now: t[f] ?? '' }));
    if (fields.length) changed.push({ t, fields });
  }
  return { added: pairs.filter((t) => !byId.has(t.id)), removed: basePairs.filter((t) => !ids.has(t.id)), changed };
}

/** Удаление версии = на её даты возвращается предыдущая; для списка последствий — как «черновик». */
export function removalDraft(data, versionId) {
  const list = versionsOf(data);
  const i = list.findIndex((v) => v.id === versionId);
  const v = list[i], prev = list[i - 1] || list[0];
  return { ...prev, id: v.id, from: v.from, pairs: prev.pairs, prevFrom: prev.from };
}

/** Новый id пары: не совпадает ни с одной парой ни одной версии. */
export function newPairId(data, draftPairs = []) {
  const used = new Set([...versionsOf(data).flatMap((v) => v.pairs.map((t) => t.id)), ...draftPairs.map((t) => t.id)]);
  let id;
  do id = 'P-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); while (used.has(id));
  return id;
}
