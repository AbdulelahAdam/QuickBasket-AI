(function () {
  "use strict";

  if (window.__QB_AMAZON_HOOKED__) return;
  window.__QB_AMAZON_HOOKED__ = true;

  const config = window.QB_CONFIG || {};
  const validators = window.QB_VALIDATORS || {};

  const PRODUCT_URL_PATTERN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;

  const DOMAIN_CURRENCY_MAP = [
    [".co.uk", "GBP"],
    [".co.jp", "JPY"],
    [".com.br", "BRL"],
    [".com.mx", "MXN"],
    [".com.tr", "TRY"],
    [".com.be", "EUR"],
    [".com.au", "AUD"],

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

    [".de", "EUR"],
    [".fr", "EUR"],
    [".es", "EUR"],
    [".it", "EUR"],
    [".nl", "EUR"],
    [".ie", "EUR"],
  ];

  const SELECTORS = {
    productTitle: [
      "#productTitle",
      'h1[data-feature-name="title"]',
      'span[id="productTitle"]',
      '[data-feature-name="title"] h1',
    ],
    priceWhole: ".a-price-whole",
    priceFraction: ".a-price-fraction",
    priceOffscreen: ".a-price .a-offscreen",
    priceContainers: [
      "#corePriceDisplay_desktop_feature_div",
      "#corePrice_desktop",
      "#apex_desktop",
      "#buyBoxAccordion",
      "#newAccordionRow",
      "#price_inside_buybox",
    ],
    buyingOptions: [
      "tmmSwatches .swatchElement.selected .a-button-text",
      "tmmSwatches .swatchElement.selected",
    ],
  };

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

  let currentASIN = null;

  function extractASIN() {
    const match = window.location.href.match(PRODUCT_URL_PATTERN);
    if (!match) return null;

    currentASIN = match[1];
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
    const mainImage = document.querySelector("#landingImage, #imgBlkFront");
    if (mainImage?.src && isValidImageUrl(mainImage.src)) {
      console.log("[QB Amazon] Found main product image");
      return mainImage.src;
    }

    const imageBlock = document.querySelector(
      "#ebooksImgBlkFront, #main-image"
    );
    if (imageBlock?.src && isValidImageUrl(imageBlock.src)) {
      console.log("[QB Amazon] Found image block");
      return imageBlock.src;
    }

    const dynamicImageContainer = document.querySelector(
      "#imageBlock, #imgTagWrapperId"
    );
    if (dynamicImageContainer) {
      const dynamicImage = dynamicImageContainer.querySelector(
        "img.a-dynamic-image"
      );
      if (dynamicImage?.src && isValidImageUrl(dynamicImage.src)) {
        console.log("[QB Amazon] Found dynamic image");
        return dynamicImage.src;
      }
    }

    const imageBlockImages = document.querySelectorAll(
      "#imageBlock img, #imgTagWrapperId img, #altImages img"
    );

    for (const img of imageBlockImages) {
      if (img.src && isValidImageUrl(img.src)) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          console.log("[QB Amazon] Found valid image in image block");
          return img.src;
        }
      }
    }

    const dynamicImages = document.querySelectorAll("[data-a-dynamic-image]");
    for (const img of dynamicImages) {
      try {
        const dynamicData = JSON.parse(
          img.getAttribute("data-a-dynamic-image")
        );
        const urls = Object.keys(dynamicData);

        if (urls.length > 0 && isValidImageUrl(urls[0])) {
          const largestUrl = urls.reduce((largest, current) => {
            const [w1, h1] = dynamicData[largest];
            const [w2, h2] = dynamicData[current];
            return w2 * h2 > w1 * h1 ? current : largest;
          });

          console.log("[QB Amazon] Found image from dynamic data");
          return largestUrl;
        }
      } catch {
        continue;
      }
    }

    console.warn("[QB Amazon] Could not find valid product image");
    return null;
  }

  function isValidImageUrl(url) {
    if (!url || typeof url !== "string") return false;

    if (!url.startsWith("https://")) return false;

    if (
      !url.includes("media-amazon.com") &&
      !url.includes("ssl-images-amazon.com")
    ) {
      return false;
    }

    const rejectPatterns = [
      "transparent-pixel",
      "1x1",
      "data:image",
      "prime-logo",
      "amazon-logo",
      "badge",
      "icon",
      "/G/",
      "_SS40_",
      "_SX38_",
    ];

    for (const pattern of rejectPatterns) {
      if (url.includes(pattern)) {
        console.log(`[QB Amazon] Rejected image: ${pattern}`);
        return false;
      }
    }

    return true;
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

    let cleanText = text.replace(/,(?=\d{3})/g, "");

    let result = null;
    if (validators.sanitizePrice) {
      result = validators.sanitizePrice(cleanText);
    } else {
      const numericOnly = cleanText.replace(/[^\d.]/g, "");
      result = parseFloat(numericOnly) > 0 ? numericOnly : null;
    }

    if (result) {
      console.log("[QB Amazon] Price sanitized:", result);
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

  function extractPrice() {
    let price = extractFromPriceContainers();
    if (price) {
      console.log("[QB Amazon] Found primary BuyBox price:", price);
      return price;
    }

    price = extractFromBuyingOptions();
    if (price) return price;

    const offscreenPrices = document.querySelectorAll(SELECTORS.priceOffscreen);
    for (const el of offscreenPrices) {
      const closestContainer = el.closest(
        "#corePriceDisplay_desktop_feature_div, #corePrice_desktop, #buyBoxAccordion, [data-csa-c-asin]"
      );
      if (!closestContainer) continue;

      if (
        closestContainer.closest(
          ".a-carousel-container, #sims-consolidated-2_feature_div"
        )
      )
        continue;

      price = extractPriceNumber(el.textContent);
      if (price) {
        console.log(
          "[QB Amazon] Found offscreen price from main product:",
          price
        );
        return price;
      }
    }
    console.log(
      "[QB Amazon] Could not extract price from main product container"
    );
    return null;
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

  function extractFromPriceContainers() {
    const asin = extractASIN();
    if (!asin) return null;

    const primaryBox =
      document.getElementById("corePriceDisplay_desktop_feature_div") ||
      document.getElementById("corePrice_desktop") ||
      document.getElementById("apex_desktop");

    if (primaryBox) {
      const offscreen = primaryBox.querySelector(
        ".aok-offscreen, .a-offscreen"
      );
      if (offscreen && offscreen.textContent.trim()) {
        const price = extractPriceNumber(offscreen.textContent);
        if (price) {
          console.log("[QB Amazon] Found locked BuyBox price:", price);
          return price;
        }
      }
    }

    const asinSelectors = [
      `#centerCol [data-csa-c-asin="${asin}"]`,
      `#rightCol [data-csa-c-asin="${asin}"]`,
      `[data-csa-c-asin="${asin}"]:not([class*="carousel"])`,
    ];

    for (const selector of asinSelectors) {
      const container = document.querySelector(selector);
      if (!container) continue;

      const offscreen = container.querySelector(".a-offscreen, .aok-offscreen");
      if (offscreen) {
        const price = extractPriceNumber(offscreen.textContent);
        if (price) return price;
      }

      const whole = container.querySelector(SELECTORS.priceWhole);
      if (whole) {
        const price = combinePriceParts(whole);
        if (price) return price;
      }
    }

    for (const selector of SELECTORS.priceContainers) {
      const container = document.querySelector(selector);
      if (!container) continue;

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

  function detectAvailability() {
    const availabilitySection = document.querySelector("#availability");
    if (availabilitySection) {
      const availText = availabilitySection.textContent.toLowerCase();
      if (
        availText.includes("currently unavailable") ||
        availText.includes("out of stock") ||
        availText.includes("temporarily out of stock")
      ) {
        console.log(
          "[QB Amazon] Product is OUT OF STOCK (from availability section)"
        );
        return "out_of_stock";
      }
    }
    const addToCartBtn = document.querySelector("#add-to-cart-button");
    if (!addToCartBtn) {
      console.log(
        "[QB Amazon] No add to cart button found - product unavailable"
      );
      return "out_of_stock";
    }

    if (addToCartBtn.disabled) {
      console.log("[QB Amazon] Add to cart button is disabled - unavailable");
      return "out_of_stock";
    }

    console.log("[QB Amazon] Product appears to be in stock");
    return "in_stock";
  }

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

    const availability = detectAvailability();

    let price = null;
    if (availability === "in_stock") {
      price = extractPrice();
      if (!price) {
        console.log(
          "[QB Amazon] Product is in stock but no price found - this is unusual"
        );
      }
    } else {
      console.log(
        "[QB Amazon] Product is unavailable, skipping price extraction"
      );
    }

    const image = extractProductImage();

    return {
      name: validators.sanitizeString ? validators.sanitizeString(name) : name,
      asin,
      price: price || null,
      currency,
      image,
      availability,
    };
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source !== "quickbasket-content-amazon") return;
    if (event.data?.action !== "extractProduct") return;

    try {
      const product = extractProductData();

      if (product) {
        console.log(
          "[QB Amazon] Product extracted:",
          product.name.substring(0, 50)
        );

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
        console.log("[QB Amazon] Could not extract product");

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
      console.error("[QB Amazon] Extraction error:", error);

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

  window.extractProductData = extractProductData;
})();
