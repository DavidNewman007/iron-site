/**
 * Оформление заявки: Telegram (@IRON_SERVICE_ORDER_bot) или MAX (бот →
 * рабочий аккаунт IRON SERVICE). Оба канала — только через бота: клиент
 * никогда не видит и не может отредактировать финальный текст, уходящий
 * оператору (см. docs/ORDER-BOT.md §13).
 */
(function (global) {
  var BOOKING_STORAGE_KEY = "iron_max_order";
  var CART_KEY = "iron_cart";

  // Очистка корзины после оформления — везде (мини-апп/десктоп/мобильный),
  // иначе при следующем заходе в корзине снова лежат уже заказанные товары.
  function clearCartStorage() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify([]));
    } catch (e) {
      /* localStorage может быть недоступен — не критично */
    }
  }

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

  // Публичный эндпоинт cloudflare-order-bot: кладёт корзину в KV по токену и
  // отдаёт диплинк на /start у бота. Так заказ уходит оператору полностью
  // собранным сервером (с закупочной ценой), а не редактируемым текстом —
  // раньше здесь была ссылка t.me/ironsochi?text=…, которую клиент мог
  // изменить перед отправкой (см. докстринг openTelegramOrder ниже).
  function getSiteOrderApiUrl() {
    return String(cfg().siteOrderApiUrl || "https://order-bot.4489530.workers.dev/site-order").trim();
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
  // каталога + закупочную цену). Обычный визит в браузере — тот же принцип
  // через /site-order, см. openTelegramOrderViaBot ниже.
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
    // Не полагаемся на одно только initData (неясно, всегда ли оно заполняется
    // для web_app-кнопки reply-клавиатуры/кнопки меню) — берём любой из
    // достоверных признаков (то же самое, что в telegram-miniapp.js).
    if (!twa) return false;
    if (twa.initData) return true;
    if (twa.platform && twa.platform !== "unknown") return true;
    if (twa.initDataUnsafe && Object.keys(twa.initDataUnsafe).length) return true;
    return false;
  }

  // Куда мини-апп шлёт заказ, когда открыт через СИНЮЮ КНОПКУ МЕНЮ бота: в
  // этом режиме Telegram не доставляет sendData боту вообще (sendData работает
  // только при запуске с reply-клавиатуры), зато даёт подписанный initData —
  // бот-воркер проверит подпись и узнает, кому слать подтверждение.
  function getOrderBotApiUrl() {
    return String(cfg().orderBotApiUrl || "https://order-bot.4489530.workers.dev/webapp-order").trim();
  }

  function finishTelegramOrder(twa) {
    clearCartStorage();
    try {
      twa.close();
    } catch (e) {
      /* не критично */
    }
  }

  // Обычный визит на сайт (не открыт как Telegram Mini App) — initData нет и
  // взять неоткуда. Раньше отсюда открывался t.me/ironsochi?text=… с готовым
  // текстом заказа в поле ввода, который клиент мог свободно отредактировать
  // (текст, цену) перед отправкой — оператору в этот момент ничего не уходило
  // автоматически. Вместо этого сохраняем корзину на сервере (см. /site-order
  // в cloudflare-order-bot/src/worker.js) и открываем диплинк на /start у
  // бота: сообщение оператору собирается сервером из каталога с закупочной
  // ценой, клиент его не видит и не может отредактировать ни один символ.
  function submitCartToOrderBot(cart) {
    return fetch(getSiteOrderApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart }),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.ok || !data.botUrl) throw new Error("bad response");
      return data.botUrl;
    });
  }

  function openTelegramOrderViaBot(cart) {
    submitCartToOrderBot(cart)
      .then(function (botUrl) {
        clearCartStorage();
        openExternal(botUrl);
      })
      .catch(function (err) {
        console.warn("[order-channels] site-order failed:", err);
        // Не открываем никакой fallback-ссылки с редактируемым текстом —
        // корзину не чистим, чтобы клиент мог просто попробовать ещё раз.
        global.alert(
          "Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз, " +
            "либо позвоните: " + String(cfg().notifyPhone || "+7 928 850-94-04")
        );
      });
  }

  function openTelegramOrder(cart, options) {
    ensureTelegramWebApp()
      .then(function (twa) {
        if (isRealTelegramWebApp(twa)) {
          if (twa.initData) {
            // Запуск через кнопку меню/ссылку: sendData не сработает — HTTP.
            fetch(getOrderBotApiUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData: twa.initData, items: cart }),
            })
              .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                finishTelegramOrder(twa);
              })
              .catch(function (err) {
                console.warn("[order-channels] webapp-order failed:", err);
                openTelegramOrderViaBot(cart);
              });
            return;
          }
          // Запуск с reply-клавиатуры: штатный sendData (боту придёт
          // web_app_data, мини-апп закроется сам).
          twa.sendData(JSON.stringify({ type: "order", items: cart }));
          finishTelegramOrder(twa);
          return;
        }
        openTelegramOrderViaBot(cart);
      })
      .catch(function () {
        openTelegramOrderViaBot(cart);
      });
  }

  function openMaxOrder(cart, options) {
    // Раньше здесь строился готовый текст заказа и клиент видел на
    // max-book.html кнопку «Скопировать текст заявки» — убрана: она давала
    // ровно ту же лазейку (лифтить текст и отправлять с любыми правками).
    // Теперь на бридж-странице лежит сама корзина, а закупочную цену и
    // финальный текст персоналу собирает max-bot из каталога.
    try {
      sessionStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(cart));
    } catch (e) {
      var text = buildOrderText(cart, options);
      clearCartStorage();
      openExternal(getMaxShareOrderUrl(text));
      return;
    }
    clearCartStorage();
    openExternal(getBookingBridgeUrl());
  }

  global.IRON_ORDER = {
    buildOrderText: buildOrderText,
    formatPrice: formatPrice,
    getMaxShareOrderUrl: getMaxShareOrderUrl,
    getMaxBotUrl: getMaxBotUrl,
    openTelegramOrder: openTelegramOrder,
    openMaxOrder: openMaxOrder,
  };
})(window);
