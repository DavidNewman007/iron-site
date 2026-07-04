/**
 * Оформление заявки: Telegram (@ironsochi) или MAX (бот → рабочий аккаунт IRON SERVICE).
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

  function getMaxBotUrl() {
    return String(cfg().maxBotUrl || "https://max.ru/id231708534609_bot").trim();
  }

  function parseFunctionResponse(raw) {
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    if (raw.body && typeof raw.body === "string") {
      try {
        return JSON.parse(raw.body);
      } catch (e) {
        return raw;
      }
    }
    return raw;
  }

  function prepareMaxBooking(text) {
    const funcUrl = String(cfg().maxFunctionUrl || "").replace(/\/$/, "");
    const botUrl = getMaxBotUrl();
    if (!funcUrl) {
      return Promise.resolve(botUrl);
    }

    const headers = { "Content-Type": "application/json" };
    const token = String(cfg().maxBookingPublicToken || "").trim();
    if (token) {
      headers["X-Booking-Token"] = token;
    }

    return fetch(funcUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ action: "prepare_booking", text: text }),
    })
      .then(function (res) {
        return res.text().then(function (bodyText) {
          const data = parseFunctionResponse(bodyText);
          if (data && data.bot_url) return data.bot_url;
          return botUrl;
        });
      })
      .catch(function (err) {
        console.warn("[IRON_ORDER] prepareMaxBooking failed:", err);
        return botUrl;
      });
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
    prepareMaxBooking(text).then(function (url) {
      openExternal(url || getMaxBotUrl());
    });
  }

  global.IRON_ORDER = {
    buildOrderText: buildOrderText,
    formatPrice: formatPrice,
    getTelegramOrderUrl: getTelegramOrderUrl,
    getMaxBotUrl: getMaxBotUrl,
    openTelegramOrder: openTelegramOrder,
    openMaxOrder: openMaxOrder,
  };
})(window);
