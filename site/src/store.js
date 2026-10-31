// Локальная модель редактора. Правка сразу применяется к данным на экране и кладётся
// в очередь; очередь хранится в телефоне и отправляется, когда есть сеть.
//
// Важные правила очереди (найдены при проверке шага 4):
// • операция, которую хоть раз отправляли (sent), больше НЕ меняется — сервер мог её уже
//   применить и запомнить под этим номером; новая правка встаёт отдельной операцией за ней;
// • в одну отправку берётся не больше одной операции на пару — иначе вторая конфликтует с первой;
// • после ответа сервера ожидающие операции этой пары получают свежую версию (rebase).

const QUEUE_KEY = 'raspisanie-322:queue:v1';
const sameEntry = (a, b) => a.type === 'entry' && b.type === 'entry' && a.date === b.date && a.pairId === b.pairId;
const entryKey = (op) => (op.type === 'entry' ? `${op.date}|${op.pairId}` : null);
const clone = (x) => JSON.parse(JSON.stringify(x));

function findEntry(data, date, pairId) {
  return data.entries.find((e) => e.date === date && e.pairId === pairId) || null;
}

/** Применяет операцию к данным на экране (как сервер, но без проверки версий). */
export function applyOp(data, op, meta = {}) {
  if (op.type === 'entry') {
    let e = findEntry(data, op.date, op.pairId);
    if (!e) { e = { date: op.date, pairId: op.pairId, links: [], version: 0 }; data.entries.push(e); }
    Object.assign(e, clone(op.patch));
    if (e.hw || (e.links && e.links.length)) e.noHw = false;
    if (meta.name) { e.by = meta.name; e.updatedAt = new Date().toISOString(); }
  } else if (op.type === 'note.add') {
    if (!data.dayNotes.some((n) => n.date === op.date && n.text === op.text)) data.dayNotes.push({ date: op.date, text: op.text });
  } else if (op.type === 'note.remove') {
    data.dayNotes = data.dayNotes.filter((n) => !(n.date === op.date && n.text === op.text));
  }
  return data;
}

/**
 * Обратная операция — для кнопки «Отменить». Считать ДО применения правки.
 * null — отменять нечего (например, добавили пометку, которая уже была).
 */
export function inverseOf(data, op) {
  if (op.type === 'note.add') {
    return data.dayNotes.some((n) => n.date === op.date && n.text === op.text) ? null : { type: 'note.remove', date: op.date, text: op.text };
  }
  if (op.type === 'note.remove') {
    return data.dayNotes.some((n) => n.date === op.date && n.text === op.text) ? { type: 'note.add', date: op.date, text: op.text } : null;
  }
  const e = findEntry(data, op.date, op.pairId) || {};
  const defaults = { hw: '', links: [], noHw: false };
  const keys = new Set(Object.keys(op.patch));
  if (keys.has('hw') || keys.has('links')) keys.add('noHw'); // ДЗ снимает отметку «ДЗ нет» — отмена должна её вернуть
  const patch = {};
  for (const k of keys) patch[k] = clone(k in e ? e[k] : defaults[k]);
  return { type: 'entry', date: op.date, pairId: op.pairId, patch };
}

/** Очередь отправки. Хранится в телефоне; несколько вкладок не затирают операции друг друга. */
export function createQueue(storage) {
  const removed = new Set(); // номера операций, которые эта вкладка уже убрала из очереди
  const load = () => {
    try { return JSON.parse(storage.getItem(QUEUE_KEY)) || []; } catch { return []; }
  };
  let items = load().map((i) => ({ ...i, inFlight: false })); // после перезагрузки — снова в очереди (sent сохраняется)

  /** Перед записью подмешиваем операции, добавленные другой вкладкой. */
  const persist = () => {
    try {
      const known = new Set(items.map((i) => i.opId));
      const foreign = load().filter((i) => !known.has(i.opId) && !removed.has(i.opId));
      items = [...items, ...foreign.map((i) => ({ ...i, inFlight: false }))];
      storage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch { /* нет места или хранилище запрещено — живём в памяти */ }
  };

  return {
    list: () => items.map(({ inFlight, ...op }) => clone(op)),
    size: () => items.length,
    has: (pred) => items.some(pred),

    /** Добавить правку. Сливается только с неотправленной операцией той же пары. */
    add(op) {
      const pending = op.type === 'entry' && items.find((i) => !i.sent && !i.inFlight && sameEntry(i, op));
      if (pending) Object.assign(pending.patch, clone(op.patch));
      else items.push({ ...clone(op), sent: false, inFlight: false });
      persist();
    },

    /** Взять пачку для отправки: не больше одной операции на пару, по порядку. */
    takeBatch(max = 20) {
      const busy = new Set(items.filter((i) => i.inFlight).map(entryKey).filter(Boolean));
      const batch = [];
      for (const i of items) {
        if (batch.length >= max) break;
        if (i.inFlight) continue;
        const key = entryKey(i);
        if (key && busy.has(key)) continue; // по этой паре уже есть операция в пути или в пачке
        if (key) busy.add(key);
        i.inFlight = true; i.sent = true;
        batch.push(i);
      }
      persist();
      return batch.map(({ inFlight, sent, ...op }) => clone(op));
    },

    release(opIds) { items.forEach((i) => { if (opIds.includes(i.opId)) i.inFlight = false; }); persist(); },
    remove(opId) { removed.add(opId); items = items.filter((i) => i.opId !== opId); persist(); },

    /** Убрать и вернуть все ожидающие операции пары (нужно при конфликте). */
    takePendingFor(op) {
      const out = items.filter((i) => !i.inFlight && sameEntry(i, op));
      out.forEach((i) => removed.add(i.opId));
      items = items.filter((i) => !out.includes(i));
      persist();
      return out.map(({ inFlight, sent, ...o }) => clone(o));
    },

    rebase(op, version) {
      items.forEach((i) => { if (sameEntry(i, op) && !i.inFlight) i.baseVersion = version; });
      persist();
    },
  };
}

/** Обработка успешного ответа сервера на одну операцию. */
export function applyResult(data, queue, op, result) {
  queue.remove(op.opId);
  if (op.type !== 'entry' || !result.entry) return;
  queue.rebase(op, result.version);
  const waiting = queue.has((i) => sameEntry(i, op));
  const e = findEntry(data, op.date, op.pairId);
  if (!e) { data.entries.push(clone(result.entry)); return; }
  if (waiting) e.version = result.version;      // на экране уже более свежая правка — её не трогаем
  else Object.assign(e, clone(result.entry));   // иначе берём то, что записал сервер (кто, когда, версия)
}
