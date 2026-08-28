/**
 * Фильтры-характеристики по категориям магазина.
 * Каждая категория описывает свои facet-поля (серия, память, SIM, цвет и т.д.).
 */
(function () {
  // Подписи фильтров берутся из общего модуля локализации. Фолбэк на русский
  // текст в коде — чтобы отсутствие i18n.js роняло перевод, а не фильтры.
  const T = (key, ru) => (window.IRON_I18N ? window.IRON_I18N.t(key, ru) : ru);

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
    "14"];

  const IPHONE_SERIES_LABEL = {
    Air: "iPhone Air",
    "17e": "iPhone 17e",
    "16e": "iPhone 16e",
  };

  const IPHONE_AIR_COLOR_ALIASES = {
    black: "space black",
    blue: "sky blue",
    white: "cloud white",
    gold: "light gold",
    "space black": "space black",
    "sky blue": "sky blue",
    "cloud white": "cloud white",
    "light gold": "light gold",
  };

  function normalizeAirColor(series, color) {
    if (series !== "Air" || !color) return color;
    const key = String(color).toLowerCase().replace(/\s+/g, " ").trim();
    return IPHONE_AIR_COLOR_ALIASES[key] || key;
  }

  function formatColorLabel(value) {
    return String(value || "")
      .split(" ")
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

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

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseIphoneTraits(name, section) {
    const productName = String(name || "").trim();
    const productSection = String(section || "");

    let series = "";
    const seriesMatch = productName.match(/^iPhone\s+(Air|\d+\s*e|\d+\s*Pro\s*Max|\d+\s*Pro|\d+\s*Plus|\d+)/i);
    if (seriesMatch) {
      series = seriesMatch[1].replace(/\s+/g, " ").trim();
    }

    let storage = "";
    const capMatch = productName.match(
      /^iPhone\s+(?:Air|\d+\s*e|\d+\s*Pro\s*Max|\d+\s*Pro|\d+\s*Plus|\d+)\s+(\d+)\s*(Tb|TB|Gb|GB|G)?/i
    );
    if (capMatch) {
      const num = capMatch[1];
      const unit = String(capMatch[2] || "").toLowerCase();
      if (unit.startsWith("t")) storage = `${num}tb`;
      else storage = num;
    }

    let sim = "";
    // «2 SIM» — две ФИЗИЧЕСКИЕ карты без eSIM (Гонконг/Китай до 17-й серии).
    // Проверяется первым: в остальных ветках есть подстрока «sim», и без этого
    // порядка «(2 SIM)» опозналось бы как обычная SIM + eSIM.
    if (/\(2\s*SIM\)/i.test(productName)) {
      sim = "2sim";
    } else if (/\(SIM\s*\+\s*eSIM\)/i.test(productName) || /sim\s*\+\s*esim/i.test(productSection)) {
      sim = "sim+esim";
    } else if (/\(eSIM\)/i.test(productName) || /\besim\b/i.test(productSection)) {
      sim = "esim";
    }

    let color = "";
    if (series && storage) {
      const seriesRe = new RegExp(`^${escapeRegExp(series).replace(/\s+/g, "\\s+")}\\s+`, "i");
      const tail = productName
        .replace(/^iPhone\s+/i,"")
        .replace(seriesRe,"")
        .replace(/^(\d+)\s*(?:Tb|TB|Gb|GB|G)?\s+/i,"")
        .replace(/\s*\([^)]*\)\s*$/g,"")
        .trim();
      color = tail.replace(/\s+[A-Z]{1,2}\/[A-Z]\/?A?\s*$/i,"").trim();
      if (color.includes("(")) color = color.split("(")[0].trim();
    }

    color = normalizeAirColor(series, color);

    return { series, storage, color, sim };
  }

  function getIphoneTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseIphoneTraits(product.name, product.section);
    }
    return product._shopTraits;
  }

  function isIphoneFilterable(product) {
    const traits = getIphoneTraits(product);
    return Boolean(traits.series && traits.storage);
  }

  function traitMatchesFilter(traits, facetId, value) {
    if (!value) return true;
    return String(traits[facetId] || "") === value;
  }

  function collectFacetOptions(products, facetId, activeFilters, getTraits, isFilterable) {
    const values = new Set();
    for (const product of products) {
      if (isFilterable && !isFilterable(product)) continue;
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
      return [...values].sort((a, b) => storageSortKey(a) - storageSortKey(b));
    }
    if (facetId === "sim") {
      const order = { esim: 1, "sim+esim": 2 };
      return [...values].sort((a, b) => (order[a] || 99) - (order[b] || 99));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function storageSortKey(value) {
    const tb = String(value || "").match(/^(\d+)tb$/i);
    if (tb) return parseInt(tb[1], 10) * 1024;
    const num = parseInt(value, 10);
    return Number.isFinite(num) ? num : 99999;
  }

  function formatFacetValue(facetId, value) {
    if (facetId === "series") return seriesLabel(value);
    if (facetId === "storage") {
      const tb = String(value || "").match(/^(\d+)tb$/i);
      if (tb) return `${tb[1]} ${T("filters.tb", "ТБ")}`;
      return `${value} ${T("filters.gb", "ГБ")}`;
    }
    if (facetId === "sim") {
      if (value === "sim+esim") return "SIM + eSIM";
      if (value === "esim") return "eSIM";
      if (value === "2sim") return "2 SIM";
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }

  function createLinearWizardHelpers(facets, getTraits, isFilterable, prompts, formatValue) {
    function facetHasOptions(products, facetId, activeFilters) {
      return (
        collectFacetOptions(products, facetId, { ...activeFilters, [facetId]: "" }, getTraits, isFilterable).length > 0
      );
    }

    function getMobileWizardStep(products, activeFilters) {
      for (let facetIndex = 0; facetIndex < facets.length; facetIndex += 1) {
        const facet = facets[facetIndex];
        for (let prevIndex = 0; prevIndex < facetIndex; prevIndex += 1) {
          if (!activeFilters[facets[prevIndex].id]) return facets[prevIndex].id;
        }
        const options = collectFacetOptions(
          products,
          facet.id,
          { ...activeFilters, [facet.id]: "" },
          getTraits,
          isFilterable
        );
        if (!options.length) continue;
        if (!activeFilters[facet.id]) return facet.id;
      }
      return "done";
    }

    function getMobileWizardProgress(products, activeFilters, stepId) {
      const steps = [];
      for (const facet of facets) {
        let canReach = true;
        for (let prevIndex = 0; prevIndex < facets.indexOf(facet); prevIndex += 1) {
          if (!activeFilters[facets[prevIndex].id]) {
            canReach = false;
            break;
          }
        }
        if (!canReach) break;
        if (facetHasOptions(products, facet.id, activeFilters)) steps.push(facet.id);
      }
      const currentIndex = Math.max(0, steps.indexOf(stepId));
      const facet = facets.find((item) => item.id === stepId);
      return {
        current: currentIndex + 1,
        total: steps.length,
        label: facet?.label || "",
      };
    }

    function clearMobileWizardFromStep(activeFilters, stepId) {
      const idx = facets.findIndex((facet) => facet.id === stepId);
      if (idx < 0) return;
      for (let i = idx; i < facets.length; i += 1) {
        activeFilters[facets[i].id] = "";
      }
    }

    function goBackMobileWizardStep(activeFilters, currentStepId) {
      const idx = facets.findIndex((facet) => facet.id === currentStepId);
      if (idx <= 0) return;
      clearMobileWizardFromStep(activeFilters, facets[idx - 1].id);
    }

    return {
      getMobileWizardStep,
      getMobileWizardProgress,
      clearMobileWizardFromStep,
      goBackMobileWizardStep,
      getMobileWizardPrompt(stepId) {
        return prompts[stepId] || "";
      },
      getSelectionSummary(activeFilters) {
        return facets
          .filter((facet) => activeFilters[facet.id])
          .map((facet) => formatValue(facet.id, activeFilters[facet.id]));
      },
    };
  }

  function facetHasOptions(products, facetId, activeFilters) {
    return (
      collectFacetOptions(products, facetId, { ...activeFilters, [facetId]: "" }, getIphoneTraits, isIphoneFilterable)
        .length > 0
    );
  }

  function getMobileWizardStep(products, activeFilters) {
    for (const facet of iphoneFacets) {
      if (facet.id !== "series" && !activeFilters.series) return "series";
      if ((facet.id === "sim" || facet.id === "color") && !activeFilters.storage) return "storage";

      if (facet.id === "color") {
        const simOptions = collectFacetOptions(
          products,
          "sim",
          { ...activeFilters, sim: "", color: "" },
          getIphoneTraits,
          isIphoneFilterable
        );
        if (simOptions.length && !activeFilters.sim) return "sim";
      }

      const options = collectFacetOptions(
        products,
        facet.id,
        { ...activeFilters, [facet.id]: "" },
        getIphoneTraits,
        isIphoneFilterable
      );
      if (!options.length) continue;
      if (!activeFilters[facet.id]) return facet.id;
    }
    return "done";
  }

  function getMobileWizardProgress(products, activeFilters, stepId) {
    const steps = [];
    for (const facet of iphoneFacets) {
      if (facet.id !== "series" && !activeFilters.series) break;
      if ((facet.id === "sim" || facet.id === "color") && !activeFilters.storage) break;
      if (facet.id === "color") {
        const simOptions = collectFacetOptions(
          products,
          "sim",
          { ...activeFilters, sim: "", color: "" },
          getIphoneTraits,
          isIphoneFilterable
        );
        if (simOptions.length) steps.push("sim");
      }
      if (facetHasOptions(products, facet.id, activeFilters)) steps.push(facet.id);
    }
    const uniqueSteps = [...new Set(steps)];
    const currentIndex = Math.max(0, uniqueSteps.indexOf(stepId));
    const facet = iphoneFacets.find((item) => item.id === stepId);
    return {
      current: currentIndex + 1,
      total: uniqueSteps.length,
      label: facet?.label || "",
    };
  }

  function clearMobileWizardFromStep(activeFilters, stepId) {
    const idx = iphoneFacets.findIndex((facet) => facet.id === stepId);
    if (idx < 0) return;
    for (let i = idx; i < iphoneFacets.length; i += 1) {
      activeFilters[iphoneFacets[i].id] = "";
    }
  }

  function goBackMobileWizardStep(activeFilters, currentStepId) {
    const idx = iphoneFacets.findIndex((facet) => facet.id === currentStepId);
    if (idx <= 0) return;
    clearMobileWizardFromStep(activeFilters, iphoneFacets[idx - 1].id);
  }

  const IPHONE_WIZARD_PROMPTS = {
    series: "Выберите серию",
    storage: "Выберите объём памяти",
    sim: "Выберите тип SIM",
    color: "Выберите цвет",
  };

  const iphoneFacets = [
    { id: "series", label: "Серия" },
    { id: "storage", label: "Память" },
    { id: "sim", label: "SIM" },
    { id: "color", label: "Цвет" }];

  const MACBOOK_LINE_ORDER = ["Neo 13", "Air 13 M4", "Air 13 M5", "Air 15 M5", "Pro 14 M4", "Pro 14 M3", "Pro 16 M4"];

  const MACBOOK_COLOR_ALIASES = {
    blue: "sky blue",
    "light blue": "sky blue",
  };

  function normalizeMacbookColor(line, color) {
    const key = String(color || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return "";
    if (MACBOOK_COLOR_ALIASES[key]) return MACBOOK_COLOR_ALIASES[key];
    if (key === "blue" && /\bair\b/i.test(line) && /\bm5\b/i.test(line)) return "sky blue";
    return key;
  }

  function parseMacbookTraits(name) {
    const productName = String(name || "").trim();

    let line = "";
    if (/^MacBook\s+Neo\s+13\b/i.test(productName)) {
      line = "Neo 13";
    } else {
      const airMatch = productName.match(/^MacBook\s+Air\s+(13|15)\s+(M\d+)\b/i);
      if (airMatch) line = `Air ${airMatch[1]} ${airMatch[2]}`;
      const proMatch = productName.match(/^MacBook\s+Pro\s+(\d+)\s+(M\d+)\b/i);
      if (proMatch) line = `Pro ${proMatch[1]} ${proMatch[2]}`;
    }

    let storage = "";
    const plusMatch = productName.match(/\b\d+\+\s*(\d+)\s*(Tb|TB|Gb|GB)\b/i);
    if (plusMatch) {
      const num = plusMatch[1];
      const unit = String(plusMatch[2] || "").toLowerCase();
      storage = unit.startsWith("t") ? `${num}tb` : num;
    } else {
      const capMatch = productName.match(/\b(\d+)\s*(Tb|TB|Gb|GB)\b/i);
      if (capMatch) {
        const num = capMatch[1];
        const unit = String(capMatch[2] || "").toLowerCase();
        storage = unit.startsWith("t") ? `${num}tb` : num;
      }
    }

    let color = "";
    if (line && storage) {
      const tail = productName
        .replace(/^MacBook\s+(?:Neo\s+13\s+A18\s+Pro|Air\s+\d+\s+M\d+|Pro\s+\d+\s+M\d+)\s+/i,"")
        .replace(/^\d+\+\s*/i,"")
        .replace(/^(\d+)\s*(?:Tb|TB|Gb|GB)?\s+/i,"")
        .replace(/\s+[A-Z0-9]{4,5}(?:\s+[A-Z]{1,2}\/[A-Z]\/?A?)?\s*$/i,"")
        .trim();
      color = normalizeMacbookColor(line, tail);
    }

    return { line, storage, color };
  }

  function getMacbookTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseMacbookTraits(product.name);
    }
    return product._shopTraits;
  }

  function isMacbookFilterable(product) {
    const traits = getMacbookTraits(product);
    return Boolean(traits.line && traits.storage);
  }

  function macbookLineSortKey(line) {
    const idx = MACBOOK_LINE_ORDER.indexOf(line);
    return idx >= 0 ? idx : 999;
  }

  function macbookLineLabel(line) {
    if (!line) return "";
    return `MacBook ${line}`;
  }

  function sortMacbookFacetValues(facetId, values) {
    if (facetId === "line") {
      return [...values].sort(
        (a, b) => macbookLineSortKey(a) - macbookLineSortKey(b) || a.localeCompare(b, "ru")
      );
    }
    if (facetId === "storage") {
      return [...values].sort((a, b) => storageSortKey(a) - storageSortKey(b));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatMacbookFacetValue(facetId, value) {
    if (facetId === "line") return macbookLineLabel(value);
    if (facetId === "storage") {
      const tb = String(value || "").match(/^(\d+)tb$/i);
      if (tb) return `${tb[1]} ${T("filters.tb", "ТБ")}`;
      return `${value} ${T("filters.gb", "ГБ")}`;
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }

  const macbookFacets = [
    { id: "line", label: "Модель" },
    { id: "storage", label: "Память" },
    { id: "color", label: "Цвет" }];

  const MACBOOK_WIZARD_PROMPTS = {
    line: "Выберите модель MacBook",
    storage: "Выберите объём памяти",
    color: "Выберите цвет",
  };

  const macbookWizard = createLinearWizardHelpers(
    macbookFacets,
    getMacbookTraits,
    isMacbookFilterable,
    MACBOOK_WIZARD_PROMPTS,
    formatMacbookFacetValue
  );

  const IPAD_MODEL_ORDER = ["11 A16", "Air 11 M3", "Air 11 M4", "Pro 11 M5"];

  const IPAD_COLOR_ALIASES = {
    gray: "space gray",
    grey: "space gray",
    black: "space black",
  };

  function normalizeIpadColor(color) {
    const key = String(color || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return "";
    return IPAD_COLOR_ALIASES[key] || key;
  }

  function parseIpadTraits(name) {
    const productName = String(name || "").trim();

    let model = "";
    const proMatch = productName.match(/^iPad\s+Pro\s+11"?\s*(M\d+)?/i);
    if (proMatch) model = `Pro 11${proMatch[1] ? ` ${proMatch[1]}` : ""}`.trim();
    const airMatch = productName.match(/^iPad\s+Air\s+11"?\s*(M\d+)?/i);
    if (airMatch) model = `Air 11${airMatch[1] ? ` ${airMatch[1]}` : ""}`.trim();
    if (/^iPad\s+11"?\s*A16/i.test(productName)) model = "11 A16";

    let storage = "";
    const capMatch = productName.match(/\b(\d+)\s*(Tb|TB|Gb|GB)\b/i);
    if (capMatch) {
      const num = capMatch[1];
      const unit = String(capMatch[2] || "").toLowerCase();
      storage = unit.startsWith("t") ? `${num}tb` : num;
    }

    let color = "";
    if (model && storage) {
      const tail = productName
        .replace(/^iPad\s+(?:Pro\s+11"?\s*M\d+|Air\s+11"?\s*M\d+|11"?\s*A16)\s*/i,"")
        .replace(/\b(?:Wi-Fi|WiFi|Cellular|LTE)\b/gi, " ")
        .replace(new RegExp(`\\b${escapeRegExp(storage)}\\s*(?:Gb|GB|Tb|TB)?\\b`, "i"), " ")
        .replace(/\s+[A-Z]{1,2}\/[A-Z]\/?A?\s*$/i,"")
        .replace(/\s+/g, " ")
        .trim();
      color = normalizeIpadColor(tail);
    }

    return { model, storage, color };
  }

  function getIpadTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseIpadTraits(product.name);
    }
    return product._shopTraits;
  }

  function isIpadFilterable(product) {
    const traits = getIpadTraits(product);
    return Boolean(traits.model && traits.storage);
  }

  function ipadModelSortKey(model) {
    const idx = IPAD_MODEL_ORDER.indexOf(model);
    return idx >= 0 ? idx : 999;
  }

  function ipadModelLabel(model) {
    if (!model) return "";
    if (model === "11 A16") return "iPad 11";
    return `iPad ${model}`;
  }

  function sortIpadFacetValues(facetId, values) {
    if (facetId === "model") {
      return [...values].sort(
        (a, b) => ipadModelSortKey(a) - ipadModelSortKey(b) || a.localeCompare(b, "ru")
      );
    }
    if (facetId === "storage") {
      return [...values].sort((a, b) => storageSortKey(a) - storageSortKey(b));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatIpadFacetValue(facetId, value) {
    if (facetId === "model") return ipadModelLabel(value);
    if (facetId === "storage") {
      const tb = String(value || "").match(/^(\d+)tb$/i);
      if (tb) return `${tb[1]} ${T("filters.tb", "ТБ")}`;
      return `${value} ${T("filters.gb", "ГБ")}`;
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }

  const ipadFacets = [
    { id: "model", label: "Модель" },
    { id: "storage", label: "Память" },
    { id: "color", label: "Цвет" }];

  const IPAD_WIZARD_PROMPTS = {
    model: "Выберите модель iPad",
    storage: "Выберите объём памяти",
    color: "Выберите цвет",
  };

  const ipadWizard = createLinearWizardHelpers(
    ipadFacets,
    getIpadTraits,
    isIpadFilterable,
    IPAD_WIZARD_PROMPTS,
    formatIpadFacetValue
  );

  const AIRPODS_MODEL_ORDER = ["4", "Pro 2", "Pro 3", "Max 2024", "Max 2026", "Max"];

  function normalizeAirpodsColor(color) {
    return String(color || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseAirpodsTraits(name) {
    const productName = String(name || "").trim();

    let model = "";
    if (/airpods\s+max/i.test(productName)) {
      const yearMatch = productName.match(/\bmax\s+(20\d{2})\b/i);
      model = yearMatch ? `Max ${yearMatch[1]}` : "Max";
    } else if (/airpods\s+pro\s*3\b/i.test(productName)) {
      model = "Pro 3";
    } else if (/airpods\s+pro\s*2\b/i.test(productName)) {
      model = "Pro 2";
    } else if (/airpods\s+4\b/i.test(productName)) {
      model = "4";
    }

    let anc = "";
    if (model === "4") {
      anc = /\banc\b|with\s+anc/i.test(productName) ? "anc" : "standard";
    }

    let color = "";
    if (/^max/i.test(model)) {
      const tail = productName
        .replace(/^.*?max\s+(?:20\d{2}\s+)?/i,"")
        .replace(/\s+[A-Z0-9]{4,5}(?:\s+[A-Z]{1,2}\/[A-Z]\/?A?)?\s*$/i,"")
        .trim();
      color = normalizeAirpodsColor(tail);
    }

    return { model, anc, color };
  }

  function getAirpodsTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseAirpodsTraits(product.name);
    }
    return product._shopTraits;
  }

  function isAirpodsFilterable(product) {
    const traits = getAirpodsTraits(product);
    return Boolean(traits.model);
  }

  function airpodsModelSortKey(model) {
    const idx = AIRPODS_MODEL_ORDER.indexOf(model);
    return idx >= 0 ? idx : 999;
  }

  function airpodsModelLabel(model) {
    if (!model) return "";
    if (model === "4") return "AirPods 4";
    if (/^pro/i.test(model)) return `AirPods ${model}`;
    if (/^max/i.test(model)) return `AirPods ${model}`;
    return `AirPods ${model}`;
  }

  function sortAirpodsFacetValues(facetId, values) {
    if (facetId === "model") {
      return [...values].sort(
        (a, b) => airpodsModelSortKey(a) - airpodsModelSortKey(b) || a.localeCompare(b, "ru")
      );
    }
    if (facetId === "anc") {
      const order = { standard: 1, anc: 2 };
      return [...values].sort((a, b) => (order[a] || 99) - (order[b] || 99));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatAirpodsFacetValue(facetId, value) {
    if (facetId === "model") return airpodsModelLabel(value);
    if (facetId === "anc") {
      if (value === "anc") return T("filters.with_anc", "С ANC");
      if (value === "standard") return T("filters.without_anc", "Без ANC");
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }

  const airpodsFacets = [
    { id: "model", label: "Модель" },
    { id: "anc", label: "ANC" },
    { id: "color", label: "Цвет" }];

  const AIRPODS_WIZARD_PROMPTS = {
    model: "Выберите модель AirPods",
    anc: "Выберите версию AirPods 4",
    color: "Выберите цвет",
  };

  const airpodsWizard = createLinearWizardHelpers(
    airpodsFacets,
    getAirpodsTraits,
    isAirpodsFilterable,
    AIRPODS_WIZARD_PROMPTS,
    formatAirpodsFacetValue
  );

  const SAMSUNG_LINE_ORDER = [
    "A37",
    "A56",
    "A57",
    "S25 FE",
    "S25 Ultra",
    "S26",
    "S26 Plus",
    "S26 Ultra"];

  const SAMSUNG_COLOR_ALIASES = {
    graygreen: "gray green",
    lightgray: "light gray",
    icyblue: "icy blue",
    jetblack: "jet black",
    silvershadow: "silver shadow",
    skyblue: "sky blue",
  };

  function normalizeSamsungColor(color) {
    const key = String(color || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key) return "";
    if (SAMSUNG_COLOR_ALIASES[key]) return SAMSUNG_COLOR_ALIASES[key];
    return key;
  }

  function parseSamsungLine(name) {
    const productName = String(name || "").trim();
    const samsungMatch = productName.match(/^Samsung\s+((?:A\d+|S\d+(?:\s+(?:Ultra|Plus|FE))?))\b/i);
    if (samsungMatch) return samsungMatch[1].replace(/\s+/g, " ").trim();
    const shortMatch = productName.match(/^S(\d+(?:\s+(?:Ultra|Plus|FE))?)\b/i);
    if (shortMatch) return `S${shortMatch[1]}`.replace(/\s+/g, " ").trim();
    return "";
  }

  function parseSamsungStorage(name) {
    const productName = String(name || "");
    const slashMatch = productName.match(/\b\d+\/(\d+)\b/);
    if (slashMatch) return slashMatch[1];
    const plusMatch = productName.match(/\b\d+\+\s*(\d+)\s*(?:Gb|GB|Tb|TB)?\b/i);
    if (plusMatch) return plusMatch[1];
    const capMatch = productName.match(/\b(\d+)\s*(?:Gb|GB|Tb|TB)\b/i);
    if (capMatch) return capMatch[1];
    return "";
  }

  function parseSamsungTraits(name) {
    const productName = String(name || "").trim();
    const line = parseSamsungLine(productName);
    const storage = parseSamsungStorage(productName);

    let color = "";
    if (line && storage) {
      let tail = productName
        .replace(/^Samsung\s+/i,"")
        .replace(/^S\d+(?:\s+(?:Ultra|Plus|FE))?\s+/i,"")
        .replace(/^(?:A\d+|S\d+(?:\s+(?:Ultra|Plus|FE))?)\s+/i,"")
        .replace(/\bSM-[A-Z0-9]+\b/gi, " ")
        .replace(/\bB\/DS\b/gi, " ")
        .replace(/\b\d+\/\d+\b/g, " ")
        .replace(/\b\d+\+\s*\d+\s*(?:Gb|GB|Tb|TB)?\b/gi, " ")
        .replace(/\b\d+\s*(?:Gb|GB|Tb|TB)\b/gi, " ")
        .replace(/\b[A-Z]{2,4}\b(?=\s*$)/i, " ")
        .replace(/\s+/g, " ")
        .trim();
      color = normalizeSamsungColor(tail);
    }

    return { line, storage, color };
  }

  function getSamsungTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseSamsungTraits(product.name);
    }
    return product._shopTraits;
  }

  function isSamsungFilterable(product) {
    const traits = getSamsungTraits(product);
    return Boolean(traits.line && traits.storage);
  }

  function samsungLineSortKey(line) {
    const idx = SAMSUNG_LINE_ORDER.indexOf(line);
    return idx >= 0 ? idx : 999;
  }

  function samsungLineLabel(line) {
    if (!line) return "";
    return `Samsung ${line}`;
  }

  function sortSamsungFacetValues(facetId, values) {
    if (facetId === "line") {
      return [...values].sort(
        (a, b) => samsungLineSortKey(a) - samsungLineSortKey(b) || a.localeCompare(b, "ru")
      );
    }
    if (facetId === "storage") {
      return [...values].sort((a, b) => storageSortKey(a) - storageSortKey(b));
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatSamsungFacetValue(facetId, value) {
    if (facetId === "line") return samsungLineLabel(value);
    if (facetId === "storage") {
      const tb = String(value || "").match(/^(\d+)tb$/i);
      if (tb) return `${tb[1]} ${T("filters.tb", "ТБ")}`;
      return `${value} ${T("filters.gb", "ГБ")}`;
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }


  // ─── Apple Watch (28.08.2026) ───────────────────────────────────────────
  //
  // Названия часов приходят в ТРЁХ формах, и парсер обязан понимать все:
  //   S1  «Series 11 42mm S/M Jet Black Black MEQT4 LW/A»
  //   S2  «S11 42mm Silver M/L», «Ultra 3 Black Ocean Black»
  //   S3  «Apple Watch Series 11 42mm Silver with Purple Fog Sport Band S/M»
  //
  // Фасетов четыре, и все — по признакам, которые есть во всех трёх формах.
  // Тип ремешка (Ocean / Alpine / Trail / Milanese) в фасеты НЕ вынесен
  // намеренно: в коротких названиях S2 его часто нет вовсе, и фильтр по нему
  // прятал бы товары, у которых ремешок тот же самый, просто не написан.

  // Порядок важен: составные цвета проверяются раньше односложных, иначе
  // «Jet Black» схлопнется в «black», а «Rose Gold» — в «gold».
  const WATCH_CASE_COLORS = [
    ["jet black", /\bjet\s*black\b/i],
    ["rose gold", /\brose\s*gold\b/i],
    ["space gray", /\bspace\s*gray\b/i],
    ["black", /\bblack\s*titanium\b/i],
    ["natural", /\bnatural\s*titanium\b/i],
    ["midnight", /\bmidnight\b|\bmid\b/i],
    ["starlight", /\bstarlight\b|\bstar\b/i],
    ["silver", /\bsilver\b/i],
    ["natural", /\bnatural\b/i],
    ["black", /\bblack\b/i],
    ["gray", /\bgray\b|\bgrey\b/i]];

  const WATCH_SERIES_ORDER = ["se3", "s11", "ultra2", "ultra3"];

  const WATCH_SERIES_LABEL = {
    se3: "SE 3",
    s11: "Series 11",
    ultra2: "Ultra 2",
    ultra3: "Ultra 3",
  };

  const WATCH_BAND_SIZE_ORDER = ["s/m", "m/l", "s", "m", "l"];

  function parseWatchSeries(name) {
    const productName = String(name || "");
    const ultra = productName.match(/\bultra\s*(\d)\b/i);
    if (ultra) return `ultra${ultra[1]}`;
    const se = productName.match(/\bse\s*(\d)\b/i);
    if (se) return `se${se[1]}`;
    const series = productName.match(/\bseries\s*(\d{1,2})\b/i);
    if (series) return `s${series[1]}`;
    const short = productName.match(/^\s*S(\d{1,2})\b/i);
    if (short) return `s${short[1]}`;
    return "";
  }

  function parseWatchSize(name, series) {
    const size = String(name || "").match(/\b(\d{2})\s*mm\b/i);
    if (size) return size[1];
    // У коротких названий S2 («Ultra 3 Black Ocean Black») размера нет, но
    // корпус у Ultra всегда 49 мм — иначе эти позиции выпадали бы из фильтра.
    if (/^ultra/.test(series || "")) return "49";
    return "";
  }

  function parseWatchCaseColor(name) {
    const productName = String(name || "");
    for (const [value, re] of WATCH_CASE_COLORS) {
      if (re.test(productName)) return value;
    }
    return "";
  }

  function parseWatchBandSize(name) {
    const productName = String(name || "");
    const pair = productName.match(/\b(S\/M|M\/L)\b/i);
    if (pair) return pair[1].toLowerCase();
    const single = productName.match(/(?:^|\s)([SML])(?=\s|$)/);
    if (single) return single[1].toLowerCase();
    return "";
  }

  // Один и тот же корпус в прайсе назван по-разному: длинное название S1 пишет
  // «Jet Black» и «Space Gray», короткое S2 — просто «Black» и «Gray». Без
  // сведения к одному значению цвет двоился бы в фильтре. У Ultra трогать
  // нельзя: там «Black» и «Natural» — это титан, а не алюминий.
  function canonicalWatchColor(color, series) {
    if (!color || /^ultra/.test(series || "")) return color;
    if (color === "black") return "jet black";
    if (color === "gray") return "space gray";
    return color;
  }

  function parseWatchTraits(name) {
    const series = parseWatchSeries(name);
    return {
      series,
      size: parseWatchSize(name, series),
      color: canonicalWatchColor(parseWatchCaseColor(name), series),
      bandSize: parseWatchBandSize(name),
    };
  }

  function getWatchTraits(product) {
    if (!product._shopTraits) {
      product._shopTraits = parseWatchTraits(product.name);
    }
    return product._shopTraits;
  }

  function isWatchFilterable(product) {
    return Boolean(getWatchTraits(product).series);
  }

  function sortWatchFacetValues(facetId, values) {
    if (facetId === "series") {
      return [...values].sort((a, b) => {
        const ia = WATCH_SERIES_ORDER.indexOf(a);
        const ib = WATCH_SERIES_ORDER.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, "ru");
      });
    }
    if (facetId === "size") {
      return [...values].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    }
    if (facetId === "bandSize") {
      return [...values].sort(
        (a, b) => WATCH_BAND_SIZE_ORDER.indexOf(a) - WATCH_BAND_SIZE_ORDER.indexOf(b)
      );
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function formatWatchFacetValue(facetId, value) {
    if (facetId === "series") return WATCH_SERIES_LABEL[value] || value;
    if (facetId === "size") return `${value} ${T("filters.mm", "мм")}`;
    if (facetId === "bandSize") return String(value || "").toUpperCase();
    if (facetId === "color") return formatColorLabel(value);
    return value;
  }

  const watchFacets = [
    { id: "series", label: "Серия" },
    { id: "size", label: "Корпус" },
    { id: "color", label: "Цвет" },
    { id: "bandSize", label: "Ремешок" }];

  const WATCH_WIZARD_PROMPTS = {
    series: "Выберите серию Apple Watch",
    size: "Выберите размер корпуса",
    color: "Выберите цвет",
    bandSize: "Выберите размер ремешка",
  };

  const watchWizard = createLinearWizardHelpers(
    watchFacets,
    getWatchTraits,
    isWatchFilterable,
    WATCH_WIZARD_PROMPTS,
    formatWatchFacetValue
  );


  // ─── Группы без своей схемы названия (28.08.2026) ────────────────────────
  //
  // Аудио, аксессуары, приставки, Dyson и гаджеты — товары разных марок в одной
  // куче, общего формата названия у них нет. Поэтому вместо пяти копий обвязки
  // — один конструктор: семейство описывается разбором названия, порядком
  // значений и подписями, остальное одинаковое.
  //
  // Разбор ОБЯЗАН давать пустую строку там, где признак не читается: фильтр
  // сверяет значения точно, и выдуманный признак спрятал бы товар. Позиции, у
  // которых не распознан ни один признак (в Dyson так лежат «(Диффузор,
  // распак)» и чужая подставка Sony), просто не фильтруются и видны, пока
  // фильтр не выбран.
  function createSimpleFamily({ label, facets, parse, order = {}, labels = {}, prompts = {} }) {
    function getTraits(product) {
      if (!product._shopTraits) product._shopTraits = parse(product.name);
      return product._shopTraits;
    }
    function isFilterable(product) {
      const traits = getTraits(product);
      return facets.some((facet) => traits[facet.id]);
    }
    function formatValue(facetId, value) {
      const map = labels[facetId];
      if (map && map[value]) return map[value];
      return formatColorLabel(value);
    }
    function sortValues(facetId, values) {
      const list = order[facetId];
      if (!list) return [...values].sort((a, b) => a.localeCompare(b, "ru"));
      return [...values].sort((a, b) => {
        const ia = list.indexOf(a);
        const ib = list.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, "ru");
      });
    }
    const wizard = createLinearWizardHelpers(facets, getTraits, isFilterable, prompts, formatValue);
    return {
      label,
      facets,
      getTraits,
      isFilterable,
      matches(product, filters) {
        // Пока ни один фильтр не выбран — показываем ВСЁ, включая позиции, у
        // которых ни один признак не распознался. Иначе товар молча пропадает
        // из магазина от одного лишь появления фильтров: в Dyson так исчезли
        // бы «(Диффузор, распак)» и чужая подставка Sony (28.08.2026). У
        // старых семейств (iPhone, MacBook…) названия однородные и такой
        // ситуации не возникает, поэтому их поведение не трогаем.
        const hasActive = Object.values(filters || {}).some(Boolean);
        if (!hasActive) return true;
        if (!isFilterable(product)) return false;
        const traits = getTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortValues(facetId, collectFacetOptions(products, facetId, activeFilters, getTraits, isFilterable));
      },
      formatValue,
      ...wizard,
    };
  }

  function matchFirst(name, rules) {
    for (const [value, re] of rules) {
      if (re.test(String(name || ""))) return value;
    }
    return "";
  }

  // --- Аудио: наушники и колонки разных марок ---
  const AUDIO_KIND_RULES = [
    ["headphones", /buds|major|наушник|headphone/i],
    ["speaker", /станци|стрит|flip|acton|stanmore|колонк|speaker/i]];
  const AUDIO_BRAND_RULES = [
    ["yandex", /яндекс|yandex/i],
    ["samsung", /samsung|galaxy/i],
    ["marshall", /marshall/i],
    ["jbl", /\bjbl\b/i]];
  const AUDIO_LINE_RULES = [
    ["buds4pro", /buds\s*4\s*pro/i],
    ["buds4", /buds\s*4/i],
    ["buds3pro", /buds\s*3\s*pro/i],
    ["buds3", /buds\s*3/i],
    ["major", /major/i],
    ["acton", /acton/i],
    ["flip", /flip/i],
    ["duomax", /дуо\s*max/i],
    ["mini3pro", /мини\s*3\s*про/i],
    ["mini3", /мини\s*3/i],
    // Кириллица: \w в JS — это только латиница, поэтому «станци\w*» не ловило
    // «Станция MAX». Правило «дуо max» проверяется выше, так что .* безопасно.
    ["max", /станци.*max/i],
    ["street", /стрит/i]];

  function parseAudioTraits(name) {
    return {
      kind: matchFirst(name, AUDIO_KIND_RULES),
      brand: matchFirst(name, AUDIO_BRAND_RULES),
      line: matchFirst(name, AUDIO_LINE_RULES),
    };
  }

  // --- Аксессуары: тип и для какого устройства ---
  const ACCESSORY_KIND_RULES = [
    ["case", /чехол|бумажник|case\b/i],
    ["glass", /стекл|glass/i],
    ["stylus", /pencil|стилус/i],
    ["tracker", /airtag|smarttag|треке/i],
    ["mouse", /mouse|мышь|keyboard|клавиатур/i],
    ["charger", /сзу|заряд|adapter|кабел|cable/i],
    ["band", /ремеш|\bband\b|\bloop\b/i]];
  const ACCESSORY_DEVICE_RULES = [
    ["iphone-17-pro-max", /iphone\s*17\s*pro\s*max/i],
    ["iphone-17-pro", /iphone\s*17\s*pro/i],
    ["iphone-16-pro-max", /iphone\s*16\s*pro\s*max/i],
    ["iphone-16-pro", /iphone\s*16\s*pro/i],
    ["galaxy-watch", /galaxy\s*watch/i],
    ["samsung", /samsung|\bs\d{2}\s*ultra/i],
    ["ipad", /ipad|pencil/i]];

  function parseAccessoryTraits(name) {
    return {
      kind: matchFirst(name, ACCESSORY_KIND_RULES),
      device: matchFirst(name, ACCESSORY_DEVICE_RULES),
    };
  }

  // --- Приставки и всё вокруг них ---
  const GAMING_KIND_RULES = [
    ["gamepad", /gamepad|геймпад|dualsense/i],
    ["headset", /pulse|наушник|headset|гарнитур/i],
    ["console", /ps5\s*(?:pro|slim)|switch|portal|\bvr2\b|приставк/i],
    ["accessory", /дисковод|станц|stand|подставк|charging/i]];

  function parseGamingTraits(name) {
    const kind = matchFirst(name, GAMING_KIND_RULES);
    // Цвет берём только у геймпадов: у консолей в названии стоит объём диска,
    // а не цвет, и фасет получился бы наполовину пустым.
    const color =
      kind === "gamepad" || kind === "headset"
        ? String(name || "")
            .replace(/^[^\p{L}\p{N}]+/u, "")
            .replace(/^(?:gamepad|геймпад)\s*/i, "")
            .replace(/\bps\s*5\b|\bps5\b/i, "")
            .replace(/pulse|elite|3d/gi, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
        : "";
    return { kind, color };
  }

  // --- Dyson: тип прибора и модель ---
  const DYSON_KIND_RULES = [
    ["styler", /\bhs\d{2}\b|airwrap|стайлер/i],
    ["dryer", /\bhd\d{2}\b|supersonic|\bфен\b/i],
    ["straightener", /\bht\d{2}\b|airstrait|выпрямит/i]];

  function parseDysonTraits(name) {
    const model = String(name || "").match(/\b(H[SDT]\d{2})\b/i);
    return {
      kind: matchFirst(name, DYSON_KIND_RULES),
      model: model ? model[1].toUpperCase() : "",
    };
  }

  // --- Гаджеты: тип и марка ---
  const GADGET_KIND_RULES = [
    ["tracker", /whoop|fitbit|браслет/i],
    ["action", /gopro|экшн/i],
    ["film", /картридж|плёнк|пленк|twin\s*pack/i],
    ["printer", /link|принтер/i],
    ["camera", /instax|canon|powershot|фотоаппарат/i]];
  const GADGET_BRAND_RULES = [
    ["whoop", /whoop/i],
    ["google", /fitbit|google/i],
    ["gopro", /gopro/i],
    ["canon", /canon/i],
    ["fujifilm", /instax|fujifilm/i]];

  function parseGadgetTraits(name) {
    return {
      kind: matchFirst(name, GADGET_KIND_RULES),
      brand: matchFirst(name, GADGET_BRAND_RULES),
    };
  }

  const samsungFacets = [
    { id: "line", label: "Модель" },
    { id: "storage", label: "Память" },
    { id: "color", label: "Цвет" }];

  const SAMSUNG_WIZARD_PROMPTS = {
    line: "Выберите модель Samsung",
    storage: "Выберите объём памяти",
    color: "Выберите цвет",
  };

  const samsungWizard = createLinearWizardHelpers(
    samsungFacets,
    getSamsungTraits,
    isSamsungFilterable,
    SAMSUNG_WIZARD_PROMPTS,
    formatSamsungFacetValue
  );

  window.IRON_SHOP_FILTERS = {
    iphone: {
      label: "iPhone",
      facets: iphoneFacets,
      getTraits: getIphoneTraits,
      isFilterable: isIphoneFilterable,
      matches(product, filters) {
        if (!isIphoneFilterable(product)) return false;
        const traits = getIphoneTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getIphoneTraits, isIphoneFilterable)
        );
      },
      formatValue: formatFacetValue,
      getMobileWizardStep(products, activeFilters) {
        return getMobileWizardStep(products, activeFilters);
      },
      getMobileWizardProgress(products, activeFilters, stepId) {
        return getMobileWizardProgress(products, activeFilters, stepId);
      },
      clearMobileWizardFromStep(activeFilters, stepId) {
        clearMobileWizardFromStep(activeFilters, stepId);
      },
      goBackMobileWizardStep(activeFilters, currentStepId) {
        goBackMobileWizardStep(activeFilters, currentStepId);
      },
      getMobileWizardPrompt(stepId) {
        return IPHONE_WIZARD_PROMPTS[stepId] || "";
      },
      getSelectionSummary(activeFilters) {
        return iphoneFacets
          .filter((facet) => activeFilters[facet.id])
          .map((facet) => formatFacetValue(facet.id, activeFilters[facet.id]));
      },
    },
    macbook: {
      label: "MacBook",
      facets: macbookFacets,
      getTraits: getMacbookTraits,
      isFilterable: isMacbookFilterable,
      matches(product, filters) {
        if (!isMacbookFilterable(product)) return false;
        const traits = getMacbookTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortMacbookFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getMacbookTraits, isMacbookFilterable)
        );
      },
      formatValue: formatMacbookFacetValue,
      ...macbookWizard,
    },
    ipad: {
      label: "iPad",
      facets: ipadFacets,
      getTraits: getIpadTraits,
      isFilterable: isIpadFilterable,
      matches(product, filters) {
        if (!isIpadFilterable(product)) return false;
        const traits = getIpadTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortIpadFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getIpadTraits, isIpadFilterable)
        );
      },
      formatValue: formatIpadFacetValue,
      ...ipadWizard,
    },
    airpods: {
      label: "AirPods",
      facets: airpodsFacets,
      getTraits: getAirpodsTraits,
      isFilterable: isAirpodsFilterable,
      matches(product, filters) {
        if (!isAirpodsFilterable(product)) return false;
        const traits = getAirpodsTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortAirpodsFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getAirpodsTraits, isAirpodsFilterable)
        );
      },
      formatValue: formatAirpodsFacetValue,
      ...airpodsWizard,
    },
    watch: {
      label: "Apple Watch",
      facets: watchFacets,
      getTraits: getWatchTraits,
      isFilterable: isWatchFilterable,
      matches(product, filters) {
        // Как и у групп ниже: без выбранного фильтра показываем всё. Сейчас
        // разбираются все 76 позиций, но появится четвёртая форма названия —
        // товар должен пропасть из фильтра, а не из магазина (28.08.2026).
        const hasActive = Object.values(filters || {}).some(Boolean);
        if (!hasActive) return true;
        if (!isWatchFilterable(product)) return false;
        const traits = getWatchTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortWatchFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getWatchTraits, isWatchFilterable)
        );
      },
      formatValue: formatWatchFacetValue,
      ...watchWizard,
    },
    audio: createSimpleFamily({
      label: "Аудио",
      facets: [
        { id: "kind", label: "Тип" },
        { id: "brand", label: "Бренд" },
        { id: "line", label: "Модель" }],
      parse: parseAudioTraits,
      order: {
        kind: ["headphones", "speaker"],
        brand: ["yandex", "samsung", "marshall", "jbl"],
        line: ["buds3", "buds3pro", "buds4", "buds4pro", "major", "acton", "flip", "mini3", "mini3pro", "max", "duomax", "street"],
      },
      labels: {
        kind: { headphones: "Наушники", speaker: "Колонки" },
        brand: { yandex: "Яндекс", samsung: "Samsung", marshall: "Marshall", jbl: "JBL" },
        line: {
          buds3: "Galaxy Buds 3", buds3pro: "Galaxy Buds 3 Pro",
          buds4: "Galaxy Buds 4", buds4pro: "Galaxy Buds 4 Pro",
          major: "Major V", acton: "Acton III", flip: "Flip 7",
          mini3: "Станция Мини 3", mini3pro: "Станция Мини 3 Про",
          max: "Станция MAX", duomax: "Станция Дуо MAX", street: "Стрит",
        },
      },
      prompts: { kind: "Наушники или колонка", brand: "Выберите бренд", line: "Выберите модель" },
    }),
    accessories: createSimpleFamily({
      label: "Аксессуары",
      facets: [
        { id: "kind", label: "Тип" },
        { id: "device", label: "Для устройства" }],
      parse: parseAccessoryTraits,
      order: {
        kind: ["case", "glass", "stylus", "tracker", "mouse", "charger", "band"],
        device: ["iphone-17-pro-max", "iphone-17-pro", "iphone-16-pro-max", "iphone-16-pro", "ipad", "samsung", "galaxy-watch"],
      },
      labels: {
        kind: {
          case: "Чехлы", glass: "Защитные стёкла", stylus: "Стилусы",
          tracker: "Трекеры", mouse: "Мыши и клавиатуры", charger: "Зарядки",
          band: "Ремешки",
        },
        device: {
          "iphone-17-pro-max": "iPhone 17 Pro Max", "iphone-17-pro": "iPhone 17 Pro",
          "iphone-16-pro-max": "iPhone 16 Pro Max", "iphone-16-pro": "iPhone 16 Pro",
          ipad: "iPad", samsung: "Samsung", "galaxy-watch": "Galaxy Watch",
        },
      },
      prompts: { kind: "Что нужно", device: "Для какого устройства" },
    }),
    gaming: createSimpleFamily({
      label: "Приставки",
      facets: [
        { id: "kind", label: "Тип" },
        { id: "color", label: "Цвет" }],
      parse: parseGamingTraits,
      order: { kind: ["console", "gamepad", "headset", "accessory"] },
      labels: {
        kind: { console: "Консоли", gamepad: "Геймпады", headset: "Гарнитуры", accessory: "Аксессуары" },
      },
      prompts: { kind: "Что нужно", color: "Выберите цвет" },
    }),
    dyson: createSimpleFamily({
      label: "Dyson",
      facets: [
        { id: "kind", label: "Тип" },
        { id: "model", label: "Модель" }],
      parse: parseDysonTraits,
      order: { kind: ["styler", "dryer", "straightener"], model: ["HS08", "HS09", "HD16", "HD17", "HT01"] },
      labels: {
        kind: { styler: "Стайлеры", dryer: "Фены", straightener: "Выпрямители" },
      },
      prompts: { kind: "Что нужно", model: "Выберите модель" },
    }),
    gadgets: createSimpleFamily({
      label: "Гаджеты",
      facets: [
        { id: "kind", label: "Тип" },
        { id: "brand", label: "Бренд" }],
      parse: parseGadgetTraits,
      order: {
        kind: ["tracker", "action", "camera", "printer", "film"],
        brand: ["whoop", "google", "gopro", "canon", "fujifilm"],
      },
      labels: {
        kind: {
          tracker: "Фитнес-браслеты", action: "Экшн-камеры", camera: "Фотоаппараты",
          printer: "Фотопринтеры", film: "Плёнка и картриджи",
        },
        brand: { whoop: "Whoop", google: "Google", gopro: "GoPro", canon: "Canon", fujifilm: "Fujifilm" },
      },
      prompts: { kind: "Что нужно", brand: "Выберите бренд" },
    }),
    samsung: {
      label: "Samsung",
      facets: samsungFacets,
      getTraits: getSamsungTraits,
      isFilterable: isSamsungFilterable,
      matches(product, filters) {
        if (!isSamsungFilterable(product)) return false;
        const traits = getSamsungTraits(product);
        return Object.entries(filters || {}).every(([facetId, value]) => traitMatchesFilter(traits, facetId, value));
      },
      collectOptions(products, facetId, activeFilters) {
        return sortSamsungFacetValues(
          facetId,
          collectFacetOptions(products, facetId, activeFilters, getSamsungTraits, isSamsungFilterable)
        );
      },
      formatValue: formatSamsungFacetValue,
      ...samsungWizard,
    },
  };
})();
