/**
 * QuickBasket AI - Amazon Product Data Extractor (On-Demand)
 */

(function () {
  "use strict";

  // Prevent multiple injections
  if (window.__QB_AMAZON_HOOKED__) return;
  window.__QB_AMAZON_HOOKED__ = true;

  // Config and validators (loaded externally)
  const config = window.QB_CONFIG || {};
  const validators = window.QB_VALIDATORS || {};

  // Constants
  const PRODUCT_URL_PATTERN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;

  // ==========================================
  // CURRENCY MAPPING (Optimized with Map)
  // ==========================================
  const DOMAIN_CURRENCY_MAP = new Map([
    // Multi-part domains
    [".co.uk", "GBP"],
    [".co.jp", "JPY"],
    [".com.br", "BRL"],
    [".com.mx", "MXN"],
    [".com.tr", "TRY"],
    [".com.be", "EUR"],
    [".com.au", "AUD"],
    // Single-part domains
    [".ae", "AED"],
    [".eg", "EGP"],
    [".sa", "SAR"],
    [".ca", "CAD"],
    [".in", "INR"],
    [".sg", "SGD"],
    [".se", "SEK"],
    [".pl", "PLN"],
    [".za", "ZAR"],
    [".qa", "QAR"],
    [".bh", "BHD"],
    [".om", "OMR"],
    // Euro zone
    [".de", "EUR"],
    [".fr", "EUR"],
    [".es", "EUR"],
    [".it", "EUR"],
    [".nl", "EUR"],
    [".ie", "EUR"],
  ]);

  // ==========================================
  // SELECTORS (Cached for reuse)
  // ==========================================
  const SELECTORS = {
    productTitle: [
      "productTitle",
      'h1[data-feature-name="title"]',
      'span[id="productTitle"]',
      '[data-feature-name="title"] h1',
    ],
    priceWhole: ".a-price-whole",
    priceFraction: ".a-price-fraction",
    priceOffscreen: ".a-price .a-offscreen",
    priceContainers: [
      "#corePriceDisplay_desktop_feature_div", // Primary for Electronics
      "#corePrice_desktop", // Secondary for Electronics
      "#apex_desktop", // The main price "Apex" area
      "#buyBoxAccordion", // Used for products with multiple buying options
      "#newAccordionRow", // Specifically for the "New" price in buyboxes
      "#price_inside_buybox", // Inside the right-side buybox
    ],
    // Add these to exclude carousel/related noise
    noiseContainers: [
      "#desktop-dp-sims_session-similarities-sims-feature", // "Customers who viewed..."
      "#HLCXComparisonWidget_feature_div", // Comparison table
      "#bundle-v2-feature-div", // Bundles
    ],
    addToCart: [
      'input[value="Add to Cart"][data-feature-name]',
      'button[data-feature-name="add-to-cart-button"]',
      "add-to-cart-button",
    ],
    formatTabs: '[data-a-button-toggle="true"][aria-pressed="true"]',
    buyingOptions: [
      "tmmSwatches .swatchElement.selected .a-button-text",
      "tmmSwatches .swatchElement.selected",
    ],
  };

  // ==========================================
  // UTILITY FUNCTIONS
  // ==========================================

  const isProductPage = () => PRODUCT_URL_PATTERN.test(window.location.href);

  function getCurrency() {
    const url = window.location.href;

    for (const [domain, currency] of DOMAIN_CURRENCY_MAP) {
      if (domain.includes(".co") || domain.includes(".com")) {
        if (url.includes(domain)) return currency;
      }
    }

    for (const [domain, currency] of DOMAIN_CURRENCY_MAP) {
      if (!domain.includes(".co") && !domain.includes(".com")) {
        if (url.includes(domain)) return currency;
      }
    }

    return "USD";
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

  let currentASIN = null;

  function extractASIN() {
    const match = window.location.href.match(PRODUCT_URL_PATTERN);
    if (!match) return null;
    currentASIN = match[1]; // Store globally for this session
    return validators.validateASIN
      ? validators.validateASIN(currentASIN)
      : currentASIN;
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
    // Try multiple selectors for product image
    const imageSelectors = [
      "landingImage",
      "imgBlkFront",
      "ebooksImgBlkFront",
      "[data-a-dynamic-image]",
      "main-image",
      ".a-dynamic-image",
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

  function detectCurrencyFromPrices() {
    const priceElements = document.querySelectorAll(
      `${SELECTORS.priceWhole}, ${SELECTORS.priceOffscreen}`
    );

    const currencyPattern =
      /\b(EGP|AED|USD|SAR|KWD|GBP|EUR|QAR|BHD|OMR|CAD|JPY|INR|BRL|MXN|TRY|AUD|SGD|SEK|PLN|ZAR)\b/i;

    for (const el of priceElements) {
      const match = el.textContent.match(currencyPattern);
      if (match) return match[1].toUpperCase();
    }

    return null;
  }

  function extractPriceNumber(text) {
    if (!text || text.trim() === "") return null;

    // 1. Pre-process: Strip commas used as thousands separators
    // This turns "1,329.99" into "1329.99"
    let cleanText = text.replace(/,(?=\d{3})/g, "");

    // If your region uses commas as decimals (e.g. 1.329,99), use this instead:
    // let cleanText = text.replace(/\./g, "").replace(",", ".");

    let result = null;
    if (validators.sanitizePrice) {
      console.log("[QB Debug] Using custom price sanitizer for text:", text);
      result = validators.sanitizePrice(cleanText);
    } else {
      // Manual fallback if validator isn't present
      const numericOnly = cleanText.replace(/[^\d.]/g, "");
      result = parseFloat(numericOnly) > 0 ? numericOnly : null;
    }

    if (result) {
      console.log("[QB Debug] Price successfully sanitized:", result);
    } else {
      console.log("[QB Debug] Sanitization FAILED for:", text);
    }

    return result;
  }

  function combinePriceParts(wholeEl) {
    let text = wholeEl.textContent || "";

    const fractionEl = wholeEl.nextElementSibling;
    if (fractionEl?.classList.contains("a-price-fraction")) {
      text += fractionEl.textContent;
    }

    return extractPriceNumber(text);
  }

  function isInUpperViewport(el) {
    try {
      const rect = el.getBoundingClientRect();
      return (
        rect.top > 0 && rect.top < window.innerHeight * 0.5 && rect.top < 500
      );
    } catch {
      return false;
    }
  }

  // ==========================================
  // PRICE EXTRACTION (Consolidated)
  // ==========================================

  function extractPrice() {
    let price = null;

    // 1. HIGH PRIORITY: Try the ASIN-Locked Containers first
    price = extractFromPriceContainers();
    if (price) {
      console.log("[QB] Found Primary BuyBox Price:", price);
      return price; // STOP HERE
    }

    // 2. Try Format Tabs (Kindle/Books)
    price = extractFromBuyingOptions();
    if (price) return price;

    // 3. Try Near Add To Cart
    price = extractNearAddToCart();
    if (price) return price;

    // 4. FINAL FALLBACK: Only if everything above failed
    console.log("[QB] No primary price found, trying generic fallback...");
    return extractFirstValidPrice();
  }

  function extractFromBuyingOptions() {
    for (const selector of SELECTORS.buyingOptions) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent;
        if (text.includes("$") || text.match(/[\d,]+[.,]\d{2}/)) {
          const price = extractPriceNumber(text);
          if (price) return price;
        }
      }
    }
    return null;
  }

  function extractNearAddToCart() {
    const addToCartBtn = safeQuerySelector(SELECTORS.addToCart);
    if (!addToCartBtn) return null;

    let currentEl = addToCartBtn;
    let depth = 0;

    while (currentEl && depth++ < 10) {
      const priceSpan = currentEl.querySelector(SELECTORS.priceWhole);
      if (priceSpan) {
        const price = combinePriceParts(priceSpan);
        if (price) return price;
      }

      if (currentEl.previousElementSibling) {
        const siblingPrice = currentEl.previousElementSibling.querySelector(
          SELECTORS.priceWhole
        );
        if (siblingPrice) {
          const price = combinePriceParts(siblingPrice);
          if (price) return price;
        }
      }

      currentEl = currentEl.parentElement;
    }

    return null;
  }

  function extractFromPriceContainers() {
    // 1. Ensure we have the ASIN for the main product
    const asin = extractASIN();
    if (!asin) return null;

    // 2. EXPLICIT TARGETING: Look for the specific BuyBox ID
    // This is the div you found in DevTools ($1,329.99)
    const primaryBox =
      document.getElementById("corePriceDisplay_desktop_feature_div") ||
      document.getElementById("corePrice_desktop") ||
      document.getElementById("apex_desktop");

    if (primaryBox) {
      // Look for the specific "Price to Pay" offscreen text
      const offscreen =
        primaryBox.querySelector(".aok-offscreen") ||
        primaryBox.querySelector(".a-offscreen");

      if (offscreen && offscreen.textContent.trim()) {
        const price = extractPriceNumber(offscreen.textContent);
        if (price) {
          console.log("[QB] Found Locked BuyBox Price:", price);
          return price;
        }
      }
    }

    // 3. SECONDARY TARGETING: Use the ASIN attribute filter
    // We look for any container matching the ASIN, but EXCLUDE anything inside carousels
    const asinSelectors = [
      `#centerCol [data-csa-c-asin="${asin}"]`,
      `#rightCol [data-csa-c-asin="${asin}"]`,
      `[data-csa-c-asin="${asin}"]:not([class*="carousel"])`,
    ];

    for (const selector of asinSelectors) {
      const container = document.querySelector(selector);
      if (!container) continue;

      // Try offscreen first (cleanest data)
      const offscreen = container.querySelector(".a-offscreen, .aok-offscreen");
      if (offscreen) {
        const price = extractPriceNumber(offscreen.textContent);
        if (price) return price;
      }

      // Try the broken up price (whole + fraction)
      const whole = container.querySelector(SELECTORS.priceWhole);
      if (whole) {
        const price = combinePriceParts(whole);
        if (price) return price;
      }
    }

    // 4. FALLBACK: Check common containers but ensure they are in the upper page
    for (const selector of SELECTORS.priceContainers) {
      const container = document.querySelector(selector);
      if (!container) continue;

      // Skip if this container is deep down in "Sponsored" or "Related" sections
      if (
        container.closest("#sims-consolidated-2_feature_div") ||
        container.closest(".a-carousel-container")
      ) {
        continue;
      }

      const priceSpan =
        container.querySelector(".a-offscreen, .aok-offscreen") ||
        container.querySelector(SELECTORS.priceWhole);

      if (priceSpan) {
        const price = priceSpan.classList.contains("a-price-whole")
          ? combinePriceParts(priceSpan)
          : extractPriceNumber(priceSpan.textContent);
        if (price) return price;
      }
    }

    return null;
  }

  function extractFromFormatTabs() {
    const formatTabs = document.querySelectorAll(SELECTORS.formatTabs);

    for (const tab of formatTabs) {
      const container = tab.closest("[data-feature-name]") || tab.parentElement;
      if (!container) continue;

      const priceSpan = container.querySelector(SELECTORS.priceWhole);
      if (priceSpan) {
        const price = combinePriceParts(priceSpan);
        if (price) return price;
      }
    }
    return null;
  }

  function extractFromUpperViewport() {
    const allPriceSpans = document.querySelectorAll(SELECTORS.priceWhole);

    for (const span of allPriceSpans) {
      if (isInUpperViewport(span)) {
        const price = combinePriceParts(span);
        if (price) return price;
      }
    }
    return null;
  }

  function extractFirstValidPrice() {
    const allPriceSpans = document.querySelectorAll(SELECTORS.priceWhole);

    for (const span of allPriceSpans) {
      const price = combinePriceParts(span);
      if (price) {
        console.log("[QB] Locking first valid fallback price:", price);
        return price; // <--- CRITICAL: Stop the loop here!
      }
    }

    const offscreenPrices = document.querySelectorAll(SELECTORS.priceOffscreen);
    for (const el of offscreenPrices) {
      const price = extractPriceNumber(el.textContent);
      if (price) return price; // Stop here
    }

    return null;
  }

  // ==========================================
  // MAIN EXTRACTION FUNCTION
  // ==========================================

  function extractProductData() {
    if (!isProductPage()) return null;

    const asin = extractASIN();
    if (!asin) return null;

    const name = extractProductName();
    if (!name) return null;

    let currency = detectCurrencyFromPrices() || getCurrency();

    if (validators.validateCurrency) {
      currency = validators.validateCurrency(currency);
    }

    const price = extractPrice();
    if (!price) return null;

    const image = extractProductImage();

    return {
      name: validators.sanitizeString ? validators.sanitizeString(name) : name,
      asin,
      price,
      currency,
      image,
    };
  }

  // ==========================================
  // MESSAGE LISTENER - ON-DEMAND EXTRACTION
  // ==========================================

  console.log("[QB Amazon Injector] Ready - waiting for extraction request");

  // Listen for extraction requests from content script
  window.addEventListener("message", (event) => {
    // Only listen to requests from same window
    if (event.source !== window) return;
    if (event.data?.source !== "quickbasket-content-amazon") return;
    if (event.data?.action !== "extractProduct") return;

    console.log("[QB Amazon Injector] Extraction requested");

    try {
      const product = extractProductData();

      if (product) {
        console.log(
          "[QB Amazon Injector] Product extracted:",
          product.name.substring(0, 50)
        );

        // Send product data back to content script
        window.postMessage(
          {
            source: "quickbasket-injected-amazon",
            type: "PRODUCT_EXTRACTED",
            product,
            url: window.location.href,
            timestamp: Date.now(),
          },
          window.location.origin
        );
      } else {
        console.log("[QB Amazon Injector] Could not extract product");

        // Send failure message
        window.postMessage(
          {
            source: "quickbasket-injected-amazon",
            type: "EXTRACTION_FAILED",
            error: "Could not find product information on this page",
            timestamp: Date.now(),
          },
          window.location.origin
        );
      }
    } catch (error) {
      console.error("[QB Amazon Injector] Extraction error:", error);

      // Send error message
      window.postMessage(
        {
          source: "quickbasket-injected-amazon",
          type: "EXTRACTION_ERROR",
          error: error.message,
          timestamp: Date.now(),
        },
        window.location.origin
      );
    }
  });
})();
