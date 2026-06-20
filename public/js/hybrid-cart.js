(function () {
  const CART_KEY = "iron_cart";
  const PID_PARAM = "pid";
  const LEGACY_COUNTRY_TOKENS = new Set([
    "япония",
    "индия",
    "европа",
    "германия",
    "сша",
    "китай",
    "корея",
    "гонконг",
    "сингапур",
    "оаэ",
    "тайвань",
    "россия",
  ]);

  function parsePrice(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }

  function formatPrice(value) {
    const price = typeof value === "number" ? value : parsePrice(value);
    return price.toLocaleString("ru-RU") + " ₽";
  }

  function normalizeCartIdForCompare(id) {
    const raw = String(id || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-z0-9а-я]+/giu, "-")
      .replace(/^-+|-+$/g, "");
    if (!raw) return "";
    return raw
      .split("-")
      .filter(Boolean)
      .filter((token) => !LEGACY_COUNTRY_TOKENS.has(token))
      .map((token) => {
        const gbMatch = token.match(/^(\d{2,4})gb$/u);
        if (gbMatch) return gbMatch[1];
        if (token === "1tb") return "1024";
        if (token === "2tb") return "2048";
        return token;
      })
      .join("-");
  }

  function idsLookEqual(leftId, rightId) {
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;
    const leftNorm = normalizeCartIdForCompare(leftId);
    const rightNorm = normalizeCartIdForCompare(rightId);
    if (!leftNorm || !rightNorm) return false;
    return leftNorm === rightNorm;
  }

  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      const input = Array.isArray(raw) ? raw : raw?.items;
      if (!Array.isArray(input)) return [];
      return input.filter((item) => item && item.id);
    } catch (_) {
      return [];
    }
  }

  function dedupeCartById(items) {
    const out = [];
    for (const item of items || []) {
      if (!item?.id) continue;
      if (out.some((existing) => idsLookEqual(existing.id, item.id))) continue;
      out.push(item);
    }
    return out;
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(dedupeCartById(items)));
  }

  function getCartIndex(cart, productId) {
    if (!productId) return -1;
    return cart.findIndex((item) => idsLookEqual(item?.id, productId));
  }

  function resolveProductId(pickBtn) {
    const urlPid = new URLSearchParams(window.location.search).get(PID_PARAM);
    const canonical = String(urlPid || "").trim();
    if (canonical) return canonical;
    return String(pickBtn?.dataset?.id || "").trim();
  }

  function buildCartItem(pickBtn, productId) {
    const price = parsePrice(pickBtn.dataset.price);
    return {
      id: productId,
      name: String(pickBtn.dataset.name || "").trim(),
      country: String(pickBtn.dataset.country || "").trim(),
      warehouse: String(pickBtn.dataset.warehouse || "").trim(),
      price,
      priceLabel: formatPrice(price),
    };
  }

  function syncPickBtn(pickBtn) {
    if (!pickBtn) return;
    const productId = resolveProductId(pickBtn);
    const inCart = getCartIndex(readCart(), productId) >= 0;
    pickBtn.textContent = inCart ? "✓ В корзине" : "+ Выбрать";
    pickBtn.classList.toggle("is-active", inCart);
  }

  function initDetailCart() {
    const pickBtn = document.getElementById("pickBtn");
    if (!pickBtn || pickBtn.dataset.cartBound === "1") return;
    pickBtn.dataset.cartBound = "1";

    pickBtn.addEventListener("click", () => {
      const productId = resolveProductId(pickBtn);
      if (!productId) return;

      let cart = readCart();
      const idx = getCartIndex(cart, productId);
      if (idx >= 0) {
        cart = cart.filter((item) => !idsLookEqual(item?.id, productId));
      } else {
        cart.push(buildCartItem(pickBtn, productId));
      }
      writeCart(cart);
      syncPickBtn(pickBtn);
    });

    syncPickBtn(pickBtn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDetailCart);
  } else {
    initDetailCart();
  }
})();
