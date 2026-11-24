/* Private, in-browser repair statistics. Never exports customer data. */
(function (root) {
  'use strict';
  const day = 864e5;
  function dateKey(value) {
    const s = String(value || '').trim();
    const ru = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:$|\s)/.exec(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s);
    if (!ru && !iso) return null;
    const y = ru ? (+ru[3] < 100 ? 2000 + +ru[3] : +ru[3]) : +iso[1];
    const m = +(ru ? ru[2] : iso[2]), d = +(ru ? ru[1] : iso[3]);
    const t = Date.UTC(y, m - 1, d), dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : null;
  }
  function windowFor(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en', {timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(now);
    const n = type => +parts.find(p => p.type === type).value;
    const y = n('year'), m = n('month'), d = n('day');
    const priorDay = Math.min(d, new Date(Date.UTC(y - 1, m, 0)).getUTCDate());
    return {from:Date.UTC(y - 1, m - 1, priorDay), to:Date.UTC(y, m - 1, d)};
  }
  function annual(rows, columns, canonical, now = new Date()) {
    const range = windowFor(now), models = new Map(), seen = new Set();
    for (const r of rows) {
      const c = r.cells, type = String(c[columns.type] || '').trim().toLowerCase();
      if (type && type !== 'ремонт') continue;
      const at = dateKey(c[columns.date]), id = String(c[columns.num] || '').trim();
      if (!id || at == null || at < range.from || at >= range.to + day) continue;
      const model = canonical(c[columns.device]);
      if (!model || seen.has(id + '\n' + model.key)) continue;
      seen.add(id + '\n' + model.key);
      const entry = models.get(model.key) || {device:model.label, count:0, last:0};
      entry.count++; entry.last = Math.max(entry.last, at); models.set(model.key, entry);
    }
    return {...range, models:[...models.values()].sort((a,b) => b.count-a.count || b.last-a.last || a.device.localeCompare(b.device,'ru'))};
  }
  const api = {dateKey, windowFor, annual};
  root.IRON_REPAIR_MODELS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
