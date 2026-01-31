/**
 * QuickBasket AI - Configuration & Constants (Optimized)
 */
(function () {
  "use strict";
  // ==========================================
  // APPLICATION SETTINGS
  // ==========================================
  const APP_CONFIG = Object.freeze({
    NAME: "QuickBasket AI",
    VERSION: "0.1.0",
    ENVIRONMENT: "development",
  });

  // ==========================================
  // BACKEND API SETTINGS
  // ==========================================
  const API = Object.freeze({
    BASE_URL: "http://127.0.0.1:8000",
    ROUTES: Object.freeze({
      TRACK_BROWSER: "/api/v1/track/browser",
      ALERTS_PENDING: "/api/v1/alerts/pending",
      ALERT_ACK: (id) => `/api/v1/alerts/${encodeURIComponent(id)}/ack`,
    }),
    TIMEOUT_MS: 15000,
    POLL_INTERVAL_MINUTES: 2,
    USER_AGENT: "QuickBasketAI-Extension/0.1.0",
  });

  // ==========================================
  // VALIDATION LIMITS
  // ==========================================
  const LIMITS = Object.freeze({
    MAX_PRODUCT_NAME_LENGTH: 500,
    MIN_PRODUCT_NAME_LENGTH: 3,
    MAX_PRICE: 1000000,
    MIN_PRICE: 0.01,
    ASIN_LENGTH: 10,
    SKU_MIN_LENGTH: 3,
    SKU_MAX_LENGTH: 30,
    MAX_PRODUCTS: 100,
    STORAGE_QUOTA_BYTES: 5242880,
    MAX_SEARCH_RESULTS: 50,
    PRODUCT_IMAGE_MAX_HEIGHT: 180,
  });

  // ==========================================
  // TIMING CONSTANTS (milliseconds)
  // ==========================================
  const TIMING = Object.freeze({
    POPUP_CLOSE_DELAY: 1500,
    POPUP_STATUS_DURATION: 3000,
    PRICE_CHECK_INITIAL_DELAY: 3000,
    PRICE_CHECK_INTERVAL: 3600000,
    PRICE_CHECK_RETRY_DELAY: 60000,
    INJECT_INITIAL_DELAY: 3000,
    INJECT_RETRY_DELAY: 500,
    URL_CHECK_INTERVAL: 500,
    URL_MONITOR_CLEANUP: 300000,
    NOTIFICATION_DURATION: 5000,
  });

  // ==========================================
  // MARKETPLACES
  // ==========================================
  const MARKETPLACES = Object.freeze({
    AMAZON: Object.freeze({
      id: "amazon",
      name: "Amazon",
      domains: Object.freeze([
        "amazon.com",
        "amazon.ca",
        "amazon.co.uk",
        "amazon.de",
        "amazon.fr",
        "amazon.it",
        "amazon.es",
        "amazon.ae",
        "amazon.eg",
        "amazon.sa",
        "amazon.in",
        "amazon.co.jp",
        "amazon.com.br",
        "amazon.com.mx",
        "amazon.com.au",
      ]),
      urlPatterns: Object.freeze([
        /\/dp\/[A-Z0-9]{10}/,
        /\/gp\/product\/[A-Z0-9]{10}/,
      ]),
    }),
    NOON: Object.freeze({
      id: "noon",
      name: "Noon",
      domains: Object.freeze(["noon.com"]),
      urlPatterns: Object.freeze([/\/p\//]),
    }),
  });

  // ==========================================
  // CURRENCIES
  // ==========================================
  const CURRENCIES = new Map([
    ["USD", { code: "USD", symbol: "$", name: "US Dollar" }],
    ["CAD", { code: "CAD", symbol: "C$", name: "Canadian Dollar" }],
    ["GBP", { code: "GBP", symbol: "£", name: "British Pound" }],
    ["EUR", { code: "EUR", symbol: "€", name: "Euro" }],
    ["SEK", { code: "SEK", symbol: "kr", name: "Swedish Krona" }],
    ["PLN", { code: "PLN", symbol: "zł", name: "Polish Złoty" }],
    ["AED", { code: "AED", symbol: "د.إ", name: "UAE Dirham" }],
    ["SAR", { code: "SAR", symbol: "ر.س", name: "Saudi Riyal" }],
    ["KWD", { code: "KWD", symbol: "د.ك", name: "Kuwaiti Dinar" }],
    ["QAR", { code: "QAR", symbol: "ر.ق", name: "Qatari Riyal" }],
    ["BHD", { code: "BHD", symbol: "د.ب", name: "Bahraini Dinar" }],
    ["OMR", { code: "OMR", symbol: "ر.ع", name: "Omani Rial" }],
    ["EGP", { code: "EGP", symbol: "ج.م", name: "Egyptian Pound" }],
    ["JPY", { code: "JPY", symbol: "¥", name: "Japanese Yen" }],
    ["INR", { code: "INR", symbol: "₹", name: "Indian Rupee" }],
    ["SGD", { code: "SGD", symbol: "S$", name: "Singapore Dollar" }],
    ["AUD", { code: "AUD", symbol: "A$", name: "Australian Dollar" }],
    ["BRL", { code: "BRL", symbol: "R$", name: "Brazilian Real" }],
    ["MXN", { code: "MXN", symbol: "Mex$", name: "Mexican Peso" }],
    ["TRY", { code: "TRY", symbol: "₺", name: "Turkish Lira" }],
    ["ZAR", { code: "ZAR", symbol: "R", name: "South African Rand" }],
  ]);

  const VALID_CURRENCY_CODES = Object.freeze(Array.from(CURRENCIES.keys()));

  // ==========================================
  // MESSAGE TYPES
  // ==========================================
  const MESSAGE_TYPES = Object.freeze({
    AMAZON_PRODUCT: "AMAZON_PRODUCT",
    NOON_PRODUCT: "NOON_PRODUCT",
    TRACK_PRODUCT: "trackProduct",
    GET_PRODUCT_INFO: "getProductInfo",
    UPDATE_PRICE: "updatePrice",
    PRODUCT_TRACKED: "productTracked",
    PRICE_UPDATED: "priceUpdated",
    PRICE_DROP_ALERT: "priceDropAlert",
    AI_INSIGHT: "aiInsight",
  });

  // ==========================================
  // STORAGE KEYS
  // ==========================================
  const STORAGE_KEYS = Object.freeze({
    TRACKED_PRODUCTS: "trackedProducts",
    USER_SETTINGS: "userSettings",
    PRICE_HISTORY: "priceHistory",
    ALERTS: "alerts",
    LAST_CHECK: "lastCheck",
    BACKEND_MAP: "backendMap",
  });

  // ==========================================
  // MESSAGES
  // ==========================================
  const ERROR_MESSAGES = Object.freeze({
    INVALID_URL: "Not a valid product page",
    UNSUPPORTED_MARKETPLACE: "Not on a supported marketplace",
    PRODUCT_NOT_FOUND: "Could not find product information",
    STORAGE_QUOTA_EXCEEDED:
      "Storage limit reached. Please remove some products.",
    TRACKING_FAILED: "Failed to track product",
    PRICE_UPDATE_FAILED: "Failed to update price",
    INVALID_PRODUCT_DATA: "Invalid product data",
    NETWORK_ERROR: "Network error. Please try again.",
  });

  const SUCCESS_MESSAGES = Object.freeze({
    PRODUCT_TRACKED: "Product tracked successfully!",
    PRODUCT_REMOVED: "Product removed from tracking",
    PRICE_UPDATED: "Price updated successfully",
    DATA_EXPORTED: "Data exported successfully",
  });

  // ==========================================
  // REGEX PATTERNS
  // ==========================================
  const PATTERNS = Object.freeze({
    ASIN: /^[A-Z0-9]{10}$/,
    SKU: /^[A-Z0-9]{3,30}$/i,
    PRICE: /^\d+(\.\d{2})?$/,
    SCRIPT_TAG: /<script[^>]*>.*?<\/script>/gi,
    IFRAME_TAG: /<iframe[^>]*>.*?<\/iframe>/gi,
    OBJECT_TAG: /<object[^>]*>.*?<\/object>/gi,
    EMBED_TAG: /<embed[^>]*>/gi,
    HTML_TAG: /<[^>]+>/g,
    JAVASCRIPT_PROTOCOL: /javascript:/gi,
    EVENT_HANDLER: /on\w+\s*=/gi,
    DATA_HTML: /data:text\/html/gi,
  });

  // ==========================================
  // DEFAULT SETTINGS
  // ==========================================
  const DEFAULT_SETTINGS = Object.freeze({
    notifications: Object.freeze({
      enabled: true,
      priceDropOnly: false,
      sound: false,
    }),
    priceCheck: Object.freeze({
      interval: TIMING.PRICE_CHECK_INTERVAL,
      autoUpdate: true,
    }),
    ui: Object.freeze({
      theme: "dark",
      compactView: false,
      showPercentage: true,
    }),
    alerts: Object.freeze({
      priceDropThreshold: 5,
      customTargetPrice: null,
    }),
  });

  // ==========================================
  // EXPORT
  // ==========================================
  const config = Object.freeze({
    APP_CONFIG,
    API,
    LIMITS,
    TIMING,
    MARKETPLACES,
    CURRENCIES,
    VALID_CURRENCY_CODES,
    MESSAGE_TYPES,
    STORAGE_KEYS,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES,
    PATTERNS,
    DEFAULT_SETTINGS,
  });

  self.QB_CONFIG = config;
})();
