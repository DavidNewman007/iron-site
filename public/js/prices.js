/**
 * Прайс из Google Таблицы (лист PriceDA-All) + корзина → Telegram @ironsochi
 */
(function () {
  const cfg = window.IRON_CONFIG || {};
  const SHEET_ID = cfg.googleSheetId || "";
  const SHEET_TAB = cfg.googleSheetTab || "Prices";
  const TG_USER = cfg.telegramOrderUser || "ironsochi";

  const CATEGORY_RULES = [
    { id: "iphone", label: "iPhone", icon: "📱", test: (t) => /iphone/i.test(t) },
    { id: "ipad", label: "iPad", icon: "🔳", test: (t) => /ipad/i.test(t) },
    {
      id: "mac",
      label: "Mac · AirPods · аксессуары",
      icon: "💻",
      test: (t) =>
        /macbook|airpods|pencil|аксессуар|accessories|гравировк|apple tv|playstation|dyson|sony|airwrap|supersonic|airstrait/i.test(
          t
        ),
    },
    { id: "watch", label: "Apple Watch", icon: "⌚", test: (t) => /watch/i.test(t) },
    {
      id: "samsung",
      label: "Samsung · Meta",
      icon: "📱",
      test: (t) => /samsung|meta|oakley|wayfarer|skyler/i.test(t),
    },
    { id: "other", label: "Прочее", icon: "◆", test: () => true },
  ];

  const SEARCH_DICT = window.IRON_SEARCH_DICT || { translit: {}, translate: [] };
  const PRICE_CACHE_KEY = "iron_prices_sheet_v1";
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
  let cart = loadCart();
  let searchRenderTimer = null;
  let queryPlanCache = { raw: "", plan: null };

  init();

  async function init() {
    bindEvents();
    renderCart();

    if (!SHEET_ID) {
      showError(
        "Укажите ID публичной таблицы в js/config.js → googleSheetId (отдельный файл, только прайс для сайта)."
      );
      return;
    }

    const cached = readPriceCache();
    if (cached && applyProducts(parseSheetJson(cached.json))) {
      refreshProductsInBackground();
      return;
    }

    try {
      const result = await fetchProducts();
      if (!applyProducts(result)) return;
    } catch (e) {
      console.error(e);
      const stale = readPriceCache(true);
      if (stale && applyProducts(parseSheetJson(stale.json))) return;
      showError(USER_LOAD_ERROR);
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

  async function refreshProductsInBackground() {
    try {
      const result = await fetchProducts();
      if (!result.products.length) return;
      allProducts = result.products;
      if (els.updated) {
        const when = result.updatedAt || formatNow();
        els.updated.textContent = `Обновлено: ${when} · ${allProducts.length} позиций`;
      }
      renderGrid();
    } catch (e) {
      console.warn("Фоновое обновление прайса не удалось:", e);
    }
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
    const range = "A1:E800";
    return (
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}&range=${range}`
    );
  }

  async function fetchProducts() {
    const json = await loadSheetJson(getSheetUrl());
    return parseSheetJson(json);
  }

  function parseSheetJson(json) {
    const rows = json.table?.rows || [];
    const { colMap, dataRows } = resolveSheetLayout(rows);

    const products = [];
    let updatedAt = "";
    let currentCategory = "other";
    let currentSection = "";

    for (const row of dataRows) {
      let { name, warranty, country, qty, priceRaw } = parseSheetRow(row, colMap);
      if (!name) continue;

      const updatedMatch = name.match(/^обновлено:\s*(.+)$/i);
      if (updatedMatch) {
        updatedAt = updatedMatch[1].trim();
        continue;
      }

      if (isCategoryRow(name, warranty, country, qty, priceRaw)) {
        currentSection = name;
        const cat = detectCategory(name);
        if (cat) currentCategory = cat;
        continue;
      }

      ({ qty, priceRaw } = normalizeProductFields(qty, priceRaw));
      if (priceRaw === "") continue;

      const price = parsePrice(priceRaw);
      if (!price || price < 1000) continue;

      const id = slugify(name + country + price);
      products.push({
        id,
        name,
        warranty: warranty || "",
        country: country || "",
        qty: qty || "",
        price,
        priceLabel: formatPrice(price),
        category: detectCategory(name) || currentCategory,
        section: currentSection,
        searchText: buildSearchText(name, country, currentSection, warranty),
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
    const apiBase = (cfg.apiUrl || "").replace(/\/$/, "");
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const json = await loadSheetJsonOnce(sheetUrl);
        writePriceCache(json);
        return json;
      } catch (e) {
        lastError = e;
        if (attempt < 2) await sleep(600 * (attempt + 1));
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

  /** Фиксированная схема публичной таблицы: A–E. */
  const DEFAULT_COL_MAP = { name: 0, warranty: 1, country: 2, qty: 3, price: 4 };

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

    const map = { name: 0, warranty: 1, country: 2, qty: 3, price: 4 };
    for (let i = 0; i < 5; i++) {
      const label = getSheetCell(rows[0], i).toLowerCase();
      if (label.includes("гарант")) map.warranty = i;
      else if (label.includes("страна")) map.country = i;
      else if (label.includes("колич")) map.qty = i;
    }
    for (let i = 4; i >= 0; i--) {
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
    const n = String(v).replace(/[^\d]/g, "");
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
    return normalizeSearch(s).replace(/\s+/g, "");
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
    if (queryPlanCache.raw === q) return queryPlanCache.plan;

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
    if (plan.matchAll) return true;

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

  function getFiltered() {
    const q = (els.search?.value || "").trim();
    const cat = els.category?.value || "all";
    const plan = prepareQueryPlan(q);

    return allProducts.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
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

  function renderProductCard(p) {
    const inCart = cart.some((c) => c.id === p.id);
    return `
      <article class="price-card ${inCart ? "is-selected" : ""}" data-id="${p.id}">
        <div class="price-card__meta">
          ${p.country ? `<span class="price-card__country">${escapeHtml(p.country)}</span>` : ""}
        </div>
        <h3 class="price-card__name">${escapeHtml(p.name)}</h3>
        ${p.warranty ? `<p class="price-card__warranty">${escapeHtml(p.warranty)}</p>` : ""}
        ${p.qty ? `<p class="price-card__qty">${escapeHtml(p.qty)}</p>` : ""}
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
    const groups = groupBySection(getFiltered());

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
    const product = allProducts.find((p) => p.id === id);
    if (!product) return;
    const idx = cart.findIndex((c) => c.id === id);
    const added = idx < 0;
    if (added) cart.push(product);
    else cart.splice(idx, 1);
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
          <span>${escapeHtml(p.priceLabel)}${p.country ? " · " + escapeHtml(p.country) : ""}</span>
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
        `${i + 1}. ${p.name}${p.country ? " " + p.country : ""} — ${p.priceLabel}`
    );
    const text = [
      "Заявка с сайта IRON SERVICE",
      "Хочу купить / забронировать:",
      "",
      ...lines,
      "",
      `Итого ориентир: ${formatPrice(cart.reduce((s, p) => s + p.price, 0))}`,
    ].join("\n");

    const url = `https://t.me/${TG_USER}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem("iron_cart") || "[]");
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem("iron_cart", JSON.stringify(cart));
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").slice(0, 80);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
