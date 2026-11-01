// Неделя: шапка с днями, плашка «Заполнить», дни и пары, нижняя панель, «Выйти».
import { buildDay, studyDates, addDays, weekday } from '../schedule.js';
import { dayMonth, longDay, weekRange, shortTime, WEEKDAYS_SHORT } from '../format.js';
import { h, icons, halfLabel, tile, fullName } from '../dom.js';
import { $, S, TYPE, nowMsk, forgetCode } from './state.js';
import { closeDialog, queueDialog, isActive, hasHw, isDone, weekSeminars, renderSheet, SH } from './ui.js';
import { retryNow } from './sync.js';
import { renderLogin } from './login.js';
import { openPair } from './pair.js';
import { openAddPair } from './move.js';
import { openNotes } from './notes.js';
import { openWizard } from './wizard.js';
import { openTelegram } from './telegram-sheet.js';
import { startCoach, endCoach, markCoachTarget, coachOn } from './coach.js';

function renderTop() {
  const days = studyDates(S.monday, S.data).map((d) => buildDay(d, S.data));
  const today = nowMsk().date;
  const moveWeek = (n) => { S.monday = addDays(S.monday, n); render(); window.scrollTo(0, 0); };
  $('top').replaceChildren(h('div', { class: 'top' }, h('div', { class: 'wrap' },
    h('div', { class: 'weekline' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущая неделя', onclick: () => moveWeek(-7) }, icons.prev()),
      h('div', { class: 't' }, h('h1', { class: 'display', text: weekRange(S.monday) }), h('div', { class: 'xs muted' }, halfLabel(days[0].half))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующая неделя', onclick: () => moveWeek(7) }, icons.next())),
    h('nav', { class: 'days', 'aria-label': 'Дни недели' }, days.map((d) => {
      const sems = d.pairs.filter((p) => p.type === 'seminar' && isActive(p));
      const dot = !sems.length ? 'none' : sems.every(isDone) ? 'full' : '';
      return h('button', {
        type: 'button', disabled: !d.pairs.length, 'aria-current': d.date === today ? 'date' : null,
        'aria-label': longDay(d.date) + (sems.length ? (dot === 'full' ? ', всё заполнено' : ', есть семинары без ДЗ') : ''),
        onclick: () => { const el = $('day-' + d.date); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); },
      }, h('span', { class: 'd', text: WEEKDAYS_SHORT[weekday(d.date)].toUpperCase() }), h('span', { class: 'n', text: Number(d.date.slice(8)) }), h('span', { class: 'dot ' + dot }));
    })))));
}

function pairRow(p) {
  const active = isActive(p);
  const st = h('span', { class: 'st' });
  if (active) {
    if (p.type === 'seminar') st.append(hasHw(p) ? h('span', { class: 'ok', text: 'ДЗ ✓' }) : p.noHw ? h('span', { class: 'muted', text: 'ДЗ нет' }) : h('span', { class: 'need', text: 'нет ДЗ' }));
    else if (hasHw(p)) st.append(h('span', { class: 'ok', text: 'ДЗ ✓' }));
  }
  const label = `${p.numbers.length ? p.numbers.join(' и ') + ' пара, ' : ''}${shortTime(p.start)}, ${fullName(p.subject, S.data.subjects)}, ${TYPE[p.type] || ''}, аудитория ${p.room}`
    + (p.status === 'cancelled' ? ', отменена' : '') + (p.status === 'moved-away' ? ', перенесена' : '');
  const row = h('button', { type: 'button', class: 'prow' + (active ? '' : ' dim'), onclick: (e) => openPair(p.date, p.id, e.currentTarget), 'aria-label': label },
    h('span', { class: 'tm' }, shortTime(p.start), h('span', { text: shortTime(p.end) })), tile(p.subject, S.data.subjects),
    h('span', { class: 'mid' }, h('span', { class: 'subj', text: fullName(p.subject, S.data.subjects) }),
      h('span', { class: 'meta' }, h('span', {}, 'ауд. ', h('span', { class: 'room' + (p.changed.room || p.ruledFrom.room ? ' chg' : ''), text: p.room })), h('span', { text: TYPE[p.type] || '' }),
        p.status === 'moved-here' ? h('span', { class: 'pill', text: 'перенос с ' + dayMonth(p.movedFrom) }) : null,
        p.status === 'extra' ? h('span', { class: 'pill', text: 'доп. пара' }) : null,
        p.changed.start || p.changed.teacher ? h('span', { class: 'pill', text: 'изменено' }) : null)),
    active ? st : null);
  if (p.status === 'moved-away') row.append(h('span', { class: 'stamp move', 'aria-hidden': 'true', text: 'Перенесено' }));
  if (p.status === 'cancelled') row.append(h('span', { class: 'stamp cancel', 'aria-hidden': 'true', text: 'Отменено' }));
  return row;
}

function renderEditor() {
  renderTop();
  const days = studyDates(S.monday, S.data).map((d) => buildDay(d, S.data));
  const sems = weekSeminars(); const done = sems.filter(isDone).length; const allDone = sems.length > 0 && done === sems.length;
  const out = [h('div', { class: 'userline' }, h('span', { class: 'small muted', text: S.name }),
    h('a', { class: 'btn btn-ghost', href: './', text: 'Как видит группа' }),
    h('button', { type: 'button', class: 'icon-btn', id: 'hints', 'aria-label': 'Подсказки', title: 'Подсказки', onclick: startCoach, text: '?' }),
    h('button', { type: 'button', class: 'btn btn-ghost', id: 'logout', onclick: logout, text: 'Выйти' }))];
  if (sems.length) {
    out.push(h('section', { class: 'fill' + (allDone ? ' done' : ''), 'aria-label': 'Заполнение ДЗ' },
      h('div', {}, h('h2', { text: allDone ? 'Все семинары заполнены' : `ДЗ: ${done} из ${sems.length} семинаров` }),
        h('div', { class: 'small', style: 'opacity:.85', text: allDone ? 'Осталось скопировать текст в Telegram.' : 'Пройдём по семинарам по очереди — около минуты.' })),
      allDone
        ? h('div', { class: 'fill-acts' },
          h('button', { type: 'button', class: 'btn', id: 'fill-telegram', onclick: (e) => openTelegram(e.currentTarget, 'days'), text: 'Telegram' }),
          h('button', { type: 'button', class: 'btn btn-ghost', id: 'fill-wizard', onclick: (e) => openWizard(e.currentTarget), text: 'Проверить' }))
        : h('button', { type: 'button', class: 'btn', id: 'fill-wizard', onclick: (e) => openWizard(e.currentTarget), text: 'Заполнить' }),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, sems.map((p) => h('i', { class: isDone(p) ? 'on' : '' })))));
  } else {
    out.push(h('div', { class: 'empty' }, h('b', { text: 'На этой неделе семинаров нет' }), h('span', { class: 'muted', text: 'Можно добавить пометки дня.' })));
  }
  for (const d of days) {
    const box = h('section', { class: 'day', id: 'day-' + d.date, 'aria-label': longDay(d.date) });
    const active = d.pairs.filter(isActive);
    box.append(h('div', { class: 'day-head' }, h('span', { class: 'dn', text: WEEKDAYS_SHORT[weekday(d.date)].toUpperCase() }),
      h('span', { class: 'dd' }, h('b', { text: dayMonth(d.date) }),
        h('span', { class: 'xs muted mono', text: active.length ? `${shortTime(active[0].start)}–${shortTime(active[active.length - 1].end)}` : 'пар нет' })),
      h('span', { class: 'day-acts' },
        h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Дополнительная пара: ' + longDay(d.date), onclick: (e) => openAddPair(d.date, e.currentTarget), text: '+ пара' }),
        h('button', { type: 'button', class: 'btn btn-ghost', 'aria-label': 'Пометки дня: ' + longDay(d.date), onclick: (e) => openNotes(d.date, e.currentTarget), text: '+ пометка' }))));
    if (d.notes.length) box.append(h('div', { class: 'notes' }, d.notes.map((n) => h('button', { type: 'button', class: 'note-btn', onclick: (e) => openNotes(d.date, e.currentTarget), text: n }))));
    if (!d.pairs.length) box.append(h('p', { class: 'small muted', style: 'padding:0 16px 14px;margin:0', text: 'По шаблону пар нет.' }));
    const quiet = d.pairs.filter((p) => p.type === 'lecture' && isActive(p) && !hasHw(p) && p.kind === 'template' && !Object.keys(p.changed).length);
    const fold = quiet.length >= 2 && !S.openLectures[d.date];
    for (const p of d.pairs) { if (fold && quiet.includes(p)) continue; box.append(pairRow(p)); }
    if (fold) {
      box.append(h('button', { type: 'button', class: 'lect', 'aria-expanded': 'false', onclick: () => { S.openLectures[d.date] = true; render(); },
        text: `+ ${quiet.length} лекции без изменений: ${quiet.map((p) => p.subject).join(', ')}` }));
    }
    out.push(box);
  }
  $('app').replaceChildren(h('div', { class: 'stack' }, out));
}

export function renderBar() {
  const bar = $('bar');
  if (!S.name || !S.data) { bar.hidden = true; return; }
  bar.hidden = false; document.body.classList.add('has-bar');
  const n = S.queue.size();
  const [cls, text] = {
    idle: ['idle', 'Все изменения сохранены'],
    saving: ['saving', 'Сохраняю…'],
    saved: ['saved', 'Сохранено'],
    offline: ['offline', `Нет связи — изменений на телефоне: ${n}. Отправлю, когда появится сеть`],
    error: ['error', 'Не сохранилось. Повторю автоматически'],
  }[S.status];
  bar.replaceChildren(h('div', { class: 'inner' }, h('div', { class: 'save ' + cls, role: 'status', text }),
    S.status === 'error' || S.status === 'offline' ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => retryNow(), text: 'Повторить' }) : null,
    h('button', { type: 'button', class: 'btn btn-primary', id: 'bar-telegram', onclick: (e) => openTelegram(e.currentTarget), text: 'Telegram' })));
}

