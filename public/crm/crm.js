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
 * Пока двери не заданы (CFG.doors пуст), поля, от которых зависят сообщения,
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
    lastCol: "AG",
    // Двери — один и тот же CrmDoor.js, развёрнутый из-под двух аккаунтов, потому что
    // onEdit-триггеры разнесены (владелец, 25.09.2026): рабочий ironsapple держит только
    // Google Контакты, дату выдачи и «Историю статусов» (onEditTrigger), личный — всё
    // остальное (сообщения клиенту, отчёт, мастер). Каждая дверь исполняет только свои
    // триггеры. Порядок как у ручной правки по смыслу: сначала контакт и дата, потом сообщения.
    doors: [
      "https://script.google.com/macros/s/AKfycbwHC5_EA-wndVqLcRW0ehkZ_r56Hcji1cqmwGgfCF7vY7a13_35T4ckh5n6YE-GoXO7/exec", // ironsapple, v66
      "https://script.google.com/macros/s/AKfycbyOtzn7cQARc_H9heNEvukPwMhsOapCMc8BNNLi1IBZ9zLABBpb2wJvePbHnpQLPKbr/exec", // личный, v65
    ],
    newStatus: "Принят на диагностику",
    reportValue: "Ok",
  };

  // Колонки «Листа заказов» (0 = A). Сверено с шапкой листа 25.09.2026.
  const C = { num: 0, date: 1, name: 2, phone: 3, device: 4, issue: 5, work: 6, status: 7, issued: 8,
    review: 9, report: 11, comment: 12, warranty: 13, parts: 14, master: 15, total: 16, labor: 17,
    partCost: 18, extra: 19, partFrom: 20, source: 21,
    // Добавлены 25.09.2026 (план 93 §11.3): K «Пароль», AC–AF — тип сделки и её данные.
    pass: 10, type: 28, imei: 29, buyback: 30, linked: 31,
    group: 32 }; // AG — «Группа»: № первого заказа, если устройств у клиента несколько (26.09.2026)
  const LETTER = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

  // Все поля карточки.
  //  door   — на поле висит реакция onEdit (сообщение клиенту, правка уже отправленного отчёта,
  //           мастер, контакт): без двери правится только в таблице, иначе реакция молча пропадёт.
  //           Список сверен с onEditTelegramTrigger (relevantColumns), onEditTrigger и
  //           onEditMasterNotifierTrigger 25.09.2026.
  //  notify — правка отправляет НОВОЕ сообщение (статус, отчёт, отзыв, мастер).
  //  entered — пишется как «набрано руками» (даты), остальное — как есть.
  //  spell  — проверка правописания браузера (подчёркивание, исправление правой кнопкой).
  //  free   — у колонки в таблице есть список, но пишут и своё: подсказки + свободный ввод.
  const F = {
    [C.date]: { label: "Дата приёма", entered: true },
    [C.name]: { label: "Имя клиента", door: true },
    [C.phone]: { label: "Телефон(ы)", door: true, tel: true },
    [C.device]: { label: "Устройство", door: true },
    [C.issue]: { label: "Неисправность / с чем пришёл", area: true, door: true, spell: true },
    [C.work]: { label: "Выполненные работы", area: true, door: true, spell: true },
    [C.status]: { label: "Статус", door: true, notify: true },
    [C.issued]: { label: "Дата выдачи", entered: true, door: true },
    [C.review]: { label: "Напомнить об отзыве", door: true, notify: true },
    [C.report]: { label: "Отчёт клиенту", door: true, notify: true },
    [C.comment]: { label: "Комментарии", area: true, spell: true },
    [C.warranty]: { label: "Гарантия", door: true, spell: true },
    [C.parts]: { label: "Запчасти", door: true, spell: true, free: true },
    [C.master]: { label: "Мастер", door: true, notify: true },
    [C.total]: { label: "Итого, ₽ (платит клиент)", num: true, door: true },
    [C.labor]: { label: "Чистая работа, ₽", num: true },
    [C.partCost]: { label: "Запчасть (закуп), ₽", num: true, free: true },
    [C.extra]: { label: "Сторонний мастер / расходы, ₽", num: true },
    [C.partFrom]: { label: "Откуда запчасть" },
    [C.source]: { label: "Источник клиента" },
    [C.pass]: { label: "Пароль устройства 🔑" },
    [C.type]: { label: "Тип сделки", door: true },
    [C.imei]: { label: "IMEI / серийный", door: true },
    [C.buyback]: { label: "Выкуп / зачёт, ₽", num: true, door: true },
    [C.linked]: { label: "Связанная сделка №" },
    [C.group]: { label: "Группа" },
  };

  // Тип сделки (колонка AC). Пусто = ремонт. Ключи — как в DealTypes.js на стороне таблицы.
  function dealKey(v) {
    const s = norm(v);
    if (!s || s === "ремонт") return "repair";
    if (s.startsWith("выкуп") && s.includes("запчаст")) return "parts";
    if (s.startsWith("выкуп")) return "buyback";
    if (s.includes("trade") || s.includes("трейд")) return "tradein";
    if (s.startsWith("продажа") && (s.includes("б/у") || s.includes("бу"))) return "sale_used";
    if (s.startsWith("продажа")) return "sale_new";
    return "other";
  }
  // Подписи полей по типу: одна и та же колонка значит разное в ремонте и в выкупе.
  const LABELS = {
    repair:   { [C.device]: "Устройство", [C.issue]: "Неисправность / с чем пришёл", [C.work]: "Выполненные работы", [C.total]: "Итого, ₽ (платит клиент)" },
    buyback:  { [C.device]: "Что выкупаем", [C.issue]: "Дефекты", [C.work]: "Состояние и комплект (уйдёт клиенту в отчёте)", [C.buyback]: "Сумма выкупа (платим клиенту), ₽" },
    parts:    { [C.device]: "Что выкупаем на запчасти", [C.issue]: "Что с ним", [C.work]: "Что годится на детали", [C.buyback]: "Сумма выкупа (платим клиенту), ₽" },
    tradein:  { [C.device]: "Что сдаёт клиент", [C.issue]: "Состояние сданного", [C.work]: "Что выдали взамен (модель, IMEI)", [C.total]: "Доплата клиента, ₽", [C.buyback]: "Зачёт за сданное, ₽", [C.partCost]: "Закупка выданного, ₽" },
    sale_used:{ [C.device]: "Что продаём", [C.issue]: "Примечание", [C.work]: "Подготовка перед продажей", [C.total]: "Цена продажи, ₽", [C.partCost]: "Себестоимость, ₽", [C.linked]: "Из какой сделки устройство (№ выкупа)" },
    sale_new: { [C.device]: "Что продаём", [C.issue]: "Примечание", [C.work]: "Комплектация", [C.total]: "Цена продажи, ₽", [C.partCost]: "Закупка, ₽" },
    other:    { [C.work]: "Что сделано", [C.total]: "Итого, ₽ (платит клиент)" },
  };
  const labelFor = (c, key) => LABELS[key]?.[c] || F[c]?.label || "";
  // Меняется ли поле здесь прямо сейчас. С дверью — всё. Без двери — поля без реакций, а
  // поля ремонта (устройство, работы, сумма…) ещё и пока отчёт клиенту не отправлен: их
  // реакция — правка уже отправленного отчёта, а если отчёта нет, реагировать нечему.
  const editable = (c, r) => {
    const f = F[c]; if (!f) return false;
    if (!f.door || CFG.doors.length || DEMO) return true;
    return !f.notify && c !== C.name && c !== C.phone && !!r && !isTrue(cell(r, C.report));
  };

  const FINAL = ["выполнен", "отказ от ремонта", "ремонт невозможен", "без ремонта", "продан", "разобран", "выкуплен", "обмен оформлен"];
  const ORDER = ["принят на диагностику", "ждем предоплату", "заказана запчасть", "готов"];
  const isFinal = s => FINAL.some(f => norm(s).startsWith(f));
  const isReady = s => norm(s).startsWith("готов");
  const statusKind = s => {
    const n = norm(s);
    if (!n) return "new";
    if (n.startsWith("готов")) return "ready";
    if (["выполнен", "продан", "выкуплен", "обмен оформлен", "разобран"].some(x => n.startsWith(x))) return "done";
    if (n.startsWith("отказ") || n.startsWith("ремонт невозможен") || n.startsWith("без ремонта")) return "stop";
    if (n.startsWith("жд") || n.startsWith("заказана")) return "wait";
    return "new";
  };

  const DEMO = new URLSearchParams(location.search).has("demo");
  const S = { token: null, email: "", rows: [], byNum: new Map(), gid: 0, loadedAt: 0, loading: false,
    tab: "work", q: "", limit: 60, dirty: new Map(), error: "", opts: {}, bools: new Set(), draft: null, boolVals: {}, multi: false, extra: [] };
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
    for (const r of S.rows) { S.byNum.set(String(r.cells[C.num]).trim(), r); index(r); }
    S.clients = null; // книга клиентов строится при первом обращении
  }
  // Поисковые ключи строки считаются один раз при загрузке (и после правки строки), а не
  // на каждое нажатие клавиши: по 7–8 тысячам строк поиск так идёт за миллисекунды.
  function index(r) {
    r.hay = norm([C.num, C.name, C.phone, C.device, C.issue, C.work, C.parts, C.comment, C.master, C.imei, C.type, C.status].map(c => r.cells[c] ?? "").join(" "));
    r.ph = phones(r.cells[C.phone]).map(p => p.d);
    r.nameN = norm(String(r.cells[C.name] ?? "").split("\n")[0]);
  }
  function normDigits(d) { return d.length === 11 && d[0] === "8" ? "7" + d.slice(1) : d; }
  const isDigitQuery = q => /^[\d\s+()\-]+$/.test(q);

  // Книга клиентов из самой базы: одно имя — один клиент, у клиента может быть несколько
  // телефонов. Свежие написание имени и телефоны — сверху.
  function clients() {
    if (S.clients) return S.clients;
    const map = new Map();
    for (const r of S.rows) {
      if (!r.nameN) continue;
      let c = map.get(r.nameN);
      if (!c) map.set(r.nameN, c = { key: r.nameN, name: "", words: r.nameN.split(" "), phones: new Map(), count: 0, last: null });
      c.count++; c.last = r;
      c.name = String(cell(r, C.name)).split("\n")[0].trim() || c.name;
      for (const p of phones(cell(r, C.phone))) c.phones.set(p.d, { text: p.text, d: p.d, row: r.row, date: cell(r, C.date) });
    }
    return (S.clients = [...map.values()]);
  }
  function findClients(q, limit = 8) {
    let res;
    if (isDigitQuery(q)) {
      const d = normDigits(digits(q)); if (d.length < 4) return [];
      res = clients().filter(c => [...c.phones.keys()].some(p => p.includes(d)));
    } else {
      const tokens = norm(q).split(" ").filter(Boolean);
      if (tokens.join("").length < 3) return [];
      res = clients().filter(c => tokens.every(t => c.words.some(w => w.startsWith(t))));
    }
    return res.sort((a, b) => b.last.row - a.last.row).slice(0, limit);
  }
  const phonesOf = c => [...c.phones.values()].sort((a, b) => b.row - a.row);
  const ordersWord = n => n % 10 === 1 && n % 100 !== 11 ? "заказ" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заказа" : "заказов";
  const cell = (r, c) => r.cells[c] ?? "";

  // Выпадающие списки — из правил проверки данных последних строк листа.
  async function loadOptions() {
    const lastRow = S.rows.length ? S.rows[S.rows.length - 1].row : 2;
    const from = Math.max(2, lastRow - 5);
    const g = await api(`?ranges=${A1(0, from, C.linked, lastRow + 5)}&fields=sheets(data(rowData(values(dataValidation))))`);
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
    S.opts[C.type] = ["Ремонт", "Выкуп", "Выкуп на запчасти", "Trade-in", "Продажа б/у", "Продажа нового", "Другое"];
    S.bools.add(C.review); S.bools.add(C.report);
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
    if (q) return search(q);
    if (S.tab === "stale") return S.rows.filter(isStale).reverse();
    if (S.tab === "work") return S.rows.filter(r => inWork(r) && !isReady(cell(r, C.status))).reverse();
    if (S.tab === "ready") return S.rows.filter(r => inWork(r) && isReady(cell(r, C.status))).reverse();
    if (S.tab === "done") return S.rows.filter(r => isFinal(cell(r, C.status)) && (daysSince(cell(r, C.issued) || cell(r, C.date)) ?? 999) <= 30).reverse();
    return S.rows.slice().reverse();
  }
  // Поиск одной строкой. Цифры: точный номер заказа → телефон (любая часть, от 4 цифр,
  // «8…» и «+7…» одинаково) → IMEI → номер по началу. Слова: должны найтись ВСЕ
  // («иван 13 pro»), в имени, телефоне, устройстве, неисправности, работах, запчастях,
  // комментарии, мастере, IMEI, типе и статусе; выше — где слово совпало с началом имени
  // или фамилии. При равенстве — свежие заказы выше.
  function search(q) {
    const tokens = q.split(" ").filter(Boolean);
    const d = normDigits(digits(q)), digitsOnly = isDigitQuery(q);
    const out = [];
    for (const r of S.rows) {
      let score;
      if (digitsOnly) {
        const num = String(cell(r, C.num)).trim();
        if (num === d) score = 1000;
        else if (d.length >= 4 && r.ph.some(p => p.includes(d))) score = 400;
        else if (d.length >= 4 && digits(cell(r, C.imei)).includes(d)) score = 300;
        else if (num.startsWith(d)) score = 200;
        else continue;
      } else {
        if (!tokens.every(t => r.hay.includes(t))) continue;
        const words = r.nameN.split(" ");
        score = 100 + tokens.filter(t => words.some(w => w.startsWith(t))).length * 50;
      }
      out.push([score, r.row, r]);
    }
    return out.sort((a, b) => b[0] - a[0] || b[1] - a[1]).map(x => x[2]);
  }
  // Подсветка найденного в результатах поиска.
  function mark(text) {
    const safe = esc(text);
    const tokens = norm(S.q).split(" ").filter(t => t.length >= 2);
    if (!tokens.length) return safe;
    const re = new RegExp("(" + tokens.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "giu");
    return safe.replace(re, "<mark>$1</mark>");
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
  const canCreate = () => DEMO || CFG.doors.length > 0;

  function itemHtml(r) {
    const st = cell(r, C.status), age = daysSince(cell(r, C.date));
    const title = [cell(r, C.device), cell(r, C.issue)].filter(Boolean).join(" · ");
    const old = !isFinal(st) && age != null && age > 14;
    return `<button class="item" data-open="${esc(cell(r, C.num))}">
      <div><div class="item__title"><span class="item__num">№${mark(cell(r, C.num))}</span>${mark(title || "—")}</div>
      <div class="item__sub">${mark(cell(r, C.name) || "без имени")}${S.q && cell(r, C.phone) ? " · " + mark(cell(r, C.phone)) : ""}${cell(r, C.master) ? " · " + mark(cell(r, C.master)) : ""}</div></div>
      <div class="item__right"><div class="item__sum">${money(cell(r, C.total))}</div>
      <div class="item__age${old ? " is-old" : ""}">${age == null ? "" : age === 0 ? "сегодня" : age + " дн."}</div></div>
      <span class="item__chips"><span class="chip chip--${statusKind(st)}">${esc(st || "без статуса")}</span>${dealKey(cell(r, C.type)) !== "repair" ? `<span class="chip">${esc(cell(r, C.type))}</span>` : ""}</span>
    </button>`;
  }

  function renderList() {
    const list = pick(), n = counts();
    const tabs = [["work", "В работе", n.work], ["stale", "⚡ Долго висят", n.stale], ["ready", "Готовы, ждут клиента", n.ready], ["done", "Выданы за 30 дней"], ["all", "Все"]];
    let body = S.q ? "" : `<nav class="tabs">${tabs.map(([k, t, c]) =>
      `<button class="tab" data-tab="${k}" aria-pressed="${S.tab === k}">${t}${c != null ? `<small>${c}</small>` : ""}</button>`).join("")}</nav>`;
    if (S.q) {
      const found = !isDigitQuery(S.q) ? findClients(S.q, 3) : [];
      body += `<div class="section"><h2>Найдено</h2><span>${list.length}</span></div>`;
      if (found.length) body += `<div class="clients">${found.map(c => { const p = phonesOf(c)[0];
        return `<button class="client" data-q="${esc(p ? p.d : c.name)}"><b>${mark(c.name)}</b><span>${c.count} ${ordersWord(c.count)}${p ? " · " + esc(p.text) : ""}${c.phones.size > 1 ? ` (+${c.phones.size - 1})` : ""}</span><em>все заказы клиента →</em></button>`; }).join("")}</div>`;
    }
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

  // Поле карточки: текст, число, список, подсказки или флажок — смотря по правилу таблицы.
  function fieldHtml(key, c, value, opts = {}) {
    const f = F[c]; if (!f) return "";
    const label = opts.label || f.label;
    const dirty = S.dirty.has(key + ":" + c);
    const v = dirty ? S.dirty.get(key + ":" + c) : value;
    const lock = !editable(c, opts.r) && !opts.force;
    if (lock) return `<div class="field"><span>${esc(label)} 🔒</span><div class="ro">${esc(value || "—")}</div>
      ${opts.row ? `<a class="btn btn--ghost" style="margin-top:6px" href="${sheetLink(opts.row, c)}" target="_blank" rel="noopener">Изменить в таблице ↗</a>` : ""}</div>`;
    const spell = f.spell ? ' spellcheck="true" lang="ru" autocorrect="on" autocapitalize="sentences"' : ' spellcheck="false" autocorrect="off" autocapitalize="off"';
    let input;
    if (S.bools.has(c)) {
      input = `<label class="check"><input type="checkbox" data-edit="${c}" ${isTrue(v) ? "checked" : ""}><b>${isTrue(v) ? "Да" : "Нет"}</b></label>`;
    } else if (S.opts[c]?.length && c !== C.status && !f.free) {
      const list = S.opts[c].includes(String(v)) || !v ? S.opts[c] : [String(v), ...S.opts[c]];
      input = `<select data-edit="${c}"><option value="">—</option>${list.map(o => `<option ${o === String(v) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.area) {
      input = `<textarea data-edit="${c}" rows="3"${spell}>${esc(v)}</textarea>`;
    } else {
      const shown = f.num && !dirty ? String(toNum(v) ?? v) : v;
      const dl = f.free && S.opts[c]?.length ? ` list="dl-${c}"` : "";
      input = `<input data-edit="${c}" value="${esc(shown)}"${dl}${spell} ${f.num ? 'inputmode="decimal"' : f.tel ? 'inputmode="tel"' : ""}>` +
        (dl ? `<datalist id="dl-${c}">${S.opts[c].map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
    }
    return `<label class="field${dirty ? " is-dirty" : ""}"><span>${esc(label)}</span>${input}</label>`;
  }

  function choiceButtons(key, col, current, opts, kindOf) {
    const chosen = S.dirty.has(key + ":" + col) ? S.dirty.get(key + ":" + col) : current;
    const list = opts.includes(current) || !current ? opts : [current, ...opts];
    return `<div class="statuses">${list.map(o => `<button type="button" class="st st--${kindOf(o)}" data-choice="${col}" data-value="${esc(o)}" aria-pressed="${o === chosen}">${esc(o)}</button>`).join("")}</div>`;
  }
  const typeOptions = () => S.opts[C.type]?.length ? S.opts[C.type] : ["Ремонт", "Выкуп", "Выкуп на запчасти", "Trade-in", "Продажа б/у", "Продажа нового", "Другое"];

  // Деньги по типу сделки: что считаем «остаётся нам».
  function moneySummary(key, val, r) {
    const n = c => toNum(val(c)) ?? 0;
    if (key === "buyback" || key === "parts") return `Отдали клиенту: <b>${n(C.buyback).toLocaleString("ru-RU")} ₽</b> <span class="note">(маржа — при продаже)</span>`;
    let m, how;
    if (key === "tradein") { m = n(C.total) + n(C.buyback) - n(C.partCost) - n(C.extra); how = "доплата + зачёт − закупка выданного − расходы"; }
    else { m = n(C.total) - n(C.partCost) - n(C.extra); how = key.startsWith("sale") ? "цена − себестоимость − расходы" : "итого − запчасть − расходы"; }
    let extra = "";
    if (key === "sale_used" && val(C.linked)) {
      const src = S.byNum.get(String(val(C.linked)).trim());
      if (src) extra = `<div class="note">Устройство из сделки №${esc(val(C.linked))}: выкуплено за ${money(cell(src, C.buyback)) || "—"}</div>`;
    }
    return `Остаётся нам: <b>${m.toLocaleString("ru-RU")} ₽</b> <span class="note">(${how})</span>${extra}`;
  }

  function cardBody(key, r, isNew) {
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const dk = dealKey(val(C.type));
    const fh = (c, extra = {}) => fieldHtml(key, c, r ? cell(r, c) : "", { row: r?.row, r, force: isNew, label: labelFor(c, dk), ...extra });
    const st = r ? cell(r, C.status) : CFG.newStatus;
    const tel = phones(val(C.phone));
    const typeNow = val(C.type) || "Ремонт";

    let html = `<section class="block"><h3>Тип сделки</h3>${
      editable(C.type, r) || isNew ? choiceButtons(key, C.type, typeNow, typeOptions(), () => "new") : `<div class="big">${esc(typeNow)}</div>`}
      ${dk === "buyback" || dk === "parts" ? `<p class="note">Перед выкупом: iCloud и «Найти iPhone» отключены, IMEI не в розыске, проверены АКБ и экран. Паспортные данные — только в бумажный договор, в таблицу не писать.</p>` : ""}
    </section>`;

    if (!isNew) {
      const reportSent = isTrue(cell(r, C.report));
      const statusBlock = editable(C.status, r)
        ? `${choiceButtons(key, C.status, st, S.opts[C.status] || [], statusKind)}<p class="note">Выберите статус и нажмите «Сохранить» внизу — клиенту уйдёт уведомление, как из таблицы.${groupOf(r)?.shared ? " <b>Статус поменяется у всех устройств группы.</b>" : ""}</p>`
        : `<div class="big">${esc(st || "без статуса")}</div><div class="row"><a class="btn btn--red" href="${sheetLink(r.row, C.status)}" target="_blank" rel="noopener">Сменить статус в таблице ↗</a></div>`;
      const reportBtn = editable(C.report, r)
        ? `<button type="button" class="btn ${reportSent ? "btn--ghost" : ""}" data-act="report">${reportSent ? "Отчёт уже отправлен — отправить заново" : groupOf(r)?.shared ? "📨 Отправить общий отчёт" : "📨 Отправить отчёт клиенту"}</button>`
        : `<a class="btn" href="${sheetLink(r.row, C.report)}" target="_blank" rel="noopener">Отчёт клиенту (Ok) ↗</a>`;
      html += `<section class="block"><h3>Статус</h3>${statusBlock}
        <div class="row row--report">${reportBtn}<div class="inline-check">${fh(C.review)}</div></div></section>`;
    }

    html += `<section class="block"><h3>Клиент</h3>${fh(C.name)}${isNew ? `<div class="ac" id="ac-${C.name}"></div>` : ""}${fh(C.phone)}${isNew ? `<div class="ac" id="ac-${C.phone}"></div>` : ""}
      ${tel.length ? `<div class="row">${tel.map(p => `<a class="btn" href="tel:+${p.d}">📞 ${esc(p.text)}</a><a class="btn btn--ghost" href="https://wa.me/${p.d}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--ghost" href="https://t.me/+${p.d}" target="_blank" rel="noopener">Telegram</a>`).join("")}</div>` : ""}
    </section>`;

    html += `<section class="block"><h3>${isNew && S.multi ? "Устройство 1" : dk === "repair" || dk === "other" ? "Ремонт" : "Устройство"}</h3>
      ${isNew ? `<label class="check multi"><input type="checkbox" data-act="multi" ${S.multi ? "checked" : ""}><b>Несколько устройств у одного клиента</b></label>` : ""}
      ${fh(C.device)}${fh(C.imei)}${fh(C.issue)}${fh(C.work)}
      ${dk === "repair" || dk === "other" ? fh(C.parts) + `<div class="grid2">${fh(C.partFrom)}${fh(C.warranty)}</div>` : fh(C.warranty)}
      ${dk === "sale_used" ? fh(C.linked) : ""}
      ${fh(C.master)}
      <div class="grid2 grid2--wide">${fh(C.comment)}${fh(C.pass)}</div>
    </section>`;

    if (isNew && S.multi) html += extraDevicesHtml(dk);

    const moneyFields = (dk === "buyback" || dk === "parts") ? [C.buyback, C.extra]
      : dk === "tradein" ? [C.total, C.buyback, C.partCost, C.extra] : [C.total, C.labor, C.partCost, C.extra];
    html += `<section class="block"><h3>Деньги</h3><div class="grid2">${moneyFields.map(c => fh(c)).join("")}</div>
      <div class="margin">${moneySummary(dk, val, r)}</div></section>`;

    html += `<section class="block"><h3>Прочее</h3><div class="grid2">${fh(C.date)}${isNew ? "" : fh(C.issued)}</div>${fh(C.source)}
      ${!isNew && !DEMO ? `<div class="row"><a class="btn btn--ghost" href="${sheetLink(r.row, C.num)}" target="_blank" rel="noopener">Открыть строку в таблице ↗</a></div>` : ""}</section>`;
    return html;
  }

  // Группа — заказы одного клиента, созданные одной формой (колонка AG = № первого заказа).
  function groupOf(r) {
    const g = String(cell(r, C.group) ?? "").trim();
    if (!g) return null;
    const rows = S.rows.filter(x => String(cell(x, C.group)).trim() === g).sort((a, b) => +cell(a, C.num) - +cell(b, C.num));
    if (rows.length < 2) return null;
    return { g, rows, head: rows.find(x => String(cell(x, C.num)).trim() === g) || rows[0], shared: dealKey(cell(r, C.type)) !== "repair" };
  }
  function groupBlock(r) {
    const gr = groupOf(r); if (!gr) return "";
    return `<section class="block block--group"><h3>Несколько устройств у клиента — ${gr.rows.length}</h3>
      <div class="group-list">${gr.rows.map(x => `<a class="group-item${x === r ? " is-cur" : ""}" href="#/${esc(cell(x, C.num))}"><b>№${esc(cell(x, C.num))}</b> ${esc(cell(x, C.device) || "—")}<span class="chip chip--${statusKind(cell(x, C.status))}">${esc(cell(x, C.status) || "—")}</span></a>`).join("")}</div>
      <p class="note">${gr.shared ? "Статус и итоговый отчёт — общие: меняются сразу у всех устройств, клиенту уходит одно сообщение со списком." : "Ремонт: статусы и отчёты по каждому устройству — отдельно. Приёмка ушла одним сообщением."}</p></section>`;
  }

  // Дополнительные устройства нового заказа. Каждое станет в таблице отдельным заказом со
  // своим номером; клиент, тип сделки, дата, источник и комментарий — общие.
  const blankDevice = () => ({ device: "", imei: "", issue: "", pass: "", master: "", total: "" });
  function extraDevicesHtml(dk) {
    const inp = (i, f, label, o = {}) => {
      const v = S.extra[i][f] ?? "";
      const spell = o.spell ? ' spellcheck="true" lang="ru" autocorrect="on" autocapitalize="sentences"' : ' spellcheck="false"';
      const el = o.area ? `<textarea data-extra="${i}" data-field="${f}" rows="2"${spell}>${esc(v)}</textarea>`
        : `<input data-extra="${i}" data-field="${f}" value="${esc(v)}"${spell} ${o.num ? 'inputmode="decimal"' : ""}>`;
      return `<label class="field"><span>${esc(label)}</span>${el}</label>`;
    };
    const masters = S.opts[C.master] || [];
    return S.extra.map((x, i) => `<section class="block"><h3 class="h3-row">Устройство ${i + 2}<button type="button" class="linkbtn" data-act="rmdev" data-i="${i}">убрать</button></h3>
      ${inp(i, "device", labelFor(C.device, dk))}${inp(i, "imei", "IMEI / серийный")}${inp(i, "issue", labelFor(C.issue, dk), { area: true, spell: true })}
      <div class="grid2">
        <label class="field"><span>Мастер</span><select data-extra="${i}" data-field="master"><option value="">как у первого</option>${masters.map(m => `<option ${m === x.master ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
        ${inp(i, "pass", "Пароль устройства 🔑")}
      </div>${inp(i, "total", labelFor(C.total, dk), { num: true })}
    </section>`).join("") + `<button type="button" class="more" data-act="adddev">＋ Добавить ещё устройство</button>`;
  }

  function renderCard(num) {
    const r = S.byNum.get(num);
    if (!r) return renderShell(`<div class="empty">Сделка №${esc(num)} не найдена<div class="row" style="justify-content:center"><a class="btn" href="#">К списку</a></div></div>`, { search: false });
    const st = cell(r, C.status), dk = dealKey(cell(r, C.type));
    const head = `<div class="card-head" style="margin-top:14px"><a class="iconbtn" style="background:var(--ink)" href="#" aria-label="Назад">←</a>
      <h1>№${esc(num)}</h1>${dk !== "repair" ? `<span class="chip">${esc(cell(r, C.type))}</span>` : ""}<span class="chip chip--big chip--${statusKind(st)}">${esc(st || "без статуса")}</span></div>`;
    renderShell(head + groupBlock(r) + cardBody(r.row, r, false), { search: false });
    saveBar(r.row, `data-num="${esc(num)}"`);
  }

  function saveBar(key, attrs) {
    const ks = [...S.dirty.keys()].filter(k => k.startsWith(key + ":"));
    const n = ks.length, notify = ks.some(k => F[+k.split(":")[1]]?.notify);
    const isNew = key === "new";
    $app.insertAdjacentHTML("beforeend", `<div class="savebar"><div class="savebar__in">
      <button class="btn btn--ghost" data-act="discard" ${n || isNew ? "" : "disabled"}>Отмена</button>
      <button class="btn btn--red" data-act="save" ${attrs} ${n ? "" : "disabled"}>${isNew ? newLabel() : n ? (notify ? `Сохранить и уведомить (${n})` : `Сохранить (${n})`) : "Изменений нет"}</button>
    </div></div>`);
  }
  function newLabel() {
    const k = 1 + (S.multi ? S.extra.filter(x => String(x.device).trim()).length : 0);
    return k > 1 ? `Создать ${k} ${k < 5 ? "заказа" : "заказов"}` : "Создать заказ";
  }
  function refreshSaveBar(key) { $app.querySelector(".savebar")?.remove(); saveBar(key, location.hash === "#/new" ? 'data-new="1"' : `data-num="${esc(location.hash.slice(2))}"`); }

  // ── новый заказ ─────────────────────────────────────────
  function renderNew() {
    if (!canCreate()) { location.hash = ""; return; }
    if (!S.draft) {
      S.draft = true;
      S.dirty.set("new:" + C.status, CFG.newStatus);
      S.dirty.set("new:" + C.date, today());
      S.dirty.set("new:" + C.type, "Ремонт");
    }
    const head = `<div class="card-head" style="margin-top:14px"><a class="iconbtn" style="background:var(--ink)" href="#" aria-label="Назад">←</a><h1>Новый заказ</h1></div>`;
    renderShell(head + cardBody("new", null, true) +
      `<p class="note" style="margin:14px 4px 0">Статус — «${esc(CFG.newStatus)}». Номер присвоится следующий по порядку; клиенту уйдёт то же сообщение, что при записи в таблицу.</p>`, { search: false });
    saveBar("new", 'data-new="1"');
  }

  // ── запись ──────────────────────────────────────────────
  // Флажки J и L в таблице разные по строкам: где-то это галочка TRUE/FALSE, а где-то
  // галочка со своим значением «Ok» (так её ждут скрипты отчёта и отзыва). Поэтому
  // значение флажка берём из правила ИМЕННО этой строки, а не общее. Раньше (до
  // 25.09.2026) оболочка писала TRUE — и галочка в таблице вставала неправильно.
  async function boolValues(row, cols) {
    const need = cols.filter(c => !S.boolVals[row + ":" + c]);
    if (need.length && !DEMO) {
      const ranges = need.map(c => "ranges=" + A1(c, row)).join("&");
      const g = await api(`?${ranges}&fields=sheets(data(rowData(values(dataValidation))))`);
      (g.sheets?.[0]?.data || []).forEach((d, i) => {
        const cond = d.rowData?.[0]?.values?.[0]?.dataValidation?.condition;
        const vals = cond?.type === "BOOLEAN" ? (cond.values || []).map(x => x.userEnteredValue) : [];
        S.boolVals[row + ":" + need[i]] = vals.length ? { on: vals[0], off: vals[1] ?? "" } : { on: true, off: false };
      });
    }
    return c => S.boolVals[row + ":" + c] || { on: CFG.reportValue, off: "" };
  }
  async function writeCells(row, list) {
    const bools = list.filter(ch => S.bools.has(ch.c)).map(ch => ch.c);
    const bv = bools.length ? await boolValues(row, bools) : null;
    for (const ch of list) {
      const f = F[ch.c];
      if (S.bools.has(ch.c)) { const b = bv(ch.c); ch.w = isTrue(ch.v) ? b.on : b.off; }
      else if (f?.num) { const n = toNum(ch.v); ch.w = n == null ? String(ch.v ?? "") : n; }
      else ch.w = String(ch.v ?? "");
    }
    if (DEMO) return;
    const pack = arr => arr.map(ch => ({ range: `'${CFG.sheet}'!${LETTER(ch.c)}${row}`, values: [[ch.w]] }));
    const entered = list.filter(ch => F[ch.c]?.entered), raw = list.filter(ch => !F[ch.c]?.entered);
    const calls = [];
    if (raw.length) calls.push(api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: pack(raw) }) }));
    if (entered.length) calls.push(api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: pack(entered) }) }));
    await Promise.all(calls);
  }
  async function door(row, num, list) {
    if (DEMO || !CFG.doors.length) return null;
    const body = JSON.stringify({ token: S.token, row, num, changes: list.map(ch => ({ col: ch.c + 1, value: String(ch.w ?? ch.v ?? ""), old: String(ch.old ?? "") })) });
    const all = { ok: true, results: [], statusBackground: "", issued: null };
    for (const url of CFG.doors) {
      const r = await fetch(url + "?action=crm-door", { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
      const j = await r.json().catch(() => ({ ok: false, error: "дверь ответила не JSON (" + r.status + ")" }));
      if (!j.ok) throw new Error(j.error || "дверь не ответила");
      all.results.push(...(j.results || []));
      all.statusBackground = j.statusBackground || all.statusBackground; // последняя дверь шлёт статус и красит H
      if (j.issued != null) all.issued = j.issued;
    }
    return all;
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
    if (list.some(ch => ch.c === C.report && isTrue(ch.v))) return "Отчёт клиенту отправлен ✓";
    return "Уведомления обработаны ✓";
  }
  // Уведомления — в фоне: человек видит «Сохранено» сразу после записи в таблицу (~1 с),
  // а не ждёт, пока обе двери разошлют сообщения (раньше это было ~5 с).
  function doorInBackground(r, num, list) {
    if (DEMO || !CFG.doors.length) return;
    const notify = list.some(ch => F[ch.c]?.door);
    if (!notify) return;
    return door(r.row, num, list).then(j => {
      if (j?.issued != null && j.issued !== cell(r, C.issued)) {
        r.cells[C.issued] = j.issued;
        if (location.hash === "#/" + num && ![...S.dirty.keys()].some(k => k.startsWith(r.row + ":"))) renderCard(num);
      }
      toast(`№${num}: ${doorReport(j, list)}`, null, true);
    }).catch(e => toast(`№${num}: записано в таблицу, но уведомления не ушли — ${e.message}`, null, true));
  }

  async function save(num) {
    const r = S.byNum.get(num); if (!r) return;
    const key = r.row;
    const list = [...S.dirty].filter(([k]) => k.startsWith(key + ":")).map(([k, v]) => { const c = +k.split(":")[1]; return { c, v, old: cell(r, c) }; });
    if (!list.length) return;
    // Выкуп/trade-in/продажа группой: статус — сразу у всех устройств, отчёт — в первой строке.
    const others = new Map(); // строка → изменения
    const gr = groupOf(r);
    if (gr?.shared) {
      const st = list.find(ch => ch.c === C.status), rep = list.find(ch => ch.c === C.report);
      const add = (x, ch) => { if (!others.has(x)) others.set(x, []); others.get(x).push(ch); };
      if (st) for (const x of gr.rows) if (x !== r && cell(x, C.status) !== st.v) add(x, { c: C.status, v: st.v, old: cell(x, C.status) });
      if (rep && gr.head !== r) { list.splice(list.indexOf(rep), 1); S.dirty.delete(key + ":" + C.report); add(gr.head, { c: C.report, v: rep.v, old: cell(gr.head, C.report) }); }
    }
    busy(true);
    try {
      const check = async x => {
        if (DEMO) return;
        const chk = await api(`/values/${A1(0, x.row)}`);
        if (String(chk.values?.[0]?.[0] ?? "").trim() !== String(cell(x, C.num)).trim()) throw new Error("Строка в таблице сдвинулась — обновите список (⟳) и повторите");
      };
      await Promise.all([r, ...others.keys()].map(check));
      await Promise.all([list.length ? writeCells(r.row, list) : null, ...[...others].map(([x, l]) => writeCells(x.row, l))]);
      for (const ch of list) { r.cells[ch.c] = String(ch.w ?? ""); S.dirty.delete(key + ":" + ch.c); }
      for (const [x, l] of others) { for (const ch of l) x.cells[ch.c] = String(ch.w ?? ""); index(x); }
      index(r); S.clients = null;
      render();
      const all = [...list, ...[...others.values()].flat()];
      toast(DEMO ? "Сохранено (демо — в таблицу не пишется)" : all.some(ch => F[ch.c]?.door) ? `Сохранено ✓${others.size ? ` (и у ${others.size} устр. группы)` : ""} Уведомления отправляются…` : "Сохранено ✓", null, true);
      // Двери по очереди: сначала эта строка, потом остальные строки группы.
      [[r, list], ...others].reduce((p, [x, l]) => p.then(() => l.length ? doorInBackground(x, String(cell(x, C.num)).trim(), l) : null), Promise.resolve());
    } catch (e) { busy(false); toast(e.message, null, true); }
  }

  async function create() {
    const get = c => S.dirty.get("new:" + c) ?? "";
    if (!String(get(C.name)).trim() && !String(get(C.phone)).trim()) return toast("Нужно имя или телефон клиента");
    busy(true);
    try {
      // Список полей на каждое устройство: первое — из основных полей формы, остальные —
      // общие поля клиента и сделки плюс свои поля устройства.
      const shared = [...S.dirty].filter(([k]) => k.startsWith("new:")).map(([k, v]) => ({ c: +k.split(":")[1], v, old: "" }));
      const devices = [shared];
      if (S.multi) for (const x of S.extra) {
        if (!String(x.device || "").trim()) continue;
        const own = [[C.device, x.device], [C.imei, x.imei], [C.issue, x.issue], [C.pass, x.pass], [C.master, x.master], [C.total, x.total]]
          .filter(([, v]) => String(v ?? "").trim() !== "").map(([c, v]) => ({ c, v, old: "" }));
        const ownCols = new Set(own.map(o => o.c));
        const base = shared.filter(ch => ![C.device, C.imei, C.issue, C.pass, C.total, C.work, C.buyback].includes(ch.c) && !ownCols.has(ch.c));
        devices.push([...base, ...own]);
      }
      const N = devices.length;
      let row0, num0;
      if (DEMO) {
        row0 = (S.rows.at(-1)?.row || 1) + 1; num0 = Math.max(0, ...S.rows.map(x => +cell(x, C.num) || 0)) + 1;
      } else {
        // Свежий взгляд на колонку A прямо перед записью: номера — следующие, строки — первые пустые.
        const colA = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A:A`)}`);
        const vals = (colA.values || []).map(v => String(v[0] ?? "").trim());
        let last = vals.length; while (last > 1 && !vals[last - 1]) last--;
        num0 = Math.max(0, ...vals.map(v => +v || 0)) + 1;
        row0 = last + 1;
        const probe = await api(`/values/${A1(0, row0, C.linked, row0 + N - 1)}?valueRenderOption=FORMULA`);
        if ((probe.values || []).some(rw => (rw || []).some(v => String(v).trim()))) throw new Error("Строки " + row0 + "–" + (row0 + N - 1) + " не пустые — обновите список и повторите");
      }
      const made = devices.map((fields, i) => {
        const num = String(num0 + i), row = row0 + i;
        const list = [{ c: C.num, v: num }, ...(N > 1 ? [{ c: C.group, v: String(num0), old: "" }] : []), ...fields.map(f => ({ ...f }))]
          .filter(ch => String(ch.v ?? "").trim() !== "" && !(S.bools.has(ch.c) && !isTrue(ch.v)));
        return { num, row, list };
      });
      await Promise.all(made.map(m => writeCells(m.row, m.list)));
      for (const m of made) {
        const cells = []; for (const ch of m.list) cells[ch.c] = String(ch.w ?? "");
        m.rec = { row: m.row, cells }; index(m.rec); S.rows.push(m.rec); S.byNum.set(m.num, m.rec);
      }
      S.clients = null;
      for (const k of [...S.dirty.keys()]) if (k.startsWith("new:")) S.dirty.delete(k);
      S.draft = null; S.multi = false; S.extra = [];
      location.hash = "#/" + made[0].num;
      const nums = N > 1 ? `Заказы №${made[0].num}–${made[N - 1].num}` : `Заказ №${made[0].num}`;
      toast(DEMO ? nums + " созданы (демо)" : `${nums} записан${N > 1 ? "ы" : ""} ✓ Уведомления отправляются…`, null, true);
      // Двери по очереди, заказ за заказом — как если бы строки заполняли в таблице одну за другой.
      made.reduce((p, m) => p.then(() => doorInBackground(m.rec, m.num, m.list.filter(ch => ch.c !== C.num))), Promise.resolve());
    } catch (e) { busy(false); toast(e.message, null, true); }
  }
  function busy(on) { const b = $app.querySelector('[data-act="save"]'); if (b) { b.disabled = on; if (on) b.textContent = "Сохраняю…"; } }

  // ── события ─────────────────────────────────────────────
  const curKey = () => location.hash === "#/new" ? "new" : S.byNum.get(location.hash.slice(2))?.row;
  const curVal = (key, c) => key === "new" ? "" : cell(S.byNum.get(location.hash.slice(2)), c);
  function setDirty(key, c, v) {
    const orig = curVal(key, c);
    const same = S.bools.has(c) ? isTrue(v) === isTrue(orig) : F[c]?.num ? toNum(v) === toNum(orig) && String(v).trim() !== "" : String(v) === String(orig);
    const keepNew = key === "new" && [C.status, C.date, C.type].includes(c);
    if (same && !keepNew) S.dirty.delete(key + ":" + c); else S.dirty.set(key + ":" + c, v);
  }

  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-open],[data-tab],[data-choice],[data-q]"); if (!t) return;
    if (t.dataset.q != null) { S.q = t.dataset.q; S.limit = 60; renderList(); return; }
    if (t.dataset.open) { location.hash = "#/" + t.dataset.open; return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = 60; renderList(); return; }
    if (t.dataset.choice != null) {
      const key = curKey(), c = +t.dataset.choice;
      // Пустой тип и «Ремонт» — одно и то же: не считаем это изменением.
      const v = t.dataset.value, orig = curVal(key, c);
      if (c === C.type && key !== "new" && dealKey(v) === "repair" && dealKey(orig) === "repair") S.dirty.delete(key + ":" + c);
      else setDirty(key, c, v);
      if (c === C.type) { const y = window.scrollY; render(); window.scrollTo(0, y); return; } // подписи и поля меняются по типу
      $app.querySelectorAll(`[data-choice="${c}"]`).forEach(b => b.setAttribute("aria-pressed", String(b === t)));
      refreshSaveBar(key); return;
    }
    const act = t.dataset.act;
    if (act === "login") {
      try { await signIn("select_account"); S.error = ""; await load(); } catch (err) { S.error = err.message; render(); }
    } else if (act === "logout") signOut();
    else if (act === "reload") { if (!DEMO && !S.token) render(); else load(); }
    else if (act === "more") { S.limit += 100; renderList(); }
    else if (act === "multi") { S.multi = t.checked; if (S.multi && !S.extra.length) S.extra.push(blankDevice()); if (!S.multi) S.extra = []; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "adddev") { S.extra.push(blankDevice()); const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "rmdev") { S.extra.splice(+t.dataset.i, 1); if (!S.extra.length) S.multi = false; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "report") { const key = curKey(); S.dirty.set(key + ":" + C.report, CFG.reportValue); t.textContent = "Отчёт уйдёт после «Сохранить»"; t.disabled = true; refreshSaveBar(key); }
    else if (act === "save") t.dataset.new ? create() : save(t.dataset.num);
    else if (act === "discard") { const key = curKey(); for (const k of [...S.dirty.keys()]) if (k.startsWith(key + ":")) S.dirty.delete(k); if (key === "new") { S.draft = null; S.multi = false; S.extra = []; location.hash = ""; } else render(); }
  });
  function onEdit(e) {
    const t = e.target;
    if (t.dataset.act === "search") {
      clearTimeout(onEdit.t);
      onEdit.t = setTimeout(() => { S.q = t.value; S.limit = 60; const pos = t.selectionStart; renderList(); const s = $app.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); }, 120);
      return;
    }
    if (t.dataset.extra != null) { S.extra[+t.dataset.extra][t.dataset.field] = t.value; if (t.dataset.field === "device") refreshSaveBar("new"); return; }
    if (t.dataset.edit == null) return;
    const key = curKey(); if (key == null) return;
    const c = +t.dataset.edit, v = t.type === "checkbox" ? t.checked : t.value;
    setDirty(key, c, v);
    t.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c));
    if (t.type === "checkbox") t.nextElementSibling.textContent = t.checked ? "Да" : "Нет";
    refreshSaveBar(key);
    if (key === "new" && (c === C.name || c === C.phone)) { clearTimeout(onEdit.ac); onEdit.ac = setTimeout(() => suggest(c, t.value), 120); }
    if (F[c]?.num || c === C.linked) {
      const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
      const val = x => { const k = key + ":" + x; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, x) : ""); };
      const box = $app.querySelector(".margin"); if (box) box.innerHTML = moneySummary(dealKey(val(C.type)), val, r);
    }
  }
  // ── подсказки клиента в новом заказе ─────────────────────
  // Набрал 3+ буквы имени или фамилии (или 4+ цифры телефона) — список клиентов из базы.
  // Выбрал клиента: один телефон — подставился сам; несколько — выбираешь номер вторым шагом.
  function suggest(c, value) {
    const box = document.getElementById("ac-" + c); if (!box) return;
    const list = findClients(value);
    box.innerHTML = list.map(cl => {
      const p = phonesOf(cl);
      return `<button type="button" class="ac-item" data-client="${esc(cl.key)}" data-from="${c}"><b>${esc(cl.name)}</b>
        <span>${cl.count} ${ordersWord(cl.count)} · ${p.length > 1 ? p.length + " телефона" : esc(p[0]?.text || "без телефона")} · последний: ${esc(cell(cl.last, C.device) || "—")}, ${esc(String(cell(cl.last, C.date)).slice(0, 10))}</span></button>`;
    }).join("");
  }
  function fillField(c, v) {
    const inp = $app.querySelector(`[data-edit="${c}"]`); if (inp) inp.value = v;
    setDirty("new", c, v); inp?.closest(".field")?.classList.add("is-dirty");
  }
  function pickClient(key, fromPhone) {
    const cl = clients().find(x => x.key === key); if (!cl) return;
    fillField(C.name, cl.name);
    const ps = phonesOf(cl), typed = normDigits(digits($app.querySelector(`[data-edit="${C.phone}"]`)?.value || ""));
    const byTyped = fromPhone && typed.length >= 4 ? ps.find(p => p.d.includes(typed)) : null;
    const nameBox = document.getElementById("ac-" + C.name), phoneBox = document.getElementById("ac-" + C.phone);
    nameBox.innerHTML = `<div class="ac-info">Был у нас ${cl.count} ${ordersWord(cl.count)}; последний — №${esc(cell(cl.last, C.num))}, ${esc(cell(cl.last, C.device) || "—")}, ${esc(String(cell(cl.last, C.date)).slice(0, 10))}</div>`;
    if (byTyped || ps.length === 1) { fillField(C.phone, (byTyped || ps[0]).text); phoneBox.innerHTML = ""; }
    else if (ps.length > 1) phoneBox.innerHTML = `<div class="ac-info">У клиента ${ps.length} телефона — выберите:</div>` +
      ps.map(p => `<button type="button" class="ac-item" data-phone="${esc(p.text)}"><b>📞 ${esc(p.text)}</b><span>последний раз ${esc(String(p.date).slice(0, 10))}</span></button>`).join("");
    refreshSaveBar("new");
  }
  // pointerdown, а не click: иначе поле теряет фокус раньше, чем выбор успевает сработать.
  document.addEventListener("pointerdown", e => {
    const it = e.target.closest(".ac-item"); if (!it) return;
    e.preventDefault();
    if (it.dataset.client) pickClient(it.dataset.client, it.dataset.from === String(C.phone));
    else if (it.dataset.phone) { fillField(C.phone, it.dataset.phone); document.getElementById("ac-" + C.phone).innerHTML = ""; refreshSaveBar("new"); }
  });
  document.addEventListener("input", onEdit);
  document.addEventListener("change", e => { if ((e.target.tagName === "SELECT" || e.target.type === "checkbox") && e.target.dataset.act !== "multi") onEdit(e); });
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  window.addEventListener("beforeunload", e => { if ([...S.dirty.keys()].some(k => !k.startsWith("new:"))) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.rows.length && Date.now() - S.loadedAt > 120e3 && !S.dirty.size && !location.hash.startsWith("#/")) load();
  });

  // ── старт ───────────────────────────────────────────────
  const t = saved();
  if (t) S.token = t.t;
  if (DEMO || S.token) load(); else render();
})();
