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

  function getMaxFunctionUrl() {
    return String(cfg().maxFunctionUrl || "").replace(/\/$/, "");
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

  function submitBookingForm(funcUrl, text) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = funcUrl;
    form.acceptCharset = "UTF-8";

    function addField(name, value) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    addField("action", "prepare_booking_redirect");
    addField("text", text);
    const token = String(cfg().maxBookingPublicToken || "").trim();
    if (token) {
      addField("booking_token", token);
    }

    document.body.appendChild(form);
    form.submit();
  }

  function openMaxBookingRedirect(text) {
    const funcUrl = getMaxFunctionUrl();
    if (!funcUrl) {
      openExternal(getMaxBotUrl());
      return;
    }

    // Redirect через Yandex Function — без fetch/CORS, работает с телефона.
    if (text.length <= 1500) {
      openExternal(
        funcUrl +
          "?action=prepare_booking_redirect&text=" +
          encodeURIComponent(text)
      );
      return;
    }

    submitBookingForm(funcUrl, text);
  }

  function openTelegramOrder(cart, options) {
    const text = buildOrderText(cart, options);
    openExternal(getTelegramOrderUrl(text));
  }

  function openMaxOrder(cart, options) {
    const text = buildOrderText(cart, options);
    openMaxBookingRedirect(text);
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
