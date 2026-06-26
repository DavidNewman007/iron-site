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
    const digits = String(value || "").replace(/[^\d]/g, "");
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

  function getScriptBase() {
    const script = document.currentScript;
    if (script?.src) return script.src.replace(/[^/]+$/, "");
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

  function readPriceSheetCache() {
    try {
      const raw = sessionStorage.getItem(PRICE_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.json) return null;
      if (Date.now() - parsed.ts > PRICE_CACHE_TTL_MS) return null;
      return parsed.json;
    } catch {
      return null;
    }
  }

  async function fetchSheetJson(sheetUrl) {
    const res = await fetch(sheetUrl, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return parseGvizResponse(await res.text());
  }

  async function fetchCatalogFromSheet(cfg) {
    const sheetId = cfg.googleSheetId;
    if (!sheetId) return [];

    const apiBase = String(cfg.apiUrl || "").replace(/\/$/, "");
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
    const cached = readCatalogCache();
    if (cached) return cached;

    const cfg = await ensureConfig();
    try {
      return await fetchCatalogFromSheet(cfg);
    } catch (err) {
      const sheetJson = readPriceSheetCache();
      if (sheetJson) return parseCatalogFromGviz(sheetJson);
      throw err;
    }
  }

  function findCatalogProduct(catalog, pickBtn, productId) {
    if (productId) {
      const byId = catalog.find((item) => idsLookEqual(item.id, productId));
      if (byId) return byId;
    }

    const name = pickBtn?.dataset?.name;
    const country = pickBtn?.dataset?.country;
    const warehouse = pickBtn?.dataset?.warehouse;
    if (!name) return null;

    const nName = normalizeText(name);
    const nCountry = normalizeText(country);
    const nWarehouse = normalizeText(warehouse);

    return catalog.find(
      (item) =>
        normalizeText(item.name) === nName &&
        normalizeText(item.country) === nCountry &&
        normalizeText(item.warehouse) === nWarehouse
    );
  }

  function applyLivePrice(pickBtn, product) {
    const label = product.priceLabel || formatPrice(product.price);
    document.querySelectorAll(".price-card__price").forEach((el) => {
      el.textContent = label;
    });
    document.querySelectorAll(".meta p").forEach((p) => {
      if (/Цена:/i.test(p.textContent)) {
        p.innerHTML = `<b>Цена:</b> ${label}`;
      }
    });
    pickBtn.dataset.price = label;
    pickBtn.dataset.id = product.id;
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

  async function syncLivePrice(pickBtn) {
    try {
      const catalog = await loadCatalog();
      if (!catalog.length) return;

      const productId = resolveProductId(pickBtn);
      const product = findCatalogProduct(catalog, pickBtn, productId);
      if (!product) return;

      applyLivePrice(pickBtn, product);
      syncPickBtn(pickBtn);
    } catch (err) {
      console.warn("[hybrid-cart] price sync failed:", err);
    }
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
    syncLivePrice(pickBtn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDetailCart);
  } else {
    initDetailCart();
  }
})();
