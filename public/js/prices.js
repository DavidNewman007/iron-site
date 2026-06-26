/**
 * Прайс из Google Таблицы (лист PriceDA-All) + корзина → Telegram @ironsochi
 */
(function () {
  const cfg = window.IRON_CONFIG || {};
  const SHEET_ID = cfg.googleSheetId || "";
  const SHEET_TABS = ["Prices", "Prices-2"];
  const HYBRID_IPHONE_MANIFEST = "hybrid-products/iphone-cards.json";
  const HYBRID_IPAD_MANIFEST = "hybrid-products/ipad-cards.json";
  const HYBRID_MACBOOK_MANIFEST = "hybrid-products/macbook-cards.json";
  const HYBRID_WATCH_MANIFEST = "hybrid-products/watch-cards.json";
  const HYBRID_AIRPODS_MANIFEST = "hybrid-products/airpods-cards.json";
  const HYBRID_IPHONE_MANIFEST_VERSION = "2026-06-20-3";
  const HYBRID_IPAD_MANIFEST_VERSION = "2026-06-20-1";
  const HYBRID_MACBOOK_MANIFEST_VERSION = "2026-06-26-2";
  const HYBRID_WATCH_MANIFEST_VERSION = "2026-06-26-2";
  const HYBRID_AIRPODS_MANIFEST_VERSION = "2026-06-26-2";
  const TG_USER = cfg.telegramOrderUser || "ironsochi";
  const CART_KEY = "iron_cart";
  const CART_PRODUCT_ID_QUERY_PARAM = "pid";
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
    "россия"]);

  const CATEGORY_RULES = [
    // Accessories must come before iPhone/Samsung so that items like
    // "Защитное стекло 3D Remax для iPhone 14 Pro Max" land here, not in iPhone.
    {
      id: "accessories",
      label: "Accessories",
      icon: "🔌",
      test: (t) =>
        /pencil|remax|pitaka|чехол|кейс|ремешк|wallet|сзу|charger|кабель|аксесс|accessories|magic mouse|airtag|smarttag/i.test(t),
    },
    { id: "iphone", label: "iPhone", icon: "📱", test: (t) => /iphone/i.test(t) },
    { id: "ipad", label: "iPad", icon: "🔳", test: (t) => /ipad/i.test(t) },
    {
      id: "airpods",
      label: "AirPods",
      icon: "🎧",
      test: (t) => /airpods/i.test(t),
    },
    {
      id: "gaming",
      label: "Gaming · Console",
      icon: "🎮",
      test: (t) => /playstation|ps5|ps vr|vr2|gamepad|pulse|xbox|nintendo/i.test(t),
    },
    {
      id: "audio",
      label: "Audio",
      icon: "🎵",
      test: (t) => /jbl|marshall|акустик|колонк|станци|speaker|street|дуо max|midi|max zigbee/i.test(t),
    },
    {
      id: "dyson",
      label: "Dyson",
      icon: "💨",
      test: (t) => /dyson|\bhs\d{2}\b|\bhd\d{2}\b|\bht\d{2}\b/i.test(t),
    },
    {
      id: "gadgets",
      label: "Gadgets",
      icon: "🖱",
      // magic mouse / airtag / smarttag moved to accessories
      test: (t) => /whoop|gopro|instax|fujifilm|canon|dji|osmo|apple tv/i.test(t),
    },
    {
      id: "macbook",
      label: "MacBook",
      icon: "💻",
      test: (t) => /macbook/i.test(t),
    },
    {
      id: "samsung",
      label: "Samsung",
      icon: "📱",
      test: (t) => /samsung|galaxy buds/i.test(t),
    },
    {
      id: "galaxy_watch",
      label: "Samsung Galaxy Watch",
      icon: "⌚",
      test: (t) => /galaxy watch|^watch\s*(8|ultra|classic)\b/i.test(t),
    },
    {
      id: "meta",
      label: "Meta",
      icon: "👓",
      test: (t) => /meta|oakley|wayfarer|skyler/i.test(t),
    },
    // Apple Watch only (Galaxy Watch handled by galaxy_watch rule above).
    {
      id: "watch",
      label: "Apple Watch",
      icon: "⌚",
      test: (t) =>
        /apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|^series\s+ultra|^\s*ultra\s*\d+\b|^\s*se\d+\s+\d{2}mm\b|^\s*s\d{1,2}\s+\d{2}mm\b|⌚/iu.test(
          t
        ) && !/galaxy\s*watch|samsung|whoop/i.test(t),
    },
    { id: "other", label: "Прочее", icon: "◆", test: () => true }];

  const SEARCH_DICT = window.IRON_SEARCH_DICT || { translit: {}, translate: [] };
  const PRICE_CACHE_KEY = `iron_prices_sheet_${SHEET_TABS.join("_")}_v5`;
  const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
  const USER_LOAD_ERROR = "Не удалось загрузить товары. Идут технические работы. Скоро все починим";

  const els = {
    root: document.getElementById("shop-prices"),
    grid: document.getElementById("price-grid"),
    loading: document.getElementById("price-loading"),
    error: document.getElementById("price-error"),
    updated: document.getElementById("price-updated"),
    search: document.getElementById("price-search"),
    category: document.getElementById("price-category"),
    filtersRoot: document.getElementById("shop-filters"),
    cartList: document.getElementById("cart-list"),
    cartCount: document.getElementById("cart-count"),
    cartTotal: document.getElementById("cart-total"),
    cartPanel: document.getElementById("cart-panel"),
    cartToggle: document.getElementById("cart-toggle"),
    cartClose: document.getElementById("cart-close"),
    cartClear: document.getElementById("cart-clear"),
    cartTelegram: document.getElementById("cart-telegram"),
    cartMobileBar: document.querySelector(".cart-mobile-bar"),
    cartTotalMobile: document.getElementById("cart-total-mobile"),
  };

  if (!els.root) return;

  let allProducts = [];
  let iphoneHybridById = {};
  let iphoneHybridByIdNoPrice = new Map();
  let iphoneHybridByVariantKey = new Map();
  let iphoneHybridByModelKey = new Map();
  let ipadHybridById = {};
  let ipadHybridByIdNoPrice = new Map();
  let ipadHybridByVariantKey = new Map();
  let ipadHybridByModelKey = new Map();
  let macbookHybridById = {};
  let macbookHybridByIdNoPrice = new Map();
  let macbookHybridByVariantKey = new Map();
  let macbookHybridByCatalogKey = new Map();
  let macbookHybridByModelCodeKey = new Map();
  let watchHybridById = {};
  let watchHybridByIdNoPrice = new Map();
  let watchHybridByVariantKey = new Map();
  let watchHybridByCatalogKey = new Map();
  let airpodsHybridById = {};
  let airpodsHybridByIdNoPrice = new Map();
  let airpodsHybridByCatalogKey = new Map();
  let airpodsHybridByVariantKey = new Map();
  let iphoneHybridManifestLoaded = false;
  let ipadHybridManifestLoaded = false;
  let macbookHybridManifestLoaded = false;
  let watchHybridManifestLoaded = false;
  let airpodsHybridManifestLoaded = false;
  let cart = loadCart();
  let searchRenderTimer = null;
  let queryPlanCache = { raw: "", plan: null };
  let filtersLayoutMode = null;
  const categoryFilterState = {};

  async function init() {
    bindEvents();
    bindMobileCartCountSync();
    renderCart();
    const hybridLoadPromise = Promise.all([
      loadIphoneHybridCards(),
      loadIpadHybridCards(),
      loadMacbookHybridCards(),
      loadWatchHybridCards(),
      loadAirpodsHybridCards()]);

    if (!SHEET_ID) {
      showError(
        "Укажите ID публичной таблицы в js/config.js → googleSheetId (отдельный файл, только прайс для сайта)."
      );
      return;
    }

    tryShowCachedProducts();

    try {
      applyProducts(await fetchProducts());
      await hybridLoadPromise;
      applyHybridData();
      renderGrid();
    } catch (e) {
      console.error(e);
      if (!allProducts.length && !tryShowCachedProducts(true)) {
        showError(USER_LOAD_ERROR);
      }
    }
  }

  async function loadIphoneHybridCards() {
    try {
      const manifestUrl = `${HYBRID_IPHONE_MANIFEST}?v=${encodeURIComponent(
        HYBRID_IPHONE_MANIFEST_VERSION
      )}`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      iphoneHybridById = data && typeof data.byId === "object" ? data.byId : {};
      buildIphoneHybridIndex();
      iphoneHybridManifestLoaded = true;
    } catch (_) {
      iphoneHybridById = {};
      iphoneHybridByIdNoPrice = new Map();
      iphoneHybridManifestLoaded = false;
    }
  }

  async function loadMacbookHybridCards() {
    try {
      const manifestUrl = `${HYBRID_MACBOOK_MANIFEST}?v=${encodeURIComponent(
        HYBRID_MACBOOK_MANIFEST_VERSION
      )}`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      macbookHybridById = data && typeof data.byId === "object" ? data.byId : {};
      buildMacbookHybridIndex();
      macbookHybridManifestLoaded = true;
    } catch (_) {
      macbookHybridById = {};
      macbookHybridByIdNoPrice = new Map();
      macbookHybridByVariantKey = new Map();
      macbookHybridByCatalogKey = new Map();
      macbookHybridByModelCodeKey = new Map();
      macbookHybridManifestLoaded = false;
    }
  }

  async function loadIpadHybridCards() {
    try {
      const manifestUrl = `${HYBRID_IPAD_MANIFEST}?v=${encodeURIComponent(
        HYBRID_IPAD_MANIFEST_VERSION
      )}`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      ipadHybridById = data && typeof data.byId === "object" ? data.byId : {};
      buildIpadHybridIndex();
      ipadHybridManifestLoaded = true;
    } catch (_) {
      ipadHybridById = {};
      ipadHybridByIdNoPrice = new Map();
      ipadHybridByVariantKey = new Map();
      ipadHybridByModelKey = new Map();
      ipadHybridManifestLoaded = false;
    }
  }

  async function loadWatchHybridCards() {
    try {
      const manifestUrl = `${HYBRID_WATCH_MANIFEST}?v=${encodeURIComponent(
        HYBRID_WATCH_MANIFEST_VERSION
      )}`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      watchHybridById = data && typeof data.byId === "object" ? data.byId : {};
      buildWatchHybridIndex();
      watchHybridManifestLoaded = true;
    } catch (_) {
      watchHybridById = {};
      watchHybridByIdNoPrice = new Map();
      watchHybridByVariantKey = new Map();
      watchHybridByCatalogKey = new Map();
      watchHybridManifestLoaded = false;
    }
  }

  async function loadAirpodsHybridCards() {
    try {
      const manifestUrl = `${HYBRID_AIRPODS_MANIFEST}?v=${encodeURIComponent(
        HYBRID_AIRPODS_MANIFEST_VERSION
      )}`;
      const res = await fetch(manifestUrl, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      airpodsHybridById = data && typeof data.byId === "object" ? data.byId : {};
      buildAirpodsHybridIndex();
      airpodsHybridManifestLoaded = true;
    } catch (_) {
      airpodsHybridById = {};
      airpodsHybridByIdNoPrice = new Map();
      airpodsHybridByCatalogKey = new Map();
      airpodsHybridByVariantKey = new Map();
      airpodsHybridManifestLoaded = false;
    }
  }

  function applyHybridData() {
    if (!allProducts.length) return;
    for (const product of allProducts) {
      if (isHybridIphoneCandidate(product)) {
        const allowHeuristicFallback = location.protocol === "file:" || !iphoneHybridManifestLoaded;
        const meta = resolveIphoneHybridMeta(product);
        if (meta && meta.url) {
          product.hybridDetailUrl = encodeURI(String(meta.url));
          product.hybridCoverUrl = normalizeHybridCoverUrl(meta.cover);
          continue;
        }
        product.hybridDetailUrl = allowHeuristicFallback ? buildIphoneDetailFallbackUrl(product) : "";
        product.hybridCoverUrl = "";
        continue;
      }

      if (isHybridMacbookCandidate(product)) {
        const allowHeuristicFallback = location.protocol === "file:" || !macbookHybridManifestLoaded;
        const meta = resolveMacbookHybridMeta(product);
        if (meta && meta.url) {
          product.hybridDetailUrl = encodeURI(String(meta.url));
          product.hybridCoverUrl = normalizeHybridCoverUrl(meta.cover);
          continue;
        }
        product.hybridDetailUrl = allowHeuristicFallback ? buildMacbookDetailFallbackUrl(product) : "";
        product.hybridCoverUrl = "";
        continue;
      }

      if (isHybridIpadCandidate(product)) {
        const allowHeuristicFallback = location.protocol === "file:" || !ipadHybridManifestLoaded;
        const meta = resolveIpadHybridMeta(product);
        if (meta && meta.url) {
          product.hybridDetailUrl = encodeURI(String(meta.url));
          product.hybridCoverUrl = normalizeHybridCoverUrl(meta.cover);
          continue;
        }
        product.hybridDetailUrl = allowHeuristicFallback ? buildIpadDetailFallbackUrl(product) : "";
        product.hybridCoverUrl = "";
        continue;
      }

      if (isHybridWatchCandidate(product)) {
        const allowHeuristicFallback = location.protocol === "file:" || !watchHybridManifestLoaded;
        const meta = resolveWatchHybridMeta(product);
        if (meta && meta.url) {
          product.hybridDetailUrl = encodeURI(String(meta.url));
          product.hybridCoverUrl = normalizeHybridCoverUrl(meta.cover);
          continue;
        }
        product.hybridDetailUrl = allowHeuristicFallback ? buildWatchDetailFallbackUrl(product) : "";
        product.hybridCoverUrl = "";
        continue;
      }

      if (isHybridAirpodsCandidate(product)) {
        const allowHeuristicFallback = location.protocol === "file:" || !airpodsHybridManifestLoaded;
        const meta = resolveAirpodsHybridMeta(product);
        if (meta && meta.url) {
          product.hybridDetailUrl = encodeURI(String(meta.url));
          product.hybridCoverUrl = normalizeHybridCoverUrl(meta.cover);
          continue;
        }
        product.hybridDetailUrl = allowHeuristicFallback ? buildAirpodsDetailFallbackUrl(product) : "";
        product.hybridCoverUrl = "";
        continue;
      }

      product.hybridDetailUrl = "";
      product.hybridCoverUrl = "";
    }
  }

  function buildIphoneHybridIndex() {
    iphoneHybridByIdNoPrice = new Map();
    iphoneHybridByVariantKey = new Map();
    iphoneHybridByModelKey = new Map();
    for (const [id, meta] of Object.entries(iphoneHybridById)) {
      const noPrice = stripTrailingPrice(id);
      if (!noPrice) continue;
      if (!iphoneHybridByIdNoPrice.has(noPrice)) iphoneHybridByIdNoPrice.set(noPrice, []);
      iphoneHybridByIdNoPrice.get(noPrice).push({ id, meta, price: extractTrailingPrice(id) });

      const variantKey = buildIphoneVariantKey(meta?.name || "");
      if (variantKey) {
        if (!iphoneHybridByVariantKey.has(variantKey)) iphoneHybridByVariantKey.set(variantKey, []);
        iphoneHybridByVariantKey.get(variantKey).push({ id, meta, price: extractTrailingPrice(id) });
      }

      const modelKey = buildIphoneModelKey(meta?.name || "");
      if (modelKey) {
        if (!iphoneHybridByModelKey.has(modelKey)) iphoneHybridByModelKey.set(modelKey, []);
        iphoneHybridByModelKey.get(modelKey).push({ id, meta, price: extractTrailingPrice(id) });
      }
    }
  }

  function buildMacbookHybridIndex() {
    macbookHybridByIdNoPrice = new Map();
    macbookHybridByVariantKey = new Map();
    macbookHybridByCatalogKey = new Map();
    macbookHybridByModelCodeKey = new Map();
    for (const [id, meta] of Object.entries(macbookHybridById)) {
      const price = extractTrailingPrice(id) || parsePrice(meta?.price);
      const noPrice = stripTrailingPrice(id);
      if (noPrice) {
        if (!macbookHybridByIdNoPrice.has(noPrice)) macbookHybridByIdNoPrice.set(noPrice, []);
        macbookHybridByIdNoPrice.get(noPrice).push({ id, meta, price });
      }

      pushHybridCandidate(macbookHybridByVariantKey, buildMacbookVariantKey(meta?.name || ""), id, meta, price);
      pushHybridCandidate(
        macbookHybridByCatalogKey,
        buildHybridCatalogKey(meta?.name || "", meta?.warehouse || "", price),
        id,
        meta,
        price
      );
      pushHybridCandidate(
        macbookHybridByModelCodeKey,
        buildMacbookModelCodeKey(meta?.name || "", meta?.warehouse || "", price),
        id,
        meta,
        price
      );
    }
  }

  function buildIpadHybridIndex() {
    ipadHybridByIdNoPrice = new Map();
    ipadHybridByVariantKey = new Map();
    ipadHybridByModelKey = new Map();
    for (const [id, meta] of Object.entries(ipadHybridById)) {
      const noPrice = stripTrailingPrice(id);
      if (!noPrice) continue;
      if (!ipadHybridByIdNoPrice.has(noPrice)) ipadHybridByIdNoPrice.set(noPrice, []);
      ipadHybridByIdNoPrice.get(noPrice).push({ id, meta, price: extractTrailingPrice(id) });

      const variantKey = buildIpadVariantKey(meta?.name || "");
      if (variantKey) {
        if (!ipadHybridByVariantKey.has(variantKey)) ipadHybridByVariantKey.set(variantKey, []);
        ipadHybridByVariantKey.get(variantKey).push({ id, meta, price: extractTrailingPrice(id) });
      }

      const modelKey = buildIpadModelKey(meta?.name || "");
      if (modelKey) {
        if (!ipadHybridByModelKey.has(modelKey)) ipadHybridByModelKey.set(modelKey, []);
        ipadHybridByModelKey.get(modelKey).push({ id, meta, price: extractTrailingPrice(id) });
      }
    }
  }

  function buildWatchHybridIndex() {
    watchHybridByIdNoPrice = new Map();
    watchHybridByVariantKey = new Map();
    watchHybridByCatalogKey = new Map();
    for (const [id, meta] of Object.entries(watchHybridById)) {
      const price = extractTrailingPrice(id) || parsePrice(meta?.price);
      const noPrice = stripTrailingPrice(id);
      if (noPrice) {
        if (!watchHybridByIdNoPrice.has(noPrice)) watchHybridByIdNoPrice.set(noPrice, []);
        watchHybridByIdNoPrice.get(noPrice).push({ id, meta, price });
      }

      pushHybridCandidate(watchHybridByVariantKey, buildWatchVariantKey(meta?.name || ""), id, meta, price);
      pushHybridCandidate(
        watchHybridByCatalogKey,
        buildHybridCatalogKey(meta?.name || "", meta?.warehouse || "", price),
        id,
        meta,
        price
      );
    }
  }

  function buildAirpodsHybridIndex() {
    airpodsHybridByIdNoPrice = new Map();
    airpodsHybridByCatalogKey = new Map();
    airpodsHybridByVariantKey = new Map();
    for (const [id, meta] of Object.entries(airpodsHybridById)) {
      const price = extractTrailingPrice(id) || parsePrice(meta?.price);
      const noPrice = stripTrailingPrice(id);
      if (noPrice) {
        if (!airpodsHybridByIdNoPrice.has(noPrice)) airpodsHybridByIdNoPrice.set(noPrice, []);
        airpodsHybridByIdNoPrice.get(noPrice).push({ id, meta, price });
      }

      pushHybridCandidate(airpodsHybridByVariantKey, buildAirpodsVariantKey(meta?.name || ""), id, meta, price);
      pushHybridCandidate(
        airpodsHybridByCatalogKey,
        buildHybridCatalogKey(meta?.name || "", meta?.warehouse || "", price),
        id,
        meta,
        price
      );
    }
  }

  function pushHybridCandidate(map, key, id, meta, price) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id, meta, price });
  }

  function buildHybridCatalogKey(name, warehouse, price) {
    const priceInt = parsePrice(price);
    if (!priceInt) return "";
    return slugify(String(name || "") + String(warehouse || "") + priceInt);
  }

  function buildAirpodsVariantKey(name) {
    return normalizeAirpodsNameKey(name);
  }

  function normalizeAirpodsNameKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^\wа-я\s]/gi, " ")
      .replace(/ё/g, "е")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractAppleModelCode(name) {
    const matches = String(name || "").match(/\b[A-Z][A-Z0-9]{3,4}\b/g);
    return matches?.length ? matches[matches.length - 1].toLowerCase() : "";
  }

  function buildMacbookModelCodeKey(name, warehouse, price) {
    const code = extractAppleModelCode(name);
    const priceInt = parsePrice(price);
    if (!code || !priceInt) return "";
    return `${code}|${String(warehouse || "").toLowerCase()}|${priceInt}`;
  }

  function pickHybridMetaFromMap(map, key, targetPrice) {
    if (!key) return null;
    const candidates = map.get(key);
    if (!candidates?.length) return null;
    return pickBestIphoneHybridCandidate(candidates, targetPrice);
  }

  function resolveIphoneHybridMeta(product) {
    const exact = iphoneHybridById[product.id];
    if (exact && exact.url) return exact;

    const targetPrice = parsePrice(product.price) || parsePrice(product.priceLabel);

    const noPrice = stripTrailingPrice(product.id);
    const candidates = noPrice ? iphoneHybridByIdNoPrice.get(noPrice) : null;
    if (candidates?.length) return pickBestIphoneHybridCandidate(candidates, targetPrice);

    const variantKey = buildIphoneVariantKey(product.name, product.section);
    const variantCandidates = variantKey ? iphoneHybridByVariantKey.get(variantKey) : null;
    if (variantCandidates?.length) return pickBestIphoneHybridCandidate(variantCandidates, targetPrice);

    const modelKey = buildIphoneModelKey(product.name, product.section);
    const modelCandidates = modelKey ? iphoneHybridByModelKey.get(modelKey) : null;
    if (modelCandidates?.length) return pickBestIphoneHybridCandidate(modelCandidates, targetPrice);

    return null;
  }

  function resolveMacbookHybridMeta(product) {
    const exact = macbookHybridById[product.id];
    if (exact && exact.url) return exact;

    const targetPrice = parsePrice(product.price) || parsePrice(product.priceLabel);

    const catalogKey = buildHybridCatalogKey(product.name, product.warehouse, targetPrice);
    const catalogMatch = pickHybridMetaFromMap(macbookHybridByCatalogKey, catalogKey, targetPrice);
    if (catalogMatch) return catalogMatch;

    const modelCodeKey = buildMacbookModelCodeKey(product.name, product.warehouse, targetPrice);
    const modelCodeMatch = pickHybridMetaFromMap(macbookHybridByModelCodeKey, modelCodeKey, targetPrice);
    if (modelCodeMatch) return modelCodeMatch;

    const noPrice = stripTrailingPrice(product.id);
    const candidates = noPrice ? macbookHybridByIdNoPrice.get(noPrice) : null;
    if (candidates?.length) return pickBestIphoneHybridCandidate(candidates, targetPrice);

    const variantKey = buildMacbookVariantKey(product.name);
    const variantCandidates = variantKey ? macbookHybridByVariantKey.get(variantKey) : null;
    if (variantCandidates?.length) return pickBestIphoneHybridCandidate(variantCandidates, targetPrice);

    return null;
  }

  function resolveIpadHybridMeta(product) {
    const exact = ipadHybridById[product.id];
    if (exact && exact.url) return exact;

    const targetPrice = parsePrice(product.price) || parsePrice(product.priceLabel);

    const noPrice = stripTrailingPrice(product.id);
    const candidates = noPrice ? ipadHybridByIdNoPrice.get(noPrice) : null;
    if (candidates?.length) return pickBestIphoneHybridCandidate(candidates, targetPrice);

    const variantKey = buildIpadVariantKey(product.name, product.section);
    const variantCandidates = variantKey ? ipadHybridByVariantKey.get(variantKey) : null;
    if (variantCandidates?.length) return pickBestIphoneHybridCandidate(variantCandidates, targetPrice);

    const modelKey = buildIpadModelKey(product.name, product.section);
    const modelCandidates = modelKey ? ipadHybridByModelKey.get(modelKey) : null;
    if (modelCandidates?.length) return pickBestIphoneHybridCandidate(modelCandidates, targetPrice);

    return null;
  }

  function resolveWatchHybridMeta(product) {
    const exact = watchHybridById[product.id];
    if (exact && exact.url) return exact;

    const targetPrice = parsePrice(product.price) || parsePrice(product.priceLabel);

    const catalogKey = buildHybridCatalogKey(product.name, product.warehouse, targetPrice);
    const catalogMatch = pickHybridMetaFromMap(watchHybridByCatalogKey, catalogKey, targetPrice);
    if (catalogMatch) return catalogMatch;

    const noPrice = stripTrailingPrice(product.id);
    const candidates = noPrice ? watchHybridByIdNoPrice.get(noPrice) : null;
    if (candidates?.length) return pickBestIphoneHybridCandidate(candidates, targetPrice);

    const variantKey = buildWatchVariantKey(product.name, product.section);
    const variantCandidates = variantKey ? watchHybridByVariantKey.get(variantKey) : null;
    if (variantCandidates?.length) return pickBestIphoneHybridCandidate(variantCandidates, targetPrice);

    return null;
  }

  function resolveAirpodsHybridMeta(product) {
    const exact = airpodsHybridById[product.id];
    if (exact && exact.url) return exact;

    const targetPrice = parsePrice(product.price) || parsePrice(product.priceLabel);

    const catalogKey = buildHybridCatalogKey(product.name, product.warehouse, targetPrice);
    const catalogMatch = pickHybridMetaFromMap(airpodsHybridByCatalogKey, catalogKey, targetPrice);
    if (catalogMatch) return catalogMatch;

    const variantKey = buildAirpodsVariantKey(product.name);
    const variantMatch = pickHybridMetaFromMap(airpodsHybridByVariantKey, variantKey, targetPrice);
    if (variantMatch) return variantMatch;

    const noPrice = stripTrailingPrice(product.id);
    const candidates = noPrice ? airpodsHybridByIdNoPrice.get(noPrice) : null;
    if (!candidates?.length) return null;

    if (!targetPrice) return candidates[0].meta;
    return pickBestIphoneHybridCandidate(candidates, targetPrice);
  }

  function pickBestIphoneHybridCandidate(candidates, targetPrice) {
    if (!candidates?.length) return null;
    if (!targetPrice) return candidates[0].meta;
    let best = candidates[0];
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const candidatePrice = candidate.price || 0;
      const delta = Math.abs(candidatePrice - targetPrice);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = candidate;
      }
    }
    return best.meta;
  }

  function normalizeIphoneNameKey(name, section) {
    let source = String(name || "");
    const sectionText = String(section || "");
    if (!/\biphone\b/i.test(source) && /\biphone\b/i.test(sectionText)) {
      source = `iPhone ${source}`;
    }

    return source
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(sim\s*\+\s*esim|esim|sim)\b/gi, " ")
      .replace(/\b(j\/a|hn\/a|za\/a|kh\/a|af\/a|be\/a|zd\/a|qn\/a|ll\/a|x\/a|ah\/a)\b/gi, " ")
      .replace(/[^\wа-я\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIphoneVariantKey(name, section) {
    const normalized = normalizeIphoneNameKey(name, section);
    if (!normalized) return "";
    return normalized
      .replace(/\b(128|256|512|1024)\s*(gb|tb)\b/gi, "$1$2")
      .replace(/\bgb\b/gi,"")
      .replace(/\btb\b/gi,"")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIphoneModelKey(name, section) {
    const normalized = normalizeIphoneNameKey(name, section);
    if (!normalized) return "";
    const modelMatch = normalized.match(/\biphone\s+(air|1[4-9](?:\s+pro(?:\s+max)?|\s+plus|e)?)/i);
    if (!modelMatch) return "";
    return `iphone ${String(modelMatch[1] || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()}`;
  }

  function normalizeIpadNameKey(name, section) {
    let source = String(name || "");
    const sectionText = String(section || "");
    if (!/\bipad\b/i.test(source) && /\bipad\b/i.test(sectionText)) {
      source = `iPad ${source}`;
    }

    return source
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(wi[\s-]*fi|wifi|cellular|sim\s*\+\s*esim|esim|sim|lte)\b/gi, " ")
      .replace(/\b(j\/a|hn\/a|za\/a|kh\/a|af\/a|be\/a|zd\/a|qn\/a|ll\/a|x\/a|ah\/a)\b/gi, " ")
      .replace(/[^\wа-я.\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIpadVariantKey(name, section) {
    const normalized = normalizeIpadNameKey(name, section);
    if (!normalized) return "";
    return normalized
      .replace(/\b(64|128|256|512|1024|2048)\s*(gb|tb)\b/gi, "$1$2")
      .replace(/\bgb\b/gi,"")
      .replace(/\btb\b/gi,"")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildIpadModelKey(name, section) {
    const normalized = normalizeIpadNameKey(name, section);
    if (!normalized) return "";
    const modelMatch = normalized.match(/\bipad\s+(air|pro|mini)\b/i) || normalized.match(/\bipad\b/i);
    if (!modelMatch) return "";
    const model = modelMatch[1] ? String(modelMatch[1]).toLowerCase() : "";
    return model ? `ipad ${model}` : "ipad";
  }

  function normalizeWatchNameKey(name, section) {
    let source = String(name || "");
    const sectionText = String(section || "");
    const watchHint =
      /apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|^series\s+ultra|^\s*ultra\s*\d+\b|^\s*se\d+\s+\d{2}mm\b|^\s*s\d{1,2}\s+\d{2}mm\b/i;
    if (!watchHint.test(source) && watchHint.test(sectionText)) {
      source = `Apple Watch ${source}`;
    }

    return source
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(gps\s*\+\s*cellular|gps|cellular|lte)\b/gi, " ")
      .replace(/[^\wа-я\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildWatchVariantKey(name, section) {
    const normalized = normalizeWatchNameKey(name, section);
    if (!normalized) return "";
    return normalized
      .replace(/\b(\d{2})\s*mm\b/gi, "$1mm")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeMacbookNameKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\b(j\/a|hn\/a|za\/a|kh\/a|af\/a|be\/a|zd\/a|qn\/a|ll\/a|x\/a|ah\/a)\b/gi, " ")
      .replace(/[^\wа-я\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildMacbookVariantKey(name) {
    let normalized = normalizeMacbookNameKey(name);
    if (!normalized) return "";
    if (/\bmdhh4\b/.test(normalized) && /\b512\b/.test(normalized) && /\bblue\b/.test(normalized)) {
      normalized = normalized.replace(/\bblue\b/, "sky blue");
    }
    return normalized
      .replace(/\b(\d+)\s*\+\s*(\d+)\b/g, "$1plus$2")
      .replace(/\b(\d+)\s*(gb|tb)\b/gi, "$1$2")
      .replace(/\bgb\b/gi,"")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isWatchLikeName(text) {
    const t = String(text || "").trim();
    if (/galaxy\s*watch|samsung|whoop/i.test(t)) return false;
    return /apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|^series\s+ultra|^\s*ultra\s*\d+\b|⌚|^\s*se\d+\s+\d{2}mm\b|^\s*s\d{1,2}\s+\d{2}mm\b|^\s*ultra\s+\d+\b/iu.test(
      t
    );
  }

  function isIphoneSectionLabel(section) {
    return /^📱\s*iPhone\b/i.test(String(section || "").trim());
  }

  function isWatchSectionLabel(section) {
    const s = String(section || "").trim();
    if (/galaxy\s*watch|samsung|whoop/i.test(s)) return false;
    return /⌚|apple\s*watch|series\s*(?:se\s*\d*|\d+|ultra(?:\s*\d+)?)|\bultra\s*\d+|^\s*🔘\s*(?:se\d+|s\d{1,2}|ultra)/iu.test(
      s
    );
  }

  function isMacbookSectionLabel(section) {
    return /^💻\s*macbook/i.test(String(section || "").trim());
  }

  function resolveWatchSection(name, currentSection) {
    const n = String(name || "").trim();
    const s = String(currentSection || "").trim();

    if (isWatchSectionLabel(s) && !isIphoneSectionLabel(s)) {
      return normalizeSectionLabel(s);
    }

    const seriesUltra = n.match(/^Series\s+Ultra\s+(\d+)\s+(\d{2})mm/i);
    if (seriesUltra) return `⌚ Ultra ${seriesUltra[1]} ${seriesUltra[2]}mm`;

    const seriesSe = n.match(/^Series\s+SE\s+(\d+)\s+(\d{2})mm/i);
    if (seriesSe) return `⌚ Series SE ${seriesSe[1]} ${seriesSe[2]}mm`;

    const seriesNum = n.match(/^Series\s+(\d+)\s+(\d{2})mm/i);
    if (seriesNum) return `⌚ Series ${seriesNum[1]} ${seriesNum[2]}mm`;

    const seShort = n.match(/^SE(\d+)\s+(\d{2})mm/i);
    if (seShort) return `⌚ SE ${seShort[1]} ${seShort[2]}mm`;

    const sShort = n.match(/^S(\d{1,2})\s+(\d{2})mm/i);
    if (sShort) return `⌚ Series ${sShort[1]} ${sShort[2]}mm`;

    const ultraShort = n.match(/^Ultra\s+(\d+)\b/i);
    if (ultraShort) return `⌚ Ultra ${ultraShort[1]}`;

    return "⌚ Apple Watch";
  }

  function resolveMacbookSection(name, currentSection) {
    const s = String(currentSection || "").trim();
    if (isMacbookSectionLabel(s)) return normalizeSectionLabel(s);

    const n = String(name || "").trim();
    if (/^MacBook\s+Neo/i.test(n)) return "💻 MacBook Neo";
    if (/^MacBook\s+Air\s+15/i.test(n)) return "💻 MacBook Air 15";
    if (/^MacBook\s+Air\s+13/i.test(n)) return "💻 MacBook Air 13";
    if (/^MacBook\s+Pro/i.test(n)) return "💻 MacBook Pro";
    if (/^MacBook\s+Air/i.test(n)) return "💻 MacBook Air";
    return "💻 MacBook";
  }

  function isHybridIphoneCandidate(product) {
    if (!product || product.category !== "iphone") return false;
    if (isWatchLikeName(product.name) || isWatchLikeName(product.section)) return false;

    const hasIphoneInName = /\biphone\b/i.test(String(product.name || ""));
    const hasIphoneInSection = /\biphone\b/i.test(String(product.section || ""));
    const shorthandIphoneName = /^\s*(1[4-9](?:\s+pro(?:\s+max)?|\s+plus|e)?|air)\b/i.test(
      String(product.name || "")
    );
    return hasIphoneInName || hasIphoneInSection || shorthandIphoneName;
  }

  function isHybridMacbookCandidate(product) {
    if (!product || product.category !== "macbook") return false;
    const name = String(product.name || "");
    const section = String(product.section || "");
    return /\bmacbook\b/i.test(name) || /\bmacbook\b/i.test(section);
  }

  function isHybridIpadCandidate(product) {
    if (!product || product.category !== "ipad") return false;
    const name = String(product.name || "");
    const section = String(product.section || "");
    return /\bipad\b/i.test(name) || /\bipad\b/i.test(section);
  }

  function isHybridWatchCandidate(product) {
    if (!product || product.category !== "watch") return false;
    const name = String(product.name || "");
    const section = String(product.section || "");
    if (/galaxy\s*watch|samsung/i.test(name) || /galaxy\s*watch|samsung/i.test(section)) return false;
    return isWatchLikeName(name) || isWatchLikeName(section);
  }

  function isHybridAirpodsCandidate(product) {
    if (!product || product.category !== "airpods") return false;
    const name = String(product.name || "");
    const section = String(product.section || "");
    if (/galaxy\s*buds|samsung/i.test(name) || /galaxy\s*buds|samsung/i.test(section)) return false;
    return /\bairpods\b/i.test(name) || /\bairpods\b/i.test(section);
  }

  function normalizeHybridCoverUrl(cover) {
    const raw = String(cover || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      parsed.pathname = parsed.pathname.replace(/ /g, "%20");
      return parsed.toString();
    } catch {
      return raw.replace(/ /g, "%20");
    }
  }

  function stripTrailingPrice(id) {
    return String(id || "").replace(/-\d{3,}$/u,"");
  }

  function extractTrailingPrice(id) {
    const match = String(id || "").match(/-(\d{3,})$/u);
    return match ? parseInt(match[1], 10) : 0;
  }

  function tryShowCachedProducts(allowExpired) {
    const cached = readPriceCache(allowExpired);
    if (!cached) return false;
    try {
      return applyProducts(parseSheetJson(cached.json));
    } catch (e) {
      console.warn("Кэш прайса повреждён, очищаем:", e);
      clearPriceCache();
      return false;
    }
  }

  function applyProducts(result) {
    allProducts = result.products || [];
    if (!allProducts.length) {
      showError(USER_LOAD_ERROR);
      return false;
    }
    els.loading.hidden = true;
    if (els.error) els.error.hidden = true;
    if (els.updated) {
      const when = result.updatedAt || formatNow();
      els.updated.textContent = `Обновлено: ${when} · ${allProducts.length} позиций`;
    }
    renderGrid();
    return true;
  }

  function bindMobileCartCountSync() {
    const cartCount = els.cartCount;
    const cartCountMobile = document.getElementById("cart-count-mobile");
    if (!cartCount || !cartCountMobile) return;

    new MutationObserver(() => {
      cartCountMobile.textContent = cartCount.textContent || "0";
    }).observe(cartCount, { childList: true, characterData: true, subtree: true });
  }

  function syncCartFromStorage() {
    cart = loadCart();
    renderCart();
    renderGrid();
  }

  function bindEvents() {
    els.search?.addEventListener("input", scheduleRenderGrid);
    els.category?.addEventListener("change", renderGrid);
    els.cartClear?.addEventListener("click", () => {
      cart = [];
      saveCart();
      renderCart();
      renderGrid();
    });
    els.cartTelegram?.addEventListener("click", openTelegramOrder);
    els.cartToggle?.addEventListener("click", () => {
      els.cartPanel?.classList.toggle("is-open");
    });
    els.cartClose?.addEventListener("click", () => {
      els.cartPanel?.classList.remove("is-open");
    });
    window.addEventListener("pageshow", syncCartFromStorage);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncCartFromStorage();
    });
    window.addEventListener("resize", () => {
      const nextMode = isMobileFiltersView() ? "mobile" : "desktop";
      if (filtersLayoutMode && filtersLayoutMode !== nextMode) renderGrid();
      filtersLayoutMode = nextMode;
    });
    filtersLayoutMode = isMobileFiltersView() ? "mobile" : "desktop";
  }

  function isMobileShop() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function pulseMobileCartBar() {
    if (!els.cartMobileBar) return;
    els.cartMobileBar.classList.add("is-highlight");
    window.setTimeout(() => els.cartMobileBar.classList.remove("is-highlight"), 700);
  }

  function getSheetUrl() {
    const range = "A1:F1200";
    return (
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`
    );
  }

  async function fetchProducts() {
    const base = getSheetUrl();
    const merged = { products: [], updatedAt: "" };
    const seenIds = new Set();

    for (const tab of SHEET_TABS) {
      const url = `${base}?tqx=out:json&sheet=${encodeURIComponent(tab)}&range=${encodeURIComponent("A1:F1200")}`;
      const json = await loadSheetJson(url);
      const parsed = parseSheetJson(json);
      if (!merged.updatedAt && parsed.updatedAt) merged.updatedAt = parsed.updatedAt;

      for (const product of parsed.products || []) {
        if (seenIds.has(product.id)) continue;
        seenIds.add(product.id);
        merged.products.push(product);
      }
    }

    return merged;
  }

  function parseSheetJson(json) {
    const rows = json.table?.rows || [];
    const { colMap, dataRows } = resolveSheetLayout(rows);

    const products = [];
    let updatedAt = "";
    let currentCategory = "other";
    let currentSection = "";

    for (const row of dataRows) {
      let { name, warranty, country, qty, priceRaw, warehouse } = parseSheetRow(row, colMap);
      if (!name) continue;

      const updatedMatch = name.match(/^обновлено:\s*(.+)$/i);
      if (updatedMatch) {
        updatedAt = updatedMatch[1].trim();
        continue;
      }

      if (isCategoryRow(name, warranty, country, qty, priceRaw)) {
        // Strip trailing 🆕 so that S1 sections ("📱 iPhone 17 Pro eSIM 🆕")
        // and S2 sections ("📱 iPhone 17 Pro eSIM") group together on the website.
        currentSection = normalizeSectionLabel(name.replace(/\s*🆕\s*$/u,"").trim());
        const cat = detectCategory(currentSection);
        if (cat) {
          currentCategory = cat;
        } else if (isWatchSectionLabel(currentSection)) {
          currentCategory = "watch";
        } else if (isMacbookSectionLabel(currentSection)) {
          currentCategory = "macbook";
        }
        continue;
      }

      ({ qty, priceRaw } = normalizeProductFields(qty, priceRaw));
      if (priceRaw === "") continue;

      const price = parsePrice(priceRaw);
      if (!price || price < 100) continue;

      const detectedCategory = detectCategory(name);
      let productCategory = detectedCategory || currentCategory;
      if (productCategory === "iphone" && (isWatchLikeName(name) || isWatchLikeName(currentSection))) {
        productCategory = "watch";
      }
      if (isWatchLikeName(name) && isWatchSectionLabel(currentSection)) {
        productCategory = "watch";
      }
      // For accessories items, assign section by product name so that
      // S1 and S2 items land in the same sub-section regardless of the
      // last category header seen (fixes "Meta Glasses" appearing for Pencil/AirTag).
      let productSection = currentSection;
      if (productCategory === "accessories") {
        productSection = resolveAccessorySection(name);
      } else if (productCategory === "watch") {
        productSection = resolveWatchSection(name, currentSection);
      } else if (productCategory === "macbook") {
        productSection = resolveMacbookSection(name, currentSection);
      }

      const id = slugify(name + country + warehouse + price);
      products.push({
        id,
        name,
        warranty: warranty || "",
        country: country || "",
        qty: qty || "",
        warehouse: warehouse || "",
        price,
        priceLabel: formatPrice(price),
        category: productCategory,
        section: productSection,
        searchText: buildSearchText(name, country, productSection, warranty),
        inStock: !/0\s*шт/i.test(qty),
      });
    }

    return { products, updatedAt };
  }

  function readPriceCache(allowExpired) {
    try {
      const raw = sessionStorage.getItem(PRICE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.json) return null;
      if (!allowExpired && Date.now() - parsed.ts > PRICE_CACHE_TTL_MS) return null;
      return { json: parsed.json, ts: parsed.ts };
    } catch {
      return null;
    }
  }

  function writePriceCache(json) {
    try {
      sessionStorage.setItem(
        PRICE_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), json })
      );
    } catch {
      /* sessionStorage может быть недоступен */
    }
  }

  function clearPriceCache() {
    try {
      sessionStorage.removeItem(PRICE_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseGvizResponse(text) {
    const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error("Неверный ответ Google Sheets");
    return JSON.parse(match[1]);
  }

  /** fetch на http(s); JSONP через <script> при file:// (иначе CORS блокирует Google Sheets). */
  async function loadSheetJsonOnce(sheetUrl) {
    const apiBase = (cfg.apiUrl || "").replace(/\/$/,"");
    if (apiBase) {
      const res = await fetch(`${apiBase}/api/prices`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    if (location.protocol !== "file:") {
      try {
        const res = await fetch(sheetUrl, { cache: "no-store" });
        if (res.ok) return parseGvizResponse(await res.text());
      } catch {
        /* fallback to JSONP below */
      }
    }

    return loadSheetJsonp(sheetUrl);
  }

  async function loadSheetJson(sheetUrl) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await loadSheetJsonOnce(sheetUrl);
        writePriceCache(json);
        return json;
      } catch (e) {
        lastError = e;
        if (attempt < 1) await sleep(400);
      }
    }
    throw lastError || new Error("Не удалось загрузить таблицу");
  }

  function loadSheetJsonp(sheetUrl) {
    return new Promise((resolve, reject) => {
      const handler = "__ironSheet_" + Date.now();
      const timer = setTimeout(() => cleanup(new Error("Таймаут загрузки таблицы")), 25000);

      function cleanup(err, data) {
        clearTimeout(timer);
        delete window[handler];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err);
        else resolve(data);
      }

      window[handler] = (data) => cleanup(null, data);

      const script = document.createElement("script");
      script.src = sheetUrl.replace(
        "tqx=out:json",
        `tqx=out:json;responseHandler:${handler}`
      );
      script.onerror = () => cleanup(new Error("Не удалось загрузить таблицу"));
      document.head.appendChild(script);
    });
  }

  function getSheetCell(row, index) {
    const cell = row.c && row.c[index];
    if (!cell || cell.v == null) return "";
    return String(cell.v).trim();
  }

  /** Фиксированная схема публичной таблицы: A–F. */
  const DEFAULT_COL_MAP = { name: 0, warranty: 1, country: 2, qty: 3, price: 4, warehouse: 5 };

  /**
   * gviz не отдаёт русские заголовки в cols.label (там буквы A,B,C…),
   * поэтому читаем первую строку диапазона или используем DEFAULT_COL_MAP.
   */
  function resolveSheetLayout(rows) {
    if (!rows.length) return { colMap: DEFAULT_COL_MAP, dataRows: [] };

    const firstCell = getSheetCell(rows[0], 0).toLowerCase();
    if (!firstCell.includes("товар")) {
      return { colMap: DEFAULT_COL_MAP, dataRows: rows };
    }

    const map = { name: 0, warranty: 1, country: 2, qty: 3, price: 4, warehouse: 5 };
    for (let i = 0; i < 6; i++) {
      const label = getSheetCell(rows[0], i).toLowerCase();
      if (label.includes("гарант")) map.warranty = i;
      else if (label.includes("страна")) map.country = i;
      else if (label.includes("колич")) map.qty = i;
      else if (label.includes("склад")) map.warehouse = i;
    }
    for (let i = 5; i >= 0; i--) {
      const label = getSheetCell(rows[0], i).toLowerCase();
      if (label.includes("продаж") || label.includes("цена")) {
        map.price = i;
        break;
      }
    }
    return { colMap: map, dataRows: rows.slice(1) };
  }

  function parseSheetRow(row, colMap) {
    const pick = (idx) => (idx >= 0 ? getSheetCell(row, idx) : "");
    return {
      name: cleanStoredProductName(pick(colMap.name)),
      warranty: pick(colMap.warranty),
      country: pick(colMap.country),
      qty: pick(colMap.qty),
      priceRaw: pick(colMap.price),
      warehouse: pick(colMap.warehouse),
    };
  }

  /** Различаем «2шт» и «58200₽», если колонки перепутаны или D/E дублируют цену. */
  function normalizeProductFields(qty, priceRaw) {
    let q = String(qty || "").trim();
    let p = String(priceRaw || "").trim();
    const priceNum = parsePrice(p);
    const qtyNum = parsePrice(q);

    if (priceNum > 0 && priceNum < 1000 && /шт/i.test(q)) {
      return { qty: q, priceRaw: "" };
    }

    if (priceNum >= 1000 && qtyNum >= 1000 && q === p) {
      return { qty: "", priceRaw: p };
    }

    if ((priceNum < 1000 || !p) && qtyNum >= 1000 && !/шт/i.test(q)) {
      return { qty: "", priceRaw: q };
    }

    return { qty: q, priceRaw: p };
  }

  function cleanStoredProductName(name) {
    return String(name || "").replace(/(\D)(\d{4,})$/, "$1").trim();
  }

  function resolveAccessorySection(name) {
    const t = name || "";
    if (/pencil/i.test(t))                              return "✏️ Pencil";
    if (/magic mouse/i.test(t))                         return "🖱 Apple Mouse";
    if (/airtag/i.test(t))                              return "📍 AirTag";
    if (/smarttag/i.test(t))                            return "📍 Galaxy SmartTag";
    if (/антишпион/i.test(t))                           return "🛡 Стекло 3D Remax Антишпион";
    if (/remax|защитное стекло/i.test(t))               return "🛡 Стекло 3D Remax";
    if (/чехол-бумажник|wallet/i.test(t))               return "👜 Чехол-бумажник PITAKA";
    if (/чехол pitaka/i.test(t))                        return "📱 Чехлы PITAKA";
    if (/ремешк/i.test(t))                              return "⌚ Ремешки PITAKA";
    if (/сзу|charger|зарядк/i.test(t))                  return "🔌 Зарядки";
    return "🔌 Accessories";
  }

  function normalizeSectionLabel(section) {
    const s = String(section || "").replace(/\s+/g, " ").trim();
    if (/^📱\s*iPhone Air(?:\s+eSIM)?$/i.test(s)) return "📱 iPhone Air eSIM";
    return s;
  }

  function isCategoryRow(name, warranty, country, qty, price) {
    return name && !warranty && !country && !qty && !price;
  }

  function detectCategory(text) {
    for (const rule of CATEGORY_RULES) {
      if (rule.id !== "other" && rule.test(text)) return rule.id;
    }
    return null;
  }

  function parsePrice(v) {
    if (typeof v === "number") return Math.round(v);
    const n = String(v).replace(/[^\d]/g,"");
    return n ? parseInt(n, 10) : 0;
  }

  function formatPrice(n) {
    return n.toLocaleString("ru-RU") + " ₽";
  }

  function formatNow() {
    return new Date().toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function showError(msg) {
    if (els.loading) els.loading.hidden = true;
    if (els.error) {
      els.error.hidden = false;
      els.error.textContent = msg;
    }
  }

  function normalizeSearch(s) {
    return String(s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\wа-я\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function translitRuToLat(s) {
    const map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
      к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
      ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
      ю: "yu", я: "ya",
    };
    return normalizeSearch(s)
      .split("")
      .map((ch) => map[ch] ?? ch)
      .join("");
  }

  const SORTED_TRANSLATIONS = [...SEARCH_DICT.translate].sort((a, b) => b[0].length - a[0].length);
  const SORTED_TRANSLIT_ENTRIES = Object.entries(SEARCH_DICT.translit).sort(
    (a, b) => b[0].length - a[0].length
  );
  const REVERSE_TRANSLATIONS = new Map();
  for (const [en, ruList] of SORTED_TRANSLATIONS) {
    const normEn = normalizeSearch(en);
    for (const ru of ruList) {
      const normRu = normalizeSearch(ru);
      if (!REVERSE_TRANSLATIONS.has(normRu)) REVERSE_TRANSLATIONS.set(normRu, new Set());
      REVERSE_TRANSLATIONS.get(normRu).add(normEn);
      ruList.forEach((r) => REVERSE_TRANSLATIONS.get(normRu).add(normalizeSearch(r)));
    }
  }

  const termPatternCache = new Map();
  const longestTranslitCache = new Map();
  const longestTranslateCache = new Map();
  const expandTokenCache = new Map();

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function termPattern(term) {
    const t = normalizeSearch(term);
    if (!termPatternCache.has(t)) {
      const re =
        t.length <= 3
          ? new RegExp(`\\b${escapeRegExp(t)}\\b`, "i")
          : new RegExp(escapeRegExp(t), "i");
      termPatternCache.set(t, re);
    }
    return termPatternCache.get(t);
  }

  function textHasTerm(text, term) {
    const normalized = normalizeSearch(text);
    const t = normalizeSearch(term);
    if (t.length > 3) return normalized.includes(t);
    return termPattern(term).test(normalized);
  }

  function expandTransliteration(text) {
    const parts = new Set();
    const normalized = normalizeSearch(text);
    parts.add(normalized);

    for (const [en, variants] of SORTED_TRANSLIT_ENTRIES) {
      if (!textHasTerm(normalized, en)) continue;
      parts.add(en);
      variants.forEach((v) => parts.add(normalizeSearch(v)));
    }

    for (const [en, ruList] of SORTED_TRANSLATIONS) {
      if (!textHasTerm(normalized, en)) continue;
      parts.add(normalizeSearch(en));
      ruList.forEach((ru) => parts.add(normalizeSearch(ru)));
    }

    return parts;
  }

  function expandTranslations(text) {
    const parts = new Set();
    const normalized = normalizeSearch(text);

    for (const [en, ruList] of SORTED_TRANSLATIONS) {
      if (!textHasTerm(normalized, en)) continue;
      parts.add(normalizeSearch(en));
      ruList.forEach((ru) => parts.add(normalizeSearch(ru)));
    }

    return parts;
  }

  function expandNeedles(variants) {
    const out = new Set();
    for (const variant of variants) {
      if (!variant) continue;
      out.add(variant);
      const lat = translitRuToLat(variant);
      if (lat) out.add(lat);
    }
    return [...out];
  }

  function compactToken(s) {
    return normalizeSearch(s).replace(/\s+/g,"");
  }

  /** Строгое совпадение формы слова (с учётом мн. ч. и пробелов). */
  function tokenMatchesForm(token, form) {
    const t = compactToken(token);
    const f = compactToken(form);
    if (!t || !f) return false;
    if (t === f) return true;
    if (t === f + "ы" || t === f + "и" || t + "ы" === f || t + "и" === f) return true;
    return false;
  }

  function getLongestTranslitMatch(token) {
    const key = compactToken(token);
    if (longestTranslitCache.has(key)) return longestTranslitCache.get(key);
    let hit = null;
    for (const [en, variants] of SORTED_TRANSLIT_ENTRIES) {
      const forms = [en, ...variants];
      if (forms.some((f) => tokenMatchesForm(token, f))) {
        hit = { en, variants };
        break;
      }
    }
    longestTranslitCache.set(key, hit);
    return hit;
  }

  function getLongestTranslateMatch(token) {
    const key = compactToken(token);
    if (longestTranslateCache.has(key)) return longestTranslateCache.get(key);
    let hit = null;
    for (const [en, ruList] of SORTED_TRANSLATIONS) {
      const forms = [en, ...ruList];
      if (forms.some((f) => tokenMatchesForm(token, f))) {
        hit = { en, ruList };
        break;
      }
    }
    longestTranslateCache.set(key, hit);
    return hit;
  }

  /** Составное слово (airpods) в запросе — убираем укороченные токены (эир, air). */
  function refineQueryTokens(tokens) {
    const compoundKeys = new Set();

    for (const token of tokens) {
      const translitHit = getLongestTranslitMatch(token);
      const translateHit = getLongestTranslateMatch(token);
      const candidates = [];
      if (translitHit) candidates.push(translitHit.en);
      if (translateHit) candidates.push(compactToken(translateHit.en));
      const best = candidates.sort((a, b) => b.length - a.length)[0];
      if (best && best.length >= 5) compoundKeys.add(best);
    }

    if (!compoundKeys.size) return tokens;

    const subsumedShort = new Set();
    for (const compound of compoundKeys) {
      for (const [en] of SORTED_TRANSLIT_ENTRIES) {
        if (en.length < compound.length && compound.startsWith(en)) subsumedShort.add(en);
      }
    }

    const refined = tokens.filter((token) => {
      const translitHit = getLongestTranslitMatch(token);
      if (translitHit && compoundKeys.has(translitHit.en)) return true;

      const translateHit = getLongestTranslateMatch(token);
      if (translateHit && compoundKeys.has(compactToken(translateHit.en))) return true;

      for (const short of subsumedShort) {
        const forms = [short, ...SEARCH_DICT.translit[short]];
        if (forms.some((f) => tokenMatchesForm(token, f))) return false;
      }
      return true;
    });

    return refined.length ? refined : tokens;
  }

  function expandToken(token) {
    const key = compactToken(token);
    if (expandTokenCache.has(key)) return expandTokenCache.get(key);

    const variants = new Set();
    const norm = normalizeSearch(token);
    if (!norm) {
      expandTokenCache.set(key, []);
      return [];
    }

    const translitHit = getLongestTranslitMatch(token);
    const translateHit = getLongestTranslateMatch(token);
    const hits = [];
    if (translitHit) hits.push({ key: translitHit.en, forms: [translitHit.en, ...translitHit.variants] });
    if (translateHit) {
      hits.push({
        key: compactToken(translateHit.en),
        forms: [translateHit.en, ...translateHit.ruList],
      });
    }
    hits.sort((a, b) => b.key.length - a.key.length);

    if (hits.length) {
      const best = hits[0];
      best.forms.forEach((f) => {
        variants.add(normalizeSearch(f));
        variants.add(compactToken(f));
      });
    } else {
      variants.add(norm);
      const reverse = REVERSE_TRANSLATIONS.get(norm);
      if (reverse) reverse.forEach((v) => variants.add(v));
    }

    const result = expandNeedles([...variants].filter(Boolean));
    expandTokenCache.set(key, result);
    return result;
  }

  /** Синонимы только из слов, уже есть в названии товара — быстрее при загрузке. */
  function appendProductSynonyms(base, parts) {
    for (const [en, ruList] of SORTED_TRANSLATIONS) {
      const normEn = normalizeSearch(en);
      if (normEn.length < 2 || !base.includes(normEn)) continue;
      parts.add(normEn);
      ruList.forEach((ru) => parts.add(normalizeSearch(ru)));
    }
    for (const [en, variants] of SORTED_TRANSLIT_ENTRIES) {
      if (!base.includes(en)) continue;
      parts.add(en);
      variants.forEach((v) => parts.add(normalizeSearch(v)));
    }
  }

  function buildSearchText(name, country, section, warranty) {
    const base = normalizeSearch([name, country, section, warranty].filter(Boolean).join(" "));
    const parts = new Set([base, translitRuToLat(base)]);
    appendProductSynonyms(base, parts);
    [...parts].forEach((p) => parts.add(translitRuToLat(p)));
    return [...parts].join(" ");
  }

  /** Разбор запроса один раз на ввод, не на каждый товар. */
  function prepareQueryPlan(query) {
    const q = normalizeSearch(query);
    if (queryPlanCache.raw === q && queryPlanCache.plan) return queryPlanCache.plan;

    if (!q) {
      queryPlanCache = { raw: q, plan: { matchAll: true } };
      return queryPlanCache.plan;
    }

    const phraseVariants = new Set([q]);
    expandTransliteration(q).forEach((v) => phraseVariants.add(v));
    expandTranslations(q).forEach((v) => phraseVariants.add(v));

    const tokens = refineQueryTokens(q.split(/\s+/).filter(Boolean));
    const plan = {
      matchAll: false,
      phraseNeedles: expandNeedles([...phraseVariants]),
      tokenNeedles: tokens.map((token) => expandToken(token)),
    };

    queryPlanCache = { raw: q, plan };
    return plan;
  }

  function matchesSearch(product, plan) {
    if (!plan || plan.matchAll) return true;

    const hay = product.searchText;
    if (!hay) return false;

    for (let i = 0; i < plan.phraseNeedles.length; i++) {
      if (hay.includes(plan.phraseNeedles[i])) return true;
    }

    if (!plan.tokenNeedles.length) return true;

    for (let t = 0; t < plan.tokenNeedles.length; t++) {
      const needles = plan.tokenNeedles[t];
      let found = false;
      for (let n = 0; n < needles.length; n++) {
        if (hay.includes(needles[n])) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }

    return true;
  }

  function getCategoryFilterRegistry() {
    const cat = els.category?.value || "all";
    if (cat === "all") return null;
    return window.IRON_SHOP_FILTERS?.[cat] || null;
  }

  function getActiveCategoryFilters() {
    const cat = els.category?.value || "all";
    if (cat === "all") return {};
    if (!categoryFilterState[cat]) categoryFilterState[cat] = {};
    return categoryFilterState[cat];
  }

  function resetCategoryFiltersForSelection() {
    const cat = els.category?.value || "all";
    if (cat !== "all" && categoryFilterState[cat]) {
      for (const key of Object.keys(categoryFilterState[cat])) {
        categoryFilterState[cat][key] = "";
      }
    }
  }

  function getCategoryProducts(cat) {
    return allProducts.filter((p) => p.category === cat);
  }

  function matchesCategoryFilters(product) {
    const registry = getCategoryFilterRegistry();
    if (!registry) return true;
    return registry.matches(product, getActiveCategoryFilters());
  }

  function isMobileFiltersView() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function buildFilterGroupHtml(registry, products, active, facet, includeAllChip, hideLabel) {
    const options = registry.collectOptions(products, facet.id, { ...active, [facet.id]: "" });
    if (!options.length) return "";

    const chips = [];
    if (includeAllChip) {
      chips.push(
        `<button type="button" class="shop-filter-chip${active[facet.id] ? "" : " is-active"}" data-facet="${escapeHtml(
          facet.id
        )}" data-value="">Все</button>`
      );
    }
    for (const value of options) {
      const isActive = active[facet.id] === value;
      chips.push(
        `<button type="button" class="shop-filter-chip${isActive ? " is-active" : ""}" data-facet="${escapeHtml(
          facet.id
        )}" data-value="${escapeHtml(value)}">${escapeHtml(registry.formatValue(facet.id, value))}</button>`
      );
    }

    const labelHtml = hideLabel
      ? ""
      : `<span class="shop-filter-group__label">${escapeHtml(facet.label)}</span>`;

    return `
      <div class="shop-filter-group">
        ${labelHtml}
        <div class="shop-filter-group__chips">${chips.join("")}</div>
      </div>`;
  }

  function buildMobileSelectionTrailHtml(registry, active) {
    const items = registry.facets
      .filter((facet) => active[facet.id])
      .map((facet) => ({
        facetId: facet.id,
        label: registry.formatValue(facet.id, active[facet.id]),
      }));

    if (!items.length) return "";

    return `
      <div class="shop-filters-trail" aria-label="Выбранные параметры">
        ${items
          .map(
            (item) =>
              `<button type="button" class="shop-filters-trail__chip" data-action="wizard-edit-step" data-facet="${escapeHtml(
                item.facetId
              )}">${escapeHtml(item.label)}</button>`
          )
          .join("")}
      </div>`;
  }

  function bindFilterChipHandlers(root, active, rerender) {
    root.querySelectorAll(".shop-filter-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const facetId = btn.dataset.facet || "";
        const value = btn.dataset.value || "";
        if (!facetId) return;
        active[facetId] = value;
        rerender();
      });
    });

    root.querySelector('[data-action="reset-filters"]')?.addEventListener("click", () => {
      resetCategoryFiltersForSelection();
      rerender();
    });

    root.querySelector('[data-action="wizard-back"]')?.addEventListener("click", () => {
      const registry = getCategoryFilterRegistry();
      const stepId = root.querySelector(".shop-filters-wizard")?.dataset.step || "";
      if (registry?.goBackMobileWizardStep && stepId) {
        registry.goBackMobileWizardStep(active, stepId);
      }
      rerender();
    });

    root.querySelectorAll('[data-action="wizard-edit-step"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const registry = getCategoryFilterRegistry();
        const facetId = btn.dataset.facet || "";
        if (registry?.clearMobileWizardFromStep && facetId) {
          registry.clearMobileWizardFromStep(active, facetId);
        }
        rerender();
      });
    });
  }

  function renderDesktopCategoryFilters(root, registry, products, active, cat) {
    const hasActive = Object.values(active).some(Boolean);
    const groupsHtml = registry.facets
      .map((facet) => buildFilterGroupHtml(registry, products, active, facet, true))
      .filter(Boolean)
      .join("");

    if (!groupsHtml) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }

    root.hidden = false;
    root.innerHTML = `
      <div class="shop-filters shop-filters--desktop">
        <div class="shop-filters__head">
          <strong class="shop-filters__title">Подбор ${escapeHtml(registry.label || cat)}</strong>
          ${
            hasActive
              ? '<button type="button" class="shop-filters__reset" data-action="reset-filters">Сбросить</button>'
              : ""
          }
        </div>
        <div class="shop-filters__groups">${groupsHtml}</div>
      </div>`;

    bindFilterChipHandlers(root, active, renderGrid);
  }

  function renderMobileCategoryFilters(root, registry, products, active, cat) {
    const step = registry.getMobileWizardStep?.(products, active) || "series";
    const hasActive = Object.values(active).some(Boolean);
    const trailHtml = buildMobileSelectionTrailHtml(registry, active);

    if (step === "done") {
      root.hidden = false;
      root.innerHTML = `
        <div class="shop-filters shop-filters--mobile">
          <div class="shop-filters__head">
            <strong class="shop-filters__title">Подбор ${escapeHtml(registry.label || cat)}</strong>
            <button type="button" class="shop-filters__reset" data-action="reset-filters">Сбросить</button>
          </div>
          ${trailHtml}
        </div>`;
      bindFilterChipHandlers(root, active, renderGrid);
      return;
    }

    const facet = registry.facets.find((item) => item.id === step);
    if (!facet) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }

    const prompt = registry.getMobileWizardPrompt?.(step) || facet.label;
    const groupHtml = buildFilterGroupHtml(registry, products, active, facet, false, true);
    if (!groupHtml) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }

    root.hidden = false;
    root.innerHTML = `
      <div class="shop-filters shop-filters--mobile">
        <div class="shop-filters__head">
          <strong class="shop-filters__title">Подбор ${escapeHtml(registry.label || cat)}</strong>
          ${
            hasActive
              ? '<button type="button" class="shop-filters__reset" data-action="reset-filters">Сброс</button>'
              : ""
          }
        </div>
        ${trailHtml}
        <div class="shop-filters-wizard" data-step="${escapeHtml(step)}">
          <div class="shop-filters-wizard__head">
            ${
              step !== "series"
                ? '<button type="button" class="shop-filters-wizard__back" data-action="wizard-back">← Назад</button>'
                : ""
            }
            <p class="shop-filters-wizard__prompt">${escapeHtml(prompt)}</p>
          </div>
          <div class="shop-filters-wizard__body">${groupHtml}</div>
        </div>
      </div>`;

    bindFilterChipHandlers(root, active, renderGrid);
  }

  function renderCategoryFilters() {
    const root = els.filtersRoot;
    if (!root) return;

    const cat = els.category?.value || "all";
    const registry = getCategoryFilterRegistry();
    if (!registry) {
      root.hidden = true;
      root.innerHTML = "";
      return;
    }

    const products = getCategoryProducts(cat);
    const active = getActiveCategoryFilters();

    if (isMobileFiltersView()) {
      renderMobileCategoryFilters(root, registry, products, active, cat);
    } else {
      renderDesktopCategoryFilters(root, registry, products, active, cat);
    }
  }

  function getFiltered() {
    const q = (els.search?.value || "").trim();
    const cat = els.category?.value || "all";
    const plan = prepareQueryPlan(q);

    return allProducts.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (!matchesCategoryFilters(p)) return false;
      return matchesSearch(p, plan);
    });
  }

  function scheduleRenderGrid() {
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      renderGrid();
    }, 120);
  }

  function groupBySection(items) {
    const groups = [];
    const indexBySection = new Map();

    for (const product of items) {
      const key = product.section || "";
      if (!indexBySection.has(key)) {
        indexBySection.set(key, groups.length);
        groups.push({ section: key, items: [] });
      }
      groups[indexBySection.get(key)].items.push(product);
    }

    return groups;
  }

  function getIphoneSectionSortKey(section) {
    const s = String(section || "")
      .replace(/^📱\s*/u,"")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    let modelRank = 9999;
    if (/^iphone 14\b/.test(s)) modelRank = /\bplus\b/.test(s) ? 141 : 140;
    else if (/^iphone 15\b/.test(s)) modelRank = /\bplus\b/.test(s) ? 151 : 150;
    else if (/^iphone 16e\b/.test(s)) modelRank = 160;
    else if (/^iphone 16\b/.test(s)) modelRank = /\bplus\b/.test(s) ? 162 : 161;
    else if (/^iphone 17e\b/.test(s)) modelRank = 170;
    else if (/^iphone 17 pro max\b/.test(s)) modelRank = 174;
    else if (/^iphone 17 pro\b/.test(s)) modelRank = 173;
    else if (/^iphone air\b/.test(s)) modelRank = 172;
    else if (/^iphone 17\b/.test(s)) modelRank = 171;

    let simRank = 0;
    if (/\bsim\s*\+\s*esim\b/.test(s)) simRank = 2;
    else if (/\besim\b/.test(s)) simRank = 1;

    return modelRank * 10 + simRank;
  }

  function sortGroups(groups, selectedCategory) {
    if (selectedCategory !== "iphone") return groups;
    return [...groups].sort((a, b) => {
      const ka = getIphoneSectionSortKey(a.section);
      const kb = getIphoneSectionSortKey(b.section);
      if (ka !== kb) return ka - kb;
      return String(a.section || "").localeCompare(String(b.section || ""), "ru");
    });
  }

  function renderProductCard(p) {
    const inCart = getCartIndexByProductId(p.id) >= 0;
    const hasHybrid =
      (p.category === "iphone" ||
        p.category === "ipad" ||
        p.category === "macbook" ||
        p.category === "watch" ||
        p.category === "airpods") &&
      p.hybridDetailUrl;
    const detailLink = hasHybrid ? withProductIdQueryParam(p.hybridDetailUrl, p.id) : "";
    const previewImage = hasHybrid && p.hybridCoverUrl ? p.hybridCoverUrl : "";
    const nameHtml = detailLink
      ? `<a href="${escapeHtml(detailLink)}" class="price-card__name-link">${escapeHtml(p.name)}</a>`
      : escapeHtml(p.name);
    return `
      <article class="price-card ${inCart ? "is-selected" : ""}" data-id="${p.id}">
        ${
          previewImage
            ? `<a class="price-card__media" href="${escapeHtml(detailLink)}" aria-label="${escapeHtml(
                p.name
              )}"><img src="${escapeHtml(previewImage)}" alt="${escapeHtml(
                p.name
              )}" loading="lazy" decoding="async"></a>`
            : ""
        }
        <div class="price-card__meta">
          ${p.country ? `<span class="price-card__country">${escapeHtml(p.country)}</span>` : ""}
        </div>
        <h3 class="price-card__name">${nameHtml}</h3>
        ${p.warranty ? `<p class="price-card__warranty">${escapeHtml(p.warranty)}</p>` : ""}
        ${p.warehouse ? `<p class="price-card__qty">${escapeHtml(p.warehouse)}</p>` : ""}
        <div class="price-card__footer">
          <strong class="price-card__price">${escapeHtml(p.priceLabel)}</strong>
          <button type="button" class="price-card__btn ${inCart ? "is-active" : ""}" data-action="toggle" data-id="${p.id}">
            ${inCart ? "✓ В корзине" : "+ Выбрать"}
          </button>
        </div>
      </article>`;
  }

  function renderGrid() {
    if (!els.grid) return;
    renderCategoryFilters();
    const selectedCategory = els.category?.value || "all";
    const groups = sortGroups(groupBySection(getFiltered()), selectedCategory);

    if (!groups.length) {
      els.grid.innerHTML = '<p class="price-grid-empty">Ничего не найдено. Попробуйте другой запрос.</p>';
      return;
    }

    els.grid.innerHTML = groups
      .map(({ section, items }) => {
        const header = section
          ? `<header class="price-section-head"><h2 class="price-section-title">${escapeHtml(section)}</h2></header>`
          : "";
        return header + items.map(renderProductCard).join("");
      })
      .join("");

    els.grid.querySelectorAll("[data-action=toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleCart(btn.dataset.id));
    });
  }

  function toggleCart(id) {
    const product = allProducts.find((p) => idsLookEqual(p.id, id));
    if (!product) return;
    const idx = getCartIndexByProductId(id);
    const added = idx < 0;
    if (added) cart.push(product);
    else removeCartByProductId(id);
    saveCart();
    renderCart();
    renderGrid();
    if (isMobileShop()) {
      if (added) pulseMobileCartBar();
      else if (!cart.length) els.cartPanel?.classList.remove("is-open");
    } else {
      els.cartPanel?.classList.add("is-open");
    }
  }

  function renderCart() {
    const count = cart.length;
    const total = cart.reduce((s, p) => s + p.price, 0);

    const totalLabel = count ? formatPrice(total) : "—";
    if (els.cartCount) els.cartCount.textContent = String(count);
    if (els.cartTotal) els.cartTotal.textContent = totalLabel;
    if (els.cartTotalMobile) els.cartTotalMobile.textContent = totalLabel;
    if (els.cartTelegram) els.cartTelegram.disabled = count === 0;

    if (!els.cartList) return;
    if (!count) {
      els.cartList.innerHTML = '<li class="cart-empty">Выберите устройства в прайсе</li>';
      return;
    }

    els.cartList.innerHTML = cart
      .map(
        (p, i) => `
      <li class="cart-item">
        <span class="cart-item__num">${i + 1}</span>
        <div class="cart-item__body">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.priceLabel)}${p.country ? " · " + escapeHtml(p.country) : ""}${p.warehouse ? " · " + escapeHtml(p.warehouse) : ""}</span>
        </div>
        <button type="button" class="cart-item__remove" data-id="${p.id}" aria-label="Убрать">×</button>
      </li>`
      )
      .join("");

    els.cartList.querySelectorAll(".cart-item__remove").forEach((btn) => {
      btn.addEventListener("click", () => toggleCart(btn.dataset.id));
    });
  }

  function openTelegramOrder() {
    if (!cart.length) return;
    const lines = cart.map(
      (p, i) =>
        `${i + 1}. ${p.name}${p.country ? " " + p.country : ""}${p.warehouse ? " " + p.warehouse : ""} — ${p.priceLabel}`
    );
    const text = [
      "Заявка с сайта IRON SERVICE",
      "Хочу купить / забронировать:","",
      ...lines,"",
      `Итого ориентир: ${formatPrice(cart.reduce((s, p) => s + p.price, 0))}`].join("\n");

    const url = `https://t.me/${TG_USER}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      const normalized = normalizeStoredCart(raw);
      localStorage.setItem(CART_KEY, JSON.stringify(normalized));
      return normalized;
    } catch {
      return [];
    }
  }

  function saveCart() {
    const normalized = normalizeStoredCart(cart);
    cart = normalized;
    localStorage.setItem(CART_KEY, JSON.stringify(normalized));
  }

  function withProductIdQueryParam(url, productId) {
    const safeUrl = String(url || "").trim();
    const safeId = String(productId || "").trim();
    if (!safeUrl || !safeId) return safeUrl;
    return safeUrl + (safeUrl.includes("?") ? "&" : "?") + `${CART_PRODUCT_ID_QUERY_PARAM}=${encodeURIComponent(safeId)}`;
  }

  function normalizeStoredCart(rawCart) {
    const input = Array.isArray(rawCart) ? rawCart : rawCart?.items;
    if (!Array.isArray(input)) return [];
    const out = [];
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.id || "").trim();
      if (!id) continue;
      const name = String(item.name || "").trim();
      const country = String(item.country || "").trim();
      const warehouse = String(item.warehouse || "").trim();
      const price = parsePrice(item.price) || parsePrice(item.priceLabel);
      out.push({
        id,
        name,
        country,
        warehouse,
        price,
        priceLabel: formatPrice(price),
      });
    }
    return dedupeCartById(out);
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

  function normalizeCartIdForCompare(id) {
    const raw = String(id || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-z0-9а-я]+/giu, "-")
      .replace(/^-+|-+$/g,"");
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

  function getCartIndexByProductId(productId) {
    if (!productId) return -1;
    return cart.findIndex((item) => idsLookEqual(item?.id, productId));
  }

  function removeCartByProductId(productId) {
    if (!productId) return;
    cart = cart.filter((item) => !idsLookEqual(item?.id, productId));
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").slice(0, 80);
  }

  function slugifyWithSuffix(prefix, suffix) {
    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-+|-+$/g,"");

    const safePrefix = normalize(prefix);
    const safeSuffix = normalize(suffix);
    if (!safeSuffix) return safePrefix.slice(0, 80);

    const maxPrefixLen = 80 - safeSuffix.length - 1;
    if (maxPrefixLen <= 0) return safeSuffix.slice(-80);

    const trimmedPrefix = safePrefix.slice(0, maxPrefixLen).replace(/-+$/g,"");
    return trimmedPrefix ? `${trimmedPrefix}-${safeSuffix}` : safeSuffix;
  }

  function buildIphoneDetailFallbackUrl(product) {
    const byName = slugify(product.name || "");
    if (byName) return `hybrid-products/${byName}.html`;

    const priceSuffix = parsePrice(product.price) || parsePrice(product.priceLabel);
    const byWarehouseAndPrice = slugifyWithSuffix(
      `${product.name || ""}${product.warehouse || ""}`,
      priceSuffix
    );
    return byWarehouseAndPrice ? `hybrid-products/iphone/${byWarehouseAndPrice}.html` : "";
  }

  function buildMacbookDetailFallbackUrl(product) {
    const priceSuffix = parsePrice(product.price) || parsePrice(product.priceLabel);
    const byWarehouseAndPrice = slugifyWithSuffix(
      `${product.name || ""}${product.warehouse || ""}`,
      priceSuffix
    );
    return byWarehouseAndPrice ? `hybrid-products/macbook/${byWarehouseAndPrice}.html` : "";
  }

  function buildIpadDetailFallbackUrl(product) {
    const priceSuffix = parsePrice(product.price) || parsePrice(product.priceLabel);
    const byWarehouseAndPrice = slugifyWithSuffix(
      `${product.name || ""}${product.warehouse || ""}`,
      priceSuffix
    );
    return byWarehouseAndPrice ? `hybrid-products/ipad/${byWarehouseAndPrice}.html` : "";
  }

  function buildWatchDetailFallbackUrl(product) {
    const priceSuffix = parsePrice(product.price) || parsePrice(product.priceLabel);
    const byWarehouseAndPrice = slugifyWithSuffix(
      `${product.name || ""}${product.warehouse || ""}`,
      priceSuffix
    );
    return byWarehouseAndPrice ? `hybrid-products/watch/${byWarehouseAndPrice}.html` : "";
  }

  function buildAirpodsDetailFallbackUrl(product) {
    const priceSuffix = parsePrice(product.price) || parsePrice(product.priceLabel);
    const byWarehouseAndPrice = slugifyWithSuffix(
      `${product.name || ""}${product.warehouse || ""}`,
      priceSuffix
    );
    return byWarehouseAndPrice ? `hybrid-products/airpods/${byWarehouseAndPrice}.html` : "";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  init();
})();
