(function () {
  "use strict";

  if (window.__QB_NOON_HOOKED__) return;
  window.__QB_NOON_HOOKED__ = true;

  const config = window.QB_CONFIG || {};
  const validators = window.QB_VALIDATORS || {};

  const PRODUCT_URL_PATTERN = /\/([A-Z0-9]+)\/p\//;

  const REGION_CURRENCY_MAP = {
    saudi: "SAR",
    uae: "AED",
    kuwait: "KWD",
    qatar: "QAR",
    bahrain: "BHD",
    oman: "OMR",
    egypt: "EGP",
  };

  const DOMAIN_CURRENCY_MAP = {
    ".sa": "SAR",
    ".ae": "AED",
    ".kw": "KWD",
    ".qa": "QAR",
    ".bh": "BHD",
    ".om": "OMR",
  };

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

  const isProductPage = () => window.location.href.includes("/p/");

  function getCurrency() {
    const url = window.location.href;

    const regionMatch = url.match(/noon\.com\/([a-z]+)-[a-z]{2}/);
    if (regionMatch) {
      const region = regionMatch[1];
      const currency = REGION_CURRENCY_MAP[region];
      if (currency) return currency;
    }

    for (const [domain, currency] of Object.entries(DOMAIN_CURRENCY_MAP)) {
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
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of selectorArray) {
      try {
        const el = document.querySelector(selector);
        if (el?.textContent?.trim()) return el;
      } catch {
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
    const swiperActive = document.querySelector(".swiper-slide-active img");
    if (swiperActive?.src && isValidImageUrl(swiperActive.src)) {
      console.log("[QB Noon] Found swiper active image");
      return swiperActive.src;
    }

    const productImageQA = document.querySelector(
      '[data-qa="product-image"] img'
    );
    if (productImageQA?.src && isValidImageUrl(productImageQA.src)) {
      console.log("[QB Noon] Found data-qa product image");
      return productImageQA.src;
    }

    const galleryImages = document.querySelectorAll(
      '.swiper-wrapper img, [class*="imageGallery"] img, [class*="productImage"] img'
    );

    for (const img of galleryImages) {
      if (img.src && isValidImageUrl(img.src)) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 150 && rect.height > 150) {
          console.log("[QB Noon] Found valid gallery image");
          return img.src;
        }
      }
    }

    const pictureElement = document.querySelector("picture img");
    if (pictureElement?.src && isValidImageUrl(pictureElement.src)) {
      const rect = pictureElement.getBoundingClientRect();
      if (rect.width > 150 && rect.height > 150) {
        console.log("[QB Noon] Found picture element image");
        return pictureElement.src;
      }
    }

    const productImages = document.querySelectorAll(
      'img[alt*="Product"], img[alt*="product"], [class*="product"] img'
    );

    for (const img of productImages) {
      if (img.src && isValidImageUrl(img.src)) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
          console.log("[QB Noon] Found product-related image");
          return img.src;
        }
      }
    }

    console.warn("[QB Noon] Could not find valid product image");
    return null;
  }
  function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;

    if (!url.startsWith("https://")) return false;

    if (!url.includes("noon.com") && !url.includes("nooncdn.com")) {
      return false;
    }

    const rejectPatterns = [
      "logo", // Noon logo
      "icon", // Icons
      "badge", // Badges
      "banner", // Ad banners (THIS WAS THE BUG!)
      "placeholder", // Placeholder images
      "avatar", // User avatars
      "sprite", // Icon sprites
      "1x1", // Tracking pixels
      "data:image", // Data URIs
      "/ads/", // Ad images
      "/promotional/", // Promotional banners
      "_thumb", // Thumbnails
      "_small", // Small images
      "w=50", // Query param for tiny images
      "w=100", // Query param for small images
    ];

    for (const pattern of rejectPatterns) {
      if (url.toLowerCase().includes(pattern.toLowerCase())) {
        console.log(`[QB Noon] Rejected image: ${pattern}`);
        return false;
      }
    }

    return true;
  }

  function extractPrice() {
    const priceEl = safeQuerySelector(SELECTORS.price);
    if (!priceEl) return null;

    const text = priceEl.textContent;

    const currencyMatch = text.match(/\b(EGP|SAR|AED|KWD|QAR|BHD|OMR)\b/i);
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

  function detectAvailability() {
    const outOfStockSelectors = [
      '[data-qa="out-of-stock"]',
      ".outOfStock",
      '[class*="outOfStock"]',
    ];

    for (const selector of outOfStockSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        console.log("[QB Noon] Product is OUT OF STOCK");
        return "out_of_stock";
      }
    }

    const addToCartBtn = document.querySelector(
      '[data-qa="add-to-cart"], [class*="addToCart"]'
    );
    if (addToCartBtn && addToCartBtn.disabled) {
      console.log("[QB Noon] Add to cart disabled - out of stock");
      return "out_of_stock";
    }

    const bodyText = document.body.textContent.toLowerCase();
    if (
      bodyText.includes("out of stock") ||
      bodyText.includes("currently unavailable") ||
      bodyText.includes("not available")
    ) {
      console.log("[QB Noon] Found out of stock text");
      return "out_of_stock";
    }

    return "in_stock";
  }

  function extractProductData() {
    if (!isProductPage()) return null;

    const sku = extractSKU();
    if (!sku) return null;

    const name = extractProductName();
    if (!name) return null;

    const availability = detectAvailability();

    const priceData = extractPrice();
    if (!priceData && availability === "in_stock") {
      console.log("[QB Noon] No price found but product shows as in stock");
      return null;
    }

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
      price: price || null,
      currency,
      image,
      availability,
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "quickbasket-content-noon") return;
    if (event.data?.action !== "extractProduct") return;

    try {
      const product = extractProductData();

      if (product) {
        console.log(
          "[QB Noon] Product extracted:",
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
        console.log("[QB Noon] Could not extract product");

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
      console.error("[QB Noon] Extraction error:", error);

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
  window.extractProductData = extractProductData;
})();
