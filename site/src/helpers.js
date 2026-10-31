// Помощники для заполнения ДЗ. Всё «выучивается» по прошлым записям — настраивать ничего не нужно.
import { buildDay, addDays, weekday } from './schedule.js';

const URL_RE = /https?:\/\/[^\s<>"()«»]+/g;
const TRAILING = /[.,;:!?'”’]+$/;
const COMMON_PHRASES = ['Доклады', 'Задачи и доклады', 'Подготовиться к семинару'];
const LOOKBACK_DAYS = 70; // «как в прошлый раз» ищем в пределах 10 недель

/** Вставленный кусок сообщения → ссылки (без повторов) и подпись без них. */
export function splitPaste(text) {
  const links = [];
  const marked = String(text || '').replace(URL_RE, (m) => {
    const url = m.replace(TRAILING, '');
    if (!links.includes(url)) links.push(url);
    return '\u0000';
  });
  const rest = marked.split(/\r?\n/)
    .map((line) => line.replace(/[\s(]*\u0000[)\s,.;]*/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return { links, rest };
}

/** t.me/c/<чат>/<тема>/<сообщение> или t.me/c/<чат>/<сообщение>. */
export function parseTelegramLink(url) {
  const m = /^https?:\/\/t\.me\/c\/(\d+)\/(\d+)(?:\/(\d+))?/.exec(url || '');
  if (!m) return null;
  return m[3] ? { chat: m[1], topic: m[2], message: m[3] } : { chat: m[1], topic: null, message: m[2] };
}

function subjectOf(data, entry) {
  const t = data.template.find((x) => x.id === entry.pairId);
  return t ? t.subject : null;
}

/** Какая тема группы к какому предмету относится — по тому, под какими парами раньше стояли ссылки. */
export function learnTopics(data) {
  const chats = new Map();
  const votes = new Map(); // тема → Map(предмет → голоса)
  for (const e of data.entries || []) {
    const subject = subjectOf(data, e);
    for (const url of e.links || []) {
      const t = parseTelegramLink(url);
      if (!t) continue;
      chats.set(t.chat, (chats.get(t.chat) || 0) + 1);
      if (!t.topic || !subject) continue;
      const key = t.chat + '/' + t.topic;
      if (!votes.has(key)) votes.set(key, new Map());
      votes.get(key).set(subject, (votes.get(key).get(subject) || 0) + 1);
    }
  }
  const groupChat = [...chats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const topics = {};
  for (const [key, bySubject] of votes) {
    const [chat, topic] = key.split('/');
    if (chat !== groupChat) continue;
    topics[topic] = [...bySubject.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return { groupChat, topics };
}

/** Метка ссылки рядом с ней: своя тема ✓, чужая тема (предупреждение), другой чат, YouTube. */
export function linkInfo(url, subject, learned) {
  const t = parseTelegramLink(url);
  if (t) {
    if (learned.groupChat && t.chat !== learned.groupChat) return { kind: 'neutral', label: 'другой чат' };
    if (!t.topic) return { kind: 'neutral', label: 'группа' };
    const known = learned.topics[t.topic];
    if (!known) return { kind: 'neutral', label: 'тема ' + t.topic };
    return known === subject ? { kind: 'ok', label: known + ' ✓' } : { kind: 'warn', label: 'тема ' + known + '?', topicSubject: known };
  }
  if (/^https?:\/\/(www\.)?(youtu\.be|youtube\.com)\//.test(url)) return { kind: 'neutral', label: 'YouTube' };
  return { kind: 'neutral', label: 'ссылка' };
}

/** ДЗ с прошлого занятия того же предмета и типа (для кнопки «Как в прошлый раз»). */
export function previousHomework(data, date, subject, type) {
  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = addDays(date, -i);
    if (weekday(d) === 0) continue;
    const p = buildDay(d, data).pairs.find((x) => x.subject === subject && x.type === type && x.numbers.length && (x.hw || x.links.length));
    if (p) return { date: d, hw: p.hw, links: [...p.links] };
  }
  return null;
}

/** До 6 частых коротких подписей ДЗ этого предмета (сначала самые повторяемые), дополненные общими. */
export function frequentPhrases(data, subject, limit = 6) {
  const stats = new Map();
  for (const e of data.entries || []) {
    if (subjectOf(data, e) !== subject || !e.hw) continue;
    const phrase = e.hw.split(/\r?\n/)[0].trim();
    if (!phrase || phrase.length > 60) continue;
    const s = stats.get(phrase) || { count: 0, last: '' };
    s.count += 1; if (e.date > s.last) s.last = e.date;
    stats.set(phrase, s);
  }
  const ranked = [...stats.entries()].sort((a, b) => b[1].count - a[1].count || (a[1].last < b[1].last ? 1 : -1)).map(([p]) => p);
  for (const p of COMMON_PHRASES) if (!ranked.includes(p)) ranked.push(p);
  return ranked.slice(0, limit);
}
