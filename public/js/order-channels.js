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
    var title = options.title || "Заявка с сайта IRON SERVICE";
    var subtitle = options.subtitle || "Хочу купить / забронировать:";
    return [title, subtitle, "", lines.join("\n"), "", "Итого ориентир: " + formatPrice(total)].join(
      "\n"
    );
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

  function openTelegramOrder(cart, options) {
    var text = buildOrderText(cart, options);
    openExternal(getTelegramOrderUrl(text));
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
