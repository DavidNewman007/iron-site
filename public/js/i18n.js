/**
 * Локализация интерфейса (17.08.2026).
 *
 * Зачем отдельным модулем: подписи нужны сразу трём скриптам магазина
 * (prices.js, shop-filters.js, order-channels.js) и прайсу услуг. Держать в
 * каждом свою копию словаря — верный способ получить три разных перевода
 * одного слова.
 *
 * ГЛАВНЫЙ ПРИНЦИП: данные не дублируются. Товары и цены приходят из Google
 * Таблицы, услуги — из services.json; переводятся только подписи интерфейса и
 * служебные значения (состояние, тип гарантии). Поэтому новые товары и новые
 * позиции прайса появляются на английской версии САМИ, без правки словаря.
 *
 * Язык определяется по <html lang> — то есть страницей, а не настройкой
 * браузера: посетитель сам выбрал версию переключателем в шапке.
 */
window.IRON_I18N = (function () {
  "use strict";

  // Версия данных. JSON-словари и services.json грузятся из кода, а не из
  // разметки, поэтому версионировать их некому — и браузер продолжал отдавать
  // старый словарь даже после деплоя нового. Поднимать вместе с версией
  // скриптов в HTML (18.08.2026).
  var DATA_VERSION = "2026-08-18-8";

  var lang = (document.documentElement.lang || "ru").slice(0, 2);
  var isEn = lang === "en";
  var dict = null;
  var waiting = [];

  function apply(template, params) {
    if (!params) return template;
    Object.keys(params).forEach(function (k) {
      template = template.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
    });
    return template;
  }

  /** Достать по пути «cart.title» — словарь разбит на секции. */
  function pick(path) {
    if (!dict) return null;
    var node = dict;
    var parts = String(path).split(".");
    for (var i = 0; i < parts.length; i++) {
      if (node == null || typeof node !== "object") return null;
      node = node[parts[i]];
    }
    return typeof node === "string" ? node : null;
  }

  return {
    lang: lang,
    isEn: isEn,

    /**
     * t("cart.title", "Корзина") — русский текст остаётся в коде как значение
     * по умолчанию. Нет словаря или нет ключа — показывается он же: пустых
     * подписей на странице появиться не должно ни при каких обстоятельствах.
     */
    t: function (key, ru, params) {
      if (!isEn) return apply(ru, params);
      return apply(pick(key) || ru, params);
    },

    /** Перевод значения из данных (состояние товара, тип гарантии). */
    value: function (section, raw, params) {
      if (!isEn || !raw) return apply(String(raw || ""), params);
      var found = pick(section + "." + String(raw).trim());
      return apply(found || String(raw), params);
    },

    /**
     * Страна происхождения товара: «🇦🇪 ОАЭ» → «🇦🇪 United Arab Emirates».
     *
     * Название берётся НЕ из словаря, а из флага-эмодзи: два regional
     * indicator symbol дают ISO-код страны, а Intl.DisplayNames переводит его
     * на нужный язык силами самого браузера. Поэтому новая страна в прайсе
     * переведётся сама, без единой правки в коде — а это и был вопрос
     * владельца про «чтобы новые позиции появлялись автоматически».
     *
     * Флага нет или он битый — возвращаем строку как есть.
     */
    country: function (raw) {
      var text = String(raw || "").trim();
      if (!isEn || !text) return text;
      var letters = [];
      var re = /[\u{1F1E6}-\u{1F1FF}]/gu;
      var m;
      while ((m = re.exec(text)) !== null) {
        letters.push(String.fromCharCode(m[0].codePointAt(0) - 0x1F1E6 + 65));
      }
      if (letters.length !== 2) return text;
      var flag = text.match(re) ? text.slice(0, text.search(/[^\u{1F1E6}-\u{1F1FF}\s]/u) || text.length).trim() : "";
      try {
        var name = new Intl.DisplayNames([lang], { type: "region" }).of(letters.join(""));
        if (!name) return text;
        return (flag ? flag + " " : "") + name;
      } catch (e) {
        return text;
      }
    },

    /**
     * Количество: «1шт» → «1 in stock», «под заказ» → «to order».
     * Тоже правилом, а не перечислением: чисел в прайсе сколько угодно.
     */
    quantity: function (raw, inStockTpl, toOrder) {
      var text = String(raw || "").trim();
      if (!isEn || !text) return text;
      var n = text.match(/^(\d+)\s*шт\.?$/i);
      if (n) return apply(pick("shop.in_stock") || inStockTpl || "{n} in stock", { n: n[1] });
      if (/под\s*заказ/i.test(text)) return pick("shop.to_order") || toOrder || "to order";
      return text;
    },

    /**
     * Название товара: техника Apple в прайсе на латинице, а аксессуары и
     * служебные пометки владелец пишет по-русски («Защитное стекло для
     * iPhone 15», «(уценка, не актив., точка на крпусе)»).
     *
     * Три слоя, строго в этом порядке:
     *   1) product_phrases — целые пометки подстрокой. Нужны там, где пословный
     *      перевод бессилен: в пометках владельца встречаются опечатки
     *      («крпусе») и обороты, которые по словам не собираются
     *      («клиентские или после покупки»);
     *   2) «10шт» → «10 pcs» правилом, чисел в прайсе сколько угодно;
     *   3) product_words — пословно по словарю.
     *
     * Так новый товар с теми же словами переводится сам, а незнакомое слово
     * ничего не ломает — см. правило «всё или ничего» ниже.
     */
    productName: function (raw) {
      var text = String(raw || "");
      if (!isEn || !dict || !/[а-яА-ЯёЁ]/.test(text)) return text;
      var words = dict.product_words || {};
      var out = text;

      // Слой 1: целые пометки. Порядок — от длинных к коротким, иначе короткая
      // пометка съест кусок длинной и остаток станет непереводимым.
      var phrases = dict.product_phrases || {};
      Object.keys(phrases)
        .filter(function (k) { return k.charAt(0) !== "_"; })
        .sort(function (a, b) { return b.length - a.length; })
        .forEach(function (k) {
          var safe = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          out = out.replace(new RegExp(safe, "gi"), phrases[k]);
        });

      // Слой 2: количество внутри названия — «Twin Pack 10шт».
      out = out.replace(/(\d+)\s*шт\.?/gi, "$1 pcs");

      if (!/[а-яА-ЯёЁ]/.test(out)) return out.replace(/\s+/g, " ").trim();

      // Слой 3 + ПРАВИЛО «ВСЁ ИЛИ НИЧЕГО». Первая версия переводила пословно, и
      // на живых данных получалась смесь: «Engraved or Замена кнопок», «точка
      // for крпусе». Читать такое хуже, чем чистый русский, — и выглядит как
      // поломка, а не как перевод. Поэтому: не знаем хотя бы одно русское слово
      // (опечатка владельца, редкая пометка) — возвращаем ИСХОДНУЮ строку
      // целиком, а не наполовину переведённую. Проверено 17.08.2026 на боевом
      // прайсе, расширено словарём и пометками 18.08.2026.
      var unknown = false;
      out = out.replace(/[а-яА-ЯёЁ][а-яА-ЯёЁ-]*/g, function (word) {
        var hit = words[word.toLowerCase()];
        if (!hit) { unknown = true; return word; }
        return /^[А-ЯЁ]/.test(word) ? hit.charAt(0).toUpperCase() + hit.slice(1) : hit;
      });
      return unknown ? text : out.replace(/\s+/g, " ").trim();
    },

    /**
     * Заголовок группы товаров: «🔘 Яндекс Станция», «🛡 Стекло 3D Remax».
     *
     * Часть заголовков приходит из таблицы, часть собирает сам магазин
     * (resolveAccessorySection в prices.js). Сначала точное совпадение по
     * словарю sections — оно надёжнее для заголовков, собранных кодом; если
     * заголовка в словаре нет, работает тот же пословный механизм, что и у
     * названий товаров. Новая категория в таблице переведётся сама, если
     * состоит из знакомых слов, и останется русской, если нет.
     */
    section: function (raw) {
      var text = String(raw || "").trim();
      if (!isEn || !text) return text;
      var exact = pick("sections." + text);
      return exact || this.productName(text);
    },

    /** Версия данных для любого файла, который грузится из кода. */
    url: function (path) {
      return path + (path.indexOf("?") >= 0 ? "&" : "?") + "v=" + DATA_VERSION;
    },

    /** Загрузка словаря. На русской версии не делает ни одного запроса. */
    load: function (url) {
      if (!isEn) return Promise.resolve(null);
      return fetch(this.url(url))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          dict = data;
          waiting.forEach(function (fn) { try { fn(); } catch (e) { /* подписчик сам виноват */ } });
          waiting = [];
          return data;
        })
        .catch(function () {
          // Словарь не загрузился — работаем на русских подписях. Магазин без
          // перевода лучше, чем магазин без товаров.
          return null;
        });
    },

    /** Вызвать, когда словарь готов (или сразу, если он не нужен). */
    ready: function (fn) {
      if (!isEn || dict) { fn(); return; }
      waiting.push(fn);
    }
  };
})();
