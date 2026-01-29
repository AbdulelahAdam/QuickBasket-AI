/**
 * QuickBasket AI - Validation Utilities
 */

(function () {
  "use strict";

  // Get config from global scope
  const CONFIG = window.QB_CONFIG || {};
  const { LIMITS, PATTERNS, VALID_CURRENCY_CODES, MARKETPLACES } = CONFIG;

  // ==========================================
  // CACHED UTILITIES
  // ==========================================

  // Create a temporary div for HTML escaping (reuse)
  const tempDiv = document.createElement("div");

  // Cache marketplace domain sets for O(1) lookup
  const marketplaceDomainSets = new Map();
  if (MARKETPLACES) {
    for (const [key, marketplace] of Object.entries(MARKETPLACES)) {
      marketplaceDomainSets.set(marketplace.id, new Set(marketplace.domains));
    }
  }

  // ==========================================
  // STRING VALIDATION & SANITIZATION
  // ==========================================

  /**
   * Sanitize string to prevent XSS (optimized)
   * @param {string} str - String to sanitize
   * @returns {string} - Sanitized string
   */
  function sanitizeString(str) {
    if (typeof str !== "string" || !str) return "";

    // Early return if no dangerous patterns detected
    if (!/<|javascript:|on\w+=/i.test(str)) {
      return str.trim().substring(0, LIMITS?.MAX_PRODUCT_NAME_LENGTH || 500);
    }

    // Apply all security patterns
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

  /**
   * Escape HTML to prevent XSS (optimized with cached element)
   * @param {string} text - Text to escape
   * @returns {string} - Escaped HTML
   */
  function escapeHtml(text) {
    if (typeof text !== "string") return "";
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  /**
   * Validate product name (optimized)
   * @param {string} name - Product name
   * @returns {boolean} - Is valid
   */
  function isValidProductName(name) {
    if (typeof name !== "string") return false;
    const len = name.trim().length;
    return (
      len >= (LIMITS?.MIN_PRODUCT_NAME_LENGTH || 3) &&
      len <= (LIMITS?.MAX_PRODUCT_NAME_LENGTH || 500)
    );
  }

  // ==========================================
  // PRICE VALIDATION (Optimized)
  // ==========================================

  /**
   * Sanitize and validate price string (optimized)
   * @param {string} price - Price string
   * @returns {string|null} - Sanitized price or null
   */
  function sanitizePrice(price) {
    if (typeof price !== "string") return null;

    // Remove all non-numeric chars except dots and commas
    const cleaned = price.replace(/[^\d.,]/g, "");

    // Fast path: check length before regex
    if (!cleaned || cleaned.length > 12) return null;

    // Validate format
    if (PATTERNS && !PATTERNS.PRICE.test(cleaned)) return null;

    // Parse and validate range
    const num = parseFloat(cleaned);
    const min = LIMITS?.MIN_PRICE || 0.01;
    const max = LIMITS?.MAX_PRICE || 1000000;

    return !isNaN(num) && num >= min && num <= max ? cleaned : null;
  }

  /**
   * Validate numeric price (optimized)
   * @param {number} price - Price number
   * @returns {number|null} - Valid price or null
   */
  function validatePriceNumber(price) {
    if (typeof price !== "number" || isNaN(price)) return null;

    const min = LIMITS?.MIN_PRICE || 0.01;
    const max = LIMITS?.MAX_PRICE || 1000000;

    return price >= min && price <= max ? price : null;
  }

  /**
   * Check if price is single (not a range) - optimized
   * @param {string} text - Price text
   * @returns {boolean} - Is single price
   */
  function isValidSinglePrice(text) {
    if (!text) return false;

    // Quick checks first
    if (text.includes(" to ") || text.includes("–")) return false;
    if (text.includes("-") && !text.includes("from")) return false;

    return true;
  }

  // ==========================================
  // CURRENCY VALIDATION (Optimized)
  // ==========================================

  // Create Set of valid codes for O(1) lookup
  const validCurrencySet = VALID_CURRENCY_CODES
    ? new Set(VALID_CURRENCY_CODES)
    : new Set(["USD"]);

  /**
   * Validate currency code (optimized with Set)
   * @param {string} currency - Currency code
   * @returns {string} - Valid currency or USD
   */
  function validateCurrency(currency) {
    if (!currency || typeof currency !== "string") return "USD";

    const upper = currency.toUpperCase();
    return validCurrencySet.has(upper) ? upper : "USD";
  }

  /**
   * Get currency symbol (optimized with Map)
   * @param {string} currencyCode - Currency code
   * @returns {string} - Currency symbol
   */
  function getCurrencySymbol(currencyCode) {
    if (!CONFIG.CURRENCIES) return "$";

    const currency = CONFIG.CURRENCIES.get
      ? CONFIG.CURRENCIES.get(currencyCode)
      : CONFIG.CURRENCIES[currencyCode];

    return currency?.symbol || "$";
  }

  // ==========================================
  // IDENTIFIER VALIDATION (Optimized)
  // ==========================================

  /**
   * Validate Amazon ASIN (optimized)
   * @param {string} asin - ASIN string
   * @returns {string|null} - Valid ASIN or null
   */
  function validateASIN(asin) {
    if (!asin || typeof asin !== "string") return null;

    // Fast path: check length first
    if (asin.length !== (LIMITS?.ASIN_LENGTH || 10)) return null;

    // Then check pattern
    return PATTERNS && PATTERNS.ASIN.test(asin) ? asin : null;
  }

  /**
   * Validate SKU (optimized)
   * @param {string} sku - SKU string
   * @returns {string|null} - Valid SKU or null
   */
  function validateSKU(sku) {
    if (!sku || typeof sku !== "string") return null;

    const len = sku.length;
    const min = LIMITS?.SKU_MIN_LENGTH || 3;
    const max = LIMITS?.SKU_MAX_LENGTH || 30;

    // Fast path: check length first
    if (len < min || len > max) return null;

    // Then check pattern
    return PATTERNS && PATTERNS.SKU.test(sku) ? sku.toUpperCase() : null;
  }

  // ==========================================
  // URL VALIDATION (Optimized)
  // ==========================================

  /**
   * Check if URL is from supported marketplace (optimized)
   * @param {string} url - URL to validate
   * @returns {boolean} - Is valid marketplace URL
   */
  function isValidMarketplaceUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      // Fast path: check protocol first
      if (!url.startsWith("https://")) return false;

      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check against cached domain sets
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

  /**
   * Get marketplace from URL (optimized)
   * @param {string} url - URL to check
   * @returns {string|null} - Marketplace ID or null
   */
  function getMarketplaceFromUrl(url) {
    if (!url || typeof url !== "string") return null;

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check each marketplace's domain set
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

  /**
   * Validate product page URL pattern (optimized)
   * @param {string} url - URL to validate
   * @param {string} marketplace - Marketplace ID
   * @returns {boolean} - Is valid product page
   */
  function isProductPageUrl(url, marketplace) {
    if (!url || !marketplace || !MARKETPLACES) return false;

    const marketplaceConfig = MARKETPLACES[marketplace.toUpperCase()];
    if (!marketplaceConfig?.urlPatterns) return false;

    // Test against patterns
    return marketplaceConfig.urlPatterns.some((pattern) => pattern.test(url));
  }

  // ==========================================
  // PRODUCT DATA VALIDATION (Optimized)
  // ==========================================

  /**
   * Validate complete product object (optimized)
   * @param {Object} product - Product object
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  function validateProduct(product) {
    if (!product || typeof product !== "object") {
      return { valid: false, errors: ["Invalid product object"] };
    }

    const errors = [];

    // Required fields check (single pass)
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

    // Early return if required fields missing
    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Validate name
    if (!isValidProductName(product.name)) {
      errors.push("Invalid product name length");
    }

    // Validate prices
    if (validatePriceNumber(product.currentPrice) === null) {
      errors.push("Invalid current price");
    }

    if (
      product.originalPrice != null &&
      validatePriceNumber(product.originalPrice) === null
    ) {
      errors.push("Invalid original price");
    }

    // Validate marketplace
    if (!marketplaceDomainSets.has(product.marketplace.toLowerCase())) {
      errors.push("Invalid marketplace");
    }

    // Validate currency
    if (!validCurrencySet.has(product.currency)) {
      errors.push("Invalid currency code");
    }

    // Validate URL
    if (!isValidMarketplaceUrl(product.url)) {
      errors.push("Invalid product URL");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Sanitize product object (optimized)
   * @param {Object} product - Product object
   * @returns {Object} - Sanitized product
   */
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

  // ==========================================
  // EXPORT VALIDATORS
  // ==========================================

  const validators = Object.freeze({
    // String validation
    sanitizeString,
    escapeHtml,
    isValidProductName,

    // Price validation
    sanitizePrice,
    validatePriceNumber,
    isValidSinglePrice,

    // Currency validation
    validateCurrency,
    getCurrencySymbol,

    // Identifier validation
    validateASIN,
    validateSKU,

    // URL validation
    isValidMarketplaceUrl,
    getMarketplaceFromUrl,
    isProductPageUrl,

    // Product validation
    validateProduct,
    sanitizeProduct,
  });

  // Browser extension export
  if (typeof window !== "undefined") {
    window.QB_VALIDATORS = validators;
  }

  // Module export
  if (typeof module !== "undefined" && module.exports) {
    module.exports = validators;
  }
})();
