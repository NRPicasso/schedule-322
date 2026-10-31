// Маленький помощник для построения разметки. Пользовательский текст попадает
// в страницу только через textContent — так чужой код из ДЗ не сможет выполниться (защита от XSS).
import { shortLink } from './format.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(viewBox, build) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  build(s);
  return s;
}
function path(d) {
  return svg('0 0 24 24', (s) => {
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p);
  });
}
export const icons = { prev: () => path('M15 18l-6-6 6-6'), next: () => path('M9 18l6-6-6-6') };

/** Значок половинки клетки: закрашена верхняя или нижняя половина, как в официальном расписании. */
export function halfLabel(half) {
  const icon = svg('0 0 14 14', (s) => {
    const fill = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 1, y: half === 'top' ? 1 : 7, width: 12, height: 6, fill: 'currentColor' }).forEach(([k, v]) => fill.setAttribute(k, v));
    const frame = document.createElementNS(SVG_NS, 'rect');
    Object.entries({ x: 1, y: 1, width: 12, height: 12, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }).forEach(([k, v]) => frame.setAttribute(k, v));
    s.append(fill, frame);
  });
  return h('span', { class: 'half' }, icon, half === 'top' ? 'верхняя неделя' : 'нижняя неделя');
}

/** Цветная плитка предмета («МУН», «ГПП»…). Неизвестный предмет — серая плитка с первыми буквами. */
export function tile(subject, subjects) {
  const meta = subjects[subject] || { short: subject.slice(0, 3).toUpperCase(), color: 'fk' };
  return h('span', { class: `tile t-${meta.color}`, 'aria-hidden': 'true', text: meta.short });
}
export function fullName(subject, subjects) {
  return (subjects[subject] && subjects[subject].full) || subject;
}

/** Ссылка из ДЗ: только http/https, открывается в новой вкладке без доступа к нашей странице. */
export function safeLink(url) {
  if (!/^https?:\/\//i.test(url)) return h('span', { text: url });
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: shortLink(url) });
}
