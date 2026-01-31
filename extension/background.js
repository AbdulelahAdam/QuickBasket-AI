/**
 * QuickBasket AI - Background Service Worker
 * NOW CONNECTED TO BACKEND:
 * - POST snapshot to backend
 * - Receive AI insight
 * - Poll alerts
 * - Chrome notifications
 */

importScripts("config.js");
const QB = self.QB_CONFIG;

console.log("[QB Background] Service worker initialized");

const CONFIG = {
  STORAGE_KEY: QB.STORAGE_KEYS.TRACKED_PRODUCTS,
  BACKEND_MAP_KEY: QB.STORAGE_KEYS.BACKEND_MAP,
  MAX_PRODUCTS: QB.LIMITS.MAX_PRODUCTS,

  ALERTS_ALARM: "qb_poll_alerts",
  ALERTS_POLL_MINUTES: QB.API.POLL_INTERVAL_MINUTES,

  REQUEST_TIMEOUT_MS: QB.API.TIMEOUT_MS,
};

function nowIso() {
  return new Date().toISOString();
}

// =============================
// Hardened fetch wrapper
// =============================
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.REQUEST_TIMEOUT_MS
  );

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Client": "quickbasket-extension",
        "X-Client-Version": QB.APP_CONFIG.VERSION,
        "User-Agent": QB.API.USER_AGENT,
        ...(options.headers || {}),
      },
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (data && (data.detail || data.error || data.message)) ||
        `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// =============================
// Marketplace detection
// =============================
function detectMarketplace(url) {
  if (url.includes("amazon.")) return "amazon";
  if (url.includes("noon.")) return "noon";
  return "unknown";
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function generateProductId(url) {
  try {
    const urlObj = new URL(url);

    const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asinMatch) return `amazon_${asinMatch[1]}`;

    const noonMatch = url.match(/\/([A-Z0-9]+)\/p\//);
    if (noonMatch) return `noon_${noonMatch[1]}`;

    return `product_${simpleHash(urlObj.pathname)}`;
  } catch {
    return `product_${simpleHash(url)}`;
  }
}

// =============================
// Notification
// =============================
function showNotification(title, message, notificationId) {
  try {
    chrome.notifications.create(notificationId || `qb_${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: 2,
      requireInteraction: false,
    });
  } catch (e) {
    console.error("[QB Background] Notification error:", e);
  }
}

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  chrome.notifications.clear(notificationId);
});

// =============================
// Storage helpers
// =============================
async function getTrackedProducts() {
  const result = await chrome.storage.local.get([CONFIG.STORAGE_KEY]);
  return result[CONFIG.STORAGE_KEY] || [];
}

async function setTrackedProducts(products) {
  await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: products });
}

async function getBackendMap() {
  const result = await chrome.storage.local.get([CONFIG.BACKEND_MAP_KEY]);
  return result[CONFIG.BACKEND_MAP_KEY] || {};
}

async function setBackendMap(map) {
  await chrome.storage.local.set({ [CONFIG.BACKEND_MAP_KEY]: map });
}

// =============================
// Normalize product payload
// =============================
function normalizeProductPayload(url, product) {
  const marketplace = detectMarketplace(url);

  const title = (product?.name || "").trim();
  const price = Number(product?.price || 0);
  const currency = (product?.currency || "USD").trim();
  const image_url = product?.image || null;

  const sku =
    product?.sku || (marketplace === "amazon" ? product?.asin : null) || null;

  if (!title || !Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid product payload (title/price missing)");
  }

  return {
    url,
    marketplace,
    title,
    price_raw: `${currency} ${price}`,
    image_url,
    sku,
    client: {
      source: "extension",
      version: QB.APP_CONFIG.VERSION,
      ts: nowIso(),
    },
  };
}

