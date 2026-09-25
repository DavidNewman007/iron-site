/* IRON CRM — оболочка над «Листом заказов» (план 93, §11.8–11.11).
 *
 * Как устроен доступ. Страница не хранит данных и секретов. Человек входит через Google,
 * получает токен на Google-таблицы, и все чтения и записи идут напрямую в Sheets API его
 * токеном. Права проверяет сам Google: нет доступа к файлу базы — 403, только просмотр —
 * запись отклоняется. Убрали человека из доступа к таблице — следующий запрос не пройдёт.
 *
 * Что правится здесь, а что в таблице. Запись через API НЕ запускает onEdit, а на нём
 * висят уведомления клиенту (H статус, L отчёт, J отзыв), уведомление мастеру (P) и
 * синхронизация контактов (C, D). Пока нет «двери» (план 93, этап 2), эти поля здесь
 * только показываются, а меняются по кнопке «в таблице» — она открывает ровно нужную
 * ячейку, и всё уходит как обычно. Остальные поля правятся прямо здесь.
 *
 * ?demo — выдуманные сделки из demo.json, без входа и без записи в таблицу.
 */
(() => {
  "use strict";

  const CFG = {
    clientId: "837579026697-5h9pa4mphpd2s48tmglu4vg62qh0n57l.apps.googleusercontent.com",
    scope: "openid email https://www.googleapis.com/auth/spreadsheets",
    sheetId: "1ik-UGHVgJgzrWVmdjBWSlHz1qv5jh8xHRkDMgd-buA8",
    sheet: "Лист заказов",
    lastCol: "AB",
  };

  // Колонки «Листа заказов» (0 = A). Сверено с шапкой листа 25.09.2026.
  const C = { num: 0, date: 1, name: 2, phone: 3, device: 4, issue: 5, work: 6, status: 7, issued: 8,
    review: 9, report: 11, comment: 12, warranty: 13, parts: 14, master: 15, total: 16, labor: 17,
    partCost: 18, extra: 19, partFrom: 20, source: 21 };
  const LETTER = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // Поля, которые правятся здесь. Числовые пишутся числом.
  const EDIT = [
    { c: C.device, label: "Устройство" },
    { c: C.issue, label: "Неисправность / с чем пришёл", area: true },
    { c: C.work, label: "Выполненные работы", area: true },
    { c: C.parts, label: "Запчасти", area: true },
    { c: C.partFrom, label: "Откуда запчасть" },
    { c: C.warranty, label: "Гарантия" },
    { c: C.comment, label: "Комментарии", area: true },
    { c: C.total, label: "Итого, ₽ (платит клиент)", num: true, money: true },
    { c: C.labor, label: "Чистая работа, ₽", num: true, money: true },
    { c: C.partCost, label: "Запчасть (закуп), ₽", num: true, money: true },
    { c: C.extra, label: "Сторонний мастер / расходы, ₽", num: true, money: true },
    { c: C.source, label: "Источник клиента" },
  ];

  // Финальные статусы — сделка закрыта. Всё остальное считается «в работе».
  const FINAL = ["выполнен", "отказ от ремонта", "ремонт невозможен", "без ремонта", "продан", "разобран"];
  const ORDER = ["принят на диагностику", "ждем предоплату", "ждём предоплату", "заказана запчасть", "готов"];
  const isFinal = s => FINAL.some(f => norm(s).startsWith(f));
  const isReady = s => norm(s).startsWith("готов");
  const statusKind = s => {
    const n = norm(s);
    if (!n) return "new";
    if (n.startsWith("готов")) return "ready";
    if (n.startsWith("выполнен") || n.startsWith("продан")) return "done";
    if (n.startsWith("отказ") || n.startsWith("ремонт невозможен") || n.startsWith("без ремонта")) return "stop";
    if (n.startsWith("жд") || n.startsWith("заказана")) return "wait";
    return "new";
  };

  const DEMO = new URLSearchParams(location.search).has("demo");
  const S = { token: null, email: "", rows: [], byNum: new Map(), gid: 0, loadedAt: 0, loading: false,
    tab: "work", q: "", limit: 60, dirty: new Map(), undo: null, error: "" };
  const $app = document.getElementById("app");
  const $toast = document.getElementById("toast");

  // ── мелочи ──────────────────────────────────────────────
  function norm(s) { return String(s ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "); }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
  function money(v) { const n = toNum(v); return n == null ? "" : n.toLocaleString("ru-RU") + " ₽"; }
  function toNum(v) { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[\s ₽]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; }
  function parseDate(v) {
    const s = String(v ?? "").trim(); let m;
    if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1]); }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  function daysSince(v) { const d = parseDate(v); return d ? Math.floor((Date.now() - d) / 864e5) : null; }
  function digits(s) { return String(s ?? "").replace(/\D/g, ""); }
  function phones(cell) {
    return String(cell ?? "").split(/[,;\n/]+|\s{2,}/).map(p => p.trim()).filter(p => digits(p).length >= 10)
      .map(p => { let d = digits(p); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return { text: p, d }; });
  }
  function toast(text, action) {
    $toast.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    $toast.hidden = false;
    if (action) $toast.querySelector("button").onclick = () => { $toast.hidden = true; action.run(); };
    clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, action ? 9000 : 3500);
  }
  function sheetLink(row, col) {
    return `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/edit#gid=${S.gid}&range=${LETTER(col)}${row}`;
  }

  // ── вход ────────────────────────────────────────────────
  let tokenClient = null;
  function saved() { try { const t = JSON.parse(sessionStorage.getItem("crm.tok") || "null"); return t && t.exp > Date.now() + 60e3 ? t : null; } catch { return null; } }
  function signIn(prompt) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google ещё грузится — нажмите ещё раз через пару секунд"));
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({ client_id: CFG.clientId, scope: CFG.scope, callback: () => {} });
      tokenClient.callback = r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        S.token = r.access_token;
        try { sessionStorage.setItem("crm.tok", JSON.stringify({ t: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 })); } catch {}
        resolve();
      };
      tokenClient.error_callback = e => reject(new Error(e?.type === "popup_closed" ? "Окно входа закрыли" : "Не удалось войти"));
      tokenClient.requestAccessToken({ prompt: prompt ?? "" });
    });
  }
  function signOut() {
    if (S.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(S.token, () => {});
    try { sessionStorage.removeItem("crm.tok"); } catch {}
    S.token = null; S.rows = []; S.byNum.clear(); location.hash = ""; render();
  }

  async function api(path, opts = {}) {
    const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + CFG.sheetId + path, {
      ...opts, headers: { Authorization: "Bearer " + S.token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 401) { try { sessionStorage.removeItem("crm.tok"); } catch {} S.token = null; throw Object.assign(new Error("Вход истёк — войдите ещё раз"), { code: 401 }); }
    if (r.status === 403) throw Object.assign(new Error(opts.method && opts.method !== "GET"
      ? "Google не дал записать: у вашего аккаунта доступ к таблице только на просмотр"
      : "У этого Google-аккаунта нет доступа к базе. Попросите владельца открыть доступ к таблице"), { code: 403 });
    if (!r.ok) throw new Error("Google ответил " + r.status);
    return r.json();
  }

  // ── загрузка ────────────────────────────────────────────
  async function load() {
    S.loading = true; S.error = ""; render();
    try {
      if (DEMO) {
        const rows = await fetch("demo.json?v=1").then(r => r.json());
        S.email = "демо"; S.gid = 0; setRows(rows.map((cells, i) => ({ row: i + 2, cells })));
      } else {
        const [meta, who] = await Promise.all([
          api("?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))"),
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + S.token } }).then(r => r.ok ? r.json() : {}),
        ]);
        S.email = who.email || "";
        const sh = meta.sheets.find(s => s.properties.title === CFG.sheet);
        if (!sh) throw new Error("В таблице нет листа «" + CFG.sheet + "»");
        S.gid = sh.properties.sheetId;
        const last = sh.properties.gridProperties.rowCount;
        const range = encodeURIComponent(`'${CFG.sheet}'!A2:${CFG.lastCol}${last}`);
        const data = await api(`/values/${range}?valueRenderOption=FORMATTED_VALUE`);
        setRows((data.values || []).map((cells, i) => ({ row: i + 2, cells })));
      }
      S.loadedAt = Date.now();
    } catch (e) {
      S.error = e.message;
      if (e.code === 401) S.token = null;
    }
    S.loading = false; render();
  }
  function setRows(list) {
    S.rows = list.filter(r => String(r.cells[C.num] ?? "").trim());
    S.byNum.clear();
    for (const r of S.rows) S.byNum.set(String(r.cells[C.num]).trim(), r);
  }
  const cell = (r, c) => r.cells[c] ?? "";

  // ── выборки для главного экрана ─────────────────────────
  function inWork(r) {
    const st = cell(r, C.status);
    if (isFinal(st)) return false;
    const age = daysSince(cell(r, C.date));
    return age == null || age <= 365; // древние строки без закрытого статуса не засоряют экран
  }
  function pick() {
    const q = norm(S.q);
    if (q) {
      const d = digits(q);
      return S.rows.filter(r => {
        if (d.length >= 3 && (String(cell(r, C.num)).includes(d) || digits(cell(r, C.phone)).includes(d.slice(-10)))) return true;
        return norm(cell(r, C.name) + " " + cell(r, C.device) + " " + cell(r, C.issue)).includes(q);
      }).reverse();
    }
    if (S.tab === "stale") return S.rows.filter(isStale).reverse();
    if (S.tab === "work") return S.rows.filter(r => inWork(r) && !isReady(cell(r, C.status))).reverse();
    if (S.tab === "ready") return S.rows.filter(r => inWork(r) && isReady(cell(r, C.status))).reverse();
    if (S.tab === "done") return S.rows.filter(r => isFinal(cell(r, C.status)) && (daysSince(cell(r, C.issued) || cell(r, C.date)) ?? 999) <= 30).reverse();
    return S.rows.slice().reverse();
  }
  // «Долго висят» — приём из ServiceM8 («требует действия»): список, который хорошо держать пустым.
  // Даты смены статуса в листе нет, поэтому меряем от даты приёма: в работе дольше 14 дней
  // или готов и не забран дольше 7 дней от приёма.
  function isStale(r) {
    if (!inWork(r)) return false;
    const age = daysSince(cell(r, C.date));
    if (age == null) return false;
    return isReady(cell(r, C.status)) ? age > 7 : age > 14;
  }
  function counts() {
    let work = 0, ready = 0, stale = 0;
    for (const r of S.rows) if (inWork(r)) { isReady(cell(r, C.status)) ? ready++ : work++; if (isStale(r)) stale++; }
    return { work, ready, stale };
  }

  // ── экраны ──────────────────────────────────────────────
  function render() {
    const m = location.hash.match(/^#\/(\d+)/);
    if (!DEMO && !S.token) return renderLogin();
    if (S.loading && !S.rows.length) return renderShell(`<div class="spinner">Загружаю базу…</div>`);
    if (S.error && !S.rows.length) return renderShell(`<div class="empty">${esc(S.error)}<div class="row" style="justify-content:center"><button class="btn" data-act="reload">Попробовать ещё раз</button></div></div>`);
    if (m) return renderCard(m[1]);
    renderList();
  }

  function renderLogin() {
    $app.innerHTML = `<main class="login"><div class="login__box">
      <h1>IRON <b>CRM</b></h1>
      <p>Вход по Google-аккаунту. Пускает всех, у кого есть доступ к таблице базы, — и только их.</p>
      <button class="btn btn--red" data-act="login">Войти через Google</button>
      ${S.error ? `<p class="note">${esc(S.error)}</p>` : ""}
      <p class="note">При первом входе Google покажет «приложение не проверено» — нажмите «Дополнительно» → «Перейти».</p>
    </div></main>`;
  }

  function renderShell(body, { search = true } = {}) {
    $app.innerHTML = (DEMO ? `<div class="demo-bar">ДЕМО — выдуманные сделки, в таблицу ничего не пишется</div>` : "") + `
      <header class="top"><div class="top__row">
        <div class="brand">IRON <b>CRM</b></div><div class="top__spacer"></div>
        <div class="who">${esc(S.email)}</div>
        <button class="iconbtn" data-act="reload" title="Обновить">⟳</button>
        ${DEMO ? "" : `<button class="iconbtn" data-act="logout" title="Выйти">⎋</button>`}
      </div>
      ${search ? `<input class="search" type="search" inputmode="search" placeholder="Номер, телефон, имя или устройство" value="${esc(S.q)}" data-act="search" autocomplete="off">` : ""}
      </header><main class="wrap">${body}</main>`;
  }

  function itemHtml(r) {
    const st = cell(r, C.status), age = daysSince(cell(r, C.date));
    const title = [cell(r, C.device), cell(r, C.issue)].filter(Boolean).join(" · ");
    const old = !isFinal(st) && age != null && age > 14;
    return `<button class="item" data-open="${esc(cell(r, C.num))}">
      <div><div class="item__title"><span class="item__num">№${esc(cell(r, C.num))}</span>${esc(title || "—")}</div>
      <div class="item__sub">${esc(cell(r, C.name) || "без имени")}${cell(r, C.master) ? " · " + esc(cell(r, C.master)) : ""}</div></div>
      <div class="item__right"><div class="item__sum">${money(cell(r, C.total))}</div>
      <div class="item__age${old ? " is-old" : ""}">${age == null ? "" : age === 0 ? "сегодня" : age + " дн."}</div></div>
      <span class="chip chip--${statusKind(st)}">${esc(st || "без статуса")}</span>
    </button>`;
  }

  function renderList() {
    const list = pick(), n = counts();
    const tabs = [["work", "В работе", n.work], ["stale", "⚡ Долго висят", n.stale], ["ready", "Готовы, ждут клиента", n.ready], ["done", "Выданы за 30 дней"], ["all", "Все"]];
    let body = S.q ? "" : `<nav class="tabs">${tabs.map(([k, t, c]) =>
      `<button class="tab" data-tab="${k}" aria-pressed="${S.tab === k}">${t}${c != null ? `<small>${c}</small>` : ""}</button>`).join("")}</nav>`;
    if (!list.length) body += `<div class="empty">${S.q ? "Ничего не нашлось" : "Здесь пусто"}</div>`;
    else if (!S.q && S.tab === "work") {
      // В работе — группами по статусу, в порядке прохождения ремонта.
      const groups = new Map();
      for (const r of list) { const k = cell(r, C.status) || "без статуса"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      const rank = k => { const i = ORDER.findIndex(o => norm(k).startsWith(o)); return i < 0 ? 50 : i; };
      for (const [k, rs] of [...groups].sort((a, b) => rank(a[0]) - rank(b[0])))
        body += `<div class="section"><h2>${esc(k)}</h2><span>${rs.length}</span></div><div class="list">${rs.map(itemHtml).join("")}</div>`;
    } else {
      const shown = list.slice(0, S.limit);
      body += `<div class="list" style="margin-top:14px">${shown.map(itemHtml).join("")}</div>`;
      if (list.length > shown.length) body += `<button class="more" data-act="more">Показать ещё (${list.length - shown.length})</button>`;
    }
    renderShell(body);
  }

  function renderCard(num) {
    const r = S.byNum.get(num);
    if (!r) return renderShell(`<div class="empty">Сделка №${esc(num)} не найдена<div class="row" style="justify-content:center"><a class="btn" href="#">К списку</a></div></div>`, { search: false });
    const st = cell(r, C.status);
    const tel = phones(cell(r, C.phone));
    const field = f => {
      const key = r.row + ":" + f.c, v = S.dirty.has(key) ? S.dirty.get(key) : cell(r, f.c);
      const dirty = S.dirty.has(key) ? " is-dirty" : "";
      const input = f.area
        ? `<textarea data-edit="${f.c}" rows="3">${esc(v)}</textarea>`
        : `<input data-edit="${f.c}" value="${esc(f.money ? String(toNum(v) ?? v) : v)}" ${f.num ? 'inputmode="decimal"' : ""}>`;
      return `<label class="field${dirty}"><span>${esc(f.label)}</span>${input}</label>`;
    };
    const locked = (label, c, value) => `<div class="field"><span>${esc(label)} 🔒</span><div class="ro">${esc(value || "—")}</div>
      ${DEMO ? "" : `<a class="btn btn--ghost" style="margin-top:6px" href="${sheetLink(r.row, c)}" target="_blank" rel="noopener">Изменить в таблице ↗</a>`}</div>`;
    const val = c => { const k = r.row + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : cell(r, c); };
    const margin = (toNum(val(C.total)) ?? 0) - (toNum(val(C.partCost)) ?? 0) - (toNum(val(C.extra)) ?? 0);
    const byC = c => EDIT.find(f => f.c === c);

    const body = `
      <div class="card-head" style="margin-top:14px"><a class="iconbtn" style="background:var(--ink)" href="#" aria-label="Назад">←</a>
        <h1>№${esc(num)}</h1><span class="chip chip--big chip--${statusKind(st)}">${esc(st || "без статуса")}</span></div>

      <section class="block"><h3>Статус</h3>
        <div class="big">${esc(st || "без статуса")}</div>
        ${DEMO ? "" : `<div class="row"><a class="btn btn--red" href="${sheetLink(r.row, C.status)}" target="_blank" rel="noopener">Сменить статус в таблице ↗</a>
          <a class="btn" href="${sheetLink(r.row, C.report)}" target="_blank" rel="noopener">Отчёт клиенту (Ok) ↗</a></div>
        <p class="note">Статус пока меняется в таблице — так клиенту уходит уведомление, как обычно. Кнопка открывает ровно нужную ячейку.</p>`}
      </section>

      <section class="block"><h3>Клиент</h3>
        <div class="big">${esc(cell(r, C.name) || "без имени")}</div>
        <div class="row">${tel.map(p => `<a class="btn" href="tel:+${p.d}">📞 ${esc(p.text)}</a><a class="btn btn--ghost" href="https://wa.me/${p.d}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--ghost" href="https://t.me/+${p.d}" target="_blank" rel="noopener">Telegram</a>`).join("") || `<span class="note">Телефона нет</span>`}</div>
        <p class="note">Имя и телефон меняются в таблице — от них зависит карточка в Google Контактах.</p>
      </section>

      <section class="block"><h3>Ремонт</h3>
        ${[C.device, C.issue, C.work, C.parts].map(c => field(byC(c))).join("")}
        <div class="grid2">${field(byC(C.partFrom))}${field(byC(C.warranty))}</div>
        ${field(byC(C.comment))}
      </section>

      <section class="block"><h3>Деньги</h3>
        <div class="grid2">${[C.total, C.labor, C.partCost, C.extra].map(c => field(byC(c))).join("")}</div>
        <div class="margin">Остаётся нам: <b>${margin.toLocaleString("ru-RU")} ₽</b> <span class="note">(итого − запчасть − расходы)</span></div>
      </section>

      <section class="block"><h3>Прочее</h3>
        ${locked("Мастер", C.master, cell(r, C.master))}
        <div class="grid2">
          <div class="field"><span>Принят</span><div class="ro">${esc(cell(r, C.date) || "—")}</div></div>
          <div class="field"><span>Выдан</span><div class="ro">${esc(cell(r, C.issued) || "—")}</div></div>
        </div>
        ${field(byC(C.source))}
        ${DEMO ? "" : `<div class="row"><a class="btn btn--ghost" href="${sheetLink(r.row, C.num)}" target="_blank" rel="noopener">Открыть строку в таблице ↗</a></div>`}
      </section>`;
    renderShell(body, { search: false });
    const n = [...S.dirty.keys()].filter(k => k.startsWith(r.row + ":")).length;
    $app.insertAdjacentHTML("beforeend", `<div class="savebar"><div class="savebar__in">
      <button class="btn btn--ghost" data-act="discard" ${n ? "" : "disabled"}>Отмена</button>
      <button class="btn btn--red" data-act="save" data-num="${esc(num)}" ${n ? "" : "disabled"}>${n ? `Сохранить (${n})` : "Изменений нет"}</button>
    </div></div>`);
  }

  // ── запись ──────────────────────────────────────────────
  async function save(num) {
    const r = S.byNum.get(num); if (!r) return;
    const changes = [...S.dirty].filter(([k]) => k.startsWith(r.row + ":")).map(([k, v]) => ({ c: +k.split(":")[1], v }));
    if (!changes.length) return;
    const prev = changes.map(ch => ({ c: ch.c, v: cell(r, ch.c) }));
    const btn = $app.querySelector('[data-act="save"]'); if (btn) { btn.disabled = true; btn.textContent = "Сохраняю…"; }
    try {
      await writeCells(r, changes);
      for (const ch of changes) { r.cells[ch.c] = String(ch.v); S.dirty.delete(r.row + ":" + ch.c); }
      render();
      toast(DEMO ? "Сохранено (демо — в таблицу не пишется)" : "Сохранено в таблицу", { label: "Отменить", run: () => writeCells(r, prev).then(() => { for (const p of prev) r.cells[p.c] = p.v; render(); toast("Вернул как было"); }).catch(e => toast(e.message)) });
    } catch (e) { toast(e.message); render(); }
  }
  async function writeCells(r, changes) {
    if (DEMO) return;
    // Строки могли сдвинуться, пока карточка была открыта: сверяем номер заказа в строке.
    const chk = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A${r.row}`)}`);
    const now = String(chk.values?.[0]?.[0] ?? "").trim();
    if (now !== String(cell(r, C.num)).trim()) throw new Error("Строка в таблице сдвинулась — обновите список (⟳) и повторите");
    const data = changes.map(ch => {
      const f = EDIT.find(x => x.c === ch.c);
      const n = f?.num ? toNum(ch.v) : null;
      return { range: `'${CFG.sheet}'!${LETTER(ch.c)}${r.row}`, values: [[f?.num && n != null ? n : String(ch.v)]] };
    });
    await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  }

  // ── события ─────────────────────────────────────────────
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-open],[data-tab]"); if (!t) return;
    if (t.dataset.open) { location.hash = "#/" + t.dataset.open; return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = 60; renderList(); return; }
    const act = t.dataset.act;
    if (act === "login") {
      try { await signIn("select_account"); S.error = ""; await load(); } catch (err) { S.error = err.message; render(); }
    } else if (act === "logout") signOut();
    else if (act === "reload") { if (!DEMO && !S.token) render(); else load(); }
    else if (act === "more") { S.limit += 100; renderList(); }
    else if (act === "save") save(t.dataset.num);
    else if (act === "discard") { const num = location.hash.slice(2); const r = S.byNum.get(num); if (r) for (const k of [...S.dirty.keys()]) if (k.startsWith(r.row + ":")) S.dirty.delete(k); render(); }
  });
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.act === "search") { S.q = t.value; S.limit = 60; const pos = t.selectionStart; renderList(); const s = $app.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); return; }
    if (t.dataset.edit != null) {
      const num = location.hash.slice(2), r = S.byNum.get(num); if (!r) return;
      const c = +t.dataset.edit, key = r.row + ":" + c, f = EDIT.find(x => x.c === c);
      const orig = f?.money ? String(toNum(cell(r, c)) ?? cell(r, c)) : cell(r, c);
      if (t.value === orig) S.dirty.delete(key); else S.dirty.set(key, t.value);
      t.closest(".field").classList.toggle("is-dirty", S.dirty.has(key));
      const n = [...S.dirty.keys()].filter(k => k.startsWith(r.row + ":")).length;
      const sb = $app.querySelector('[data-act="save"]'), db = $app.querySelector('[data-act="discard"]');
      sb.disabled = db.disabled = !n; sb.textContent = n ? `Сохранить (${n})` : "Изменений нет";
      if (f?.money) { // пересчитать «остаётся нам» без перерисовки поля, в котором печатают
        const v = x => { const k = r.row + ":" + x; return toNum(S.dirty.has(k) ? S.dirty.get(k) : cell(r, x)) ?? 0; };
        const b = $app.querySelector(".margin b"); if (b) b.textContent = (v(C.total) - v(C.partCost) - v(C.extra)).toLocaleString("ru-RU") + " ₽";
      }
    }
  });
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  window.addEventListener("beforeunload", e => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.rows.length && Date.now() - S.loadedAt > 120e3 && !S.dirty.size && !location.hash.startsWith("#/")) load();
  });

  // ── старт ───────────────────────────────────────────────
  const t = saved();
  if (t) S.token = t.t;
  if (DEMO || S.token) load(); else render();
})();
