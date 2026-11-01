// Подсказки первого входа (шаг 8).
import { h } from '../dom.js';
import { $, local } from './state.js';
import { SH } from './ui.js';

// Три шага поверх недели, не мешают работать: карточка внизу, нужное место подсвечено.
const HINTS_KEY = 'raspisanie-322:hints-v1';
const COACH = [
  { target: () => document.querySelector('.prow:not(.dim)'), title: 'Нажмите на пару',
    text: 'Откроется карточка: подпись к ДЗ и ссылки, а ниже — изменения в этот день (аудитория, время, перенос, отмена).' },
  { target: () => $('fill-wizard'), title: 'Вставьте ссылку',
    text: '«Заполнить» проведёт по всем семинарам недели. В Telegram: сообщение → «Копировать ссылку», здесь — кнопка «Вставить ссылку». Тема проверится сама.' },
  { target: () => $('bar-telegram'), title: 'Скопируйте текст для Telegram',
    text: 'Когда неделя готова — кнопка «Telegram»: тексты по дням в привычном оформлении, по одному нажатию на день.' },
];
let coachStep = -1;
export function hintsSeen() { try { return !local || local.getItem(HINTS_KEY) === '1'; } catch { return true; } }
/** Шаг без цели на экране (неделя без пар или без семинаров) пропускаем — не подсвечиваем пустоту. */
function coachAvailable(i) { return !!(COACH[i] && COACH[i].target()); }
export function markCoachTarget(scroll) {
  document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
  const step = COACH[coachStep];
  const t = step && step.target();
  if (!t) return;
  t.classList.add('coach-target');
  if (scroll) t.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
export function startCoach() { coachStep = 0; showCoach(); }
// Escape закрывает подсказки (если не открыт нижний лист — тогда Escape закрывает его)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && coachStep >= 0 && !SH.build) endCoach(); });
export function endCoach(remember = true) {
  coachStep = -1;
  if (remember) { try { if (local) local.setItem(HINTS_KEY, '1'); } catch { /* приватный режим */ } }
  document.querySelectorAll('.coach-target').forEach((e) => e.classList.remove('coach-target'));
  const c = $('coach'); if (c) c.remove();
  document.body.style.paddingBottom = '';
}
function showCoach() {
  while (coachStep < COACH.length && !coachAvailable(coachStep)) coachStep += 1;
  const step = COACH[coachStep];
  if (!step) { endCoach(); return; }
  markCoachTarget(true);
  let c = $('coach');
  if (!c) { c = h('div', { class: 'coach', id: 'coach', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'coach-title', 'aria-describedby': 'coach-text' }); document.body.append(c); }
  const rest = COACH.map((_, i) => i).filter((i) => coachAvailable(i));
  const last = coachStep === rest[rest.length - 1];
  c.replaceChildren(
    h('div', { class: 'xs muted', text: `Подсказка ${rest.indexOf(coachStep) + 1} из ${rest.length}` }),
    h('b', { id: 'coach-title', text: step.title }),
    h('p', { class: 'small', id: 'coach-text', style: 'margin:0', text: step.text }),
    h('div', { class: 'row', style: 'justify-content:flex-end' },
      last ? null : h('button', { type: 'button', class: 'btn btn-ghost', id: 'coach-skip', onclick: () => endCoach(), text: 'Пропустить' }),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'coach-next', onclick: () => { coachStep += 1; showCoach(); }, text: last ? 'Понятно' : 'Дальше' })));
  c.querySelector('#coach-next').focus({ preventScroll: true });
  // низ недели не должен навсегда прятаться под карточкой: добавляем место под её высоту
  document.body.style.paddingBottom = `${c.offsetHeight + 110}px`;
}

/** Подсказки сейчас на экране — неделю перерисовали, нужно вернуть подсветку. */
export const coachOn = () => coachStep >= 0;