/**
 * Выход с телефона. Неотправленные правки принадлежат тому, кто их сделал: если выйти,
 * они не должны уйти под кодом следующего человека — поэтому предупреждаем и удаляем их.
 */
function logout() {
  const done = () => { endCoach(false); S.queue.clear(); forgetCode(); S.code = null; S.name = null; S.status = 'idle'; renderLogin(); };
  const n = S.queue.size();
  if (!n) { done(); return; }
  queueDialog(() => {
    $('dialog').replaceChildren(h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'lo-title', 'aria-describedby': 'lo-text' }, h('div', { class: 'box' },
      h('h2', { id: 'lo-title', text: 'Есть неотправленные правки' }),
      h('p', { id: 'lo-text', style: 'margin:0', text: `На телефоне ждут отправки изменений: ${n}. Если выйти сейчас, они будут удалены. Лучше дождаться сети и «Сохранено».` }),
      h('div', { class: 'cols' },
        h('button', { type: 'button', class: 'btn btn-primary', id: 'lo-stay', onclick: closeDialog, text: 'Остаться' }),
        h('button', { type: 'button', class: 'btn btn-danger', id: 'lo-go', onclick: () => { closeDialog(); done(); }, text: 'Выйти и удалить' })))));
    $('lo-stay').focus();
  });
}

export function render({ sheet = true } = {}) {
  if (!S.name || !S.data) return;
  renderEditor(); renderBar();
  if (coachOn()) markCoachTarget(false); // неделя перерисована — вернуть подсветку подсказки
  if (sheet && SH.build) renderSheet();
}
