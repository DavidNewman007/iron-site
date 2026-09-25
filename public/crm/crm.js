/* IRON CRM — оболочка над «Листом заказов» (план 93, §11.8–11.13).
 *
 * Доступ. Страница не хранит данных и секретов. Человек входит через Google, получает
 * токен на Google-таблицы, и все чтения и записи идут напрямую в Sheets API ЕГО токеном.
 * Права проверяет сам Google: нет доступа к файлу базы — 403, только просмотр — запись
 * отклоняется. Убрали человека из доступа к таблице — следующий запрос не пройдёт.
 *
 * Уведомления. Запись через API не запускает onEdit, а на нём держится всё живое:
 * сообщение клиенту о статусе, итоговый отчёт и его правка при изменении работ и суммы,
 * уведомление мастеру, Google Контакты, «История статусов», напоминание об отзыве.
 * Поэтому после записи оболочка зовёт «дверь» (Apps Script, CrmDoor.js): та прогоняет
 * каждую изменённую клетку через те же обработчики, что и правка руками.
 * Пока адрес двери не задан (CFG.doorUrl пуст), поля, от которых зависят сообщения,
 * меняются в таблице по кнопке «↗» — иначе клиенту молча ничего бы не ушло.
 *
 * Выпадающие списки берутся из правил проверки данных самой таблицы: поменяли список в
 * таблице — он поменялся и здесь.
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
    // Веб-приложение Apps Script с CrmDoor.js, развёрнутое из-под рабочего аккаунта.
    doorUrl: "",
    newStatus: "Принят на диагностику",
    reportValue: "Ok",
  };

  // Колонки «Листа заказов» (0 = A). Сверено с шапкой листа 25.09.2026.
  const C = { num: 0, date: 1, name: 2, phone: 3, device: 4, issue: 5, work: 6, status: 7, issued: 8,
    review: 9, report: 11, comment: 12, warranty: 13, parts: 14, master: 15, total: 16, labor: 17,
    partCost: 18, extra: 19, partFrom: 20, source: 21 };
  const LETTER = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // Все поля карточки.
  //  door   — на поле висит реакция onEdit (сообщение клиенту, правка уже отправленного отчёта,
  //           мастер, контакт): без двери правится только в таблице, иначе реакция молча пропадёт.
  //           Список сверен с onEditTelegramTrigger (relevantColumns), onEditTrigger и
  //           onEditMasterNotifierTrigger 25.09.2026.
  //  notify — правка отправляет НОВОЕ сообщение (статус, отчёт, отзыв, мастер).
  //  entered — пишется как «набрано руками» (даты), остальное — как есть.
  const F = {
    [C.date]: { label: "Дата приёма", entered: true },
    [C.name]: { label: "Имя клиента", door: true },
    [C.phone]: { label: "Телефон(ы)", door: true, tel: true },
    [C.device]: { label: "Устройство", door: true },
    [C.issue]: { label: "Неисправность / с чем пришёл", area: true, door: true },
    [C.work]: { label: "Выполненные работы", area: true, door: true },
    [C.status]: { label: "Статус", door: true, notify: true },
    [C.issued]: { label: "Дата выдачи", entered: true, door: true },
    [C.review]: { label: "Напомнить об отзыве", door: true, notify: true },
    [C.report]: { label: "Отчёт клиенту", door: true, notify: true },
    [C.comment]: { label: "Комментарии", area: true },
    [C.warranty]: { label: "Гарантия", door: true },
    [C.parts]: { label: "Запчасти", area: true, door: true },
    [C.master]: { label: "Мастер", door: true, notify: true },
    [C.total]: { label: "Итого, ₽ (платит клиент)", num: true, door: true },
    [C.labor]: { label: "Чистая работа, ₽", num: true },
    [C.partCost]: { label: "Запчасть (закуп), ₽", num: true },
    [C.extra]: { label: "Сторонний мастер / расходы, ₽", num: true },
    [C.partFrom]: { label: "Откуда запчасть" },
    [C.source]: { label: "Источник клиента" },
  };
  // Меняется ли поле здесь прямо сейчас. С дверью — всё. Без двери — поля без реакций, а
  // поля ремонта (устройство, работы, сумма…) ещё и пока отчёт клиенту не отправлен: их
  // реакция — правка уже отправленного отчёта, а если отчёта нет, реагировать нечему.
  const editable = (c, r) => {
    const f = F[c]; if (!f) return false;
    if (!f.door || CFG.doorUrl || DEMO) return true;
    return !f.notify && c !== C.name && c !== C.phone && !!r && !isTrue(cell(r, C.report));
  };

  const FINAL = ["выполнен", "отказ от ремонта", "ремонт невозможен", "без ремонта", "продан", "разобран"];
  const ORDER = ["принят на диагностику", "ждем предоплату", "заказана запчасть", "готов"];
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
    tab: "work", q: "", limit: 60, dirty: new Map(), error: "", opts: {}, bools: new Set(), draft: null };
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
  function today() { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; }
  function daysSince(v) { const d = parseDate(v); return d ? Math.floor((Date.now() - d) / 864e5) : null; }
  function digits(s) { return String(s ?? "").replace(/\D/g, ""); }
  function phones(cell) {
    return String(cell ?? "").split(/[,;\n/]+|\s{2,}/).map(p => p.trim()).filter(p => digits(p).length >= 10)
      .map(p => { let d = digits(p); if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1); if (d.length === 10) d = "7" + d; return { text: p, d }; });
  }
  function isTrue(v) { return v === true || ["true", "ok", "да"].includes(norm(v)); }
  function toast(text, action, long) {
    $toast.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    $toast.hidden = false;
    if (action) $toast.querySelector("button").onclick = () => { $toast.hidden = true; action.run(); };
    clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, action || long ? 9000 : 3500);
  }
  function sheetLink(row, col) { return `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/edit#gid=${S.gid}&range=${LETTER(col)}${row}`; }

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
  const A1 = (col, row, col2, row2) => encodeURIComponent(`'${CFG.sheet}'!${LETTER(col)}${row}` + (col2 != null ? `:${LETTER(col2)}${row2}` : ""));

  // ── загрузка ────────────────────────────────────────────
  async function load() {
    S.loading = true; S.error = ""; render();
    try {
      if (DEMO) {
        const rows = await fetch("demo.json?v=3").then(r => r.json());
        S.email = "демо"; S.gid = 0; setRows(rows.map((cells, i) => ({ row: i + 2, cells })));
        demoOptions();
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
        const data = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A2:${CFG.lastCol}${last}`)}?valueRenderOption=FORMATTED_VALUE`);
        setRows((data.values || []).map((cells, i) => ({ row: i + 2, cells })));
        await loadOptions().catch(e => console.warn("списки:", e));
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

  // Выпадающие списки — из правил проверки данных последних строк листа.
  async function loadOptions() {
    const lastRow = S.rows.length ? S.rows[S.rows.length - 1].row : 2;
    const from = Math.max(2, lastRow - 5);
    const g = await api(`?ranges=${A1(0, from, C.source, lastRow + 5)}&fields=sheets(data(rowData(values(dataValidation))))`);
    const rows = g.sheets?.[0]?.data?.[0]?.rowData || [];
    const rules = {};
    for (const rd of rows.slice().reverse()) (rd.values || []).forEach((v, c) => { if (v?.dataValidation && !rules[c]) rules[c] = v.dataValidation.condition; });
    const ranges = [];
    for (const [c, cond] of Object.entries(rules)) {
      if (cond.type === "BOOLEAN") S.bools.add(+c);
      else if (cond.type === "ONE_OF_LIST") S.opts[c] = (cond.values || []).map(x => x.userEnteredValue).filter(Boolean);
      else if (cond.type === "ONE_OF_RANGE") ranges.push([+c, String(cond.values?.[0]?.userEnteredValue || "").replace(/^=/, "")]);
    }
    await Promise.all(ranges.map(async ([c, rng]) => {
      const v = await api(`/values/${encodeURIComponent(rng)}`);
      S.opts[c] = [...new Set((v.values || []).flat().map(x => String(x).trim()).filter(Boolean))];
    }));
  }
  function demoOptions() {
    const uniq = c => [...new Set(S.rows.map(r => String(cell(r, c)).trim()).filter(Boolean))];
    S.opts[C.status] = ["Принят на диагностику", "Ждем предоплату", "Заказана запчасть", "В работе", "Готов ожидает клиента", "Выполнен", "Отказ от ремонта после диагностики"];
    S.opts[C.master] = uniq(C.master).sort();
    S.opts[C.source] = uniq(C.source);
    S.opts[C.report] = ["Ok"];
    S.bools.add(C.review);
  }

  // ── выборки для главного экрана ─────────────────────────
  function inWork(r) {
    if (isFinal(cell(r, C.status))) return false;
    const age = daysSince(cell(r, C.date));
    return age == null || age <= 365;
  }
  function isStale(r) {
    if (!inWork(r)) return false;
    const age = daysSince(cell(r, C.date));
    if (age == null) return false;
    return isReady(cell(r, C.status)) ? age > 7 : age > 14;
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
  function counts() {
    let work = 0, ready = 0, stale = 0;
    for (const r of S.rows) if (inWork(r)) { isReady(cell(r, C.status)) ? ready++ : work++; if (isStale(r)) stale++; }
    return { work, ready, stale };
  }

  // ── экраны ──────────────────────────────────────────────
  function render() {
    if (!DEMO && !S.token) return renderLogin();
    if (S.loading && !S.rows.length) return renderShell(`<div class="spinner">Загружаю базу…</div>`);
    if (S.error && !S.rows.length) return renderShell(`<div class="empty">${esc(S.error)}<div class="row" style="justify-content:center"><button class="btn" data-act="reload">Попробовать ещё раз</button></div></div>`);
    if (location.hash === "#/new") return renderNew();
    const m = location.hash.match(/^#\/(\d+)/);
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
        <a class="brand" href="#" style="color:inherit;text-decoration:none">IRON <b>CRM</b></a><div class="top__spacer"></div>
        <div class="who">${esc(S.email)}</div>
        ${canCreate() ? `<a class="iconbtn iconbtn--add" href="#/new" title="Новый заказ">＋</a>` : ""}
        <button class="iconbtn" data-act="reload" title="Обновить">⟳</button>
        ${DEMO ? "" : `<button class="iconbtn" data-act="logout" title="Выйти">⎋</button>`}
      </div>
      ${search ? `<input class="search" type="search" inputmode="search" placeholder="Номер, телефон, имя или устройство" value="${esc(S.q)}" data-act="search" autocomplete="off">` : ""}
      </header><main class="wrap">${body}</main>`;
  }
  const canCreate = () => DEMO || !!CFG.doorUrl;

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

  // Поле карточки: текст, число, список или флажок — смотря по правилу таблицы.
  function fieldHtml(key, c, value, opts = {}) {
    const f = F[c]; if (!f) return "";
    const dirty = S.dirty.has(key + ":" + c);
    const v = dirty ? S.dirty.get(key + ":" + c) : value;
    const lock = !editable(c, opts.r) && !opts.force;
    if (lock) return `<div class="field"><span>${esc(f.label)} 🔒</span><div class="ro">${esc(value || "—")}</div>
      ${opts.row ? `<a class="btn btn--ghost" style="margin-top:6px" href="${sheetLink(opts.row, c)}" target="_blank" rel="noopener">Изменить в таблице ↗</a>` : ""}</div>`;
    let input;
    if (S.bools.has(c)) {
      input = `<label class="check"><input type="checkbox" data-edit="${c}" ${isTrue(v) ? "checked" : ""}><b>${isTrue(v) ? "Да" : "Нет"}</b></label>`;
    } else if (S.opts[c]?.length && c !== C.status) {
      const list = S.opts[c].includes(String(v)) || !v ? S.opts[c] : [String(v), ...S.opts[c]];
      input = `<select data-edit="${c}"><option value="">—</option>${list.map(o => `<option ${o === String(v) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.area) {
      input = `<textarea data-edit="${c}" rows="3">${esc(v)}</textarea>`;
    } else {
      const shown = f.num && !dirty ? String(toNum(v) ?? v) : v;
      input = `<input data-edit="${c}" value="${esc(shown)}" ${f.num ? 'inputmode="decimal"' : f.tel ? 'inputmode="tel"' : ""}>`;
    }
    return `<label class="field${dirty ? " is-dirty" : ""}"><span>${esc(f.label)}</span>${input}</label>`;
  }

  function statusButtons(key, current) {
    const opts = S.opts[C.status] || [];
    const chosen = S.dirty.has(key + ":" + C.status) ? S.dirty.get(key + ":" + C.status) : current;
    const list = opts.includes(current) || !current ? opts : [current, ...opts];
    return `<div class="statuses">${list.map(o => `<button type="button" class="st st--${statusKind(o)}" data-status="${esc(o)}" aria-pressed="${o === chosen}">${esc(o)}</button>`).join("")}</div>`;
  }

  function renderCard(num) {
    const r = S.byNum.get(num);
    if (!r) return renderShell(`<div class="empty">Сделка №${esc(num)} не найдена<div class="row" style="justify-content:center"><a class="btn" href="#">К списку</a></div></div>`, { search: false });
    const key = r.row, st = cell(r, C.status), tel = phones(cell(r, C.phone));
    const fh = c => fieldHtml(key, c, cell(r, c), { row: r.row, r });
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : cell(r, c); };
    const margin = (toNum(val(C.total)) ?? 0) - (toNum(val(C.partCost)) ?? 0) - (toNum(val(C.extra)) ?? 0);
    const reportSent = isTrue(cell(r, C.report));

    const statusBlock = editable(C.status, r)
      ? `${statusButtons(key, st)}<p class="note">Выберите статус и нажмите «Сохранить» внизу — клиенту уйдёт уведомление, как из таблицы.</p>`
      : `<div class="big">${esc(st || "без статуса")}</div>
         <div class="row"><a class="btn btn--red" href="${sheetLink(r.row, C.status)}" target="_blank" rel="noopener">Сменить статус в таблице ↗</a></div>`;
    const reportBlock = editable(C.report, r)
      ? `<div class="row"><button type="button" class="btn ${reportSent ? "btn--ghost" : ""}" data-act="report">${reportSent ? "Отчёт уже отправлен — отправить заново" : "📨 Отправить отчёт клиенту"}</button></div>`
      : `<div class="row"><a class="btn" href="${sheetLink(r.row, C.report)}" target="_blank" rel="noopener">Отчёт клиенту (Ok) ↗</a></div>`;

    const body = `
      <div class="card-head" style="margin-top:14px"><a class="iconbtn" style="background:var(--ink)" href="#" aria-label="Назад">←</a>
        <h1>№${esc(num)}</h1><span class="chip chip--big chip--${statusKind(st)}">${esc(st || "без статуса")}</span></div>

      <section class="block"><h3>Статус</h3>${statusBlock}${reportBlock}</section>

      <section class="block"><h3>Клиент</h3>
        ${fh(C.name)}${fh(C.phone)}
        <div class="row">${tel.map(p => `<a class="btn" href="tel:+${p.d}">📞 ${esc(p.text)}</a><a class="btn btn--ghost" href="https://wa.me/${p.d}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--ghost" href="https://t.me/+${p.d}" target="_blank" rel="noopener">Telegram</a>`).join("") || `<span class="note">Телефона нет</span>`}</div>
      </section>

      <section class="block"><h3>Ремонт</h3>
        ${fh(C.device)}${fh(C.issue)}${fh(C.work)}${fh(C.parts)}
        <div class="grid2">${fh(C.partFrom)}${fh(C.warranty)}</div>
        ${fh(C.master)}${fh(C.comment)}
      </section>

      <section class="block"><h3>Деньги</h3>
        <div class="grid2">${fh(C.total)}${fh(C.labor)}${fh(C.partCost)}${fh(C.extra)}</div>
        <div class="margin">Остаётся нам: <b>${margin.toLocaleString("ru-RU")} ₽</b> <span class="note">(итого − запчасть − расходы)</span></div>
      </section>

      <section class="block"><h3>Прочее</h3>
        <div class="grid2">${fh(C.date)}${fh(C.issued)}</div>
        ${fh(C.source)}${fh(C.review)}
        ${DEMO ? "" : `<div class="row"><a class="btn btn--ghost" href="${sheetLink(r.row, C.num)}" target="_blank" rel="noopener">Открыть строку в таблице ↗</a></div>`}
      </section>`;
    renderShell(body, { search: false });
    saveBar(key, `data-num="${esc(num)}"`);
  }

  function saveBar(key, attrs) {
    const ks = [...S.dirty.keys()].filter(k => k.startsWith(key + ":"));
    const n = ks.length, notify = ks.some(k => F[+k.split(":")[1]]?.notify);
    $app.insertAdjacentHTML("beforeend", `<div class="savebar"><div class="savebar__in">
      <button class="btn btn--ghost" data-act="discard" ${n ? "" : "disabled"}>Отмена</button>
      <button class="btn btn--red" data-act="save" ${attrs} ${n ? "" : "disabled"}>${n ? (notify ? `Сохранить и уведомить (${n})` : `Сохранить (${n})`) : "Изменений нет"}</button>
    </div></div>`);
  }
  function refreshSaveBar(key) { $app.querySelector(".savebar")?.remove(); saveBar(key, location.hash === "#/new" ? 'data-new="1"' : `data-num="${esc(location.hash.slice(2))}"`); }

  // ── новый заказ ─────────────────────────────────────────
  function renderNew() {
    if (!canCreate()) { location.hash = ""; return; }
    const key = "new";
    if (!S.draft) { S.draft = true; S.dirty.set("new:" + C.status, CFG.newStatus); S.dirty.set("new:" + C.date, today()); }
    const fh = c => fieldHtml(key, c, "", { force: true });
    const body = `
      <div class="card-head" style="margin-top:14px"><a class="iconbtn" style="background:var(--ink)" href="#" aria-label="Назад">←</a><h1>Новый заказ</h1></div>
      <section class="block"><h3>Клиент</h3>${fh(C.name)}${fh(C.phone)}</section>
      <section class="block"><h3>Устройство</h3>${fh(C.device)}${fh(C.issue)}${fh(C.master)}${fh(C.comment)}</section>
      <section class="block"><h3>Деньги и прочее</h3><div class="grid2">${fh(C.total)}${fh(C.date)}</div>${fh(C.source)}</section>
      <p class="note" style="margin:14px 4px 0">Статус — «${esc(CFG.newStatus)}». Номер присвоится следующий по порядку; клиенту уйдёт то же сообщение, что при записи в таблицу.</p>`;
    renderShell(body, { search: false });
    saveBar(key, 'data-new="1"');
  }

  // ── запись ──────────────────────────────────────────────
  // Пишем токеном человека (права проверяет Google), потом зовём дверь за уведомлениями.
  async function writeCells(row, list) {
    if (DEMO) return;
    const entered = list.filter(ch => F[ch.c]?.entered), raw = list.filter(ch => !F[ch.c]?.entered);
    const pack = arr => arr.map(ch => {
      const f = F[ch.c]; let v = ch.v;
      if (S.bools.has(ch.c)) v = isTrue(v);
      else if (f?.num) { const n = toNum(v); v = n == null ? String(v ?? "") : n; }
      else v = String(v ?? "");
      return { range: `'${CFG.sheet}'!${LETTER(ch.c)}${row}`, values: [[v]] };
    });
    if (raw.length) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: pack(raw) }) });
    if (entered.length) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: pack(entered) }) });
  }
  async function door(row, num, list) {
    if (DEMO || !CFG.doorUrl) return null;
    const r = await fetch(CFG.doorUrl + "?action=crm-door", {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: S.token, row, num, changes: list.map(ch => ({ col: ch.c + 1, value: S.bools.has(ch.c) ? String(isTrue(ch.v)).toUpperCase() : String(ch.v ?? ""), old: String(ch.old ?? "") })) }),
    });
    const j = await r.json().catch(() => ({ ok: false, error: "дверь ответила не JSON (" + r.status + ")" }));
    if (!j.ok) throw new Error(j.error || "дверь не ответила");
    return j;
  }
  function doorReport(j, list) {
    if (!j) return "";
    const errs = (j.results || []).flatMap(x => x.errors || []);
    if (errs.length) return "Записано, но обработчик споткнулся: " + errs[0];
    if (list.some(ch => ch.c === C.status)) {
      const bg = String(j.statusBackground || "").toLowerCase();
      if (bg === "#00bfff") return "Клиенту отправлено ✓";
      if (bg === "#ffff00") return "Статус сохранён. Клиента нет в Telegram — ушло в MAX/WhatsApp, если он там есть";
      if (bg === "#ff0000") return "Статус сохранён, но отправка клиенту не удалась — проверьте номер";
    }
    return "Сохранено ✓";
  }

  async function save(num) {
    const r = S.byNum.get(num); if (!r) return;
    const key = r.row;
    const list = [...S.dirty].filter(([k]) => k.startsWith(key + ":")).map(([k, v]) => { const c = +k.split(":")[1]; return { c, v, old: cell(r, c) }; });
    if (!list.length) return;
    busy(true);
    try {
      if (!DEMO) {
        const chk = await api(`/values/${A1(0, r.row)}`);
        if (String(chk.values?.[0]?.[0] ?? "").trim() !== String(num)) throw new Error("Строка в таблице сдвинулась — обновите список (⟳) и повторите");
      }
      await writeCells(r.row, list);
      for (const ch of list) { r.cells[ch.c] = S.bools.has(ch.c) ? (isTrue(ch.v) ? "TRUE" : "FALSE") : String(ch.v ?? ""); S.dirty.delete(key + ":" + ch.c); }
      let msg = DEMO ? "Сохранено (демо — в таблицу не пишется)" : "Сохранено в таблицу";
      try { const j = await door(r.row, num, list); if (j) { msg = doorReport(j, list); if (j.issued != null) r.cells[C.issued] = j.issued; } }
      catch (e) { msg = "Записано в таблицу, но уведомления не ушли: " + e.message; }
      render(); toast(msg, null, true);
    } catch (e) { busy(false); toast(e.message, null, true); }
  }

  async function create() {
    const get = c => S.dirty.get("new:" + c) ?? "";
    if (!String(get(C.name)).trim() && !String(get(C.phone)).trim()) return toast("Нужно имя или телефон клиента");
    busy(true);
    try {
      let row, num;
      if (DEMO) {
        row = (S.rows.at(-1)?.row || 1) + 1; num = String(Math.max(0, ...S.rows.map(x => +cell(x, C.num) || 0)) + 1);
      } else {
        // Свежий взгляд на колонку A прямо перед записью: номер — следующий, строка — первая пустая.
        const colA = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A:A`)}`);
        const vals = (colA.values || []).map(v => String(v[0] ?? "").trim());
        let last = vals.length; while (last > 1 && !vals[last - 1]) last--;
        num = String(Math.max(0, ...vals.map(v => +v || 0)) + 1);
        row = last + 1;
        const probe = await api(`/values/${A1(0, row, C.source, row)}?valueRenderOption=FORMULA`);
        if ((probe.values?.[0] || []).some(v => String(v).trim())) throw new Error("Строка " + row + " не пустая — обновите список и повторите");
      }
      const list = [{ c: C.num, v: num }, ...[...S.dirty].filter(([k]) => k.startsWith("new:")).map(([k, v]) => ({ c: +k.split(":")[1], v, old: "" }))]
        .filter(ch => String(ch.v ?? "").trim() !== "");
      await writeCells(row, list);
      const cells = []; for (const ch of list) cells[ch.c] = String(ch.v);
      const rec = { row, cells }; S.rows.push(rec); S.byNum.set(num, rec);
      for (const k of [...S.dirty.keys()]) if (k.startsWith("new:")) S.dirty.delete(k);
      S.draft = null;
      let msg = DEMO ? "Заказ создан (демо)" : "Заказ №" + num + " записан";
      try { const j = await door(row, num, list.filter(ch => ch.c !== C.num)); if (j) msg = "Заказ №" + num + ": " + doorReport(j, list); }
      catch (e) { msg = "Заказ №" + num + " записан, но уведомления не ушли: " + e.message; }
      location.hash = "#/" + num; toast(msg, null, true);
    } catch (e) { busy(false); toast(e.message, null, true); }
  }
  function busy(on) { const b = $app.querySelector('[data-act="save"]'); if (b) { b.disabled = on; if (on) b.textContent = "Сохраняю…"; } }

  // ── события ─────────────────────────────────────────────
  const curKey = () => location.hash === "#/new" ? "new" : S.byNum.get(location.hash.slice(2))?.row;
  const curVal = (key, c) => key === "new" ? "" : cell(S.byNum.get(location.hash.slice(2)), c);
  function setDirty(key, c, v) {
    const orig = curVal(key, c);
    const same = S.bools.has(c) ? isTrue(v) === isTrue(orig) : F[c]?.num ? toNum(v) === toNum(orig) && String(v).trim() !== "" : String(v) === String(orig);
    if (same && !(key === "new" && (c === C.status || c === C.date))) S.dirty.delete(key + ":" + c); else S.dirty.set(key + ":" + c, v);
  }

  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-open],[data-tab],[data-status]"); if (!t) return;
    if (t.dataset.open) { location.hash = "#/" + t.dataset.open; return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = 60; renderList(); return; }
    if (t.dataset.status != null) {
      const key = curKey(); setDirty(key, C.status, t.dataset.status);
      $app.querySelectorAll("[data-status]").forEach(b => b.setAttribute("aria-pressed", String(b === t)));
      refreshSaveBar(key); return;
    }
    const act = t.dataset.act;
    if (act === "login") {
      try { await signIn("select_account"); S.error = ""; await load(); } catch (err) { S.error = err.message; render(); }
    } else if (act === "logout") signOut();
    else if (act === "reload") { if (!DEMO && !S.token) render(); else load(); }
    else if (act === "more") { S.limit += 100; renderList(); }
    else if (act === "report") { const key = curKey(); S.dirty.set(key + ":" + C.report, CFG.reportValue); t.textContent = "Отчёт уйдёт после «Сохранить»"; t.disabled = true; refreshSaveBar(key); }
    else if (act === "save") t.dataset.new ? create() : save(t.dataset.num);
    else if (act === "discard") { const key = curKey(); for (const k of [...S.dirty.keys()]) if (k.startsWith(key + ":")) S.dirty.delete(k); if (key === "new") { S.draft = null; location.hash = ""; } else render(); }
  });
  function onEdit(e) {
    const t = e.target;
    if (t.dataset.act === "search") { S.q = t.value; S.limit = 60; const pos = t.selectionStart; renderList(); const s = $app.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); return; }
    if (t.dataset.edit == null) return;
    const key = curKey(); if (key == null) return;
    const c = +t.dataset.edit, v = t.type === "checkbox" ? t.checked : t.value;
    setDirty(key, c, v);
    t.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c));
    if (t.type === "checkbox") t.nextElementSibling.textContent = t.checked ? "Да" : "Нет";
    refreshSaveBar(key);
    if (F[c]?.num && key !== "new") {
      const r = S.byNum.get(location.hash.slice(2));
      const val = x => { const k = key + ":" + x; return toNum(S.dirty.has(k) ? S.dirty.get(k) : cell(r, x)) ?? 0; };
      const b = $app.querySelector(".margin b"); if (b) b.textContent = (val(C.total) - val(C.partCost) - val(C.extra)).toLocaleString("ru-RU") + " ₽";
    }
  }
  document.addEventListener("input", onEdit);
  document.addEventListener("change", e => { if (e.target.tagName === "SELECT" || e.target.type === "checkbox") onEdit(e); });
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  window.addEventListener("beforeunload", e => { if (S.dirty.size && !(S.draft && S.dirty.size <= 2)) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.rows.length && Date.now() - S.loadedAt > 120e3 && !S.dirty.size && !location.hash.startsWith("#/")) load();
  });

  // ── старт ───────────────────────────────────────────────
  const t = saved();
  if (t) S.token = t.t;
  if (DEMO || S.token) load(); else render();
})();
