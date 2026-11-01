// Блок ДЗ (карточка пары и мастер): «как в прошлый раз», подпись с частыми фразами, ссылки с проверкой темы.
import { dayMonth, shortLink } from '../format.js';
import { h, fullName, safeLink } from '../dom.js';
import { splitPaste, learnTopics, linkInfo, previousHomework, frequentPhrases } from '../helpers.js';
import { S } from './state.js';
import { toast, dayLabel, findPair, renderSheet, TX, flushText } from './ui.js';
import { commit, pairOp } from './sync.js';

// «Выученные» темы считаются один раз на загрузку недели
let learnedFor = null, learned = { groupChat: null, topics: {} };
function topics() { if (learnedFor !== S.data) { learned = learnTopics(S.data); learnedFor = S.data; } return learned; }
const keptLinks = new Set(); // ссылки, про которые активист сказал «всё верно, оставить»

export function hwBlock(p) {
  const wrap = h('div', { class: 'stack', style: 'gap:12px' });
  const save = (patch, label, opts) => { flushText(); commit(pairOp(p, patch), label, opts); };

  // «Как в прошлый раз»: прошлое занятие того же предмета и типа
  const prev = previousHomework(S.data, p.date, p.subject, p.type);
  const same = prev && prev.hw === p.hw && JSON.stringify(prev.links) === JSON.stringify(p.links);
  if (prev && !same) {
    wrap.append(h('div', { class: 'prev' },
      h('div', { class: 'caps muted', text: `Прошлое занятие · ${dayLabel(prev.date)}` }),
      prev.hw ? h('div', { style: 'white-space:pre-wrap', text: prev.hw }) : null,
      prev.links.map((u) => h('div', { class: 'u', text: shortLink(u) })),
      h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'as-before', onclick: () => save({ hw: prev.hw, links: [...prev.links] }, 'Как ' + dayMonth(prev.date)), text: 'Как в прошлый раз' })));
  }

  // подпись + частые фразы
  const ta = h('textarea', { class: 'input', id: 'hw', name: 'hw', maxlength: '5000', placeholder: 'например: Доклады' });
  ta.value = p.hw;
  const counter = h('div', { class: 'xs muted', style: 'text-align:right' });
  const upd = () => { counter.textContent = ta.value.length > 4000 ? `${ta.value.length} / 5000` : ''; };
  upd();
  ta.addEventListener('input', () => {
    upd(); clearTimeout(TX.timer);
    const value = ta.value;
    TX.pending = () => commit(pairOp(p, { hw: value }), 'ДЗ сохранено', { rerenderSheet: false });
    TX.timer = setTimeout(flushText, 1000);
  });
  ta.addEventListener('blur', flushText);
  const phrases = frequentPhrases(S.data, p.subject).filter((x) => x !== p.hw);
  wrap.append(h('div', {}, h('label', { class: 'lbl', for: 'hw', text: 'Подпись к ДЗ' }),
    phrases.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Частые подписи', style: 'margin-bottom:8px' }, phrases.map((ph) =>
      h('button', { type: 'button', class: 'chip', onclick: () => {
        const cur = (TX.pending ? ta.value : findPair(p.date, p.id).hw).trim();
        const next = cur ? cur + '\n' + ph : ph;
        if (next.length > 5000) { toast('Подпись уже почти 5000 знаков — фраза не поместится'); return; }
        save({ hw: next }, 'Добавлено: ' + ph);
      }, text: ph }))) : null,
    ta, counter));

  // ссылки: метка темы у каждой, предупреждение о чужой теме
  const learnedTopics = topics();
  const list = h('ul', { class: 'links' }, p.links.map((u, i) => {
    const info = linkInfo(u, p.subject, learnedTopics);
    return h('li', {}, safeLink(u), h('span', { class: 'pill' + (info.kind === 'warn' && !keptLinks.has(u) ? ' warn' : ''), text: info.label }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Удалить ссылку ' + u, onclick: () => save({ links: p.links.filter((_, j) => j !== i) }, 'Ссылка удалена'), text: '✕' }));
  }));
  const warnings = p.links.map((u) => ({ u, info: linkInfo(u, p.subject, learnedTopics) })).filter((x) => x.info.kind === 'warn' && !keptLinks.has(x.u));
  const linkErr = h('div', { class: 'err', id: 'link-err', role: 'alert' });
  const linkInput = h('input', { class: 'input', id: 'link', name: 'link', type: 'url', inputmode: 'url', placeholder: 'или вставьте сюда долгим нажатием', 'aria-describedby': 'link-err' });

  /** Добавить всё, что вставили: ссылки — в список, остальной текст — в подпись. */
  const addFromText = (text) => {
    const { links, rest } = splitPaste(text);
    if (!links.length) {
      linkErr.textContent = 'В тексте нет ссылки. В Telegram нажмите на сообщение → «Копировать ссылку» и вставьте ещё раз.';
      linkInput.setAttribute('aria-invalid', 'true'); return;
    }
    const long = links.find((u) => u.length > 500);
    if (long) { linkErr.textContent = 'Ссылка длиннее 500 знаков. Скопируйте короткую ссылку на сообщение в Telegram.'; return; }
    const cur = findPair(p.date, p.id);
    const merged = [...cur.links, ...links.filter((u) => !cur.links.includes(u))];
    if (merged.length > 10) { linkErr.textContent = 'Не больше 10 ссылок на пару.'; return; }
    const patch = { links: merged };
    if (rest) {
      const hw = (TX.pending ? ta.value : cur.hw).trim();
      patch.hw = hw ? hw + '\n' + rest : rest;
      if (patch.hw.length > 5000) { linkErr.textContent = 'Вместе с вставленным текстом подпись длиннее 5000 знаков. Сократите её или вставьте только ссылку.'; return; }
    }
    save(patch, links.length > 1 ? `Добавлено ссылок: ${links.length}` : 'Ссылка добавлена');
  };
  linkInput.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) { e.preventDefault(); addFromText(text); }
  });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromText(linkInput.value); } });

  const pasteBtn = h('button', { type: 'button', class: 'btn btn-secondary w100', id: 'paste-link', text: 'Вставить ссылку', onclick: async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('пусто');
      addFromText(text);
    } catch {
      linkErr.textContent = 'Телефон не дал прочитать буфер. Вставьте ссылку в поле ниже долгим нажатием.';
      linkInput.focus();
    }
  } });

  wrap.append(h('div', { class: 'stack', style: 'gap:8px' }, h('label', { class: 'lbl', for: 'link', style: 'margin:0', text: 'Ссылки' }), list,
    warnings.map((w) => h('div', { class: 'banner', style: 'display:flex;flex-direction:column;gap:8px' },
      h('span', { text: `Ссылка из темы «${w.info.topicSubject}», а пара — ${fullName(p.subject, S.data.subjects)}. Всё верно?` }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { keptLinks.add(w.u); renderSheet(); }, text: 'Да, оставить' }),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: () => save({ links: findPair(p.date, p.id).links.filter((x) => x !== w.u) }, 'Ссылка удалена'), text: 'Удалить' })))),
    pasteBtn,
    h('div', { style: 'display:flex;gap:8px' }, linkInput, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => addFromText(linkInput.value), text: 'Добавить' })),
    linkErr));
  return wrap;
}
