/**
 * Витрина запчастей (план 66).
 *
 * Данные — статический `data/parts.json`, который собирает
 * `scripts/vitalya_sheet.mjs --витрина` из листа «Запчасти Витали» в БАЗЕ.
 * Почему файл, а не живое чтение таблицы: лист лежит в закрытой книге, ключа
 * сервисного аккаунта на странице быть не может, а в публичную книгу прайса
 * сервисному аккаунту запись запрещена (403, проверено 11.09.2026).
 *
 * Закупка, наценка и цены других поставщиков в файл не попадают — на публичный
 * домен уезжает только то, что видит клиент.
 *
 * Заказ уходит не почтой и не формой: кнопка открывает бота по диплинку
 * `?start=p_<id>`, где id стабилен между пересборками прайса. Так клиент по
 * дороге не может отредактировать ни позицию, ни цену — тот же принцип, что у
 * корзины магазина (см. order-channels.js).
 *
 * ⚠️ Один скрипт на ДВЕ страницы (19.09.2026): отдельная `zapchasti.html` и
 * вкладка «Запчасти» в магазине. Разметка у них одинаковая, привязка идёт по
 * идентификаторам элементов, поэтому дублировать код не нужно. На вкладке
 * магазина скрипт просыпается лениво — см. `запуститьКогдаВидно()`: качать
 * 923 позиции ради вкладки, которую посетитель может не открыть, незачем.
 */