// =============================
// Send snapshot to backend
// =============================
async function sendSnapshotToBackend(payload) {
  const url = `${QB.API.BASE_URL}${QB.API.ROUTES.TRACK_BROWSER}`;
  return await fetchJson(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// =============================
// Track product handler
// =============================
async function handleTrackProduct(message) {
  const { url, product } = message;

  if (!url) throw new Error("No URL provided");

  const productId = generateProductId(url);
  const marketplace = detectMarketplace(url);

  const trackedProducts = await getTrackedProducts();
  const existingIndex = trackedProducts.findIndex((p) => p.id === productId);

  const localEntry = {
    id: productId,
    name: product?.name || "Unknown Product",
    marketplace,
    currentPrice: product?.price || 0,
    originalPrice: product?.price || 0,
    currency: product?.currency || "USD",
    priceChange: 0,
    url,
    lastUpdated: Date.now(),
    image: product?.image || null,
  };

  if (existingIndex !== -1)
    trackedProducts[existingIndex] = {
      ...trackedProducts[existingIndex],
      ...localEntry,
    };
  else {
    if (trackedProducts.length >= CONFIG.MAX_PRODUCTS) {
      throw new Error(`Maximum ${CONFIG.MAX_PRODUCTS} products reached.`);
    }
    trackedProducts.push(localEntry);
  }

  await setTrackedProducts(trackedProducts);

  const payload = normalizeProductPayload(url, product);
  console.log("[QB Background] Sending snapshot to backend:", payload);

  let backendResult = null;
  try {
    backendResult = await sendSnapshotToBackend(payload);
    console.log("[QB Background] Backend response:", backendResult);
  } catch (e) {
    console.error("[QB Background] Backend track failed:", e);
    showNotification(
      "QuickBasket AI",
      `Backend error: ${e.message}`,
      `qb_err_${Date.now()}`
    );
    return {
      success: true,
      productId,
      backend: { success: false, error: e.message },
    };
  }

  const backendMap = await getBackendMap();
  backendMap[productId] = {
    tracked_product_id: backendResult?.tracked_product_id ?? null,
    last_snapshot_id: backendResult?.snapshot_id ?? null,
    last_synced_at: Date.now(),
  };
  await setBackendMap(backendMap);

  const ai = backendResult?.ai || null;
  if (ai?.summary) {
    showNotification(
      "QuickBasket AI Insight",
      ai.summary,
      `qb_ai_${productId}_${Date.now()}`
    );
  } else {
    showNotification(
      "Product Tracked",
      `Now tracking: ${(product?.name || "Product").substring(0, 50)}`,
      `qb_track_${productId}_${Date.now()}`
    );
  }

  setupAlertsPolling();

  return {
    success: true,
    productId,
    backend: { success: true, data: backendResult },
  };
}

// =============================
// Alerts polling
// =============================
function setupAlertsPolling() {
  chrome.alarms.create(CONFIG.ALERTS_ALARM, {
    periodInMinutes: CONFIG.ALERTS_POLL_MINUTES,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONFIG.ALERTS_ALARM) pollBackendAlerts();
});

async function pollBackendAlerts() {
  try {
    const url = `${QB.API.BASE_URL}${QB.API.ROUTES.ALERTS_PENDING}?source=extension`;
    const alerts = await fetchJson(url, { method: "GET" });

    if (!Array.isArray(alerts) || alerts.length === 0) return;

    console.log("[QB Background] Alerts received:", alerts);

    for (const alert of alerts) {
      const id = alert.id ?? `alert_${Date.now()}`;

      const title = alert.title || "QuickBasket AI";
      const msg = alert.message || alert.type || "Price update";

      showNotification("QuickBasket AI", `${title}: ${msg}`, `qb_alert_${id}`);

      try {
        const ackUrl = `${QB.API.BASE_URL}${QB.API.ROUTES.ALERT_ACK(id)}`;
        await fetchJson(ackUrl, {
          method: "POST",
          body: JSON.stringify({ source: "extension" }),
        });
      } catch (e) {
        console.warn("[QB Background] Failed to ack alert:", id, e.message);
      }
    }
  } catch (e) {
    console.warn("[QB Background] Alerts polling failed:", e.message);
  }
}

// =============================
// Messages
// =============================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[QB Background] Received message:", message.action);

  if (message.action === "trackProduct") {
    handleTrackProduct(message)
      .then(sendResponse)
      .catch((error) => {
        console.error("[QB Background] Track error:", error);
        sendResponse({
          success: false,
          error: error.message || "Failed to track product",
        });
      });
    return true;
  }

  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// =============================
// Install
// =============================
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[QB Background] Installed/updated:", details.reason);

  if (details.reason === "install") {
    chrome.storage.local.set({
      [CONFIG.STORAGE_KEY]: [],
      [CONFIG.BACKEND_MAP_KEY]: {},
    });
  }

  setupAlertsPolling();
});

console.log("[QB Background] Ready");
