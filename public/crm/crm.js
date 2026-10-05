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
    lastCol: "AI", // AH–AI «На связи» (03.10.2026); до этого — AG
    // Двери — один и тот же CrmDoor.js, развёрнутый из-под двух аккаунтов, потому что
    // onEdit-триггеры разнесены (владелец, 25.09.2026): рабочий ironsapple держит только
    // Google Контакты, дату выдачи и «Историю статусов» (onEditTrigger), личный — всё
    // остальное (сообщения клиенту, отчёт, мастер). Каждая дверь исполняет только свои
    // триггеры. Порядок — doorOrder(): с v44 (03.10.2026) личная первой, чтобы сообщение клиенту не
    // ждало ~45 с Google-контакта; рабочая первой — только для отчёта (L) и отзыва (J), им нужна дата
    // выдачи. Раньше было «всегда рабочая, потом личная».
    doors: [
      "https://script.google.com/macros/s/AKfycbwHC5_EA-wndVqLcRW0ehkZ_r56Hcji1cqmwGgfCF7vY7a13_35T4ckh5n6YE-GoXO7/exec", // ironsapple, v75 (с 03.10.2026 выкладывается `clasp -u ironsapple`)
      "https://script.google.com/macros/s/AKfycbyOtzn7cQARc_H9heNEvukPwMhsOapCMc8BNNLi1IBZ9zLABBpb2wJvePbHnpQLPKbr/exec", // личный, v77
    ],
    newStatus: "Принят на диагностику",
    // Заказы бота для «Продажи» (план 93 §11.17): бот пишет их в D1 с 26.09.2026.
    botOrders: "https://order-bot.4489530.workers.dev/crm/orders",
    // Товары для «Продажи» (v47): каталог новых и б/у из бота; «продано» для б/у после оформления.
    botGoods: "https://order-bot.4489530.workers.dev/crm/goods",
    botUsedSold: "https://order-bot.4489530.workers.dev/crm/used/sold",
    botSupplier: "https://order-bot.4489530.workers.dev/crm/supplier", // запрос поставщику (v51)
    botAuth: "https://order-bot.4489530.workers.dev/crm/auth", // долгий вход (v51)
    siteOrdersSheet: "заказы с сайта",
    reportValue: "Ok",
    // Склад запчастей Витали (v31, 02.10.2026): остатки — колонка I листа «Запчасти Витали»,
    // журнал — «Запчасти — движение». publicUrl — публичная таблица для Витали (только остатки).
    stock: { sheet: "Запчасти Витали", gid: 1838809765, ledger: "Запчасти — движение", supplier: "Виталя Ростов", publicUrl: "https://docs.google.com/spreadsheets/d/1r7nxyCG4dcAmMqFKQ_xP2Ry5bR7iCyPh7CXfwSNLRmw/edit",
      own: "Склад — свои позиции", ownGid: 1960400593 }, // v33: всё, что добавлено руками (свои варианты Витали, другие поставщики, доноры)
  };

  // Колонки «Листа заказов» (0 = A). Сверено с шапкой листа 25.09.2026.
  const C = { num: 0, date: 1, name: 2, phone: 3, device: 4, issue: 5, work: 6, status: 7, issued: 8,
    review: 9, report: 11, comment: 12, warranty: 13, parts: 14, master: 15, total: 16, labor: 17,
    partCost: 18, extra: 19, partFrom: 20, source: 21,
    discount: 22, // W «Скидка» — «500 ₽» или «10%»; Q «Итого» уже со скидкой (28.09.2026)
    // Добавлены 25.09.2026 (план 93 §11.3): K «Пароль», AC–AF — тип сделки и её данные.
    pass: 10, type: 28, imei: 29, buyback: 30, linked: 31,
    group: 32, // AG — «Группа»: № первого заказа, если устройств у клиента несколько (26.09.2026)
    // AH–AI «На связи» (03.10.2026, план 93 §11.38): телефон клиента в ремонте — уведомления
    // уходят этому человеку, а заказ остаётся за клиентом (C/D). Логика — ContactPerson.js.
    contactName: 33, contactPhone: 34,
    gcontact: 23 }; // X «Google Contact ID» — пишет оболочка, если контакт заведён заранее (v45)
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
  //  calc   — в клетке формула таблицы: показываем, но не пишем (запись стёрла бы формулу).
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
    // R = Q − S − T — формула таблицы. До 26.09.2026 поле было редактируемым: число из
    // оболочки молча затирало формулу (так в истории 137 строк с R, вписанной руками).
    [C.labor]: { label: "Чистая работа, ₽", num: true, calc: true },
    [C.partCost]: { label: "Запчасть (закуп), ₽", num: true, free: true },
    [C.extra]: { label: "Сторонний мастер / расходы, ₽", num: true },
    [C.partFrom]: { label: "Откуда запчасть" },
    [C.source]: { label: "Источник клиента" },
    // Без door: сама правка ничего не шлёт. Отправить на новый номер — кнопкой «Отправить статус ещё раз».
    [C.contactName]: { label: "Имя того, кто на связи" },
    [C.contactPhone]: { label: "Телефон того, кто на связи", tel: true },
    [C.pass]: { label: "Пароль устройства 🔑" },
    [C.type]: { label: "Тип сделки", door: true },
    [C.imei]: { label: "IMEI / S\\N", door: true }, // AD1 в таблице — «IMEI / S\N» (28.09.2026)
    [C.buyback]: { label: "Выкуп / зачёт, ₽", num: true, door: true },
    [C.linked]: { label: "Связанная сделка №" },
    [C.group]: { label: "Группа" },
    [C.discount]: { label: "Скидка" },
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
  // Подписи полей по типу: одна и та же колонка значит разное в ремонте, выкупе и продаже.
  // Пересмотрено 26.09.2026 по замечанию владельца: в продаже стояли ремонтные подписи.
  const LABELS = {
    repair:   { [C.device]: "Устройство", [C.imei]: "IMEI / S\\N (по желанию)", [C.issue]: "Неисправность / с чем пришёл", [C.work]: "Выполненные работы",
                [C.total]: "Итого, ₽ (платит клиент)", [C.date]: "Дата приёма", [C.issued]: "Дата выдачи" },
    buyback:  { [C.device]: "Что выкупаем", [C.issue]: "Дефекты", [C.work]: "Состояние и комплект (уйдёт клиенту в отчёте)",
                [C.buyback]: "Сумма выкупа (платим клиенту), ₽", [C.extra]: "Прочие расходы, ₽", [C.date]: "Дата обращения", [C.issued]: "Дата выкупа" },
    parts:    { [C.device]: "Что выкупаем на запчасти", [C.issue]: "Неисправности", [C.work]: "Что годится на детали",
                [C.buyback]: "Сумма выкупа (платим клиенту), ₽", [C.extra]: "Прочие расходы, ₽", [C.date]: "Дата обращения", [C.issued]: "Дата выкупа" },
    tradein:  { [C.device]: "Что сдаёт клиент", [C.issue]: "Состояние сданного", [C.work]: "Что выдали взамен (модель, IMEI)", [C.warranty]: "Гарантия на выданное",
                [C.total]: "Доплата клиента, ₽", [C.buyback]: "Зачёт за сданное, ₽", [C.partCost]: "Закупка выданного, ₽", [C.extra]: "Прочие расходы, ₽",
                [C.date]: "Дата обращения", [C.issued]: "Дата обмена" },
    sale_used:{ [C.device]: "Что продаём", [C.issue]: "Примечание", [C.work]: "Подготовка перед продажей", [C.warranty]: "Гарантия магазина",
                [C.total]: "Цена продажи, ₽", [C.partCost]: "Себестоимость, ₽", [C.extra]: "Прочие расходы, ₽", [C.linked]: "Из какой сделки устройство (№ выкупа)",
                [C.date]: "Дата обращения", [C.issued]: "Дата продажи" },
    sale_new: { [C.device]: "Что продаём", [C.issue]: "Примечание", [C.work]: "Комплектация", [C.warranty]: "Гарантия",
                [C.total]: "Цена продажи, ₽", [C.partCost]: "Закупка, ₽", [C.extra]: "Прочие расходы, ₽", [C.date]: "Дата обращения", [C.issued]: "Дата продажи" },
    other:    { [C.work]: "Что сделано", [C.total]: "Итого, ₽ (платит клиент)" },
  };
  // Что по типу сделки вообще не показываем. Мастер в выкупе и продаже не нужен: его
  // назначение шлёт мастеру «Для тебя новый заказ!» — о продаже это сбивает с толку.
  // Пароль — только для устройства, которое остаётся у нас в ремонте.
  const HIDE = {
    repair: [], other: [],
    buyback:  [C.master, C.pass, C.parts, C.partFrom, C.warranty, C.labor, C.total, C.partCost],
    parts:    [C.master, C.pass, C.parts, C.partFrom, C.warranty, C.labor, C.total, C.partCost],
    tradein:  [C.master, C.pass, C.parts, C.partFrom, C.labor],
    sale_used:[C.master, C.pass, C.parts, C.partFrom, C.labor],
    sale_new: [C.master, C.pass, C.parts, C.partFrom, C.labor, C.linked],
  };
  // Поля ОДНОГО устройства — одинаковые у каждого устройства заказа, включая первое
  // (владелец, 26.09.2026: «карточки товаров не идентичны» — у первого цена была в общем
  // блоке «Деньги», у остальных не было гарантии и закупки). Клиент, комментарий, дата,
  // источник и прочие расходы — общие для всех устройств.
  const PER_DEVICE = {
    repair:   [C.device, C.imei, C.issue, C.master, C.pass, C.total],
    other:    [C.device, C.imei, C.issue, C.work, C.master, C.pass, C.total],
    buyback:  [C.device, C.imei, C.issue, C.work, C.buyback],
    parts:    [C.device, C.imei, C.issue, C.work, C.buyback],
    tradein:  [C.device, C.imei, C.issue, C.work, C.warranty, C.total, C.buyback, C.partCost],
    sale_used:[C.device, C.imei, C.issue, C.work, C.warranty, C.linked, C.total, C.partCost],
    sale_new: [C.device, C.imei, C.issue, C.work, C.warranty, C.total, C.partCost],
  };
  const AREAS = [C.issue, C.work];
  // Раскладка полей устройства: короткие — попарно, тексты — рядом, деньги — в строку.
  function deviceGrid(cols, fieldFn) {
    const text = cols.filter(c => !AREAS.includes(c) && !F[c]?.num), areas = cols.filter(c => AREAS.includes(c)), nums = cols.filter(c => F[c]?.num);
    return (text.length ? `<div class="grid2">${text.map(fieldFn).join("")}</div>` : "") +
      (areas.length ? `<div class="grid2">${areas.map(fieldFn).join("")}</div>` : "") +
      (nums.length ? `<div class="grid4">${nums.map(fieldFn).join("")}</div>` : "");
  }
  const TYPE_UI = {
    repair:   { multi: "Клиент сдаёт несколько устройств", start: "Принят на диагностику" },
    buyback:  { multi: "Выкупаем несколько устройств", start: "Выкуплен" },
    parts:    { multi: "Выкупаем на запчасти несколько устройств", start: "Выкуплен" },
    tradein:  { multi: "Клиент сдаёт несколько устройств", start: "Обмен оформлен" },
    sale_used:{ multi: "Продаём несколько устройств", start: "Продан" },
    sale_new: { multi: "Продаём несколько устройств", start: "Продан" },
    other:    { multi: "Несколько устройств в сделке", start: "Принят на диагностику" },
  };
  // Статусы, уместные для типа (текущий статус строки показывается всегда).
  const DEAL_FINAL = ["выкуплен", "разобран", "обмен оформлен", "продан"];
  // «Выполнен» — сразу под «Готов ожидает клиента» (владелец, 03.10.2026). В списке таблицы он
  // 13-й, после пяти отказов, и в оболочке приходилось тянуться вниз мимо них. Порядок в самой
  // таблице не меняем — только здесь; остальные статусы стоят, как стояли.
  function doneAfterReady(list) {
    const out = list.slice(), i = out.findIndex(x => norm(x).startsWith("выполнен"));
    if (i < 0) return out;
    const [done] = out.splice(i, 1), j = out.findIndex(x => norm(x).startsWith("готов"));
    out.splice(j < 0 ? i : j + 1, 0, done);
    return out;
  }
  function statusesFor(dk) {
    const all = doneAfterReady((S.opts[C.status] || []).filter(x => !isSilent(x)));
    const pick = names => all.filter(x => names.some(n => norm(x).startsWith(n)));
    if (dk === "repair") return all.filter(x => !DEAL_FINAL.some(n => norm(x).startsWith(n)));
    if (dk === "buyback") return pick(["на согл", "выкуплен"]);
    if (dk === "parts") return pick(["на согл", "выкуплен", "разобран"]);
    if (dk === "tradein") return pick(["на согл", "ждем предоплату", "обмен оформлен"]);
    if (dk === "sale_used" || dk === "sale_new") return pick(["ждем предоплату", "продан"]);
    return all;
  }
  const labelFor = (c, key) => LABELS[key]?.[c] || F[c]?.label || "";
  // Меняется ли поле здесь прямо сейчас. С дверью — всё. Без двери — поля без реакций, а
  // поля ремонта (устройство, работы, сумма…) ещё и пока отчёт клиенту не отправлен: их
  // реакция — правка уже отправленного отчёта, а если отчёта нет, реагировать нечему.
  const editable = (c, r) => {
    const f = F[c]; if (!f) return false;
    if (!f.door || CFG.doors.length || DEMO) return true;
    return !f.notify && c !== C.name && c !== C.phone && !!r && !isTrue(cell(r, C.report));
  };

  const FINAL = ["выполнен", "отказ от ремонта", "ремонт невозможен", "без ремонта", "продан", "разобран", "выкуплен", "обмен оформлен", "закрыт"];
  // «Закрыт» — архивное закрытие без уведомления клиенту (28.09.2026: 1475 заказов старше
  // двух месяцев закрыты разом). В таблице для простоты просто «Закрыт», в оболочке — с
  // пояснением. Кнопкой в оболочке не ставится; руками в таблице — клиенту ничего не уходит.
  const CLOSED_LABEL = "Закрыт по сроку давности — состояние неизвестно";
  const stLabel = st => norm(st) === "закрыт" ? CLOSED_LABEL : st;
  // «Закрыт без уведомления» — то же тихое закрытие, но руками из карточки (владелец,
  // 28.09.2026). Отдельное значение, чтобы не путать со старыми «по сроку давности».
  // Суммы не требует. В дверь не уходит: у двери закреплена версия кода до 28.09, и она
  // отправила бы клиенту сообщение — статус пишется напрямую, «Историю статусов» оболочка
  // дополняет сама (как это делает onEditTrigger).
  const SILENT = "Закрыт без уведомления";
  const isSilent = st => norm(st).startsWith("закрыт");
  const ORDER = ["принят на диагностику", "ждем предоплату", "заказана запчасть", "готов"];
  const isFinal = s => FINAL.some(f => norm(s).startsWith(f));
  const isReady = s => norm(s).startsWith("готов");
  const statusKind = s => {
    const n = norm(s);
    if (!n) return "new";
    if (n.startsWith("готов")) return "ready";
    if (["выполнен", "продан", "выкуплен", "обмен оформлен", "разобран", "закрыт"].some(x => n.startsWith(x))) return "done";
    if (n.startsWith("отказ") || n.startsWith("ремонт невозможен") || n.startsWith("без ремонта")) return "stop";
    if (n.startsWith("жд") || n.startsWith("заказана")) return "wait";
    return "new";
  };

  const DEMO = new URLSearchParams(location.search).has("demo");
  const S = { token: null, email: "", rows: [], byNum: new Map(), gid: 0, loadedAt: 0, loading: false,
    since: new Map(), tab: "work", q: "", limit: 60, dirty: new Map(), error: "", opts: {}, bools: new Set(), draft: null, boolVals: {}, multi: false, extra: [],
    parts: new Map(), svc: null, pp: null, view: null, // parts: ключ карточки → строки запчастей; svc — прайс сайта; pp — окно «работа из прайса»
    stock: null, skDirty: new Map(), skFailed: null, sk: { q: "", grp: "", node: "", ser: "", cls: "", tier: "", src: "", only: null, limit: 150 }, skAdd: null, skSend: new Map(), skSent: null, skBadAdd: null }; // склад Витали (v31); skSend/skSent — брак на возврат (v48), skBadAdd — «＋ Добавить брак» (v50)
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
    clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, typeof long === "number" ? long : action || long ? 9000 : 3500);
  }
  function sheetLink(row, col) { return `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/edit#gid=${S.gid}&range=${LETTER(col)}${row}`; }

  // ── вход ────────────────────────────────────────────────
  // Вход помнится на устройстве (владелец, 26.09.2026: «закрыл страницу — приходится входить
  // заново»). Токен Google живёт час; он лежит в localStorage, поэтому закрыть и открыть
  // страницу в течение часа можно без входа. Когда час на исходе, токен обновляется сам на
  // ближайшем нажатии (Google требует для этого действие человека — окно мелькнёт и
  // закроется), а если страница была закрыта дольше — одна кнопка «Продолжить как …» без
  // выбора аккаунта. Раньше токен лежал в sessionStorage и пропадал с закрытием вкладки.
  let tokenClient = null, refreshing = null;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  function saved() { const t = store.get("crm.tok"); return t && t.exp > Date.now() + 60e3 ? t : null; }
  const lastEmail = () => store.get("crm.who") || "";
  function signIn(prompt, hint) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google ещё грузится — нажмите ещё раз через пару секунд"));
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({ client_id: CFG.clientId, scope: CFG.scope, callback: () => {} });
      tokenClient.callback = r => {
        if (r.error) return reject(new Error(r.error === "access_denied" ? "Вход отменён: на экране Google нажали «Отмена» или закрыли его (access_denied)" : "Google не пустил: " + (r.error_description || r.error)));
        // С 2024 года Google даёт снять галочку у каждой области. Без «таблиц» токен есть, а
        // читать базу нельзя — раньше это выглядело как «нет доступа к базе» (28.09.2026, Артур).
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/spreadsheets")) {
          store.set("crm.consent", true);
          return reject(new Error("Google не выдал доступ к таблицам: на экране входа нужно отметить галочку «Просматривать, изменять, создавать и удалять таблицы Google». Нажмите «Войти» ещё раз и отметьте её."));
        }
        store.del("crm.consent");
        S.token = r.access_token;
        store.set("crm.tok", { t: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 });
        resolve();
      };
      tokenClient.error_callback = e => reject(new Error(e?.type === "popup_closed" ? "Окно входа закрыли" : e?.type === "popup_failed_to_open"
        ? "Браузер не открыл окно входа Google — разрешите всплывающие окна для 1iron.ru" + (inApp() ? " или откройте ссылку в Safari/Chrome" : "") : "Не удалось войти" + (e?.type ? " (" + e.type + ")" : "")));
      // login_hint — сам выбирает нужный аккаунт. До v46 передавался только `hint` (старое имя), и при
      // нескольких Google-аккаунтах в браузере Google каждый раз показывал выбор аккаунта.
      tokenClient.requestAccessToken({ prompt: store.get("crm.consent") ? "consent" : prompt ?? "", ...(hint ? { hint, login_hint: hint } : {}) });
    });
  }
  // ── долгий вход (v51, 05.10.2026) ────────────────────────────────────────────────────
  // Владелец: «при простое просит войти — можно сохранить вход надолго?». Токен выше живёт час и
  // продлевается только нажатием (v46: окно Google мелькает). Долгий вход: один раз — код Google
  // (окно с выбором аккаунта и согласием «доступ офлайн»), бот заказов меняет его на токены и
  // хранит refresh у себя, а сюда отдаёт ключ сессии (crm.sid). Дальше новый токен берётся по
  // ключу за 5 минут до конца часа — без окон и без нажатий; ключ живёт 30 дней с последнего
  // входа. Включается, когда в боте задан секрет OAuth-клиента (/crm/auth/status → enabled);
  // до этого — вход как в v46.
  const sidGet = () => store.get("crm.sid") || "";
  async function authPost(action, body) {
    const r = await fetch(`${CFG.botAuth}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }
  function takeToken(x) {
    S.token = x.access_token;
    store.set("crm.tok", { t: x.access_token, exp: Date.now() + ((x.expires_in || 3600) - 60) * 1000 });
    if (x.email) store.set("crm.who", x.email);
  }
  // Новый токен по ключу сессии. false — ключа нет, он истёк или Google его отозвал.
  async function sidRefresh() {
    const sid = sidGet(); if (!sid || DEMO) return false;
    try {
      const r = await authPost("refresh", { sid });
      if (r.ok) { takeToken(r); return true; }
      if (r.status === 401) store.del("crm.sid");
    } catch {}
    return false;
  }
  function codeSignIn(hint) {
    return new Promise((resolve, reject) => {
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google ещё грузится — нажмите ещё раз через пару секунд"));
      google.accounts.oauth2.initCodeClient({
        client_id: CFG.clientId, scope: CFG.scope, ux_mode: "popup", ...(hint ? { login_hint: hint } : { select_account: true }),
        callback: async r => {
          if (r.error) return reject(new Error(r.error === "access_denied" ? "Вход отменён: на экране Google нажали «Отмена» или закрыли его" : "Google не пустил: " + (r.error_description || r.error)));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/spreadsheets"))
            return reject(new Error("Google не выдал доступ к таблицам: на экране входа нужно отметить галочку «Просматривать, изменять, создавать и удалять таблицы Google». Нажмите «Войти» ещё раз и отметьте её."));
          try {
            const x = await authPost("code", { code: r.code });
            if (!x.ok) return reject(new Error(x.error || "бот заказов не принял вход"));
            takeToken(x);
            if (x.sid) store.set("crm.sid", x.sid); else if (x.note) toast(x.note, null, true);
            resolve();
          } catch (e) { reject(new Error("Бот заказов не ответил: " + e.message)); }
        },
        error_callback: e => reject(new Error(e?.type === "popup_closed" ? "Окно входа закрыли" : e?.type === "popup_failed_to_open"
          ? "Браузер не открыл окно входа Google — разрешите всплывающие окна для 1iron.ru" + (inApp() ? " или откройте ссылку в Safari/Chrome" : "") : "Не удалось войти" + (e?.type ? " (" + e.type + ")" : ""))),
      }).requestCode();
    });
  }
  // Встроенный браузер мессенджера: Google там вход запрещает (disallowed_useragent).
  const inApp = () => /Telegram|WhatsApp|Instagram|FBAN|FBAV|Line\/|VKClient|; wv\)/i.test(navigator.userAgent);
  function signOut() {
    // С долгим входом токен у Google НЕ отзываем: отзыв access-токена гасит и refresh, а он общий
    // для всех устройств владельца. Выход — удалить ключ этого устройства в боте.
    const sid = sidGet();
    if (sid) authPost("logout", { sid }).catch(() => {});
    else if (S.token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(S.token, () => {});
    store.del("crm.tok"); store.del("crm.who"); store.del("crm.sid");
    S.token = null; S.rows = []; S.byNum.clear(); location.hash = ""; render();
  }

  async function api(path, opts = {}, again) {
    // Идёт тихое продление входа (клик после простоя) — дождаться нового токена, а не падать в 401.
    if (refreshing) await refreshing;
    const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + CFG.sheetId + path, {
      ...opts, headers: { Authorization: "Bearer " + S.token, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (r.status === 401 && refreshing && !again) { await refreshing; return api(path, opts, true); }
    if (r.status === 401 && !again && sidGet()) { refreshing ||= sidRefresh().finally(() => { refreshing = null; }); if (await refreshing) return api(path, opts, true); }
    if (r.status === 401) { store.del("crm.tok"); S.token = null; setTimeout(render, 0); throw Object.assign(new Error("Вход истёк — нажмите «Продолжить»"), { code: 401 }); }
    if (r.status === 403) {
      const why = await r.json().catch(() => ({}));
      const msg = String(why?.error?.message || ""), who = S.email ? ` Вы вошли как ${S.email}.` : "";
      if (/scope/i.test(msg)) { store.set("crm.consent", true); throw Object.assign(new Error("Google не выдал доступ к таблицам: при входе нужно отметить галочку про таблицы Google. Нажмите «Войти другим аккаунтом» и отметьте её."), { code: 403 }); }
      throw Object.assign(new Error(opts.method && opts.method !== "GET"
        ? "Google не дал записать: у вашего аккаунта доступ к таблице только на просмотр." + who
        : "У этого Google-аккаунта нет доступа к базе." + who + " Если доступ открыт на другой адрес — войдите им; иначе попросите владельца открыть доступ к таблице."), { code: 403 });
    }
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
        const [metaR, whoR] = await Promise.allSettled([
          api("?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))"),
          fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + S.token } }).then(r => r.ok ? r.json() : {}),
        ]);
        S.email = whoR.value?.email || "";
        if (metaR.status === "rejected") {
          const e = metaR.reason;
          if (e?.code === 403 && S.email && !e.message.includes(S.email)) e.message = e.message.replace("нет доступа к базе.", `нет доступа к базе. Вы вошли как ${S.email}.`);
          throw e;
        }
        const meta = metaR.value;
        if (S.email) store.set("crm.who", S.email);
        const sh = meta.sheets.find(s => s.properties.title === CFG.sheet);
        if (!sh) throw new Error("В таблице нет листа «" + CFG.sheet + "»");
        S.gid = sh.properties.sheetId;
        const last = sh.properties.gridProperties.rowCount;
        const data = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A2:${CFG.lastCol}${last}`)}?valueRenderOption=FORMATTED_VALUE`);
        setRows((data.values || []).map((cells, i) => ({ row: i + 2, cells })));
        await loadOptions().catch(e => console.warn("списки:", e));
        loadHistory().catch(e => console.warn("история статусов:", e)); // в фоне, не держит загрузку
      }
      S.loadedAt = Date.now();
    } catch (e) {
      S.error = e.message;
      if (e.code === 401) S.token = null;
    }
    S.loading = false; render();
  }
  function setRows(list) {
    // Строка — заказ, если есть номер И хоть что-то ещё: номера в таблице проставлены
    // заранее на сотни строк вперёд, и пустые заготовки не должны попадать в «В работе».
    S.rows = list.filter(r => String(r.cells[C.num] ?? "").trim() &&
      [C.name, C.phone, C.device, C.issue, C.status].some(c => String(r.cells[c] ?? "").trim()));
    S.byNum.clear();
    for (const r of S.rows) { S.byNum.set(String(r.cells[C.num]).trim(), r); index(r); }
    S.clients = null; // книга клиентов строится при первом обращении
  }
  // Поисковые ключи строки считаются один раз при загрузке (и после правки строки), а не
  // на каждое нажатие клавиши: по 7–8 тысячам строк поиск так идёт за миллисекунды.
  function index(r) {
    r.hay = norm([C.num, C.name, C.phone, C.contactName, C.contactPhone, C.device, C.issue, C.work, C.parts, C.comment, C.master, C.imei, C.type, C.status].map(c => c === C.status ? stLabel(r.cells[c] ?? "") : r.cells[c] ?? "").join(" "));
    r.ph = phones(r.cells[C.phone]).map(p => p.d);
    // Номер «на связи» — только для поиска (звонит дочь: «я по папиному телефону»). В r.ph его
    // класть нельзя: по r.ph склеивается книга клиентов, и владелец слился бы с человеком на связи.
    r.ph2 = phones(r.cells[C.contactPhone]).map(p => p.d);
    r.nameN = norm(String(r.cells[C.name] ?? "").split("\n")[0]);
  }
  function normDigits(d) { return d.length === 11 && d[0] === "8" ? "7" + d.slice(1) : d; }
  const isDigitQuery = q => /^[\d\s+()\-]+$/.test(q);

  // Книга клиентов из самой базы: одно имя — один клиент, у клиента может быть несколько
  // телефонов. Свежие написание имени и телефоны — сверху.
  // Книга клиентов из самой базы. Клиент = общий номер телефона (владелец, 28.09.2026:
  // «если номер один — значит это один клиент»). Строки с общим номером склеиваются, даже
  // если имя записано по-разному («Алексей Шишкин» / «Алексей чоп-чоп» — 626 таких номеров).
  // Заказ без телефона присоединяется к клиенту с точно таким же именем, если такой клиент
  // один; иначе такие заказы группируются между собой по имени.
  // Раньше (v6–v22) клиентом было одно имя: разные люди с одинаковым именем склеивались
  // («александр» — 18 разных номеров), а один человек с двумя написаниями — двоился.
  function clients() {
    if (S.clients) return S.clients;
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
    const withPhone = [], noPhone = [], byPhone = new Map();
    for (const r of S.rows) {
      const ps = phones(cell(r, C.phone));
      if (!ps.length && !r.nameN) continue;
      parent.set(r, r);
      if (!ps.length) { noPhone.push(r); continue; }
      withPhone.push(r);
      for (const p of ps) { if (byPhone.has(p.d)) union(r, byPhone.get(p.d)); else byPhone.set(p.d, r); }
    }
    const rootsByName = new Map();
    for (const r of withPhone) if (r.nameN) { if (!rootsByName.has(r.nameN)) rootsByName.set(r.nameN, new Set()); rootsByName.get(r.nameN).add(find(r)); }
    const lone = new Map();
    for (const r of noPhone) {
      const roots = rootsByName.get(r.nameN);
      if (roots?.size === 1) union(r, [...roots][0]);
      else if (lone.has(r.nameN)) union(r, lone.get(r.nameN)); else lone.set(r.nameN, r);
    }
    const map = new Map();
    for (const r of parent.keys()) {
      const root = find(r);
      let c = map.get(root);
      if (!c) map.set(root, c = { key: "c" + root.row, name: "", names: new Map(), words: new Set(), phones: new Map(), rows: [], count: 0, last: null });
      c.rows.push(r);
    }
    for (const c of map.values()) {
      c.rows.sort((a, b) => a.row - b.row);
      c.count = c.rows.length; c.last = c.rows[c.rows.length - 1];
      for (const r of c.rows) {
        const nm = String(cell(r, C.name)).split("\n")[0].trim();
        if (nm) { c.name = nm; c.names.set(r.nameN, nm); r.nameN.split(" ").forEach(w => w && c.words.add(w)); }
        for (const p of phones(cell(r, C.phone))) c.phones.set(p.d, { text: p.text, d: p.d, row: r.row, date: cell(r, C.date) });
      }
      c.words = [...c.words];
      c.aka = [...c.names.values()].filter(n => norm(n) !== norm(c.name));
    }
    return (S.clients = [...map.values()]);
  }
  const clientOfRow = r => clients().find(c => c.rows.includes(r));
  function clientByPhone(text) {
    const ds = phones(text).map(p => p.d); if (!ds.length) return null;
    return clients().find(c => ds.some(d => c.phones.has(d))) || null;
  }
  // Устройства клиента из его заказов: одно устройство — одна строка (по IMEI / S\N, а без
  // него — по названию), самое свежее сверху. Заказ на несколько устройств («iPhone 5s\niPhone
  // SE», в AD «iPhone 5s: …; iPhone SE: …») раскладывается по устройствам.
  function clientDevices(c) {
    const seen = new Map();
    for (const r of c.rows) {
      const dev = String(cell(r, C.device)).trim(); if (!dev) continue;
      const ad = String(cell(r, C.imei)).trim();
      const lines = dev.split("\n").map(x => x.trim()).filter(Boolean);
      const tagged = ad.split(/;\s*/).map(x => x.match(/^(.+?):\s*(.+)$/)).filter(Boolean);
      const items = lines.length > 1 && tagged.length ? lines.map(l => ({ dev: l, imei: (tagged.find(m => norm(m[1]) === norm(l)) || [])[2] || "" }))
        : [{ dev: lines.join(" · "), imei: ad }];
      for (const it of items) {
        const k = it.imei ? "i:" + norm(it.imei) : "d:" + norm(it.dev);
        seen.set(k, { ...it, r });
      }
    }
    return [...seen.values()].sort((a, b) => b.r.row - a.r.row);
  }
  function clientDevicesHtml(c) {
    if (!c) return "";
    const list = clientDevices(c);
    const aka = c.aka.length ? ` · также записан как ${c.aka.slice(0, 3).map(esc).join(", ")}${c.aka.length > 3 ? "…" : ""}` : "";
    return `<div class="cdevs"><div class="note">В базе: ${c.count} ${ordersWord(c.count)}${aka}</div>
      ${list.length ? `<div class="cdevs__h">Устройства клиента — нажмите, чтобы подставить:</div><div class="cdevs__list">${list.slice(0, 12).map((x, i) =>
        `<button type="button" class="cdev" data-cdev="${i}"><b>${esc(x.dev)}</b><span>${x.imei ? esc(x.imei) + " · " : ""}№${esc(cell(x.r, C.num))}, ${esc(String(cell(x.r, C.date)).slice(0, 10))}</span></button>`).join("")}</div>` : ""}</div>`;
  }
  function currentNewClient() {
    if (S.newClient) { const c = clients().find(x => x.key === S.newClient); if (c) return c; }
    return clientByPhone(S.dirty.get("new:" + C.phone) || "");
  }
  function pickDevice(i) {
    const c = currentNewClient(), x = c && clientDevices(c)[i]; if (!x) return;
    if (!S.multi || !String(S.dirty.get("new:" + C.device) ?? "").trim()) {
      S.dirty.set("new:" + C.device, x.dev); if (x.imei) S.dirty.set("new:" + C.imei, x.imei); else S.dirty.delete("new:" + C.imei);
    } else {
      const slot = S.extra.find(e => !String(e[C.device] ?? "").trim()) || (S.extra.push(blankDevice()), S.extra[S.extra.length - 1]);
      slot[C.device] = x.dev; slot[C.imei] = x.imei;
    }
    const y = window.scrollY; render(); window.scrollTo(0, y);
    toast(`Подставлено: ${x.dev}${x.imei ? " · " + x.imei : ""}`);
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
    S.opts[C.status] = ["Принят на диагностику", "На согласовании", "Ждем предоплату", "Заказана запчасть", "В работе", "Готов ожидает клиента", "Выполнен", "Отказ от ремонта после диагностики", "Выкуплен", "Разобран на запчасти", "Обмен оформлен", "Продан"];
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
    // «все заказы клиента» — весь клиент целиком: все его номера и заказы без телефона
    if (q.startsWith("@c")) { const c = clients().find(x => x.key === q.slice(1)); return c ? c.rows.slice().reverse() : []; }
    const tokens = q.split(" ").filter(Boolean);
    const d = normDigits(digits(q)), digitsOnly = isDigitQuery(q);
    const out = [];
    for (const r of S.rows) {
      let score;
      if (digitsOnly) {
        const num = String(cell(r, C.num)).trim();
        if (num === d) score = 1000;
        else if (d.length >= 4 && r.ph.some(p => p.includes(d))) score = 400;
        else if (d.length >= 4 && r.ph2.some(p => p.includes(d))) score = 350;
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
    if (S.error && !S.rows.length) return renderShell(`<div class="empty">${esc(S.error)}<div class="row" style="justify-content:center"><button class="btn" data-act="reload">Попробовать ещё раз</button>
      <button class="btn btn--ghost" data-act="relogin">Войти другим аккаунтом</button></div></div>`);
    if (location.hash === "#/new") return renderNew();
    if (location.hash === "#/sklad") return renderStock();
    const m = location.hash.match(/^#\/(\d+)/);
    if (m) return renderCard(m[1]);
    renderList();
  }

  function renderLogin() {
    $app.innerHTML = `<main class="login"><div class="login__box">
      <img class="login__logo" src="../assets/logo-horizontal.png" alt="IRON SERVICE" width="210" height="56">
      <h1>CRM</h1>
      <p>Вход по Google-аккаунту. Пускает всех, у кого есть доступ к таблице базы, — и только их.</p>
      ${lastEmail() ? `<button class="btn btn--red" data-act="login" data-hint="${esc(lastEmail())}">Продолжить как <span style="text-transform:none;letter-spacing:0">${esc(lastEmail())}</span></button>
        <div class="row" style="justify-content:center"><button class="btn btn--ghost" data-act="login">Другой аккаунт</button></div>`
        : `<button class="btn btn--red" data-act="login">Войти через Google</button>`}
      ${S.error ? `<p class="note">${esc(S.error)}</p>` : ""}
      ${inApp() ? `<p class="note" style="color:var(--wait)">Похоже, страница открыта внутри мессенджера — там Google вход запрещает. Откройте ссылку в Safari или Chrome (⋯ → «Открыть в браузере»).</p>` : ""}
      <p class="note">При первом входе Google покажет «приложение не проверено» — нажмите «Дополнительно» → «Перейти». На следующем экране <b>отметьте галочку доступа к таблицам Google</b>.</p>
    </div></main>`;
  }

  function renderShell(body, { search = true } = {}) {
    $app.innerHTML = (DEMO ? `<div class="demo-bar">ДЕМО — выдуманные сделки, в таблицу ничего не пишется</div>` : "") + `
      <header class="top"><div class="top__row">
        <a class="brand" href="#"><img src="../assets/logo-horizontal.png" alt="IRON SERVICE" width="128" height="34"><b>CRM</b></a><div class="top__spacer"></div>
        <div class="who">${esc(S.email)} <small class="ver">v${VERSION}</small></div>
        ${canCreate() ? `<a class="iconbtn iconbtn--add" href="#/new" title="Новый заказ">＋</a>` : ""}
        <a class="iconbtn" href="#/sklad" title="Склад запчастей Витали">📦</a>
        <button class="iconbtn" data-act="reload" title="Обновить">⟳</button>
        ${DEMO ? "" : `<button class="iconbtn" data-act="logout" title="Выйти">⎋</button>`}
      </div>
      ${search ? `<input class="search" type="search" inputmode="search" placeholder="Номер, телефон, имя или устройство" value="${esc(S.q.startsWith("@c") ? clients().find(x => x.key === S.q.slice(1))?.name || "" : S.q)}" data-act="search" autocomplete="off">` : ""}
      </header><main class="wrap">${body}</main>`;
  }
  const canCreate = () => DEMO || CFG.doors.length > 0;

  // Карточка в списке (v28, 01.10.2026). Владелец: «ФИО, дата и статус как-то сливаются —
  // хочется структурнее, чтобы быстрее найти заказ». Теперь три строки с постоянными местами:
  // №, клиент крупно и статус цветной плашкой справа; устройство и неисправность; дата
  // приёма, возраст, мастер и сумма. Плюс вид «Строки» — по одной строке на заказ, как в таблице.
  function itemHtml(r) {
    const st = cell(r, C.status), age = daysSince(cell(r, C.date));
    const old = !isFinal(st) && age != null && age > 14;
    const dk = dealKey(cell(r, C.type)), date = String(cell(r, C.date)).slice(0, 10);
    const ageTxt = age == null ? "" : age === 0 ? "сегодня" : age + " дн.";
    const stChip = lstHtml(r, st), menu = S.lst?.num === String(cell(r, C.num)).trim() ? " has-menu" : ""; // у элемента overflow:hidden — меню иначе обрежется
    if (S.view === "rows") return `<div class="ritem${menu}" role="button" tabindex="0" data-open="${esc(cell(r, C.num))}">
      <span class="ri__num">№${mark(cell(r, C.num))}</span>
      <span class="ri__date">${esc(date.slice(0, 5))}<small${old ? ' class="is-old"' : ""}>${esc(ageTxt)}</small></span>
      <span class="ri__name">${mark(cell(r, C.name) || "без имени")}${S.q && cell(r, C.phone) ? `<small>${mark(cell(r, C.phone))}</small>` : ""}${String(cell(r, C.contactPhone) ?? "").trim() ? `<small title="Уведомления уходят человеку на связи">📲 ${mark(cell(r, C.contactName) || cell(r, C.contactPhone))}</small>` : ""}</span>
      <span class="ri__dev">${mark(cell(r, C.device) || "—")}${dk !== "repair" ? ` <small>${esc(cell(r, C.type))}</small>` : ""}</span>
      <span class="ri__st">${stChip}</span>
      <span class="ri__sum">${money(cell(r, C.total))}</span>
    </div>`;
    return `<div class="item${menu}" role="button" tabindex="0" data-open="${esc(cell(r, C.num))}">
      <div class="item__top"><span class="item__num">№${mark(cell(r, C.num))}</span><span class="item__name">${mark(cell(r, C.name) || "без имени")}</span>${stChip}</div>
      <div class="item__dev">${mark(cell(r, C.device) || "—")}${cell(r, C.issue) ? `<span class="item__issue"> · ${mark(cell(r, C.issue))}</span>` : ""}</div>
      <div class="item__meta"><span class="item__date">📅 ${esc(date || "—")}${ageTxt ? ` <em class="${old ? "is-old" : ""}">${esc(ageTxt)}</em>` : ""}</span>
        ${S.q && cell(r, C.phone) ? `<span>📞 ${mark(cell(r, C.phone))}</span>` : ""}
        ${String(cell(r, C.contactPhone) ?? "").trim() ? `<span title="Уведомления уходят человеку на связи">📲 ${mark(cell(r, C.contactName) || cell(r, C.contactPhone))}</span>` : ""}
        ${cell(r, C.master) ? `<span>🔧 ${mark(cell(r, C.master))}</span>` : ""}
        ${dk !== "repair" ? `<span class="chip">${esc(cell(r, C.type))}</span>` : ""}
        <span class="item__sum">${money(cell(r, C.total))}</span></div>
    </div>`;
  }
  // ── статус прямо из списка (v39, 03.10.2026) ──────────────────────────────────────
  // Владелец: «сделай возможным изменение статуса прямо из списка». Тап по статусу открывает тот же
  // цветной список, что в карточке (статусы по типу сделки); выбор просит подтверждения — статус
  // уходит клиенту уведомлением, случайный тап в списке не должен ничего отправить. Дальше — та же
  // запись, что «Сохранить» в карточке (save): группы, история, двери, уведомления. Если для статуса
  // нужна сумма или в заказе есть несохранённые правки — открывается карточка со статусом наготове.
  // Элемент списка стал <div role="button"> вместо <button>: кнопка внутри кнопки — невалидная разметка.
  function lstHtml(r, st) {
    const num = String(cell(r, C.num)).trim();
    const chip = `<span class="chip chip--${statusKind(st)}">${esc(stLabel(st) || "без статуса")}</span>`;
    if (!editable(C.status, r) || isSilent(st)) return chip;
    const open = S.lst?.num === num;
    const list = statusesFor(dealKey(cell(r, C.type)));
    const opts = list.includes(st) || !st ? list : [st, ...list];
    const menu = !open ? "" : S.lst.v
      ? `<div class="lst__menu"><p>«${esc(stLabel(S.lst.v))}» — клиенту уйдёт уведомление${groupOf(r)?.shared ? ", статус сменится у всех устройств группы" : ""}.</p>
        <div class="lst__row"><button type="button" class="btn btn--sm" data-act="lstsave" data-num="${esc(num)}">Сохранить</button><button type="button" class="btn btn--ghost btn--sm" data-act="lstback" data-num="${esc(num)}">Назад</button></div></div>`
      : `<div class="lst__menu" role="listbox">${opts.map(o => `<button type="button" class="dd__opt ${toneOf(C.status, o)}" data-act="lstpick" data-num="${esc(num)}" data-value="${esc(o)}" aria-pressed="${o === st}">${esc(stLabel(o))}</button>`).join("")}</div>`;
    return `<span class="lst${open ? " is-open" : ""}"><button type="button" class="chip chip--${statusKind(st)} lst__btn" data-act="lst" data-num="${esc(num)}" title="Сменить статус">${esc(stLabel(st) || "без статуса")} ▾</button>${menu}</span>`;
  }
  async function lstAct(act, t) {
    const num = t.dataset.num, r = S.byNum.get(num);
    const again = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
    if (act === "lst") { S.lst = S.lst?.num === num ? null : { num }; return again(); }
    if (act === "lstback") { S.lst = { num }; return again(); }
    if (!r) { S.lst = null; return again(); }
    if (act === "lstpick") {
      const v = t.dataset.value;
      if (v === cell(r, C.status)) { S.lst = null; return again(); }
      const other = [...S.dirty.keys()].some(k => k.startsWith(r.row + ":") && k !== r.row + ":" + C.status);
      const miss = needSum(v, dealKey(cell(r, C.type)), c => cell(r, c));
      if (other || miss != null) { // в карточку: там видно, что ещё не сохранено, и куда вписать сумму
        S.dirty.set(r.row + ":" + C.status, v); S.lst = null; location.hash = "#/" + num; // setDirty сверяет с открытой карточкой — в списке её нет
        setTimeout(() => miss != null ? askSum(miss, `Для «${v}» нужна сумма`) : toast(`№${num}: есть несохранённые правки — проверьте и нажмите «Сохранить»`, null, true), 300);
        return;
      }
      S.lst = { num, v }; return again();
    }
    if (act === "lstsave") {
      const v = S.lst?.num === num ? S.lst.v : null; if (!v) return;
      S.lst = null; S.dirty.set(r.row + ":" + C.status, v);
      await save(num);
    }
  }
  const listCls = () => "list" + (S.view === "rows" ? " list--rows" : "");
  const viewToggle = () => `<span class="viewtog"><button type="button" data-act="view" data-v="cards" aria-pressed="${S.view !== "rows"}" title="Карточками">▦</button><button type="button" data-act="view" data-v="rows" aria-pressed="${S.view === "rows"}" title="Строками, как в таблице">☰</button></span>`;

  function renderList() {
    const list = pick(), n = counts();
    const tabs = [["work", "В работе", n.work], ["stale", "⚡ Долго висят", n.stale], ["ready", "Готовы, ждут клиента", n.ready], ["done", "Выданы за 30 дней"], ["all", "Все"]];
    // Долгий вход включили, а это устройство ещё на часовом (v51) — одна кнопка, один раз.
    const longBar = S.authOn && !DEMO && S.token && !sidGet() && !inApp() ? `<div class="longbar">🔐 Можно не входить заново после простоя: <button type="button" class="btn btn--sm" data-act="longlogin">Запомнить вход на 30 дней</button></div>` : "";
    let body = longBar + (S.q ? "" : `<nav class="tabs">${tabs.map(([k, t, c]) =>
      `<button class="tab" data-tab="${k}" aria-pressed="${S.tab === k}">${t}${c != null ? `<small>${c}</small>` : ""}</button>`).join("")}${viewToggle()}</nav>`);
    if (S.q) {
      const one = S.q.startsWith("@c") ? clients().find(x => x.key === S.q.slice(1)) : null;
      const found = one ? [] : !isDigitQuery(S.q) ? findClients(S.q, 3) : [];
      body += one ? `<div class="section"><h2>Все заказы клиента: ${esc(one.name)}</h2><span>${list.length}</span></div>`
        : `<div class="section"><h2>Найдено</h2><span>${list.length}</span>${viewToggle()}</div>`;
      if (found.length) body += `<div class="clients">${found.map(c => { const p = phonesOf(c)[0];
        return `<button class="client" data-q="@${esc(c.key)}"><b>${mark(c.name)}</b><span>${c.count} ${ordersWord(c.count)}${p ? " · " + esc(p.text) : ""}${c.phones.size > 1 ? ` (+${c.phones.size - 1})` : ""}${c.aka.length ? " · также: " + esc(c.aka.slice(0, 2).join(", ")) : ""}</span><em>все заказы клиента →</em></button>`; }).join("")}</div>`;
    }
    if (!list.length) body += `<div class="empty">${S.q ? "Ничего не нашлось" : "Здесь пусто"}</div>`;
    else if (!S.q && S.tab === "work") {
      const groups = new Map();
      for (const r of list) { const k = cell(r, C.status) || "без статуса"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
      const rank = k => { const i = ORDER.findIndex(o => norm(k).startsWith(o)); return i < 0 ? 50 : i; };
      for (const [k, rs] of [...groups].sort((a, b) => rank(a[0]) - rank(b[0])))
        body += `<div class="section"><h2>${esc(stLabel(k))}</h2><span>${rs.length}</span></div><div class="${listCls()}">${rs.map(itemHtml).join("")}</div>`;
    } else {
      const shown = list.slice(0, S.limit);
      body += `<div class="${listCls()}" style="margin-top:14px">${shown.map(itemHtml).join("")}</div>`;
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
    if (f.calc) return opts.r ? `<div class="field"><span>${esc(label)} <small class="note">(считает таблица)</small></span><div class="ro">${esc(value || "—")}</div></div>` : "";
    const lock = !editable(c, opts.r) && !opts.force;
    if (lock) return `<div class="field"><span>${esc(label)} 🔒</span><div class="ro">${esc(value || "—")}</div>
      ${opts.row ? `<a class="btn btn--ghost" style="margin-top:6px" href="${sheetLink(opts.row, c)}" target="_blank" rel="noopener">Изменить в таблице ↗</a>` : ""}</div>`;
    const spell = f.spell ? ' spellcheck="true" lang="ru" autocorrect="on" autocapitalize="sentences"' : ' spellcheck="false" autocorrect="off" autocapitalize="off"';
    let input;
    if (S.bools.has(c)) {
      input = `<label class="check"><input type="checkbox" data-edit="${c}" ${isTrue(v) ? "checked" : ""}><b>${isTrue(v) ? "Да" : "Нет"}</b></label>`;
    } else if (S.opts[c]?.length && c !== C.status && !f.free) {
      return `<div class="field${dirty ? " is-dirty" : ""}"><span>${esc(label)}</span>${ddHtml(key, c, String(v ?? ""), S.opts[c])}</div>`;
    } else if (f.area) {
      input = `<textarea data-edit="${c}" rows="3"${spell}>${esc(v)}</textarea>`;
    } else if (f.tel) {
      return telFieldHtml(c, label, v, dirty);
    } else {
      const shown = f.num && !dirty ? String(toNum(v) ?? v) : v;
      const dl = f.free && S.opts[c]?.length ? ` list="dl-${c}"` : "";
      input = `<input data-edit="${c}" value="${esc(shown)}"${dl}${spell} ${f.num ? 'inputmode="decimal"' : f.tel ? 'inputmode="tel"' : ""}>` +
        (dl ? `<datalist id="dl-${c}">${S.opts[c].map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
    }
    return `<label class="field${dirty ? " is-dirty" : ""}"><span>${esc(label)}</span>${input}</label>`;
  }


  // ── несколько номеров у одного контакта (v42, 03.10.2026) ──────────────────────────
  // Владелец: «добавь возможность записать второй номер на один контакт прям в заявке». Номера
  // лежат в ОДНОЙ клетке (D у клиента, AI у того, кто на связи) с новой строки — так в базе уже
  // записаны 166 заказов, и это понимают все: уведомления шлют на каждый номер
  // (parsePhonesFromCell), Google Контакты кладут оба номера в контакт (processMultiplePhones),
  // книга клиентов оболочки склеивает клиента по любому из них. Здесь — только удобство ввода:
  // каждый номер своим полем и «＋ второй номер». Клетку с одним номером и пояснением вроде
  // «писать на вотсап» не дробим — делим, только когда номеров в ней два и больше.
  const telParts = v => phones(v).length >= 2 ? String(v ?? "").split(/\r?\n|[,;/\\]+|\s{2,}/).map(x => x.trim()).filter(Boolean) : [String(v ?? "")];
  const telNorm = v => telParts(v).map(x => x.trim()).filter(Boolean).join("\n");
  const telRow = (c, i, value) => `<div class="tel__row"><input data-edit="${c}" data-i="${i}" value="${esc(value)}" inputmode="tel" spellcheck="false" autocorrect="off" autocapitalize="off"${i ? ' placeholder="второй номер"' : ""}>${i ? `<button type="button" class="linkbtn tel__rm" data-act="telrm" data-c="${c}" title="Убрать этот номер">✕</button>` : ""}</div>`;
  function telFieldHtml(c, label, v, dirty) {
    const parts = telParts(v);
    return `<div class="field tel${dirty ? " is-dirty" : ""}"><span>${esc(label)}</span>${parts.map((x, i) => telRow(c, i, x)).join("")}
      <button type="button" class="linkbtn tel__add" data-act="teladd" data-c="${c}">＋ ${parts.length > 1 ? "ещё номер" : "второй номер"}</button></div>`;
  }
  // Значение клетки из всех полей номера: по строке на номер.
  const telJoin = c => [...$app.querySelectorAll(`[data-edit="${c}"]`)].map(i => i.value.trim()).filter(Boolean).join("\n");
  // Подставить номер целиком (выбор клиента из подсказок): лишние поля убрать.
  function telSet(c, v) {
    const rows = [...$app.querySelectorAll(`[data-edit="${c}"]`)];
    rows.slice(1).forEach(i => i.closest(".tel__row")?.remove());
    if (rows[0]) rows[0].value = v;
    const add = $app.querySelector(`[data-act="teladd"][data-c="${c}"]`); if (add) add.textContent = "＋ второй номер";
  }

  // ── выпадающие списки в стиле оболочки (v28, 01.10.2026) ─────────────────────
  // Владелец: «статусы лучше укомпоновать в выпадающем списке… все всплывающие списки
  // стилизованными и с разными цветами, как статусы». Свой список вместо <select>: у
  // системного нельзя покрасить пункты. Цвет статуса — по смыслу (statusKind), у мастера,
  // источника и т. п. — свой цвет у каждого значения (по месту в списке таблицы).
  // Выбор идёт через тот же data-choice, что и кнопки статусов, — вся логика одна.
  const TONES = 8;
  function toneOf(c, v) {
    if (!v) return "t-none";
    if (c === C.status) return "st-" + statusKind(v);
    const i = (S.opts[c] || []).indexOf(v);
    return i < 0 ? "t-none" : "t" + (i % TONES);
  }
  function ddHtml(key, c, value, opts, { allowEmpty = true, placeholder = "—" } = {}) {
    const list = opts.includes(value) || !value ? opts : [value, ...opts];
    const open = S.ddOpen === key + ":" + c, show = v => c === C.status ? stLabel(v) : v;
    return `<div class="dd${open ? " is-open" : ""}">
      <button type="button" class="dd__btn ${toneOf(c, value)}" data-act="dd" data-c="${c}" aria-expanded="${open}">${value ? esc(show(value)) : `<span class="dd__ph">${esc(placeholder)}</span>`}<i>▾</i></button>
      ${open ? `<div class="dd__list" role="listbox">${allowEmpty ? `<button type="button" class="dd__opt t-none" data-choice="${c}" data-value="">—</button>` : ""}${list.map(o =>
        `<button type="button" class="dd__opt ${toneOf(c, o)}" data-choice="${c}" data-value="${esc(o)}" aria-pressed="${o === value}">${esc(show(o))}</button>`).join("")}</div>` : ""}
    </div>`;
  }

  function choiceButtons(key, col, current, opts, kindOf) {
    const chosen = S.dirty.has(key + ":" + col) ? S.dirty.get(key + ":" + col) : current;
    const list = opts.includes(current) || !current ? opts : [current, ...opts];
    return `<div class="statuses">${list.map(o => `<button type="button" class="st st--${kindOf(o)}" data-choice="${col}" data-value="${esc(o)}" aria-pressed="${o === chosen}">${esc(col === C.status ? stLabel(o) : o)}</button>`).join("")}</div>`;
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
    const d = parseDiscount(val(C.discount)), q = toNum(val(C.total));
    const dline = d && q != null ? `<div class="note">Без скидки ${baseOf(q, d).toLocaleString("ru-RU")} ₽ · скидка ${discText(d)}${d.pct != null ? ` (−${discRub(d, baseOf(q, d)).toLocaleString("ru-RU")} ₽)` : ""} · клиент платит ${q.toLocaleString("ru-RU")} ₽</div>` : "";
    return `Остаётся нам: <b>${m.toLocaleString("ru-RU")} ₽</b> <span class="note">(${how})</span>${dline}${extra}`;
  }

  // ── типовые неисправности и работы (v18, 28.09.2026) ─────────────────────────
  // Списки собраны из самой базы: самые частые формулировки колонок F и G за последние
  // ~3000 заказов, без опечаток и дублей («не вкл» = «Не включается»). Чип дописывает
  // фразу в поле через точку — так в базе и пишут («Не включается. Требуется
  // диагностика»); повторное нажатие убирает фразу. Своё можно дописать руками, как раньше.
  const FAMILIES = [
    ["phone", /iphone|айфон|смартфон|телефон|samsung|galaxy|xiaomi|redmi|poco|honor|huawei|realme|oneplus|pixel|nokia|tecno|infinix|vivo|oppo/],
    ["tablet", /ipad|айпад|планшет|tab\b|galaxy tab/],
    ["watch", /watch|часы/],
    ["audio", /airpods|наушник|колонк|jbl|marshall|beats/],
    ["console", /playstation|ps ?[345]\b|xbox|nintendo|switch|джойстик|геймпад|dual ?sen|dualshock/],
    ["desktop", /imac|аймак|mac ?mini|мак ?мини|системн|моноблок|\bпк\b|компьютер/],
    ["laptop", /macbook|макбук|ноутбук|notebook|laptop|ультрабук|asus|acer|lenovo|\bhp\b|dell|msi|matebook|magicbook|thinkpad/],
  ];
  function familyOf(device) { const s = norm(device); return (FAMILIES.find(([, re]) => re.test(s)) || ["other"])[0]; }
  const TYPICAL = {
    issue: {
      all: ["Не включается", "Требуется диагностика", "Не заряжается", "Попадание влаги", "Перезагружается", "Выключается", "Греется", "Нет изображения", "Нет звука", "Тормозит"],
      phone: ["Разбит дисплей", "Разбито стекло дисплея", "Необходима замена АКБ", "Быстро разряжается", "Вздулся АКБ", "Разбита задняя крышка", "Разбито стекло камеры", "Не работает сенсор", "Полосы на дисплее", "Завис на яблоке", "Забыли пароль", "Не работает камера", "Не работает кнопка Home", "Не работает динамик", "Не работает микрофон", "Не ловит сеть"],
      tablet: ["Разбит дисплей", "Разбито стекло дисплея", "Необходима замена АКБ", "Быстро разряжается", "Не работает сенсор", "Завис на яблоке", "Забыли пароль", "Не работает кнопка Home"],
      laptop: ["Разбита матрица", "Не работает клавиатура", "Не работает тачпад", "Необходима замена АКБ", "Быстро разряжается", "Профилактика", "Шумит", "Нет подсветки", "Полосы на дисплее", "Переустановка ОС", "Необходима установка ПО", "Замена HDD на SSD", "Не грузится ОС"],
      desktop: ["Профилактика", "Шумит", "Переустановка ОС", "Необходима установка ПО", "Замена HDD на SSD", "Не грузится ОС", "Нет подсветки"],
      watch: ["Разбит дисплей", "Необходима замена АКБ", "Быстро разряжается", "Не работает сенсор"],
      audio: ["Не заряжается кейс", "Не работает наушник", "Тихий звук", "Быстро разряжается"],
      console: ["Дрейф стика", "Не работает кнопка", "Не читает диски", "Нет изображения", "Шумит"],
      other: [],
    },
    work: {
      all: ["Диагностика", "Без ремонта", "Ремонт нецелесообразен", "Восстановление после залития", "Ремонт платы"],
      phone: ["Замена АКБ", "Замена дисплея (оригинал)", "Замена дисплея (копия)", "Замена стекла дисплея (переклейка)", "Замена задней крышки", "Замена стекла камеры", "Замена камеры", "Замена нижнего шлейфа", "Замена разъёма зарядки", "Замена динамика", "Замена кнопки Home", "Прошивка без потери данных", "Прошивка с потерей данных", "Чистка", "Защитное стекло в подарок"],
      tablet: ["Замена АКБ", "Замена дисплея", "Замена сенсора", "Замена разъёма зарядки", "Прошивка", "Чистка"],
      laptop: ["Профилактика (чистка и замена термопасты)", "Замена АКБ", "Замена матрицы", "Замена клавиатуры", "Замена топкейса", "Замена тачпада", "Замена кейкапов", "Замена HDD на SSD", "Установка ОС", "Установка ПО", "Увеличение памяти"],
      desktop: ["Профилактика (чистка и замена термопасты)", "Замена HDD на SSD", "Установка ОС", "Установка ПО", "Увеличение памяти", "Замена блока питания"],
      watch: ["Замена АКБ", "Замена дисплея", "Замена стекла"],
      audio: ["Замена АКБ", "Чистка", "Замена наушника"],
      console: ["Замена стика", "Чистка", "Профилактика (чистка и замена термопасты)", "Замена кнопки"],
      other: ["Чистка", "Установка ПО"],
    },
  };
  const cap = s => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);
  // Фразы поля: куски между точкой, «;» и переводом строки. Запятую не трогаем — ею перечисляют.
  const sentences = text => String(text ?? "").split(/[.;\n]+/).map(s => s.trim()).filter(Boolean);
  const hasPhrase = (text, p) => sentences(text).some(s => norm(s) === norm(p));
  function addPhrase(text, p) { const t = String(text ?? "").trim().replace(/[.;,\s]+$/, ""); return t ? t + ". " + p : p; }
  function removePhrase(text, p) {
    const toks = String(text ?? "").split(/([.;\n]+\s*)/), out = [];
    for (let i = 0; i < toks.length; i += 2) if (norm(toks[i]) !== norm(p)) out.push(toks[i] + (toks[i + 1] ?? ""));
    return out.join("").replace(/^[.;\s]+/, "").replace(/[.;\s]+$/, "");
  }
  // Видны первые 8 (частые для этой техники) и уже выбранные; остальные — под «ещё».
  const TIPS_SHOWN = 8;
  function typicalHtml(kind, c, fam, text) {
    const list = [...new Set([...(TYPICAL[kind][fam] || []), ...TYPICAL[kind].all])];
    const open = S.tipsOpen?.has(c);
    const more = list.filter((p, i) => i >= TIPS_SHOWN && !hasPhrase(text, p)).length;
    return `<div class="tchips${open ? " is-open" : ""}">${list.map((p, i) => `<button type="button" class="tchip${i >= TIPS_SHOWN && !hasPhrase(text, p) ? " tchip--more" : ""}" data-tip="${c}" data-text="${esc(p)}" aria-pressed="${hasPhrase(text, p)}">${esc(p)}</button>`).join("")}${
      more ? `<button type="button" class="tchip tchip--toggle" data-act="tmore" data-c="${c}">${open ? "свернуть" : "ещё " + more + " ▾"}</button>` : ""}</div>`;
  }

  // ── работы из прайса сайта ─────────────────────────────────────────────────
  // Прайс ремонта уже лежит на сайте (/data/services.json, 1001 услуга): модель, работа,
  // вариант запчасти, цена клиенту, закупка, поставщик, гарантия. Добавленная работа
  // дописывается в «Выполненные работы», её цена прибавляется к «Итого», запчасть с
  // поставщиком и закупкой встаёт строкой в «Запчасти», гарантия — если больше прежней.
  const SRC_NAME = [[/mos-?lcd/i, "MosLCD"], [/wepro/i, "WePro"], [/macsuper/i, "MacSuper"], [/liberti/i, "Liberti"], [/partslog/i, "PartsLog"], [/detaliapple/i, "DetaliApple"]];
  const OP_PART = { "замена дисплея": "Дисплейный модуль", "замена аккумулятора": "АКБ", "замена заднего стекла": "Задняя крышка", "замена стекла": "Стекло дисплея",
    "замена стекла камеры": "Стекло камеры", "замена камеры": "Камера", "замена динамика": "Динамик", "замена клавиатуры": "Клавиатура", "замена корпуса": "Корпус",
    "замена матрицы без крышки": "Матрица", "замена накопителя (ssd)": "SSD", "замена нижнего шлейфа": "Нижний шлейф", "замена разъёма зарядки": "Разъём зарядки",
    "замена сенсора": "Тачскрин", "замена тачпада": "Трекпад", "замена шлейфа": "Шлейф", "замена материнской платы": "Материнская плата" };
  async function loadServices() {
    if (S.svc?.list || S.svc?.loading) return;
    S.svc = { loading: true };
    try {
      const j = await fetch("/data/services.json", { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error("прайс не ответил (" + r.status + ")"); return r.json(); });
      S.svc = { list: (j.services || []).filter(x => x.device && x.operation), devices: [...new Set((j.services || []).map(x => x.device))] };
    } catch (e) { S.svc = { error: e.message }; }
  }
  // Модель из поля «Устройство»: самое длинное имя прайса, все слова которого есть в тексте
  // («iPhone 13 Pro Max» → «iPhone 13 Pro Max», а не «iPhone 13»). Скобки с годами не в счёт.
  function matchDevice(text) {
    const s = " " + norm(text).replace(/["”]/g, "") + " ";
    let best = null, bestLen = 0;
    for (const d of S.svc?.devices || []) {
      const words = norm(d.replace(/\(.*?\)/g, "")).replace(/["”]/g, "").split(/\s+/).filter(Boolean);
      if (words.length && words.every(w => s.includes(" " + w + " ") || s.includes(" " + w)) && words.join(" ").length > bestLen) { best = d; bestLen = words.join(" ").length; }
    }
    if (best) return best;
    const fam = familyOf(text);
    return fam === "laptop" && !/mac/.test(norm(text)) ? "Ноутбуки на Windows" : fam === "phone" && !/iphone/.test(norm(text)) ? "Смартфон Android" : fam === "desktop" && !/mac/.test(norm(text)) ? "ПК / системный блок" : "";
  }
  // Как говорят в сервисе → как написано в прайсе.
  const PP_SYN = [[/^акб|^батар|^аккум/, ["аккумулятор"]], [/^экран|^диспл/, ["диспле", "матриц"]], [/^крышк|^задн/, ["заднего стекла", "корпус"]],
    [/^ссд|^ssd|^диск/, ["ssd", "накопител", "диск"]], [/^клав/, ["клавиатур"]], [/^тач|^трек/, ["тачпад", "сенсор"]], [/^зарядк|^разъ/, ["разъёма зарядки", "разъема зарядки"]],
    [/^чистк|^профил/, ["профилактик"]], [/^по$|^прошив|^ос$/, ["установка по", "по"]], [/^залит|^влаг/, ["залития"]], [/^вотч|^watch|^час/, ["watch"]]];
  function pricePickHtml(key, deviceText) {
    const P = S.pp?.key === key ? S.pp : null;
    if (!P?.open) return `<button type="button" class="btn btn--ghost btn--sm" data-act="ppopen">📋 Работа из прайса</button>`;
    if (!S.svc?.list) return `<div class="pp"><div class="note">${S.svc?.error ? "Прайс не загрузился: " + esc(S.svc.error) : "Загружаю прайс…"}</div></div>`;
    const dev = P.dev ?? matchDevice(deviceText), q = norm(P.q || "");
    // Поиск: слова запроса ищутся в работе и варианте; без модели — по всему прайсу (с моделью в строке).
    const hit = x => { const t = norm(x.operation + " " + (x.variant || "") + (dev ? "" : " " + x.device)); return !q || q.split(" ").every(w => (PP_SYN.find(([re]) => re.test(w))?.[1] || [w]).some(a => t.includes(a))); };
    const items = S.svc.list.map((x, i) => ({ x, i })).filter(({ x }) => (dev ? x.device === dev : q.length >= 2) && hit(x)).slice(0, 80);
    const hitX = x => !q || q.split(" ").every(w => (PP_SYN.find(([re]) => re.test(w))?.[1] || [w]).some(a => norm(x.operation + " " + x.variant + " " + x.src + " " + (x.title || "") + (x.kind === "stock" ? " склад наличие" : "")).includes(a)));
    const extras = dev ? ppExtras(dev).filter(hitX).slice(0, 60) : [];
    P.extra = extras; // для нажатия: data-svx — номер в этом списке
    return `<div class="pp"><div class="pp__head"><select data-act="ppdev"><option value="">— модель из прайса —</option>${S.svc.devices.map(d => `<option ${d === dev ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
      <button type="button" class="linkbtn" data-act="ppclose">закрыть</button></div>
      <input class="pp__q" data-act="ppq" value="${esc(P.q || "")}" placeholder="Поиск: дисплей, акб, oled…" autocomplete="off">
      ${dev || q.length >= 2 ? (items.length || extras.length ? `<div class="pp__list">${items.map(({ x, i }) => `<button type="button" class="pp__item" data-svc="${i}">
        <b>${esc(cap(x.operation))}${x.variant ? ` <span class="note">${esc(x.variant)}</span>` : ""}${dev ? "" : ` <span class="note">· ${esc(x.device)}</span>`}</b>
        <span>${x.price ? (x.price_is_from ? "от " : "") + money(x.price) : "цена по диагностике"}${x.work && x.part_cost ? ` <em class="note">= работа ${money(x.work)} + запчасть ${money(x.part_cost)}${x.part_source ? " · " + esc((SRC_NAME.find(([re]) => re.test(x.part_source)) || [, x.part_source])[1]) : ""}</em>` : ""}${x.warranty_days ? " · гар. " + x.warranty_days + " дн." : ""}</span><i>＋</i></button>`).join("")}${extras.length ? `<div class="pp__sub">Наш склад и другие поставщики</div>` + extras.map((x, j) => `<button type="button" class="pp__item" data-svx="${j}">
        <b>${esc(cap(x.operation))} <span class="note">${x.kind === "stock" ? "📦 наш склад" : esc(x.src)} · ${esc(x.variant)}</span>${x.here ? ` <span class="psup__here">в Сочи</span>` : ""}</b>
        <span>${money(x.price)} <em class="note">= работа ${money(x.work)} + запчасть ${money(x.cost)}${x.kind === "stock" ? ` · на полке ${x.qty} шт` + (isVitalya(x.src) ? " (Виталя)" : isDonor(x.src) ? " (донор)" : x.src ? " (" + esc(x.src) + ")" : "") : ""}</em>${x.warranty_days ? " · гар. " + x.warranty_days + " дн." : ""}</span><i>＋</i></button>`).join("") : ""}</div>` : `<div class="note">${q ? "Ничего не нашлось." : "Для этой модели в прайсе работ нет."}</div>`)
        : `<div class="note">Не узнал модель по полю «Устройство» — выберите из списка или ищите по всему прайсу.</div>`}
      <p class="note">Нажатие добавляет работу в «Выполненные работы», цену — к «Итого», запчасть — в список запчастей. Можно добавить несколько.</p></div>`;
  }
  // ── «Работа из прайса» — и наш склад, и другие поставщики (v37, 02.10.2026) ─────────────
  // Владелец: «пока не выдаёт работы с запчастями от других поставщиков, кроме мосов». Прайс ремонта
  // по iPhone собран из MOS-LCD, поэтому в списке были только его детали (в v36 Виталя и Liberti
  // появлялись лишь чипами под запчастью ПОСЛЕ добавления работы). Теперь под работами прайса —
  // те же работы с деталью с нашей полки (📦, только что лежит) и от поставщиков из индекса цен,
  // кроме MOS (он уже в прайсе). Цена = работа этой модели из прайса + закупка, вверх до 100 ₽.
  // Работа — самая частая у этой модели и работы (у дисплеев 5000 у четырёх вариантов из пяти).
  const OP_STOCK = { "замена дисплея": ["дисплей"], "замена аккумулятора": ["акб"], "замена заднего стекла": ["заднее стекло"],
    "замена стекла камеры": ["стекло камеры"], "замена камеры": ["камера", "фронтальная камера"], "замена корпуса": ["корпус"],
    "замена нижнего шлейфа": ["нижний шлейф"], "замена разъёма зарядки": ["нижний шлейф"], "замена шлейфа": ["шлейф кнопок", "шлейф датчика приближения", "шлейф вспышки"],
    "замена динамика": ["слуховой динамик", "полифонический динамик"] };
  function ppWorkOf(dev, op) {
    const list = S.svc.list.filter(x => x.device === dev && x.operation === op && x.work);
    if (!list.length) return null;
    const cnt = new Map(); for (const x of list) cnt.set(x.work, (cnt.get(x.work) || 0) + 1);
    const work = [...cnt].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    return { work, warranty_days: list.find(x => x.work === work)?.warranty_days || null };
  }
  // Название детали поставщика без «для Apple iPhone 13 (черный)» и хвоста наличия — его увидит
  // клиент в «Выполненных работах» и «Запчастях», поэтому коротко и без поставщика.
  function ppShort(t, dev) {
    let s = String(t || "").replace(/\s*·\s*(в Сочи|под заказ).*$/, "");
    if (s.includes(" · ")) s = s.split(" · ").slice(1).join(" · "); // Виталя: «Аккумуляторы · Оригинал (без привязки)»
    const at = dev ? s.toLowerCase().indexOf(dev.toLowerCase()) : -1;
    if (at >= 0) s = s.slice(at + dev.length).replace(/^(\/[^\s/]+(\s(pro|max|plus|mini))*)+/i, "").replace(/^\s*\([^)]*\)/, "");
    s = s.replace(/^[\s,.-]+/, "").trim();
    return (s || String(t || "")).slice(0, 60);
  }
  function ppExtras(dev) {
    const ops = [...new Set(S.svc.list.filter(x => x.device === dev && OP_PART[norm(x.operation)]).map(x => x.operation))];
    const out = [];
    for (const op of ops) {
      const w = ppWorkOf(dev, op); if (!w) continue;
      const nodes = OP_STOCK[norm(op)], models = S.stock?.rows ? skModelsFor(dev) : [];
      if (nodes && models.length) for (const x of S.stock.rows)
        if (x.qty > 0 && x.cost != null && models.includes(x.model) && nodes.includes(norm(x.node)))
          out.push({ kind: "stock", operation: op, variant: x.variant + (x.color ? ", " + skColor(x.color) : ""), src: x.src, cost: x.cost, stock: x.key, qty: x.qty, ...w });
      for (const o of S.supp?.map?.get(dev + "|" + op) || []) if (norm(o.s) !== "moslcd")
        out.push({ kind: "supp", operation: op, variant: ppShort(o.t, dev), title: o.t, src: o.s, cost: o.c, here: suppHere(o.t), ...w });
    }
    for (const x of out) { x.device = dev; x.price = Math.ceil((x.work + x.cost) / 100) * 100; }
    const rank = x => x.kind === "stock" ? 0 : x.here ? 1 : 2;
    return out.sort((a, b) => ops.indexOf(a.operation) - ops.indexOf(b.operation) || rank(a) - rank(b) || a.cost - b.cost);
  }
  function addExtra(key, r, j) {
    const x = S.pp?.extra?.[j]; if (!x) return;
    addServiceObj(key, r, { device: x.device, operation: x.operation, variant: x.variant, price: x.price, warranty_days: x.warranty_days },
      { src: x.src, cost: x.cost, stock: x.stock || null });
  }
  function addService(key, r, i) {
    const x = S.svc?.list?.[i]; if (x) addServiceObj(key, r, x, null);
  }
  function addServiceObj(key, r, x, part) {
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const work = cap(x.operation) + (x.variant ? ` (${x.variant})` : "");
    setDirty(key, C.work, addPhrase(val(C.work), work));
    if (x.price) {
      const d = parseDiscount(val(C.discount)), q = toNum(val(C.total)), base = (q == null ? 0 : baseOf(q, d)) + x.price;
      setDirty(key, C.total, String(Math.max(0, base - discRub(d, base))));
    }
    const partBase = OP_PART[norm(x.operation)];
    if (partBase && (part || x.part_cost || x.variant)) {
      const src = part ? part.src : (SRC_NAME.find(([re]) => re.test(x.part_source || "")) || [, ""])[1];
      const cost = part ? part.cost : x.part_cost;
      const list = partsOf(key, r).filter(p => p.name || p.src || p.cost);
      const row = { name: partBase + (x.variant ? ` (${x.variant})` : ""), src, cost: cost ? String(cost) : "", dev: x.device, op: x.operation, var: x.variant || "", fromSvc: true };
      if (part?.stock) row.stock = part.stock; // с нашей полки — спишется при сохранении, как кнопка «взять со склада»
      list.push(row);
      S.parts.set(key, list); syncParts(key);
    }
    const days = x.warranty_days, had = toNum(String(val(C.warranty)).match(/\d+/)?.[0]);
    if (days && (had == null || days > had)) setDirty(key, C.warranty, days + " дней");
    const y = window.scrollY; render(); window.scrollTo(0, y);
    toast(`Добавлено: ${work}${x.price ? " — " + (x.price_is_from ? "от " : "") + money(x.price) + ". Итого " + money(val(C.total)) : ""}`, null, true);
  }

  // ── запчасти списком: название · откуда · закупка (v18) ─────────────────────
  // В таблице по-прежнему три колонки: O «Запчасти» (уходит клиенту в отчёте — только
  // названия), U «Откуда» и S «Стоимость (запчасть)». Одна запчасть пишется как раньше:
  // O — название, U — источник, S — закупка. Несколько: O — названия через запятую,
  // U — по строке на запчасть «название: источник, цена ₽», S — сумма закупок.
  // Так видно, какая запчасть откуда, и клиент источников и закупки не видит.
  function splitList(s) {
    const out = []; let depth = 0, cur = "";
    for (const ch of String(s ?? "")) {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      if ((ch === "," || ch === "\n" || ch === ";") && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function parseParts(O, U, Sv) {
    const lines = String(U ?? "").split("\n").map(s => s.trim()).filter(Boolean);
    const mapped = lines.map(l => l.match(/^(.+?):\s*(.*?)(?:,\s*([\d\s ]+)\s*₽)?$/));
    if (lines.length > 1 && mapped.every(Boolean)) return mapped.map(m => ({ name: m[1].trim(), src: m[2].trim() === "?" ? "" : m[2].trim(), cost: m[3] ? String(toNum(m[3])) : "" }));
    const names = splitList(O), srcs = splitList(U);
    const rows = names.map((name, i) => ({ name, src: names.length === 1 ? String(U ?? "").trim() : srcs.length === names.length ? srcs[i] : srcs.length === 1 ? srcs[0] : "", cost: "" }));
    if (!rows.length && (String(U ?? "").trim() || toNum(Sv) != null)) rows.push({ name: "", src: String(U ?? "").trim(), cost: "" });
    if (rows.length === 1 && toNum(Sv) != null) rows[0].cost = String(toNum(Sv));
    return rows;
  }
  function composeParts(list) {
    const L = list.filter(p => String(p.name).trim() || String(p.src).trim() || toNum(p.cost) != null);
    const O = L.map(p => String(p.name).trim()).filter(Boolean).join(", ");
    const costs = L.map(p => toNum(p.cost)).filter(x => x != null);
    let U;
    if (L.length <= 1) U = String(L[0]?.src ?? "").trim();
    else if (!costs.length && L.every(p => String(p.src).trim() === String(L[0].src).trim())) U = String(L[0].src).trim();
    else U = L.map(p => `${String(p.name).trim() || "?"}: ${String(p.src).trim() || "?"}${toNum(p.cost) != null ? ", " + toNum(p.cost) + " ₽" : ""}`).join("\n");
    return { O, U, S: costs.length ? String(costs.reduce((a, b) => a + b, 0)) : null };
  }
  function partsOf(key, r) {
    if (!S.parts.has(key)) {
      const v = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
      const list = parseParts(v(C.parts), v(C.partFrom), v(C.partCost));
      S.parts.set(key, list.length ? list : [{ name: "", src: "", cost: "" }]);
    }
    return S.parts.get(key);
  }
  function syncParts(key) {
    const { O, U, S: sum } = composeParts(S.parts.get(key) || []);
    setDirty(key, C.parts, O); setDirty(key, C.partFrom, U);
    if (sum != null) setDirty(key, C.partCost, sum);
  }
  function partsHtml(key, r) {
    const list = partsOf(key, r);
    const again = () => { if (location.hash === "#/new" || /^#\/\d+/.test(location.hash)) { const y = window.scrollY; render(); window.scrollTo(0, y); } };
    if (!S.supp && !S.suppTried) { S.suppTried = true; Promise.all([loadServices(), loadSupplierPrices(), loadStock()]).then(again); }
    // Склад держим свежим (его правят и другие), но перерисовку не вклиниваем в набор текста.
    else if (!S.stock || skStale()) loadStock(true).then(() => { const a = document.activeElement; if (!(a && $app.contains(a) && /INPUT|TEXTAREA/.test(a.tagName))) again(); });
    const lock = !editable(C.parts, r) && key !== "new";
    const dl = (c, id) => S.opts[c]?.length ? `<datalist id="${id}">${S.opts[c].map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : "";
    const { S: sum } = composeParts(list);
    const tableS = r ? toNum(cell(r, C.partCost)) : null;
    const note = sum == null && tableS != null && list.filter(p => p.name).length > 1 ? `Закупка всего в таблице: ${money(tableS)}, без разбивки — впишите по строкам, и сумма пересчитается.` : sum != null ? `Закупка всего: <b>${money(sum)}</b>` : "";
    return `<div class="parts${lock ? " is-lock" : ""}"><div class="parts__head"><span>Запчасть</span><span>Откуда</span><span>Закупка, ₽</span><span></span></div>
      ${list.map((p, i) => `<div class="parts__row">
        <input data-part="${i}" data-pf="name" value="${esc(p.name)}" list="dl-pname" placeholder="Например, АКБ" spellcheck="true" lang="ru"${lock ? " disabled" : ""}>
        <input data-part="${i}" data-pf="src" value="${esc(p.src)}" list="dl-psrc" placeholder="Откуда"${lock ? " disabled" : ""}>
        <input data-part="${i}" data-pf="cost" value="${esc(p.cost)}" inputmode="decimal" placeholder="0"${lock ? " disabled" : ""}>
        <button type="button" class="linkbtn" data-act="rmpart" data-i="${i}" title="Убрать"${lock ? " disabled" : ""}>✕</button></div>${lock ? "" : supplierChipsHtml(key, r, p, i) + stockPartHtml(key, r, p, i) + compareHtml(key, r, p, i)}`).join("")}
      <div class="parts__foot"><button type="button" class="btn btn--ghost btn--sm" data-act="addpart"${lock ? " disabled" : ""}>＋ Запчасть</button><span class="note" data-parts-note>${note}</span></div>
      ${stockOrderHtml(r, lock)}
      ${dl(C.parts, "dl-pname")}${dl(C.partFrom, "dl-psrc")}</div>`;
  }


  // ── скидка (v26, 28.09.2026) ─────────────────────────────────────────────────
  // В таблице — W «Скидка»: «500 ₽» или «10%». Q «Итого» остаётся суммой, которую платит
  // клиент, уже со скидкой — поэтому маржа (R = Q − S − T), статистика и отчёты считают как
  // раньше. Сумма без скидки не хранится: она выводится из Q и скидки.
  function parseDiscount(v) {
    const t = String(v ?? "").trim().replace(",", "."); let m;
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*%$/))) return +m[1] > 0 && +m[1] < 100 ? { pct: +m[1] } : null;
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(?:₽|р\.?|руб\.?)?$/i))) return +m[1] > 0 ? { rub: +m[1] } : null;
    return null;
  }
  const discText = d => !d ? "" : d.pct != null ? `${d.pct}%` : `${d.rub} ₽`;
  const discRub = (d, base) => !d ? 0 : d.pct != null ? Math.round(base * d.pct / 100) : d.rub;
  // Сумма без скидки из итога: 10% от 5000 → итог 4500 → без скидки 5000.
  const baseOf = (q, d) => q == null ? null : !d ? q : d.pct != null ? Math.round(q / (1 - d.pct / 100)) : q + d.rub;
  const DISC_TYPES = ["repair", "other", "sale_used", "sale_new"];
  function discountHtml(key, r, val) {
    const d = parseDiscount(val(C.discount)), unit = S.discUnit?.[key] || (d?.pct != null ? "pct" : "rub");
    const num = d ? (d.pct ?? d.rub) : "";
    const dirty = S.dirty.has(key + ":" + C.discount);
    return `<div class="field${dirty ? " is-dirty" : ""}"><span>Скидка</span><div class="disc">
      <input data-disc value="${esc(num)}" inputmode="decimal" placeholder="0">
      <div class="seg"><button type="button" data-act="discunit" data-u="rub" aria-pressed="${unit === "rub"}">₽</button><button type="button" data-act="discunit" data-u="pct" aria-pressed="${unit === "pct"}">%</button></div></div></div>`;
  }
  // Новая скидка → новый итог: итог = (сумма без скидки) − скидка.
  function applyDiscount(key, r, raw, unit) {
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const q = toNum(val(C.total)), base = baseOf(q, parseDiscount(val(C.discount)));
    const n = toNum(raw), d = n > 0 ? (unit === "pct" ? (n < 100 ? { pct: n } : null) : { rub: n }) : null;
    setDirty(key, C.discount, d ? (d.pct != null ? d.pct + "%" : d.rub + " ₽") : "");
    if (base != null) setDirty(key, C.total, String(Math.max(0, base - discRub(d, base))));
    return base;
  }


  // ── цены поставщиков на запчасть (v30, 01.10.2026) ─────────────────────────────
  // Владелец: «автоматическое заполнение цен на работу и на запчасть при выборе ремонта
  // из бота, если модель известна и поставлен поставщик». Индекс «модель × работа ×
  // поставщик → закупка» собирает scripts/crm_supplier_prices.py из тех же прайсов, что
  // и прайс ремонта (MOS-LCD, Виталя, wepro, macsuper, detaliapple, partslog, liberti),
  // и кладёт на скрытый лист «CRM — цены поставщиков» книги БАЗА — оболочка читает его
  // входом пользователя; на сайт закупочные цены не выкладываются.
  // Под запчастью — цена у каждого поставщика кнопкой; выбор (или ввод имени поставщика)
  // подставляет закупку. Если запчасть пришла из «Работы из прайса», меняется и «Итого»:
  // цена клиенту = закупка + работа, поэтому разница закупок переходит в итог.
  const SUPP_SHEET = "CRM — цены поставщиков";
  const PART_OP = [[/диспле|экран|матриц/, "замена дисплея"], [/акб|аккумул|батаре/, "замена аккумулятора"], [/стекло камер/, "замена стекла камеры"],
    [/задн|крышк/, "замена заднего стекла"], [/камер/, "замена камеры"], [/нижн.*шлейф/, "замена нижнего шлейфа"], [/шлейф/, "замена шлейфа"],
    [/корпус/, "замена корпуса"], [/тачскрин|сенсор/, "замена сенсора"], [/клавиатур|топкейс/, "замена клавиатуры"], [/тачпад|трекпад/, "замена тачпада"],
    [/ssd|накопител/, "замена накопителя (SSD)"], [/динамик/, "замена динамика"], [/разъ[её]м|зарядк/, "замена разъёма зарядки"], [/материнск|плата/, "замена материнской платы"]];
  const opOfPart = name => (PART_OP.find(([re]) => re.test(norm(name))) || [])[1] || "";
  async function loadSupplierPrices() {
    if (S.supp?.map || S.supp?.loading) return;
    S.supp = { loading: true };
    try {
      const map = new Map(), put = (d, o, x) => { const k = d + "|" + o; if (!map.has(k)) map.set(k, []); map.get(k).push(x); };
      if (DEMO) {
        await loadServices();
        for (const x of S.svc?.list || []) if (x.part_cost) put(x.device, x.operation, { s: (SRC_NAME.find(([re]) => re.test(x.part_source || "")) || [, "MosLCD"])[1], t: x.variant || "", c: x.part_cost });
      } else {
        const v = await api(`/values/${encodeURIComponent(`'${SUPP_SHEET}'!A2:F`)}`);
        for (const [d, o, sp, t, c, when] of v.values || []) if (toNum(c)) put(d, o, { s: sp, t, c: toNum(c), when });
      }
      S.supp = { map };
    } catch (e) { S.supp = { error: e.message, map: new Map() }; }
  }
  // Лучшая позиция у каждого поставщика: совпадение слов варианта; при равном — та, что лежит
  // в Сочи (Liberti пишет в названии «· в Сочи N шт» / «· под заказ», v36), иначе самая дешёвая.
  const suppHere = t => /· в Сочи (\d+ шт|есть)/.test(String(t || ""));
  function supplierOffers(dev, op, variant) {
    const list = S.supp?.map?.get(dev + "|" + op) || [];
    const words = norm(variant).split(/[^a-zа-я0-9%]+/).filter(w => w.length > 1);
    const score = t => words.filter(w => norm(t).includes(w)).length;
    const best = new Map();
    for (const x of list) {
      const b = best.get(x.s), sc = score(x.t), here = suppHere(x.t);
      if (!b || sc > b.sc || (sc === b.sc && (here > b.here || (here === b.here && x.c < b.x.c)))) best.set(x.s, { x, sc, here });
    }
    return [...best.values()].map(b => b.x).sort((a, b) => a.c - b.c);
  }
  function partMeta(p, key, r) {
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const dev = p.dev || (S.svc?.devices ? matchDevice(val(C.device)) : "");
    const op = p.op || opOfPart(p.name);
    const variant = p.var || (String(p.name).match(/\(([^)]+)\)/) || [])[1] || p.name;
    return { dev, op, variant };
  }
  function supplierChipsHtml(key, r, p, i) {
    if (!S.supp?.map || !String(p.name).trim()) return "";
    const { dev, op, variant } = partMeta(p, key, r);
    if (!dev || !op) return "";
    const offers = supplierOffers(dev, op, variant);
    if (!offers.length) return "";
    return `<div class="psup"><span class="note">${esc(dev)}:</span>${offers.map(x => `<button type="button" class="psup__c${norm(x.s) === norm(p.src) ? " is-on" : ""}" data-psup="${i}" data-s="${esc(x.s)}" data-c="${x.c}" data-t="${esc(x.t)}" title="${esc(x.t)}${x.when ? " · прайс от " + esc(x.when) : ""}">${esc(x.s)} <b>${money(x.c)}</b>${suppHere(x.t) ? ` <span class="psup__here">в Сочи</span>` : ""}</button>`).join("")}</div>`;
  }
  // ── «Сравнить склады» по одной запчасти (v38, 02.10.2026) ──────────────────────────
  // Владелец: «ещё бы хорошо иметь кнопку „сравнить склады“ по определённой запчасти». Чипы
  // показывают у каждого поставщика одну, лучшую позицию; здесь — ВСЕ варианты этой детали для
  // этой модели: наша полка (любой поставщик, только что лежит), MOS, Виталя, Liberti, магазины
  // макбуков — с закупкой и наличием, дешевле выше, с фильтром по словам («soft», «оригинал»).
  // Нажатие строки — как чип: поставщик и закупка в строку запчасти (у запчасти из прайса итог
  // пересчитывается), позиция с полки привязывается и спишется при сохранении.
  const cmpWhere = (s, t) => {
    const m = String(t || "").match(/в Сочи (\d+ шт|есть)/);
    if (m) return { a: m[0], here: true };
    if (/под заказ/.test(t)) return { a: "под заказ", here: false };
    if (isVitalya(s)) return { a: "Ростов, 2–4 дня", here: false };
    return { a: "", here: false };
  };
  function compareHtml(key, r, p, i) {
    const open = S.cmp?.key === key && S.cmp.i === i;
    const { dev, op, variant } = partMeta(p, key, r);
    const stock = skCandidates(key, r, p, true) || [];
    const supp = (dev && op && S.supp?.map?.get(dev + "|" + op)) || [];
    if (!open) return (stock.length + supp.length) > 1 ? `<div class="cmp-open"><button type="button" class="linkbtn" data-act="cmp" data-i="${i}">⚖️ Сравнить склады${dev ? "" : ""} <span class="note">(${stock.length + supp.length})</span></button></div>` : "";
    const words = norm(S.cmp.q || "").split(/\s+/).filter(Boolean);
    const vw = norm(variant).split(/[^a-zа-я0-9%]+/).filter(w => w.length > 1);
    const rows = [
      ...stock.map(x => ({ k: x.key, s: "📦 Наш склад" + (isVitalya(x.src) ? " · Виталя" : isDonor(x.src) ? " · донор" : x.src ? " · " + x.src : ""), src: x.src, t: skShort(x), c: x.cost, a: `на полке ${x.free} шт`, here: true, stock: true })),
      ...supp.map(o => { const w = cmpWhere(o.s, o.t); return { s: o.s, src: o.s, t: String(o.t).replace(/\s*·\s*(в Сочи|под заказ).*$/, ""), c: o.c, a: w.a, here: w.here, when: o.when }; }),
    ].filter(x => !words.length || words.every(w => norm(x.s + " " + x.t).includes(w)))
      .sort((a, b) => (a.c ?? 1e9) - (b.c ?? 1e9));
    const cur = x => norm(x.src) === norm(p.src) && String(x.c) === String(toNum(p.cost)) && (!x.stock || p.stock === x.k);
    const like = x => vw.length && vw.filter(w => norm(x.t).includes(w)).length >= Math.min(2, vw.length);
    const shops = new Set(rows.map(x => x.stock ? "склад" : x.s)).size;
    return `<div class="cmp"><div class="cmp__head"><b>⚖️ ${esc(dev || "модель не узнана")}${op ? " · " + esc(op) : ""}</b>
      <input class="cmp__q" data-act="cmpq" data-i="${i}" value="${esc(S.cmp.q || "")}" placeholder="Фильтр: soft, оригинал, 3750…" autocomplete="off">
      <button type="button" class="linkbtn" data-act="cmp" data-i="${i}">закрыть</button></div>
      ${rows.length ? `<div class="cmp__list">${rows.slice(0, 150).map(x => `<button type="button" class="cmp__row${x.here ? " is-here" : ""}${cur(x) ? " is-on" : ""}${like(x) ? " is-like" : ""}" data-act="cmppick" data-i="${i}" data-s="${esc(x.src || "")}" data-c="${x.c ?? ""}"${x.stock ? ` data-k="${esc(x.k)}"` : ""} title="${esc(x.t)}${x.when ? " · прайс от " + esc(x.when) : ""}">
        <span class="cmp__s">${esc(x.s)}</span><span class="cmp__t">${esc(x.t)}</span><span class="cmp__a">${esc(x.a)}</span><b>${x.c != null ? money(x.c) : "—"}</b></button>`).join("")}</div>
      <p class="note">${rows.length} вариант(ов) у ${shops} источник(ов) · дешевле всего: <b>${esc(rows[0].s)}</b> ${rows[0].c != null ? money(rows[0].c) : ""}${vw.length ? " · подходящие по названию варианта подсвечены" : ""}</p>`
      : `<div class="note">${words.length ? "По фильтру ничего не нашлось." : dev ? "Для этой детали предложений нет." : "Не узнал модель по полю «Устройство»."}</div>`}</div>`;
  }

  // Поставщик выбран: закупка — из индекса; у запчасти из прайса — и итог на разницу.
  function applySupplier(key, r, i, supplier, cost) {
    const list = partsOf(key, r), p = list[i]; if (!p) return;
    const old = toNum(p.cost) ?? 0;
    p.src = supplier; p.cost = String(cost);
    if (p.stock && !skSrcMatch(supplier, S.stock?.byKey?.get(p.stock))) delete p.stock; // сменили поставщика — эта позиция склада уже не подходит
    if (p.fromSvc) {
      const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
      const d = parseDiscount(val(C.discount)), q = toNum(val(C.total));
      if (q != null) { const base = baseOf(q, d) + (cost - old); setDirty(key, C.total, String(Math.max(0, base - discRub(d, base)))); }
    }
    syncParts(key);
  }

  // ── склад запчастей (v31–v33, 02.10.2026; план 66 §15, план 67 задача A) ───────────
  // Владелец: «где проставить остатки запчастей от Витали… когда в заказе выставляю виталину
  // запчасть — чтобы количество списывалось», «встрой ввод остатков в оболочку, по группам и с
  // фильтрами», и следом (v33): «добавь возможность вписать свой вариант запчасти… и самое важное —
  // ставить на склад запчасти не от Витали: откуда закуплена, по какой цене или снята с донора,
  // цена закупки и продажи; Витале в таблицу остатков их не отдаём, держим у себя на отдельном листе».
  //
  // Склад — два листа книги БАЗА:
  //  • «Запчасти Витали» — прайс Витали, его каждую ночь пересобирает vitalya_sheet.mjs; остаток —
  //    колонка I, ночная пересборка переносит её по ключу (Q). Свои строки сюда класть нельзя —
  //    пересборка их стёрла бы.
  //  • «Склад — свои позиции» — всё, что добавлено руками: и свои варианты для Витали (поставщик
  //    «Виталя …»), и запчасти от других поставщиков и с доноров. Колонки повторяют лист Витали там,
  //    где смысл тот же (A–D, F закупка, H продажа, I остаток). Публичная таблица для Витали
  //    (scripts/vitalya_public_stock.mjs) берёт отсюда ТОЛЬКО строки с поставщиком «Виталя».
  // Каждое изменение остатка — строкой в «Запчасти — движение» (K — поставщик). Строку позиции ищем
  // по ключу заново перед каждой записью: ночная пересборка переставляет строки листа Витали.
  // def — «Брак, шт» (v43, 03.10.2026): R у листа Витали, M у своих позиций. Брак — неисправные
  // запчасти у нас, ждут возврата или замены; на полке (I) их нет, Витале уходят отдельной колонкой.
  const SK = { node: 0, model: 1, variant: 2, color: 3, cost: 5, price: 7, qty: 8, tier: 15, key: 16, def: 17 };
  const SKO = { node: 0, model: 1, variant: 2, color: 3, src: 4, cost: 5, note: 6, price: 7, qty: 8, added: 9, who: 10, key: 11, def: 12 };
  const SKO_HEAD = ["Узел", "Модель", "Вариант (качество)", "Цвет", "Поставщик", "Закупка ₽", "Заметка (донор, откуда)", "Цена продажи ₽", "В наличии, шт", "Добавлено", "Кто добавил", "Ключ", "Брак, шт"];
  const SK_DEFCOL = { vit: "R", own: "M" };
  const isVitalya = s => norm(s).includes("витал");
  const isDonor = s => norm(s).includes("донор");
  const skSrcKind = s => isVitalya(s) ? "vit" : isDonor(s) ? "donor" : "other";
  // Подходит ли позиция склада к «Откуда» строки запчасти: пусто — любая; Виталя — Виталины
  // (и из прайса, и свои варианты); донор — с донора; иначе — тот же поставщик по имени.
  function skSrcMatch(src, x) {
    if (!x) return false;
    const s = norm(src); if (!s) return true;
    const k = skSrcKind(src); if (k !== "other") return k === skSrcKind(x.src);
    const xs = norm(x.src);
    return skSrcKind(x.src) === "other" && !!xs && (xs === s || xs.includes(s) || s.includes(xs));
  }
  const skNewKey = () => "свой | " + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const skStr = v => String(v ?? "").trim();
  const skQty = v => Math.max(0, Math.round(toNum(v) ?? 0));
  function skLedgerRow(v) {
    return { ts: String(v[0] ?? ""), key: skStr(v[1]), node: String(v[2] ?? ""), model: String(v[3] ?? ""), variant: String(v[4] ?? ""),
      color: String(v[5] ?? ""), d: toNum(v[6]) ?? 0, order: String(v[7] ?? "").trim(), who: String(v[8] ?? ""), note: String(v[9] ?? ""), src: String(v[10] ?? ""), dd: toNum(v[11]) ?? 0 };
  }
  function loadStock(force) {
    if (!force && (S.stock?.rows || S.stock?.wait)) return S.stock.wait || Promise.resolve();
    const wait = (async () => {
      try {
        let rows, own = [], ledger = [];
        if (DEMO) {
          // Демо: позиции с витрины сайта, остатки выдуманы — у части АКБ и задних стёкол.
          const keep = (S.stock?.rows || []).filter(x => x.own); // свои позиции демо живут до перезагрузки страницы
          ledger = S.stock?.ledger || [];
          const j = await fetch("/data/parts.json", { cache: "no-cache" }).then(r => r.json());
          rows = (j.позиции || []).map((x, i) => {
            const h = parseInt(x.id.slice(0, 4), 16);
            const qty = ["АКБ", "заднее стекло"].includes(x.узел) && /iPhone 1[1-5]/.test(x.модель) && h % 4 === 0 ? 1 + h % 3 : 0;
            return { row: i + 2, sheet: CFG.stock.sheet, node: x.узел, model: x.модель, variant: x.вариант, color: x.цвет || "", src: CFG.stock.supplier,
              cost: Math.round(x.цена / 1.25 / 50) * 50, price: x.цена, qty, def: 0, had: qty > 0, tier: x.вариант, key: x.id };
          });
          own = keep;
        } else {
          const ranges = [`'${CFG.stock.sheet}'!A2:R`, `'${CFG.stock.ledger}'!A2:L`, `'${CFG.stock.own}'!A2:M`];
          const get = list => api(`/values:batchGet?${list.map(x => "ranges=" + encodeURIComponent(x)).join("&")}&valueRenderOption=UNFORMATTED_VALUE`);
          let g;
          try { g = await get(ranges); S.ownMissing = false; }
          catch (e) { if (!/400/.test(e.message)) throw e; g = await get(ranges.slice(0, 2)); S.ownMissing = true; } // листа своих позиций ещё нет — заведём при первом добавлении
          rows = (g.valueRanges?.[0]?.values || []).map((v, i) => ({ row: i + 2, sheet: CFG.stock.sheet, node: skStr(v[SK.node]), model: skStr(v[SK.model]),
            variant: skStr(v[SK.variant]), color: skStr(v[SK.color]), src: CFG.stock.supplier, cost: toNum(v[SK.cost]), price: toNum(v[SK.price]), qty: skQty(v[SK.qty]),
            def: skQty(v[SK.def]), had: String(v[SK.qty] ?? "") !== "", tier: skStr(v[SK.tier]), key: skStr(v[SK.key]) })).filter(x => x.key && x.model);
          ledger = (g.valueRanges?.[1]?.values || []).map(skLedgerRow).filter(x => x.key);
          own = (g.valueRanges?.[2]?.values || []).map((v, i) => ({ row: i + 2, sheet: CFG.stock.own, own: true, node: skStr(v[SKO.node]), model: skStr(v[SKO.model]),
            variant: skStr(v[SKO.variant]), color: skStr(v[SKO.color]), src: skStr(v[SKO.src]), cost: toNum(v[SKO.cost]), note: skStr(v[SKO.note]),
            price: toNum(v[SKO.price]), qty: skQty(v[SKO.qty]), def: skQty(v[SKO.def]), had: String(v[SKO.qty] ?? "") !== "", tier: skStr(v[SKO.variant]), key: skStr(v[SKO.key]) })).filter(x => x.node && x.model);
          // Строку вписали в лист руками, без ключа — даём ключ здесь, иначе её не найти при записи.
          const nokey = own.filter(x => !x.key);
          for (const x of nokey) x.key = skNewKey();
          if (nokey.length) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW",
            data: nokey.map(x => ({ range: `'${CFG.stock.own}'!L${x.row}`, values: [[x.key]] })) }) }).catch(() => {});
        }
        rows = rows.concat(own);
        S.stock = { rows, ledger, byKey: new Map(rows.map(x => [x.key, x])), at: Date.now() };
      } catch (e) { S.stock = { error: e.message }; }
    })();
    S.stock = { ...(S.stock || {}), wait };
    return wait;
  }
  const skStale = () => S.stock?.at && !S.stock.wait && Date.now() - S.stock.at > 300e3;

  // Модель склада по полю «Устройство»: самая длинная, все слова которой есть в тексте
  // («iPhone 13 Pro Max», а не «iPhone 13»), плюс «iPhone 13 серия» — общие детали линейки.
  const skWords = s => norm(s).replace(/айфон/g, "iphone").replace(/[^a-zа-я0-9]+/g, " ").trim();
  function skModelsFor(text, hint) {
    if (!S.stock?.rows) return [];
    const models = [...new Set(S.stock.rows.map(x => x.model))];
    let best = hint && models.includes(hint) ? hint : null;
    if (!best) {
      const s = " " + skWords(text) + " "; let len = 0;
      for (const m of models) {
        const w = skWords(m); if (!w || / серия$/.test(w)) continue;
        if (w.split(" ").every(x => s.includes(" " + x + " ")) && w.length > len) { best = m; len = w.length; }
      }
    }
    if (!best) return [];
    const ser = skWords(best).match(/^iphone (\d{1,2})\b/), all = ser && models.find(m => skWords(m) === `iphone ${ser[1]} серия`);
    return all ? [best, all] : [best];
  }
  // Узел склада по названию запчасти в заказе. Не узнали — подходят все узлы модели.
  const SK_NODE = [[/акб|аккум|батаре/, ["АКБ"]], [/стекл\S* камер/, ["стекло камеры"]], [/фронт/, ["фронтальная камера"]], [/камер/, ["камера", "фронтальная камера"]],
    [/диспле|экран|модул|матриц/, ["дисплей"]], [/задн|крышк/, ["заднее стекло", "корпус"]], [/корпус/, ["корпус"]], [/проклей/, ["проклейка"]],
    [/нижн|разъ[её]м|зарядк/, ["нижний шлейф"]], [/шлейф/, ["шлейф кнопок", "шлейф датчика приближения", "шлейф вспышки", "нижний шлейф"]],
    [/динамик/, ["слуховой динамик", "полифонический динамик"]], [/антенн/, ["антенна"]], [/плат/, ["материнская плата"]], [/magsafe|магнит/, ["магнит MagSafe"]]];
  const skNodesOf = name => ((SK_NODE.find(([re]) => re.test(norm(name))) || [])[1] || null)?.map(norm) || null;
  const skColor = c => String(c || "").split(" · ").pop();
  const skShort = x => `${cap(x.node)} ${x.variant}${x.color ? ", " + skColor(x.color) : ""}`;
  const skFrom = x => isVitalya(x.src) ? "" : ` · ${isDonor(x.src) ? "донор" : x.src}`;

  // Что лежит на полке для этой строки запчасти: та же модель, тот же узел, тот же поставщик (если
  // он вписан), с учётом того, что уже выбрано другими строками этой карточки. null — модель не узнали.
  // anySrc (v36) — не смотреть на «Откуда» строки: показать всё, что лежит на полке для этой модели и узла.
  function skCandidates(key, r, p, anySrc) {
    if (!S.stock?.rows) return null;
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const models = skModelsFor(val(C.device), p.dev);
    if (!models.length) return null;
    const nodes = skNodesOf(p.name), taken = new Map();
    for (const q of partsOf(key, r)) if (q !== p && q.stock) taken.set(q.stock, (taken.get(q.stock) || 0) + 1);
    return S.stock.rows.filter(x => models.includes(x.model) && (!nodes || nodes.includes(norm(x.node))) && (anySrc || skSrcMatch(p.src, x)))
      .map(x => ({ ...x, free: x.qty - (taken.get(x.key) || 0) })).filter(x => x.free > 0);
  }
  function skBind(key, r, i, k) {
    const p = partsOf(key, r)[i], x = S.stock?.byKey?.get(k); if (!p || !x) return null;
    if (!String(p.name).trim()) p.name = skShort(x);
    if (x.cost != null) applySupplier(key, r, i, x.src, x.cost); else { p.src = x.src; syncParts(key); }
    p.stock = k;
    return x;
  }
  // Выбрали поставщика: на полке ровно одна подходящая позиция от него — берём её сразу
  // (владелец: «автоматически списывалась»), несколько — выбирают кнопкой. Если поставщика
  // выбрали кнопкой с качеством, берём только то же качество: иначе под «Сервисный оригинал»
  // молча списался бы TFT, который лежит на полке.
  function skAuto(key, r, i, hint) {
    const p = partsOf(key, r)[i]; if (!p || p.stock || !norm(p.src)) return null;
    let c = skCandidates(key, r, p); if (!c?.length) return null;
    // Подпись в индексе — «Аккумуляторы · Оригинал (без привязки)», бывает и с хвостом «· SIM/eSIM».
    if (hint) c = c.filter(x => x.tier && String(hint).split(" · ").some(seg => norm(seg) === norm(x.tier)));
    if (c.length !== 1) return null;
    if (r && skWrittenOff(cell(r, C.num)).some(w => w.key === c[0].key)) return null; // уже списывали в этот заказ — пусть решат кнопкой
    return skBind(key, r, i, c[0].key);
  }
  const skPending = key => (S.parts.get(key) || []).filter(p => p.stock && skSrcMatch(p.src, S.stock?.byKey?.get(p.stock))).map(p => ({ key: p.stock, name: String(p.name).trim() }));
  // Сколько каждой позиции списано в заказ: сумма движения по номеру заказа.
  function skWrittenOff(num) {
    const n = String(num ?? "").trim(), net = new Map();
    if (!n || !S.stock?.ledger) return [];
    for (const x of S.stock.ledger) if (x.order === n) net.set(x.key, (net.get(x.key) || 0) + x.d);
    return [...net].filter(([, d]) => d < 0).map(([key, d]) => ({ key, n: -d, x: S.stock.byKey?.get(key) || S.stock.ledger.find(l => l.key === key) }));
  }

  // Ключ позиции везде сравнивается ОБРЕЗАННЫМ: у позиций Витали без цвета ключ кончается
  // пробелом («дисплей | … | »). В v33 при записи ключ из листа обрезался, а в загруженном списке —
  // нет, и −/+ по таким позициям отвечал «позиции нет в листе» (исправлено 02.10.2026, v35).
  // Запись остатков. ops: { key, d } — сдвиг (списание −1, возврат +1) или { key, set, base } —
  // число со склада, base — что было при загрузке. Если в листе уже не base (кто-то успел
  // списать), число не пишем, а просим проверить. В минус остаток не уходит: списали, а в листе
  // уже 0 — движение пишется с пометкой, остаток остаётся 0.
  // dd (v43) — сдвиг брака: «с полки в брак» = { d: −1, dd: +1 }, «брак не с полки» = { dd: +1 },
  // «отдал Витале» = { dd: −1 }. Брак тоже не уходит в минус. В журнале — колонка L «± Брак».
  async function stockApply(ops) {
    const done = [], skipped = [];
    if (!ops.length) return { done, skipped };
    const ts = mskStamp().slice(0, 16), who = S.email || "";
    let at;
    if (DEMO) at = new Map(S.stock.rows.map(x => [x.key, { sheet: x.sheet, row: x.row, qty: x.qty, def: x.def || 0, dc: x.own ? SK_DEFCOL.own : SK_DEFCOL.vit }]));
    else {
      const R = [[CFG.stock.sheet, "Q2:Q", SK_DEFCOL.vit], ...(S.ownMissing ? [] : [[CFG.stock.own, "L2:L", SK_DEFCOL.own]])];
      const q = R.flatMap(([sh, k, dc]) => [k, "I2:I", `${dc}2:${dc}`].map(x => "ranges=" + encodeURIComponent(`'${sh}'!${x}`))).join("&");
      const g = await api(`/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`);
      at = new Map();
      R.forEach(([sh, , dc], j) => {
        const keys = g.valueRanges?.[3 * j]?.values || [], qs = g.valueRanges?.[3 * j + 1]?.values || [], ds = g.valueRanges?.[3 * j + 2]?.values || [];
        keys.forEach((v, i) => { const k = String(v?.[0] ?? "").trim(); if (k && !at.has(k)) at.set(k, { sheet: sh, row: i + 2, qty: skQty(qs[i]?.[0]), def: skQty(ds[i]?.[0]), dc }); });
      });
    }
    const cells = new Map(), log = [];
    for (const op of ops) {
      const cur = at.get(op.key), m = S.stock?.byKey?.get(op.key) || {};
      if (!cur) { skipped.push({ op, why: "позиции нет в листе — прайс Витали пересобран или строку удалили, обновите склад" }); continue; }
      if (op.set != null && op.base != null && cur.qty !== op.base) { skipped.push({ op, why: `пока правили, в листе стало ${cur.qty} шт` }); continue; }
      const from = cur.qty, to = Math.max(0, op.set != null ? op.set : from + (op.d || 0)), d = op.set != null ? to - from : (op.d || 0);
      const dFrom = cur.def, dTo = Math.max(0, dFrom + (op.dd || 0)), dd = dTo - dFrom;
      if (!d && !dd) { if (op.dd < 0) skipped.push({ op, why: "брака по этой позиции в листе уже нет" }); continue; }
      if (op.d < 0 && op.dd > 0 && from < -op.d) { skipped.push({ op, why: from === 0 ? "на полке 0 — нечего переносить в брак (если пришло бракованным — «＋ брак не с полки»)" : `на полке только ${from} шт` }); continue; }
      if (d) { cur.qty = to; cells.set(cur.sheet + "!I" + cur.row, { range: `'${cur.sheet}'!I${cur.row}`, v: to }); }
      if (dd) { cur.def = dTo; cells.set(cur.sheet + "!" + cur.dc + cur.row, { range: `'${cur.sheet}'!${cur.dc}${cur.row}`, v: dTo || "" }); }
      const note = (op.note || `${d > 0 ? "Приход" : "Правка остатка"} (склад в CRM)`) +
        (d ? `: было ${from} → стало ${to}` : "") + (dd ? `${d ? "," : ":"} брак ${dFrom} → ${dTo}` : "") + (d < 0 && from === 0 ? " · в листе было 0 — проверьте полку" : "");
      log.push([ts, op.key, m.node || "", m.model || "", m.variant || "", m.color || "", d, op.order || "", who, note, m.src || "", dd || ""]);
      done.push({ op, from, to, d, dTo, dd });
    }
    if (!DEMO && cells.size) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW",
      data: [...cells.values()].map(c => ({ range: c.range, values: [[c.v]] })) }) });
    if (!DEMO && log.length) await skLog(log);
    for (const x of done) { const s = S.stock?.byKey?.get(x.op.key); if (s) { s.qty = x.to; s.def = x.dTo; s.had = true; } }
    if (S.stock?.ledger) S.stock.ledger.push(...log.map(skLedgerRow));
    return { done, skipped };
  }
  const skLog = log => api(`/values/${encodeURIComponent(`'${CFG.stock.ledger}'!A:L`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: log }) });
  // Списание при сохранении заказа — по строке движения на каждую запчасть со склада. Не вышло —
  // в карточке остаётся «⚠️ не списано» с «Повторить»: заказ уже записан, а молча потерять
  // списание нельзя (остаток на сайте и у Витали врал бы).
  async function skWriteOff(num, ops) {
    num = String(num).trim();
    try {
      const res = await stockApply(ops.map(o => ({ key: o.key, d: -1, order: num, note: `Заказ №${num}` + (o.name ? ` (${o.name})` : "") })));
      const left = res.skipped.map(s => ops.find(o => o.key === s.op.key)).filter(Boolean);
      S.skFailed = left.length ? { num, ops: left, why: res.skipped[0].why } : null;
      return (res.done.length ? ` · 📦 со склада списано: ${res.done.length}` : "") + (left.length ? " · ⚠️ не всё списано — см. карточку" : "");
    } catch (e) {
      S.skFailed = { num, ops, why: e.message };
      return " · ⚠️ со склада НЕ списано — см. карточку";
    }
  }

  // ── свои позиции: добавить и поправить (v33) ───────────────────────────────────
  async function skEnsureOwn() {
    if (DEMO || !S.ownMissing) return;
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CFG.stock.own, gridProperties: { frozenRowCount: 1 } } } }] }) });
    await api(`/values/${encodeURIComponent(`'${CFG.stock.own}'!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [SKO_HEAD] }) });
    S.ownMissing = false;
  }
  // f: { node, model, variant, color, src, cost, price, qty, note }. Остаток пишется сразу в строку,
  // приход — строкой в журнал движения.
  async function skAddOwn(f) {
    await skEnsureOwn();
    const key = skNewKey(), ts = mskStamp().slice(0, 16), who = S.email || "";
    const cells = [f.node, f.model, f.variant, f.color, f.src, f.cost ?? "", f.note, f.price ?? "", f.qty, ts, who, key];
    let row = Math.max(1, ...S.stock.rows.filter(x => x.own).map(x => x.row)) + 1;
    const log = f.qty ? [[ts, key, f.node, f.model, f.variant, f.color, f.qty, "", who, `Новая позиция (склад в CRM): было 0 → стало ${f.qty}`, f.src]] : [];
    if (!DEMO) {
      const res = await api(`/values/${encodeURIComponent(`'${CFG.stock.own}'!A:L`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: [cells] }) });
      row = +(String(res.updates?.updatedRange || "").match(/![A-Z]+(\d+)/)?.[1] || row);
      if (log.length) await skLog(log);
    }
    const x = { row, sheet: CFG.stock.own, own: true, node: f.node, model: f.model, variant: f.variant, color: f.color, src: f.src, cost: f.cost, note: f.note,
      price: f.price, qty: f.qty, had: true, tier: f.variant, key };
    S.stock.rows.push(x); S.stock.byKey.set(key, x); S.stock.ledger.push(...log.map(skLedgerRow));
    return x;
  }
  // Правка своей позиции: качество, цвет, поставщик, закупка, заметка, продажа (C–H). Остаток —
  // кнопками −/+ в списке, через журнал, как у всех.
  async function skEditOwn(k, f) {
    const x = S.stock.byKey.get(k); if (!x) throw new Error("позиция не найдена — обновите склад");
    let row = x.row;
    if (!DEMO) {
      const g = await api(`/values/${encodeURIComponent(`'${CFG.stock.own}'!L2:L`)}`);
      const i = (g.values || []).findIndex(v => String(v?.[0] ?? "").trim() === k);
      if (i < 0) throw new Error("строки позиции больше нет в листе — обновите склад");
      row = i + 2;
      await api(`/values/${encodeURIComponent(`'${CFG.stock.own}'!C${row}:H${row}`)}?valueInputOption=RAW`,
        { method: "PUT", body: JSON.stringify({ values: [[f.variant, f.color, f.src, f.cost ?? "", f.note, f.price ?? ""]] }) });
    }
    Object.assign(x, { row, variant: f.variant, tier: f.variant, color: f.color, src: f.src, cost: f.cost, note: f.note, price: f.price });
    return x;
  }
  // Поставщики для формы: Виталя и донор первыми, дальше — список колонки «Откуда» базы.
  function skSuppliers() {
    const out = [CFG.stock.supplier, "Донор", "MosLCD", "Liberti", "Скай Моби", "OZON", "AliExpress"];
    for (const s of S.opts[C.partFrom] || []) if (!out.some(o => norm(o) === norm(s))) out.push(s);
    return out;
  }
  // Форма добавления/правки. Название позиции — общее, из узла и раздела-модели, где нажали
  // кнопку; качество, поставщика, цены и количество человек проставляет сам.
  function skAddHtml() {
    const a = S.skAdd, f = a.f, dk = skSrcKind(f.src), sup = skSuppliers();
    const nodes = [...new Set(S.stock.rows.map(x => x.node))], models = [...new Set(S.stock.rows.map(x => x.model))];
    const tiers = [...new Set(S.stock.rows.filter(x => !f.node || norm(x.node) === norm(f.node)).map(x => x.variant))].slice(0, 60);
    const colors = [...new Set(S.stock.rows.filter(x => x.model === f.model && x.color).map(x => x.color))];
    const inp = (k, label, extra = "") => `<label class="field"><span>${label}</span><input data-skf="${k}" value="${esc(f[k] ?? "")}"${extra}></label>`;
    const title = a.lockModel ? `<b>${esc(cap(f.node))} · ${esc(f.model)}</b>` : "своя позиция";
    return `<div class="sk-add" id="sk-add">
      <div class="sk-add__title">${a.edit ? "✎ Правка" : "＋ Новая запчасть"}: ${title}</div>
      ${a.lockModel ? "" : `<div class="grid2">${inp("node", "Деталь (узел)", ` list="dl-sknode" placeholder="например, АКБ"`)}${inp("model", "Модель", ` list="dl-skmodel" placeholder="например, iPhone 13 Pro"`)}</div>`}
      <div class="field"><span>Откуда</span><div class="tchips sk-src">${sup.slice(0, 7).map(s => `<button type="button" class="tchip" data-act="sksrc" data-v="${esc(s)}" aria-pressed="${norm(s) === norm(f.src)}">${esc(isDonor(s) ? "🔧 Снята с донора" : s)}</button>`).join("")}</div>
        <input data-skf="src" value="${esc(f.src)}" list="dl-sksrc" placeholder="или впишите поставщика"></div>
      <div class="grid2">${inp("variant", "Качество (вариант)", ` list="dl-sktier" placeholder="например, Оригинал (без привязки)"`)}${inp("color", "Цвет <small class=\"note\">(если важен)</small>", ` list="dl-skcolor"`)}</div>
      <div class="grid3">${inp("cost", dk === "donor" ? "Себестоимость, ₽ <small class=\"note\">(можно 0)</small>" : "Закупка, ₽", ` inputmode="decimal" placeholder="0"`)}${inp("price", dk === "vit" ? "Цена продажи, ₽ <small class=\"note\">(можно пусто)</small>" : "Цена продажи, ₽", ` inputmode="decimal" placeholder="0"`)}${a.edit ? "" : inp("qty", "Количество, шт", ` inputmode="numeric" placeholder="1"`)}</div>
      ${inp("note", dk === "donor" ? "С какого устройства снята <small class=\"note\">(модель, заказ №)</small>" : "Заметка", ` placeholder="${dk === "donor" ? "например, iPhone 13 Pro, заказ №7790" : ""}"`)}
      <div class="row"><button type="button" class="btn btn--red btn--sm" data-act="skaddsave">${a.edit ? "Сохранить позицию" : "Добавить на склад"}</button><button type="button" class="btn btn--ghost btn--sm" data-act="skaddcancel">Отмена</button></div>
      <p class="note">${dk === "vit" ? "Поставщик — Виталя: позиция попадёт и в его таблицу остатков." : "Не от Витали: в его таблицу остатков не попадает, хранится только у нас на листе «" + esc(CFG.stock.own) + "»."}</p>
      <datalist id="dl-sksrc">${sup.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-sktier">${tiers.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-skcolor">${colors.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-sknode">${nodes.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
      <datalist id="dl-skmodel">${models.map(s => `<option value="${esc(s)}">`).join("")}</datalist>
    </div>`;
  }
  async function skAddSave(btn) {
    const a = S.skAdd, f = a.f;
    const g = { node: skStr(f.node), model: skStr(f.model), variant: skStr(f.variant), color: skStr(f.color), src: skStr(f.src), note: skStr(f.note),
      cost: toNum(f.cost), price: toNum(f.price), qty: String(f.qty ?? "").trim() === "" ? 1 : Math.round(toNum(f.qty) ?? NaN) };
    const miss = !g.node ? "деталь (узел)" : !g.model ? "модель" : !g.src ? "откуда (поставщик или донор)" : !g.variant ? "качество" : !a.edit && !(g.qty >= 0) ? "количество" : "";
    if (miss) return toast("Заполните: " + miss);
    if (!a.edit && S.stock.rows.some(x => x.own && x.model === g.model && norm(x.node) === norm(g.node) && norm(x.variant) === norm(g.variant) && norm(x.color) === norm(g.color) && norm(x.src) === norm(g.src)))
      return toast("Такая позиция уже есть — поправьте её остаток кнопками −/+");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    const y = window.scrollY;
    try {
      const x = a.edit ? await skEditOwn(a.edit, g) : await skAddOwn(g);
      S.skAdd = null;
      const hid = skReveal(x);
      toast((DEMO ? "Сохранено (демо — в таблицу не пишется)" : `${a.edit ? "Позиция поправлена" : "Добавлено на склад"} ✓ ${skShort(x)}${skFrom(x)}${a.edit ? "" : ` — ${x.qty} шт`}`)
        + (hid.length ? ` · сняты фильтры, которые её прятали: ${hid.join(", ")}` : ""), null, true);
      renderStock();
      const el = $app.querySelector(`[data-skrow="${CSS.escape(x.key)}"]`);
      if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("is-new"); return; }
    } catch (e) { toast(e.message, null, true); }
    renderStock(); window.scrollTo(0, y);
  }

  // Владелец 02.10.2026: «добавлял АКБ 13 Pro снятый оригинал — сохранилось, но на складе не
  // отображается». Позиция легла в лист, а на экране её прятали фильтры, оставшиеся с прошлого
  // раза («Оригинал»: «снятый» — это класс «б/у»). Теперь после добавления снимаются ровно те
  // фильтры, что прячут новую позицию, и об этом говорится в сообщении.
  function skReveal(x) {
    const f = S.sk, hid = [];
    if (f.grp && skGroup(x.node) !== f.grp) { hid.push(f.grp); f.grp = ""; f.node = ""; }
    if (f.node && x.node !== f.node) { hid.push(cap(f.node)); f.node = ""; }
    if (f.cls && skClass(x.tier) !== f.cls) { hid.push(SK_CLASSES.find(c => c[0] === f.cls)?.[1] || f.cls); f.cls = ""; }
    if (f.tier && x.tier !== f.tier) { hid.push(f.tier); f.tier = ""; }
    if (f.src && skSrcKind(x.src) !== f.src) { hid.push(SK_SRC.find(c => c[0] === f.src)?.[1] || f.src); f.src = ""; }
    if (f.ser && skSeries(x.model) !== f.ser) { hid.push(f.ser); f.ser = ""; }
    if (f.q) { const t = skWords(`${x.node} ${x.model} ${x.variant} ${x.color} ${x.src} ${x.note}`); if (!skWords(f.q).split(" ").filter(Boolean).map(w => SK_SYN[w] || w).every(w => t.includes(w))) { hid.push("поиск"); f.q = ""; } }
    if (skOnly() && !(x.qty > 0)) { hid.push("только в наличии"); f.only = false; }
    f.limit = Math.max(f.limit, 150);
    store.set("crm.sk", { grp: f.grp, node: f.node, ser: f.ser, cls: f.cls, tier: f.tier, src: f.src, only: f.only });
    return hid;
  }
  // Строка запчасти в заказе: со склада она или можно взять со склада.
  function stockPartHtml(key, r, p, i) {
    if (!S.stock?.rows) return "";
    const bound = p.stock && S.stock.byKey.get(p.stock);
    if (bound && skSrcMatch(p.src, bound))
      return `<div class="psk is-on">📦 Со склада: <b>${esc(skShort(bound) + skFrom(bound))}</b> — спишется при сохранении<button type="button" class="linkbtn" data-act="skunbind" data-i="${i}">не со склада</button></div>`;
    if (!norm(p.src) && !String(p.name).trim()) return ""; // пустая строка — не подсказываем
    if (skCovered(key, r).has(i)) return `<div class="psk is-on"><span>📦 уже списана со склада</span></div>`;
    const c = skCandidates(key, r, p);
    if (c == null) return "";
    // Наше от других поставщиков (v36). Владелец 02.10.2026: «при добавлении работы предлагал запчасти
    // не только от мосов, но и наши в наличии». Запчасть из прайса приходит с поставщиком MosLCD, и
    // раньше полка показывалась только того же поставщика — Виталина или своя деталь на полке не была
    // видна. Кнопка берёт позицию со склада: поставщик и закупка строки меняются на её.
    const other = norm(p.src) ? skCandidates(key, r, p, true).filter(x => !c.some(y => y.key === x.key)) : [];
    const chips = list => list.map(x => `<button type="button" class="psup__c" data-act="skbind" data-i="${i}" data-k="${esc(x.key)}">${esc(skShort(x) + skFrom(x) + (isVitalya(x.src) && !isVitalya(p.src) ? " · Виталя" : ""))} <b>${x.free} шт</b>${x.cost != null ? ` · ${money(x.cost)}` : ""}</button>`).join("");
    let h = "";
    if (c.length) h += `<div class="psk"><span class="note">📦 ${norm(p.src) ? "Есть на складе, взять" : "На складе есть"}:</span>${chips(c)}</div>`;
    else if (isVitalya(p.src) && !other.length) h += `<div class="psk"><span class="note">📦 На складе такой нет — под заказ, списывать нечего</span></div>`;
    if (other.length) h += `<div class="psk"><span class="note">📦 У нас на складе (другой поставщик):</span>${chips(other)}</div>`;
    return h;
  }
  // Какие строки запчастей уже покрыты списанием в этот заказ (после сохранения привязка
  // к позиции склада не хранится — она в журнале): списанное раздаём строкам того же поставщика
  // по узлу, чтобы под ними не предлагать «взять со склада» второй раз.
  function skCovered(key, r) {
    const out = new Set(); if (!r) return out;
    const w = skWrittenOff(cell(r, C.num)).flatMap(x => Array(x.n).fill(x));
    partsOf(key, r).forEach((p, i) => {
      if (p.stock || !norm(p.src) || !w.length) return;
      const nodes = skNodesOf(p.name), j = w.findIndex(x => skSrcMatch(p.src, x.x) && (!nodes || nodes.includes(norm(x.x?.node))));
      if (j >= 0) { out.add(i); w.splice(j, 1); }
    });
    return out;
  }
  // Под запчастями: что уже списано в этот заказ (с возвратом) и что не удалось списать.
  function stockOrderHtml(r, lock) {
    const num = r ? String(cell(r, C.num)).trim() : "";
    if (!num || !S.stock?.rows) return "";
    const w = skWrittenOff(num), f = S.skFailed?.num === num ? S.skFailed : null;
    // Сколько из списанного в этот заказ уже ушло в брак (v43): «± Брак» по номеру заказа.
    const bad = new Map(); for (const l of S.stock.ledger || []) if (l.order === num && l.dd) bad.set(l.key, (bad.get(l.key) || 0) + l.dd);
    let h = "";
    if (w.length) h += `<div class="psk-done"><b>📦 Списано со склада в этот заказ:</b>${w.map(x => { const b = Math.max(0, bad.get(x.key) || 0);
      return `<span>${esc(x.x ? skShort(x.x) + skFrom(x.x) : x.key)}${x.n > 1 ? " ×" + x.n : ""}${b ? ` <em class="sk-bad">🚫 в браке ${b > 1 ? b + " шт" : ""}</em>` : ""}${lock ? "" : `<button type="button" class="linkbtn" data-act="skret" data-k="${esc(x.key)}">↩ вернуть на склад</button>${b < x.n ? `<button type="button" class="linkbtn" data-act="skretbad" data-k="${esc(x.key)}" title="Деталь оказалась неисправной: в брак (Витале видно в таблице), на полку не возвращается">🚫 в брак</button>` : ""}`}</span>`; }).join("")}</div>`;
    if (f) h += `<div class="psk-fail">⚠️ Со склада не списано (${esc(f.ops.map(o => o.name || o.key).join(", "))}): ${esc(f.why)}<button type="button" class="linkbtn" data-act="skretry">Повторить</button><button type="button" class="linkbtn" data-act="skforget">Не списывать</button></div>`;
    return h;
  }

  // ── экран «Склад»: остатки по группам и с фильтрами ─────────────────────────────
  // Группа → подгруппа (узел) → качество → поставщик → серия → модель. 923 позиции не помещаются
  // одним списком, поэтому по умолчанию — «только в наличии» (если на полке что-то есть), а
  // остальное открывается фильтрами и поиском («13 про акб»). Правка — кнопками −/+ или числом,
  // запись одной кнопкой «Сохранить остатки», каждое изменение — строкой в журнал движения.
  // Под каждой моделью — «＋ Добавить запчасть» (своя позиция с узлом и моделью этого раздела).
  const SK_GROUPS = [
    ["АКБ", ["АКБ"]], ["Дисплеи", ["дисплей"]],
    ["Корпус и стёкла", ["заднее стекло", "корпус", "стекло камеры", "проклейка", "магнит MagSafe"]],
    ["Камеры", ["камера", "фронтальная камера"]],
    ["Шлейфы и динамики", ["нижний шлейф", "шлейф кнопок", "шлейф датчика приближения", "шлейф вспышки", "антенна", "слуховой динамик", "полифонический динамик"]],
    ["Платы", ["материнская плата"]],
    ["Аксессуары", ["защитное стекло", "зарядное устройство", "кабель", "переходник"]],
  ];
  const skGroup = node => (SK_GROUPS.find(([, ns]) => ns.some(n => norm(n) === norm(node))) || ["Прочее"])[0];
  const skGroupRank = g => { const i = SK_GROUPS.findIndex(x => x[0] === g); return i < 0 ? 99 : i; };
  const skNodeRank = node => { const g = SK_GROUPS.find(([, ns]) => ns.some(n => norm(n) === norm(node))); return g ? g[1].findIndex(n => norm(n) === norm(node)) : 99; };
  function skSeries(model) {
    const m = skWords(model); let x;
    if (m.includes("watch")) return "Apple Watch";
    if (m.includes("macbook")) return "MacBook";
    if (!m.includes("iphone")) return "Другие устройства и аксессуары";
    if ((x = m.match(/iphone (\d{1,2})(?:s|e)?\b/))) return "iPhone " + x[1];
    if (/iphone (x|xs|xr)\b/.test(m)) return "iPhone X / XS / XR";
    if (m.includes("iphone se")) return "iPhone SE";
    return "iPhone, другие";
  }
  const skSerRank = s => { const n = s.match(/^iPhone (\d+)$/); return n ? -n[1] : { "iPhone X / XS / XR": -10.5, "iPhone SE": -7.5, "iPhone, другие": 0, "Apple Watch": 50, "MacBook": 60, "Другие устройства и аксессуары": 70 }[s] ?? 80; };
  const SK_SYN = { "про": "pro", "макс": "max", "мини": "mini", "плюс": "plus", "эйр": "air", "аир": "air", "се": "se", "экран": "диспле", "дисплей": "диспле",
    "аккумулятор": "акб", "батарея": "акб", "крышка": "задн", "камера": "камер", "часы": "watch", "макбук": "macbook", "черный": "black", "белый": "white" };
  // Качество (v32, 02.10.2026, владелец: «добавь фильтр по типам качества»). У Витали 46 вариантов
  // качества («Тир», колонка P) — одним рядом не читается. Поэтому два уровня, как группа → узел:
  // класс (оригинал / копия-аналог / б/у и переклей), внутри — точные варианты. У камер, шлейфов,
  // динамиков класса нет — там вариант один на модель, и выбор класса их скрывает.
  const SK_CLASSES = [["orig", "Оригинал"], ["copy", "Копия / аналог"], ["bu", "Б/у и переклей"]];
  function skClass(tier) {
    const t = norm(tier);
    if (/б\/у|переклей|снят/.test(t)) return "bu";
    if (/оригинал|original|orig\b|service pack/.test(t)) return "orig";
    if (/tft|oled|копия|банка/.test(t)) return "copy";
    return "";
  }
  const skClassRank = t => { const i = SK_CLASSES.findIndex(c => c[0] === skClass(t)); return i < 0 ? 9 : i; };
  // Откуда (v33): Виталя (прайс и свои варианты) / другие поставщики / с донора.
  const SK_SRC = [["vit", "Виталя"], ["other", "Другие поставщики"], ["donor", "С донора"]];
  const skOnly = () => S.sk.only ?? S.stock.rows.some(x => x.qty > 0);
  function skFilter(skip = {}) {
    const f = S.sk, words = skWords(f.q).split(" ").filter(Boolean).map(w => SK_SYN[w] || w), only = skOnly();
    // «🚫 Весь брак» (v48): владелец — «фильтр, чтобы показать весь брак». Остальные фильтры
    // (группа, качество, поставщик, модель, «только в наличии») помнятся на устройстве и прятали бы
    // часть брака — в этом режиме они не действуют, сужает только строка поиска.
    const hit = x => !words.length || words.every(w => skWords(`${x.node} ${x.model} ${x.variant} ${x.color} ${x.own ? x.src + " " + x.note : ""}`).includes(w));
    if (f.bad) return S.stock.rows.filter(x => x.def > 0 && hit(x));
    return S.stock.rows.filter(x => {
      if (!skip.grp && f.grp && skGroup(x.node) !== f.grp) return false;
      if (!skip.node && f.node && x.node !== f.node) return false;
      if (!skip.ser && f.ser && skSeries(x.model) !== f.ser) return false;
      if (!skip.cls && f.cls && skClass(x.tier) !== f.cls) return false;
      if (!skip.tier && f.tier && x.tier !== f.tier) return false;
      if (!skip.src && f.src && skSrcKind(x.src) !== f.src) return false;
      if (only && !(x.qty > 0 || x.def > 0 || S.skDirty.has(x.key))) return false;
      if (words.length) { const t = skWords(`${x.node} ${x.model} ${x.variant} ${x.color} ${x.own ? x.src + " " + x.note : ""}`); if (!words.every(w => t.includes(w))) return false; }
      return true;
    });
  }
  // Какие фильтры сейчас сужают список — одной строкой, со сбросом. Фильтры помнятся на устройстве,
  // и без этой строки легко забыть, что вчерашний «iPhone 13 · Оригинал» прячет всё остальное.
  function skActiveHtml(list) {
    const f = S.sk, on = [f.grp, f.node && cap(f.node), f.cls && SK_CLASSES.find(c => c[0] === f.cls)?.[1], f.tier, f.src && SK_SRC.find(c => c[0] === f.src)?.[1], f.ser, f.q && `«${f.q}»`, f.bad && "только брак"].filter(Boolean);
    if (f.bad) return `<div class="sk-active">Режим «Брак»: весь брак склада${f.q ? ` по поиску «${esc(f.q)}»` : ""}, остальные фильтры не действуют.<button type="button" class="linkbtn" data-act="skbad">✕ выйти из брака</button></div>`;
    if (!on.length) return "";
    const inStock = S.stock.rows.filter(x => x.qty > 0).length, shownIn = list.filter(x => x.qty > 0).length;
    return `<div class="sk-active">Фильтры: <b>${on.map(esc).join(" · ")}</b>${inStock > shownIn ? ` — скрыто из наличия: <b>${inStock - shownIn}</b> поз.` : ""}<button type="button" class="linkbtn" data-act="skreset">✕ сбросить все</button></div>`;
  }
  function skRowHtml(x) {
    const d = S.skDirty.has(x.key), v = d ? S.skDirty.get(x.key) : x.qty || "";
    const from = x.own ? `<em class="sk-src sk-src--${skSrcKind(x.src)}">${esc(isDonor(x.src) ? "🔧 донор" : isVitalya(x.src) ? "свой вариант · Виталя" : x.src)}</em>` : "";
    const sub = [x.color, x.note].filter(Boolean).map(esc).join(" · ");
    const bad = x.def > 0 ? `<em class="sk-bad" title="Неисправные, ждут возврата или замены">🚫 брак ${x.def} шт</em>` : "";
    return `<div class="sk__row${x.qty > 0 ? " is-in" : ""}${d ? " is-dirty" : ""}${x.own ? " is-own" : ""}${x.def > 0 ? " has-bad" : ""}" data-skrow="${esc(x.key)}">
      <div class="sk__name"><b>${esc(x.variant)}</b>${from}${bad}${x.own ? `<button type="button" class="linkbtn sk-edit" data-act="skedit" data-k="${esc(x.key)}" title="Поправить позицию">✎</button>` : ""}${S.sk.bad ? `<button type="button" class="linkbtn sk-defedit" data-act="skdef" data-k="${esc(x.key)}" aria-expanded="${S.skDef === x.key}">± брак</button>` : ""}${sub ? `<span>${sub}</span>` : ""}${skPickHtml(x)}</div>
      <div class="sk__cost">${x.cost != null ? money(x.cost) : ""}${x.price != null ? `<small>прод. ${money(x.price)}</small>` : ""}</div>
      <div class="sk__qty"><button type="button" data-act="skstep" data-d="-1" data-k="${esc(x.key)}" aria-label="Меньше">−</button><input data-skq="${esc(x.key)}" value="${esc(v)}" placeholder="0" inputmode="numeric" autocomplete="off" aria-label="Остаток, шт"><button type="button" data-act="skstep" data-d="1" data-k="${esc(x.key)}" aria-label="Больше">+</button></div>
    </div>${S.sk.bad && S.skDef === x.key ? skDefHtml(x) : ""}`;
  }
  // ── брак (v43, 03.10.2026) ─────────────────────────────────────────────────────────
  // Владелец: «добавь возможность завести брак, чтобы это также попадало в остатки для Витали».
  // Брак — отдельный счётчик позиции (R у листа Витали, M у своих), а не минус на полке: деталь
  // физически у нас, но продать её нельзя, и Виталя должен видеть, что её надо забрать или
  // заменить. Три действия — они покрывают все пути: сняли с полки неисправную; пришла
  // бракованной или вернулась из заказа (на полке её уже нет); отдали поставщику. Каждое — строка
  // в журнале движения с «± Брак». Брак Витали попадает в его таблицу остатков (колонка «Брак, шт»).
  function skDefHtml(x) {
    const vit = isVitalya(x.src), back = vit ? "↩ Отдал Витале" : isDonor(x.src) ? "🗑 Выбросил" : "↩ Вернул поставщику";
    return `<div class="sk-def" data-skdefbox="${esc(x.key)}">
      <div class="sk-def__top"><label class="sk-def__n">Сколько, шт<input data-skdefq value="1" inputmode="numeric" autocomplete="off"></label>
      <input class="sk-def__note" data-skdefnote placeholder="Неисправность: что не так (и № заказа, если вернули из заказа)" autocomplete="off"></div>
      <div class="row">
        <button type="button" class="btn btn--sm" data-act="skdefgo" data-m="shelf" data-k="${esc(x.key)}"${x.qty > 0 ? "" : " disabled"} title="${x.qty > 0 ? "" : "на полке 0"}">🚫 С полки в брак</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="skdefgo" data-m="add" data-k="${esc(x.key)}">＋ Брак не с полки</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="skdefgo" data-m="back" data-k="${esc(x.key)}"${x.def > 0 ? "" : " disabled"}>${back}</button>
      </div>
      <p class="note">«Не с полки» — пришла бракованной или вернулась из заказа: остаток на полке не меняется.${vit ? " Брак Витали виден ему в таблице остатков." : " Не от Витали — Витале не показывается."}</p>
    </div>`;
  }
  async function skDefApply(t) {
    const k = t.dataset.k, m = t.dataset.m, x = S.stock?.byKey?.get(k); if (!x) return;
    if (S.skDirty.has(k)) return toast("Сначала сохраните остаток этой позиции");
    const box = $app.querySelector(`[data-skdefbox="${CSS.escape(k)}"]`);
    const note = String(box?.querySelector("[data-skdefnote]")?.value || "").trim();
    // Сколько штук (v48): владелец — «вводить количество и описание неисправности».
    const n = Math.floor(+String(box?.querySelector("[data-skdefq]")?.value || "1").replace(",", ".")) || 0;
    if (n < 1) return toast("Сколько штук? Впишите число от 1");
    if (m === "shelf" && n > x.qty) return toast(`На полке только ${x.qty} шт`);
    if (m === "back" && n > (x.def || 0)) return toast(`В браке только ${x.def || 0} шт`);
    const num = (note.match(/(?:№|#|заказ\S*\s*)(\d{3,6})/i) || note.match(/^(\d{4,6})$/) || [])[1] || "";
    const vit = isVitalya(x.src);
    const op = m === "shelf" ? { key: k, d: -n, dd: n, note: "🚫 Брак с полки" + (note ? ` (${note})` : "") }
      // Номер заказа пишем в колонку «Заказ №» только когда остаток не трогаем: иначе −1 на полке
      // посчиталось бы списанием в этот заказ (skWrittenOff).
      : m === "add" ? { key: k, dd: n, order: num, note: "🚫 Брак не с полки" + (note ? ` (${note})` : "") }
      : { key: k, dd: -n, note: (vit ? "↩ Брак отдан Витале" : isDonor(x.src) ? "🗑 Брак выброшен" : "↩ Брак возвращён поставщику") + (note ? ` (${note})` : "") };
    t.disabled = true;
    try {
      const res = await stockApply([op]);
      if (res.done.length) { S.skDef = null; S.skBadAdd = null; toast(m === "back" ? `${vit ? "Отдано Витале" : "Списано из брака"} ✓ Брак: ${res.done[0].dTo} шт` : `🚫 В браке: ${res.done[0].dTo} шт${m === "shelf" ? ` · на полке: ${res.done[0].to}` : ""}${vit ? " · Витале видно в таблице в течение 10 минут" : ""}`, null, true); }
      else toast("Не записано: " + (res.skipped[0]?.why || "нечего менять"), null, true);
    } catch (e) { toast(e.message, null, true); }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  // ── брак на возврат поставщику (v48, 05.10.2026) ────────────────────────────────────
  // Владелец: «выделять позиции и нажимать „отправить поставщику“; после отправки брак с места
  // списывается со склада, но остаётся в истории». В режиме «🚫 Брак» у позиций с браком — галочка
  // и сколько штук отдаём; кнопка пишет «− брак» строкой журнала на каждую позицию (журнал и есть
  // история — блок «История брака» внизу) и собирает текст для поставщика: что и с какой
  // неисправностью. Сам текст никому не уходит — его копируют и отправляют поставщику руками.
  function skPickHtml(x) {
    if (!S.sk.bad || !(x.def > 0)) return "";
    const on = S.skSend.has(x.key), q = on ? S.skSend.get(x.key) : x.def;
    return `<label class="sk-pick"><input type="checkbox" data-act="skbsel" data-k="${esc(x.key)}"${on ? " checked" : ""}> на возврат</label>${on && x.def > 1 ? `<label class="sk-pick__n"><input data-skbq="${esc(x.key)}" value="${q}" inputmode="numeric" autocomplete="off"> из ${x.def} шт</label>` : ""}`;
  }
  // Неисправности позиции — из журнала: описания в скобках у последних записей «+ брак».
  function skDefects(key) {
    const out = [];
    for (const l of [...(S.stock?.ledger || [])].reverse()) {
      if (l.key !== key || !(l.dd > 0)) continue;
      const d = (l.note.match(/^🚫[^(]*\((.*)\)(?=:|$)/) || [])[1];
      if (d && !out.includes(d.trim())) out.push(d.trim());
      if (out.length >= 3) break;
    }
    return out;
  }
  const skSendSel = () => [...S.skSend].map(([k, n]) => ({ x: S.stock?.byKey?.get(k), n })).filter(o => o.x && o.x.def > 0).map(o => ({ x: o.x, n: Math.min(o.n, o.x.def) }));
  const skSendWord = sel => `${sel.length} поз. · ${sel.reduce((a, o) => a + o.n, 0)} шт`;
  function skSendLabel() { const b = $app.querySelector('[data-act="sksend"]'), sel = skSendSel(); if (b) b.textContent = `📦 Отправить поставщику${sel.length ? ` (${skSendWord(sel)})` : ""}`; }
  // Добавить брак (v50): владелец — «убери значок брак на каждой позиции, вводит в замешательство;
  // сделай отдельную кнопку перейти в режим брак и там добавить нужную запчасть». Поиск по всему
  // складу (и по тому, чего нет на полке), выбор → та же форма: сколько, неисправность, откуда.
  function skBadAddHtml() {
    const a = S.skBadAdd;
    if (!a) return `<button type="button" class="btn btn--sm sk-baopen" data-act="skbaopen">＋ Добавить брак</button>`;
    const x = a.key ? S.stock.byKey.get(a.key) : null;
    if (x) return `<section class="block sk-ba"><h3>Брак: ${esc(cap(x.node) + " · " + x.model)}</h3><div class="sk-ba__pick"><b>${esc(x.variant)}</b>${x.color ? " · " + esc(x.color) : ""}${skFrom(x) ? `<em>${esc(skFrom(x))}</em>` : ""} — на полке ${x.qty || 0} шт${x.def ? `, в браке ${x.def}` : ""}<button type="button" class="linkbtn" data-act="skbapick" data-k="">другая</button></div>${skDefHtml(x)}<button type="button" class="linkbtn" data-act="skbaclose">✕ отмена</button></section>`;
    const words = skWords(a.q).split(" ").filter(Boolean).map(w => SK_SYN[w] || w);
    const found = words.length ? S.stock.rows.filter(y => { const t = skWords(`${y.node} ${y.model} ${y.variant} ${y.color} ${y.own ? y.src + " " + y.note : ""}`); return words.every(w => t.includes(w)); })
      .sort((p, q) => (q.qty > 0) - (p.qty > 0) || skNodeRank(p.node) - skNodeRank(q.node)).slice(0, 15) : [];
    return `<section class="block sk-ba"><h3>Добавить брак</h3>
      <input class="search sk-ba__q" type="search" data-act="skbaq" value="${esc(a.q)}" placeholder="Какая запчасть — например «13 про макс дисплей»" autocomplete="off">
      ${words.length ? (found.length ? `<div class="sk-ba__list">${found.map(y => `<button type="button" class="sk-ba__item" data-act="skbapick" data-k="${esc(y.key)}"><span>${esc(cap(y.node) + " · " + y.model)} · <b>${esc(y.variant)}</b>${y.color ? " · " + esc(y.color) : ""}${esc(skFrom(y))}</span><small>${y.qty > 0 ? `на полке ${y.qty}` : "нет на полке"}${y.def ? ` · брак ${y.def}` : ""}</small></button>`).join("")}</div>` : `<p class="note">Ничего не нашлось. Нет такой позиции — добавьте её кнопкой «＋ Своя запчасть», потом заведите брак.</p>`) : `<p class="note">Найдите запчасть по модели и названию, выберите — и укажите, сколько и что с ней не так.</p>`}
      <button type="button" class="linkbtn" data-act="skbaclose">✕ отмена</button></section>`;
  }
  function skSendHtml() {
    if (S.skSent) return `<section class="block sk-send"><h3>✓ Брак списан — текст для поставщика</h3>
      <textarea class="sk-send__text" data-sksenttext readonly rows="${Math.min(14, S.skSent.split("\n").length + 1)}">${esc(S.skSent)}</textarea>
      <div class="row"><button type="button" class="btn btn--sm" data-act="skcopy">📋 Скопировать</button><button type="button" class="btn btn--ghost btn--sm" data-act="sksentclose">Готово</button></div></section>`;
    const all = S.stock.rows.filter(x => x.def > 0), sel = skSendSel();
    if (!all.length) return "";
    return `<section class="block sk-send"><h3>Брак на возврат поставщику</h3>
      <p class="note">Отметьте позиции галочкой «на возврат», при необходимости поправьте количество и нажмите «Отправить поставщику». Брак спишется со склада, запись останется в истории ниже и в листе «${esc(CFG.stock.ledger)}».</p>
      <div class="row"><button type="button" class="btn btn--ghost btn--sm" data-act="skball">${all.every(x => S.skSend.has(x.key)) ? "Снять все" : `Отметить все (${all.length})`}</button><button type="button" class="btn btn--sm" data-act="sksend"${sel.length ? "" : " disabled"}>📦 Отправить поставщику${sel.length ? ` (${skSendWord(sel)})` : ""}</button></div></section>`;
  }
  async function skSendApply(t) {
    const sel = skSendSel(); if (!sel.length) return toast("Отметьте позиции галочкой «на возврат»");
    const who = o => isVitalya(o.x.src) ? "Виталя" : isDonor(o.x.src) ? "донор" : (o.x.src || "поставщик");
    const groups = new Map(); for (const o of sel) { const g = who(o); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(o); }
    const list = [...groups].map(([g, os]) => `${g}:\n` + os.map(o => `  • ${skShort(o.x)} · ${o.x.model} — ${o.n} шт`).join("\n")).join("\n");
    if (!confirm(`Списать брак как отправленный поставщику?\n\n${list}\n\nЗапись останется в истории.`)) return;
    const ops = sel.map(o => { const def = skDefects(o.x.key).join("; ");
      return { key: o.x.key, dd: -o.n, note: (isVitalya(o.x.src) ? "📦 Брак отправлен Витале" : isDonor(o.x.src) ? "🗑 Брак с донора выброшен" : `📦 Брак отправлен поставщику (${o.x.src || "?"})`) + (def ? ` — ${def}` : "") }; });
    t.disabled = true;
    try {
      const res = await stockApply(ops);
      const ok = new Set(res.done.map(d => d.op.key)), sent = sel.filter(o => ok.has(o.x.key));
      for (const o of sent) S.skSend.delete(o.x.key);
      if (sent.length) {
        const day = mskStamp().slice(0, 10), lines = [];
        for (const [g, os] of groups) {
          const mine = os.filter(o => ok.has(o.x.key)); if (!mine.length || g === "донор") continue;
          lines.push(`Брак на возврат — IRON SERVICE, ${day}${groups.size > 1 ? ` (${g})` : ""}`);
          mine.forEach((o, i) => { const def = skDefects(o.x.key); lines.push(`${i + 1}. ${cap(o.x.node)} ${o.x.model} ${o.x.variant}${o.x.color ? ", " + o.x.color : ""} — ${o.n} шт${def.length ? `. Неисправность: ${def.join("; ")}` : ""}`); });
          lines.push(`Итого: ${mine.reduce((a, o) => a + o.n, 0)} шт`, "");
        }
        S.skSent = lines.join("\n").trim() || null;
      }
      toast(`📦 Списано из брака: ${sent.length} поз.${res.skipped.length ? ` · не записано: ${res.skipped.length} — ${res.skipped[0].why}` : ""}${sent.some(o => isVitalya(o.x.src)) ? " · у Витали в таблице — в течение 10 минут" : ""}`, null, true);
    } catch (e) { toast(e.message, null, true); }
    const y = window.scrollY; render(); window.scrollTo(0, y);
  }
  // История брака — строки журнала с «± Брак», новые сверху.
  function skHistHtml() {
    const rows = (S.stock?.ledger || []).filter(l => l.dd).slice(-40).reverse();
    if (!rows.length) return "";
    return `<section class="block sk-hist"><h3>История брака</h3>${rows.map(l => { const x = S.stock.byKey?.get(l.key) || l;
      return `<div class="sk-hist__row"><span class="sk-hist__ts">${esc(l.ts.slice(0, 16))}</span><b class="${l.dd > 0 ? "is-plus" : "is-minus"}">${l.dd > 0 ? "+" : "−"}${Math.abs(l.dd)}</b><span class="sk-hist__what">${esc(cap(x.node) + " " + x.model + " " + x.variant)}${l.order ? ` · №${esc(l.order)}` : ""}<small>${esc(l.note)}</small></span></div>`; }).join("")}</section>`;
  }
  // Кнопка «＋ Добавить запчасть» под разделом модели — или сама форма, если нажата здесь.
  const skAt = (node, model) => node + "|" + model;
  const skAddSlot = (node, model) => S.skAdd?.at === skAt(node, model) ? skAddHtml()
    : `<button type="button" class="sk-addbtn" data-act="skadd" data-node="${esc(node)}" data-model="${esc(model)}">＋ Добавить запчасть: ${esc(cap(node))} · ${esc(model)}</button>`;
  function renderStock() {
    if (!S.stock?.rows && !S.stock?.error && !S.stock?.wait) loadStock().then(() => { if (location.hash === "#/sklad") renderStock(); });
    const sheetUrl = gid => `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/edit#gid=${gid}`;
    const head = `<div class="card-head" style="margin-top:12px"><a class="iconbtn" href="#" aria-label="Назад">←</a><h1>Склад</h1><span class="head-meta">Виталя и свои запчасти</span>
      <span class="sk-links">${CFG.stock.publicUrl ? `<a class="btn btn--ghost btn--sm" href="${esc(CFG.stock.publicUrl)}" target="_blank" rel="noopener">Таблица для Витали ↗</a>` : ""}${DEMO ? "" : `<a class="btn btn--ghost btn--sm" href="${sheetUrl(CFG.stock.gid)}" target="_blank" rel="noopener">Лист Витали ↗</a>${CFG.stock.ownGid != null ? `<a class="btn btn--ghost btn--sm" href="${sheetUrl(CFG.stock.ownGid)}" target="_blank" rel="noopener">Свои позиции ↗</a>` : ""}`}</span></div>`;
    if (!S.stock?.rows) {
      renderShell(head + (S.stock?.error ? `<div class="empty">Склад не загрузился: ${esc(S.stock.error)}<div class="row" style="justify-content:center"><button class="btn" data-act="skreload">Попробовать ещё раз</button></div></div>` : `<div class="spinner">Загружаю склад…</div>`), { search: false });
      return;
    }
    const f = S.sk, all = S.stock.rows, inStock = all.filter(x => x.qty > 0);
    const pcs = inStock.reduce((a, x) => a + x.qty, 0), sum = inStock.reduce((a, x) => a + x.qty * (x.cost || 0), 0);
    const ownN = inStock.filter(x => !isVitalya(x.src)).length, badN = all.reduce((a, x) => a + (x.def || 0), 0);
    const by = (rows, fn) => { const m = new Map(); for (const x of rows) { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const gC = by(skFilter({ grp: 1, node: 1 }), x => skGroup(x.node));
    const groups = [...new Set([...SK_GROUPS.map(g => g[0]), ...all.map(x => skGroup(x.node))])].filter(g => all.some(x => skGroup(x.node) === g));
    let body = `<div class="sk-sum">На полке: <b>${inStock.length}</b> поз. · <b>${pcs}</b> шт${sum ? ` · закупка на <b>${money(sum)}</b>` : ""}${ownN ? ` · не от Витали: <b>${ownN}</b> поз.` : ""}${badN ? ` · <button type="button" class="linkbtn sk-sumbad" data-act="skbad">🚫 брак: <b>${badN}</b> шт</button>` : ""}</div>
      <input class="search sk-q" type="search" data-act="sksearch" value="${esc(f.q)}" placeholder="Модель, деталь, качество, цвет — например «13 про акб»" autocomplete="off">
      ${f.bad ? "" : `<nav class="tabs"><button class="tab" data-act="skgrp" data-v="" aria-pressed="${!f.grp}">Все</button>${groups.map(g => `<button class="tab" data-act="skgrp" data-v="${esc(g)}" aria-pressed="${f.grp === g}">${esc(g)}<small>${gC.get(g) || 0}</small></button>`).join("")}</nav>`}`;
    // В режиме «весь брак» фильтры не действуют — и не показываются, чтобы не путать.
    if (f.grp && !f.bad) {
      const nodes = [...new Set(all.filter(x => skGroup(x.node) === f.grp).map(x => x.node))].sort((a, b) => skNodeRank(a) - skNodeRank(b));
      if (nodes.length > 1) {
        const nC = by(skFilter({ node: 1 }), x => x.node);
        body += `<div class="tchips sk-chips"><button type="button" class="tchip" data-act="sknode" data-v="" aria-pressed="${!f.node}">Все узлы</button>${nodes.map(n => `<button type="button" class="tchip" data-act="sknode" data-v="${esc(n)}" aria-pressed="${f.node === n}">${esc(cap(n))} <small>${nC.get(n) || 0}</small></button>`).join("")}</div>`;
      }
    }
    const cC = by(skFilter({ cls: 1, tier: 1 }), x => skClass(x.tier));
    if (!f.bad) body += `<div class="tchips sk-chips"><button type="button" class="tchip" data-act="skcls" data-v="" aria-pressed="${!f.cls}">Любое качество</button>${SK_CLASSES.map(([k, t]) => `<button type="button" class="tchip" data-act="skcls" data-v="${k}" aria-pressed="${f.cls === k}">${esc(t)} <small>${cC.get(k) || 0}</small></button>`).join("")}</div>`;
    if (!f.bad && (f.grp || f.cls || f.tier)) { // все 46 вариантов разом — только шум, поэтому после выбора группы или класса
      const tC = by(skFilter({ tier: 1 }), x => x.tier);
      const tiers = [...tC.keys()].concat(f.tier && !tC.has(f.tier) ? [f.tier] : []).filter(Boolean).sort((a, b) => skClassRank(a) - skClassRank(b) || (tC.get(b) || 0) - (tC.get(a) || 0));
      if (tiers.length > 1 || f.tier) body += `<div class="tchips sk-chips"><button type="button" class="tchip" data-act="sktier" data-v="" aria-pressed="${!f.tier}">Все варианты</button>${tiers.map(t => `<button type="button" class="tchip" data-act="sktier" data-v="${esc(t)}" aria-pressed="${f.tier === t}">${esc(t)} <small>${tC.get(t) || 0}</small></button>`).join("")}</div>`;
    }
    const oC = by(skFilter({ src: 1 }), x => skSrcKind(x.src));
    const list0 = skFilter();
    if (!f.bad) body += `<div class="tchips sk-chips"><button type="button" class="tchip" data-act="skfrom" data-v="" aria-pressed="${!f.src}">Любой поставщик</button>${SK_SRC.map(([k, t]) => `<button type="button" class="tchip" data-act="skfrom" data-v="${k}" aria-pressed="${f.src === k}">${esc(t)} <small>${oC.get(k) || 0}</small></button>`).join("")}</div>`;
    const sC = by(skFilter({ ser: 1 }), x => skSeries(x.model));
    const series = [...sC.keys()].concat(f.ser && !sC.has(f.ser) ? [f.ser] : []).sort((a, b) => skSerRank(a) - skSerRank(b));
    body += `${f.bad ? "" : `<div class="tchips sk-chips"><button type="button" class="tchip" data-act="skser" data-v="" aria-pressed="${!f.ser}">Все модели</button>${series.map(s => `<button type="button" class="tchip" data-act="skser" data-v="${esc(s)}" aria-pressed="${f.ser === s}">${esc(s)} <small>${sC.get(s) || 0}</small></button>`).join("")}</div>`}
      ${skActiveHtml(list0)}
      <div class="row sk-opts">${f.bad ? "" : `<button type="button" class="btn btn--toggle btn--sm" data-act="skonly" aria-pressed="${skOnly()}">${skOnly() ? "✓ " : ""}Только в наличии</button>`}<button type="button" class="btn btn--toggle btn--sm sk-badmode" data-act="skbad" aria-pressed="${!!f.bad}">${f.bad ? "✓ " : ""}🚫 Брак${badN ? ` (${badN} шт)` : ""}</button><button type="button" class="btn btn--ghost btn--sm" data-act="skadd" data-node="${esc(f.node || "")}" data-model="">＋ Своя запчасть (другая модель)</button>${S.skDirty.size ? `<span class="note">Изменено: <b>${S.skDirty.size}</b> — не забудьте сохранить</span>` : ""}</div>`;
    if (S.skAdd?.at === "top") body += `<section class="block">${skAddHtml()}</section>`;
    if (f.bad) body += skBadAddHtml() + skSendHtml();
    // Порядок моделей — как в прайсе Витали; своя позиция встаёт в конец раздела своей модели,
    // а модель, которой у Витали нет, — после его моделей той же серии.
    const ord = x => (x.own ? 1e6 : 0) + x.row, mFirst = new Map();
    for (const x of all) { const k = x.node + "|" + x.model; if (!mFirst.has(k) || ord(x) < mFirst.get(k)) mFirst.set(k, ord(x)); }
    const list = skFilter().sort((a, b) => skGroupRank(skGroup(a.node)) - skGroupRank(skGroup(b.node)) || skNodeRank(a.node) - skNodeRank(b.node) || a.node.localeCompare(b.node)
      || skSerRank(skSeries(a.model)) - skSerRank(skSeries(b.model)) || mFirst.get(a.node + "|" + a.model) - mFirst.get(b.node + "|" + b.model) || ord(a) - ord(b));
    if (!list.length) body += `<div class="empty">${f.bad ? (f.q ? "По поиску брака нет — очистите строку поиска." : "Брака нет. Добавьте неисправную запчасть кнопкой «＋ Добавить брак» выше.") : skOnly() && !inStock.length ? "На полке пока ничего не отмечено. Снимите «Только в наличии», найдите деталь и поставьте количество — или добавьте свою кнопкой «＋ Своя запчасть»." : skOnly() ? "В наличии ничего не нашлось — снимите «Только в наличии»." : "Ничего не нашлось"}</div>`;
    const shown = list.slice(0, f.limit);
    // Свои позиции модели держатся рядом с Виталиными той же модели: сортировка выше ставит их в конец раздела.
    let node = null, model = null, open = false;
    const close = () => { if (open) body += skAddSlot(node, model) + `</section>`; open = false; };
    for (const x of shown) {
      if (x.node !== node) {
        close();
        const nodeRows = list.filter(y => y.node === x.node), q = nodeRows.reduce((a, y) => a + y.qty, 0);
        body += `<div class="section"><h2>${esc(cap(x.node))}</h2><span>${nodeRows.length} поз.${q ? ` · на полке ${q} шт` : ""}</span></div>`;
        node = x.node; model = null;
      }
      if (x.model !== model) {
        close();
        const q = list.filter(y => y.node === x.node && y.model === x.model).reduce((a, y) => a + y.qty, 0);
        body += `<section class="block sk-model"><h3 class="h3-row"><span>${esc(x.model)}</span>${q ? `<small class="sk-have">на полке ${q} шт</small>` : ""}</h3>`;
        model = x.model; open = true;
      }
      body += skRowHtml(x);
    }
    close();
    if (list.length > shown.length) body += `<button class="more" data-act="skmore">Показать ещё (${list.length - shown.length})</button>`;
    if (f.bad) body += skHistHtml();
    body += `<p class="note">Цена — закупка (у Витали — из его прайса), «прод.» — цена продажи. Каждое изменение пишется в лист «${esc(CFG.stock.ledger)}». Свои позиции хранятся на листе «${esc(CFG.stock.own)}»; Витале в таблицу уходят только позиции с поставщиком «Виталя», в течение 10 минут. На сайте и в боте остатки Витали обновляются ночью.</p>`;
    renderShell(head + body, { search: false });
    skSaveBar();
  }
  function skSaveBar() {
    const n = S.skDirty.size;
    $app.querySelector(".savebar")?.remove();
    $app.insertAdjacentHTML("beforeend", `<div class="savebar"><div class="savebar__in">
      <button class="btn btn--ghost" data-act="skdiscard" ${n ? "" : "disabled"}>Отмена</button>
      <button class="btn btn--red" data-act="sksave" ${n ? "" : "disabled"}>${n ? `Сохранить остатки (${n})` : "Изменений нет"}</button></div></div>`);
  }
  function skSet(k, raw, input) {
    const x = S.stock?.byKey?.get(k); if (!x) return;
    const n = String(raw).trim() === "" ? 0 : Math.round(toNum(raw) ?? NaN);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === x.qty) S.skDirty.delete(k); else S.skDirty.set(k, n);
    if (input) input.value = S.skDirty.has(k) ? String(n) : String(x.qty || "");
    $app.querySelector(`[data-skrow="${CSS.escape(k)}"]`)?.classList.toggle("is-dirty", S.skDirty.has(k));
    skSaveBar();
  }
  async function skSave(btn) {
    const ops = [...S.skDirty].map(([key, set]) => ({ key, set, base: S.stock.byKey.get(key)?.qty })).filter(o => o.base != null);
    if (!ops.length) return;
    btn.disabled = true; btn.textContent = "Сохраняю…";
    const y = window.scrollY;
    try {
      const res = await stockApply(ops);
      for (const o of ops) if (!res.skipped.some(s => s.op === o)) S.skDirty.delete(o.key);
      if (res.skipped.length) {
        await loadStock(true);
        toast(`Записано ${res.done.length}, не записано ${res.skipped.length}: ${res.skipped[0].why}. Проверьте и сохраните ещё раз.`, null, true);
      } else toast(DEMO ? "Сохранено (демо — в таблицу не пишется)" : `Остатки сохранены ✓ ${res.done.length} поз.`, null, true);
    } catch (e) { toast(e.message, null, true); }
    renderStock(); window.scrollTo(0, y);
  }
  // Клики склада: и на экране «Склад», и в карточке заказа. true — клик обработан.
  async function stockClick(act, t) {
    const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); };
    const prefs = () => store.set("crm.sk", { grp: S.sk.grp, node: S.sk.node, ser: S.sk.ser, cls: S.sk.cls, tier: S.sk.tier, src: S.sk.src, only: S.sk.only });
    if (act === "skgrp") { S.sk.grp = t.dataset.v; S.sk.node = ""; S.sk.tier = ""; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "sknode") { S.sk.node = t.dataset.v; S.sk.tier = ""; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "skcls") { S.sk.cls = t.dataset.v; S.sk.tier = ""; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "sktier") { S.sk.tier = t.dataset.v; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "skfrom") { S.sk.src = t.dataset.v; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "skser") { S.sk.ser = t.dataset.v; S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "skonly") { S.sk.only = !skOnly(); S.sk.limit = 150; prefs(); rerender(); }
    else if (act === "skbad") { S.sk.bad = !S.sk.bad; S.sk.limit = 150; S.skDef = null; S.skBadAdd = null; rerender(); }
    else if (act === "skdef") { S.skDef = S.skDef === t.dataset.k ? null : t.dataset.k; rerender(); $app.querySelector("[data-skdefnote]")?.focus({ preventScroll: true }); }
    else if (act === "skdefgo") skDefApply(t);
    else if (act === "skbsel") { const x = S.stock?.byKey?.get(t.dataset.k); if (S.skSend.has(t.dataset.k)) S.skSend.delete(t.dataset.k); else if (x?.def > 0) S.skSend.set(t.dataset.k, x.def); rerender(); }
    else if (act === "skball") { const all = S.stock.rows.filter(x => x.def > 0); if (all.every(x => S.skSend.has(x.key))) S.skSend.clear(); else for (const x of all) if (!S.skSend.has(x.key)) S.skSend.set(x.key, x.def); rerender(); }
    else if (act === "sksend") skSendApply(t);
    else if (act === "skbaopen") { S.skBadAdd = { q: "", key: "" }; S.skDef = null; rerender(); $app.querySelector(".sk-ba__q")?.focus({ preventScroll: true }); }
    else if (act === "skbapick") { if (S.skBadAdd) S.skBadAdd.key = t.dataset.k; rerender(); (t.dataset.k ? $app.querySelector(".sk-ba [data-skdefnote]") : $app.querySelector(".sk-ba__q"))?.focus({ preventScroll: true }); }
    else if (act === "skbaclose") { S.skBadAdd = null; rerender(); }
    else if (act === "skcopy") { const ta = $app.querySelector("[data-sksenttext]"); try { await navigator.clipboard.writeText(ta.value); toast("Скопировано ✓"); } catch { ta.select(); document.execCommand("copy"); toast("Скопировано ✓"); } }
    else if (act === "sksentclose") { S.skSent = null; rerender(); }
    else if (act === "skmore") { S.sk.limit += 150; rerender(); }
    else if (act === "skreset") { Object.assign(S.sk, { grp: "", node: "", ser: "", cls: "", tier: "", src: "", q: "", bad: false, limit: 150 }); prefs(); rerender(); }
    else if (act === "skreload") { await loadStock(true); rerender(); }
    else if (act === "skstep") {
      const k = t.dataset.k, x = S.stock?.byKey?.get(k); if (!x) return true;
      const cur = S.skDirty.has(k) ? S.skDirty.get(k) : x.qty;
      skSet(k, Math.max(0, cur + +t.dataset.d), $app.querySelector(`[data-skq="${CSS.escape(k)}"]`));
    }
    else if (act === "sksave") skSave(t);
    else if (act === "skdiscard") { S.skDirty.clear(); rerender(); }
    else if (act === "skadd" || act === "skedit") {
      // Форма открывается на месте нажатия: под разделом модели или сверху («другая модель»).
      if (act === "skedit") {
        const x = S.stock?.byKey?.get(t.dataset.k); if (!x) return true;
        S.skAdd = { at: skAt(x.node, x.model), edit: x.key, lockModel: true, f: { node: x.node, model: x.model, variant: x.variant, color: x.color, src: x.src, cost: x.cost ?? "", price: x.price ?? "", note: x.note || "" } };
      } else {
        const model = t.dataset.model || "", node = t.dataset.node || "";
        // «Свой вариант для Витали» под его разделом, но поставщика человек меняет сам.
        S.skAdd = { at: model ? skAt(node, model) : "top", lockModel: !!model, f: { node, model, variant: "", color: "", src: model ? CFG.stock.supplier : "", cost: "", price: "", qty: "1", note: "" } };
      }
      rerender();
      document.getElementById("sk-add")?.scrollIntoView({ block: "nearest" });
      $app.querySelector('#sk-add [data-skf="' + (S.skAdd.lockModel ? "variant" : "node") + '"]')?.focus({ preventScroll: true });
    }
    else if (act === "sksrc") { if (S.skAdd) { S.skAdd.f.src = t.dataset.v; rerender(); } }
    else if (act === "skaddcancel") { S.skAdd = null; rerender(); }
    else if (act === "skaddsave") skAddSave(t);
    else if (act === "skbind" || act === "skunbind") {
      const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), i = +t.dataset.i;
      if (act === "skbind") { const x = skBind(key, r, i, t.dataset.k); if (x) toast(`📦 Со склада: ${skShort(x)}${skFrom(x)} — спишется при сохранении`); }
      else { const p = partsOf(key, r)[i]; if (p) delete p.stock; }
      rerender();
    }
    else if (act === "skretbad") {
      // Деталь из заказа оказалась неисправной: брак +1, полка не меняется, номер заказа — в журнал.
      const r = S.byNum.get(location.hash.slice(2)), num = r ? String(cell(r, C.num)).trim() : ""; if (!num) return true;
      t.disabled = true;
      try {
        const res = await stockApply([{ key: t.dataset.k, dd: 1, order: num, note: `🚫 Брак из заказа №${num}` }]);
        const x = S.stock?.byKey?.get(t.dataset.k);
        toast(res.done.length ? `🚫 В брак ✓ (всего брака по позиции: ${res.done[0].dTo} шт)${x && isVitalya(x.src) ? " — Витале видно в таблице" : ""}` : "Не записано: " + (res.skipped[0]?.why || "—"), null, true);
      } catch (e) { toast(e.message, null, true); }
      rerender();
    }
    else if (act === "skret" || act === "skretry" || act === "skforget") {
      const r = S.byNum.get(location.hash.slice(2)), num = r ? String(cell(r, C.num)).trim() : ""; if (!num) return true;
      if (act === "skforget") { S.skFailed = null; rerender(); return true; }
      t.disabled = true;
      try {
        if (act === "skretry") { await skWriteOff(num, S.skFailed?.ops || []); toast(S.skFailed ? "Опять не списалось: " + S.skFailed.why : "📦 Списано со склада ✓", null, true); }
        else {
          const res = await stockApply([{ key: t.dataset.k, d: 1, order: num, note: `Возврат из заказа №${num}` }]);
          toast(res.done.length ? "↩ Возвращено на склад ✓" : "Не вернулось: " + (res.skipped[0]?.why || "нечего возвращать"), null, true);
        }
      } catch (e) { toast(e.message, null, true); }
      rerender();
    }
    else return false;
    return true;
  }

  // ── без суммы заказ не закрыть (владелец, 28.09.2026) ────────────────────────
  // «Выполнен» и закрытие продажи/выкупа/обмена — только с суммой. Без суммы можно:
  // отказ от ремонта, ремонт невозможен, без ремонта (в т. ч. «оставили на запчасти»).
  // 0 — это сумма (гарантийный ремонт), пусто — нет. То же правило стоит в таблице
  // (OrderAutofill.js, orderCloseBlocked_): там статус без суммы откатывается.
  const CLOSING = ["выполнен", "продан", "обмен оформлен", "выкуплен", "разобран"];
  function sumColFor(status, dk) {
    const s = norm(status);
    if (!CLOSING.some(x => s.startsWith(x))) return null;
    return ["buyback", "parts", "tradein"].includes(dk) ? C.buyback : C.total;
  }
  function needSum(status, dk, get) {
    const col = sumColFor(status, dk);
    return col != null && toNum(get(col)) == null ? col : null;
  }
  const NO_SUM_OK = ["отказ от ремонта", "ремонт невозможен", "без ремонта"];
  // Итоговый отчёт — с суммой, кроме отказа и «без ремонта» (там отчёт о том, что ремонта не было).
  function reportNeedsSum(r, get) {
    if (NO_SUM_OK.some(x => norm(get(C.status)).startsWith(x))) return null;
    const dk = dealKey(get(C.type)), col = ["buyback", "parts", "tradein"].includes(dk) ? C.buyback : C.total;
    return toNum(get(col)) == null ? col : null;
  }
  // Подсказать, какую сумму вписать: сообщение и подсветка поля. soft — только подсказка.
  function askSum(col, why, soft) {
    const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), k = key + ":" + C.type;
    const name = labelFor(col, dealKey(S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, C.type) : "")));
    toast(`${why}: впишите «${name}»${soft ? " перед сохранением" : ""}`, null, true);
    const inp = $app.querySelector(`[data-edit="${col}"]`); if (!inp) return;
    inp.closest(".field")?.classList.add("is-need");
    if (!soft) { inp.scrollIntoView({ block: "center", behavior: "smooth" }); inp.focus({ preventScroll: true }); }
  }

  function cardBody(key, r, isNew) {
    const val = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, c) : ""); };
    const dk = dealKey(val(C.type));
    const hidden = c => (HIDE[dk] || []).includes(c) && !String(r ? cell(r, c) : "").trim(); // уже заполненное не прячем
    const fh = (c, extra = {}) => hidden(c) ? "" : fieldHtml(key, c, r ? cell(r, c) : "", { row: r?.row, r, force: isNew, label: labelFor(c, dk), ...extra });
    const st = r ? cell(r, C.status) : CFG.newStatus;
    const tel = phones(val(C.phone));
    const typeNow = val(C.type) || "Ремонт";

    const box = (order, inner) => `<div class="cg-item" style="order:${order}">${inner}</div>`;
    let html = `<section class="block"><h3>Тип сделки</h3>${
      editable(C.type, r) || isNew ? choiceButtons(key, C.type, typeNow, typeOptions(), () => "type") : `<div class="big">${esc(typeNow)}</div>`}
      ${["buyback", "parts", "tradein"].includes(dk) ? `<p class="note">${dk === "tradein" ? "Сданное устройство" : "Перед выкупом"}: iCloud и «Найти iPhone» отключены, IMEI не в розыске, проверены АКБ и экран. Паспортные данные — только в бумажный договор, в таблицу не писать.</p>` : ""}
    </section>`;
    let left = box(1, html), right = ""; html = "";

    if (isNew && dk !== "repair" && dk !== "other") {
      html += `<section class="block"><h3>Статус</h3>${ddHtml(key, C.status, val(C.status), statusesFor(dk), { allowEmpty: false })}
        <p class="note">Клиенту уйдёт одно сообщение — по этому статусу. Итоговый отчёт — кнопкой в карточке после создания.</p></section>`;
    }
    if (!isNew) {
      const reportSent = isTrue(cell(r, C.report));
      const statusBlock = editable(C.status, r)
        ? `${ddHtml(key, C.status, S.dirty.has(key + ":" + C.status) ? S.dirty.get(key + ":" + C.status) : st, statusesFor(dk), { allowEmpty: false })}<p class="note">Выберите статус и нажмите «Сохранить» внизу — клиенту уйдёт уведомление, как из таблицы.${groupOf(r)?.shared ? " <b>Статус поменяется у всех устройств группы.</b>" : ""}</p>
          ${isSilent(st) ? "" : `<button type="button" class="btn btn--ghost btn--sm btn--silent" data-choice="${C.status}" data-value="${SILENT}" aria-pressed="${norm(S.dirty.get(key + ":" + C.status)) === norm(SILENT)}">🔕 Закрыть без уведомления</button>`}
          ${resendBtn(r, st)}`
        : `<div class="big">${esc(stLabel(st) || "без статуса")}</div><div class="row"><a class="btn btn--red" href="${sheetLink(r.row, C.status)}" target="_blank" rel="noopener">Сменить статус в таблице ↗</a></div>`;
      const reportBtn = editable(C.report, r)
        ? `<button type="button" class="btn ${reportSent ? "btn--ghost" : ""}" data-act="report">${reportSent ? "Отчёт уже отправлен — отправить заново" : groupOf(r)?.shared ? "📨 Отправить общий отчёт" : "📨 Отправить итоговый отчёт клиенту"}</button>`
        : `<a class="btn" href="${sheetLink(r.row, C.report)}" target="_blank" rel="noopener">Отчёт клиенту (Ok) ↗</a>`;
      html += `<section class="block"><h3>Статус</h3>${statusBlock}
        <div class="row row--report">${reportBtn}${reviewBtn(key, r)}</div></section>`;
    }
    left += box(2, html); html = "";

    if (isNew && (dk === "sale_used" || dk === "sale_new")) left += box(2, goodsBlock(dk) + importBlock());
    html += `<section class="block"><h3>Клиент</h3><div class="grid2"><div>${fh(C.name)}${isNew ? `<div class="ac" id="ac-${C.name}"></div>` : ""}</div><div>${fh(C.phone)}${isNew ? `<div class="ac" id="ac-${C.phone}"></div>` : ""}</div></div>
      ${isNew ? `<div id="pre-contact" class="note pre-contact">${preNoteText()}</div><div id="client-devs">${clientDevicesHtml(currentNewClient())}</div>` : ""}
      ${tel.length ? `<div class="row">${tel.map(p => `<a class="btn" href="tel:+${p.d}">📞 ${esc(p.text)}</a><a class="btn btn--ghost" href="https://wa.me/${p.d}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--ghost" href="https://t.me/+${p.d}" target="_blank" rel="noopener">Telegram</a>`).join("")}</div>` : ""}
      ${proxyHtml(key, r, isNew, val, fh)}
      ${!isNew && canCreate() ? clientActions(r, dk) : ""}
    </section>`;
    left += box(3, html); html = "";

    const multiBox = isNew ? `<label class="check multi"><input type="checkbox" data-act="multi" ${S.multi ? "checked" : ""}><b>${esc(TYPE_UI[dk].multi)}</b></label>` : "";
    if (isNew && S.multi) {
      const cols = PER_DEVICE[dk].filter(c => !hidden(c));
      right += box(4, `<section class="block"><h3>Устройство 1</h3>${multiBox}${deviceGrid(cols, c => fh(c))}</section>`);
      right += box(5, extraDevicesHtml(dk));
      right += box(6, `<section class="block"><h3>Общее для всех устройств</h3><div class="grid2 grid2--wide">${fh(C.comment)}${fh(C.extra)}</div>
        <div class="margin">${groupMoneySummary(dk)}</div></section>`);
    } else {
    const rep = dk === "repair" || dk === "other", fam = familyOf(val(C.device));
    const tips = (kind, c) => rep && (isNew || editable(c, r)) ? typicalHtml(kind, c, fam, val(c)) : "";
    html += `<section class="block"><h3>${rep ? "Ремонт" : "Устройство"}</h3>
      ${multiBox}
      <div class="grid2">${fh(C.device)}${fh(C.imei)}</div>
      <div class="wide-area">${fh(C.issue)}${tips("issue", C.issue)}</div>
      <div class="wide-area">${fh(C.work)}${tips("work", C.work)}${rep && (isNew || editable(C.work, r)) ? pricePickHtml(key, val(C.device)) : ""}</div>
      ${rep ? `<div class="field field--parts"><span>Запчасти <small class="note">(клиенту в отчёте уходят только названия)</small></span>${partsHtml(key, r)}</div><div class="grid3">${fh(C.warranty)}</div>`
        : `<div class="grid3">${fh(C.parts)}${fh(C.partFrom)}${fh(C.warranty)}</div>`}
      ${dk === "sale_used" || String(val(C.linked)).trim() ? fh(C.linked) : ""}
      ${fh(C.master)}
      <div class="grid2 grid2--wide">${fh(C.comment)}${fh(C.pass)}</div>
    </section>`;
    right += box(4, html); html = "";

    const moneyFields = (dk === "buyback" || dk === "parts") ? [C.buyback, C.extra]
      : dk === "tradein" ? [C.total, C.buyback, C.partCost, C.extra] : rep ? [C.total, C.labor, "parts", C.extra] : [C.total, C.labor, C.partCost, C.extra];
    const partsRo = `<div class="field"><span>Запчасти (закуп), ₽ <small class="note">(из списка запчастей)</small></span><div class="ro" data-parts-sum>${esc(money(val(C.partCost)) || "—")}</div></div>`;
    const discBox = DISC_TYPES.includes(dk) && (isNew || editable(C.total, r)) ? discountHtml(key, r, val) : "";
    html += `<section class="block"><h3>Деньги</h3><div class="grid4">${moneyFields.map(c => c === "parts" ? partsRo : fh(c)).join("")}${discBox}</div>
      <div class="margin">${moneySummary(dk, val, r)}</div></section>`;
    right += box(6, html); html = "";
    }

    html += `<section class="block"><h3>Прочее</h3><div class="grid3">${fh(C.date)}${isNew ? "" : fh(C.issued)}${fh(C.source)}</div>
      ${!isNew && !DEMO ? `<div class="row"><a class="btn btn--ghost" href="${sheetLink(r.row, C.num)}" target="_blank" rel="noopener">Открыть строку в таблице ↗</a></div>` : ""}
      ${!isNew ? `<div class="row">${deleteBox(r)}</div>` : ""}</section>`;
    left += box(7, html);
    return `<div class="card-grid"><div class="col">${left}</div><div class="col">${right}</div></div>`;
  }

  // ── «На связи другой человек» (03.10.2026, план 93 §11.38) ──────────────────────────
  // Владелец: «человек сдаёт в ремонт свой единственный телефон и остаётся без связи —
  // оставляет контакт того, кто на связи». AH/AI: имя и телефон этого человека. Пока телефон
  // вписан, ВСЕ уведомления по заказу уходят ему (ContactPerson.js в таблице), в каждом —
  // «👤 Владелец: … — ваш номер оставили для связи». Заказ, Google-контакт, книга клиентов,
  // история — по-прежнему за C/D. Очистил телефон — сообщения снова идут клиенту.
  function proxyHtml(key, r, isNew, val, fh) {
    const has = String(val(C.contactPhone) ?? "").trim() || String(val(C.contactName) ?? "").trim();
    if (!isNew && !editable(C.contactPhone, r)) {
      return has ? `<div class="proxy"><div class="proxy__head">📲 На связи: ${esc(val(C.contactName))} ${esc(val(C.contactPhone))}</div></div>` : "";
    }
    if (!has && S.proxyOpen !== key) {
      return `<div class="row row--proxy"><button type="button" class="btn btn--ghost btn--sm" data-act="proxyon">📲 На связи другой человек</button><small class="note">если телефон клиента остаётся у нас в ремонте</small></div>`;
    }
    const ctel = phones(val(C.contactPhone));
    return `<div class="proxy">
      <div class="proxy__head">📲 На связи другой человек</div>
      <div class="grid2"><div>${fh(C.contactName)}<div class="ac" id="ac-${C.contactName}"></div></div><div>${fh(C.contactPhone)}<div class="ac" id="ac-${C.contactPhone}"></div></div></div>
      <p class="note">Все уведомления по заказу — статусы, итоговый отчёт, напоминание об отзыве — уйдут на этот номер с пометкой, чьё это устройство. Заказ, контакт и история остаются за клиентом. Сотрите телефон — сообщения снова пойдут клиенту.${isNew ? "" : " Уже идущему заказу — впишите номер и нажмите «Отправить статус ещё раз»."}</p>
      ${ctel.length ? `<div class="row">${ctel.map(p => `<a class="btn btn--sm" href="tel:+${p.d}">📞 ${esc(p.text)}</a><a class="btn btn--ghost btn--sm" href="https://wa.me/${p.d}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn--ghost btn--sm" href="https://t.me/+${p.d}" target="_blank" rel="noopener">Telegram</a>`).join("")}</div>` : ""}
    </div>`;
  }
  // Повторная отправка текущего статуса (03.10.2026). Раньше для этого стирали статус и ставили
  // заново — лишняя запись в «Историю статусов» и ещё одно сообщение с пустым статусом не
  // уходило только потому, что пустой статус не шлётся. Теперь дверь получает тот же статус с
  // флагом force (в обход 10-минутной защиты от дублей); история не пишется (old = value).
  function resendBtn(r, st) {
    if (!r || !st || isSilent(st) || !editable(C.status, r)) return "";
    const to = phones(cell(r, C.contactPhone));
    if (!to.length && !phones(cell(r, C.phone)).length) return "";
    return `<button type="button" class="btn btn--ghost btn--sm btn--resend" data-act="resend">${to.length ? "📨 Отправить статус на номер для связи" : "↻ Отправить статус ещё раз"}</button>`;
  }
  function resendStatus(r) {
    const num = String(cell(r, C.num)).trim(), st = cell(r, C.status);
    const to = phones(cell(r, C.contactPhone));
    toast(`№${num}: отправляю «${st}» ${to.length ? "на номер для связи " + to[0].text : "клиенту"}…`);
    return doorInBackground(r, num, [{ c: C.status, v: st, old: st, force: true }]);
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
      <div class="group-list">${gr.rows.map(x => `<a class="group-item${x === r ? " is-cur" : ""}" href="#/${esc(cell(x, C.num))}"><b>№${esc(cell(x, C.num))}</b> ${esc(cell(x, C.device) || "—")}<span class="chip chip--${statusKind(cell(x, C.status))}">${esc(stLabel(cell(x, C.status)) || "—")}</span></a>`).join("")}</div>
      <p class="note">${gr.shared ? "Статус и итоговый отчёт — общие: меняются сразу у всех устройств, клиенту уходит одно сообщение со списком." : "Ремонт: статусы и отчёты по каждому устройству — отдельно. Приёмка ушла одним сообщением."}</p></section>`;
  }

  // Дополнительные устройства нового заказа. Каждое станет в таблице отдельным заказом со
  // своим номером. Поля — ровно те же, что у первого устройства (PER_DEVICE), значения —
  // по номеру колонки: S.extra[i][колонка].
  const blankDevice = () => ({});
  function extraField(i, c, dk) {
    const f = F[c], v = S.extra[i][c] ?? "", label = labelFor(c, dk);
    const spell = f.spell ? ' spellcheck="true" lang="ru" autocorrect="on" autocapitalize="sentences"' : ' spellcheck="false"';
    const attr = `data-extra="${i}" data-col="${c}"`;
    let el;
    if (c === C.master) el = `<select ${attr}><option value="">как у первого</option>${(S.opts[C.master] || []).map(m => `<option ${m === v ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>`;
    else if (AREAS.includes(c)) el = `<textarea ${attr} rows="2"${spell}>${esc(v)}</textarea>`;
    else if (S.opts[c]?.length && !f.free) el = `<select ${attr}><option value="">—</option>${S.opts[c].map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    else el = `<input ${attr} value="${esc(v)}"${spell} ${f.num ? 'inputmode="decimal"' : ""}>`;
    return `<label class="field"><span>${esc(label)}</span>${el}</label>`;
  }
  function extraDevicesHtml(dk) {
    const cols = PER_DEVICE[dk].filter(c => !(HIDE[dk] || []).includes(c));
    return S.extra.map((x, i) => `<section class="block"><h3 class="h3-row">Устройство ${i + 2}<button type="button" class="linkbtn" data-act="rmdev" data-i="${i}">убрать</button></h3>
      ${deviceGrid(cols, c => extraField(i, c, dk))}</section>`).join("") + `<button type="button" class="more" data-act="adddev">＋ Добавить ещё устройство</button>`;
  }
  // Деньги по всему заказу из нескольких устройств.
  function groupMoneySummary(dk) {
    const get = c => [toNum(S.dirty.get("new:" + c)) ?? 0, ...S.extra.map(x => toNum(x[c]) ?? 0)].reduce((a, b) => a + b, 0);
    const extra = toNum(S.dirty.get("new:" + C.extra)) ?? 0, N = 1 + S.extra.length;
    const missing = [S.dirty.get("new:" + (dk === "buyback" || dk === "parts" ? C.buyback : C.total)), ...S.extra.map(x => x[dk === "buyback" || dk === "parts" ? C.buyback : C.total])]
      .filter(v => toNum(v) == null).length;
    const warn = missing ? `<div class="note" style="color:var(--wait)">⚠️ Без суммы: ${missing} из ${N} — впишите, иначе итог не сойдётся.</div>` : "";
    const f = n => n.toLocaleString("ru-RU") + " ₽";
    if (dk === "buyback" || dk === "parts") return `Итого отдаём клиенту за ${N} устр.: <b>${f(get(C.buyback))}</b>${warn}`;
    if (dk === "tradein") return `Доплата ${f(get(C.total))} + зачёт ${f(get(C.buyback))} − закупка ${f(get(C.partCost))} − расходы ${f(extra)} = остаётся нам: <b>${f(get(C.total) + get(C.buyback) - get(C.partCost) - extra)}</b>${warn}`;
    if (dk.startsWith("sale")) return `Итого по ${N} устр.: <b>${f(get(C.total))}</b> · закупка ${f(get(C.partCost))} · остаётся нам: <b>${f(get(C.total) - get(C.partCost) - extra)}</b>${warn}`;
    return `Итого по ${N} устр.: <b>${f(get(C.total))}</b>${warn}`;
  }

  // «Напомнить об отзыве» — кнопкой-переключателем рядом с кнопкой отчёта (владелец,
  // 26.09.2026: флажок с подписью сверху смотрелся невпопад). Сохраняется кнопкой внизу.
  function reviewBtn(key, r) {
    if (!editable(C.review, r)) return `<a class="btn btn--ghost" href="${sheetLink(r.row, C.review)}" target="_blank" rel="noopener">Напомнить об отзыве ↗</a>`;
    const k = key + ":" + C.review, on = isTrue(S.dirty.has(k) ? S.dirty.get(k) : cell(r, C.review));
    return `<button type="button" class="btn btn--toggle" data-act="review" aria-pressed="${on}">${on ? "✓ Напомнить об отзыве" : "⭐ Напомнить об отзыве"}</button>`;
  }

  // Когда поставлен текущий статус: последняя запись «Истории статусов» по этой строке
  // (её ведёт onEditTrigger, в т. ч. через дверь). Для закрытых статусов, если записи нет, —
  // дата выдачи (I).
  function statusSince(r) {
    const h = S.since.get(r.row), st = cell(r, C.status);
    if (h && norm(h.st) === norm(st)) return h.ts.slice(0, 5);
    if (isFinal(st) && cell(r, C.issued)) return String(cell(r, C.issued)).slice(0, 5);
    return "";
  }
  async function loadHistory() {
    if (DEMO) return;
    const v = await api(`/values/${encodeURIComponent("'История статусов'!A2:D")}`);
    for (const [ts, where, , st] of v.values || []) {
      const m = String(where || "").match(/(\d+)/); if (m) S.since.set(+m[1], { ts: String(ts || ""), st: String(st || "") });
    }
    const n = location.hash.match(/^#\/(\d+)/)?.[1];
    if (n && ![...S.dirty.keys()].length) render();
  }

  // ── товар из бота в новую «Продажу» (v47, 05.10.2026) ─────────────────────────────
  // Владелец: «сделай возможным подтянуть из бота б/у товар для оформления продажи б/у; и новый товар в
  // сделку продажи нового — полный цикл без оформления в боте, прямо в оболочке». Раньше в продажу
  // можно было подгрузить только ГОТОВЫЙ заказ бота или сайта; продажу в салоне вписывали руками —
  // без закупки, с опечатками в названии. Теперь: б/у — список раздела «♻️ Б/у» бота (R2), новый —
  // поиск по каталогу бота (те же цены, закупка с доставкой у «под заказ», склад, гарантия). Выбор
  // заполняет устройство, цену, закупку, гарантию (у б/у — IMEI из характеристик и состояние);
  // второй товар — вторым устройством сделки. После «Создать заказ» б/у в боте помечается «Продано»
  // с номером сделки (/crm/used/sold) — чтобы его не купили второй раз.
  const warrantyShort = w => { const m = String(w || "").match(/(\d+\s*(?:год[а]?|лет|мес\S*|дн\S*|недел\S*))/i); return m ? m[1] : String(w || "").replace(/[🛡️]/gu, "").trim(); };
  const imeiOf = x => (x.specs || []).find(s => /imei|серийн|s\/?n/i.test(s.k))?.v || "";
  async function loadGoods(force) {
    if (S.goods?.items && !force) { S.goods.open = true; return rerenderKeep(); }
    S.goods = { ...(S.goods || {}), open: true, loading: true, error: "" }; rerenderKeep();
    try {
      let j;
      if (DEMO) j = { ok: true, items: [
          { name: "iPhone 17 128Gb Black", country: "🇺🇸 США", price: 61900, purchase: 57000, warranty: "🛡️ Гарантия 1 год включена", source: "S1", category: "iPhone", order: false, key: "Price-DA-All::11" },
          { name: "iPhone 17 256Gb Lavender", country: "🇪🇺 Европа", price: 80300, purchase: 76300, warranty: "", source: "S3", category: "iPhone", order: true, eta: "1–2 дня", key: "Price-Dr.Store-MSK::7" },
          { name: "AirPods Pro 3", country: "🇺🇸 США", price: 24990, purchase: 21000, warranty: "1 год", source: "S1", category: "AirPods", order: false, key: "Price-DA-All::40" }],
        used: [
          { id: "demo1", name: "iPhone 13 Pro 256Gb Graphite", price: 52000, warranty: "30 дней", condition: "отличное, АКБ 89%", kit: "коробка, кабель", specs: [{ k: "IMEI", v: "356000000000001" }], sold: false, photo: "" },
          { id: "demo2", name: "iPad 9 64Gb", price: 18000, warranty: "", condition: "", kit: "", specs: [], sold: true, deal: "7790", photo: "" }] };
      else {
        const r = await fetch(CFG.botGoods, { headers: { Authorization: "Bearer " + S.token } });
        j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "бот не ответил (" + r.status + ")");
      }
      Object.assign(S.goods, { items: j.items || [], used: j.used || [], at: Date.now() });
    } catch (e) { S.goods.error = "Не удалось загрузить товары: " + e.message; }
    S.goods.loading = false; rerenderKeep();
  }
  function rerenderKeep() { const y = window.scrollY, a = document.activeElement?.dataset?.act, pos = document.activeElement?.selectionStart; render(); window.scrollTo(0, y);
    if (a === "gq") { const q = $app.querySelector('[data-act="gq"]'); if (q) { q.focus({ preventScroll: true }); try { q.setSelectionRange(pos, pos); } catch {} } } }
  function goodsList(dk) {
    const G = S.goods, used = dk === "sale_used", words = norm(G["q_" + (used ? "used" : "new")] || "").split(/\s+/).filter(Boolean);
    const hit = t => words.every(w => norm(t).includes(w));
    if (used) {
      const list = (G.used || []).filter(x => hit(`${x.name} ${x.condition} ${(x.specs || []).map(s => s.v).join(" ")}`))
        .sort((a, b) => (a.sold - b.sold) || String(b.created || "").localeCompare(String(a.created || "")));
      if (!list.length) return `<div class="note">${G.used?.length ? "Ничего не нашлось" : "В разделе «♻️ Б/у» бота пока пусто"}</div>`;
      return `<div class="imp-list">${list.map(x => { const i = G.used.indexOf(x), taken = (S.gpicks || []).some(p => p.id === x.id);
        return `<button type="button" class="imp-item g-item${x.sold ? " is-sold" : ""}" data-gpick="${i}" data-kind="used"${x.sold || taken ? " disabled" : ""}>
          ${x.photo ? `<img src="${esc(x.photo)}" alt="" loading="lazy">` : ""}<b>${esc(x.name)}${x.price ? " — " + money(x.price) : " — цена не задана"}</b>
          <span>${esc([x.condition, x.kit && "комплект: " + x.kit, x.warranty && "гарантия " + x.warranty, imeiOf(x) && "IMEI " + imeiOf(x)].filter(Boolean).join(" · ") || "—")}</span>
          <em>${x.sold ? `продано${x.deal ? " · сделка №" + esc(x.deal) : ""}` : taken ? "уже в этой сделке" : "в продаже · " + esc(x.id)}</em></button>`; }).join("")}</div>`;
    }
    if (!words.length) return `<div class="note">Начните вводить: модель, память, цвет — например «17 pro 256 синий». В каталоге ${(G.items || []).length} позиций.</div>`;
    const list = (G.items || []).filter(x => hit(`${x.name} ${x.country} ${x.category} ${x.sub} ${x.source}`)).slice(0, 40);
    if (!list.length) return `<div class="note">Ничего не нашлось</div>`;
    return `<div class="imp-list">${list.map(x => `<button type="button" class="imp-item g-item" data-gpick="${G.items.indexOf(x)}" data-kind="new">
        <b>${esc(x.name)}${x.country ? " " + esc(x.country) : ""} — ${money(x.price)}</b>
        <span>закупка ${x.purchase != null ? money(x.purchase) : "—"}${x.purchase != null ? ` · нам ${money(x.price - x.purchase)}` : ""}${x.warranty ? " · " + esc(warrantyShort(x.warranty)) : ""}</span>
        <em>${esc(x.source)} · ${x.order ? "под заказ" + (x.eta ? ", " + esc(x.eta) : "") : "в наличии"}</em></button>`).join("")}</div>`;
  }
  function goodsBlock(dk) {
    const used = dk === "sale_used", G = S.goods || {};
    const picks = (S.gpicks || []).filter(p => p.kind === (used ? "used" : "new"));
    const chips = (picks.length ? `<div class="g-picked">${picks.map(p => `<span class="chip">${esc(p.device)}<button type="button" class="linkbtn" data-act="gunpick" data-device="${esc(p.device)}" title="Убрать из сделки">✕</button></span>`).join("")}</div>` : "") + (used ? "" : supplierPanel(picks));
    if (!G.open) return `<section class="block"><h3>${used ? "♻️ Б/у из бота" : "🛍 Новый товар из каталога"}</h3>${chips}
      <button type="button" class="btn" data-act="gopen">${used ? "♻️ Выбрать б/у из бота" : "🛍 Выбрать из каталога"}</button>
      <p class="note">${used ? "Аппараты из раздела «♻️ Б/у» бота — цена, гарантия, IMEI, состояние. После оформления в боте он отметится «Продано»." : "Тот же каталог, что в боте и на сайте: цена, закупка (у «под заказ» — с доставкой), склад, гарантия. Можно добавить несколько товаров — каждый станет устройством сделки."}</p></section>`;
    return `<section class="block"><h3 class="h3-row">${used ? "♻️ Б/у из бота" : "🛍 Новый товар из каталога"}<button type="button" class="linkbtn" data-act="gclose">закрыть</button></h3>${chips}
      <div class="row" style="margin-top:0"><input class="search g-q" type="search" data-act="gq" data-kind="${used ? "used" : "new"}" value="${esc(G["q_" + (used ? "used" : "new")] || "")}" placeholder="${used ? "Поиск по б/у: модель, IMEI" : "Модель, память, цвет — например «17 pro 256»"}" autocomplete="off">
      <button type="button" class="btn btn--ghost btn--sm" data-act="greload" title="Перечитать из бота">⟳</button></div>
      ${G.loading ? `<div class="note">Загружаю…</div>` : G.error ? `<div class="note">${esc(G.error)}</div>` : goodsList(dk)}</section>`;
  }
  // ── запрос поставщику (v51, 05.10.2026) ──────────────────────────────────────────────
  // В боте под заявкой есть кнопки «спросить поставщика» (план 47); продажу, оформленную прямо
  // здесь (v47), спросить было нечем. Те же контакты и тот же текст: бот (/crm/supplier) берёт
  // позиции из своего каталога по ключу и шлёт с личного Telegram владельца через юзербот — только
  // владельцу. Перед отправкой — текст на подтверждение; отметка «📤 запрос …» ложится в комментарий.
  const SUP_GROUPS = [
    { g: "s1", label: "Склад 1 (Double Apple)", src: ["S1", "S4"], contacts: [["erol", "ЭРОЛ"], ["dima", "ДИМА"]] },
    { g: "dr", label: "Dr.Store (склады 2–3)", src: ["S2", "S3"], contacts: [["drstore", "Dr.Store"]] },
  ];
  function supplierPanel(picks) {
    const rows = SUP_GROUPS.map(G => ({ ...G, items: picks.filter(p => p.key && G.src.includes(p.source)) })).filter(G => G.items.length);
    if (!rows.length) return "";
    const sent = S.supSent || {};
    return `<div class="sup">${rows.map(G => `<div class="sup__row"><span>📤 ${esc(G.label)}: <b>${G.items.length}</b> поз.${G.items.some(p => p.order) ? " · есть «под заказ»" : ""}</span>
      ${G.contacts.map(([c, name]) => `<button type="button" class="btn btn--ghost btn--sm" data-act="supreq" data-c="${c}" data-g="${G.g}" data-name="${esc(name)}"${S.supBusy === c ? " disabled" : ""}>${sent[c] ? `✓ ${esc(name)} ${esc(sent[c])}` : `Запросить: ${esc(name)}`}</button>`).join("")}</div>`).join("")}
      <p class="note">Уйдёт с вашего личного Telegram, как кнопка в боте: наличие и резерв, у «под заказ» — доступность; цена — закупочная поставщика, нашей нет. Перед отправкой покажу текст.</p></div>`;
  }
  async function supplierRequest(t) {
    const c = t.dataset.c, name = t.dataset.name, G = SUP_GROUPS.find(x => x.g === t.dataset.g);
    const keys = (S.gpicks || []).filter(p => p.kind === "new" && p.key && G.src.includes(p.source)).map(p => p.key);
    if (!keys.length) return;
    const call = body => DEMO ? Promise.resolve({ ok: true, text: "(демо) Привет! Проверьте, пожалуйста, наличие и поставьте в резерв:\n1. …", at: mskStamp().slice(11, 16), neighbours: [], already: "" })
      : fetch(CFG.botSupplier, { method: "POST", headers: { Authorization: "Bearer " + S.token, "Content-Type": "application/json" }, body: JSON.stringify({ keys, contact: c, ...body }) }).then(r => r.json().catch(() => ({ ok: false, error: "бот ответил " + r.status })));
    S.supBusy = c; rerenderKeep();
    try {
      const d = await call({ dry: true });
      if (!d.ok) throw new Error(d.error || "бот не ответил");
      const warn = [d.already && `⚠️ Этот же запрос ${name} уже ушёл в ${d.already}.`, d.neighbours?.length && `Уже ушло: ${d.neighbours.join(", ")}.`].filter(Boolean).join("\n");
      if (!confirm(`Отправить ${name} с вашего Telegram?\n${warn ? warn + "\n" : ""}\n${d.text}`)) return;
      const r = await call({ again: !!d.already });
      if (!r.ok) throw new Error(r.error || "не ушло");
      (S.supSent ||= {})[c] = r.at;
      const com = String(S.dirty.get("new:" + C.comment) || "").trim(), note = `📤 запрос ${name} ${r.at}`;
      S.dirty.set("new:" + C.comment, com ? com + "; " + note : note); saveDraft();
      toast(`📤 Ушло ${name} в ${r.at}`, null, true);
    } catch (e) { toast("Запрос поставщику: " + e.message, null, true); }
    finally { S.supBusy = null; rerenderKeep(); }
  }
  // Выбранный товар → устройство сделки: первый — в основные поля, следующие — «ещё устройство».
  function addGood(kind, i) {
    const x = kind === "used" ? S.goods?.used?.[i] : S.goods?.items?.[i]; if (!x) return;
    const f = kind === "used"
      ? { [C.device]: x.name, [C.total]: x.price ?? "", [C.warranty]: x.warranty || "", [C.imei]: imeiOf(x),
          [C.issue]: [x.condition && "состояние: " + x.condition, x.kit && "комплект: " + x.kit].filter(Boolean).join("; ") }
      : { [C.device]: x.name + (x.country ? " " + x.country : ""), [C.total]: x.price ?? "", [C.partCost]: x.purchase ?? "", [C.warranty]: warrantyShort(x.warranty) };
    const note = kind === "used" ? `♻️ б/у из бота ${x.id}` : `каталог ${x.source}${x.order ? ", под заказ" + (x.eta ? " " + x.eta : "") : ""}`;
    const mainEmpty = !String(S.dirty.get("new:" + C.device) || "").trim();
    if (mainEmpty) { for (const [c, v] of Object.entries(f)) if (String(v ?? "").trim() !== "") S.dirty.set("new:" + c, String(v)); else S.dirty.delete("new:" + c); }
    else { S.extra.push(Object.fromEntries(Object.entries(f).map(([c, v]) => [c, String(v ?? "")]))); S.multi = true; }
    const com = String(S.dirty.get("new:" + C.comment) || "").trim();
    S.dirty.set("new:" + C.comment, com ? com + "; " + note : note);
    (S.gpicks ||= []).push({ kind, id: x.id || "", key: x.key || "", source: x.source || "", order: !!x.order, device: f[C.device] });
    S.draft = true; saveDraft();
    rerenderKeep();
    toast(`${mainEmpty ? "В сделку" : "Ещё одним устройством"}: ${f[C.device]}${x.price ? " — " + money(x.price) : " — впишите цену"}`);
  }
  function unpickGood(device) {
    const p = (S.gpicks || []).find(q => q.device === device); if (!p) return;
    S.gpicks = S.gpicks.filter(q => q !== p);
    if (String(S.dirty.get("new:" + C.device) || "") === device) {
      // убрали основной товар: на его место — первое «ещё устройство», если есть
      const next = S.extra.shift();
      for (const c of [C.device, C.total, C.partCost, C.warranty, C.imei, C.issue]) { const v = next?.[c]; if (String(v ?? "").trim() !== "") S.dirty.set("new:" + c, String(v)); else S.dirty.delete("new:" + c); }
      if (!S.extra.length) S.multi = false;
    } else { S.extra = S.extra.filter(x => x[C.device] !== device); if (!S.extra.length) S.multi = false; }
    rerenderKeep();
  }
  // После создания продажи: б/у из бота → «Продано» с номером сделки. Не вышло — подсказка, а не ошибка.
  async function markUsedSold(made) {
    const picks = (S.gpicks || []).filter(p => p.kind === "used" && p.id); S.gpicks = []; S.supSent = {};
    if (!picks.length || DEMO) return picks.length ? " · в боте отмечено «Продано» (демо)" : "";
    const res = await Promise.all(picks.map(p => {
      const m = made.find(x => x.list.some(ch => ch.c === C.device && String(ch.v) === p.device)) || made[0];
      return fetch(CFG.botUsedSold, { method: "POST", headers: { Authorization: "Bearer " + S.token, "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, deal: m.num }) })
        .then(r => r.json().catch(() => ({ ok: false }))).catch(e => ({ ok: false, error: e.message }));
    }));
    const bad = res.filter(r => !r.ok).length;
    return bad ? ` · ⚠️ в боте не отмечено «Продано» (${bad}) — отметьте кнопкой в боте` : ` · в боте отмечено «Продано»`;
  }

  // ── подгрузка заказа из бота и с сайта в новую «Продажу» ──────────────────
  // Бот: GET /crm/orders (Google-токен вошедшего; бот сам проверяет доступ к таблице).
  // Сайт: лист «заказы с сайта» той же книги (оплаченные заказы; имени и телефона там нет).
  const dayISO = off => { const d = new Date(Date.now() + 3 * 3600e3 - off * 864e5); return d.toISOString().slice(0, 10); };
  const isoToRu = iso => iso.split("-").reverse().join(".");
  function importBlock() {
    const I = S.imp || {};
    if (!I.open) return `<section class="block"><h3>Заказ из бота или с сайта</h3>
      <button type="button" class="btn" data-act="impopen">🤖 Подгрузить заказ</button>
      <p class="note">Заказы бота за сегодня и вчера (или за выбранную дату) и оплаченные заказы с сайта — одним нажатием в эту продажу.</p></section>`;
    const list = I.loading ? `<div class="note">Загружаю…</div>` : I.error ? `<div class="note">${esc(I.error)}</div>`
      : !I.orders?.length ? `<div class="note">Заказов за ${esc(I.label)} нет.</div>`
      : `<div class="imp-list">${I.orders.map((o, i) => `<button type="button" class="imp-item" data-imp="${i}">
          <b>${esc(o.when)} · ${esc(o.who || "без имени")}${o.phone ? " · " + esc(o.phone) : ""}</b>
          <span>${o.items.map(x => esc(x.name) + (x.price ? " — " + money(x.price) : " — цена не найдена")).join("<br>")}</span>
          <em>${esc(o.src)}${o.total ? " · итого " + money(o.total) : ""}${o.promo ? " · промокод −" + money(o.promo.amount) : ""}</em></button>`).join("")}</div>`;
    return `<section class="block"><h3 class="h3-row">Заказ из бота или с сайта<button type="button" class="linkbtn" data-act="impclose">закрыть</button></h3>
      <div class="row" style="margin-top:0"><button type="button" class="btn ${I.mode === "recent" ? "btn--toggle" : ""}" aria-pressed="${I.mode === "recent"}" data-act="imprecent">Сегодня и вчера</button>
      <label class="imp-date"><span>или дата</span><input type="date" data-act="impdate" value="${esc(I.date || "")}" max="${dayISO(0)}"></label></div>${list}</section>`;
  }
  async function loadImports(dates) {
    S.imp = { ...(S.imp || {}), open: true, loading: true, error: "", orders: [], label: dates.length > 1 ? "сегодня и вчера" : isoToRu(dates[0]) };
    render();
    const out = [];
    try {
      if (DEMO) out.push(
        { when: "26.09 12:40", who: "Анна Демо", user: "anna_demo", phone: "+7 000 000-11-22", src: "бот · мини-приложение сайта", ref: "заказ бота demo01",
          items: [{ name: "AirPods Pro 3 🇺🇸 США", price: 24990, purchase: 21000, warranty: "1 год" }, { name: "Чехол MagSafe", price: 4990, purchase: 2500 }], total: 26980, promo: { code: "BD-DEMO", amount: 3000 } },
        { when: "25.09 18:05", who: "", phone: "", src: "сайт · Альфа-Банк", ref: "заказ с сайта №A-1024", items: [{ name: "iPhone 17 128Gb Black (🇺🇸 США S1)", price: 61900 }], total: 61900, promo: null });
      if (!DEMO) {
        const r = await fetch(CFG.botOrders + "?dates=" + dates.join(","), { headers: { Authorization: "Bearer " + S.token } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "бот не ответил (" + r.status + ")");
        for (const o of j.orders) out.push({ at: o.createdAt, when: new Date(o.createdAt + 3 * 3600e3).toISOString().slice(5, 16).replace("T", " ").replace(/^(\d\d)-(\d\d)/, "$2.$1"),
          who: o.customer?.name || o.customer?.label || "", user: o.customer?.username || "", phone: o.customer?.phone || "",
          src: "бот" + (o.source && o.source !== "бот" ? " · " + o.source : "") + (o.backfilled === true ? " · цена по текущему прайсу, проверьте" : ""), ref: "заказ бота " + o.id,
          items: (o.items || []).filter(x => x.kind !== "service").map(x => ({ name: x.name, price: x.price, purchase: x.purchase, warranty: x.warranty })),
          total: o.total, promo: o.promo });
        // оплаченные заказы с сайта — из листа той же книги
        const v = await api(`/values/${encodeURIComponent(`'${CFG.siteOrdersSheet}'!A2:G`)}`).catch(() => ({ values: [] }));
        const ru = dates.map(isoToRu);
        for (const row of v.values || []) {
          const [when, num, , pay, items, sum, src] = row.map(x => String(x ?? ""));
          if (!ru.some(d => when.startsWith(d))) continue;
          out.push({ at: 0, when: when.slice(0, 5) + " " + when.slice(11, 16), who: "", phone: "", src: "сайт · " + (src || pay || "оплачен"), ref: "заказ с сайта №" + num,
            items: items.split(/;\s*/).filter(Boolean).map(t => { const m = t.match(/^(.*?)\s+—\s+([\d\s ]+)\s*₽/); return m ? { name: m[1].trim(), price: toNum(m[2]) } : { name: t.trim(), price: null }; }),
            total: toNum(sum), promo: null });
        }
      }
      S.imp.orders = out.filter(o => o.items.length);
    } catch (e) { S.imp.error = "Не удалось загрузить: " + e.message; }
    S.imp.loading = false; render();
  }
  // Выбранный заказ → поля новой продажи: клиент, по устройству на каждую позицию
  // (несколько позиций — «несколько устройств»), цены и закупка, промокод — в комментарий
  // и вычтен из первой позиции, чтобы сумма сделки совпала с заказом.
  function takeImport(i) {
    const o = S.imp.orders[i]; if (!o) return;
    const set = (c, v) => { if (v != null && String(v) !== "") S.dirty.set("new:" + c, String(v)); };
    set(C.name, o.who); set(C.phone, o.phone);
    const [first, ...rest] = o.items;
    const promo = o.promo ? Number(o.promo.amount) || 0 : 0;
    set(C.device, first.name); set(C.total, first.price != null ? Math.max(0, first.price - promo) : "");
    set(C.partCost, first.purchase || ""); set(C.warranty, first.warranty || "");
    set(C.comment, [o.ref + (o.user ? " (@" + o.user + ")" : ""), o.promo ? `промокод ${o.promo.code}: −${o.promo.amount} ₽` : ""].filter(Boolean).join("; "));
    S.extra = rest.map(x => ({ [C.device]: x.name, [C.total]: x.price != null ? String(x.price) : "", [C.partCost]: x.purchase ? String(x.purchase) : "", [C.warranty]: x.warranty || "" }));
    S.multi = S.extra.length > 0;
    S.imp = { open: false };
    render(); window.scrollTo(0, 0);
    const noPrice = o.items.filter(x => x.price == null).length;
    toast(`Подставлен ${o.ref}${noPrice ? ` — у ${noPrice} поз. нет цены, впишите` : ""}${o.phone ? "" : " · телефона нет, впишите"}`, null, true);
  }

  function renderCard(num) {
    const r = S.byNum.get(num);
    if (!r) return renderShell(`<div class="empty">Сделка №${esc(num)} не найдена<div class="row" style="justify-content:center"><a class="btn" href="#">К списку</a></div></div>`, { search: false });
    const st = cell(r, C.status), dk = dealKey(cell(r, C.type));
    // Шапка: номер, когда принят и сколько дней, тип (если не ремонт), статус с датой смены.
    const accepted = String(cell(r, C.date)).slice(0, 10), age = daysSince(cell(r, C.date)), since = statusSince(r);
    const head = `<div class="card-head" style="margin-top:12px"><a class="iconbtn" href="#" aria-label="Назад">←</a>
      <h1>№${esc(num)}</h1>
      ${accepted ? `<span class="head-meta">принят <b>${esc(accepted)}</b>${age != null ? ` · ${age === 0 ? "сегодня" : age + " дн."}` : ""}</span>` : ""}
      ${dk !== "repair" ? `<span class="chip">${esc(cell(r, C.type))}</span>` : ""}<span class="chip chip--big chip--${statusKind(st)}">${esc(stLabel(st) || "без статуса")}${since ? `<small>с ${esc(since)}</small>` : ""}</span></div>`;
    renderShell(head + groupBlock(r) + cardBody(r.row, r, false), { search: false });
    saveBar(r.row, `data-num="${esc(num)}"`);
  }

  function saveBar(key, attrs) {
    const ks = [...S.dirty.keys()].filter(k => k.startsWith(key + ":"));
    const n = ks.length + skPending(key).length, quietSt = isSilent(S.dirty.get(key + ":" + C.status) ?? "");
    const notify = ks.some(k => F[+k.split(":")[1]]?.notify && !(quietSt && +k.split(":")[1] === C.status));
    const isNew = key === "new";
    if (isNew) saveDraft();
    $app.insertAdjacentHTML("beforeend", `<div class="savebar"><div class="savebar__in">
      <button class="btn btn--ghost" data-act="discard" ${n || isNew ? "" : "disabled"}>Отмена</button>
      <button class="btn btn--red" data-act="save" ${attrs} ${n ? "" : "disabled"}>${isNew ? newLabel() : n ? (notify ? `Сохранить и уведомить (${n})` : quietSt ? `Закрыть без уведомления (${n})` : `Сохранить (${n})`) : "Изменений нет"}</button>
    </div></div>`);
  }
  function newLabel() {
    const k = 1 + (S.multi ? S.extra.filter(x => String(x[C.device] ?? "").trim()).length : 0);
    return k > 1 ? `Создать ${k} ${k < 5 ? "заказа" : "заказов"}` : "Создать заказ";
  }
  function refreshSaveBar(key) { $app.querySelector(".savebar")?.remove(); saveBar(key, location.hash === "#/new" ? 'data-new="1"' : `data-num="${esc(location.hash.slice(2))}"`); }



  // IMEI и S\N, вписанные в «Устройство», — в свою колонку AD (28.09.2026, план 93 §11.22).
  // Тот же разбор, что в scripts/move_device_serials.mjs, которым перенесли 2646 старых номеров.
  var SER_LOOK = { "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
    "а": "A", "в": "B", "е": "E", "к": "K", "м": "M", "н": "H", "о": "O", "р": "P", "с": "C", "т": "T", "х": "X", "у": "Y" };
  var SER_NB = "(?<![a-zа-яё0-9])", SER_SEP = "[ \\t]*(?:№|#|:|\\.|-|—)?[ \\t]*";
  function serialLine_(e) {
    var found = [], touched = false;
    var rest = e.replace(new RegExp(SER_NB + "(?:imei\\s*[12]?|имей|имэй|ime(?![a-zа-я]))" + SER_SEP + "(\\d[\\d \\-]{9,22}\\d)?", "giu"), function (m, v) {
      if (v) { var d = v.replace(/\D/g, ""); if (d.length < 11) return m; found.push(d); }
      touched = true; return " ";
    });
    rest = rest.replace(new RegExp(SER_NB + "(?:s\\s*[\\\\/|]\\s*n|snid|sn|с\\s*/\\s*н|серийн(?:ый|ик)(?:\\s+номер)?)(?![a-zа-яё])" + SER_SEP + "([0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё\\-]{3,24})?", "giu"), function (m, v) {
      if (v) {
        var s = v.replace(/^[-—]+|[-—]+$/g, "").split("").map(function (ch) { return SER_LOOK[ch] || ch; }).join("").toUpperCase();
        if (!/^[0-9A-Z-]{5,25}$/.test(s) || !/\d/.test(s)) return m;
        found.push(s);
      }
      touched = true; return " ";
    });
    rest = rest.replace(/(?<![\d\p{L}_])(\d{15})(?![\d\p{L}_])/gu, function (m, d) { found.push(d); touched = true; return " "; });
    if (!touched) return { rest: e, found: found };
    return { rest: rest.replace(/[ \t]{2,}/g, " ").replace(/^[ \t,;:\-—]+|[ \t,;:\-—]+$/g, ""), found: found };
  }
  /** → { rest: устройство без номеров, ad: номера для AD } или null, если номеров и подписей нет. */
  function splitDeviceSerial_(e) {
    var lines = String(e == null ? "" : e).split("\n"), keep = [], pairs = [], dev = "", touched = false;
    lines.forEach(function (line) {
      var p = serialLine_(line); if (p.rest !== line) touched = true;
      var tidy = p.rest.replace(/[ \t]{2,}/g, " ").trim();
      if (tidy) { keep.push(tidy); dev = tidy; }
      p.found.forEach(function (f) { if (!pairs.some(function (x) { return x.v === f; })) pairs.push({ dev: dev, v: f }); });
    });
    if (!touched) return null;
    var devs = {}; pairs.forEach(function (x) { if (x.dev) devs[x.dev] = 1; });
    var many = Object.keys(devs).length > 1;
    var ad = pairs.map(function (x) { return (many && x.dev ? x.dev + ": " : "") + x.v; }).join("; ");
    var rest = keep.join("\n").trim();
    return { rest: rest || (pairs.length ? String(e).trim() : ""), ad: ad };
  }
  function mergeSerials_(old, add) {
    old = String(old == null ? "" : old).trim(); if (!add) return old; if (!old) return add;
    var missing = add.split("; ").filter(function (x) { return old.indexOf(x.split(": ").pop()) === -1; });
    return missing.length ? old + "; " + missing.join("; ") : old;
  }


  // ── автоисправление опечаток, как на клавиатуре телефона (v27, 29.09.2026) ──────
  // Владелец: подчёркивание есть, а правой кнопкой не исправляется. Подсказки правой кнопкой
  // даёт проверка орфографии самой macOS, оболочка на неё не влияет. Поэтому исправляем
  // сами через Яндекс.Спеллер (бесплатный, CORS открыт): дописал слово и поставил пробел
  // или знак — опечатка заменяется сразу, под полем «исправлено: … · вернуть». «Вернуть»
  // запоминает слово на этом устройстве. Уходит в Яндекс только само слово; при выходе из
  // «Неисправности» и «Работ» — текст поля целиком, оставшиеся ошибки — кнопками.
  // 29.09.2026 через спеллер прогнали 1003 частых слова базы: 77 помечены, почти все —
  // настоящие опечатки («необходма» ×76, «соглосовано» ×43, «профилкатика» ×34). Жаргон и
  // имена, которые он путает, — в SPELL_KEEP.
  const SPELL_URL = "https://speller.yandex.net/services/spellservice.json/checkText";
  const SPELL_COLS = [C.issue, C.work, C.comment, C.warranty];
  const SPELL_KEEP = new Set(["пробит", "оригчип", "скаймоби", "диспа", "дисп", "симкарту", "симкарта", "вайфай", "витали", "виталя", "тинькоф", "вотсапп", "ватсап",
    "вебкамеры", "вебкамера", "партслог", "либерти", "педант", "флорид", "тристар", "тайпси", "магсейф", "буткамп", "лвдс", "хдд", "ссд", "озу", "гпу", "юсб",
    "мульта", "матплаты", "матплата", "материнки", "материнка", "проца", "клава", "клавы", "видос", "видоса", "ноут", "комп", "биток", "тачбар", "айклауд",
    "ребол", "реболл", "аудиокодек", "аудиокодека", "подменный", "ремакс", "мосэлсиди"]);
  const spellMine = () => new Set(store.get("crm.spell.keep") || []);
  const spellCache = new Map(); // слово → исправление ("" — слово верное)
  const SPELL_SEP = /[\s.,;:!?)»"]/;
  async function spellWord(w) {
    const k = w.toLowerCase();
    if (spellCache.has(k)) return spellCache.get(k);
    const j = await fetch(SPELL_URL + "?lang=ru,en&options=518&text=" + encodeURIComponent(w)).then(r => r.json()).catch(() => null);
    const fix = j?.[0]?.s?.[0] || "";
    spellCache.set(k, fix);
    return fix;
  }
  function spellSkip(w) {
    const k = w.toLowerCase().replace(/ё/g, "е");
    return w.length < 4 || /\d/.test(w) || (w === w.toUpperCase() && /[A-ZА-ЯЁ]/.test(w)) || SPELL_KEEP.has(k) || spellMine().has(k);
  }
  // Заменить кусок текста в поле, не ломая Ctrl+Z: execCommand делает правку «как набранную».
  function spellReplace(el, start, end, text) {
    const caret = el.selectionStart, delta = text.length - (end - start);
    el.focus({ preventScroll: true }); el.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, text)) { el.setRangeText(text, start, end, "end"); el.dispatchEvent(new Event("input", { bubbles: true })); }
    const pos = caret >= end ? caret + delta : caret; el.setSelectionRange(pos, pos);
  }
  const matchCase = (orig, fix) => orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase() ? fix[0].toUpperCase() + fix.slice(1) : fix;
  function spellNote(el, html) {
    const host = el.closest(".field") || el.parentElement; if (!host) return;
    let n = host.querySelector(":scope > .spellnote");
    if (!html) { n?.remove(); return; }
    if (!n) { n = document.createElement("div"); n.className = "spellnote"; host.appendChild(n); }
    n.innerHTML = html;
  }
  const isSpellField = el => (el.tagName === "TEXTAREA" || el.tagName === "INPUT") && (SPELL_COLS.includes(+el.dataset.edit) || (el.dataset.extra != null && SPELL_COLS.includes(+el.dataset.col)) || el.dataset.pf === "name");
  document.addEventListener("input", async e => {
    const el = e.target;
    if (!isSpellField(el) || el.dataset.edit === undefined && el.dataset.extra === undefined && el.dataset.pf !== "name") return;
    if (!((e.inputType === "insertText" && e.data && SPELL_SEP.test(e.data.slice(-1))) || e.inputType === "insertLineBreak" || e.inputType === "insertParagraph")) return;
    const before = el.value.slice(0, el.selectionStart - 1);
    const m = before.match(/([A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)?)$/); if (!m) return;
    const w = m[1], start = before.length - w.length, end = before.length;
    if (spellSkip(w)) return;
    const fix = await spellWord(w);
    if (!fix || fix.toLowerCase() === w.toLowerCase() || el.value.slice(start, end) !== w) return;
    const put = matchCase(w, fix);
    spellReplace(el, start, end, put);
    spellNote(el, `исправлено: <s>${esc(w)}</s> → <b>${esc(put)}</b> <button type="button" class="linkbtn" data-act="spellundo" data-w="${esc(w)}" data-fix="${esc(put)}" data-at="${start}">вернуть</button>`);
  });
  // Выход из поля: всё, что осталось с ошибками (вставленный текст, слово в конце строки),
  // — кнопками «исправить». Сами не меняем: текст может быть чужим и старым.
  document.addEventListener("focusout", async e => {
    const el = e.target;
    if (!(el.tagName === "TEXTAREA" && [C.issue, C.work].includes(+(el.dataset.edit ?? el.dataset.col)))) return;
    const text = el.value.trim(); if (text.length < 4) return spellNote(el, "");
    const j = await fetch(SPELL_URL, { method: "POST", body: new URLSearchParams({ lang: "ru,en", options: "518", text }) }).then(r => r.json()).catch(() => null);
    const errs = (j || []).filter(x => x.s?.[0] && !spellSkip(x.word)).slice(0, 8);
    if (!errs.length || !document.body.contains(el)) return;
    spellNote(el, `Возможно, опечатки: ${errs.map(x => `<button type="button" class="spellfix" data-act="spellfix" data-w="${esc(x.word)}" data-fix="${esc(matchCase(x.word, x.s[0]))}">${esc(x.word)} → ${esc(matchCase(x.word, x.s[0]))}</button>`).join(" ")}
      ${errs.length > 1 ? `<button type="button" class="linkbtn" data-act="spellfixall">исправить всё</button>` : ""}`);
  });
  function spellFieldOf(btn) { return btn.closest(".field")?.querySelector("textarea, input") || btn.closest(".spellnote")?.parentElement?.querySelector("textarea, input"); }
  function spellApply(el, w, fix) {
    const re = new RegExp("(^|[^A-Za-zА-Яа-яЁё])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-zА-Яа-яЁё])"), m = el.value.match(re);
    if (!m) return false;
    const start = m.index + m[1].length; spellReplace(el, start, start + w.length, fix); return true;
  }


  // ── удаление заказа (v28, 01.10.2026) ─────────────────────────────────────────
  // Строку из листа НЕ вырезаем: от номера строки зависят «История статусов» («Строка N»),
  // реестр назначений бота мастера и ссылки в оболочке — после вырезания все строки ниже
  // съехали бы. Поэтому поля строки очищаются (B–Q и S–AG), номер в A и формула в R
  // остаются. Если удалён последний заказ, следующий новый ляжет в эту же строку с тем же
  // номером. Полная копия строки (как в таблице, с формулами) уходит на лист «Удалённые
  // заказы» — с временем и почтой того, кто удалил; сразу после удаления есть «Вернуть».
  // Клиенту ничего не уходит: дверь не зовётся. В «Историю статусов» — строка «Удалён».
  const TRASH = "Удалённые заказы";
  async function ensureTrash() {
    if (S.trashOk) return;
    const meta = await api("?fields=sheets(properties(title))");
    if (!meta.sheets.some(x => x.properties.title === TRASH)) {
      await api(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TRASH, gridProperties: { frozenRowCount: 1 } } } }] }) });
      const head = (await api(`/values/${A1(0, 1, C.group, 1)}`)).values?.[0] || [];
      await api(`/values/${encodeURIComponent(`'${TRASH}'!A1`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["Когда удалён", "Кто удалил", "Строка", ...head.map(String)]] }) });
    }
    S.trashOk = true;
  }
  function deleteBox(r) {
    if (!canCreate()) return "";
    if (S.delAsk !== r.row) return `<button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="delask">🗑 Удалить заказ</button>`;
    return `<div class="delask"><b>Удалить заказ №${esc(cell(r, C.num))}?</b> Строка в таблице очистится, копия уйдёт на лист «${TRASH}», клиенту ничего не отправится.
      <div class="row"><button type="button" class="btn btn--red btn--sm" data-act="delyes">Да, удалить</button><button type="button" class="btn btn--ghost btn--sm" data-act="delno">Отмена</button></div></div>`;
  }
  async function deleteOrder(num) {
    const r = S.byNum.get(num); if (!r) return;
    try {
      let raw = r.cells.slice(0, C.group + 1);
      if (!DEMO) {
        const chk = await api(`/values/${A1(0, r.row)}`);
        if (String(chk.values?.[0]?.[0] ?? "").trim() !== String(num)) throw new Error("Строка в таблице сдвинулась — обновите список (⟳) и повторите");
        raw = (await api(`/values/${A1(0, r.row, C.group, r.row)}?valueRenderOption=FORMULA`)).values?.[0] || [];
        await ensureTrash();
        await api(`/values/${encodeURIComponent(`'${TRASH}'!A:AJ`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          { method: "POST", body: JSON.stringify({ values: [[mskStamp(), S.email || "", r.row, ...raw.map(v => String(v ?? ""))]] }) });
        await api("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: [`'${CFG.sheet}'!B${r.row}:Q${r.row}`, `'${CFG.sheet}'!S${r.row}:${LETTER(C.group)}${r.row}`] }) });
        await logStatus([[r.row, cell(r, C.status), "Удалён"]]);
      }
      S.lastDeleted = { row: r.row, num, raw };
      for (const k of [...S.dirty.keys()]) if (k.startsWith(r.row + ":")) S.dirty.delete(k);
      S.rows = S.rows.filter(x => x !== r); S.byNum.delete(String(num)); S.clients = null; S.delAsk = null;
      location.hash = "";
      toast(`Заказ №${num} удалён${DEMO ? " (демо)" : ` — копия на листе «${TRASH}»`}`, DEMO ? null : { label: "Вернуть", run: restoreOrder }, true);
    } catch (e) { toast(e.message, null, true); }
  }
  // «Вернуть» сразу после удаления: строка пустая — пишем её обратно как была. Значения —
  // как есть (RAW: пароль «000000» не превратится в 0), формулы — отдельно, как формулы.
  async function restoreOrder() {
    const d = S.lastDeleted; if (!d) return;
    try {
      const now = (await api(`/values/${A1(1, d.row, C.group, d.row)}`)).values?.[0] || [];
      if (now.some(v => String(v).trim())) return toast(`Строка ${d.row} уже занята — верните заказ вручную с листа «${TRASH}»`, null, true);
      const plain = d.raw.map(v => typeof v === "string" && v.startsWith("=") ? null : v);
      await api(`/values/${A1(0, d.row, C.group, d.row)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [plain] }) });
      const f = d.raw.map((v, i) => typeof v === "string" && v.startsWith("=") ? { range: `'${CFG.sheet}'!${LETTER(i)}${d.row}`, values: [[v]] } : null).filter(Boolean);
      if (f.length) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: f }) });
      await logStatus([[d.row, "Удалён", d.raw[C.status] || "Пусто"]]);
      S.lastDeleted = null; toast(`Заказ №${d.num} возвращён`); await load(); location.hash = "#/" + d.num;
    } catch (e) { toast("Не удалось вернуть: " + e.message, null, true); }
  }

  // ── из карточки: новый заказ этому клиенту и гарантийный ремонт (v19) ──────────
  // Как «Скопировать заказ» и «Гарантийный заказ» в RemOnline/RepairShopr: данные клиента
  // не вводятся заново, а гарантийный заказ связан с исходным (AF «Связанная сделка №»).
  function warrantyDays(v) { const m = String(v ?? "").match(/(\d+)\s*(дн|день|дня|мес|г)/i) || String(v ?? "").match(/^(\d+)$/); if (!m) return null; const n = +m[1]; return /мес/i.test(m[2] || "") ? n * 30 : /^г/i.test(m[2] || "") ? n * 365 : n; }
  function warrantyUntil(r) {
    const d = parseDate(cell(r, C.issued)), days = warrantyDays(cell(r, C.warranty));
    if (!d || days == null) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  }
  const ru = d => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  function clientActions(r, dk) {
    let w = "";
    if ((dk === "repair" || dk === "other") && norm(cell(r, C.status)).startsWith("выполнен")) {
      const until = warrantyUntil(r), live = until && until >= new Date(new Date().toDateString());
      w = `<button type="button" class="btn btn--ghost btn--sm" data-act="warranty">🔁 Гарантийный ремонт${until ? ` <small class="note">${live ? "гарантия до " + ru(until) : "гарантия истекла " + ru(until)}</small>` : ""}</button>`;
    }
    return `<div class="row">${w}<button type="button" class="btn btn--ghost btn--sm" data-act="newfor">＋ Новый заказ этому клиенту</button></div>`;
  }
  function startNewFrom(r, warranty) {
    for (const k of [...S.dirty.keys()]) if (k.startsWith("new:")) S.dirty.delete(k);
    S.multi = false; S.extra = []; S.newStatusTouched = false; S.imp = null; S.parts.delete("new"); S.pp = null;
    S.draft = true; S.newClient = clientOfRow(r)?.key || null;
    const set = (c, v) => { if (String(v ?? "").trim() !== "") S.dirty.set("new:" + c, String(v)); };
    set(C.status, CFG.newStatus); set(C.date, today()); set(C.type, "Ремонт");
    set(C.name, cell(r, C.name)); set(C.phone, cell(r, C.phone)); set(C.source, "Постоянные");
    if (warranty) {
      const num = String(cell(r, C.num)).trim(), until = warrantyUntil(r);
      set(C.device, cell(r, C.device)); set(C.imei, cell(r, C.imei)); set(C.pass, cell(r, C.pass)); set(C.linked, num);
      set(C.total, "0");
      set(C.comment, `Гарантия по заказу №${num}: ${cell(r, C.work) || "—"}${cell(r, C.issued) ? `; выдан ${String(cell(r, C.issued)).slice(0, 10)}` : ""}${until ? `; гарантия до ${ru(until)}` : ""}`);
    }
    location.hash = "#/new";
    toast(warranty ? `Гарантийный заказ по №${cell(r, C.num)}: клиент и устройство подставлены, «Итого» — 0` : `Новый заказ: ${cell(r, C.name) || "клиент"} подставлен`, null, true);
  }

  // Черновик нового заказа — в браузере: перезагрузка страницы или случайно закрытая
  // вкладка не стирают набранное (так жалуются на Orderry и HelloClient).
  function saveDraft() {
    const dirty = [...S.dirty].filter(([k]) => k.startsWith("new:"));
    const meaningful = dirty.some(([k, v]) => ![C.status, C.date, C.type].includes(+k.split(":")[1]) && String(v ?? "").trim());
    if (!meaningful && !S.extra.length) { store.del("crm.draft"); return; }
    store.set("crm.draft", { at: Date.now(), dirty, multi: S.multi, extra: S.extra, parts: S.parts.get("new") || null, touched: !!S.newStatusTouched });
  }
  function restoreDraft() {
    const d = store.get("crm.draft");
    if (!d || Date.now() - d.at > 3 * 864e5 || !d.dirty?.length) return false;
    for (const [k, v] of d.dirty) S.dirty.set(k, v);
    S.multi = !!d.multi; S.extra = d.extra || []; S.newStatusTouched = !!d.touched;
    if (d.parts) S.parts.set("new", d.parts);
    setTimeout(() => toast("Восстановлен незаконченный заказ. «Отмена» внизу — начать заново", null, true), 50);
    return true;
  }

  // ── новый заказ ─────────────────────────────────────────
  function renderNew() {
    if (!canCreate()) { location.hash = ""; return; }
    if (!S.draft) {
      S.draft = true;
      if (restoreDraft()) return renderNew();
      S.dirty.set("new:" + C.status, CFG.newStatus);
      S.dirty.set("new:" + C.date, today());
      S.dirty.set("new:" + C.type, "Ремонт");
    }
    const head = `<div class="card-head" style="margin-top:14px"><a class="iconbtn" href="#" aria-label="Назад">←</a><h1>Новый заказ</h1></div>`;
    renderShell(head + cardBody("new", null, true) +
      (["repair", "other"].includes(dealKey(S.dirty.get("new:" + C.type))) ? `<p class="note" style="margin:14px 4px 0">Статус — «${esc(CFG.newStatus)}». Номер присвоится следующий по порядку; клиенту уйдёт то же сообщение, что при записи в таблицу.</p>` : `<p class="note" style="margin:14px 4px 0">Номер присвоится следующий по порядку.</p>`), { search: false });
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
      else if (ch.formula) ch.w = String(ch.v);
      else if (f?.num || ch.c === C.num) { const n = toNum(ch.v); ch.w = n == null ? String(ch.v ?? "") : n; } // номер — числом, как у всех строк
      else ch.w = String(ch.v ?? "");
    }
    if (DEMO) return;
    const pack = arr => arr.map(ch => ({ range: `'${CFG.sheet}'!${LETTER(ch.c)}${row}`, values: [[ch.w]] }));
    const entered = list.filter(ch => F[ch.c]?.entered || ch.formula), raw = list.filter(ch => !F[ch.c]?.entered && !ch.formula);
    const calls = [];
    if (raw.length) calls.push(api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: pack(raw) }) }));
    if (entered.length) calls.push(api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: pack(entered) }) }));
    await Promise.all(calls);
  }
  // Строки в «Историю статусов» — в том же виде, что пишет onEditTrigger (Contact.js).
  function mskStamp() {
    const d = new Date(Date.now() + 3 * 3600e3), p = n => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  }
  async function logStatus(items) {
    if (DEMO || !items.length) return;
    const ts = mskStamp();
    await api(`/values/${encodeURIComponent("'История статусов'!A:D")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: "POST", body: JSON.stringify({ values: items.map(([row, old, v]) => [ts, "Строка " + row, String(old || "Пусто"), String(v)]) }) });
  }
  // only — номера дверей, которые звать (кнопка «Повторить» зовёт только упавшие).
  // v39 (03.10.2026): двери идут независимо — раньше сбой первой обрывал цикл, и вторая (сообщения
  // клиенту) не звалась вовсе; обрыв сети («Failed to fetch») повторяется, как «дверь занята»; в
  // ошибке видно, какая дверь не ответила. Поводом стал №7760: личная дверь отдавала страницу
  // ошибки Google (у аккаунта отозвали разрешение script.external_request), без CORS-заголовка —
  // браузер видит это только как «Failed to fetch».
  const DOOR_NAME = i => ["рабочая дверь (ironsapple)", "личная дверь"][i] || "дверь " + (i + 1);
  // Порядок дверей (v44, 03.10.2026). Владелец: «зарегистрировал заказ — уведомление что-то долго».
  // Двери шли строго «рабочая → личная»: рабочая заводит Google-контакт, пушит имя в Telegram и
  // WhatsApp, пишет «Историю статусов» — ~45 с на новый заказ, и только потом личная слала
  // клиенту сообщение (№7795: статус в 16:11:31, сообщение — в 16:11:44–50, тост ещё позже). Сообщению
  // о статусе рабочая дверь не нужна. Нужна она только отчёту (L) и напоминанию об отзыве (J): в
  // отчёте «Дата выдачи», а её ставит рабочая дверь по закрывающему статусу. Поэтому личная — первой,
  // кроме сохранений с L или J. onDone — итог каждой двери сразу, не дожидаясь второй.
  const doorOrder = list => list.some(ch => ch.c === C.report || ch.c === C.review) ? [0, 1] : [1, 0];
  async function door(row, num, list, only, onDone) {
    if (DEMO || !CFG.doors.length) return null;
    // force — «отправить ещё раз»: статус кнопкой resend и отчёт поверх уже отправленного (Ok → Ok).
    // Без него дверь пропустила бы то же значение как «уже обработано» в течение 10 минут.
    const force = list.filter(ch => ch.force || (ch.c === C.report && isTrue(ch.old) && isTrue(ch.v))).map(ch => ch.c + 1);
    const body = JSON.stringify({ token: S.token, row, num, force, changes: list.map(ch => ({ col: ch.c + 1, value: String(ch.w ?? ch.v ?? ""), old: String(ch.old ?? "") })) });
    const all = { ok: true, results: [], statusBackground: "", issued: null, failed: [] };
    for (const di of doorOrder(list)) {
      const url = CFG.doors[di]; if (!url) continue;
      if (only && !only.includes(di)) continue;
      try {
      // «Дверь занята» — дверь держит один запрос за раз (замок на 25 с). Когда в оболочке
      // работают двое или идут уведомления по нескольким заказам, второй запрос получал
      // отказ, и сообщения клиенту молча терялись (01.10.2026: отчёты №7782 и №7785).
      // Теперь повторяем с растущей паузой — до ~1,5 минут. keepalive: запрос доживает,
      // даже если вкладку закроют.
      let j;
      for (let tries = 0; ; tries++) {
        let net = false;
        try {
          const r = await fetch(url + "?action=crm-door", { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body, keepalive: body.length < 60000 });
          const text = await r.text();
          try { j = JSON.parse(text); }
          catch { j = { ok: false, error: (text.match(/Exception:[^<]{0,160}/) || [])[0] || "ответила не JSON (" + r.status + ")" }; }
        } catch (e) { net = true; j = { ok: false, error: "не ответила — сеть или Google вернул ошибку (например, у аккаунта отозваны разрешения скрипта)" }; }
        if (j.ok || !(net || /занята/.test(j.error || "")) || tries >= (net ? 2 : 5)) break;
        await new Promise(res => setTimeout(res, 3000 * (tries + 1)));
      }
      if (!j.ok) throw new Error(j.error || "не ответила");
      all.results.push(...(j.results || []));
      // Цвет H ставит личная дверь (итог отправки клиенту); рабочая отдаёт его же, прочитав клетку.
      if (di === 1 || !all.statusBackground) all.statusBackground = j.statusBackground || all.statusBackground;
      if (j.issued != null) all.issued = j.issued;
      try { onDone?.(di, j); } catch { /* подсказка — не повод ронять дверь */ }
      } catch (e) { all.failed.push({ i: di, why: DOOR_NAME(di) + ": " + e.message }); }
    }
    if (all.failed.length) { const err = new Error(all.failed.map(f => f.why).join("; ")); err.failed = all.failed.map(f => f.i); err.partial = all; throw err; }
    return all;
  }
  function doorReport(j, list, r) {
    if (!j) return "";
    const px = r && phones(cell(r, C.contactPhone)).length;
    const errs = (j.results || []).flatMap(x => x.errors || []);
    if (errs.length) return "Записано, но обработчик споткнулся: " + errs[0];
    if (list.some(ch => ch.c === C.status)) {
      const bg = String(j.statusBackground || "").toLowerCase();
      if (bg === "#00bfff") return px ? "Отправлено человеку на связи ✓" : "Клиенту отправлено ✓";
      if (bg === "#ffff00") return "Статус сохранён. Клиента нет в Telegram — ушло в MAX/WhatsApp, если он там есть";
      if (bg === "#ff0000") return px ? "Отправка на номер для связи не удалась — проверьте номер" : "Статус сохранён, но отправка клиенту не удалась — проверьте номер";
    }
    if (list.some(ch => ch.c === C.report && isTrue(ch.v))) return px ? "Отчёт отправлен человеку на связи ✓" : "Отчёт клиенту отправлен ✓";
    return "Уведомления обработаны ✓";
  }
  // Уведомления — в фоне: человек видит «Сохранено» сразу после записи в таблицу (~1 с),
  // а не ждёт, пока обе двери разошлют сообщения (раньше это было ~5 с).
  function doorInBackground(r, num, list, only) {
    if (DEMO || !CFG.doors.length) return;
    const notify = list.some(ch => F[ch.c]?.door);
    if (!notify) return;
    S.pendingDoors = (S.pendingDoors || 0) + 1;
    // Итог для клиента — как только ответила личная дверь (она шлёт сообщения), не дожидаясь рабочей.
    let told = false;
    const early = (di, j) => { if (di === 1 && doorOrder(list)[0] === 1) { told = true; toast(`№${num}: ${doorReport({ ...j, results: j.results || [] }, list, r)}`, null, true); } };
    return door(r.row, num, list, only, early).finally(() => { S.pendingDoors--; }).then(j => {
      if (j?.issued != null && j.issued !== cell(r, C.issued)) {
        r.cells[C.issued] = j.issued;
        if (location.hash === "#/" + num && ![...S.dirty.keys()].some(k => k.startsWith(r.row + ":"))) renderCard(num);
      }
      const errs = (j?.results || []).flatMap(x => x.errors || []);
      if (!told || errs.length) toast(`№${num}: ${doorReport(j, list, r)}`, null, true);
    }).catch(e => toast(`№${num}: записано в таблицу, но ${e.failed?.includes(1) || !e.failed ? "уведомления НЕ ушли" : "часть обработки не прошла"} — ${e.message}`, { label: "Повторить", run: () => doorInBackground(r, num, list, e.failed) }, 60000));
  }

  async function save(num) {
    const r = S.byNum.get(num); if (!r) return;
    const key = r.row;
    const list = [...S.dirty].filter(([k]) => k.startsWith(key + ":")).map(([k, v]) => { const c = +k.split(":")[1]; return { c, v, old: cell(r, c) }; });
    const skOps = skPending(key); // запчасти со склада Витали — списать после записи заказа
    if (!list.length && !skOps.length) return;
    if (!list.length) { // в заказе ничего не поменялось, только выбрали запчасть со склада
      busy(true);
      const msg = await skWriteOff(num, skOps);
      S.parts.delete(key); render(); toast(`№${num}:${msg.replace(/^ ·/, "")}`, null, true);
      return;
    }
    // Выкуп/trade-in/продажа группой: статус — сразу у всех устройств, отчёт — в первой строке.
    const others = new Map(); // строка → изменения
    const gr = groupOf(r);
    if (gr?.shared) {
      const st = list.find(ch => ch.c === C.status), rep = list.find(ch => ch.c === C.report);
      const add = (x, ch) => { if (!others.has(x)) others.set(x, []); others.get(x).push(ch); };
      if (st) for (const x of gr.rows) if (x !== r && cell(x, C.status) !== st.v) add(x, { c: C.status, v: st.v, old: cell(x, C.status) });
      if (rep && gr.head !== r) { list.splice(list.indexOf(rep), 1); S.dirty.delete(key + ":" + C.report); add(gr.head, { c: C.report, v: rep.v, old: cell(gr.head, C.report) }); }
    }
    // Без суммы не закрыть: этот заказ и (у выкупа/продажи группой) остальные устройства группы.
    const get = c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : cell(r, c); };
    const stCh = list.find(ch => ch.c === C.status), repCh = list.find(ch => ch.c === C.report);
    const miss = (stCh ? needSum(stCh.v, dealKey(get(C.type)), get) : null) ?? (repCh && isTrue(repCh.v) ? reportNeedsSum(r, get) : null);
    if (miss != null) return askSum(miss, stCh && sumColFor(stCh.v, dealKey(get(C.type))) != null ? `Заказ №${num} не закрыть без суммы` : "Отчёт клиенту без суммы не отправить");
    const lack = [...others].filter(([x, l]) => { const s2 = l.find(ch => ch.c === C.status); return s2 && needSum(s2.v, dealKey(cell(x, C.type)), c => cell(x, c)) != null; }).map(([x]) => "№" + cell(x, C.num));
    if (lack.length) return toast(`Не закрыть группу: нет суммы у ${lack.join(", ")} — откройте эти заказы и впишите`, null, true);
    busy(true);
    try {
      const check = async x => {
        if (DEMO) return;
        const chk = await api(`/values/${A1(0, x.row)}`);
        if (String(chk.values?.[0]?.[0] ?? "").trim() !== String(cell(x, C.num)).trim()) throw new Error("Строка в таблице сдвинулась — обновите список (⟳) и повторите");
      };
      await Promise.all([r, ...others.keys()].map(check));
      await Promise.all([list.length ? writeCells(r.row, list) : null, ...[...others].map(([x, l]) => writeCells(x.row, l))]);
      const skMsg = skOps.length ? await skWriteOff(num, skOps) : "";
      // Тихое закрытие: дверь не зовём (клиенту ничего), историю пишем сами.
      const quiet = [[r, list], ...others].filter(([, l]) => l.some(ch => ch.c === C.status && isSilent(ch.v)));
      if (quiet.length) await logStatus(quiet.map(([x, l]) => { const ch = l.find(c => c.c === C.status); return [x.row, ch.old, ch.v]; }));
      for (const ch of list) { r.cells[ch.c] = String(ch.w ?? ""); S.dirty.delete(key + ":" + ch.c); }
      S.parts.delete(key); if (S.pp?.key === key) S.pp = null;
      for (const [x, l] of others) { for (const ch of l) x.cells[ch.c] = String(ch.w ?? ""); index(x); }
      const stamp = today().slice(0, 5) + today().slice(5);
      for (const [x, l] of [[r, list], ...others]) { const st = l.find(ch => ch.c === C.status); if (st) S.since.set(x.row, { ts: stamp, st: String(st.v) }); }
      index(r); S.clients = null;
      render();
      for (const [, l] of quiet) { const i = l.findIndex(ch => ch.c === C.status); if (i >= 0) l.splice(i, 1); } // тихий статус — мимо двери
      const all = [...list, ...[...others.values()].flat()];
      toast((DEMO ? "Сохранено (демо — в таблицу не пишется)" : quiet.length && !all.some(ch => F[ch.c]?.door) ? "Закрыт без уведомления ✓ Клиенту ничего не отправлено" : all.some(ch => F[ch.c]?.door) ? `Сохранено ✓${others.size ? ` (и у ${others.size} устр. группы)` : ""} Уведомления отправляются…` : "Сохранено ✓") + skMsg, null, true);
      // Вписали номер на связи в идущий заказ и статус не меняли — предложить отправить ему статус.
      const cp = list.find(ch => ch.c === C.contactPhone);
      if (cp && phones(cp.v).length && !stCh && !isSilent(cell(r, C.status)) && !all.some(ch => F[ch.c]?.door))
        toast(`№${num}: номер на связи сохранён — дальше уведомления по заказу пойдут ему`, { label: "Отправить ему текущий статус", run: () => resendStatus(r) }, 20000);
      // Двери по очереди: сначала эта строка, потом остальные строки группы.
      [[r, list], ...others].reduce((p, [x, l]) => p.then(() => l.length ? doorInBackground(x, String(cell(x, C.num)).trim(), l) : null), Promise.resolve());
    } catch (e) { busy(false); toast(e.message, null, true); }
  }

  async function create() {
    const get = c => S.dirty.get("new:" + c) ?? "";
    const skOps = S.multi ? [] : skPending("new"); // запчасти со склада — списать в первый заказ после записи
    if (!String(get(C.name)).trim() && !String(get(C.phone)).trim()) return toast("Нужно имя или телефон клиента");
    busy(true);
    try {
      // Список полей на каждое устройство: первое — из основных полей формы, остальные —
      // общие поля клиента и сделки плюс свои поля устройства.
      const shared = [...S.dirty].filter(([k]) => k.startsWith("new:")).map(([k, v]) => ({ c: +k.split(":")[1], v, old: "" }));
      // Контакт, заведённый заранее (v45): ждём ответ до 8 с и пишем его ID в X.
      const px = preSig();
      if (S.pre && px && S.pre.sig === px.sig) {
        const j = await Promise.race([S.pre.promise, new Promise(res => setTimeout(() => res(null), 8000))]);
        if (j?.ok && j.id && !shared.some(ch => ch.c === C.gcontact)) shared.push({ c: C.gcontact, v: j.id, old: "" });
      }
      const devices = [shared];
      const perDev = PER_DEVICE[dealKey(S.dirty.get("new:" + C.type))];
      if (S.multi) for (const x of S.extra) {
        if (!String(x[C.device] || "").trim()) continue;
        const own = perDev.filter(c => String(x[c] ?? "").trim() !== "").map(c => ({ c, v: x[c], old: "" }));
        const ownCols = new Set(own.map(o => o.c));
        // общее — всё, что не поле устройства; мастер «как у первого», если свой не выбран
        const base = shared.filter(ch => !perDev.includes(ch.c) || (ch.c === C.master && !ownCols.has(C.master)));
        devices.push([...base, ...own]);
      }
      const N = devices.length;
      const stNew = S.dirty.get("new:" + C.status) ?? CFG.newStatus, dkNew = dealKey(S.dirty.get("new:" + C.type));
      const noSum = devices.map((fields, i) => needSum(stNew, dkNew, c => fields.find(ch => ch.c === c)?.v ?? "") != null ? i + 1 : 0).filter(Boolean);
      if (noSum.length) {
        busy(false); refreshSaveBar("new");
        if (N === 1) return askSum(sumColFor(stNew, dkNew), `Со статусом «${stNew}» нужна сумма`);
        return toast(`Со статусом «${stNew}» нужна сумма у каждого устройства — нет у ${noSum.map(i => "№" + i).join(", ")}`, null, true);
      }
      let row0, num0;
      if (DEMO) {
        row0 = (S.rows.at(-1)?.row || 1) + 1; num0 = Math.max(0, ...S.rows.map(x => +cell(x, C.num) || 0)) + 1;
      }
      // Куда класть и какие номера. В таблице номера (A) и формула «Чистая работа» (R)
      // стоят ЗАРАНЕЕ — владелец протягивал их на сотни строк вперёд (26.09.2026: после
      // №7778 заготовки до №7996, формула до строки 7981). Заказ ложится в первую строку
      // ПОСЛЕ последнего заполненного заказа и берёт уже стоящий там номер; нет номера —
      // «наибольший в колонке + 1», как у onEdit в таблице (OrderAutofill.js).
      // Раньше (v3–v14) бралась строка после последнего номера — первый же заказ получил бы
      // №7997 за 218 заготовками. В v15 это исправили, но заготовка с формулой в R всё равно
      // считалась занятой строкой — первый живой заказ 26.09.2026 не сохранился
      // («Строки 7748–7749 не пустые»). Теперь формулы и снятые галочки строку не занимают.
      let slots;
      if (DEMO) {
        slots = devices.map((_, i) => ({ row: row0 + i, num: String(num0 + i), hasNum: false, hasMargin: true }));
      } else {
        const got = await api(`/values/${encodeURIComponent(`'${CFG.sheet}'!A2:H`)}`);
        const vals = got.values || [];
        let lastData = -1;
        vals.forEach((r, i) => { if ([C.name, C.phone, C.device, C.issue, C.status].some(c => String(r[c] ?? "").trim())) lastData = i; });
        let maxNum = Math.max(0, ...vals.map(r => +String(r[0] ?? "").trim() || 0));
        slots = [];
        for (let i = 0; i < N; i++) {
          const idx = lastData + 1 + i, a = String(vals[idx]?.[0] ?? "").trim();
          const has = !!(a && +a);
          slots.push({ row: idx + 2, num: has ? a : String(++maxNum), hasNum: has });
        }
        const r0 = slots[0].row, r1 = slots[N - 1].row;
        const probe = await api(`/values/${A1(1, r0, C.group, r1)}?valueRenderOption=FORMULA`)
          .catch(e => { throw /400/.test(e.message) ? new Error(`В листе закончились строки (нужна строка ${r1}) — добавьте строки внизу листа в таблице и повторите`) : e; });
        // Занята ли строка: формулы, снятые галочки и одинокая дата приёма (B) — не занятость.
        // 28.09.2026 в строке 7750 осталась только дата: заказ начали вводить в таблице и
        // стёрли, а дату (её ставит OrderAutofill) — нет; новый заказ не сохранялся вовсе.
        const busyCell = (v, i) => { const t = String(v ?? "").trim(); return i > 0 && t !== "" && !t.startsWith("=") && t.toUpperCase() !== "FALSE"; };
        const pv = probe.values || [];
        const busy = pv.flatMap((rw, k) => (rw || []).map((v, i) => busyCell(v, i) ? LETTER(i + 1) + (r0 + k) : null).filter(Boolean));
        if (busy.length) throw new Error(`Строка ${r0}${N > 1 ? "–" + r1 : ""} занята (${busy.slice(0, 4).join(", ")}) — проверьте её в таблице и повторите`);
        slots.forEach((s, i) => { s.hasMargin = String(pv[i]?.[C.labor - 1] ?? "").trim().startsWith("="); });
        num0 = +slots[0].num;
      }
      const head = slots[0].num;
      const made = devices.map((fields, i) => {
        const { num, row, hasNum, hasMargin } = slots[i];
        const list = [...(hasNum ? [] : [{ c: C.num, v: num }]), ...(N > 1 ? [{ c: C.group, v: head, old: "" }] : []), ...fields.filter(f => !F[f.c]?.calc).map(f => ({ ...f })),
          ...(hasMargin ? [] : [{ c: C.labor, v: `=Q${row}-S${row}-T${row}`, formula: true }])]
          .filter(ch => String(ch.v ?? "").trim() !== "" && !(S.bools.has(ch.c) && !isTrue(ch.v)));
        return { num, row, list };
      });
      await Promise.all(made.map(m => writeCells(m.row, m.list)));
      const skMsg = skOps.length ? await skWriteOff(made[0].num, skOps) : "";
      for (const m of made) {
        const cells = []; cells[C.num] = m.num; for (const ch of m.list) if (!ch.formula) cells[ch.c] = String(ch.w ?? "");
        m.rec = { row: m.row, cells }; index(m.rec); S.rows.push(m.rec); S.byNum.set(m.num, m.rec);
      }
      S.clients = null;
      for (const k of [...S.dirty.keys()]) if (k.startsWith("new:")) S.dirty.delete(k);
      S.draft = null; S.multi = false; S.extra = []; S.newStatusTouched = false; S.imp = null; S.parts.delete("new"); S.pp = null; S.newClient = null; store.del("crm.draft");
      location.hash = "#/" + made[0].num;
      const nums = N > 1 ? `Заказы №${made[0].num}–${made[N - 1].num}` : `Заказ №${made[0].num}`;
      const soldMsg = await markUsedSold(made).catch(() => " · ⚠️ в боте не отмечено «Продано»");
      S.goods = S.goods ? { ...S.goods, open: false, items: null } : null; // б/у в боте поменялся — перечитать при следующем открытии
      toast((DEMO ? nums + (N > 1 ? " созданы" : " создан") + " (демо)" : `${nums} записан${N > 1 ? "ы" : ""} ✓ Уведомления отправляются…`) + skMsg + soldMsg, null, true);
      // Двери по очереди, заказ за заказом — как если бы строки заполняли в таблице одну за другой.
      made.reduce((p, m) => p.then(() => doorInBackground(m.rec, m.num, m.list.filter(ch => ch.c !== C.num && !ch.formula))), Promise.resolve());
    } catch (e) { busy(false); toast(e.message, null, true); }
  }
  function busy(on) { const b = $app.querySelector('[data-act="save"]'); if (b) { b.disabled = on; if (on) b.textContent = "Сохраняю…"; } }

  // ── события ─────────────────────────────────────────────
  const curKey = () => location.hash === "#/new" ? "new" : S.byNum.get(location.hash.slice(2))?.row;
  const curVal = (key, c) => key === "new" ? "" : cell(S.byNum.get(location.hash.slice(2)), c);
  function setDirty(key, c, v) {
    const orig = curVal(key, c);
    const same = S.bools.has(c) ? isTrue(v) === isTrue(orig) : F[c]?.num ? toNum(v) === toNum(orig) && String(v).trim() !== "" : F[c]?.tel ? telNorm(v) === telNorm(orig) : String(v) === String(orig);
    const keepNew = key === "new" && [C.status, C.date, C.type].includes(c);
    if (same && !keepNew) S.dirty.delete(key + ":" + c); else S.dirty.set(key + ":" + c, v);
  }

  // Продление входа (v46, 05.10.2026). Владелец: «после простоя просит войти — выбрать сохранённый
  // аккаунт; не страшно, но напрягает». Токен Google живёт час, а продлить его без нажатия Google
  // странице не даёт (нужно действие человека — иначе окно заблокирует браузер). Раньше: за 5 минут
  // до конца или после — продление с выбором аккаунта, а тот же клик тем временем ловил 401 и
  // выкидывал на экран входа. Теперь: за 10 минут до конца ИЛИ после простоя первый же клик
  // продлевает вход ТИХО (prompt "none" + login_hint: окно мелькнёт и закроется без выбора), а
  // запросы этого клика ждут новый токен (api() ждёт `refreshing`). Не вышло тихо — как раньше,
  // экран «Продолжить как …».
  document.addEventListener("click", () => {
    const t = store.get("crm.tok");
    if (DEMO || !S.token || refreshing || !t || t.exp - Date.now() > 10 * 60e3 || !lastEmail()) return;
    refreshing = (sidGet() ? sidRefresh() : signIn("none", lastEmail()).catch(() => {})).finally(() => { refreshing = null; });
  }, true);
  // С долгим входом (v51) нажатие не нужно: за 5 минут до конца часа токен обновляется сам, и
  // после сна вкладки — сразу при возврате на неё.
  const sidTick = () => {
    const t = store.get("crm.tok");
    if (DEMO || !S.token || refreshing || !sidGet() || (t && t.exp - Date.now() > 5 * 60e3)) return;
    refreshing = sidRefresh().finally(() => { refreshing = null; });
  };
  setInterval(sidTick, 60e3);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sidTick(); });
  // Открытый список закрывается кликом мимо него и клавишей Escape.
  document.addEventListener("click", e => {
    if (S.ddOpen && !e.target.closest(".dd")) { S.ddOpen = null; const y = window.scrollY; render(); window.scrollTo(0, y); }
    if (S.lst && !e.target.closest(".lst")) { S.lst = null; const y = window.scrollY; render(); window.scrollTo(0, y); if (e.target.closest("[data-open]")) e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && (S.ddOpen || S.lst)) { S.ddOpen = null; S.lst = null; const y = window.scrollY; render(); window.scrollTo(0, y); } });
  // Элемент списка теперь <div role="button"> — Enter/пробел открывают заказ, как раньше у <button>.
  document.addEventListener("keydown", e => { const it = e.target.closest?.("[data-open][role=button]"); if (it && e.target === it && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = "#/" + it.dataset.open; } });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-open],[data-tab],[data-choice],[data-q],[data-imp],[data-tip],[data-svc],[data-svx],[data-cdev],[data-psup],[data-gpick]"); if (!t) return;
    if (t.dataset.cdev != null) { pickDevice(+t.dataset.cdev); return; }
    if (t.dataset.gpick != null) { if (!t.disabled) addGood(t.dataset.kind, +t.dataset.gpick); return; }
    if (t.dataset.act === "cmp") {
      const key = curKey(), i = +t.dataset.i;
      S.cmp = S.cmp?.key === key && S.cmp.i === i ? null : { key, i, q: "" };
      const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
    if (t.dataset.act === "cmppick") {
      const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), i = +t.dataset.i;
      if (t.dataset.k) { const x = skBind(key, r, i, t.dataset.k); if (x) toast(`📦 Со склада: ${skShort(x)}${skFrom(x)} — спишется при сохранении`); }
      else if (t.dataset.c) { applySupplier(key, r, i, t.dataset.s, +t.dataset.c); toast(`${t.dataset.s}: закупка ${money(+t.dataset.c)}${partsOf(key, r)[i]?.fromSvc ? " · итог пересчитан" : ""}`); }
      S.cmp = null; const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
    if (t.dataset.psup != null) {
      const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
      applySupplier(key, r, +t.dataset.psup, t.dataset.s, +t.dataset.c);
      const sk = skAuto(key, r, +t.dataset.psup, t.dataset.t);
      const y = window.scrollY; render(); window.scrollTo(0, y);
      toast(sk ? `📦 Со склада: ${skShort(sk)}${skFrom(sk)} — спишется при сохранении` : `${t.dataset.s}: закупка ${money(+t.dataset.c)}${partsOf(key, r)[+t.dataset.psup]?.fromSvc ? " · итог пересчитан" : ""}`);
      return;
    }
    if (t.dataset.imp != null) { takeImport(+t.dataset.imp); return; }
    if (t.dataset.tip != null) {
      const key = curKey(), c = +t.dataset.tip, box = $app.querySelector(`[data-edit="${c}"]`); if (key == null || !box) return;
      const p = t.dataset.text, v = hasPhrase(box.value, p) ? removePhrase(box.value, p) : addPhrase(box.value, p);
      box.value = v; setDirty(key, c, v); box.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c));
      t.closest(".tchips").querySelectorAll("[data-tip]").forEach(b => b.setAttribute("aria-pressed", String(hasPhrase(v, b.dataset.text))));
      refreshSaveBar(key); return;
    }
    if (t.dataset.svc != null) { const key = curKey(); addService(key, key === "new" ? null : S.byNum.get(location.hash.slice(2)), +t.dataset.svc); return; }
    if (t.dataset.svx != null) { const key = curKey(); addExtra(key, key === "new" ? null : S.byNum.get(location.hash.slice(2)), +t.dataset.svx); return; }
    if (t.dataset.q != null) { S.q = t.dataset.q; S.limit = 60; renderList(); return; }
    if (t.dataset.open) { location.hash = "#/" + t.dataset.open; return; }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.limit = 60; renderList(); return; }
    if (t.dataset.choice != null) {
      const key = curKey(), c = +t.dataset.choice;
      // Пустой тип и «Ремонт» — одно и то же: не считаем это изменением.
      const v = t.dataset.value, orig = curVal(key, c);
      if (c === C.type && key !== "new" && dealKey(v) === "repair" && dealKey(orig) === "repair") S.dirty.delete(key + ":" + c);
      else setDirty(key, c, v);
      if (c === C.status && key === "new") S.newStatusTouched = true;
      let miss = null;
      if (c === C.status) {
        const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
        const get = x => { const k = key + ":" + x; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, x) : ""); };
        miss = needSum(v, dealKey(get(C.type)), get);
        if (key === "new" && S.multi) miss = null;
      }
      if (t.closest(".dd") || t.classList.contains("btn--silent")) {
        S.ddOpen = null; const y = window.scrollY; render(); window.scrollTo(0, y);
        if (miss != null) askSum(miss, `Для «${v}» нужна сумма`, true);
        return;
      }
      if (miss != null) askSum(miss, `Для «${v}» нужна сумма`, true);
      if (c === C.type) {
        if (key === "new" && !S.newStatusTouched) S.dirty.set("new:" + C.status, TYPE_UI[dealKey(v)].start);
        const y = window.scrollY; render(); window.scrollTo(0, y); return; // подписи и поля меняются по типу
      }
      $app.querySelectorAll(`[data-choice="${c}"]`).forEach(b => b.setAttribute("aria-pressed", String(b === t)));
      refreshSaveBar(key); return;
    }
    const act = t.dataset.act;
    if (act?.startsWith("lst")) { await lstAct(act, t); return; }
    if (act?.startsWith("sk") && await stockClick(act, t)) return;
    if (act === "supreq") { await supplierRequest(t); return; }
    if (act === "longlogin") { try { await codeSignIn(lastEmail()); toast("🔐 Вход запомнен на 30 дней — без окон Google", null, true); } catch (e) { toast(e.message, null, true); } render(); return; }
    if (act === "dd") { const k = curKey() + ":" + t.dataset.c; S.ddOpen = S.ddOpen === k ? null : k; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
    if (act === "login") {
      // С подсказкой — сначала тихо (без выбора аккаунта). Google попросил подтверждения — следующее
      // нажатие откроет обычное окно (новое окно после неудачи браузер бы заблокировал).
      if (S.authOn && !inApp()) {
        try { await codeSignIn(t.dataset.hint || ""); S.error = ""; await load(); }
        catch (err) { S.authOn = false; S.error = err.message + " — следующая попытка обычным входом"; render(); }
        return;
      }
      const quiet = t.dataset.hint && !S.loginLoud;
      try { await signIn(t.dataset.hint ? (quiet ? "none" : "") : "select_account", t.dataset.hint); S.error = ""; S.loginLoud = false; await load(); }
      catch (err) { if (quiet) { S.loginLoud = true; S.error = "Google просит подтвердить вход — нажмите «Продолжить» ещё раз"; } else S.error = err.message; render(); }
    } else if (act === "logout") signOut();
    else if (act === "relogin") { const sid = sidGet(); if (sid) authPost("logout", { sid }).catch(() => {}); store.del("crm.sid"); store.del("crm.tok"); store.del("crm.who"); S.token = null; S.error = ""; S.rows = []; render(); }
    else if (act === "reload") { if (!DEMO && !S.token) render(); else if (location.hash === "#/sklad") { await loadStock(true); render(); } else load(); }
    else if (act === "delask" || act === "delno") { S.delAsk = act === "delask" ? curKey() : null; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "delyes") { t.disabled = true; t.textContent = "Удаляю…"; deleteOrder(location.hash.slice(2)); }
    else if (act === "view") { S.view = t.dataset.v; store.set("crm.view", S.view); renderList(); }
    else if (act === "more") { S.limit += 100; renderList(); }
    else if (act === "impopen" || act === "imprecent") { S.imp = { open: true, mode: "recent" }; loadImports([dayISO(1), dayISO(0)]); }
    else if (act === "impclose") { S.imp = { open: false }; render(); }
    else if (act === "multi") { S.multi = t.checked; if (S.multi && !S.extra.length) S.extra.push(blankDevice()); if (!S.multi) S.extra = []; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "adddev") { S.extra.push(blankDevice()); const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "rmdev") { S.extra.splice(+t.dataset.i, 1); if (!S.extra.length) S.multi = false; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "review") {
      const key = curKey(), r = S.byNum.get(location.hash.slice(2)), k = key + ":" + C.review;
      const on = !isTrue(S.dirty.has(k) ? S.dirty.get(k) : cell(r, C.review));
      setDirty(key, C.review, on);
      t.setAttribute("aria-pressed", String(on)); t.textContent = on ? "✓ Напомнить об отзыве" : "⭐ Напомнить об отзыве";
      refreshSaveBar(key);
    }
    else if (act === "teladd") {
      const c = +t.dataset.c, n = $app.querySelectorAll(`[data-edit="${c}"]`).length;
      t.insertAdjacentHTML("beforebegin", telRow(c, n, ""));
      t.textContent = "＋ ещё номер";
      t.previousElementSibling.querySelector("input")?.focus();
    }
    else if (act === "telrm") {
      const key = curKey(), c = +t.dataset.c; if (key == null) return;
      const field = t.closest(".field"); t.closest(".tel__row")?.remove();
      setDirty(key, c, telJoin(c)); field?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c)); refreshSaveBar(key);
      if ($app.querySelectorAll(`[data-edit="${c}"]`).length < 2) { const a = field?.querySelector("[data-act=teladd]"); if (a) a.textContent = "＋ второй номер"; }
    }
    else if (act === "gopen") loadGoods();
    else if (act === "greload") loadGoods(true);
    else if (act === "gclose") { if (S.goods) S.goods.open = false; rerenderKeep(); }
    else if (act === "gunpick") unpickGood(t.dataset.device);
    else if (act === "proxyon") { S.proxyOpen = curKey(); const y = window.scrollY; render(); window.scrollTo(0, y); $app.querySelector(`[data-edit="${C.contactName}"]`)?.focus({ preventScroll: true }); }
    else if (act === "resend") {
      const key = curKey(), r = S.byNum.get(location.hash.slice(2)); if (!r) return;
      if (S.dirty.has(key + ":" + C.status)) return toast("Статус изменён — он уйдёт при «Сохранить»");
      // Два нажатия: сообщение уходит клиенту, случайный тап ничего не должен отправить.
      if (!t.dataset.armed) { t.dataset.armed = "1"; t.textContent = "Точно отправить? Нажмите ещё раз"; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.outerHTML = resendBtn(r, cell(r, C.status)); } }, 5000); return; }
      t.disabled = true;
      // Несохранённые правки (обычно — только что вписанный номер на связи) — сначала в таблицу.
      if ([...S.dirty.keys()].some(k => k.startsWith(key + ":"))) {
        await save(String(cell(r, C.num)).trim());
        if ([...S.dirty.keys()].some(k => k.startsWith(key + ":"))) return; // не сохранилось — не шлём
      }
      resendStatus(r);
    }
    else if (act === "report") {
      const key = curKey(), r = S.byNum.get(location.hash.slice(2));
      const miss = reportNeedsSum(r, c => { const k = key + ":" + c; return S.dirty.has(k) ? S.dirty.get(k) : cell(r, c); });
      if (miss != null) { askSum(miss, "Отчёт клиенту без суммы не отправить"); return; }
      S.dirty.set(key + ":" + C.report, CFG.reportValue); t.textContent = "Отчёт уйдёт после «Сохранить»"; t.disabled = true; refreshSaveBar(key);
    }
    else if (act === "ppopen") { S.pp = { key: curKey(), open: true }; const y = window.scrollY; render(); window.scrollTo(0, y); Promise.all([loadServices(), loadSupplierPrices(), loadStock()]).then(() => { if (S.pp?.open) { const y2 = window.scrollY; render(); window.scrollTo(0, y2); } }); }
    else if (act === "newfor" || act === "warranty") { const r = S.byNum.get(location.hash.slice(2)); if (r) startNewFrom(r, act === "warranty"); }
    else if (act === "discunit") {
      const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)); if (key == null) return;
      S.discUnit = { ...(S.discUnit || {}), [key]: t.dataset.u };
      const inp = $app.querySelector("[data-disc]"); if (inp && inp.value.trim()) applyDiscount(key, r, inp.value, t.dataset.u);
      const y = window.scrollY; render(); window.scrollTo(0, y);
    }
    else if (act === "spellundo") {
      const el = spellFieldOf(t); if (!el) return;
      const at = +t.dataset.at, fix = t.dataset.fix;
      if (el.value.slice(at, at + fix.length) === fix) spellReplace(el, at, at + fix.length, t.dataset.w); else spellApply(el, fix, t.dataset.w);
      const keep = spellMine(); keep.add(t.dataset.w.toLowerCase().replace(/ё/g, "е")); store.set("crm.spell.keep", [...keep]);
      spellNote(el, `«${esc(t.dataset.w)}» больше не исправляю`);
    }
    else if (act === "spellfix" || act === "spellfixall") {
      const el = spellFieldOf(t); if (!el) return;
      const btns = act === "spellfixall" ? [...t.closest(".spellnote").querySelectorAll("[data-act=spellfix]")] : [t];
      for (const b of btns) spellApply(el, b.dataset.w, b.dataset.fix);
      btns.forEach(b => b.remove());
      if (!el.closest(".field")?.querySelector("[data-act=spellfix]")) spellNote(el, "");
    }
    else if (act === "tmore") { const c = +t.dataset.c; S.tipsOpen ||= new Set(); S.tipsOpen.has(c) ? S.tipsOpen.delete(c) : S.tipsOpen.add(c); const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "ppclose") { S.pp = null; const y = window.scrollY; render(); window.scrollTo(0, y); }
    else if (act === "addpart" || act === "rmpart") {
      const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), list = partsOf(key, r);
      if (act === "addpart") list.push({ name: "", src: "", cost: "" }); else { list.splice(+t.dataset.i, 1); if (!list.length) list.push({ name: "", src: "", cost: "" }); syncParts(key); }
      const y = window.scrollY; render(); window.scrollTo(0, y);
      if (act === "addpart") $app.querySelector(`[data-part="${list.length - 1}"][data-pf="name"]`)?.focus();
    }
    else if (act === "save") t.dataset.new ? create() : save(t.dataset.num);
    else if (act === "discard") { const key = curKey(); S.parts.delete(key); S.pp = null; for (const k of [...S.dirty.keys()]) if (k.startsWith(key + ":")) S.dirty.delete(k); if (key === "new") { S.draft = null; S.multi = false; S.extra = []; S.newStatusTouched = false; S.imp = null; S.newClient = null; S.gpicks = []; S.supSent = {}; store.del("crm.draft"); location.hash = ""; } else render(); }
  });
  function onEdit(e) {
    const t = e.target;
    if (t.dataset.skq != null) { skSet(t.dataset.skq, t.value); return; }
    if (t.dataset.act === "skbsel") return; // галочка «на возврат» — обработана кликом
    if (t.dataset.act === "skbaq") { clearTimeout(onEdit.ba); onEdit.ba = setTimeout(() => { if (S.skBadAdd) { S.skBadAdd.q = t.value; const pos = t.selectionStart, y = window.scrollY; render(); window.scrollTo(0, y); const q = $app.querySelector(".sk-ba__q"); if (q) { q.focus({ preventScroll: true }); q.setSelectionRange(pos, pos); } } }, 150); return; }
    if (t.dataset.skbq != null) { const x = S.stock?.byKey?.get(t.dataset.skbq), n = Math.floor(+t.value.replace(",", ".")) || 0; if (x && S.skSend.has(x.key)) { S.skSend.set(x.key, Math.max(1, Math.min(x.def, n || 1))); skSendLabel(); } return; }
    if (t.dataset.skf != null) { if (S.skAdd) S.skAdd.f[t.dataset.skf] = t.value; return; }
    if (t.dataset.act === "gq") { clearTimeout(onEdit.gq); onEdit.gq = setTimeout(() => { if (S.goods) { S.goods["q_" + t.dataset.kind] = t.value; rerenderKeep(); } }, 150); return; }
    if (t.dataset.act === "sksearch") {
      clearTimeout(onEdit.sk);
      onEdit.sk = setTimeout(() => { S.sk.q = t.value; S.sk.limit = 150; const pos = t.selectionStart; renderStock(); const s = $app.querySelector(".sk-q"); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }, 150);
      return;
    }
    if (t.dataset.act === "impdate") { if (t.value && e.type === "change") { S.imp = { open: true, mode: "date", date: t.value }; loadImports([t.value]); } return; }
    if (t.dataset.act === "search") {
      clearTimeout(onEdit.t);
      onEdit.t = setTimeout(() => { S.q = t.value; S.limit = 60; const pos = t.selectionStart; renderList(); const s = $app.querySelector(".search"); s.focus(); s.setSelectionRange(pos, pos); }, 120);
      return;
    }
    if (t.dataset.disc != null) {
      const key = curKey(); if (key == null) return;
      const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
      const cur = S.dirty.has(key + ":" + C.discount) ? S.dirty.get(key + ":" + C.discount) : curVal(key, C.discount);
      const unit = S.discUnit?.[key] || (parseDiscount(cur)?.pct != null ? "pct" : "rub");
      applyDiscount(key, r, t.value, unit);
      const q = $app.querySelector(`[data-edit="${C.total}"]`), qk = key + ":" + C.total;
      if (q) { const orig = curVal(key, C.total); q.value = S.dirty.has(qk) ? S.dirty.get(qk) : String(toNum(orig) ?? orig); q.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(qk)); }
      t.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + C.discount));
      const val = x => { const k = key + ":" + x; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, x) : ""); };
      const box = $app.querySelector(".margin"); if (box && !S.multi) box.innerHTML = moneySummary(dealKey(val(C.type)), val, r);
      refreshSaveBar(key); return;
    }
    if (t.dataset.act === "cmpq") {
      if (!S.cmp) return; S.cmp.q = t.value; const pos = t.selectionStart, y = window.scrollY;
      clearTimeout(onEdit.cq); onEdit.cq = setTimeout(() => { render(); window.scrollTo(0, y); const q = $app.querySelector(".cmp__q"); if (q) { q.focus({ preventScroll: true }); q.setSelectionRange(pos, pos); } }, 150);
      return;
    }
    if (t.dataset.act === "ppq") {
      if (!S.pp) return; S.pp.q = t.value; const pos = t.selectionStart, y = window.scrollY;
      clearTimeout(onEdit.pq); onEdit.pq = setTimeout(() => { render(); window.scrollTo(0, y); const q = $app.querySelector(".pp__q"); if (q) { q.focus({ preventScroll: true }); q.setSelectionRange(pos, pos); } }, 150);
      return;
    }
    if (t.dataset.act === "ppdev") { if (e.type === "change" && S.pp) { S.pp.dev = t.value; const y = window.scrollY; render(); window.scrollTo(0, y); } return; }
    if (t.dataset.part != null) {
      const key = curKey(); if (key == null) return;
      const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
      partsOf(key, r)[+t.dataset.part][t.dataset.pf] = t.value;
      if (t.dataset.pf === "src") { const pp = partsOf(key, r)[+t.dataset.part]; if (pp.stock && !skSrcMatch(t.value, S.stock?.byKey?.get(pp.stock))) delete pp.stock; }
      if (t.dataset.pf === "src" && S.supp?.map) {
        const p = partsOf(key, r)[+t.dataset.part], m = partMeta(p, key, r);
        const hit = m.dev && m.op ? supplierOffers(m.dev, m.op, m.variant).find(x => norm(x.s) === norm(t.value)) : null;
        if (hit && String(hit.c) !== String(p.cost)) {
          applySupplier(key, r, +t.dataset.part, hit.s, hit.c);
          const sk = skAuto(key, r, +t.dataset.part, hit.t);
          const y = window.scrollY; render(); window.scrollTo(0, y);
          if (sk) toast(`📦 Со склада: ${skShort(sk)}${skFrom(sk)} — спишется при сохранении`);
          return;
        }
      }
      syncParts(key);
      const { S: sum } = composeParts(S.parts.get(key));
      const note = $app.querySelector("[data-parts-note]"); if (note && sum != null) note.innerHTML = `Закупка всего: <b>${money(sum)}</b>`;
      const ro = $app.querySelector("[data-parts-sum]"); if (ro && sum != null) ro.textContent = money(sum);
      const val = x => { const k = key + ":" + x; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, x) : ""); };
      const box = $app.querySelector(".margin"); if (box && !S.multi) box.innerHTML = moneySummary(dealKey(val(C.type)), val, r);
      refreshSaveBar(key); return;
    }
    if (e.type === "change" && (t.dataset.edit === String(C.device) || (t.dataset.extra != null && t.dataset.col === String(C.device)))) {
      const sp = splitDeviceSerial_(t.value);
      if (sp && sp.rest !== t.value) {
        t.value = sp.rest;
        if (t.dataset.extra != null) { const x = S.extra[+t.dataset.extra]; x[C.device] = sp.rest; if (sp.ad) x[C.imei] = mergeSerials_(x[C.imei], sp.ad); }
        else {
          const key = curKey(), r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), k = key + ":" + C.imei;
          setDirty(key, C.device, sp.rest);
          if (sp.ad) setDirty(key, C.imei, mergeSerials_(S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, C.imei) : ""), sp.ad));
        }
        const y = window.scrollY; render(); window.scrollTo(0, y);
        if (sp.ad) toast("IMEI / S\\N перенесён в своё поле: " + sp.ad, null, true);
        return;
      }
    }
    if (t.dataset.extra != null) {
      S.extra[+t.dataset.extra][+t.dataset.col] = t.value;
      refreshSaveBar("new");
      const box = $app.querySelector(".margin"); if (box && S.multi) box.innerHTML = groupMoneySummary(dealKey(S.dirty.get("new:" + C.type)));
      return;
    }
    if (t.dataset.edit == null) return;
    const key = curKey(); if (key == null) return;
    const c = +t.dataset.edit, v = t.type === "checkbox" ? t.checked : F[c]?.tel ? telJoin(c) : t.value;
    setDirty(key, c, v);
    t.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c));
    t.closest(".field")?.classList.remove("is-need");
    if (c === C.issue || c === C.work) t.closest(".field")?.parentElement?.querySelectorAll(".tchips [data-tip]").forEach(b => b.setAttribute("aria-pressed", String(hasPhrase(v, b.dataset.text))));
    if (t.type === "checkbox") t.nextElementSibling.textContent = t.checked ? "Да" : "Нет";
    refreshSaveBar(key);
    if (key === "new" && (c === C.name || c === C.phone)) {
      clearTimeout(onEdit.ac); onEdit.ac = setTimeout(() => suggest(c, t.value), 120);
      if (c === C.phone && S.newClient) { const cl = clients().find(x => x.key === S.newClient), ds = phones(t.value).map(p => p.d);
        if (cl && ds.length && !ds.some(d => cl.phones.has(d))) { S.newClient = null; const b = document.getElementById("client-devs"); if (b) b.innerHTML = clientDevicesHtml(currentNewClient()); } }
    }
    if (c === C.contactName || c === C.contactPhone) { clearTimeout(onEdit.px); onEdit.px = setTimeout(() => suggestProxy(key, c, t.value), 120); }
    if (key === "new" && S.multi && F[c]?.num) { const box = $app.querySelector(".margin"); if (box) box.innerHTML = groupMoneySummary(dealKey(S.dirty.get("new:" + C.type))); }
    else if (F[c]?.num || c === C.linked) {
      const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
      const val = x => { const k = key + ":" + x; return S.dirty.has(k) ? S.dirty.get(k) : (r ? cell(r, x) : ""); };
      const box = $app.querySelector(".margin"); if (box) box.innerHTML = moneySummary(dealKey(val(C.type)), val, r);
    }
  }
  // ── Google-контакт заранее (v45, 03.10.2026) ───────────────────────────────────────
  // Владелец: «новый заказ — в WhatsApp у меня „Неизвестный пользователь“: синхронизация Google с
  // айфоном не успела. Раньше через таблицу контакт успевал создаться до отправки статуса». С v44
  // сообщение уходит первым, а контакт рабочая дверь заводила следом. Теперь — как только в новом
  // заказе есть имя и правильный номер и человек ушёл из поля: к «Сохранить» контакт уже в книге
  // ironsapple и успевает доехать до телефона. Дверь — только рабочая (CrmDoor.js, crm-contact).
  // При сохранении его ID ложится в X, и onEditTrigger обновляет этот контакт, а не ищет его заново.
  function preSig() {
    const name = String(S.dirty.get("new:" + C.name) || "").split("\n")[0].trim(), ph = phones(S.dirty.get("new:" + C.phone));
    if (!/[a-zа-яё]/i.test(name) || !ph.length || ph.some(p => p.d.length < 11)) return null;
    return { sig: norm(name) + "|" + ph.map(p => p.d).join(","), name, phone: ph.map(p => p.text).join("\n") };
  }
  function precontact() {
    if (DEMO || !CFG.doors[0] || !S.token || location.hash !== "#/new") return;
    const x = preSig(); if (!x || S.pre?.sig === x.sig) return;
    const pre = S.pre = { sig: x.sig, state: "wait" };
    pre.promise = fetch(CFG.doors[0] + "?action=crm-contact", { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: S.token, name: x.name, phone: x.phone }) })
      .then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return { ok: false, error: (t.match(/Exception:[^<]{0,120}/) || [])[0] || "дверь ответила не JSON" }; } })
      .catch(e => ({ ok: false, error: e.message }))
      .then(j => { Object.assign(pre, { state: j.ok ? "ok" : "err", id: j.id || "", existed: !!j.existed, err: j.error || "" }); if (S.pre === pre) preNote(); return j; });
    preNote();
  }
  function preNoteText() {
    const p = S.pre, x = preSig();
    if (!p || !x || p.sig !== x.sig) return "";
    return p.state === "wait" ? "📇 Заводим контакт в Google…" : p.state === "ok"
      ? (p.existed ? "📇 Контакт с этим номером уже есть в Google" : "📇 Контакт заведён в Google — успеет попасть в телефон до отправки")
      : `📇 Контакт заранее не завёлся (${esc(p.err)}) — заведётся при сохранении`;
  }
  function preNote() { const el = document.getElementById("pre-contact"); if (el) el.innerHTML = preNoteText(); }
  // Ушли из поля имени или телефона нового заказа — пора заводить контакт.
  document.addEventListener("change", e => {
    const c = +e.target.dataset?.edit;
    if ((c === C.name || c === C.phone) && curKey() === "new") precontact();
  });

  // ── подсказки клиента в новом заказе ─────────────────────
  // Набрал 3+ буквы имени или фамилии (или 4+ цифры телефона) — список клиентов из базы.
  // Выбрал клиента: один телефон — подставился сам; несколько — выбираешь номер вторым шагом.
  function suggest(c, value) {
    const box = document.getElementById("ac-" + c); if (!box) return;
    const list = findClients(value);
    box.innerHTML = list.map(cl => {
      const p = phonesOf(cl);
      return `<button type="button" class="ac-item" data-client="${esc(cl.key)}" data-from="${c}"><b>${esc(cl.name)}${cl.aka.length ? ` <small>(также: ${esc(cl.aka.slice(0, 2).join(", "))}${cl.aka.length > 2 ? "…" : ""})</small>` : ""}</b>
        <span>${cl.count} ${ordersWord(cl.count)} · ${p.length > 1 ? p.length + " телефона" : esc(p[0]?.text || "без телефона")} · последний: ${esc(cell(cl.last, C.device) || "—")}, ${esc(String(cell(cl.last, C.date)).slice(0, 10))}</span></button>`;
    }).join("");
  }
  function fillField(c, v) {
    if (F[c]?.tel) telSet(c, v);
    const inp = $app.querySelector(`[data-edit="${c}"]`); if (inp) inp.value = v;
    setDirty("new", c, v); inp?.closest(".field")?.classList.add("is-dirty");
  }
  function pickClient(key, fromPhone) {
    const cl = clients().find(x => x.key === key); if (!cl) return;
    S.newClient = cl.key;
    fillField(C.name, cl.name);
    const ps = phonesOf(cl), typed = normDigits(digits($app.querySelector(`[data-edit="${C.phone}"]`)?.value || ""));
    const byTyped = fromPhone && typed.length >= 4 ? ps.find(p => p.d.includes(typed)) : null;
    const nameBox = document.getElementById("ac-" + C.name), phoneBox = document.getElementById("ac-" + C.phone);
    nameBox.innerHTML = ""; // «был у нас N заказов» и устройства — в блоке #client-devs ниже
    if (byTyped || ps.length === 1) { fillField(C.phone, (byTyped || ps[0]).text); phoneBox.innerHTML = ""; }
    else if (ps.length > 1) phoneBox.innerHTML = `<div class="ac-info">У клиента ${ps.length} телефона — выберите:</div>` +
      ps.map(p => `<button type="button" class="ac-item" data-phone="${esc(p.text)}"><b>📞 ${esc(p.text)}</b><span>последний раз ${esc(String(p.date).slice(0, 10))}</span></button>`).join("");
    const box = document.getElementById("client-devs"); if (box) box.innerHTML = clientDevicesHtml(cl);
    refreshSaveBar("new");
    precontact();
  }
  // ── подсказки «на связи» (v41, 03.10.2026) ─────────────────────────────────────────
  // Владелец: «пытаюсь добавить человека для связи в готовом заказе — не выдаёт список поиска».
  // В v40 подсказки были только у имени и телефона клиента в НОВОМ заказе. Теперь у обоих полей
  // «на связи» в любом заказе: клиенты из базы (та же книга, что у нового заказа) и люди, которые
  // уже бывали «на связи» в других заказах (они могут и не быть клиентами). Самого владельца
  // заказа не предлагаем. Выбор заполняет и имя, и телефон; у клиента несколько номеров — вторым шагом.
  function pastContacts(q) {
    const isD = isDigitQuery(q), d = normDigits(digits(q)), tokens = norm(q).split(" ").filter(Boolean);
    if (isD ? d.length < 4 : tokens.join("").length < 3) return [];
    const seen = new Map();
    for (let i = S.rows.length - 1; i >= 0; i--) {
      const r = S.rows[i], ps = phones(cell(r, C.contactPhone)); if (!ps.length) continue;
      const name = String(cell(r, C.contactName)).trim(), words = norm(name).split(" ");
      const hit = isD ? ps.some(p => p.d.includes(d)) : tokens.every(t => words.some(w => w.startsWith(t)));
      if (hit && !seen.has(ps[0].d)) seen.set(ps[0].d, { name, phone: ps[0].text, d: ps[0].d, num: cell(r, C.num), owner: String(cell(r, C.name)).split("\n")[0] });
    }
    return [...seen.values()].slice(0, 5);
  }
  function suggestProxy(key, c, value) {
    const box = document.getElementById("ac-" + c); if (!box) return;
    const r = key === "new" ? null : S.byNum.get(location.hash.slice(2));
    const own = new Set(phones(r ? cell(r, C.phone) : S.dirty.get("new:" + C.phone)).map(p => p.d));
    const cls = findClients(value).filter(cl => ![...cl.phones.keys()].some(d => own.has(d)));
    const known = new Set(cls.flatMap(cl => [...cl.phones.keys()]));
    const past = pastContacts(value).filter(x => !known.has(x.d) && !own.has(x.d));
    box.innerHTML = cls.map(cl => {
      const p = phonesOf(cl);
      return `<button type="button" class="ac-item" data-pxclient="${esc(cl.key)}" data-from="${c}"><b>${esc(cl.name)}</b>
        <span>клиент · ${cl.count} ${ordersWord(cl.count)} · ${p.length > 1 ? p.length + " телефона" : esc(p[0]?.text || "без телефона")}</span></button>`;
    }).join("") + past.map(x => `<button type="button" class="ac-item" data-pxname="${esc(x.name)}" data-pxphone="${esc(x.phone)}"><b>${esc(x.name || x.phone)}</b>
        <span>был на связи в №${esc(x.num)}${x.owner ? " (за " + esc(x.owner) + ")" : ""} · ${esc(x.phone)}</span></button>`).join("");
  }
  function fillFor(key, c, v) {
    if (F[c]?.tel) telSet(c, v);
    const inp = $app.querySelector(`[data-edit="${c}"]`); if (inp) inp.value = v;
    setDirty(key, c, v); inp?.closest(".field")?.classList.toggle("is-dirty", S.dirty.has(key + ":" + c));
  }
  function pickProxy(it) {
    const key = curKey(); if (key == null) return;
    const clear = () => [C.contactName, C.contactPhone].forEach(c => { const b = document.getElementById("ac-" + c); if (b) b.innerHTML = ""; });
    if (it.dataset.pxclient) {
      const cl = clients().find(x => x.key === it.dataset.pxclient); if (!cl) return;
      fillFor(key, C.contactName, cl.name);
      const ps = phonesOf(cl), typed = normDigits(digits($app.querySelector(`[data-edit="${C.contactPhone}"]`)?.value || ""));
      const byTyped = it.dataset.from === String(C.contactPhone) && typed.length >= 4 ? ps.find(p => p.d.includes(typed)) : null;
      clear();
      if (byTyped || ps.length === 1) fillFor(key, C.contactPhone, (byTyped || ps[0]).text);
      else if (ps.length > 1) document.getElementById("ac-" + C.contactPhone).innerHTML = `<div class="ac-info">У ${esc(cl.name)} ${ps.length} телефона — выберите:</div>` +
        ps.map(p => `<button type="button" class="ac-item" data-pxphone="${esc(p.text)}"><b>📞 ${esc(p.text)}</b><span>последний раз ${esc(String(p.date).slice(0, 10))}</span></button>`).join("");
    } else {
      if (it.dataset.pxname != null && it.dataset.pxname !== "") fillFor(key, C.contactName, it.dataset.pxname);
      fillFor(key, C.contactPhone, it.dataset.pxphone);
      clear();
    }
    refreshSaveBar(key);
  }
  // pointerdown, а не click: иначе поле теряет фокус раньше, чем выбор успевает сработать.
  document.addEventListener("pointerdown", e => {
    const it = e.target.closest(".ac-item"); if (!it) return;
    e.preventDefault();
    if (it.dataset.pxclient || it.dataset.pxphone) return pickProxy(it);
    if (it.dataset.client) pickClient(it.dataset.client, it.dataset.from === String(C.phone));
    else if (it.dataset.phone) { fillField(C.phone, it.dataset.phone); document.getElementById("ac-" + C.phone).innerHTML = ""; refreshSaveBar("new"); }
  });
  document.addEventListener("input", onEdit);
  // Форма своей позиции: поставщика вписали руками — перерисовать подписи (донор → «с какого
  // устройства», Виталя → «попадёт в его таблицу») и подсветку кнопок.
  document.addEventListener("change", e => {
    if (e.target.dataset.skf !== "src" || !S.skAdd) return;
    setTimeout(() => { const y = window.scrollY; const a = document.activeElement?.dataset?.skf; render(); window.scrollTo(0, y); if (a) $app.querySelector(`#sk-add [data-skf="${a}"]`)?.focus({ preventScroll: true }); }, 0);
  });
  // Поставщика вписали руками (или выбрали из подсказок) и ушли из поля: если это Виталя —
  // показать, что есть на складе, а единственную подходящую позицию взять сразу.
  document.addEventListener("change", e => {
    const t = e.target; if (t.dataset.pf !== "src" || t.dataset.part == null || !S.stock?.rows) return;
    const key = curKey(); if (key == null) return;
    const r = key === "new" ? null : S.byNum.get(location.hash.slice(2)), i = +t.dataset.part, p = partsOf(key, r)[i];
    if (!p || !norm(p.src)) return;
    const x = p.stock ? null : skAuto(key, r, i, null);
    // Перерисовка — после того, как фокус ушёл в следующее поле, и с возвратом фокуса туда.
    setTimeout(() => {
      const a = document.activeElement, d = a?.dataset || {};
      const sel = d.part != null ? `[data-part="${d.part}"][data-pf="${d.pf}"]` : d.edit != null ? `[data-edit="${d.edit}"]` : null;
      const y = window.scrollY; render(); window.scrollTo(0, y);
      if (sel) $app.querySelector(sel)?.focus({ preventScroll: true });
      if (x) toast(`📦 Со склада: ${skShort(x)}${skFrom(x)} — спишется при сохранении`);
    }, 0);
  });
  document.addEventListener("change", e => { if ((e.target.tagName === "SELECT" || e.target.type === "checkbox" || e.target.dataset.act === "impdate" || e.target.dataset.edit === String(C.device) || (e.target.dataset.extra != null && e.target.dataset.col === String(C.device))) && e.target.dataset.act !== "multi") onEdit(e); });
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  window.addEventListener("beforeunload", e => { if (S.pendingDoors > 0 || S.skDirty.size || [...S.dirty.keys()].some(k => !k.startsWith("new:"))) { e.preventDefault(); e.returnValue = ""; } });
  // Новая версия на сайте. GitHub Pages отдаёт страницу с кэшем на 10 минут, и 28.09.2026
  // владелец полчаса смотрел прошлую версию, решив, что правка не работает. Раз в 10 минут
  // (и при возврате на вкладку) сверяем номер версии в свежей странице с нашим.
  const VERSION = +(document.querySelector('script[src*="crm.js"]')?.src.match(/v=(\d+)/)?.[1] || 0);
  async function checkUpdate() {
    if (!VERSION) return;
    try {
      const html = await fetch(location.pathname + "?nocache=" + Date.now(), { cache: "no-store" }).then(r => r.text());
      const v = +(html.match(/crm\.js\?v=(\d+)/)?.[1] || 0);
      if (v > VERSION && !(S.pendingDoors > 0)) toast(`Вышла новая версия оболочки (v${v})`, { label: "Обновить", run: () => S.pendingDoors > 0 ? toast("Подождите — ещё отправляются уведомления клиенту") : location.reload() });
    } catch {}
  }
  setInterval(checkUpdate, 600e3); setTimeout(checkUpdate, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkUpdate();
    if (document.visibilityState === "visible" && S.rows.length && Date.now() - S.loadedAt > 120e3 && !S.dirty.size && !location.hash.startsWith("#/")) load();
  });

  // ── старт ───────────────────────────────────────────────
  S.view = store.get("crm.view") || "cards"; // вид списка помнится на устройстве
  Object.assign(S.sk, store.get("crm.sk") || {}); // фильтры склада — тоже
  const t = saved();
  if (t) S.token = t.t;
  // Долгий вход: включён ли в боте (секрет OAuth-клиента задан). Запоминается, чтобы кнопка входа
  // знала сразу; ответ бота поправляет.
  S.authOn = !!store.get("crm.lg");
  if (!DEMO) fetch(`${CFG.botAuth}/status`).then(r => r.json()).then(x => { const on = !!x.enabled; store.set("crm.lg", on); if (on !== S.authOn) { S.authOn = on; if (!location.hash.startsWith("#/n")) render(); } }).catch(() => {});
  if (DEMO || S.token) load();
  else if (sidGet()) { S.loading = true; render(); sidRefresh().then(ok => { S.loading = false; ok ? load() : render(); }); }
  else render();
})();
