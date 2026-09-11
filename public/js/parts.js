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
 */
(function () {
  "use strict";

  var DATA_URL = "data/parts.json";
  var BOT = "IRON_SERVICE_ORDER_bot";
  var CHUNK = 40;

  var all = [];
  var shown = 0;
  var filters = { узел: "", поиск: "", наличие: false };

  var els = {};

  function money(value) {
    return Number(value).toLocaleString("ru-RU") + " ₽";
  }

  function norm(text) {
    return String(text || "").toLowerCase().replace(/ё/g, "е").trim();
  }

  function matches(item) {
    if (filters.узел && item.узел !== filters.узел) return false;
    if (filters.наличие && !(item.наличие > 0)) return false;
    if (!filters.поиск) return true;
    var haystack = norm([item.узел, item.модель, item.вариант, item.цвет].join(" "));
    // Все слова запроса должны найтись: «13 про дисплей» — это три условия,
    // а не одна строка, иначе порядок слов начинает решать за клиента.
    return norm(filters.поиск).split(/\s+/).every(function (word) {
      return haystack.indexOf(word) !== -1;
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
    meta.innerHTML = bits.map(function (b, i) {
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

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function render(reset) {
    var list = all.filter(matches);
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
  }

  function buildChips() {
    var counts = {};
    all.forEach(function (i) { counts[i.узел] = (counts[i.узел] || 0) + 1; });
    var nodes = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });

    var chips = [{ key: "", label: "Все детали" }].concat(
      nodes.map(function (n) { return { key: n, label: n + " · " + counts[n] }; })
    );
    chips.forEach(function (chip) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "parts-chip";
      btn.textContent = chip.label;
      btn.setAttribute("aria-pressed", String(filters.узел === chip.key));
      btn.addEventListener("click", function () {
        filters.узел = chip.key;
        Array.prototype.forEach.call(els.chips.children, function (el) {
          el.setAttribute("aria-pressed", String(el === btn));
        });
        render(true);
      });
      els.chips.appendChild(btn);
    });
  }

  function start(data) {
    all = Array.isArray(data.позиции) ? data.позиции : [];
    els.count.textContent = String(data.позиций || all.length);
    els.stock.textContent = String(data.в_наличии || 0);
    if (data.обновлено) {
      var d = new Date(data.обновлено);
      els.updated.textContent = isNaN(d) ? "—" :
        d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
    }
    buildChips();
    render(true);
  }

  document.addEventListener("DOMContentLoaded", function () {
    els = {
      list: document.getElementById("parts-list"),
      chips: document.getElementById("parts-chips"),
      status: document.getElementById("parts-status"),
      more: document.getElementById("parts-more"),
      search: document.getElementById("parts-search"),
      stockOnly: document.getElementById("parts-stock-only"),
      count: document.getElementById("parts-count"),
      stock: document.getElementById("parts-stock"),
      updated: document.getElementById("parts-updated"),
    };
    if (!els.list) return;

    els.more.addEventListener("click", function () { render(false); });

    var timer = null;
    els.search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        filters.поиск = els.search.value;
        render(true);
      }, 150);
    });
    els.stockOnly.addEventListener("change", function () {
      filters.наличие = els.stockOnly.checked;
      render(true);
    });

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
  });
})();
