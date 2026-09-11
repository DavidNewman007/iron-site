/**
 * Вкладки магазина: «Техника» и «Запчасти» на одной странице.
 *
 * Зачем отдельный файл, а не строчка в prices.js: prices.js занят прайсом и
 * корзиной, и в нём уже 3400 строк. Переключение панелей от прайса не зависит
 * и должно работать даже если прайс не загрузился.
 *
 * Адрес страницы получает #tehnika / #zapchasti — ссылка из бота, канала или
 * закладки открывает нужную вкладку сразу. Третья вкладка («Услуги ремонта») —
 * обычная ссылка на uslugi.html, её здесь нет.
 *
 * Заведено 03.09.2026 вместе с редизайном магазина (план 27).
 */
(function () {
  "use strict";

  var TABS = ["tehnika", "zapchasti"];

  function panel(name) {
    return document.getElementById("panel-" + name);
  }
  function button(name) {
    return document.getElementById("tab-btn-" + name);
  }

  function show(name, opts) {
    if (TABS.indexOf(name) === -1) name = "tehnika";
    TABS.forEach(function (t) {
      var p = panel(t);
      var b = button(t);
      var on = t === name;
      if (p) p.hidden = !on;
      if (b) {
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      }
    });
    if (opts && opts.updateHash) {
      // replaceState, а не location.hash: не засоряем историю браузера и не
      // дёргаем прокрутку страницы вверх при каждом переключении.
      try {
        history.replaceState(null, "", "#" + name);
      } catch (e) {
        /* приватный режим может запрещать history */
      }
    }
  }

  // Возвращает null, а не "tehnika", если в адресе не имя вкладки. Это не
  // придирка: на странице есть якоря вне панелей (#dostavka), и по переходу
  // на такой якорь вкладку трогать нельзя — иначе клиент, смотревший
  // «Запчасти», щёлкает «Доставка по России» и оказывается на «Технике».
  // Исправлено 11.09.2026 вместе с блоком доставки; раньше любой чужой хеш
  // молча сбрасывал вкладку на «Технику».
  function fromHash() {
    var h = (location.hash || "").replace(/^#/, "");
    return TABS.indexOf(h) === -1 ? null : h;
  }

  function init() {
    TABS.forEach(function (t) {
      var b = button(t);
      if (!b) return;
      b.addEventListener("click", function () {
        show(t, { updateHash: true });
      });
    });
    show(fromHash() || "tehnika", { updateHash: false });
    window.addEventListener("hashchange", function () {
      var t = fromHash();
      if (t) show(t, { updateHash: false });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
