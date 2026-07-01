(function () {
  const CART_KEY = "iron_cart";
  const PID_PARAM = "pid";
  const SHEET_TABS = ["Prices", "Prices-2"];
  const CATALOG_CACHE_KEY = "iron_catalog_products_v1";
  const PRICE_CACHE_KEY = "iron_prices_sheet_Prices_Prices-2_v5";
  const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
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
    "австралия"]);

  const DEFAULT_COL_MAP = { name: 0, warranty: 1, country: 2, qty: 3, price: 4, warehouse: 5 };

  function parsePrice(value) {
    const digits = String(value || "").replace(/[^\d]/g,"");
    return digits ? parseInt(digits, 10) : 0;
  }

  function formatPrice(value) {
    const price = typeof value === "number" ? value : parsePrice(value);
    return price.toLocaleString("ru-RU") + " ₽";
  }

  function slugify(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "-")
      .slice(0, 80);
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
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

  function getScriptBase() {
    const script = document.currentScript;
    if (script?.src) return script.src.replace(/[^/]+$/,"");
    return "../../js/";
  }

  function ensureConfig() {
    if (window.IRON_CONFIG?.googleSheetId) return Promise.resolve(window.IRON_CONFIG);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = getScriptBase() + "config.js";
      s.onload = () => resolve(window.IRON_CONFIG || {});
      s.onerror = () => reject(new Error("Не удалось загрузить config.js"));
      document.head.appendChild(s);
    });
  }

  function getSheetCell(row, index) {
    const cell = row.c && row.c[index];
    if (!cell || cell.v == null) return "";
    return String(cell.v).trim();
  }

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
    return String(name || "")
      .replace(/(\D)(\d{4,})$/, "$1")
      .trim();
  }

  function isCategoryRow(name, warranty, country, qty, price) {
    return name && !warranty && !country && !qty && !price;
  }

  function parseCatalogFromGviz(json) {
    const rows = json.table?.rows || [];
    const { colMap, dataRows } = resolveSheetLayout(rows);
    const products = [];

    for (const row of dataRows) {
      let { name, warranty, country, qty, priceRaw, warehouse } = parseSheetRow(row, colMap);
      if (!name) continue;
      if (/^обновлено:\s*/i.test(name)) continue;
      if (isCategoryRow(name, warranty, country, qty, priceRaw)) continue;

      ({ qty, priceRaw } = normalizeProductFields(qty, priceRaw));
      if (!priceRaw) continue;

      const price = parsePrice(priceRaw);
      if (!price || price < 100) continue;

      products.push({
        id: slugify(name + country + warehouse + price),
        name,
        country: country || "",
        warehouse: warehouse || "",
        price,
        priceLabel: formatPrice(price),
      });
    }

    return products;
  }

  function parseGvizResponse(text) {
    const match = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw new Error("Неверный ответ Google Sheets");
    return JSON.parse(match[1]);
  }

  function writeCatalogCache(products) {
    if (!Array.isArray(products) || !products.length) return;
    try {
      sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(products));
    } catch {
      /* sessionStorage может быть недоступен */
    }
  }

  function readCatalogCache() {
    try {
      const raw = sessionStorage.getItem(CATALOG_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }

  function readPriceSheetCache(allowExpired) {
    try {
      const raw = sessionStorage.getItem(PRICE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.json) return null;
      if (!allowExpired && Date.now() - parsed.ts > PRICE_CACHE_TTL_MS) return null;
      return parsed.json;
    } catch {
      return null;
    }
  }

  function getCatalogSync() {
    const cached = readCatalogCache();
    if (cached?.length) return cached;

    const sheetJson = readPriceSheetCache(false);
    if (sheetJson) {
      const products = parseCatalogFromGviz(sheetJson);
      if (products.length) {
        writeCatalogCache(products);
        return products;
      }
    }

    return null;
  }

  async function fetchSheetJson(sheetUrl) {
    const res = await fetch(sheetUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseGvizResponse(await res.text());
  }

  async function fetchCatalogFromSheet(cfg) {
    const sheetId = cfg.googleSheetId;
    if (!sheetId) return [];

    const apiBase = String(cfg.apiUrl || "").replace(/\/$/,"");
    if (apiBase) {
      const res = await fetch(`${apiBase}/api/prices`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      return Array.isArray(payload?.products) ? payload.products : [];
    }

    const base = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`;
    const merged = [];
    const seenIds = new Set();

    for (const tab of SHEET_TABS) {
      const url = `${base}?tqx=out:json&sheet=${encodeURIComponent(tab)}&range=${encodeURIComponent("A1:F1200")}`;
      const json = await fetchSheetJson(url);
      for (const product of parseCatalogFromGviz(json)) {
        if (seenIds.has(product.id)) continue;
        seenIds.add(product.id);
        merged.push(product);
      }
    }

    return merged;
  }

  async function loadCatalog() {
    const sync = getCatalogSync();
    if (sync?.length) return sync;

    const cfg = await ensureConfig();
    try {
      const products = await fetchCatalogFromSheet(cfg);
      if (products.length) writeCatalogCache(products);
      return products;
    } catch (err) {
      const sheetJson = readPriceSheetCache(true);
      if (sheetJson) {
        const products = parseCatalogFromGviz(sheetJson);
        if (products.length) {
          writeCatalogCache(products);
          return products;
        }
      }
      throw err;
    }
  }

  function hasCanonicalPidInUrl() {
    return Boolean(String(new URLSearchParams(window.location.search).get(PID_PARAM) || "").trim());
  }

  function findCatalogProduct(catalog, pickBtn, productId) {
    if (productId) {
      const byId = catalog.find((item) => idsLookEqual(item.id, productId));
      if (byId) return byId;
      if (hasCanonicalPidInUrl()) return null;
    }

    const name = pickBtn?.dataset?.name;
    const country = pickBtn?.dataset?.country;
    const warehouse = pickBtn?.dataset?.warehouse;
    if (!name) return null;

    const nName = normalizeText(name);
    const nCountry = normalizeText(country);
    const nWarehouse = normalizeText(warehouse);

    const matches = catalog.filter(
      (item) =>
        normalizeText(item.name) === nName &&
        normalizeText(item.country) === nCountry &&
        normalizeText(item.warehouse) === nWarehouse
    );

    if (matches.length === 1) return matches[0];
    return null;
  }

  function getDetailWrap() {
    return document.querySelector(".detail-wrap");
  }

  function setPriceState(state) {
    const wrap = getDetailWrap();
    if (wrap) wrap.dataset.priceState = state;
  }

  function applyLivePrice(pickBtn, product) {
    const label = product.priceLabel || formatPrice(product.price);

    document.querySelectorAll(".price-card__price").forEach((el) => {
      el.textContent = label;
    });

    pickBtn.dataset.price = label;
    pickBtn.dataset.id = product.id;
    setPriceState("ready");
  }

  function markPriceError() {
    setPriceState("error");
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
    renderMobileCartBar();
  }

  function getTelegramUser() {
    return String(window.IRON_CONFIG?.telegramOrderUser || "ironsochi").replace(/^@/, "");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clearCart() {
    localStorage.setItem(CART_KEY, JSON.stringify([]));
    renderMobileCartBar();
    const pickBtn = document.getElementById("pickBtn");
    if (pickBtn) syncPickBtn(pickBtn);
  }

  function openTelegramOrder() {
    const cart = readCart();
    if (!cart.length) {
      window.location.href = "../../magazin.html";
      return;
    }
    const lines = cart.map(
      (p, i) =>
        `${i + 1}. ${p.name}${p.country ? " " + p.country : ""}${p.warehouse ? " " + p.warehouse : ""} — ${p.priceLabel || formatPrice(p.price)}`
    );
    const total = cart.reduce((s, p) => s + (p.price || 0), 0);
    const text = [
      "Заявка с сайта IRON SERVICE",
      "Хочу купить / забронировать:",
      "",
      ...lines,
      "",
      `Итого ориентир: ${formatPrice(total)}`,
    ].join("\n");
    const url = `https://t.me/${getTelegramUser()}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    clearCart();
  }

  function ensureMobileCartBar() {
    if (document.querySelector(".hybrid-detail-cart-bar")) return;
    const bar = document.createElement("div");
    bar.className = "cart-mobile-bar hybrid-detail-cart-bar";
    bar.innerHTML =
      '<span class="cart-mobile-bar__info">' +
      '<strong id="hybrid-cart-count-mobile">0</strong> шт. · <strong id="hybrid-cart-total-mobile">—</strong>' +
      "</span>" +
      '<button type="button" class="btn btn-primary" id="hybrid-cart-toggle">Корзина</button>';
    document.body.appendChild(bar);
    bar.querySelector("#hybrid-cart-toggle")?.addEventListener("click", openTelegramOrder);
  }

  function renderMobileCartBar() {
    ensureMobileCartBar();
    const cart = readCart();
    const count = cart.length;
    const total = cart.reduce((s, p) => s + (p.price || 0), 0);
    const countEl = document.getElementById("hybrid-cart-count-mobile");
    const totalEl = document.getElementById("hybrid-cart-total-mobile");
    if (countEl) countEl.textContent = String(count);
    if (totalEl) totalEl.textContent = count ? formatPrice(total) : "—";
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
    const wrap = getDetailWrap();
    if (wrap?.dataset.priceState !== "ready") {
      pickBtn.textContent = "+ Выбрать";
      pickBtn.classList.remove("is-active");
      return;
    }

    const productId = resolveProductId(pickBtn);
    const inCart = getCartIndex(readCart(), productId) >= 0;
    pickBtn.textContent = inCart ? "✓ В корзине" : "+ Выбрать";
    pickBtn.classList.toggle("is-active", inCart);
  }

  function tryApplyCatalogPrice(pickBtn, catalog) {
    if (!catalog?.length) return false;

    const productId = resolveProductId(pickBtn);
    const product = findCatalogProduct(catalog, pickBtn, productId);
    if (!product) return false;

    applyLivePrice(pickBtn, product);
    syncPickBtn(pickBtn);
    return true;
  }

  function parsePriceHintFromPagePath() {
    const match = window.location.pathname.match(/-s\d+-(\d{4,})\.html$/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  function tryFallbackPriceFromPagePath(pickBtn) {
    const hint = parsePriceHintFromPagePath();
    if (!hint || hint < 1000) return false;
    const productId = resolveProductId(pickBtn) || slugify(
      `${pickBtn.dataset.name || ""}${pickBtn.dataset.country || ""}${pickBtn.dataset.warehouse || ""}${hint}`
    );
    applyLivePrice(pickBtn, {
      id: productId,
      name: String(pickBtn.dataset.name || "").trim(),
      country: String(pickBtn.dataset.country || "").trim(),
      warehouse: String(pickBtn.dataset.warehouse || "").trim(),
      price: hint,
      priceLabel: formatPrice(hint),
    });
    syncPickBtn(pickBtn);
    return true;
  }

  async function syncLivePrice(pickBtn) {
    setPriceState("pending");

    const syncCatalog = getCatalogSync();
    if (tryApplyCatalogPrice(pickBtn, syncCatalog)) {
      /* показали цену из того же кэша, что и листинг */
    }

    try {
      const catalog = await loadCatalog();
      if (!catalog.length) {
        if (getDetailWrap()?.dataset.priceState !== "ready" && tryFallbackPriceFromPagePath(pickBtn)) return;
        if (getDetailWrap()?.dataset.priceState !== "ready") markPriceError();
        return;
      }

      const productId = resolveProductId(pickBtn);
      const product = findCatalogProduct(catalog, pickBtn, productId);
      if (!product) {
        if (getDetailWrap()?.dataset.priceState !== "ready" && tryFallbackPriceFromPagePath(pickBtn)) return;
        if (getDetailWrap()?.dataset.priceState !== "ready") markPriceError();
        return;
      }

      applyLivePrice(pickBtn, product);
      syncPickBtn(pickBtn);
    } catch (err) {
      console.warn("[hybrid-cart] price sync failed:", err);
      if (getDetailWrap()?.dataset.priceState !== "ready" && tryFallbackPriceFromPagePath(pickBtn)) return;
      if (getDetailWrap()?.dataset.priceState !== "ready") markPriceError();
    }
  }

  function initDetailCart() {
    const pickBtn = document.getElementById("pickBtn");
    if (!pickBtn || pickBtn.dataset.cartBound === "1") return;
    pickBtn.dataset.cartBound = "1";

    pickBtn.addEventListener("click", () => {
      if (getDetailWrap()?.dataset.priceState !== "ready") return;

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
      renderMobileCartBar();
    });

    syncPickBtn(pickBtn);
    syncLivePrice(pickBtn);
    renderMobileCartBar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDetailCart);
  } else {
    initDetailCart();
  }
})();
