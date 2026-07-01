(function () {
  const CART_KEY = "iron_cart";
  const params = new URLSearchParams(window.location.search);
  const token = String(params.get("t") || "").trim();

  const els = {
    status: document.getElementById("offerStatus"),
    content: document.getElementById("offerContent"),
    title: document.getElementById("offerTitle"),
    image: document.getElementById("offerImage"),
    retail: document.getElementById("offerRetail"),
    special: document.getElementById("offerSpecial"),
    expiry: document.getElementById("offerExpiry"),
    addCart: document.getElementById("offerAddCart"),
    catalogLink: document.getElementById("offerCatalogLink"),
    cartBar: document.getElementById("offerCartBar"),
    cartCount: document.getElementById("offer-cart-count"),
    cartTotal: document.getElementById("offer-cart-total"),
    cartToggle: document.getElementById("offer-cart-toggle"),
  };

  let currentOffer = null;

  function formatPrice(value) {
    const price = typeof value === "number" ? value : parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return (price || 0).toLocaleString("ru-RU") + " ₽";
  }

  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      const input = Array.isArray(raw) ? raw : raw?.items;
      return Array.isArray(input) ? input.filter((item) => item && item.id) : [];
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    renderCartBar();
  }

  function clearCart() {
    writeCart([]);
    if (els.addCart) els.addCart.textContent = "+ В корзину по спеццене";
  }

  function getTelegramUser() {
    return String(window.IRON_CONFIG?.telegramOrderUser || "ironsochi").replace(/^@/, "");
  }

  function renderCartBar() {
    const cart = readCart();
    const count = cart.length;
    const total = cart.reduce((s, p) => s + (p.price || 0), 0);
    if (els.cartCount) els.cartCount.textContent = String(count);
    if (els.cartTotal) els.cartTotal.textContent = count ? formatPrice(total) : "—";
    if (els.cartBar) els.cartBar.hidden = false;
  }

  function openTelegramOrder() {
    const cart = readCart();
    if (!cart.length) return;
    const lines = cart.map(
      (p, i) =>
        `${i + 1}. ${p.name}${p.country ? " " + p.country : ""}${p.warehouse ? " " + p.warehouse : ""} — ${p.priceLabel || formatPrice(p.price)}`
    );
    const total = cart.reduce((s, p) => s + (p.price || 0), 0);
    const text = [
      "Заявка с сайта IRON SERVICE",
      "Персональное предложение",
      "",
      ...lines,
      "",
      `Итого ориентир: ${formatPrice(total)}`,
    ].join("\n");
    window.open(
      `https://t.me/${getTelegramUser()}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
    clearCart();
  }

  function setOgMeta(offer) {
    const title = offer.productName + " — IRON SERVICE";
    document.title = title;
    const ogTitle = document.getElementById("og-title");
    const ogDesc = document.getElementById("og-description");
    const ogImage = document.getElementById("og-image");
    if (ogTitle) ogTitle.setAttribute("content", title);
    if (ogDesc) {
      ogDesc.setAttribute(
        "content",
        `Спеццена ${formatPrice(offer.offerPrice)} вместо ${formatPrice(offer.retailPrice)}`
      );
    }
    if (ogImage && offer.coverUrl) ogImage.setAttribute("content", offer.coverUrl);
  }

  function showError(message, expired) {
    if (els.status) {
      els.status.textContent = message;
      if (expired) els.status.classList.add("offer-expired");
    }
    if (els.content) els.content.hidden = true;
  }

  function renderOffer(offer) {
    currentOffer = offer;
    setOgMeta(offer);
    if (els.status) els.status.hidden = true;
    if (els.content) els.content.hidden = false;
    if (els.title) els.title.textContent = offer.productName;
    if (els.retail) els.retail.textContent = formatPrice(offer.retailPrice);
    if (els.special) els.special.textContent = formatPrice(offer.offerPrice);
    if (els.expiry && offer.expiresAt) {
      const dt = new Date(offer.expiresAt);
      els.expiry.textContent = "Предложение действует до " + dt.toLocaleString("ru-RU");
    }
    if (els.image) {
      els.image.src = offer.coverUrl || "assets/logo-horizontal.png";
      els.image.alt = offer.productName;
    }
    if (els.catalogLink && offer.baseUrl) {
      els.catalogLink.href = offer.baseUrl;
    }
    renderCartBar();
  }

  function addOfferToCart() {
    if (!currentOffer) return;
    const cart = readCart();
    const cartId = `${currentOffer.basePid || "offer"}-personal-${currentOffer.token}`;
    const filtered = cart.filter((item) => item.id !== cartId);
    filtered.push({
      id: cartId,
      name: `${currentOffer.productName} (персональное предложение)`,
      country: "",
      warehouse: "",
      price: currentOffer.offerPrice,
      priceLabel: formatPrice(currentOffer.offerPrice),
      offerToken: currentOffer.token,
    });
    writeCart(filtered);
    if (els.addCart) els.addCart.textContent = "✓ В корзине";
  }

  function parseOfferFromQueryParams() {
    const retail = parseInt(String(params.get("retail") || "").replace(/[^\d]/g, ""), 10);
    const offer = parseInt(String(params.get("offer") || "").replace(/[^\d]/g, ""), 10);
    const name = String(params.get("name") || "").trim();
    if (!retail || !offer || !name) return null;

    const exp = String(params.get("exp") || "").trim();
    if (exp) {
      const expMs = new Date(exp).getTime();
      if (expMs && expMs < Date.now()) {
        return { expired: true };
      }
    }

    return {
      token: token,
      productName: name,
      retailPrice: retail,
      offerPrice: offer,
      coverUrl: String(params.get("img") || "").trim(),
      baseUrl: String(params.get("page") || "").trim(),
      basePid: String(params.get("pid") || "").trim(),
      expiresAt: exp || "",
    };
  }

  async function fetchOfferFromApi() {
    const apiBase = String(window.IRON_CONFIG?.personalOfferApiUrl || "").trim();
    if (!apiBase || !token) return null;
    const url = apiBase + (apiBase.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(token);
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.status !== "ok") {
      return { error: data.error || "not_found" };
    }
    return data;
  }

  async function loadOffer() {
    const fromUrl = parseOfferFromQueryParams();
    if (fromUrl?.expired) {
      showError("Срок действия предложения истёк. Актуальные цены — в каталоге.", true);
      return;
    }
    if (fromUrl) {
      renderOffer(fromUrl);
      return;
    }

    if (!token) {
      showError("Ссылка на предложение не найдена.");
      return;
    }

    try {
      const data = await fetchOfferFromApi();
      if (data?.error === "expired") {
        showError("Срок действия предложения истёк. Актуальные цены — в каталоге.", true);
        return;
      }
      if (data && data.status === "ok") {
        renderOffer(data);
        return;
      }
    } catch (err) {
      console.warn("[offer] API fallback failed:", err);
    }

    showError("Предложение не найдено или недоступно.");
  }

  if (els.addCart) els.addCart.addEventListener("click", addOfferToCart);
  if (els.cartToggle) els.cartToggle.addEventListener("click", openTelegramOrder);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadOffer);
  } else {
    loadOffer();
  }
})();
