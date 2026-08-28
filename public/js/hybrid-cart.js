(function () {

  // Подписи корзины на детальной карточке. Английские страницы лежат в
  // /en/hybrid-products/ и подключают тот же скрипт — язык определяется по
  // <html lang>, как везде на сайте (18.08.2026).
  const T = (key, ru) => (window.IRON_I18N ? window.IRON_I18N.t(key, ru) : ru);
  const CART_KEY = "iron_cart";
  const PID_PARAM = "pid";
  // Prices-3 добавлен 28.08.2026: 27.08 для склада «под заказ» начали собирать
  // карточки, а этот скрипт по-прежнему читал только два листа — открытая
  // напрямую страница S3-товара показывала «Цена: временно недоступна» и
  // неактивную кнопку «Выбрать». Список обязан совпадать с prices.js.
  const SHEET_TABS = ["Prices", "Prices-2", "Prices-3"];
  // Ключ обязан совпадать с prices.js — там же он и записывается (v2 с
  // 16.08.2026, после добавления полей preorder/eta).
  const CATALOG_CACHE_KEY = "iron_catalog_products_v2";
  const PRICE_CACHE_KEY = "iron_prices_sheet_Prices_Prices-2_Prices-3_v5";
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
    // Разделитель разрядов по языку страницы: «58 600 ₽» против «58,600 ₽».
    const локаль = window.IRON_I18N && window.IRON_I18N.isEn ? "en-US" : "ru-RU";
    return price.toLocaleString(локаль) + " ₽";
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

  // Страницы карточек товара генерируются пачкой (~1200 файлов) — проще
  // подключить мини-апп детект отсюда (уже грузится на каждой карточке), чем
  // редактировать <head> у всех файлов. Определяет мини-апп + прячет
  // шапку/подвал/MAX/оплату + показывает кнопку «назад» (см. telegram-miniapp.js).
  (function ensureTelegramMiniApp() {
    if (window.IRON_TG_MINIAPP_LOADED) return;
    window.IRON_TG_MINIAPP_LOADED = true;
    const s = document.createElement("script");
    s.src = getScriptBase() + "telegram-miniapp.js";
    document.head.appendChild(s);
  })();

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

  function extractModelCode(name) {
    const appleSku = String(name || "").match(/\b(M[A-Z]{2,3}\d{1,4})\b/i);
    if (appleSku) return appleSku[1].toUpperCase();
    return "";
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

    const exactMatches = catalog.filter(
      (item) =>
        normalizeText(item.name) === nName &&
        normalizeText(item.country) === nCountry &&
        normalizeText(item.warehouse) === nWarehouse
    );
    if (exactMatches.length === 1) return exactMatches[0];
    if (exactMatches.length > 1) {
      exactMatches.sort((a, b) => (b.price || 0) - (a.price || 0));
      return exactMatches[0];
    }

    // Страна у позиции меняется чаще, чем название: поставщик привозит ту же
    // модель из другой страны, и карточка, собранная вчера, переставала
    // находить свою цену — страница показывала «Цена: временно недоступна» и
    // мёртвую кнопку «Выбрать». Ищем ещё раз без страны (28.08.2026).
    // Из нескольких берём дорогую: занизить цену хуже, чем завысить.
    const byNameWarehouse = catalog.filter(
      (item) =>
        normalizeText(item.name) === nName &&
        (!nWarehouse || normalizeText(item.warehouse) === nWarehouse)
    );
    if (byNameWarehouse.length) {
      byNameWarehouse.sort((a, b) => (b.price || 0) - (a.price || 0));
      return byNameWarehouse[0];
    }

    const modelCode = extractModelCode(name);
    if (modelCode) {
      const byModel = catalog.filter((item) => {
        if (normalizeText(item.name) !== nName) return false;
        if (nWarehouse && normalizeText(item.warehouse) !== nWarehouse) return false;
        return extractModelCode(item.name) === modelCode;
      });
      if (byModel.length === 1) return byModel[0];
      if (byModel.length > 1) {
        byModel.sort((a, b) => (b.price || 0) - (a.price || 0));
        return byModel[0];
      }
    }

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
    // Подпись собирается заново, а не берётся из product.priceLabel: кэш
    // каталога в localStorage общий для обеих версий сайта, и русская страница
    // показывала «58,600 ₽» после захода на английскую (найдено 18.08.2026).
    // Формат цены — производная от числа и языка, кэшировать её нечего.
    const label = formatPrice(parsePrice(product.price) || parsePrice(product.priceLabel));

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

  function ensureOrderChannels() {
    if (window.IRON_ORDER) return Promise.resolve(window.IRON_ORDER);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = getScriptBase() + "order-channels.js?v=2026-07-04-5";
      s.onload = () => resolve(window.IRON_ORDER);
      s.onerror = () => reject(new Error("Не удалось загрузить order-channels.js"));
      document.head.appendChild(s);
    });
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
    ensureOrderChannels()
      .then((order) => {
        order.openTelegramOrder(cart);
      })
      .catch((err) => console.warn("[hybrid-cart]", err));
  }

  function openMaxOrder() {
    const cart = readCart();
    if (!cart.length) return;
    ensureOrderChannels()
      .then((order) => {
        order.openMaxOrder(cart);
      })
      .catch((err) => console.warn("[hybrid-cart]", err));
  }

  function openYandexPay() {
    const cart = readCart();
    if (!cart.length) {
      window.location.href = "../../magazin.html";
      return;
    }
    ensureConfig()
      .then((cfg) => {
        const base = String(cfg?.yandexPayApiUrl || "").trim();
        if (!base) return;
        // Отправляем только id товаров — цену функция берёт из прайса (защита от подмены).
        const ids = cart.map((p) => p.id).filter(Boolean).join(",");
        window.location.href =
          base + (base.indexOf("?") >= 0 ? "&" : "?") + "ids=" + encodeURIComponent(ids);
      })
      .catch((err) => console.warn("[hybrid-cart]", err));
  }

  function revealYandexPayButton() {
    ensureConfig()
      .then((cfg) => {
        if (!String(cfg?.yandexPayApiUrl || "").trim()) return;
        document.querySelectorAll("#hybrid-cart-pay").forEach((el) => {
          el.hidden = false;
        });
      })
      .catch(() => {});
  }

  function ensureMobileCartBar() {
    if (document.querySelector(".hybrid-detail-cart-bar")) return;
    const bar = document.createElement("div");
    bar.className = "cart-mobile-bar hybrid-detail-cart-bar";
    bar.innerHTML =
      '<span class="cart-mobile-bar__info">' +
      `<strong id="hybrid-cart-count-mobile">0</strong> <span id="hybrid-cart-units">${T("hybrid.items", "шт.")}</span> · <strong id="hybrid-cart-total-mobile">—</strong>` +
      "</span>" +
      '<div class="cart-mobile-bar__actions">' +
      `<button type="button" class="btn btn-primary" id="hybrid-cart-pay" hidden>${T("cart.pay", "Оплатить онлайн")}</button>` +
      '<button type="button" class="btn btn-primary" id="hybrid-cart-telegram">Telegram</button>' +
      '<button type="button" class="btn btn-primary" id="hybrid-cart-max">MAX</button>' +
      "</div>";
    document.body.appendChild(bar);
    bar.querySelector("#hybrid-cart-pay")?.addEventListener("click", openYandexPay);
    bar.querySelector("#hybrid-cart-telegram")?.addEventListener("click", openTelegramOrder);
    bar.querySelector("#hybrid-cart-max")?.addEventListener("click", openMaxOrder);
    revealYandexPayButton();
  }

  function renderMobileCartBar() {
    ensureMobileCartBar();
    const cart = readCart();
    const count = cart.length;
    const total = cart.reduce((s, p) => s + (p.price || 0), 0);
    const countEl = document.getElementById("hybrid-cart-count-mobile");
    const totalEl = document.getElementById("hybrid-cart-total-mobile");
    if (countEl) countEl.textContent = String(count);
    // «1 items» читается как недоделка — на английском единственное число.
    const unitsEl = document.getElementById("hybrid-cart-units");
    if (unitsEl) {
      unitsEl.textContent = count === 1
        ? T("hybrid.item_one", "шт.")
        : T("hybrid.items", "шт.");
    }
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
      pickBtn.textContent = T("shop.select", "+ Выбрать");
      pickBtn.classList.remove("is-active");
      return;
    }

    const productId = resolveProductId(pickBtn);
    const inCart = getCartIndex(readCart(), productId) >= 0;
    pickBtn.textContent = inCart ? T("shop.selected", "✓ В корзине") : T("shop.select", "+ Выбрать");
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

  async function syncLivePrice(pickBtn) {
    setPriceState("pending");

    const syncCatalog = getCatalogSync();
    if (tryApplyCatalogPrice(pickBtn, syncCatalog)) {
      /* показали цену из того же кэша, что и листинг */
    }

    try {
      const catalog = await loadCatalog();
      if (!catalog.length) {
        if (getDetailWrap()?.dataset.priceState !== "ready") markPriceError();
        return;
      }

      const productId = resolveProductId(pickBtn);
      const product = findCatalogProduct(catalog, pickBtn, productId);
      if (!product) {
        if (getDetailWrap()?.dataset.priceState !== "ready") markPriceError();
        return;
      }

      applyLivePrice(pickBtn, product);
      syncPickBtn(pickBtn);
    } catch (err) {
      console.warn("[hybrid-cart] price sync failed:", err);
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

  // Словарь грузится здесь: на детальной карточке нет prices.js, который делает
  // это в магазине. На русской версии load() не делает ни одного запроса.
  function запуск() {
    const словарь = window.IRON_I18N
      ? window.IRON_I18N.load("/data/i18n/shop.en.json")
      : Promise.resolve(null);
    словарь.then(initDetailCart, initDetailCart);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", запуск);
  } else {
    запуск();
  }
})();
