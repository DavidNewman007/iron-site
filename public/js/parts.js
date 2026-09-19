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
  var filters = { устройство: "", серия: "", модель: "", класс: "", узел: "", поиск: "", наличие: false };
  var запущено = false;

  var els = {};
  var ряды = {};

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

  // ——— разделы: устройство → серия → модель → класс детали ——————————
  //
  // Было (19.09.2026, первая версия): устройство, выпадающий список из 72
  // моделей и один ряд из 21 чипа. Владелец: «всё в кучу, сделай
  // структурированные фильтры — макбуки, внутри какие макбуки, внутри по
  // классам запчастей». В списке моделей вперемешку лежали «iPhone SE 2016»,
  // «СЗУ USB-C 20W 1:1» и «LCD Матрица Macbook Pro 14.2 A2442 / A2779 / A2918
  // / A2992 Оригинал» — то есть телефон, зарядка и целое название товара
  // одним списком.
  //
  // Образец, на который указал владелец, — detaliapple.ru. Там дерево:
  // устройство (MacBook Air / MacBook Pro / iPhone / Watch / Аксессуары) →
  // модель или диагональ (MacBook Air 11" / 13" / 15", iPhone 17 Pro Max) →
  // категория детали (Аккумуляторы, Дисплеи, Матрицы, Шлейфы). Повторяем ту же
  // лестницу, только чипами, а не страницами.
  //
  // Каждый ряд прячется, когда выбирать в нём не из чего (меньше двух
  // значений) или когда не выбран родитель. Иначе лестница снова превращается
  // в кучу — уже из пустых рядов.

  var ПОРЯДОК_УСТРОЙСТВ = ["iPhone", "Apple Watch", "MacBook", "Аксессуары"];

  function устройствоИз(модель) {
    var m = String(модель || "");
    if (/^iphone/i.test(m)) return "iPhone";
    if (/watch/i.test(m)) return "Apple Watch";
    if (/macbook|imac/i.test(m)) return "MacBook";
    return "Аксессуары";
  }

  /**
   * У поставщика модель макбука лежит целой строкой товара:
   * «LCD Матрица Macbook Alr 13 A2337 Оригинал». В фильтре такое читать нельзя,
   * поэтому вытаскиваем тип, диагональ и A-номера.
   * «Alr» — опечатка поставщика вместо «Air», встречается в данных как есть.
   */
  function макбукМодель(raw) {
    var тип = /\bpro\b/i.test(raw) ? "Pro" : /\b(air|alr)\b/i.test(raw) ? "Air" : "";
    var диаг = (String(raw).match(/\b(\d{2}(?:[.,]\d)?)\b/) || [])[1] || "";
    var номера = String(raw).match(/A\d{4}/gi) || [];
    return ("MacBook " + тип).trim()
      + (диаг ? " " + диаг.replace(",", ".") + "″" : "")
      + (номера.length ? " (" + номера.join(" / ") + ")" : "");
  }

  /** Подпись модели в фильтре. Для макбуков — разобранная, для остального как есть. */
  function подписьМодели(модель) {
    return устройствоИз(модель) === "MacBook" ? макбукМодель(модель) : String(модель || "");
  }

  /**
   * Серия — средняя ступень. У iPhone их тринадцать по три-пять моделей, и без
   * неё ряд моделей снова был бы на полсотни значений.
   */
  function серияИз(модель) {
    var устройство = устройствоИз(модель);
    var m = String(модель || "");
    if (устройство === "iPhone") {
      var ном = m.match(/^iPhone\s+(\d{1,2})/i);
      if (ном) return "iPhone " + ном[1];
      if (/^iPhone\s+SE/i.test(m)) return "iPhone SE";
      if (/^iPhone\s+X/i.test(m)) return "iPhone X · XR · XS";
      return "iPhone — прочие";
    }
    if (устройство === "Apple Watch") {
      var s = m.match(/s(\d+)/i);
      return s ? "Apple Watch S" + s[1] : "Apple Watch";
    }
    if (устройство === "MacBook") return /\bpro\b/i.test(m) ? "MacBook Pro" : "MacBook Air";
    return "";
  }

  /** Новые серии сверху: «iPhone 17» выше «iPhone 11», буквенные — в конце. */
  function весСерии(серия) {
    var m = серия.match(/(\d{1,2})/);
    return m ? Number(m[1]) : -1;
  }

  function весМодели(модель) {
    var m = String(модель).match(/(\d{1,2})/);
    var номер = m ? Number(m[1]) : 0;
    var ранг = /pro max/i.test(модель) ? 4 : /\bpro\b/i.test(модель) ? 3
      : /plus/i.test(модель) ? 2 : /mini|air/i.test(модель) ? 1 : 0;
    return номер * 10 + ранг;
  }

  /**
   * Классы деталей — та же группировка, что разделами у detaliapple.ru.
   * Узел, которого здесь нет, попадает в «Прочее», а не теряется.
   */
  //
  // ⚠️ Имя класса обязано содержать слово, которым деталь называют вслух
  // (19.09.2026). Первая раскладка называла класс с аккумуляторами «Питание и
  // зарядка», и владелец «долго искал, где же аккумуляторы в айфонах»: слова
  // «АКБ» на экране не было вовсе. Из-за той же ошибки пряталась самая
  // многочисленная деталь прайса — заднее стекло, 243 позиции, лежавшее под
  // вывеской «Корпус и задняя крышка».
  //
  // Аккумуляторы вынесены в свой класс, а не просто переименованы: зарядки,
  // кабели и переходники внутри «Аккумуляторов» были бы обманом. Их класс
  // теперь называется своими словами.
  var КЛАССЫ = [
    { имя: "Дисплеи", узлы: ["дисплей", "защитное стекло"] },
    { имя: "Аккумуляторы (АКБ)", узлы: ["АКБ"] },
    { имя: "Задние стёкла и корпус", узлы: ["заднее стекло", "корпус", "стекло камеры", "проклейка", "магнит MagSafe"] },
    { имя: "Камеры", узлы: ["камера", "фронтальная камера", "шлейф вспышки"] },
    { имя: "Динамики", узлы: ["слуховой динамик", "полифонический динамик"] },
    { имя: "Шлейфы и антенны", узлы: ["нижний шлейф", "шлейф кнопок", "шлейф датчика приближения", "антенна"] },
    { имя: "Материнские платы", узлы: ["материнская плата"] },
    { имя: "Зарядки и кабели", узлы: ["зарядное устройство", "кабель", "переходник"] },
  ];

  var КЛАСС_ПО_УЗЛУ = (function () {
    var map = {};
    КЛАССЫ.forEach(function (k) { k.узлы.forEach(function (u) { map[u] = k.имя; }); });
    return map;
  })();

  function классИз(узел) {
    return КЛАСС_ПО_УЗЛУ[узел] || "Прочее";
  }

  /**
   * Подходит ли позиция под фильтры. `кроме` исключает одну ступень — так
   * считаются счётчики: выбрав «дисплеи», человек всё равно видит, сколько
   * есть АКБ, и переключается одним нажатием.
   */
  function подходит(item, кроме) {
    if (кроме !== "устройство" && filters.устройство && устройствоИз(item.модель) !== filters.устройство) return false;
    if (кроме !== "серия" && filters.серия && серияИз(item.модель) !== filters.серия) return false;
    if (кроме !== "модель" && filters.модель && item.модель !== filters.модель) return false;
    if (кроме !== "класс" && filters.класс && классИз(item.узел) !== filters.класс) return false;
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
    if (els.reset) els.reset.hidden = !(ЛЕСТНИЦА.some(function (f) { return filters[f]; }) || filters.поиск || filters.наличие);
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

  /** Счётчики по ступени, посчитанные БЕЗ учёта её самой (см. `подходит`). */
  function счётчики(поле, кроме) {
    var counts = {};
    all.forEach(function (i) {
      if (!подходит(i, кроме)) return;
      var key = поле(i);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  /**
   * Рисует одну ступень лестницы.
   * @param {object} ряд  контейнер и подпись
   * @param {string} поле имя фильтра
   * @param {function} ключИз как достать значение из позиции
   * @param {object} опции  сортировка, подпись значения, подпись «всё»
   */
  function ступень(ряд, поле, ключИз, опции) {
    var counts = счётчики(ключИз, поле);
    var значения = Object.keys(counts).sort(опции.сорт);
    // Ступень открывается только после выбора на предыдущей — так же, как
    // разделы у detaliapple.ru открываются кликом по устройству, а не висят
    // все сразу. Иначе «Серия» и «Модель» вываливают полсотни значений ещё до
    // того, как человек сказал, что у него iPhone, и это ровно та куча, из-за
    // которой фильтры и переделывались.
    // Прячем и когда выбирать не из чего: один вариант — не выбор, а лишний
    // ряд. Выбранное значение при этом сохраняем, иначе фильтр сбрасывался бы
    // сам при сужении.
    var прятать = опции.родитель === false
      || (значения.length < 2 && !filters[поле]);
    ряд.блок.hidden = прятать;
    if (прятать) { ряд.чипы.innerHTML = ""; return; }

    ряд.чипы.innerHTML = "";
    var всего = значения.reduce(function (s, k) { return s + counts[k]; }, 0);
    ряд.чипы.appendChild(чип(опции.всё + " · " + всего, !filters[поле], function () {
      выбрать(поле, "");
    }));
    значения.forEach(function (v) {
      ряд.чипы.appendChild(чип((опции.подпись ? опции.подпись(v) : v) + " · " + counts[v], filters[поле] === v, function () {
        выбрать(поле, filters[поле] === v ? "" : v);
      }));
    });
  }

  /**
   * Выбор на ступени сбрасывает всё, что ниже. Без этого остаётся «iPhone 17
   * Pro Max» внутри выбранного Apple Watch — пустой список без объяснения.
   */
  var ЛЕСТНИЦА = ["устройство", "серия", "модель", "класс", "узел"];

  function выбрать(поле, значение) {
    filters[поле] = значение;
    ЛЕСТНИЦА.slice(ЛЕСТНИЦА.indexOf(поле) + 1).forEach(function (ниже) {
      filters[ниже] = "";
    });
    перерисоватьФильтры();
    render(true);
  }

  function перерисоватьФильтры() {
    ступень(ряды.устройство, "устройство", function (i) { return устройствоИз(i.модель); }, {
      всё: "Все устройства",
      сорт: function (a, b) { return ПОРЯДОК_УСТРОЙСТВ.indexOf(a) - ПОРЯДОК_УСТРОЙСТВ.indexOf(b); },
    });
    ступень(ряды.серия, "серия", function (i) { return серияИз(i.модель); }, {
      всё: "Все серии",
      родитель: Boolean(filters.устройство),
      сорт: function (a, b) { return весСерии(b) - весСерии(a) || a.localeCompare(b, "ru"); },
    });
    ступень(ряды.модель, "модель", function (i) { return i.модель; }, {
      всё: "Все модели",
      родитель: Boolean(filters.серия),
      подпись: подписьМодели,
      сорт: function (a, b) { return весМодели(b) - весМодели(a) || a.localeCompare(b, "ru"); },
    });
    ступень(ряды.класс, "класс", function (i) { return классИз(i.узел); }, {
      всё: "Любая деталь",
      сорт: function (a, b) {
        var ia = КЛАССЫ.findIndex(function (k) { return k.имя === a; });
        var ib = КЛАССЫ.findIndex(function (k) { return k.имя === b; });
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      },
    });
    // Последняя ступень появляется только внутри выбранного класса: иначе это
    // снова один ряд из двадцати одного значения, с которого всё началось.
    //
    // Исключение — когда класс в текущем срезе ОДИН: у аксессуаров это всегда
    // «Питание и зарядка», у макбуков «Дисплеи и стёкла». Выбирать там нечего,
    // ряд классов прячется, и без этого исключения человек оставался бы вообще
    // без фильтра по детали, хотя зарядки, кабели и переходники различать надо.
    var классовВСрезе = Object.keys(счётчики(function (i) { return классИз(i.узел); }, "класс")).length;
    ступень(ряды.узел, "узел", function (i) { return i.узел; }, {
      всё: "Все в классе",
      родитель: Boolean(filters.класс) || классовВСрезе <= 1,
      сорт: function (a, b) { return a.localeCompare(b, "ru"); },
    });
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

  /** Ступень = подпись + контейнер чипов. Прячем блок целиком, а не только чипы. */
  function ряд(имя) {
    return {
      блок: document.getElementById("parts-step-" + имя),
      чипы: document.getElementById("parts-" + имя),
    };
  }

  function init() {
    els = {
      list: document.getElementById("parts-list"),
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
    ряды = {
      устройство: ряд("devices"),
      серия: ряд("series"),
      модель: ряд("models"),
      класс: ряд("classes"),
      узел: ряд("nodes"),
    };
    if (!els.list || !ряды.устройство.чипы) return;

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
    if (els.stockOnly) {
      els.stockOnly.addEventListener("change", function () {
        filters.наличие = els.stockOnly.checked;
        перерисоватьФильтры();
        render(true);
      });
    }
    if (els.reset) {
      els.reset.addEventListener("click", function () {
        filters = { устройство: "", серия: "", модель: "", класс: "", узел: "", поиск: "", наличие: false };
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
