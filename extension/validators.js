(function () {
  "use strict";

  const CONFIG = window.QB_CONFIG || {};
  const { LIMITS, PATTERNS, VALID_CURRENCY_CODES, MARKETPLACES } = CONFIG;

  const tempDiv = document.createElement("div");

  const marketplaceDomainSets = new Map();
  if (MARKETPLACES) {
    for (const [key, marketplace] of Object.entries(MARKETPLACES)) {
      marketplaceDomainSets.set(marketplace.id, new Set(marketplace.domains));
    }
  }
  function sanitizeString(str) {
    if (typeof str !== "string" || !str) return "";

    if (!/<|javascript:|on\w+=/i.test(str)) {
      return str.trim().substring(0, LIMITS?.MAX_PRODUCT_NAME_LENGTH || 500);
    }

    let cleaned = str;
    if (PATTERNS) {
      cleaned = cleaned
        .replace(PATTERNS.SCRIPT_TAG, "")
        .replace(PATTERNS.IFRAME_TAG, "")
        .replace(PATTERNS.OBJECT_TAG, "")
        .replace(PATTERNS.EMBED_TAG, "")
        .replace(PATTERNS.HTML_TAG, "")
        .replace(PATTERNS.JAVASCRIPT_PROTOCOL, "")
        .replace(PATTERNS.EVENT_HANDLER, "")
        .replace(PATTERNS.DATA_HTML, "");
    }

    return cleaned.trim().substring(0, LIMITS?.MAX_PRODUCT_NAME_LENGTH || 500);
  }

  function escapeHtml(text) {
    if (typeof text !== "string") return "";
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  function isValidProductName(name) {
    if (typeof name !== "string") return false;
    const len = name.trim().length;
    return (
      len >= (LIMITS?.MIN_PRODUCT_NAME_LENGTH || 3) &&
      len <= (LIMITS?.MAX_PRODUCT_NAME_LENGTH || 500)
    );
  }

  function sanitizePrice(price) {
    if (typeof price !== "string") return null;

    const cleaned = price.replace(/[^\d.,]/g, "");

    if (!cleaned || cleaned.length > 12) return null;

    if (PATTERNS && !PATTERNS.PRICE.test(cleaned)) return null;

    const num = parseFloat(cleaned);
    const min = LIMITS?.MIN_PRICE || 0.01;
    const max = LIMITS?.MAX_PRICE || 1000000;

    return !isNaN(num) && num >= min && num <= max ? cleaned : null;
  }

  function validatePriceNumber(price) {
    if (typeof price !== "number" || isNaN(price)) return null;

    const min = LIMITS?.MIN_PRICE || 0.01;
    const max = LIMITS?.MAX_PRICE || 1000000;

    return price >= min && price <= max ? price : null;
  }

  function isValidSinglePrice(text) {
    if (!text) return false;

    if (text.includes(" to ") || text.includes("–")) return false;
    if (text.includes("-") && !text.includes("from")) return false;

    return true;
  }

  const validCurrencySet = VALID_CURRENCY_CODES
    ? new Set(VALID_CURRENCY_CODES)
    : new Set(["USD"]);

  function validateCurrency(currency) {
    if (!currency || typeof currency !== "string") return "USD";

    const upper = currency.toUpperCase();
    return validCurrencySet.has(upper) ? upper : "USD";
  }

  function getCurrencySymbol(currencyCode) {
    if (!CONFIG.CURRENCIES) return "$";

    const currency = CONFIG.CURRENCIES.get
      ? CONFIG.CURRENCIES.get(currencyCode)
      : CONFIG.CURRENCIES[currencyCode];

    return currency?.symbol || "$";
  }

  function validateASIN(asin) {
    if (!asin || typeof asin !== "string") return null;

    if (asin.length !== (LIMITS?.ASIN_LENGTH || 10)) return null;

    return PATTERNS && PATTERNS.ASIN.test(asin) ? asin : null;
  }

  function validateSKU(sku) {
    if (!sku || typeof sku !== "string") return null;

    const len = sku.length;
    const min = LIMITS?.SKU_MIN_LENGTH || 3;
    const max = LIMITS?.SKU_MAX_LENGTH || 30;

    if (len < min || len > max) return null;

    return PATTERNS && PATTERNS.SKU.test(sku) ? sku.toUpperCase() : null;
  }

  function isValidMarketplaceUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      if (!url.startsWith("https://")) return false;

      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      for (const domains of marketplaceDomainSets.values()) {
        for (const domain of domains) {
          if (hostname.includes(domain)) return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  function getMarketplaceFromUrl(url) {
    if (!url || typeof url !== "string") return null;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      for (const [id, domains] of marketplaceDomainSets) {
        for (const domain of domains) {
          if (hostname.includes(domain)) return id;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  function isProductPageUrl(url, marketplace) {
    if (!url || !marketplace || !MARKETPLACES) return false;

    const marketplaceConfig = MARKETPLACES[marketplace.toUpperCase()];
    if (!marketplaceConfig?.urlPatterns) return false;

    return marketplaceConfig.urlPatterns.some((pattern) => pattern.test(url));
  }

  function validateProduct(product) {
    if (!product || typeof product !== "object") {
      return { valid: false, errors: ["Invalid product object"] };
    }

    const errors = [];

    const requiredFields = {
      id: "string",
      name: "string",
      marketplace: "string",
      currentPrice: "number",
      currency: "string",
      url: "string",
    };

    for (const [field, type] of Object.entries(requiredFields)) {
      const value = product[field];
      if (!value || typeof value !== type) {
        errors.push(`Invalid or missing ${field}`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    if (!isValidProductName(product.name)) {
      errors.push("Invalid product name length");
    }

    if (validatePriceNumber(product.currentPrice) === null) {
      errors.push("Invalid current price");
    }

    if (
      product.originalPrice != null &&
      validatePriceNumber(product.originalPrice) === null
    ) {
      errors.push("Invalid original price");
    }

    if (!marketplaceDomainSets.has(product.marketplace.toLowerCase())) {
      errors.push("Invalid marketplace");
    }

    if (!validCurrencySet.has(product.currency)) {
      errors.push("Invalid currency code");
    }

    if (!isValidMarketplaceUrl(product.url)) {
      errors.push("Invalid product URL");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  function sanitizeProduct(product) {
    if (!product || typeof product !== "object") {
      return null;
    }

    return {
      id: sanitizeString(String(product.id || "")),
      name: sanitizeString(product.name || ""),
      marketplace: sanitizeString(
        String(product.marketplace || "")
      ).toLowerCase(),
      currentPrice: validatePriceNumber(product.currentPrice) || 0,
      originalPrice: product.originalPrice
        ? validatePriceNumber(product.originalPrice)
        : null,
      currency: validateCurrency(product.currency),
      url: String(product.url || "").trim(),
      priceChange:
        typeof product.priceChange === "number" ? product.priceChange : 0,
      lastUpdated: product.lastUpdated || Date.now(),
      image: product.image ? sanitizeString(product.image) : null,
    };
  }

  const validators = Object.freeze({
    sanitizeString,
    escapeHtml,
    isValidProductName,

    sanitizePrice,
    validatePriceNumber,
    isValidSinglePrice,

    validateCurrency,
    getCurrencySymbol,

    validateASIN,
    validateSKU,

    isValidMarketplaceUrl,
    getMarketplaceFromUrl,
    isProductPageUrl,

    validateProduct,
    sanitizeProduct,
  });

  if (typeof window !== "undefined") {
    window.QB_VALIDATORS = validators;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = validators;
  }
})();
