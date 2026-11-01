// Имитация сервера для браузерных проверок: тот же код, что работает в Apps Script
// (processOps_ и publicData_ из apps-script/code.src.js), данные — из site/data.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = process.env.ROOT || path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function makeServer() {
  const ctx = vm.createContext({ Utilities: { formatDate: (d) => d.toISOString() } });
  vm.runInContext(read('apps-script/code.src.js') + '\nthis.api = { processOps_, publicData_ };', ctx);
  const seed = JSON.parse(read('site/data/seed.json'));
  const hist = JSON.parse(read('site/data/demo-entries.json'));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const st = seed.settings;
  const state = { entries: clone(hist.entries), dayNotes: clone(hist.dayNotes), rules: clone(hist.rules), extras: [],
    // как на сервере после перехода (migrateV2): одна версия шаблона, предметы списком
    versions: [{ id: 'V1', from: st.semesterStart, anchorWeek: st.anchorWeek, anchorHalf: st.anchorHalf, semesterStart: st.semesterStart, semesterEnd: st.semesterEnd, version: 1, pairs: clone(seed.template) }],
    subjects: Object.entries(seed.subjects).map(([subject, x]) => ({ subject, ...x })), versionsReady: true };
  const pairIds = Object.fromEntries(seed.template.map((t) => [t.id, true]));
  const codes = { '123456': 'Активист 1', '654321': 'Активист 2' };
  const seen = new Map(); const logs = [];
  const srv = { state, logs, offline: false, dropResponse: 0, posts: 0,
    payload: () => clone(ctx.api.publicData_(clone({ ...seed, versions: state.versions, subjects: Object.fromEntries(state.subjects.map((x) => [x.subject, { short: x.short, full: x.full, color: x.color }])),
      rules: state.rules, extras: state.extras, entries: state.entries, dayNotes: state.dayNotes }))), // как buildPayload_: без имён
    post(req) {
      srv.posts++;
      const name = codes[req.code];
      if (!name) return { ok: false, error: 'bad-code', message: 'Код не подошёл. Проверьте цифры.' };
      if (req.action === 'login') return { ok: true, name };
      if (srv.rejectAll) return { ok: true, name, results: req.ops.map((o) => ({ opId: o.opId, ok: false, error: 'invalid', message: 'проверка: отклонено' })) };
      const out = ctx.api.processOps_(state, clone(req.ops), pairIds, { name, now: new Date().toISOString(), today: '2026-11-02' }, (o) => seen.get(o.opId) || null);
      out.results.forEach((r) => { if (r.ok) seen.set(r.opId, r); });
      logs.push(...out.logs);
      return JSON.parse(JSON.stringify({ ok: true, name, results: out.results }));
    },
    entry: (date, pairId) => state.entries.find((e) => e.date === date && e.pairId === pairId),
    rule: (pairId, field, from) => state.rules.find((r) => r.pairId === pairId && r.field === field && r.from === from),
  };
  return srv;
}

module.exports = { makeServer };
