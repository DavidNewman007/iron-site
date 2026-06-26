/**
 * Фильтры-характеристики по категориям магазина.
 * Каждая категория описывает свои facet-поля (серия, память, цвет, SIM и т.д.).
 */
(function () {
  const IPHONE_SERIES_ORDER = [
    "17 Pro Max",
    "17 Pro",
    "17",
    "17e",
    "Air",
    "16 Plus",
    "16",
    "16e",
    "15 Plus",
    "15",
    "14 Plus",
    "14",
  ];

  const IPHONE_SERIES_LABEL = {
    Air: "iPhone Air",
    "17e": "iPhone 17e",
    "16e": "iPhone 16e",
  };

  function seriesSortKey(series) {
    const idx = IPHONE_SERIES_ORDER.indexOf(series);
    return idx >= 0 ? idx : 999;
  }

  function seriesLabel(series) {
    if (!series) return "";
    if (IPHONE_SERIES_LABEL[series]) return IPHONE_SERIES_LABEL[series];
    if (/^\d/.test(series)) return `iPhone ${series}`;
    return `iPhone ${series}`;
  }

  function parseIphoneTraits(name, section) {
    const productName = String(name || "").trim();
    const productSection = String(section || "");

    let series = "";
    const seriesMatch = productName.match(/^iPhone\s+(Air|\d+\s*e|\d+\s*Pro\s*Max|\d+\s*Pro|\d+\s*Plus|\d+)/i);
    if (seriesMatch) {
      series = seriesMatch[1].replace(/\s+/g, " ").trim();
    }

    const tbMatch = productName.match(/(\d+)\s*Tb/i);
    const gbMatch = productName.match(/(\d+)\s*Gb/i);
    let storage = "";
    if (tbMatch) storage = `${tbMatch[1]}tb`;
    else if (gbMatch) storage = gbMatch[1];

    let sim = "";
    if (/\(SIM\s*\+\s*eSIM\)/i.test(productName) || /sim\s*\+\s*esim/i.test(productSection)) {
      sim = "sim+esim";
    } else if (/\(eSIM\)/i.test(productName) || /\besim\b/i.test(productSection)) {
      sim = "esim";
    }

    let color = "";
    const colorMatch = productName.match(/\d+\s*Gb\s+(.+?)(?:\s*\(|$)/i);
    if (colorMatch) {
      color = colorMatch[1].replace(/\s+[A-Z]{1,2}\/[A-Z]\/?A?\s*$/i, "").trim();
    }

    return { series, storage, color, sim };
  }

  function getIphoneTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseIphoneTraits(product.name, product.section);
    }
    return product._shopTraits;
  }

  function traitMatchesFilter(traits, facetId, value) {
    if (!value) return true;
    return String(traits[facetId] || "") === value;
  }

  function collectFacetOptions(products, facetId, activeFilters, getTraits) {
    const values = new Set();
    for (const product of products) {
      const traits = getTraits(product);
      let ok = true;
      for (const [key, val] of Object.entries(activeFilters)) {
        if (key === facetId || !val) continue;
        if (!traitMatchesFilter(traits, key, val)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const value = traits[facetId];
      if (value) values.add(value);
    }
    return [...values];
  }

  function sortFacetValues(facetId, values) {
    if (facetId === "series") {
      return [...values].sort((a, b) => seriesSortKey(a) - seriesSortKey(b) || a.localeCompare(b, "ru"));
    }
    if (facetId === "storage") {
      return [...values].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }
    if (facetId === "sim") {
      const order = { esim: 1, "sim+esim": 2 };
      return [...values].sort((a, b) => (order[a] || 99) - (order[b] || 99));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatFacetValue(facetId, value) {
    if (facetId === "series") return seriesLabel(value);
    if (facetId === "storage") return `${value} ГБ`;
    if (facetId === "sim") {
      if (value === "sim+esim") return "SIM + eSIM";
      if (value === "esim") return "eSIM";
    }
    return value;
  }

  window.IRON_SHOP_FILTERS = {
    iphone: {
      label: "iPhone",
      facets: [
        { id: "series", label: "Серия" },
        { id: "storage", label: "Память" },
        { id: "color", label: "Цвет" },
        { id: "sim", label: "SIM" },
      ],
      getTraits: getIphoneTraits,
      matches(product, filters) {
        const traits = getIphoneTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortFacetValues(facetId, collectFacetOptions(products, facetId, activeFilters, getIphoneTraits));
      },
      formatValue: formatFacetValue,
    },
  };
})();
