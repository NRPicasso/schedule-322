// Локальная модель редактора. Правка сразу применяется к данным на экране и кладётся
// в очередь; очередь хранится в телефоне и отправляется, когда есть сеть.
//
// Важные правила очереди (найдены при проверке шага 4):
// • операция, которую хоть раз отправляли (sent), больше НЕ меняется — сервер мог её уже
//   применить и запомнить под этим номером; новая правка встаёт отдельной операцией за ней;
// • в одну отправку берётся не больше одной операции на объект (пару, доп. пару, правило);
// • после ответа сервера ожидающие операции этого объекта получают свежую версию (rebase).

const QUEUE_KEY = 'raspisanie-322:queue:v1';
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Ключ объекта, который меняет операция. null — операции не мешают друг другу. */
export function keyOf(op) {
  switch (op.type) {
    case 'entry': return `e|${op.date}|${op.pairId}`;
    case 'extra.add': return `x|${op.extra && op.extra.id}`;
    case 'extra.update': case 'extra.remove': return `x|${op.id}`;
    case 'rule.set': case 'rule.remove': return `r|${op.pairId}|${op.field}|${op.date}`;
    default: return null;
  }
}
/**
 * Все объекты, которых касается операция. Перенос кроме своей записи «занимает» исходную пару:
 * иначе новый перенос той же пары мог уйти на сервер раньше, чем удаление старого, и сервер
 * отклонил бы его как «уже перенесена» (найдено при проверке шага 6).
 */
export function keysOf(op) {
  const k = keyOf(op);
  const out = k === null ? [] : [k];
  const src = op.type === 'extra.add' ? op.extra : op.type === 'extra.remove' ? op : null;
  if (src && src.srcPairId) out.push(`s|${src.srcDate}|${src.srcPairId}`);
  return out;
}
const sameKey = (a, b) => { const k = keyOf(a); return k !== null && k === keyOf(b); };
const mergeable = (op) => op.type === 'entry' || op.type === 'extra.update'; // правки с patch можно сливать
const versioned = mergeable;

function findEntry(data, date, pairId) {
  return data.entries.find((e) => e.date === date && e.pairId === pairId) || null;
}
function findExtra(data, id) { return (data.extras || []).find((x) => x.id === id) || null; }
function findRule(data, op) {
  return (data.rules || []).find((r) => r.pairId === op.pairId && r.field === op.field && r.from === op.date) || null;
}
// кто правил, на телефоне не храним и не показываем (имена — только в таблице); время — для метки «изменено недавно»
function stamp(obj, meta) { if (meta.name) obj.updatedAt = new Date().toISOString(); }

/** Применяет операцию к данным на экране (как сервер, но без проверки версий). */
export function applyOp(data, op, meta = {}) {
  data.rules = data.rules || []; data.extras = data.extras || [];
  switch (op.type) {
    case 'entry': {
      let e = findEntry(data, op.date, op.pairId);
      if (!e) { e = { date: op.date, pairId: op.pairId, links: [], version: 0 }; data.entries.push(e); }
      Object.assign(e, clone(op.patch));
      if (e.hw || (e.links && e.links.length)) e.noHw = false;
      if (!e.cancelled) e.reason = '';
      stamp(e, meta);
      break;
    }
    case 'note.add':
      if (!data.dayNotes.some((n) => n.date === op.date && n.text === op.text)) data.dayNotes.push({ date: op.date, text: op.text });
      break;
    case 'note.remove':
      data.dayNotes = data.dayNotes.filter((n) => !(n.date === op.date && n.text === op.text));
      break;
    case 'rule.set': {
      const r = findRule(data, op);
      const next = { pairId: op.pairId, from: op.date, to: op.to || '', field: op.field, value: op.value };
      stamp(next, meta);
      if (r) Object.assign(r, next); else data.rules.push(next);
      break;
    }
    case 'rule.remove':
      data.rules = data.rules.filter((r) => !(r.pairId === op.pairId && r.field === op.field && r.from === op.date));
      break;
    case 'extra.add':
      if (!findExtra(data, op.extra.id)) { const x = { links: [], version: 0, ...clone(op.extra) }; stamp(x, meta); data.extras.push(x); }
      break;
    case 'extra.update': {
      const x = findExtra(data, op.id);
      if (x) { Object.assign(x, clone(op.patch)); if (x.hw || (x.links && x.links.length)) x.noHw = false; stamp(x, meta); }
      break;
    }
    case 'extra.remove':
      data.extras = data.extras.filter((x) => x.id !== op.id);
      break;
    default:
  }
  return data;
}

const DEFAULTS = { hw: '', links: [], noHw: false, room: '', start: '', end: '', teacher: '', cancelled: false, reason: '' };
function previousPatch(obj, patch) {
  const keys = new Set(Object.keys(patch));
  if (keys.has('hw') || keys.has('links')) keys.add('noHw');  // ДЗ снимает «ДЗ нет» — отмена должна её вернуть
  if (keys.has('cancelled')) keys.add('reason');
  const out = {};
  for (const k of keys) out[k] = clone(obj && k in obj ? obj[k] : DEFAULTS[k]);
  return out;
}

/**
 * Обратная операция — для кнопки «Отменить». Считать ДО применения правки.
 * null — отменять нечего (например, добавили пометку, которая уже была).
 */
