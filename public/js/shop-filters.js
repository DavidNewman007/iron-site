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
    "14",
  ];

  const IPHONE_SERIES_LABEL = {
    Air: "iPhone Air",
    "17e": "iPhone 17e",
    "16e": "iPhone 16e",
  };

  const SERIES_PATTERN = /^(Air|\d+\s*e|\d+\s*Pro\s*Max|\d+\s*Pro|\d+\s*Plus|\d+)/i;

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
        .replace(/^iPhone\s+/i, "")
        .replace(seriesRe, "")
        .replace(/^(\d+)\s*(?:Tb|TB|Gb|GB|G)?\s+/i, "")
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .trim();
      color = tail.replace(/\s+[A-Z]{1,2}\/[A-Z]\/?A?\s*$/i, "").trim();
      if (color.includes("(")) color = color.split("(")[0].trim();
    }

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
    return value;
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
    { id: "color", label: "Цвет" },
  ];

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
  };
})();
