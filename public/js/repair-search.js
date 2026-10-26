/**
 * Интерактивный поиск стоимости ремонта на uslugi.html.
 *
 * Данные — /data/services.json, тот же файл, что читает бот
 * (@IRON_SERVICE_ORDER_bot). Он генерируется scripts/build_services.py в
 * репозитории автоматизации, поэтому цена на сайте и в боте не расходится.
 *
 * Клиенту показывается ОДНА цифра: запчасть вместе с работой. Служебные поля
 * (part_cost, part_retail) в разметку не попадают.
 */
(function () {
  "use strict";

  var root = document.getElementById("repair-search");
  if (!root) return;

  // ── Язык (добавлено 17.08.2026) ───────────────────────────────────────────
  // Английская версия страницы услуг показывает ТОТ ЖЕ прайс: цены, модели и
  // наличие берутся из общего services.json, переводятся только термины —
  // словарём из data/i18n/services.en.json. Второй копии данных нет намеренно:
  // прайс перезаписывается генератором при каждом обновлении цен, и копия
  // разъехалась бы с оригиналом в первый же день.
  //
  // Если в прайсе появится операция, которой нет в словаре, показывается её
  // русское название — выдача не ломается, просто одна подпись остаётся
  // русской. Это осознанный компромисс: молчаливо пропасть строка не должна.
  var EN = (document.documentElement.lang || "ru").slice(0, 2) === "en";
  var DICT = null; // словарь подгружается вместе с прайсом

  /** UI-строка: t("loading") → «Загружаем прайс…» либо перевод. */
  function t(key, ru, params) {
    var s = (EN && DICT && DICT.ui && DICT.ui[key]) || ru;
    if (params) {
      Object.keys(params).forEach(function (p) {
        s = s.replace(new RegExp("\\{" + p + "\\}", "g"), params[p]);
      });
    }
    return s;
  }

  /**
   * Подпись варианта запчасти. В прайсе это свободная строка, часто с русскими
   * пояснениями («с привязкой, без ошибки»). Сначала пробуем перевести строку
   * целиком, потом — по кускам; не вышло ни то ни другое, показываем как есть.
   * Русская версия проходит по тому же пути и получает прежнюю чистку префиксов.
   */
  function variantLabel(raw) {
    var text = String(raw || "").replace(/^АКБ\s*/i, "").replace(/статус\s*/i, "").trim();
    if (!EN || !DICT || !DICT.variants) return text;
    var full = String(raw || "").trim();
    if (DICT.variants.exact && DICT.variants.exact[full]) return DICT.variants.exact[full];
    if (DICT.variants.exact && DICT.variants.exact[text]) return DICT.variants.exact[text];
    var frags = DICT.variants.fragments || {};
    var out = text;
    Object.keys(frags).forEach(function (ru) {
      out = out.replace(new RegExp(ru.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), frags[ru]);
    });
    return out.replace(/\s*,\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
  }

  /**
   * Название модели. Почти все на латинице, но три записи в прайсе русские
   * («Ноутбук (другой марки)», «Смартфон Android», «iMac 24" M1 и новее») —
   * они и вылезали на английской странице (18.08.2026).
   */
  function deviceName(device) {
    if (EN && DICT && DICT.devices && DICT.devices[device]) return DICT.devices[device];
    return device;
  }

  /** Полное название операции для заголовка карточки. */
  function opName(operation) {
    if (EN && DICT && DICT.operations && DICT.operations[operation]) return DICT.operations[operation];
    return operation;
  }

  var input = root.querySelector(".rs-input");
  var results = root.querySelector(".rs-results");
  var status = root.querySelector(".rs-status");

  var deviceSelect = root.querySelector(".rs-device");

  // ── Подбор «как в Новой технике» (26.10.2026) ─────────────────────────────
  // Владелец: «сделай меню и фильтры в услугах ремонта по такому же принципу, как в новой технике». До этого
  // здесь были красные чипы семей, лента из ~30 видов работ без чисел и модель отдельным списком внизу, а выдача
  // молча обрезалась на 40 карточках. Теперь устройство то же, что у магазина (prices.js, план 27 §14–15):
  // строка поиска с «Моделью» и сортировкой → группы плитками со значками и числами → второй уровень (поколение
  // iPhone, Air/Pro, конкретная техника группы) → «Что нужно сделать» с числами, нулевые скрыты, длинный ряд
  // свёрнут в «Ещё N» → над списком «Найдено N» и выбранные фильтры с ×. Классы — магазинные (.shop-group,
  // .shop-cat, .shop-applied из css/shop.css), чтобы два каталога не разъехались при правке стилей.
  // Состояние в адресе: uslugi.html?g=iphone&s=15&op=замена дисплея&m=iPhone 15&sort=asc&q=… (replaceState).
  var panel = root.querySelector(".rs-panel");
  panel.classList.add("rs-panel--shop");
  var toolbar = document.createElement("div");
  toolbar.className = "rs-toolbar";
  toolbar.appendChild(root.querySelector(".rs-field"));
  toolbar.appendChild(deviceSelect);
  var sortSelect = document.createElement("select");
  sortSelect.className = "rs-sort";
  sortSelect.setAttribute("aria-label", EN ? "Sorting" : "Сортировка");
  toolbar.appendChild(sortSelect);
  var groupsNav = document.createElement("nav");
  groupsNav.className = "shop-groups rs-groups";
  groupsNav.setAttribute("aria-label", EN ? "Devices" : "Техника");
  var subRow = document.createElement("div");
  subRow.className = "shop-cats rs-subs";
  var opsBox = document.createElement("div");
  opsBox.className = "rs-ops";
  var opsLabel = document.createElement("span");
  opsLabel.className = "rs-ops__label";
  var opChips = document.createElement("div");
  opChips.className = "shop-cats rs-ops__list";
  opsBox.appendChild(opsLabel);
  opsBox.appendChild(opChips);
  panel.innerHTML = "";
  [toolbar, groupsNav, subRow, opsBox, status].forEach(function (el) { panel.appendChild(el); });
  var applied = document.createElement("div");
  applied.className = "shop-applied rs-applied";
  applied.setAttribute("aria-live", "polite");
  root.querySelector(".rs-layout").insertAdjacentElement("beforebegin", applied);

  var GROUPS = [
    { id: "all", ru: "Все услуги", en: "All services", hintRu: "весь прайс", hintEn: "full price list", icon: "all", fams: null },
    { id: "iphone", ru: "iPhone", en: "iPhone", hintRu: "от 7 до 17 Pro Max", hintEn: "7 to 17 Pro Max", icon: "phone", fams: ["iphone"] },
    { id: "mac", ru: "MacBook", en: "MacBook", hintRu: "Air и Pro", hintEn: "Air and Pro", icon: "laptop", fams: ["mac"] },
    { id: "desk", ru: "Компьютеры", en: "Desktops", hintRu: "iMac, Mac mini, ПК", hintEn: "iMac, Mac mini, PC", icon: "desktop", fams: ["imac", "macmini", "desktop"] },
    { id: "small", ru: "iPad и часы", en: "iPad & Watch", hintRu: "iPad, Watch, AirPods", hintEn: "iPad, Watch, AirPods", icon: "watch", fams: ["ipad", "watch", "airpods"] },
    { id: "other", ru: "Другая техника", en: "Other devices", hintRu: "Android, ноутбуки Windows", hintEn: "Android, Windows laptops", icon: "android", fams: ["android", "laptop"] }
  ];
  var ICONS = {
    all: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.4"/><path d="M10.5 5.3h3"/><circle cx="12" cy="18.2" r=".6"/>',
    laptop: '<rect x="4.5" y="4.5" width="15" height="10.5" rx="1.4"/><path d="M2.5 18.5h19l-1.5-3.5h-16z"/>',
    desktop: '<rect x="2.5" y="3.5" width="19" height="13" rx="1.6"/><path d="M9 20.5h6M12 16.5v4"/>',
    watch: '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9 6.5l.7-3.5h4.6l.7 3.5M9 17.5l.7 3.5h4.6l.7-3.5"/>',
    android: '<rect x="5.5" y="2.5" width="13" height="19" rx="2"/><path d="M5.5 6h13M5.5 18h13"/><circle cx="12" cy="4.3" r=".5"/>'
  };
  var activeGroup = "all";
  var activeSub = "";
  var sortMode = "default";
  var opsExpanded = false;
  var PAGE = 40;
  var shown = PAGE;
  var OPS_VISIBLE = 10;
  // Порядок «Что нужно сделать»: сначала то, с чем чаще приходят, служебные работы (диагностика, ПО, перенос
  // данных) — в конце. По одному числу карточек первыми вставали «установка ПО» и «диагностика»: они есть у
  // каждой модели, а ищут их реже всего.
  var OPS_FIRST = ["замена дисплея", "замена аккумулятора", "замена заднего стекла", "переклейка стекла дисплея",
    "замена камеры", "замена стекла камеры", "замена разъёма зарядки", "замена нижнего шлейфа", "замена динамика",
    "ремонт после залития", "замена корпуса", "замена матрицы без крышки", "замена клавиатуры", "замена тачпада",
    "профилактика", "замена накопителя (SSD)", "ремонт платы", "замена шлейфа", "замена сенсора"];
  var OPS_LAST = ["диагностика", "установка ПО", "перенос данных"];
  var cartBox = root.querySelector(".rs-cart");
  var cartList = root.querySelector(".rs-cart-list");
  var cartTotal = root.querySelector(".rs-cart-total");
  var cartNote = root.querySelector(".rs-cart-note");
  // Корзина услуг теперь выглядит и ведёт себя как корзина магазина (просьба
  // владельца 18.08.2026): счётчик в заголовке, панель и плашка снизу на
  // телефоне. Элементы плашки лежат вне #repair-search — она прижата к низу
  // экрана, поэтому ищем их по документу.
  var cartCount = root.querySelector(".rs-cart-count");
  var cartBar = document.querySelector(".rs-cart-bar");
  var cartCountMobile = document.querySelector(".rs-cart-count-mobile");
  var cartTotalMobile = document.querySelector(".rs-cart-total-mobile");
  var cartToggle = document.querySelector(".rs-cart-toggle");
  var cartClose = root.querySelector(".rs-cart-close");

  var services = [];
  var families = [];
  var quality = null;
  var activeOperation = "";
  var activeDevice = "";
  var cart = [];

  function money(n) {
    // Валюта одна — рубли: платят на месте. Меняется только разделитель
    // разрядов, чтобы «4 100 ₽» не выглядело для иностранца опечаткой.
    return Number(n).toLocaleString(EN ? "en-US" : "ru-RU") + " \u20BD";
  }

  function priceText(s) {
    if (s.price_is_from) return t("from", "от ") + money(s.price);
    if (s.price_to && s.price_to !== s.price) return money(s.price) + " — " + money(s.price_to);
    return money(s.price);
  }

  // Пишут «13про», «эйр м1», «айфон 15» — сводим к латинице, как в прайсе.
  function normalize(text) {
    var s = " " + String(text || "").toLowerCase().replace(/ё/g, "е")
      .replace(/(\d)([a-zа-я])/g, "$1 $2")
      .replace(/([a-zа-я])(\d)/g, function (full, letter, digit) {
        return /[mм]/.test(letter) ? full : letter + " " + digit;
      })
      .replace(/[^a-zа-я0-9]+/g, " ").trim() + " ";
    var map = [
      [/ (?:айфон|iphone) /g, " iphone "],
      [/ (?:макбук|мак бук|macbook) /g, " macbook "],
      [/ про макс | pro max /g, " pro max "],
      [/ (?:эйр|эир|air) /g, " air "],
      [/ (?:про|pro) /g, " pro "],
      [/ (?:макс|max) /g, " max "],
      [/ м([1-5]) /g, " m$1 "],
      // «iphone15» и «13pro» англичанин пишет слитно так же, как русский.
      [/ mac book /g, " macbook "]
    ];
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < map.length; i++) s = s.replace(map[i][0], map[i][1]);
    }
    return s.replace(/\s+/g, " ").trim();
  }

  // Короткие подписи кнопок: по-русски «замена дисплея» без слова «замена» даёт
  // родительный падеж, автоматически это не выкрутить.
  var OPERATION_LABELS = {
    "замена аккумулятора": "аккумулятор",
    "замена дисплея": "дисплей",
    "замена камеры": "камера",
    "замена стекла камеры": "стекло камеры",
    "замена заднего стекла": "заднее стекло",
    "замена сенсора": "сенсор",
    "замена шлейфа": "шлейф",
    "замена нижнего шлейфа": "нижний шлейф",
    "замена корпуса": "корпус",
    "замена клавиатуры": "клавиатура",
    "замена тачпада": "тачпад",
    "замена материнской платы": "материнская плата",
    "замена матрицы без крышки": "матрица",
    "переклейка стекла дисплея": "переклейка стекла",
    "профилактика (чистка, термопаста)": "профилактика",
    "ремонт после залития": "залитие"
  };

  // Варианты, которые на самом деле не варианты, а название раздела прайса —
  // показывать их клиенту как «— Камеры» бессмысленно.
  var GENERIC_VARIANTS = ["камеры", "шлейфы кнопок и вспышки", "задние стёкла", "корпуса",
    "кабели и блоки питания", "стёкла камер", "нижние шлейфа"];

  // Синонимы поломок: человек пишет «разбил экран», а в прайсе «замена дисплея».
  var FAULT_SYNONYMS = [
    // Переклейку ищут десятком способов — «замена стекла дисплея»,
    // «восстановление стекла», «ремонт дисплея». Проверяем ДО замены дисплея,
    // иначе слово «дисплея» в запросе уводит не туда.
    [/переклей|переклеив|восстановлен|восстановит/, "переклейка"],
    [/разбил|треснул|трещин|скол|экран|дисплей|матриц/, "дисплея"],
    [/не держит|быстро сад|батаре|аккум|акб/, "аккумулятора"],
    [/залил|залит|утопил|намок|вода/, "залития"],
    [/шумит|греется|перегрев|кулер|пыль|чистк|профилакт/, "профилактика"],
    [/клавиш|клавиатур|залипа/, "клавиатуры"],
    [/тачпад|трекпад/, "тачпада"],
    [/только стекло/, "переклейка"],
    // Английские синонимы (17.08.2026): на /en/ человек ищет «cracked screen»,
    // «water damage», «battery» — в прайсе этих слов нет вообще, он на русском.
    // Без этой таблицы английский поиск возвращал бы пустоту на любой запрос
    // кроме названия модели.
    // «back glass» — это заднее стекло, а не дисплей: проверяем ДО экрана,
    // иначе слово glass уводит запрос в замену дисплея и выдача пустеет.
    [/^back$|^rear$/, "заднего"],
    // glass отдельно от screen: «стекл» есть и в заднем стекле, и в переклейке,
    // и в стекле камеры — пусть решают остальные слова запроса.
    [/^glass$/, "стекл"],
    [/crack|broke|broken|shatter|smash|screen|display/, "дисплея"],
    [/batter|charge|charging|drain|dying|power/, "аккумулятора"],
    [/water|liquid|wet|spill|drown|sea|pool|damage|flood/, "залития"],
    [/clean|dust|overheat|hot|fan|noisy|thermal/, "профилактика"],
    [/keyboard|key|sticky/, "клавиатуры"],
    [/trackpad|touchpad/, "тачпада"],
    [/camera|lens/, "камеры"],
    [/refurb|reglue|glass only/, "переклейка"]
  ];

  /** Совпадение с текстом поиска; фильтры групп, работ и модели проверяет passes(). */
  function matches(service, query) {
    if (!query) return true;

    var haystack = normalize(service.device + " " + service.operation + " " + (service.variant || "") + " " + (service.models || ""));
    var words = normalize(query).split(" ").filter(Boolean);

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      if (haystack.indexOf(word) !== -1) continue;
      // Русские окончания: клиент пишет «камера», в прайсе «замена камерЫ».
      // Точное совпадение таких слов не находит, поэтому пробуем основу.
      if (word.length >= 5 &&
          (haystack.indexOf(word.slice(0, -1)) !== -1 || haystack.indexOf(word.slice(0, -2)) !== -1)) continue;
      // Слово могло быть названием поломки — переводим в термин прайса.
      var mapped = null;
      for (var j = 0; j < FAULT_SYNONYMS.length; j++) {
        if (FAULT_SYNONYMS[j][0].test(word)) { mapped = FAULT_SYNONYMS[j][1]; break; }
      }
      if (mapped && haystack.indexOf(mapped) !== -1) continue;
      // Служебные слова запроса не должны убивать выдачу.
      if (/^(на|для|в|и|с|у|мне|нужно|сколько|стоит|цена|ремонт|замена|поменять)$/.test(word)) continue;
      // Те же служебные слова по-английски — «how much to fix my screen».
      if (/^(a|an|the|my|for|of|to|is|it|in|on|only|just|how|much|cost|price|repair|replace|replacement|fix|fixed|need|please|service|new|old|got|has|have)$/.test(word)) continue;
      return false;
    }
    return true;
  }

  function render(list) {
    results.innerHTML = "";
    status.hidden = Boolean(list.length);
    if (!list.length) {
      status.textContent = t("nothing_found", "Ничего не нашли. Напишите нам — подскажем по вашей модели.");
      return 0;
    }

    // Группируем по устройству и услуге: клиенту важен выбор варианта, а не
    // плоский список из 300 строк.
    var groups = {};
    var order = [];
    list.forEach(function (s) {
      var key = s.device + "|" + s.operation;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(s);
    });
    // Сортировка по цене — по самой дешёвой цене карточки, как «Сначала дешевле» в магазине.
    if (sortMode !== "default") {
      var minOf = function (key) { return Math.min.apply(null, groups[key].map(function (s) { return Number(s.price) || 0; })); };
      order.sort(function (a, b) { return sortMode === "asc" ? minOf(a) - minOf(b) : minOf(b) - minOf(a); });
    }

    // До 26.10.2026 показывались первые 40 карточек, остальные молча пропадали («Нашли 779», а видно 40).
    order.slice(0, shown).forEach(function (key) {
      var items = groups[key].slice().sort(function (a, b) { return a.price - b.price; });
      var head = items[0];
      var card = document.createElement("article");
      card.className = "rs-card";

      var title = document.createElement("h3");
      title.textContent = opName(head.operation);
      card.appendChild(title);

      var device = document.createElement("p");
      device.className = "rs-device-name";
      device.textContent = deviceName(head.device);
      card.appendChild(device);

      var ul = document.createElement("ul");
      ul.className = "rs-variants";
      items.forEach(function (s) {
        var li = document.createElement("li");
        var price = document.createElement("b");
        price.textContent = priceText(s);
        li.appendChild(price);
        var variantText = variantLabel(s.variant);
        if (variantText && GENERIC_VARIANTS.indexOf(variantText.toLowerCase()) === -1) {
          var v = document.createElement("span");
          v.className = "rs-variant-name";
          v.textContent = variantText;
          li.appendChild(v);
        }
        // Гарантия зависит от класса запчасти — показываем рядом с ценой,
        // иначе клиент выбирает вслепую по одной цифре.
        if (s.warranty_days) {
          var w = document.createElement("i");
          w.className = "rs-warranty";
          w.textContent = EN ? t("warranty", "", { n: s.warranty_days })
            : "гарантия " + s.warranty_days + " дн.";
          li.appendChild(w);
        }
        // Деталь этого варианта уже лежит у нас (план 93 §11.61) — ремонт без ожидания запчасти.
        if (s.in_stock) {
          var st = document.createElement("i");
          st.className = "rs-warranty rs-stock";
          st.textContent = EN ? "✅ part in stock" : "✅ запчасть в наличии";
          li.appendChild(st);
        }
        if (!s.options || !s.options.length) li.appendChild(addButton(s, null));
        ul.appendChild(li);
        (s.options || []).forEach(function (o) {
          var sub = document.createElement("li");
          sub.className = "rs-option";
          sub.appendChild(document.createTextNode(variantLabel(o.label) + " — " + money(o.price) + " "));
          sub.appendChild(addButton(s, o));
          ul.appendChild(sub);
        });
      });
      card.appendChild(ul);

      if (head.work_only) card.appendChild(note(t("work_only", "Указана работа — запчасть считается отдельно.")));
      // Заметка мастера из прайса иногда повторяет автоматическую подпись про
      // диагностику — тогда под карточкой стояли две строки об одном и том же
      // (видно и на русской версии). Показываем одну.
      var дубльДиагностики = head.requires_diagnostics && /диагностик/i.test(head.note || "");
      if (head.note && !дубльДиагностики) card.appendChild(note(variantLabel(head.note)));
      if (head.requires_diagnostics) {
        card.appendChild(note(t("liquid_note", "Точную цену назовём после диагностики — залития непредсказуемы.")));
      }
      results.appendChild(card);
    });
    if (order.length > shown) {
      var more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-secondary rs-more";
      var rest = Math.min(PAGE, order.length - shown);
      more.textContent = EN ? "Show " + rest + " more" : "Показать ещё " + rest + " из " + (order.length - shown);
      more.addEventListener("click", function () { shown += PAGE; apply(true); });
      results.appendChild(more);
    }
    return order.length;
  }

  /** Разбор качеств запчастей — под поиском, свёрнутый. */
  function renderQualityGuide() {
    var host = document.getElementById("rs-quality");
    if (!host || !quality) return;
    var warrantyOf = function (cls) {
      var found = null;
      Object.keys(quality["гарантия"] || {}).forEach(function (level) {
        var spec = quality["гарантия"][level];
        if (spec && spec["классы"] && spec["классы"].indexOf(cls) !== -1) found = spec["дней"];
      });
      return found;
    };
    // Тексты про качество запчастей лежат в самом прайсе и написаны по-русски.
    // Для английской версии берём перевод по КЛАССУ запчасти (дисплей_oled и
    // т.п.) — класс машинный и не меняется при обновлении цен, в отличие от
    // самих текстов. Нет перевода для класса — показываем русский текст.
    var loc = function (it) {
      var cls = EN && DICT && DICT.quality && DICT.quality.classes && DICT.quality.classes[it["класс"]];
      if (!cls) return { name: it["имя"], desc: it["описание"], cons: it["минусы"] || [] };
      return { name: cls.name, desc: cls.desc, cons: cls.cons || [] };
    };
    var warrantyLabel = function (days) {
      return EN ? t("warranty", "", { n: days }) : "гарантия " + days + " дн.";
    };
    var block = function (title, items) {
      if (!items || !items.length) return "";
      var html = "<h3>" + escape(title) + "</h3><dl class='rs-quality-list'>";
      items.forEach(function (it) {
        var days = warrantyOf(it["класс"]);
        var L = loc(it);
        html += "<dt>" + escape(L.name) + (days ? " <span class='rs-warranty'>" + escape(warrantyLabel(days)) + "</span>" : "") + "</dt>";
        html += "<dd>" + escape(L.desc);
        if (L.cons && L.cons.length) {
          var consLabel = (EN && DICT && DICT.quality && DICT.quality.cons_label) || "Минусы";
          html += "<br><i>" + escape(consLabel) + ": " + escape(L.cons.join(", ")) + "</i>";
        }
        html += "</dd>";
      });
      return html + "</dl>";
    };
    // Условия переклейки — отдельным блоком: клиент видит цену дешевле замены
    // дисплея и должен сразу понимать, когда она не подойдёт.
    var Q = (EN && DICT && DICT.quality) || null;

    var reglue = "";
    var reglueSrc = Q && Q.reglue ? Q.reglue : null;
    if (quality["переклейка"]) {
      var rTitle = reglueSrc ? reglueSrc.title : quality["переклейка"]["заголовок"];
      reglue = "<h3>" + escape(rTitle) + "</h3>";
      var conds = reglueSrc && reglueSrc.conditions
        ? reglueSrc.conditions.map(function (c) { return { t: c.topic, x: c.text }; })
        : (quality["переклейка"]["условия"] || []).map(function (c) { return { t: c["тема"], x: c["текст"] }; });
      conds.forEach(function (c) {
        reglue += "<p class='rs-note'><b>" + escape(c.t) + ".</b> " + escape(c.x) + "</p>";
      });
      var contact = quality["переклейка"]["контакт"];
      if (contact) {
        var label = reglueSrc && reglueSrc.contact_label ? reglueSrc.contact_label : contact["подпись"];
        reglue += "<p class='rs-note'><a href='" + escape(contact["url"]) +
          "' target='_blank' rel='noopener'>" + escape(label) + "</a></p>";
      }
    }

    var importantSrc = Q && Q.important
      ? Q.important.map(function (n) { return { t: n.topic, x: n.text }; })
      : (quality["важно_знать"] || []).map(function (n) { return { t: n["тема"], x: n["текст"] }; });
    var notes = importantSrc.map(function (n) {
      return "<p class='rs-note'><b>" + escape(n.t) + ".</b> " + escape(n.x) + "</p>";
    }).join("");

    // На английской версии добавляем строку про оплату: рубли и неработающие
    // иностранные карты — то, чего русский посетитель и так знает, а приезжий
    // узнаёт уже у кассы, если ему не сказать заранее.
    var payNote = EN && DICT && DICT.ui && DICT.ui.price_note
      ? "<p class='rs-note'>" + escape(DICT.ui.price_note) + "</p>"
      : "";

    host.innerHTML =
      "<details class='rs-details'><summary>" +
      escape(Q && Q.title ? Q.title : "Чем отличаются запчасти и от чего зависит гарантия") +
      "</summary>" +
      block(Q && Q.displays_title ? Q.displays_title : "Дисплеи", quality["дисплеи"]) +
      block(Q && Q.batteries_title ? Q.batteries_title : "Аккумуляторы", quality["акб"]) +
      reglue +
      notes +
      payNote +
      "</details>";
  }

  function escape(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** Кнопка «в корзину» у конкретной цены — варианта или исполнения. */
  function addButton(service, option) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "rs-add";
    var key = cartKey(service, option);
    var inCart = cart.some(function (c) { return c.key === key; });
    b.textContent = inCart ? t("chosen", "✓ выбрано") : t("choose", "＋ выбрать");
    if (inCart) b.classList.add("is-added");
    b.addEventListener("click", function () {
      toggleCart(service, option);
      apply();
    });
    return b;
  }

  function cartKey(service, option) {
    return service.device + "|" + service.operation + "|" + (option ? option.label : service.variant || "");
  }

  function toggleCart(service, option) {
    var key = cartKey(service, option);
    var at = cart.findIndex(function (c) { return c.key === key; });
    if (at >= 0) { cart.splice(at, 1); }
    else {
      cart.push({
        key: key,
        kind: "service",
        device: service.device,
        operation: service.operation,
        variant: option ? option.label : service.variant || "",
        price: option ? option.price : service.price,
        priceFrom: Boolean(service.price_is_from)
      });
    }
    renderCart();
  }

  function renderCart() {
    var пустая = cart.length === 0;
    cartBox.hidden = пустая;
    if (пустая) cartBox.classList.remove("is-open");
    if (cartBar) cartBar.hidden = пустая;
    cartList.innerHTML = "";
    var total = 0;
    var anyFrom = false;
    cart.forEach(function (c, i) {
      total += Number(c.price) || 0;
      if (c.priceFrom) anyFrom = true;
      var li = document.createElement("li");
      li.className = "cart-item";
      var left = document.createElement("span");
      left.className = "cart-item__body";
      // В корзине ХРАНЯТСЯ русские названия — заявку читают мастера, и она
      // должна прийти им на русском. Клиенту же показываем перевод: турист
      // выбирает услугу по-английски, мастерская получает её по-русски.
      var shownOp = opName(c.operation);
      var shownVariant = c.variant ? variantLabel(c.variant) : "";
      var название = document.createElement("strong");
      название.textContent = shownOp + (shownVariant ? ", " + shownVariant : "");
      var устройство = document.createElement("span");
      устройство.textContent = deviceName(c.device) + " · " + (c.priceFrom ? t("from", "от ") : "") + money(c.price);
      left.appendChild(название);
      left.appendChild(устройство);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "cart-item__remove";
      rm.setAttribute("aria-label", t("remove", "убрать"));
      rm.textContent = "×";
      rm.addEventListener("click", function () { cart.splice(i, 1); renderCart(); apply(); });
      li.appendChild(left);
      li.appendChild(rm);
      cartList.appendChild(li);
    });
    var сумма = (anyFrom ? t("from", "от ") : "") + money(total);
    cartTotal.textContent = пустая ? "—" : сумма;
    if (cartCount) cartCount.textContent = String(cart.length);
    if (cartCountMobile) cartCountMobile.textContent = String(cart.length);
    // «1 services» читается как недоделка.
    var units = document.querySelector(".rs-cart-units");
    if (units) {
      units.textContent = cart.length === 1
        ? t("unit_one", "усл.")
        : t("unit_many", "усл.");
    }
    if (cartTotalMobile) cartTotalMobile.textContent = пустая ? "—" : сумма;
    cartNote.textContent = "";
  }

  function note(text) {
    var p = document.createElement("p");
    p.className = "rs-note";
    p.textContent = text;
    return p;
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  // ── Фильтры, числа и навигация (26.10.2026) ───────────────────────────────
  function groupById(id) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i];
    return GROUPS[0];
  }
  function groupOfFamily(fam) {
    for (var i = 1; i < GROUPS.length; i++) if (GROUPS[i].fams.indexOf(fam) !== -1) return GROUPS[i].id;
    return "all";
  }
  function inGroup(s, gid) {
    var g = groupById(gid);
    return !g.fams || g.fams.indexOf(s.family) !== -1;
  }
  /** Поколение iPhone по названию модели: «iPhone 15 Pro» → «15», «iPhone XS Max» → «X», «iPhone SE 2022» → «SE». */
  function iphoneSeries(device) {
    if (/\bSE\b/.test(device)) return "SE";
    var m = /iPhone\s+(\d+)/.exec(device);
    if (m) return m[1];
    return /iPhone\s+X/.test(device) ? "X" : "";
  }
  /**
   * Второй уровень внутри группы — как подкатегории магазина. В группе из нескольких семей это сама техника
   * (iMac · Mac mini · ПК), у iPhone — поколение, у MacBook — Air / Pro. У группы «Все» второго уровня нет.
   */
  function subOf(s, gid) {
    var g = groupById(gid);
    if (!g.fams) return "";
    if (g.fams.length > 1) return s.family;
    if (s.family === "iphone") return iphoneSeries(s.device);
    if (s.family === "mac") return /Air/.test(s.device) ? "air" : /Pro/.test(s.device) ? "pro" : "";
    return "";
  }
  function subLabel(key) {
    if (activeGroup === "iphone") return key === "X" ? "iPhone X · XS · XR" : "iPhone " + key;
    if (activeGroup === "mac") return key === "air" ? "MacBook Air" : "MacBook Pro";
    var f = families.filter(function (x) { return x.key === key; })[0];
    return f ? famName(f) : key;
  }
  function subRank(key) {
    if (/^\d+$/.test(key)) return -Number(key);   // новые поколения первыми
    return { X: 1, SE: 2, air: -2, pro: -1 }[key] || 0;
  }
  /** Подпись фамилии техники: на английской версии — из словаря, если он её знает. */
  function famName(f) {
    if (EN && DICT && DICT.families && DICT.families[f.key]) return DICT.families[f.key];
    return f.label;
  }
  function opLabel(operation) {
    return (EN && DICT && DICT.op_labels && DICT.op_labels[operation]) ||
      OPERATION_LABELS[operation] || operation.replace(/\s*\(.*\)$/, "");
  }
  /** Проходит ли услуга фильтры; skip — какой фильтр не учитывать (для чисел у его же кнопок). */
  function passes(s, skip) {
    if (skip !== "group" && !inGroup(s, activeGroup)) return false;
    if (skip !== "group" && skip !== "sub" && activeSub && subOf(s, activeGroup) !== activeSub) return false;
    if (skip !== "op" && activeOperation && s.operation !== activeOperation) return false;
    if (skip !== "device" && skip !== "group" && skip !== "sub" && activeDevice && s.device !== activeDevice) return false;
    return true;
  }
  /** Число карточек (устройство + услуга) — то, что человек видит списком. */
  function cardCount(list, keyFn) {
    var seen = {}, out = {};
    list.forEach(function (s) {
      var k = keyFn(s), card = s.device + "|" + s.operation;
      if (seen[k + "§" + card]) return;
      seen[k + "§" + card] = true;
      out[k] = (out[k] || 0) + 1;
    });
    return out;
  }
  function esc(text) { return escape(text).replace(/"/g, "&quot;"); }
  function icon(name) {
    return '<svg class="shop-group__icon" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || "") + "</svg>";
  }

  function renderNav(textOk) {
    // Группы: числа без учёта самой группы, её второго уровня и модели.
    var poolG = services.filter(function (s, i) { return textOk[i] && passes(s, "group"); });
    var famCards = cardCount(poolG, function (s) { return s.family; });
    var total = cardCount(poolG, function () { return "all"; }).all || 0;
    groupsNav.innerHTML = GROUPS.map(function (g) {
      var n = g.fams ? g.fams.reduce(function (sum, f) { return sum + (famCards[f] || 0); }, 0) : total;
      if (!n && g.id !== activeGroup && g.id !== "all") return "";
      var on = g.id === activeGroup;
      return '<button type="button" class="shop-group' + (on ? " is-active" : "") + '" data-group="' + g.id + '" aria-pressed="' + on + '">' +
        icon(g.icon) + '<span class="shop-group__text"><span class="shop-group__name">' + escape(EN ? g.en : g.ru) +
        ' <span class="shop-group__n">' + n + '</span></span><span class="shop-group__hint">' + escape(EN ? g.hintEn : g.hintRu) +
        "</span></span></button>";
    }).join("");

    // Второй уровень.
    var g = groupById(activeGroup), subs = [];
    if (g.fams) {
      var poolS = services.filter(function (s, i) { return textOk[i] && passes(s, "sub"); });
      var subCards = cardCount(poolS, function (s) { return subOf(s, activeGroup); });
      subs = Object.keys(subCards).filter(function (k) { return k; });
      if (activeSub && subs.indexOf(activeSub) === -1) subs.push(activeSub);
      subs.sort(function (a, b) { return subRank(a) - subRank(b); });
      var allN = Object.keys(subCards).reduce(function (sum, k) { return sum + subCards[k]; }, 0);
      subRow.innerHTML = subs.length > 1 || activeSub
        ? '<button type="button" class="shop-cat' + (!activeSub ? " is-active" : "") + '" data-sub="">' +
            escape(EN ? "All " + g.en : "Все " + (g.id === "small" ? "устройства" : g.ru)) + '<span class="shop-cat__n">' + allN + "</span></button>" +
          subs.map(function (k) {
            return '<button type="button" class="shop-cat' + (k === activeSub ? " is-active" : "") + '" data-sub="' + esc(k) + '">' +
              escape(subLabel(k)) + '<span class="shop-cat__n">' + (subCards[k] || 0) + "</span></button>";
          }).join("")
        : "";
    } else {
      subRow.innerHTML = "";
    }
    subRow.hidden = !subRow.innerHTML;

    // «Что нужно сделать»: числа без учёта самой работы; нулевые скрыты, самые частые — первыми.
    var poolO = services.filter(function (s, i) { return textOk[i] && passes(s, "op"); });
    var opCards = cardCount(poolO, function (s) { return s.operation; });
    var ops = Object.keys(opCards);
    if (activeOperation && ops.indexOf(activeOperation) === -1) ops.push(activeOperation);
    var rank = function (op) {
      var i = OPS_FIRST.indexOf(op);
      if (i !== -1) return i;
      return OPS_LAST.indexOf(op) !== -1 ? 1000 + OPS_LAST.indexOf(op) : 500;
    };
    ops.sort(function (a, b) { return rank(a) - rank(b) || (opCards[b] || 0) - (opCards[a] || 0) || opLabel(a).localeCompare(opLabel(b)); });
    var visible = ops, hiddenN = 0;
    if (!opsExpanded && ops.length > OPS_VISIBLE + 2) {
      visible = ops.slice(0, OPS_VISIBLE);
      if (activeOperation && visible.indexOf(activeOperation) === -1) visible.push(activeOperation);
      hiddenN = ops.length - visible.length;
    }
    opsLabel.textContent = EN ? "What needs doing" : "Что нужно сделать";
    opChips.innerHTML = visible.map(function (op) {
      return '<button type="button" class="shop-cat' + (op === activeOperation ? " is-active" : "") + '" data-operation="' + esc(op) + '">' +
        escape(opLabel(op)) + '<span class="shop-cat__n">' + (opCards[op] || 0) + "</span></button>";
    }).join("") + (hiddenN
      ? '<button type="button" class="shop-cat shop-cat--more" data-more="1">' + (EN ? "More" : "Ещё") + " " + hiddenN + "</button>"
      : (opsExpanded && ops.length > OPS_VISIBLE + 2 ? '<button type="button" class="shop-cat shop-cat--more" data-more="0">' + (EN ? "Less" : "Свернуть") + "</button>" : ""));
    opsBox.hidden = !ops.length;

    renderDeviceOptions(textOk);
    renderSortOptions();
  }

  /** Список моделей: только подходящие под группу, второй уровень и работу, с числом карточек. */
  function renderDeviceOptions(textOk) {
    var pool = services.filter(function (s, i) { return textOk[i] && passes(s, "device"); });
    var cards = cardCount(pool, function (s) { return s.device; });
    var list = [];
    services.forEach(function (s) { if (cards[s.device] && list.indexOf(s.device) === -1) list.push(s.device); });
    if (activeDevice && list.indexOf(activeDevice) === -1) list.push(activeDevice);
    deviceSelect.innerHTML = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = (EN ? "All models" : "Все модели") + " · " + list.length;
    deviceSelect.appendChild(all);
    list.forEach(function (d) {
      var o = document.createElement("option");
      o.value = d;
      o.textContent = deviceName(d) + " · " + (cards[d] || 0);
      if (d === activeDevice) o.selected = true;
      deviceSelect.appendChild(o);
    });
  }

  function renderSortOptions() {
    if (sortSelect.options.length) { sortSelect.value = sortMode; return; }
    [["default", EN ? "By model" : "По моделям"], ["asc", EN ? "Cheapest first" : "Сначала дешевле"],
     ["desc", EN ? "Most expensive first" : "Сначала дороже"]].forEach(function (p) {
      var o = document.createElement("option");
      o.value = p[0]; o.textContent = p[1];
      sortSelect.appendChild(o);
    });
    sortSelect.value = sortMode;
  }

  function renderApplied(found) {
    var chips = [];
    var chip = function (key, label) {
      return '<button type="button" class="shop-applied__chip" data-clear="' + key + '" aria-label="' + (EN ? "Remove" : "Убрать") + ": " +
        esc(label) + '">' + escape(label) + ' <span aria-hidden="true">×</span></button>';
    };
    if (activeSub) chips.push(chip("sub", subLabel(activeSub)));
    else if (activeGroup !== "all") chips.push(chip("group", EN ? groupById(activeGroup).en : groupById(activeGroup).ru));
    if (activeOperation) chips.push(chip("op", opLabel(activeOperation)));
    if (activeDevice) chips.push(chip("device", deviceName(activeDevice)));
    var q = input.value.trim();
    if (q) chips.push(chip("q", "«" + q + "»"));
    applied.innerHTML = '<span class="shop-applied__found">' + (EN ? "Found" : "Найдено") + ": <b>" + found + "</b> " +
      (EN ? (found === 1 ? "service" : "services") : plural(found, "услуга", "услуги", "услуг")) + "</span>" + chips.join("") +
      (chips.length > 1 ? '<button type="button" class="shop-applied__reset" data-clear="all">' + (EN ? "Reset all" : "Сбросить всё") + "</button>" : "");
  }

  var lastQs = null;
  function writeUrl() {
    var p = new URLSearchParams();
    if (activeGroup !== "all") p.set("g", activeGroup);
    if (activeSub) p.set("s", activeSub);
    if (activeOperation) p.set("op", activeOperation);
    if (activeDevice) p.set("m", activeDevice);
    if (sortMode !== "default") p.set("sort", sortMode);
    var q = input.value.trim();
    if (q) p.set("q", q.slice(0, 60));
    var qs = p.toString();
    if (qs === lastQs) return;
    lastQs = qs;
    try { history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) { /* file:// и старые браузеры */ }
  }
  function readUrl() {
    var p;
    try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var q = p.get("q");
    if (q) input.value = q.slice(0, 60);
    var m = p.get("m");
    var hit = m && services.filter(function (s) { return s.device === m; })[0];
    var g = p.get("g");
    if (hit) { activeDevice = m; activeGroup = groupOfFamily(hit.family); activeSub = subOf(hit, activeGroup); }
    else if (g && GROUPS.some(function (x) { return x.id === g; })) activeGroup = g;
    var s = p.get("s");
    if (s && !hit) activeSub = s.slice(0, 40);
    var op = p.get("op");
    if (op && services.some(function (x) { return x.operation === op; })) activeOperation = op;
    var sort = p.get("sort");
    if (sort === "asc" || sort === "desc") sortMode = sort;
  }

  /** keepPage — «Показать ещё» листает дальше, любое другое действие возвращает к первым 40. */
  function apply(keepPage) {
    if (!keepPage) shown = PAGE;
    var q = input.value.trim();
    var textOk = services.map(function (s) { return matches(s, q); });
    renderNav(textOk);
    var found = render(services.filter(function (s, i) { return textOk[i] && passes(s); }));
    renderApplied(found);
    writeUrl();
  }

  groupsNav.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-group]");
    if (!btn) return;
    activeGroup = btn.getAttribute("data-group");
    activeSub = "";
    if (activeDevice && !services.some(function (s) { return s.device === activeDevice && inGroup(s, activeGroup); })) activeDevice = "";
    apply();
  });
  subRow.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-sub]");
    if (!btn) return;
    activeSub = btn.getAttribute("data-sub");
    if (activeDevice && !services.some(function (s) { return s.device === activeDevice && (!activeSub || subOf(s, activeGroup) === activeSub); })) activeDevice = "";
    apply();
  });
  opChips.addEventListener("click", function (e) {
    var more = e.target.closest("[data-more]");
    if (more) { opsExpanded = more.getAttribute("data-more") === "1"; apply(true); return; }
    var btn = e.target.closest("[data-operation]");
    if (!btn) return;
    var op = btn.getAttribute("data-operation");
    activeOperation = activeOperation === op ? "" : op;
    apply();
  });
  applied.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-clear]");
    if (!btn) return;
    var what = btn.getAttribute("data-clear");
    if (what === "sub") activeSub = "";
    if (what === "group" || what === "all") { activeGroup = "all"; activeSub = ""; }
    if (what === "op" || what === "all") activeOperation = "";
    if (what === "device" || what === "all") activeDevice = "";
    if (what === "q" || what === "all") input.value = "";
    apply();
  });
  // Выбрал модель — группа и второй уровень встают по ней, как категория в магазине.
  deviceSelect.addEventListener("change", function () {
    activeDevice = deviceSelect.value;
    var hit = activeDevice && services.filter(function (s) { return s.device === activeDevice; })[0];
    if (hit) { activeGroup = groupOfFamily(hit.family); activeSub = subOf(hit, activeGroup); }
    apply();
  });
  sortSelect.addEventListener("change", function () {
    sortMode = sortSelect.value;
    apply();
  });

  if (cartToggle) {
    cartToggle.addEventListener("click", function () {
      cartBox.classList.toggle("is-open");
    });
  }
  if (cartClose) {
    cartClose.addEventListener("click", function () {
      cartBox.classList.remove("is-open");
    });
  }

  root.querySelector(".rs-cart-clear").addEventListener("click", function () {
    cart = [];
    renderCart();
    apply();
  });

  // Заявка уходит тем же путём, что и корзина товаров: сохраняем её на стороне
  // бота и открываем диплинк. Клиент по дороге не может отредактировать ни цену,
  // ни состав — бот собирает заявку заново из своего прайса.
  root.querySelector(".rs-cart-send").addEventListener("click", function () {
    if (!cart.length) return;
    cartNote.textContent = t("sending", "Отправляем…");
    var api = (window.IRON_CONFIG && window.IRON_CONFIG.siteOrderApiUrl) ||
      "https://order-bot.4489530.workers.dev/site-order";
    fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map(function (c) {
          return { kind: "service", device: c.device, operation: c.operation, variant: c.variant, price: c.price };
        })
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.botUrl) {
          cartNote.textContent = t("opening_telegram", "Открываем Telegram…");
          window.open(data.botUrl, "_blank", "noopener");
        } else {
          cartNote.textContent = "Не получилось отправить. Позвоните нам — оформим вручную.";
        }
      })
      .catch(function () {
        cartNote.textContent = "Не получилось отправить. Позвоните нам — оформим вручную.";
      });
  });

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });

  // Путь к данным — от корня сайта, а НЕ относительный. Английская страница
  // лежит в /en/, и "data/services.json" превратился бы там в
  // "/en/data/services.json" — 404 и пустой прайс (найдено при проверке
  // 17.08.2026, до того как страница попала в бой).
  // Версия — из общего модуля: без неё браузер отдавал закэшированный прайс и
  // словарь, и свежие цены на странице не появлялись.
  var верс = function (u) { return window.IRON_I18N ? window.IRON_I18N.url(u) : u; };
  var DATA = "/data/services.json";
  var DICT_URL = "/data/i18n/services.en.json";

  status.textContent = t("loading", "Загружаем прайс…");

  // Словарь грузится параллельно прайсу и только на английской версии.
  // Если он не подтянулся — работаем с русскими подписями: пустой прайс хуже,
  // чем прайс с непереведёнными названиями операций.
  Promise.all([
    fetch(верс(DATA)).then(function (r) { return r.json(); }),
    EN ? fetch(верс(DICT_URL)).then(function (r) { return r.json(); }).catch(function () { return null; })
       : Promise.resolve(null)
  ])
    .then(function (both) {
      var data = both[0];
      DICT = both[1];
      services = data.services || [];
      // Запасной вариант — собрать семьи из самих услуг. Нужен, если на сайт
      // попадёт services.json, собранный старой версией build_services.py:
      // страница не должна остаться совсем без кнопок выбора техники.
      families = data.families || [];
      if (!families.length) {
        var seen = {};
        services.forEach(function (s) {
          if (s.family && !seen[s.family]) {
            seen[s.family] = true;
            families.push({ key: s.family, label: s.family });
          }
        });
      }
      quality = data.quality || null;
      renderQualityGuide();
      // Ссылка из ролика (28.09.2026): uslugi.html?q=батарея#repair-search — поиск заполнен сразу. Владелец: «QR и ссылки
      // должны вести максимально на то, о чём ролик» (ролик про вздутую батарею ведёт на цены замены батареи).
      // С 26.10.2026 из адреса читаются и группа, поколение, работа, модель и сортировка (readUrl).
      readUrl();
      apply();
    })
    .catch(function () {
      status.textContent = t("load_failed", "Не удалось загрузить прайс. Позвоните нам — подскажем цену.");
    });
})();
