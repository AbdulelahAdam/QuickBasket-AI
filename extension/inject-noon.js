/**
 * QuickBasket AI - Noon Product Data Extractor (On-Demand)
 */

(function () {
  "use strict";

  if (window.__QB_NOON_HOOKED__) return;
  window.__QB_NOON_HOOKED__ = true;

  const config = window.QB_CONFIG || {};
  const validators = window.QB_VALIDATORS || {};

  const PRODUCT_URL_PATTERN = /\/([A-Z0-9]+)\/p\//;

  // ==========================================
  // CURRENCY MAPPING
  // ==========================================
  const REGION_CURRENCY_MAP = new Map([
    ["saudi", "SAR"],
    ["uae", "AED"],
    ["kuwait", "KWD"],
    ["qatar", "QAR"],
    ["bahrain", "BHD"],
    ["oman", "OMR"],
    ["egypt", "EGP"],
  ]);

  const DOMAIN_CURRENCY_MAP = new Map([
    [".sa", "SAR"],
    [".ae", "AED"],
    [".kw", "KWD"],
    [".qa", "QAR"],
    [".bh", "BHD"],
    [".om", "OMR"],
  ]);

  // ==========================================
  // SELECTORS
  // ==========================================
  const SELECTORS = {
    productTitle: [
      "h1",
      '[data-testid="product-title"]',
      ".productTitle",
      '[class*="title"]',
      '[class*="product-name"]',
      ".product-name",
    ],
    price: [
      '[data-testid="product-price"]',
      '[class*="price"]',
      ".product-price",
      '[class*="sale-price"]',
      ".priceBox",
      "span.price",
    ],
  };

  // ==========================================
  // UTILITY FUNCTIONS
  // ==========================================

  const isProductPage = () => window.location.href.includes("/p/");

  function getCurrency() {
    const url = window.location.href;

    const regionMatch = url.match(/noon\.com\/([a-z]+)-[a-z]{2}/);

    if (regionMatch) {
      const region = regionMatch[1];
      const currency = REGION_CURRENCY_MAP.get(region);
      if (currency) return currency;
    }

    for (const [domain, currency] of DOMAIN_CURRENCY_MAP) {
      if (url.includes(domain)) return currency;
    }

    return "EGP";
  }

  function extractSKU() {
    const url = window.location.href;

    const skuMatch = url.match(PRODUCT_URL_PATTERN);
    if (skuMatch) {
      const sku = skuMatch[1];
      return validators.validateSKU ? validators.validateSKU(sku) : sku;
    }

    const oMatch = url.match(/[?&]o=([a-z0-9-]+)/i);
    if (oMatch) {
      const sku = oMatch[1].split("-")[0];
      return validators.validateSKU ? validators.validateSKU(sku) : sku;
    }

    return null;
  }

  function safeQuerySelector(selectors) {
    if (!Array.isArray(selectors)) selectors = [selectors];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el?.textContent?.trim()) return el;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  function extractProductName() {
    const titleEl = safeQuerySelector(SELECTORS.productTitle);
    if (!titleEl) return null;

    const name = titleEl.textContent.trim();

    if (validators.isValidProductName) {
      return validators.isValidProductName(name) ? name : null;
    }

    return name.length >= 3 && name.length <= 500 ? name : null;
  }

  function extractProductImage() {
    const imageSelectors = [
      '[data-qa="product-image"] img',
      ".swiper-slide-active img",
      '[class*="image"] img',
      'img[alt*="Product"]',
      "picture img",
    ];

    for (const selector of imageSelectors) {
      try {
        const img = document.querySelector(selector);
        if (img && img.src && !img.src.includes("data:image")) {
          return img.src;
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  function extractPrice() {
    const priceEl = safeQuerySelector(SELECTORS.price);
    if (!priceEl) return null;

    const text = priceEl.textContent;

    const currencyMatch = text.match(
      /\b(EGP|SAR|AED|KWD|QAR|BHD|OMR|GBP|EUR|USD)\b/i
    );
    const currency = currencyMatch
      ? currencyMatch[1].toUpperCase()
      : getCurrency();

    const priceMatch = text.match(/[\d,]+\.?\d*/);
    if (!priceMatch) return null;

    const priceStr = priceMatch[0].replace(/,/g, "");
    const price = parseFloat(priceStr);

    if (isNaN(price) || price <= 0) return null;

    return { price, currency };
  }

  // ==========================================
  // MAIN EXTRACTION
  // ==========================================

  function extractProductData() {
    if (!isProductPage()) return null;

    const sku = extractSKU();
    if (!sku) return null;

    const name = extractProductName();
    if (!name) return null;

    const priceData = extractPrice();
    if (!priceData) return null;

    let { price, currency } = priceData;
    if (validators.validateCurrency) {
      currency = validators.validateCurrency(currency);
    }

    if (validators.validatePriceNumber) {
      const validatedPrice = validators.validatePriceNumber(price);
      if (!validatedPrice) return null;
      price = validatedPrice;
    }

    const image = extractProductImage();

    return {
      name: validators.sanitizeString ? validators.sanitizeString(name) : name,
      sku,
      price,
      currency,
      image,
    };
  }

  // ==========================================
  // MESSAGE LISTENER - ON-DEMAND
  // ==========================================

  console.log("[QB Noon Injector] Ready - waiting for extraction request");

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "quickbasket-content-noon") return;
    if (event.data?.action !== "extractProduct") return;

    console.log("[QB Noon Injector] Extraction requested");

    try {
      const product = extractProductData();

      if (product) {
        console.log(
          "[QB Noon Injector] Product extracted:",
          product.name.substring(0, 50)
        );

        window.postMessage(
          {
            source: "quickbasket-injected-noon",
            type: "PRODUCT_EXTRACTED",
            product,
            url: window.location.href,
            timestamp: Date.now(),
          },
          window.location.origin
        );
      } else {
        console.log("[QB Noon Injector] Could not extract product");

        window.postMessage(
          {
            source: "quickbasket-injected-noon",
            type: "EXTRACTION_FAILED",
            error: "Could not find product information on this page",
            timestamp: Date.now(),
          },
          window.location.origin
        );
      }
    } catch (error) {
      console.error("[QB Noon Injector] Extraction error:", error);

      window.postMessage(
        {
          source: "quickbasket-injected-noon",
          type: "EXTRACTION_ERROR",
          error: error.message,
          timestamp: Date.now(),
        },
        window.location.origin
      );
    }
  });
})();
