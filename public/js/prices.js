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
        /macbook|airpods|pencil|аксессуар|accessor|apple tv|playstation|dyson|sony|airwrap|supersonic|airstrait/i.test(
          t
        ),
    },
    { id: "watch", label: "Apple Watch", icon: "⌚", test: (t) => /watch/i.test(t) },
    { id: "samsung", label: "Samsung · Meta", icon: "◈", test: (t) => /samsung|meta/i.test(t) },
    { id: "other", label: "Прочее", icon: "◆", test: () => true },
  ];

  const SEARCH_ALIASES = [
    ["iphone", "айфон"],
    ["ipad", "айпад"],
    ["macbook", "макбук"],
    ["airpods", "аирподс"],
    ["airpod", "аирпод"],
    ["watch", "вотч"],
    ["ultra", "ультра"],
    ["pro", "про"],
    ["max", "макс"],
    ["mini", "мини"],
    ["plus", "плюс"],
    ["samsung", "самсунг"],
    ["galaxy", "галакси"],
    ["playstation", "плейстейшн"],
    ["dyson", "дайсон"],
    ["pencil", "пенсил"],
  ];

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
    cartClear: document.getElementById("cart-clear"),
    cartTelegram: document.getElementById("cart-telegram"),
  };

  if (!els.root) return;

  let allProducts = [];
  let cart = loadCart();

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

    try {
      const { products, updatedAt } = await fetchProducts();
      allProducts = products;
      if (!allProducts.length) {
        showError("Прайс пуст или не удалось разобрать данные. Проверьте публичный лист Prices.");
        return;
      }
      els.loading.hidden = true;
      if (els.updated) {
        const when = updatedAt || formatNow();
        els.updated.textContent = `Обновлено: ${when} · ${allProducts.length} позиций`;
      }
      renderGrid();
    } catch (e) {
      console.error(e);
      const hint =
        location.protocol === "file:"
          ? " При открытии файла с диска (file://) используйте локальный сервер: npm start в папке iron-service-site."
          : "";
      showError(
        "Не удалось загрузить прайс. Проверьте доступ к таблице и ID в config.js." + hint
      );
    }
  }

  function bindEvents() {
    els.search?.addEventListener("input", renderGrid);
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
  }

  async function fetchProducts() {
    const range = "A2:D800";
    const sheetUrl =
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
      `?tqx=out:json&sheet=${encodeURIComponent(SHEET_TAB)}&range=${range}`;

    const json = await loadSheetJson(sheetUrl);
    const rows = json.table?.rows || [];

    const products = [];
    let updatedAt = "";
    let currentCategory = "other";
    let currentSection = "";

    for (const row of rows) {
      const cells = (row.c || []).map((c) => (c && c.v != null ? String(c.v).trim() : ""));
      const [name, country, qty, priceRaw] = cells;
      if (!name) continue;

      const updatedMatch = name.match(/^обновлено:\s*(.+)$/i);
      if (updatedMatch) {
        updatedAt = updatedMatch[1].trim();
        continue;
      }

      if (isCategoryRow(name, country, qty, priceRaw)) {
        currentSection = name;
        const cat = detectCategory(name);
        if (cat) currentCategory = cat;
        continue;
      }

      if (!qty || priceRaw === "") continue;

      const price = parsePrice(priceRaw);
      if (!price) continue;

      const id = slugify(name + country + price);
      products.push({
        id,
        name,
        country: country || "",
        qty,
        price,
        priceLabel: formatPrice(price),
        category: currentCategory,
        section: currentSection,
        searchText: buildSearchText(name, country, currentSection),
        inStock: !/0\s*шт/i.test(qty),
      });
    }

    return { products, updatedAt };
  }

  /** fetch на http(s); JSONP через <script> при file:// (иначе CORS блокирует Google Sheets). */
  async function loadSheetJson(sheetUrl) {
    const apiBase = (cfg.apiUrl || "").replace(/\/$/, "");
    if (apiBase) {
      const res = await fetch(`${apiBase}/api/prices`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    if (location.protocol !== "file:") {
      try {
        const res = await fetch(sheetUrl);
        if (res.ok) {
          const text = await res.text();
          return JSON.parse(text.replace(/^.*setResponse\(/, "").replace(/\);?\s*$/, ""));
        }
      } catch {
        /* fallback to JSONP below */
      }
    }

    return loadSheetJsonp(sheetUrl);
  }

  function loadSheetJsonp(sheetUrl) {
    return new Promise((resolve, reject) => {
      const handler = "__ironSheet_" + Date.now();
      const timer = setTimeout(() => cleanup(new Error("Таймаут загрузки таблицы")), 20000);

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

  function isCategoryRow(name, country, qty, price) {
    return name && !country && !qty && !price;
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

  function expandSearchAliases(s) {
    const variants = new Set([s]);
    for (const [en, ru] of SEARCH_ALIASES) {
      if (s.includes(en)) variants.add(s.replaceAll(en, ru));
      if (s.includes(ru)) variants.add(s.replaceAll(ru, en));
    }
    return [...variants];
  }

  function buildSearchText(name, country, section) {
    const base = normalizeSearch([name, country, section].filter(Boolean).join(" "));
    const parts = new Set([base, translitRuToLat(base)]);
    for (const variant of expandSearchAliases(base)) {
      parts.add(variant);
      parts.add(translitRuToLat(variant));
    }
    return [...parts].join(" ");
  }

  function matchesSearch(product, query) {
    const q = normalizeSearch(query);
    if (!q) return true;

    const queryVariants = new Set([q, translitRuToLat(q)]);
    for (const variant of expandSearchAliases(q)) {
      queryVariants.add(variant);
      queryVariants.add(translitRuToLat(variant));
    }

    const hay = product.searchText || buildSearchText(product.name, product.country, product.section);
    return [...queryVariants].some((qv) => qv && hay.includes(qv));
  }

  function getFiltered() {
    const q = (els.search?.value || "").trim();
    const cat = els.category?.value || "all";
    return allProducts.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      return matchesSearch(p, q);
    });
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
        <p class="price-card__qty">${escapeHtml(p.qty)}</p>
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
    if (idx >= 0) cart.splice(idx, 1);
    else cart.push(product);
    saveCart();
    renderCart();
    renderGrid();
    els.cartPanel?.classList.add("is-open");
  }

  function renderCart() {
    const count = cart.length;
    const total = cart.reduce((s, p) => s + p.price, 0);

    if (els.cartCount) els.cartCount.textContent = String(count);
    if (els.cartTotal) els.cartTotal.textContent = count ? formatPrice(total) : "—";
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
