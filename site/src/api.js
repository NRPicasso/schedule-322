// Загрузка расписания из Google Apps Script с запасной копией в памяти телефона.
// Порядок: сразу показываем сохранённое (если есть) → тихо загружаем свежее → сохраняем.

const STORAGE_KEY = 'raspisanie-322:data:v1';

/** Минимальная проверка, что пришло именно расписание, а не страница ошибки. */
export function isValidPayload(d) {
  return !!d && typeof d === 'object' && !d.error && Array.isArray(d.template) && d.template.length > 0
    && !!d.settings && typeof d.settings.anchorWeek === 'string';
}

function readSaved(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return saved && isValidPayload(saved.data) ? saved : null;
  } catch { return null; } // приватный режим, битые данные — просто нет сохранённого
}
function save(storage, data, savedAt) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ savedAt, data })); } catch { /* места нет или запрещено — не страшно */ }
}

/**
 * onData(data, { source: 'cache' | 'network', savedAt }) — вызывается 1–2 раза.
 * onStatus('offline' | 'error', { savedAt }) — если свежие данные получить не удалось.
 */
export async function loadSchedule({ apiUrl, fetchFn = globalThis.fetch, storage = globalThis.localStorage, now = Date.now, onData, onStatus = () => {} }) {
  const saved = storage ? readSaved(storage) : null;
  if (saved) onData(saved.data, { source: 'cache', savedAt: saved.savedAt });
  try {
    const res = await fetchFn(apiUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!isValidPayload(data)) throw new Error(data && data.error ? data.error : 'неожиданный ответ');
    const savedAt = now();
    if (storage) save(storage, data, savedAt);
    onData(data, { source: 'network', savedAt });
  } catch (err) {
    onStatus(saved ? 'offline' : 'error', { savedAt: saved ? saved.savedAt : null, message: err.message });
  }
}
