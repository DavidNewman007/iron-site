/**
 * Определяет, открыта ли страница как Telegram Mini App (кнопка бота
 * @IRON_SERVICE_ORDER_bot — «Каталог» в меню или инлайн-кнопка «🌐 Каталог
 * на сайте»), и если да — прячет всё, что внутри бота не нужно: шапку/подвал
 * с ссылками на другие страницы сайта, промо-блок, запасные способы
 * бронирования (MAX, оплата онлайн) — оставляя только каталог/корзину и
 * единственную кнопку «Оформить заказ» (уходит боту через sendData, см.
 * order-channels.js).
 *
 * НЕ подключается при обычном заходе в браузере — класс "tg-miniapp"
 * появляется только когда это подтверждено (по hash сразу при заходе, либо
 * позже через сам SDK — на внутренних переходах хэша уже может не быть).
 * Не влияет на desktop/mobile версию сайта вне Telegram.
 */
(function () {
  function hideExtras() {
    var run = function () {
      var toHide = document.querySelectorAll(
        ".site-header, .site-footer, #promo-cards-section, " +
        "#cart-max, #hybrid-cart-max, #cart-pay, #hybrid-cart-pay"
      );
      toHide.forEach(function (el) {
        el.hidden = true;
      });
      var tgBtn = document.getElementById("cart-telegram") || document.getElementById("hybrid-cart-telegram");
      if (tgBtn) tgBtn.textContent = "✅ Оформить заказ";
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run);
    } else {
      run();
    }
  }

  function markMiniApp() {
    if (document.documentElement.classList.contains("tg-miniapp")) return;
    document.documentElement.classList.add("tg-miniapp");
    hideExtras();
  }

  // Быстрая синхронная догадка по hash — не ждём загрузки SDK, чтобы меньше
  // мигало на первой странице (там, где реально открыл бот).
  var hash = window.location.hash || "";
  if (/tgWebAppData|tgWebAppPlatform/.test(hash)) {
    markMiniApp();
  }

  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
    window.IRON_TG_WEBAPP = window.Telegram.WebApp;
    markMiniApp();
    return;
  }

  var s = document.createElement("script");
  s.src = "https://telegram.org/js/telegram-web-app.js";
  s.onload = function () {
    var twa = window.Telegram && window.Telegram.WebApp;
    if (twa && twa.initData) {
      window.IRON_TG_WEBAPP = twa;
      try {
        twa.ready();
      } catch (e) {
        /* не критично */
      }
      try {
        twa.expand();
      } catch (e) {
        /* не критично */
      }
      markMiniApp();
    }
  };
  document.head.appendChild(s);
})();
