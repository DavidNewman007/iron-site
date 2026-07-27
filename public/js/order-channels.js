/**
 * Оформление заявки: Telegram (@ironsochi) или MAX (бот → рабочий аккаунт IRON SERVICE).
 */
(function (global) {
  var BOOKING_STORAGE_KEY = "iron_max_order";

  function cfg() {
    return global.IRON_CONFIG || {};
  }

  function formatPrice(value) {
    var price =
      typeof value === "number"
        ? value
        : parseInt(String(value || "").replace(/[^\d]/g, ""), 10) || 0;
    return price.toLocaleString("ru-RU") + " ₽";
  }

  function buildOrderText(cart, options) {
    options = options || {};
    var items = Array.isArray(cart) ? cart : [];
    var lines = items.map(function (p, i) {
      return (
        (i + 1) +
        ". " +
        p.name +
        (p.country ? " " + p.country : "") +
        (p.warehouse ? " " + p.warehouse : "") +
        " — " +
        (p.priceLabel || formatPrice(p.price))
      );
    });
    var total = items.reduce(function (s, p) {
      return s + (p.price || 0);
    }, 0);
    return [lines.join("\n"), "", "Итого ориентир: " + formatPrice(total)].join("\n");
  }

  function getTelegramUser() {
    return String(cfg().telegramOrderUser || "ironsochi").replace(/^@/, "");
  }

  function getTelegramOrderUrl(text) {
    return "https://t.me/" + getTelegramUser() + "?text=" + encodeURIComponent(text);
  }

  function getMaxBotUrl() {
    return String(cfg().maxBotUrl || "https://max.ru/id231708534609_bot").trim();
  }

  function getMaxShareOrderUrl(text) {
    var base = String(cfg().maxShareUrl || "https://max.ru/:share").replace(/\/$/, "");
    return base + "?text=" + encodeURIComponent(text);
  }

  function getBookingBridgeUrl() {
    var siteUrl = String(cfg().siteUrl || global.location.origin || "").replace(/\/$/, "");
    if (siteUrl) {
      return siteUrl + "/max-book.html";
    }
    return "max-book.html";
  }

  function openExternal(url) {
    try {
      global.location.href = url;
      return;
    } catch (e) {
      /* fallback */
    }
    global.open(url, "_blank", "noopener,noreferrer");
  }

  // Если страница открыта как мини-приложение бота @IRON_SERVICE_ORDER_bot
  // (кнопка «Каталог на сайте» / синяя кнопка меню) — грузим SDK Telegram Web
  // App и отдаём заказ через sendData прямо боту (тот шлёт оператору строку
  // каталога + закупочную цену). Обычный визит в браузере — без изменений,
  // старая ссылка-заготовка в @ironsochi как и раньше.
  function ensureTelegramWebApp() {
    if (global.Telegram && global.Telegram.WebApp) {
      return Promise.resolve(global.Telegram.WebApp);
    }
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.onload = function () {
        resolve(global.Telegram && global.Telegram.WebApp);
      };
      s.onerror = function () {
        reject(new Error("Telegram WebApp SDK не загрузился"));
      };
      document.head.appendChild(s);
    });
  }

  function isRealTelegramWebApp(twa) {
    // initData пустой в обычном браузере даже если скрипт как-то загрузился —
    // непустой бывает только когда страницу реально открыл клиент Telegram.
    return Boolean(twa && twa.initData);
  }

  function openTelegramOrder(cart, options) {
    ensureTelegramWebApp()
      .then(function (twa) {
        if (isRealTelegramWebApp(twa)) {
          twa.sendData(JSON.stringify({ type: "order", items: cart }));
          try {
            twa.close();
          } catch (e) {
            /* не критично */
          }
          return;
        }
        var text = buildOrderText(cart, options);
        openExternal(getTelegramOrderUrl(text));
      })
      .catch(function () {
        var text = buildOrderText(cart, options);
        openExternal(getTelegramOrderUrl(text));
      });
  }

  function openMaxOrder(cart, options) {
    var text = buildOrderText(cart, options);
    try {
      sessionStorage.setItem(BOOKING_STORAGE_KEY, text);
    } catch (e) {
      openExternal(getMaxShareOrderUrl(text));
      return;
    }
    openExternal(getBookingBridgeUrl());
  }

  global.IRON_ORDER = {
    buildOrderText: buildOrderText,
    formatPrice: formatPrice,
    getTelegramOrderUrl: getTelegramOrderUrl,
    getMaxShareOrderUrl: getMaxShareOrderUrl,
    getMaxBotUrl: getMaxBotUrl,
    openTelegramOrder: openTelegramOrder,
    openMaxOrder: openMaxOrder,
  };
})(window);
