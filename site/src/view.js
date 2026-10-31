// Экран для группы: Сегодня / Завтра / Неделя / ДЗ.
import { buildDay, weekDates, mondayOf, addDays, weekday } from './schedule.js';
import { defaultView, nextStudyDay, nowAndNext, isRecent } from './time.js';
import { WEEKDAYS, WEEKDAYS_SHORT, dayMonth, monthName, dayMonthWeekday, toDay, weekRange, shortTime, longDay } from './format.js';
import { h, icons, halfLabel, tile, fullName, safeLink } from './dom.js';

const TYPE = { lecture: 'лекция', seminar: 'семинар', other: 'занятие' };
const TABS = [['today', 'Сегодня'], ['tomorrow', 'Завтра'], ['week', 'Неделя'], ['hw', 'ДЗ']];

export function createGroupView({ top, app }) {
  const state = { data: null, now: null, nowMs: Date.now(), tab: null, weekMonday: null, notice: '' };

  function show(next) { Object.assign(state, next); render(); }

  function render() {
    if (!state.data || !state.now) return;
    const auto = defaultView(state.now, state.data);
    const tab = state.tab || auto.tab;
    renderTop(tab);
    const out = [];
    if (state.notice) out.push(h('p', { class: 'banner', role: 'status', text: state.notice }));
    if (tab === 'week') out.push(...weekScreen());
    else if (tab === 'hw') out.push(...hwScreen());
    else out.push(...dayScreen(tab));
    app.replaceChildren(h('div', { class: 'stack' }, out));
  }

  function renderTop(tab) {
    top.replaceChildren(h('div', { class: 'top' }, h('div', { class: 'wrap' },
      h('div', { class: 'brand' }, h('b', { text: 'Расписание 322' }), h('span', { class: 'xs muted', text: 'время московское' })),
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Что показать' }, TABS.map(([key, label]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === key), onclick: () => { show({ tab: key }); window.scrollTo(0, 0); }, text: label }))))));
  }

  // ---------- Сегодня / Завтра ----------
  function dayScreen(tab) {
    const { data, now } = state;
    const date = tab === 'today' ? now.date : nextStudyDay(now.date, data);
    const day = buildDay(date, data);
    const out = [h('div', { class: 'g-head' },
      h('h1', { class: 'big' }, `${WEEKDAYS_SHORT[weekday(date)].toUpperCase()} ${Number(date.slice(8))}`,
        h('small', { text: `${monthName(date)} · ${tab === 'today' ? 'сегодня' : (date === addDays(now.date, 1) ? 'завтра' : 'ближайший учебный день')}` })),
      h('div', { class: 'xs muted' }, halfLabel(day.half)))];

    if (tab === 'today') {
      const nn = nowAndNext(day, now.minutes);
      if (nn.current) {
        const total = nn.minutesLeft + nn.minutesPassed;
        out.push(h('section', { class: 'nowcard', 'aria-label': 'Идёт сейчас' },
          h('div', { class: 'row' }, h('span', { class: 'caps', text: `Идёт сейчас · ещё ${nn.minutesLeft} мин` }), h('span', { class: 'room', text: nn.current.room })),
          h('b', { text: fullName(nn.current.subject, data.subjects) }),
          h('div', { class: 'track', role: 'img', 'aria-label': `Прошло ${nn.minutesPassed} из ${total} минут` }, h('i', { style: `transform:scaleX(${nn.minutesPassed / total})` }))));
      } else if (nn.next) {
        out.push(h('section', { class: 'nowcard', 'aria-label': 'Следующая пара' },
          h('div', { class: 'row' }, h('span', { class: 'caps', text: `Следующая · через ${nn.minutesToNext} мин` }), h('span', { class: 'room', text: nn.next.room })),
          h('b', { text: `${fullName(nn.next.subject, data.subjects)} · ${shortTime(nn.next.start)}` })));
      }
    }
    if (day.notes.length) out.push(h('div', { class: 'notes' }, day.notes.map((n) => h('span', { class: 'note', text: n }))));

    if (!day.pairs.length) {
      const nd = nextStudyDay(date, data);
      const first = buildDay(nd, data).pairs.find((p) => p.numbers.length);
      out.push(emptyBox(tab === 'today' ? 'Сегодня пар нет' : 'В этот день пар нет',
        first ? `Ближайшая пара: ${dayMonthWeekday(nd)}, ${shortTime(first.start)} — ${fullName(first.subject, data.subjects)}, ауд. ${first.room}` : '',
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => show({ tab: 'week', weekMonday: mondayOf(nd) }), text: 'Показать неделю' })));
    } else {
      out.push(h('ol', { class: 'tl', 'aria-label': `Пары: ${longDay(date)}` }, day.pairs.map((p) => pairCard(p, tab === 'today' ? now.minutes : null))));
    }
    return out;
  }

  // ---------- карточка пары ----------
  function pairCard(p, minutes) {
    const { subjects } = state.data;
    const active = p.numbers.length > 0;
    const isNow = minutes != null && active && minutes >= toMin(p.start) && minutes < toMin(p.end);
    const name = fullName(p.subject, subjects);
    const card = h('li', { class: `gc${active ? '' : ' dim'}${isNow ? ' now' : ''}`, 'aria-current': isNow ? 'time' : null },
      h('span', { class: 'when mono' }, shortTime(p.start), h('span', { text: shortTime(p.end) })),
      h('div', { class: 'head' }, tile(p.subject, subjects), h('span', { class: 'name', text: name })),
      h('span', { class: 'room' }, h('small', { text: 'ауд.' }), p.room),
      h('span', { class: 'sub', text: [p.numbers.length ? `${p.numbers.join('–')} пара` : '', TYPE[p.type] || '', p.teacher].filter(Boolean).join(' · ') }));

    const info = [];
    if (p.status === 'moved-away') info.push(h('b', { text: `Перенесена на ${dayMonthWeekday(p.movedTo.date)}, ${shortTime(p.movedTo.start)}, ауд. ${p.movedTo.room}` }));
    if (p.status === 'cancelled') info.push(h('span', { class: 'reason', text: `Отменена${p.reason ? ': ' + p.reason : ''}` }));
    if (p.status === 'moved-here') info.push(h('span', { class: 'pill', text: `перенос с ${dayMonthWeekday(p.movedFrom)}` }));
    if (p.status === 'extra') info.push(h('span', { class: 'pill', text: 'дополнительная пара' }));
    if (p.changed.room) info.push(h('span', { text: `Аудитория изменена, обычно ${p.changed.room}` }));
    if (p.changed.start) info.push(h('span', { text: `Время изменено, обычно ${shortTime(p.changed.start)}` }));
    if (p.note) info.push(h('span', { class: 'muted', text: p.note }));
    if (active) {
      if (p.hw) info.push(h('span', { class: 'hw', text: p.hw }));
      p.links.forEach((u) => info.push(safeLink(u)));
      if (p.noHw && !p.hw && !p.links.length) info.push(h('span', { class: 'muted', text: 'ДЗ нет' }));
    }
    if (isRecent(p.updatedAt, state.nowMs)) info.push(h('span', { class: 'changed', text: 'изменено недавно' }));
    if (info.length) card.append(h('div', { class: 'info' }, info));
    if (p.status === 'moved-away') card.append(h('span', { class: 'stamp move', 'aria-hidden': 'true', text: 'Перенесено' }));
    if (p.status === 'cancelled') card.append(h('span', { class: 'stamp cancel', 'aria-hidden': 'true', text: 'Отменено' }));
    // для экранного диктора штамп продублирован словами
    if (!active) card.prepend(h('span', { class: 'sr-only', text: p.status === 'cancelled' ? 'Отменена. ' : 'Перенесена. ' }));
    return card;
  }

  // ---------- Неделя ----------
  function weekScreen() {
    const { data, now } = state;
    const monday = state.weekMonday || mondayOf(weekday(now.date) === 0 ? addDays(now.date, 1) : now.date);
    const out = [h('div', { class: 'weekline' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Предыдущая неделя', onclick: () => show({ weekMonday: addDays(monday, -7) }) }, icons.prev()),
      h('div', { class: 't' }, h('h1', { class: 'display', text: weekRange(monday) }), h('div', { class: 'xs muted' }, halfLabel(buildDay(monday, data).half))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Следующая неделя', onclick: () => show({ weekMonday: addDays(monday, 7) }) }, icons.next()))];
    const days = weekDates(monday).map((d) => buildDay(d, data)).filter((d) => d.pairs.length || d.notes.length);
    if (!days.length) {
      out.push(emptyBox('На этой неделе пар нет', '', h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => show({ weekMonday: addDays(monday, 7) }), text: 'Следующая неделя' })));
    }
    for (const d of days) {
      out.push(h('section', { class: 'wday stack', style: 'gap:10px' },
        h('h2', { text: `${WEEKDAYS[weekday(d.date)].toUpperCase()} · ${dayMonth(d.date)}` }),
        d.notes.length ? h('div', { class: 'notes' }, d.notes.map((n) => h('span', { class: 'note', text: n }))) : null,
        h('ol', { class: 'tl' }, d.pairs.map((p) => pairCard(p, d.date === now.date ? now.minutes : null)))));
    }
    return out;
  }

  // ---------- ДЗ ----------
  function hwScreen() {
    const { data, now } = state;
    const monday = mondayOf(weekday(now.date) === 0 ? addDays(now.date, 1) : now.date);
    const dates = [...weekDates(monday), ...weekDates(addDays(monday, 7))].filter((d) => d >= now.date);
    const groups = dates
      .map((d) => ({ d, items: buildDay(d, data).pairs.filter((p) => p.numbers.length && (p.hw || p.links.length)) }))
      .filter((g) => g.items.length);
    const out = [h('div', {}, h('h1', { class: 'display', style: 'font-size:1.6rem', text: 'Что готовить' }), h('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'ДЗ на ближайшие дни, по порядку' }))];
    if (!groups.length) out.push(emptyBox('ДЗ пока не вписано', 'Активисты обычно заполняют неделю на выходных.'));
    for (const g of groups) {
      out.push(h('section', { class: 'hwday' }, h('h2', { text: toDay(g.d) }),
        h('div', { class: 'stack', style: 'gap:8px' }, g.items.map((p) => h('div', { class: 'hwitem' }, tile(p.subject, data.subjects),
          h('div', { class: 'b' }, h('b', { text: `${fullName(p.subject, data.subjects)} · ${shortTime(p.start)}` }),
            p.hw ? h('span', { class: 'hw', text: p.hw }) : null, p.links.map(safeLink)))))));
    }
    return out;
  }

  function emptyBox(title, text, action) {
    return h('div', { class: 'empty' }, h('b', { text: title }), text ? h('span', { class: 'muted', text }) : null, action || null);
  }
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

  return { show, state };
}
