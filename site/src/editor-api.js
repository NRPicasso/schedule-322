// Запросы редактора к Apps Script. Тело — JSON как text/plain: такой запрос браузер
// отправляет сразу, без предварительного «можно ли?» (CORS preflight), который Apps Script не умеет.
const TIMEOUT_MS = 30000; // зависший запрос на плохой мобильной сети не должен блокировать очередь навсегда

export async function postRequest(url, body, fetchFn = globalThis.fetch) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function newOpId() {
  if (globalThis.crypto && crypto.randomUUID) return 'op-' + crypto.randomUUID();
  return 'op-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
