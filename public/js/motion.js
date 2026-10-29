/**
 * Мелкие анимации магазина и услуг (план 92 §5, выбор владельца 29.10.2026: «только мелкие»):
 *  — счётчик позиций на табло «набегает» до нового числа, время обновления прайса «перещёлкивается»;
 *  — выбранный товар или услуга «летит» в корзину (≤200 мс), счётчик корзины коротко вздрагивает.
 *
 * Отдельным файлом и «со стороны»: prices.js и repair-search.js не правятся. Табло слушается через
 * MutationObserver (числа пишет prices.js), кнопки — по клику в фазе перехвата, до их собственных
 * обработчиков. При «уменьшить движение» ничего не делаем. Халфтон-шапку и бегунок вкладок владелец
 * не выбрал (29.10.2026).
 */
(function () {
  "use strict";
  if (!window.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!Element.prototype.animate) return;

  // ——— Табло ———
  function rollCounter(el) {
    // wrote — последний текст, записанный самим счётчиком: наблюдатель срабатывает микрозадачей ПОСЛЕ записи,
    // поэтому флаг «пишу я» не помогает, сравниваем текст.
    var shown = null, wrote = null;
    el.style.fontVariantNumeric = "tabular-nums";   // цифры одной ширины: строка не дрожит, пока число бежит
    // Число с разрядами «24 512», но без хвостового пробела: раньше пробел перед «позиций» уходил в число и терялся.
    function parse(s) { var m = /\d+(?:[\s\u00a0]\d{3})*/.exec(s || ""); return m ? { n: +m[0].replace(/\D/g, ""), at: m.index, len: m[0].length } : null; }
    new MutationObserver(function () {
      var text = el.textContent;
      if (text === wrote) return;
      var p = parse(text);
      if (!p) return;
      var from = shown == null ? 0 : shown, to = p.n;
      shown = to;
      if (from === to) return;
      var head = text.slice(0, p.at), tail = text.slice(p.at + p.len);
      // Ширина — по итоговому тексту: пока число растёт, соседи на табло не сдвигаются (табло при 1200 px впритык).
      el.style.display = "inline-block"; el.style.minWidth = "";
      el.style.minWidth = el.getBoundingClientRect().width + "px";
      var t0 = performance.now(), dur = from === 0 ? 700 : 450;
      (function step(t) {
        // max(0, …): метка кадра rAF — начало кадра, она бывает раньше t0, и число на миг уходило в минус (замер 29.10).
        var k = Math.max(0, Math.min(1, (t - t0) / dur)), e = 1 - Math.pow(1 - k, 3);
        if (shown !== to) return;                      // пришло новое число — его ведёт новый проход
        wrote = head + Math.round(from + (to - from) * e) + tail; el.textContent = wrote;
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
  function flipText(el) {
    var last = el.textContent;
    el.style.display = "inline-block";
    new MutationObserver(function () {
      if (el.textContent === last) return;
      last = el.textContent;
      el.animate([{ transform: "translateY(55%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.8,.3,1)" });
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }
  var count = document.getElementById("board-count"), upd = document.getElementById("board-updated");
  if (count) rollCounter(count);
  if (upd) flipText(upd);

  // ——— Полёт в корзину ———
  function visible(el) {
    if (!el || el.hidden) return null;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    return r;
  }
  // Куда лететь: на телефоне — нижняя плашка корзины, на компьютере — счётчик в панели корзины справа. Если цели
  // на экране нет (панель уехала, плашка ещё не появилась), не летим: точка, улетающая за край, выглядит ошибкой.
  var TARGETS = {
    shop: ["#cart-count-mobile", ".cart-mobile-bar", "#cart-count", "#cart-panel"],
    repair: [".rs-cart-count-mobile", ".rs-cart-bar", ".rs-cart-count", "#rs-cart"]
  };
  function target(kind) {
    var list = TARGETS[kind];
    for (var i = 0; i < list.length; i++) {
      var el = document.querySelector(list[i]), r = visible(el);
      if (r) return { el: el, r: r };
    }
    return null;
  }
  function bump(el) {
    var box = getComputedStyle(el).display === "inline" ? el.parentElement : el;
    if (box) box.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 200, easing: "ease-out" });
  }
  function fly(from, kind, img) {
    // Цель считается кадром позже: корзина и плашка появляются только после того, как prices.js / repair-search.js
    // обработали тот же клик.
    requestAnimationFrame(function () {
      var to = target(kind);
      if (!to) return;
      var size = img ? 54 : 18, x0 = from.left + from.width / 2, y0 = from.top + from.height / 2;
      var x1 = to.r.left + to.r.width / 2, y1 = to.r.top + to.r.height / 2;
      var dot = document.createElement(img ? "img" : "div");
      if (img) { dot.src = img; dot.alt = ""; }
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText = "position:fixed;left:" + (x0 - size / 2) + "px;top:" + (y0 - size / 2) + "px;width:" + size + "px;height:" + size +
        "px;border-radius:" + (img ? "10px" : "50%") + ";object-fit:cover;background:#d4a012;box-shadow:0 0 0 2px #d4a012,0 6px 16px rgba(0,0,0,.45);" +
        "z-index:2147483000;pointer-events:none;will-change:transform,opacity";
      document.body.appendChild(dot);
      var a = dot.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: "translate(" + (x1 - x0) + "px," + (y1 - y0) + "px) scale(.35)", opacity: .75 }
      ], { duration: 200, easing: "cubic-bezier(.35,.1,.6,1)" });
      a.onfinish = a.oncancel = function () { dot.remove(); bump(to.el); };
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest('.price-card__btn[data-action="toggle"], .rs-add');
    if (!b) return;
    // Только добавление: снятие с корзины («✓ В корзине» → «+ Выбрать») не летит.
    if (b.classList.contains("is-active") || b.classList.contains("is-added")) return;
    var shop = b.classList.contains("price-card__btn"), card = shop && b.closest(".price-card");
    var im = card && card.querySelector(".price-card__media img");
    fly(b.getBoundingClientRect(), shop ? "shop" : "repair", im && im.complete && im.naturalWidth ? im.currentSrc || im.src : null);
  }, true);
})();
