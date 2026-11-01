// Вход по личному коду активиста.
import { h } from '../dom.js';
import { postRequest } from '../editor-api.js';
import { API_URL } from '../config.js';
import { $, S, rememberCode, hooks } from './state.js';

export async function tryLogin(code) {
  const res = await postRequest(API_URL, { action: 'login', code });
  if (!res.ok) return { error: res.message || 'Код не подошёл.', kind: res.error };
  return { name: res.name };
}

export function renderLogin(message = '') {
  $('top').replaceChildren(); $('bar').hidden = true; document.body.classList.remove('has-bar');
  const input = h('input', { class: 'input mono', id: 'code', name: 'code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: 'например, 123456', 'aria-describedby': 'code-err', style: 'font-size:1.4rem;letter-spacing:.3em;text-align:center' });
  const err = h('div', { class: 'err', id: 'code-err', role: 'alert', text: message });
  const remember = h('input', { type: 'checkbox', id: 'remember', name: 'remember', checked: true });
  const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-big w100', text: 'Войти' });
  const form = h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) { err.textContent = 'Код — это 6 цифр.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Проверяю…'; err.textContent = '';
      try {
        const r = await tryLogin(code);
        if (r.error) { err.textContent = r.error; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        S.code = code; S.name = r.name; rememberCode(code, remember.checked);
        hooks.start();
      } catch {
        err.textContent = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
      } finally { btn.disabled = false; btn.textContent = 'Войти'; }
    },
  },
  h('div', {}, h('label', { class: 'lbl', for: 'code', text: 'Код доступа' }), input, err),
  h('label', { class: 'check' }, remember, 'Запомнить на этом телефоне'), btn);
  $('app').replaceChildren(h('div', { class: 'stack', style: 'padding-top:32px' },
    h('div', {}, h('div', { class: 'caps muted', text: 'Группа 322' }),
      h('h1', { class: 'display', style: 'font-size:2rem;line-height:1.05;margin-top:8px', text: 'Для активистов' }),
      h('p', { class: 'muted', style: 'margin:8px 0 0', text: 'Расписание уже собрано по шаблону. Останется вписать ДЗ и пометки.' })),
    h('div', { style: 'background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:20px' }, form),
    h('p', { class: 'small muted', style: 'margin:0', text: 'Нет кода? Напишите Еремею.' })));
  input.focus();
}
