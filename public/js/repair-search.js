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

  var input = root.querySelector(".rs-input");
  var chips = root.querySelector('[data-group="family"]');
  var opChips = root.querySelector('[data-group="operation"]');
  var results = root.querySelector(".rs-results");
  var status = root.querySelector(".rs-status");

  var services = [];
  var quality = null;
  var activeFamily = "";
  var activeOperation = "";

  function money(n) {
    return Number(n).toLocaleString("ru-RU") + " ₽";
  }

  function priceText(s) {
    if (s.price_is_from) return "от " + money(s.price);
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
      [/ м([1-5]) /g, " m$1 "]
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
    [/разбил|треснул|трещин|скол|экран|дисплей|матриц/, "дисплея"],
    [/не держит|быстро сад|батаре|аккум|акб/, "аккумулятора"],
    [/залил|залит|утопил|намок|вода/, "залития"],
    [/шумит|греется|перегрев|кулер|пыль|чистк|профилакт/, "профилактика"],
    [/клавиш|клавиатур|залипа/, "клавиатуры"],
    [/тачпад|трекпад/, "тачпада"],
    [/переклей|только стекло/, "переклейка"]
  ];

  function matches(service, query) {
    if (activeFamily && service.family !== activeFamily) return false;
    if (activeOperation && service.operation !== activeOperation) return false;
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
      return false;
    }
    return true;
  }

  function render(list) {
    results.innerHTML = "";
    if (!list.length) {
      status.textContent = "Ничего не нашли. Напишите нам — подскажем по вашей модели.";
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

    status.textContent = "Нашли " + order.length + " " + plural(order.length, "услугу", "услуги", "услуг");

    order.slice(0, 40).forEach(function (key) {
      var items = groups[key].slice().sort(function (a, b) { return a.price - b.price; });
      var head = items[0];
      var card = document.createElement("article");
      card.className = "rs-card";

      var title = document.createElement("h3");
      title.textContent = head.operation;
      card.appendChild(title);

      var device = document.createElement("p");
      device.className = "rs-device";
      device.textContent = head.device;
      card.appendChild(device);

      var ul = document.createElement("ul");
      ul.className = "rs-variants";
      items.forEach(function (s) {
        var li = document.createElement("li");
        var price = document.createElement("b");
        price.textContent = priceText(s);
        li.appendChild(price);
        var variantText = String(s.variant || "").replace(/^АКБ\s*/i, "").replace(/статус\s*/i, "").trim();
        if (variantText && GENERIC_VARIANTS.indexOf(variantText.toLowerCase()) === -1) {
          var v = document.createElement("span");
          v.textContent = " — " + variantText;
          li.appendChild(v);
        }
        // Гарантия зависит от класса запчасти — показываем рядом с ценой,
        // иначе клиент выбирает вслепую по одной цифре.
        if (s.warranty_days) {
          var w = document.createElement("i");
          w.className = "rs-warranty";
          w.textContent = " · гарантия " + s.warranty_days + " дн.";
          li.appendChild(w);
        }
        ul.appendChild(li);
        (s.options || []).forEach(function (o) {
          var sub = document.createElement("li");
          sub.className = "rs-option";
          sub.textContent = (o.warranty ? "с гарантией" : "без гарантии") + " — " + money(o.price);
          ul.appendChild(sub);
        });
      });
      card.appendChild(ul);

      if (head.work_only) card.appendChild(note("Указана работа — запчасть считается отдельно."));
      if (head.note) card.appendChild(note(head.note));
      if (head.requires_diagnostics) {
        card.appendChild(note("Точную цену назовём после диагностики — залития непредсказуемы."));
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
    var block = function (title, items) {
      if (!items || !items.length) return "";
      var html = "<h3>" + title + "</h3><dl class='rs-quality-list'>";
      items.forEach(function (it) {
        var days = warrantyOf(it["класс"]);
        html += "<dt>" + escape(it["имя"]) + (days ? " <span class='rs-warranty'>гарантия " + days + " дн.</span>" : "") + "</dt>";
        html += "<dd>" + escape(it["описание"]);
        if (it["минусы"] && it["минусы"].length) {
          html += "<br><i>Минусы: " + escape(it["минусы"].join(", ")) + "</i>";
        }
        html += "</dd>";
      });
      return html + "</dl>";
    };
    var notes = (quality["важно_знать"] || []).map(function (n) {
      return "<p class='rs-note'><b>" + escape(n["тема"]) + ".</b> " + escape(n["текст"]) + "</p>";
    }).join("");

    host.innerHTML =
      "<details class='rs-details'><summary>Чем отличаются запчасти и от чего зависит гарантия</summary>" +
      block("Дисплеи", quality["дисплеи"]) +
      block("Аккумуляторы", quality["акб"]) +
      notes +
      "</details>";
  }

  function escape(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      b.textContent = OPERATION_LABELS[operation] || operation.replace(/\s*\(.*\)$/, "");
      if (operation === activeOperation) b.classList.add("is-active");
      opChips.appendChild(b);
    });
  }

  var timer = null;
  input.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(apply, 150);
  });

  status.textContent = "Загружаем прайс…";
  fetch("data/services.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      services = data.services || [];
      quality = data.quality || null;
      renderQualityGuide();
      renderOperationChips();
      status.textContent = "Прайс на " + services.length + " услуг. Начните вводить модель или что случилось.";
      apply();
    })
    .catch(function () {
      status.textContent = "Не удалось загрузить прайс. Позвоните нам — подскажем цену.";
    });
})();
