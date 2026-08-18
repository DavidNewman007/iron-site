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

  /** Полное название операции для заголовка карточки. */
  function opName(operation) {
    if (EN && DICT && DICT.operations && DICT.operations[operation]) return DICT.operations[operation];
    return operation;
  }

  var input = root.querySelector(".rs-input");
  var chips = root.querySelector('[data-group="family"]');
  var opChips = root.querySelector('[data-group="operation"]');
  var results = root.querySelector(".rs-results");
  var status = root.querySelector(".rs-status");

  var deviceSelect = root.querySelector(".rs-device");
  var cartBox = root.querySelector(".rs-cart");
  var cartList = root.querySelector(".rs-cart-list");
  var cartTotal = root.querySelector(".rs-cart-total");
  var cartNote = root.querySelector(".rs-cart-note");

  var services = [];
  var quality = null;
  var activeFamily = "";
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

  function matches(service, query) {
    if (activeFamily && service.family !== activeFamily) return false;
    if (activeOperation && service.operation !== activeOperation) return false;
    if (activeDevice && service.device !== activeDevice) return false;
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
    if (!list.length) {
      status.textContent = t("nothing_found", "Ничего не нашли. Напишите нам — подскажем по вашей модели.");
      return;
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

    status.textContent = EN
      ? t("found", "", { n: order.length, services: order.length === 1 ? t("service_one", "") : t("service_many", "") })
      : "Нашли " + order.length + " " + plural(order.length, "услугу", "услуги", "услуг");

    order.slice(0, 40).forEach(function (key) {
      var items = groups[key].slice().sort(function (a, b) { return a.price - b.price; });
      var head = items[0];
      var card = document.createElement("article");
      card.className = "rs-card";

      var title = document.createElement("h3");
      title.textContent = opName(head.operation);
      card.appendChild(title);

      var device = document.createElement("p");
      device.className = "rs-device-name";
      device.textContent = head.device;
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
    cartBox.hidden = cart.length === 0;
    cartList.innerHTML = "";
    var total = 0;
    var anyFrom = false;
    cart.forEach(function (c, i) {
      total += Number(c.price) || 0;
      if (c.priceFrom) anyFrom = true;
      var li = document.createElement("li");
      var left = document.createElement("span");
      // В корзине ХРАНЯТСЯ русские названия — заявку читают мастера, и она
      // должна прийти им на русском. Клиенту же показываем перевод: турист
      // выбирает услугу по-английски, мастерская получает её по-русски.
      var shownOp = opName(c.operation);
      var shownVariant = c.variant ? variantLabel(c.variant) : "";
      left.textContent = shownOp + (shownVariant ? ", " + shownVariant : "") + " — " + c.device;
      var right = document.createElement("span");
      right.textContent = (c.priceFrom ? t("from", "от ") : "") + money(c.price) + " ";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = t("remove", "убрать");
      rm.addEventListener("click", function () { cart.splice(i, 1); renderCart(); apply(); });
      right.appendChild(rm);
      li.appendChild(left);
      li.appendChild(right);
      cartList.appendChild(li);
    });
    cartTotal.textContent = t("cart_total", "Итого: ") + (anyFrom ? t("from", "от ") : "") + money(total);
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

  function apply() {
    syncReset();
    render(services.filter(function (s) { return matches(s, input.value.trim()); }));
  }

  chips.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-family]");
    if (!btn) return;
    var family = btn.getAttribute("data-family");
    activeFamily = activeFamily === family ? "" : family;
    Array.prototype.forEach.call(chips.querySelectorAll("button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-family") === activeFamily);
    });
    // Виды работ у iPhone и MacBook разные — пересобираем список под выбранное
    // семейство, иначе половина кнопок ведёт в пустую выдачу.
    renderOperationChips();
    renderDeviceOptions();
    apply();
  });

  opChips.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-operation]");
    if (!btn) return;
    var operation = btn.getAttribute("data-operation");
    activeOperation = activeOperation === operation ? "" : operation;
    Array.prototype.forEach.call(opChips.querySelectorAll("button"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-operation") === activeOperation);
    });
    renderDeviceOptions();
    apply();
  });

  /** Кнопки видов работ — только те, что реально есть у выбранного семейства. */
  function renderOperationChips() {
    var pool = services.filter(function (s) { return !activeFamily || s.family === activeFamily; });
    var seen = {};
    var list = [];
    pool.forEach(function (s) {
      if (!seen[s.operation]) { seen[s.operation] = true; list.push(s.operation); }
    });
    list.sort();
    if (activeOperation && list.indexOf(activeOperation) === -1) activeOperation = "";
    opChips.innerHTML = "";
    list.forEach(function (operation) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-operation", operation);
      // «замена дисплея» → «дисплей». Через отсечение слова «замена» получается
      // родительный падеж («аккумулятора»), поэтому подписи заданы явно.
      b.textContent = (EN && DICT && DICT.op_labels && DICT.op_labels[operation])
        || OPERATION_LABELS[operation]
        || operation.replace(/\s*\(.*\)$/, "");
      if (operation === activeOperation) b.classList.add("is-active");
      opChips.appendChild(b);
    });
  }

  var resetBtn = root.querySelector(".rs-reset");
  resetBtn.addEventListener("click", function (e) {
    e.preventDefault();
    activeFamily = "";
    activeOperation = "";
    activeDevice = "";
    input.value = "";
    Array.prototype.forEach.call(root.querySelectorAll(".rs-chips button"), function (b) {
      b.classList.remove("is-active");
    });
    renderOperationChips();
    renderDeviceOptions();
    apply();
  });

  function syncReset() {
    resetBtn.hidden = !(activeFamily || activeOperation || activeDevice || input.value.trim());
  }

  deviceSelect.addEventListener("change", function () {
    activeDevice = deviceSelect.value;
    apply();
  });

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

  /** Список моделей — только те, что подходят под остальные фильтры. */
  function renderDeviceOptions() {
    var pool = services.filter(function (s) {
      return (!activeFamily || s.family === activeFamily) &&
             (!activeOperation || s.operation === activeOperation);
    });
    var seen = {};
    var list = [];
    pool.forEach(function (s) { if (!seen[s.device]) { seen[s.device] = true; list.push(s.device); } });
    if (activeDevice && list.indexOf(activeDevice) === -1) activeDevice = "";
    deviceSelect.innerHTML = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = EN ? t("all_models_count", "", { n: list.length })
      : "все модели (" + list.length + ")";
    deviceSelect.appendChild(all);
    list.forEach(function (d) {
      var o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      if (d === activeDevice) o.selected = true;
      deviceSelect.appendChild(o);
    });
  }

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
      quality = data.quality || null;
      renderQualityGuide();
      renderOperationChips();
      renderDeviceOptions();
      status.textContent = EN
        ? t("loaded", "", { n: services.length })
        : "Прайс на " + services.length + " услуг. Начните вводить модель или что случилось.";
      apply();
    })
    .catch(function () {
      status.textContent = t("load_failed", "Не удалось загрузить прайс. Позвоните нам — подскажем цену.");
    });
})();
