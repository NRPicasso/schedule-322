// Запросы редактора к Apps Script. Тело — JSON как text/plain: такой запрос браузер
// отправляет сразу, без предварительного «можно ли?» (CORS preflight), который Apps Script не умеет.
export async function postRequest(url, body, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

export function newOpId() {
  if (globalThis.crypto && crypto.randomUUID) return 'op-' + crypto.randomUUID();
  return 'op-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
