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
export function copyForNewVersion(data, from) {
  const base = versionAt(data, from);
  const pairs = base.pairs.map((t) => ({ ...t }));
  const baked = [], limited = [];
  for (const r of data.rules || []) {
    const t = pairs.find((x) => x.id === r.pairId);
    if (!t || !FIELDS.includes(r.field) || !ruleInVersion(data, base, r)) continue;
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
