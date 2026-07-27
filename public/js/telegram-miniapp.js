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
 *
 * ?tgdebug=1 — временный бейдж в углу с сырыми полями Telegram.WebApp, чтобы
 * понять, почему определение может не срабатывать. Убрать после диагностики.
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

  // Не полагаемся на одно только initData (неясно, всегда ли оно заполняется
  // для web_app-кнопки/кнопки меню, а не только для полноценных Mini Apps
  // через t.me/bot/app) — берём любой из достоверных признаков.
  function isRealTelegramContext(twa) {
    if (!twa) return false;
    if (twa.initData) return true;
    if (twa.platform && twa.platform !== "unknown") return true;
    if (twa.initDataUnsafe && Object.keys(twa.initDataUnsafe).length) return true;
    return false;
  }

  var debugEnabled = /[?&]tgdebug=1\b/.test(window.location.search);
  function showDebug(twa, extra) {
    if (!debugEnabled) return;
    var render = function () {
      var box = document.createElement("pre");
      box.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:999999;margin:0;" +
        "background:#000;color:#0f0;font-size:11px;line-height:1.4;padding:8px;" +
        "max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-all;";
      var info = {
        hash: window.location.hash,
        search: window.location.search,
        hasTelegramObj: !!(window.Telegram && window.Telegram.WebApp),
        initData: twa ? String(twa.initData || "").slice(0, 60) : null,
        initDataUnsafeKeys: twa && twa.initDataUnsafe ? Object.keys(twa.initDataUnsafe) : null,
        platform: twa ? twa.platform : null,
        version: twa ? twa.version : null,
        colorScheme: twa ? twa.colorScheme : null,
        isRealContext: isRealTelegramContext(twa),
        tgMiniAppClass: document.documentElement.classList.contains("tg-miniapp"),
        extra: extra || "",
      };
      box.textContent = "TG DEBUG:\n" + JSON.stringify(info, null, 2);
      document.body.appendChild(box);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", render);
    } else {
      render();
    }
  }

  // Быстрая синхронная догадка по hash — не ждём загрузки SDK, чтобы меньше
  // мигало на первой странице (там, где реально открыл бот).
  var hash = window.location.hash || "";
  if (/tgWebAppData|tgWebAppPlatform/.test(hash)) {
    markMiniApp();
  }

  if (window.Telegram && window.Telegram.WebApp && isRealTelegramContext(window.Telegram.WebApp)) {
    window.IRON_TG_WEBAPP = window.Telegram.WebApp;
    markMiniApp();
    showDebug(window.Telegram.WebApp, "detected before SDK script injected (already present)");
    return;
  }

  var s = document.createElement("script");
  s.src = "https://telegram.org/js/telegram-web-app.js";
  s.onload = function () {
    var twa = window.Telegram && window.Telegram.WebApp;
    if (isRealTelegramContext(twa)) {
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
    showDebug(twa, "after SDK onload");
  };
  s.onerror = function () {
    showDebug(null, "SDK script FAILED to load (CSP/network?)");
  };
  document.head.appendChild(s);
})();
