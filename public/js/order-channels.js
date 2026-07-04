/**
 * Оформление заявки из корзины: Telegram (@ironsochi) или MAX (share deeplink).
 */
(function (global) {
  function cfg() {
    return global.IRON_CONFIG || {};
  }

  function formatPrice(value) {
    const price =
      typeof value === "number"
        ? value
        : parseInt(String(value || "").replace(/[^\d]/g, ""), 10) || 0;
    return price.toLocaleString("ru-RU") + " ₽";
  }

  function buildOrderText(cart, options) {
    options = options || {};
    const items = Array.isArray(cart) ? cart : [];
    const lines = items.map(function (p, i) {
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
    const total = items.reduce(function (s, p) {
      return s + (p.price || 0);
    }, 0);
    const title = options.title || "Заявка с сайта IRON SERVICE";
    const subtitle = options.subtitle || "Хочу купить / забронировать:";
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

  function getMaxShareOrderUrl(text) {
    const base = String(cfg().maxShareUrl || "https://max.ru/:share").replace(/\/$/, "");
    return base + "?text=" + encodeURIComponent(text);
  }

  function getMaxBotUrl() {
    return String(cfg().maxBotUrl || "https://max.ru/id231708534609_bot").trim();
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
    const text = buildOrderText(cart, options);
    openExternal(getTelegramOrderUrl(text));
  }

  function openMaxOrder(cart, options) {
    const text = buildOrderText(cart, options);
    openExternal(getMaxShareOrderUrl(text));
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
