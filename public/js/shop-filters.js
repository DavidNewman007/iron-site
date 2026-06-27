/**
 * Фильтры-характеристики по категориям магазина.
 * Каждая категория описывает свои facet-поля (серия, память, SIM, цвет и т.д.).
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
    if (/\(SIM\s*\+\s*eSIM\)/i.test(productName) || /sim\s*\+\s*esim/i.test(productSection)) {
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
      if (tb) return `${tb[1]} ТБ`;
      return `${value} ГБ`;
    }
    if (facetId === "sim") {
      if (value === "sim+esim") return "SIM + eSIM";
      if (value === "esim") return "eSIM";
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
      if (tb) return `${tb[1]} ТБ`;
      return `${value} ГБ`;
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
      if (tb) return `${tb[1]} ТБ`;
      return `${value} ГБ`;
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
        .replace(/^.*?max\s+(?:20\d{2}\s+)?/i, "")
        .replace(/\s+[A-Z0-9]{4,5}(?:\s+[A-Z]{1,2}\/[A-Z]\/?A?)?\s*$/i, "")
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
      if (value === "anc") return "С ANC";
      if (value === "standard") return "Без ANC";
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
    "S26 Ultra",
    "Buds Core",
    "Buds 3",
    "Buds 3 Pro",
    "Buds 4",
    "Buds 4 Pro",
  ];

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

  function isSamsungBudsLine(line) {
    return /^buds\b/i.test(String(line || ""));
  }

  function parseSamsungLine(name) {
    const productName = String(name || "").trim();
    const budsMatch = productName.match(/^Samsung\s+Galaxy\s+Buds(?:\s+(Core|\d+(?:\s+Pro)?))?\b/i);
    if (budsMatch) {
      if (budsMatch[1] && /^core$/i.test(budsMatch[1])) return "Buds Core";
      if (budsMatch[1]) return `Buds ${budsMatch[1].replace(/\s+/g, " ").trim()}`;
      return "Buds";
    }
    const samsungMatch = productName.match(/^Samsung\s+((?:A\d+|S\d+(?:\s+(?:Ultra|Plus|FE))?))\b/i);
    if (samsungMatch) return samsungMatch[1].replace(/\s+/g, " ").trim();
    const shortMatch = productName.match(/^S(\d+(?:\s+(?:Ultra|Plus|FE))?)\b/i);
    if (shortMatch) return `S${shortMatch[1]}`.replace(/\s+/g, " ").trim();
    return "";
  }

  function parseSamsungStorage(name, line) {
    if (isSamsungBudsLine(line)) return "";
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
    const storage = parseSamsungStorage(productName, line);

    let color = "";
    if (line && (storage || isSamsungBudsLine(line))) {
      let tail = productName
        .replace(/^Samsung\s+/i, "")
        .replace(/^S\d+(?:\s+(?:Ultra|Plus|FE))?\s+/i, "")
        .replace(/^Galaxy\s+Buds(?:\s+(?:Core|\d+(?:\s+Pro)?))?\s+/i, "")
        .replace(/^(?:A\d+|S\d+(?:\s+(?:Ultra|Plus|FE))?)\s+/i, "")
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
    if (!traits.line) return false;
    if (isSamsungBudsLine(traits.line)) return true;
    return Boolean(traits.storage);
  }

  function samsungLineSortKey(line) {
    const idx = SAMSUNG_LINE_ORDER.indexOf(line);
    return idx >= 0 ? idx : 999;
  }

  function samsungLineLabel(line) {
    if (!line) return "";
    if (/^buds\b/i.test(line)) return `Galaxy ${line}`;
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
      if (tb) return `${tb[1]} ТБ`;
      return `${value} ГБ`;
    }
    if (facetId === "color") return formatColorLabel(value);
    return value;
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