export function inverseOf(data, op) {
  switch (op.type) {
    case 'note.add':
      return data.dayNotes.some((n) => n.date === op.date && n.text === op.text) ? null : { type: 'note.remove', date: op.date, text: op.text };
    case 'note.remove':
      return data.dayNotes.some((n) => n.date === op.date && n.text === op.text) ? { type: 'note.add', date: op.date, text: op.text } : null;
    case 'entry':
      return { type: 'entry', date: op.date, pairId: op.pairId, patch: previousPatch(findEntry(data, op.date, op.pairId), op.patch) };
    case 'rule.set': case 'rule.remove': {
      const r = findRule(data, op);
      if (r) return { type: 'rule.set', date: op.date, pairId: op.pairId, field: op.field, value: r.value, to: r.to || '' };
      return op.type === 'rule.set' ? { type: 'rule.remove', date: op.date, pairId: op.pairId, field: op.field } : null;
    }
    case 'extra.add':
      return { type: 'extra.remove', date: op.date, id: op.extra.id, ...(op.extra.srcPairId ? { srcDate: op.extra.srcDate, srcPairId: op.extra.srcPairId } : {}) };
    case 'extra.remove': {
      const x = findExtra(data, op.id);
      if (!x) return null;
      const { version, by, updatedAt, ...rest } = clone(x);
      // пустые поля не отправляем: сервер хранит у переноса пустой тип, а пустой тип он не примет
      for (const k of Object.keys(rest)) if (rest[k] === '' || rest[k] == null) delete rest[k];
      // вернуть пару — новой записью: старая на сервере уже удалена
      return { type: 'extra.add', date: x.date, extra: { ...rest, id: 'X-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) } };
    }
    case 'extra.update': {
      const x = findExtra(data, op.id);
      return x ? { type: 'extra.update', date: x.date, id: op.id, patch: previousPatch(x, op.patch) } : null;
    }
    default: return null;
  }
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
  const strip = ({ inFlight, sent, ...op }) => clone(op);

  return {
    list: () => items.map(strip),
    size: () => items.length,
    has: (pred) => items.some(pred),

    /** Добавить правку. Сливается только с неотправленной правкой того же объекта. */
    add(op) {
      const pending = mergeable(op) && items.find((i) => !i.sent && !i.inFlight && i.type === op.type && sameKey(i, op));
      if (pending) Object.assign(pending.patch, clone(op.patch));
      else items.push({ ...clone(op), sent: false, inFlight: false });
      persist();
    },

    /** Взять пачку для отправки: не больше одной операции на объект, по порядку. */
    takeBatch(max = 20) {
      const busy = new Set(items.filter((i) => i.inFlight).flatMap(keysOf));
      const batch = [];
      for (const i of items) {
        if (batch.length >= max) break;
        if (i.inFlight) continue;
        const keys = keysOf(i);
        const blocked = keys.some((k) => busy.has(k)); // по этому объекту уже есть операция в пути или в пачке
        keys.forEach((k) => busy.add(k));               // ждущая операция тоже держит очередь: порядок не нарушается
        if (blocked) continue;
        i.inFlight = true; i.sent = true;
        batch.push(i);
      }
      persist();
      return batch.map(strip);
    },

    release(opIds) { items.forEach((i) => { if (opIds.includes(i.opId)) i.inFlight = false; }); persist(); },
    remove(opId) { removed.add(opId); items = items.filter((i) => i.opId !== opId); persist(); },

    /** Очистить очередь целиком (выход с телефона: чужие правки не должны уйти под следующим кодом). */
    clear() { items.forEach((i) => removed.add(i.opId)); items = []; try { storage.setItem(QUEUE_KEY, '[]'); } catch { /* ок */ } },

    /** Убрать и вернуть все ожидающие операции объекта (нужно при конфликте). */
    takePendingFor(op) {
      const out = items.filter((i) => !i.inFlight && sameKey(i, op));
      out.forEach((i) => removed.add(i.opId));
      items = items.filter((i) => !out.includes(i));
      persist();
      return out.map(strip);
    },

    rebase(op, version) {
      items.forEach((i) => { if (versioned(i) && sameKey(i, op) && !i.inFlight) i.baseVersion = version; });
      persist();
    },
  };
}

/** Обработка успешного ответа сервера на одну операцию. */
export function applyResult(data, queue, op, result) {
  queue.remove(op.opId);
  const serverObj = result.entry || result.extra;
  if (!serverObj) return;
  queue.rebase(op, result.version);
  const waiting = queue.has((i) => sameKey(i, op));
  const local = result.entry ? findEntry(data, op.date, op.pairId) : findExtra(data, serverObj.id);
  const list = result.entry ? data.entries : (data.extras = data.extras || []);
  if (!local) {
    // объекта на экране нет: либо его ещё не было (добавляем ответ сервера), либо активист уже
    // удалил его и удаление ждёт в очереди — тогда не воскрешаем (найдено при проверке шага 6)
    if (!waiting) list.push(clone(serverObj));
    return;
  }
  if (waiting) local.version = result.version; // на экране уже более свежая правка — её не трогаем
  else Object.assign(local, clone(serverObj)); // иначе берём то, что записал сервер (кто, когда, версия)
}