(function () {
  "use strict";

  var DATA_URL = "data/parts.json";
  var BOT = "IRON_SERVICE_ORDER_bot";
  var CHUNK = 40;

  // Тот же словарь, что у поиска по технике (`search-dictionary.js`).
  // Отдельного словаря для запчастей заводить не стали: клиент ищет «akb 13
  // pro» теми же словами, что и технику, а две копии словаря разъедутся.
  var DICT = (window.IRON_SEARCH_DICT && window.IRON_SEARCH_DICT.translit)
    ? window.IRON_SEARCH_DICT
    : { translit: {}, translate: [] };

  var all = [];
  var shown = 0;
  var filters = { устройство: "", модель: "", узел: "", поиск: "", наличие: false };
  var запущено = false;

  var els = {};

  // ——— поиск: словарь и транслитерация ————————————————————————————————

  var РУС_ЛАТ = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
    т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };

  function norm(text) {
    return String(text || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  function вЛатиницу(text) {
    return String(text).replace(/[а-я]/g, function (ch) {
      return Object.prototype.hasOwnProperty.call(РУС_ЛАТ, ch) ? РУС_ЛАТ[ch] : ch;
    });
  }

  /**
   * Обратный указатель «русское написание → латинский ключ словаря».
   * Строится один раз: словарь устроен как «ключ → варианты», а поиску нужен
   * и обратный проход — человек пишет «аккумулятор», в данных лежит «АКБ».
   */
  var ПО_ВАРИАНТУ = (function () {
    var map = {};
    Object.keys(DICT.translit).forEach(function (key) {
      (DICT.translit[key] || []).forEach(function (variant) {
        var v = norm(variant);
        if (!v) return;
        if (!map[v]) map[v] = [];
        if (map[v].indexOf(key) === -1) map[v].push(key);
      });
    });
    (DICT.translate || []).forEach(function (pair) {
      var key = norm(pair[0]);
      (pair[1] || []).forEach(function (variant) {
        var v = norm(variant);
        if (!v) return;
        if (!map[v]) map[v] = [];
        if (map[v].indexOf(key) === -1) map[v].push(key);
      });
    });
    return map;
  })();

  var ПО_КЛЮЧУ = (function () {
    var map = {};
    Object.keys(DICT.translit).forEach(function (key) {
      map[norm(key)] = (DICT.translit[key] || []).map(norm);
    });
    (DICT.translate || []).forEach(function (pair) {
      var k = norm(pair[0]);
      map[k] = (map[k] || []).concat((pair[1] || []).map(norm));
    });
    return map;
  })();

  /**
   * Во что ещё может превратиться слово запроса: само слово, его латиница,
   * словарные синонимы в обе стороны. «akb» → «акб», «аккумулятор»;
   * «дисплей» → «display», «экран»; «displey» → «дисплей».
   */
  function варианты(token) {
    var out = [token];
    function добавить(v) {
      var n = norm(v);
      if (n && out.indexOf(n) === -1) out.push(n);
    }
    добавить(вЛатиницу(token));
    (ПО_КЛЮЧУ[token] || []).forEach(добавить);
    (ПО_ВАРИАНТУ[token] || []).forEach(function (key) {
      добавить(key);
      (ПО_КЛЮЧУ[key] || []).forEach(добавить);
    });
    return out;
  }

  /** Строка, по которой ищем: русский текст плюс его латиница. */
  function стог(item) {
    var base = norm([item.узел, item.модель, item.вариант, item.цвет, item.гарантия].join(" "));
    return base + " " + вЛатиницу(base);
  }

  // ——— фильтры ——————————————————————————————————————————————————

  /**
   * Раздел по модели. Не по названию узла: узел говорит, ЧТО за деталь, а
   * человек сначала выбирает, для какого устройства она нужна.
   */
  function устройствоИз(модель) {
    var m = String(модель || "");
    if (/^iphone/i.test(m)) return "iPhone";
    if (/watch/i.test(m)) return "Apple Watch";
    if (/macbook|imac|\bmac\b/i.test(m)) return "Mac";
    return "Аксессуары";
  }

  var ПОРЯДОК_УСТРОЙСТВ = ["iPhone", "Apple Watch", "Mac", "Аксессуары"];

  /** Сортировка моделей: новые сверху — «iPhone 17 Pro Max» выше «iPhone 11». */
  function весМодели(модель) {
    var m = модель.match(/(\d{1,2})/);
    var номер = m ? Number(m[1]) : 0;
    var ранг = /pro max/i.test(модель) ? 3 : /\bpro\b/i.test(модель) ? 2 : /plus/i.test(модель) ? 1 : 0;
    return номер * 10 + ранг;
  }

  function подходит(item, кроме) {
    if (кроме !== "устройство" && filters.устройство && устройствоИз(item.модель) !== filters.устройство) return false;
    if (кроме !== "модель" && filters.модель && item.модель !== filters.модель) return false;
    if (кроме !== "узел" && filters.узел && item.узел !== filters.узел) return false;
    if (filters.наличие && !(item.наличие > 0)) return false;
    if (!filters.поиск) return true;
    var haystack = стог(item);
    // Все слова запроса должны найтись: «13 про дисплей» — это три условия, а
    // не одна строка, иначе порядок слов начинает решать за клиента. Слово
    // засчитывается, если совпал ЛЮБОЙ его словарный вариант.
    return norm(filters.поиск).split(/\s+/).filter(Boolean).every(function (word) {
      return варианты(word).some(function (v) { return haystack.indexOf(v) !== -1; });
    });
  }

  function отобранные() {
    return all.filter(function (i) { return подходит(i, null); });
  }

  // ——— отрисовка ————————————————————————————————————————————————

  function money(value) {
    return Number(value).toLocaleString("ru-RU") + " ₽";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function card(item) {
    var row = document.createElement("div");
    row.className = "parts-row";

    var main = document.createElement("div");
    main.className = "parts-row__main";

    var title = document.createElement("p");
    title.className = "parts-row__title";
    title.textContent = item.узел.charAt(0).toUpperCase() + item.узел.slice(1) + " · " + item.модель;

    var badge = document.createElement("span");
    if (item.наличие > 0) {
      badge.className = "parts-badge parts-badge--stock";
      badge.textContent = "в наличии";
    } else {
      badge.className = "parts-badge parts-badge--order";
      badge.textContent = "под заказ · " + item.срок;
    }
    title.appendChild(badge);

    var meta = document.createElement("p");
    meta.className = "parts-row__meta";
    var bits = [item.вариант];
    if (item.цвет) bits.push(item.цвет);
    if (item.гарантия) bits.push("гарантия " + item.гарантия);
    meta.innerHTML = bits.filter(Boolean).map(function (b, i) {
      return i ? "<i> · </i>" + escapeHtml(b) : escapeHtml(b);
    }).join("");

    main.appendChild(title);
    main.appendChild(meta);

    var price = document.createElement("div");
    price.className = "parts-row__price";
    price.textContent = money(item.цена);

    var order = document.createElement("a");
    order.className = "btn btn-primary";
    order.href = "https://t.me/" + BOT + "?start=p_" + encodeURIComponent(item.id);
    order.target = "_blank";
    order.rel = "noopener";
    order.textContent = "Заказать";

    row.appendChild(main);
    row.appendChild(price);
    row.appendChild(order);
    return row;
  }

  function render(reset) {
    var list = отобранные();
    if (reset) {
      els.list.innerHTML = "";
      shown = 0;
    }
    var slice = list.slice(shown, shown + CHUNK);
    var frag = document.createDocumentFragment();
    slice.forEach(function (item) { frag.appendChild(card(item)); });
    els.list.appendChild(frag);
    shown += slice.length;

    els.more.hidden = shown >= list.length;
    els.status.textContent = list.length
      ? "Показано " + shown + " из " + list.length
      : "По этому запросу ничего не нашлось — попробуйте другое слово или сбросьте фильтр.";
    if (els.reset) els.reset.hidden = !(filters.устройство || filters.модель || filters.узел || filters.поиск || filters.наличие);
  }

  function чип(label, active, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "parts-chip";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(active));
    btn.addEventListener("click", onClick);
    return btn;
  }

  /**
   * Счётчики на фильтрах считаются БЕЗ учёта самого фильтра: выбрав «дисплей»,
   * человек всё равно видит, сколько есть АКБ, и может переключиться одним
   * нажатием. Иначе у выбранного чипа стоит число, а у соседних — нули, и
   * фильтр превращается в тупик.
   */
  function счётчики(поле, кроме) {
    var counts = {};
    all.forEach(function (i) {
      if (!подходит(i, кроме)) return;
      var key = поле(i);
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function рисоватьУстройства() {
    var counts = счётчики(function (i) { return устройствоИз(i.модель); }, "устройство");
    var всего = Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0);
    els.devices.innerHTML = "";
    els.devices.appendChild(чип("Все · " + всего, !filters.устройство, function () {
      filters.устройство = ""; filters.модель = ""; перерисоватьФильтры(); render(true);
    }));
    ПОРЯДОК_УСТРОЙСТВ.forEach(function (d) {
      if (!counts[d]) return;
      els.devices.appendChild(чип(d + " · " + counts[d], filters.устройство === d, function () {
        filters.устройство = filters.устройство === d ? "" : d;
        filters.модель = "";
        перерисоватьФильтры(); render(true);
      }));
    });
  }

  function рисоватьМодели() {
    var counts = счётчики(function (i) { return i.модель; }, "модель");
    var модели = Object.keys(counts).sort(function (a, b) {
      return весМодели(b) - весМодели(a) || a.localeCompare(b, "ru");
    });
    els.model.innerHTML = "";
    var all0 = document.createElement("option");
    all0.value = "";
    all0.textContent = "Все модели";
    els.model.appendChild(all0);
    модели.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m + " · " + counts[m];
      if (m === filters.модель) o.selected = true;
      els.model.appendChild(o);
    });
    // Выбранная модель отвалилась после смены устройства — сбрасываем, иначе
    // список пуст, а причина не видна.
    if (filters.модель && !counts[filters.модель]) filters.модель = "";
    if (els.modelWrap) els.modelWrap.hidden = модели.length < 2;
  }

  function рисоватьУзлы() {
    var counts = счётчики(function (i) { return i.узел; }, "узел");
    var узлы = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b, "ru"); });
    els.chips.innerHTML = "";
    els.chips.appendChild(чип("Любая деталь", !filters.узел, function () {
      filters.узел = ""; перерисоватьФильтры(); render(true);
    }));
    узлы.forEach(function (n) {
      els.chips.appendChild(чип(n + " · " + counts[n], filters.узел === n, function () {
        filters.узел = filters.узел === n ? "" : n;
        перерисоватьФильтры(); render(true);
      }));
    });
  }

  function перерисоватьФильтры() {
    рисоватьУстройства();
    рисоватьМодели();
    рисоватьУзлы();
  }

  function start(data) {
    all = Array.isArray(data.позиции) ? data.позиции : [];
    if (els.count) els.count.textContent = String(data.позиций || all.length);
    if (els.stock) els.stock.textContent = String(data.в_наличии || 0);
    if (els.updated && data.обновлено) {
      var d = new Date(data.обновлено);
      els.updated.textContent = isNaN(d) ? "—" :
        d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
    }
    // Переключатель «только в наличии» прячем, когда в наличии нет НИЧЕГО:
    // фильтр, который всегда даёт пустой список, обманывает — человек решает,
    // что сайт сломался. Сейчас весь прайс Витали идёт под заказ.
    if (els.stockOnlyWrap && !all.some(function (i) { return i.наличие > 0; })) {
      els.stockOnlyWrap.hidden = true;
    }
    перерисоватьФильтры();
    render(true);
  }

  function загрузить() {
    if (запущено) return;
    запущено = true;
    els.status.textContent = "Загружаем прайс…";
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(start)
      .catch(function (err) {
        console.warn("[parts] не загрузился прайс:", err);
        els.status.textContent =
          "Прайс сейчас не загрузился. Позвоните +7 928 850-94-04 — подскажем наличие и цену.";
      });
  }

  /**
   * На вкладке магазина панель запчастей скрыта атрибутом `hidden`. Грузить
   * 923 позиции сразу при открытии магазина незачем — большинство приходит за
   * техникой. Ждём, пока панель станет видимой.
   */
  function запуститьКогдаВидно() {
    var panel = els.list.closest ? els.list.closest("[role=tabpanel]") : null;
    if (!panel) { загрузить(); return; }
    if (!panel.hidden) { загрузить(); return; }
    var observer = new MutationObserver(function () {
      if (!panel.hidden) { observer.disconnect(); загрузить(); }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  }

  function init() {
    els = {
      list: document.getElementById("parts-list"),
      devices: document.getElementById("parts-devices"),
      model: document.getElementById("parts-model"),
      modelWrap: document.getElementById("parts-model-wrap"),
      chips: document.getElementById("parts-chips"),
      status: document.getElementById("parts-status"),
      more: document.getElementById("parts-more"),
      search: document.getElementById("parts-search"),
      stockOnly: document.getElementById("parts-stock-only"),
      stockOnlyWrap: document.getElementById("parts-stock-only-wrap"),
      reset: document.getElementById("parts-reset"),
      count: document.getElementById("parts-count"),
      stock: document.getElementById("parts-stock"),
      updated: document.getElementById("parts-updated"),
    };
    if (!els.list || !els.devices) return;

    els.more.addEventListener("click", function () { render(false); });

    var timer = null;
    els.search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        filters.поиск = els.search.value;
        перерисоватьФильтры();
        render(true);
      }, 150);
    });
    els.model.addEventListener("change", function () {
      filters.модель = els.model.value;
      перерисоватьФильтры();
      render(true);
    });
    if (els.stockOnly) {
      els.stockOnly.addEventListener("change", function () {
        filters.наличие = els.stockOnly.checked;
        перерисоватьФильтры();
        render(true);
      });
    }
    if (els.reset) {
      els.reset.addEventListener("click", function () {
        filters = { устройство: "", модель: "", узел: "", поиск: "", наличие: false };
        els.search.value = "";
        if (els.stockOnly) els.stockOnly.checked = false;
        перерисоватьФильтры();
        render(true);
      });
    }

    запуститьКогдаВидно();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
