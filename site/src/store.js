// Локальная модель редактора. Правка сразу применяется к данным на экране и кладётся
// в очередь; очередь хранится в телефоне и отправляется, когда есть сеть.

const QUEUE_KEY = 'raspisanie-322:queue:v1';
const sameEntry = (a, b) => a.type === 'entry' && b.type === 'entry' && a.date === b.date && a.pairId === b.pairId;
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

/** Обратная операция — для кнопки «Отменить». Считать ДО применения правки. */
export function inverseOf(data, op) {
  if (op.type === 'note.add') return { type: 'note.remove', date: op.date, text: op.text };
  if (op.type === 'note.remove') return { type: 'note.add', date: op.date, text: op.text };
  const e = findEntry(data, op.date, op.pairId) || {};
  const defaults = { hw: '', links: [], noHw: false };
  const patch = {};
  for (const k of Object.keys(op.patch)) patch[k] = clone(k in e ? e[k] : defaults[k]);
  return { type: 'entry', date: op.date, pairId: op.pairId, patch };
}

/** Очередь отправки. Правки одной пары, ещё не ушедшие на сервер, сливаются в одну. */
export function createQueue(storage) {
  let items = [];
  try { items = JSON.parse(storage.getItem(QUEUE_KEY)) || []; } catch { items = []; }
  items.forEach((i) => { i.inFlight = false; }); // после перезагрузки всё неотправленное — снова в очереди
  const persist = () => { try { storage.setItem(QUEUE_KEY, JSON.stringify(items)); } catch { /* нет места — живём в памяти */ } };
  return {
    list: () => items.slice(),
    size: () => items.length,
    add(op) {
      const pending = items.find((i) => !i.inFlight && sameEntry(i, op));
      if (pending) Object.assign(pending.patch, clone(op.patch));
      else items.push({ ...clone(op), inFlight: false });
      persist();
    },
    takeBatch(max = 20) {
      const batch = items.filter((i) => !i.inFlight).slice(0, max);
      batch.forEach((i) => { i.inFlight = true; });
      persist();
      return batch.map(({ inFlight, ...op }) => op);
    },
    release(opIds) { items.forEach((i) => { if (opIds.includes(i.opId)) i.inFlight = false; }); persist(); },
    remove(opId) { items = items.filter((i) => i.opId !== opId); persist(); },
    rebase(op, version) { items.forEach((i) => { if (sameEntry(i, op) && !i.inFlight) i.baseVersion = version; }); persist(); },
  };
}

/** Обработка успешного ответа сервера на одну операцию. */
export function applyResult(data, queue, op, result) {
  queue.remove(op.opId);
  if (op.type !== 'entry' || !result.entry) return;
  queue.rebase(op, result.version);
  const waiting = queue.list().some((i) => sameEntry(i, op));
  const e = findEntry(data, op.date, op.pairId);
  if (!e) { data.entries.push(clone(result.entry)); return; }
  if (waiting) e.version = result.version;      // на экране уже более свежая правка — её не трогаем
  else Object.assign(e, clone(result.entry));   // иначе берём то, что записал сервер (кто, когда, версия)
}
