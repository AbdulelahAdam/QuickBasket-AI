importScripts("config.js");
const QB = self.QB_CONFIG;

console.log("[QB] Service worker initialized");

const CONFIG = {
  STORAGE_KEY: QB.STORAGE_KEYS.TRACKED_PRODUCTS,
  BACKEND_MAP_KEY: QB.STORAGE_KEYS.BACKEND_MAP,
  MAX_PRODUCTS: 50,
  ALERTS_ALARM: "qb_poll_alerts",
  ALERTS_POLL_MINUTES: QB.API.POLL_INTERVAL_MINUTES,
  REQUEST_TIMEOUT_MS: QB.API.TIMEOUT_MS,

  MAX_CONCURRENT_SCRAPES: 3, // Process 3 products simultaneously
  SCRAPE_TIMEOUT_MS: 45000, // Kill stuck scrapes after 45s
  TAB_CLEANUP_DELAY_MS: 2000, // Wait 2s before closing tab. Ensure backend sync
  RETRY_DELAY_MS: 300000, // 5 min retry for failed scrapes
};

const API_BASE =
  "https://international-janeen-quickbasket-ai-8d2d28b7.koyeb.app";

const nowIso = () => new Date().toISOString();

// Helper to get token from session storage first, then fall back to local storage
async function getStoredToken() {
  let storage = await chrome.storage.session.get(["supabase_session"]);
  if (storage.supabase_session) {
    return storage.supabase_session;
  }
  // Fallback to local storage for backwards compatibility
  storage = await chrome.storage.local.get(["supabase_session"]);
  return storage.supabase_session || null;
}

function broadcastOnlineStatus(online) {
  chrome.runtime
    .sendMessage({
      action: "connectivityStatus",
      online: online,
    })
    .catch(() => {
      // Dashboard might not be open.
    });
}

async function enableResourceBlocking() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "*",
            resourceTypes: ["image", "media", "font", "stylesheet"],
            excludedInitiatorDomains: [chrome.runtime.getURL("")],
          },
        },
      ],
    });
    console.log("[QB] Resource blocking enabled");
  } catch (e) {
    console.warn(e.message);
  }
}

async function disableResourceBlocking() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
    });
  } catch (e) {
    console.warn("[QB] Could not disable resource blocking:", e.message);
  }
}

async function clearAllDynamicRules() {
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map((rule) => rule.id);
    if (ruleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
      });
      console.log(`[QB] Cleared ${ruleIds.length} existing dynamic rule(s)`);
    }
  } catch (e) {
    console.warn("[QB] Could not clear dynamic rules:", e.message);
  }
}

const apiCache = new Map();
const CACHE_TTL_MS = 30000; // 30 second cache

async function fetchJson(url, options = {}) {
  const cacheKey = options.method === "GET" || !options.method ? url : null;
  if (cacheKey && apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[QB] Cache hit: ${url}`);
      return cached.data;
    }
    apiCache.delete(cacheKey); // Expired, remove
  }

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

    if (cacheKey && data) {
      apiCache.set(cacheKey, { data, timestamp: Date.now() });
      if (apiCache.size > 50) {
        const firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
      }
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

const MARKETPLACE_CHECKS = [
  { test: (url) => url.includes("amazon."), id: "amazon" },
  { test: (url) => url.includes("noon."), id: "noon" },
];

function detectMarketplace(url) {
  for (const check of MARKETPLACE_CHECKS) {
    if (check.test(url)) return check.id;
  }
  return "unknown";
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

const ASIN_PATTERN = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/;
const NOON_PATTERN = /\/([A-Z0-9]+)\/p\//i;

function generateProductId(url) {
  const cleanUrl = url.split("?")[0].split("#")[0];

  const asinMatch = cleanUrl.match(ASIN_PATTERN);
  if (asinMatch) return `amazon_${asinMatch[1]}`;

  const noonMatch = cleanUrl.match(NOON_PATTERN);
  if (noonMatch) return `noon_${noonMatch[1]}`;

  try {
    const urlObj = new URL(cleanUrl);
    return `product_${simpleHash(urlObj.origin + urlObj.pathname)}`;
  } catch {
    return `product_${simpleHash(cleanUrl)}`;
  }
}

const notificationQueue = new Map();

function showNotification(title, message, notificationId) {
  const stableKey = notificationId
    ? notificationId.split("_").slice(0, 3).join("_")
    : "generic";

  //Debouncing logic
  if (notificationQueue.has(stableKey)) {
    const lastShown = notificationQueue.get(stableKey);
    if (Date.now() - lastShown < 5000) return;
  }
  notificationQueue.set(stableKey, Date.now());

  const uniqueId = notificationId || `qb_${Date.now()}`;

  const iconPath = chrome.runtime.getURL("icons/icon128.png");

  chrome.notifications.create(
    uniqueId,
    {
      type: "basic",
      iconUrl: iconPath,
      title: title,
      message: message,
      priority: 2,
      requireInteraction: false,
    },
    (id) => {
      if (chrome.runtime.lastError) {
        // Silently ignore notification errors

        // FALLBACK
        if (chrome.runtime.lastError.message.includes("icon")) {
          chrome.notifications.create(uniqueId + "_retry", {
            type: "basic",
            iconUrl: "", // Chrome might fallback to default :(
            title: title,
            message: message,
          });
        }
      } else {
        console.log("[QB] Notification Sent Successfully:", id);
      }
    }
  );
}

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  chrome.notifications.clear(notificationId);
});

let productsCache = null;
let productsCacheTime = 0;
const PRODUCTS_CACHE_TTL = 10000; // 10 seconds

async function getTrackedProducts() {
  if (productsCache && Date.now() - productsCacheTime < PRODUCTS_CACHE_TTL) {
    return productsCache;
  }

  const result = await chrome.storage.local.get([CONFIG.STORAGE_KEY]);
  productsCache = result[CONFIG.STORAGE_KEY] || [];
  productsCacheTime = Date.now();
  return productsCache;
}

async function setTrackedProducts(products) {
  productsCache = products;
  productsCacheTime = Date.now();

  await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: products });
}

let backendMapCache = null;

async function getBackendMap() {
  if (backendMapCache) return backendMapCache;

  const result = await chrome.storage.local.get([CONFIG.BACKEND_MAP_KEY]);
  backendMapCache = result[CONFIG.BACKEND_MAP_KEY] || {};
  return backendMapCache;
}

async function setBackendMap(map) {
  backendMapCache = map;
  await chrome.storage.local.set({ [CONFIG.BACKEND_MAP_KEY]: map });
}

function normalizeProductPayload(url, product) {
  const marketplace = detectMarketplace(url);

  const normalizedUrl = url.split("?")[0].split("#")[0].replace(/\/+$/, "");

  const title = (product?.name || "").trim();
  const price = Number(product?.price || 0);
  const currency = (product?.currency || "USD").trim();
  const image_url = product?.image || null;
  const sku =
    product?.sku || (marketplace === "amazon" ? product?.asin : null) || null;

  const availability = product?.availability || "in_stock";

  if (!title) {
    throw new Error("Invalid product payload (title)");
  }

  if (availability === "in_stock" && (!Number.isFinite(price) || price <= 0)) {
    throw new Error("Product marked as in stock but no valid price");
  }

  return {
    url: normalizedUrl,
    marketplace,
    title,
    price_raw: price > 0 ? `${currency} ${price}` : null,
    image_url,
    sku,
    availability,
    client: {
      source: "extension",
      version: QB.APP_CONFIG.VERSION,
      ts: nowIso(),
    },
  };
}

async function sendSnapshotToBackend(payload) {
  const url = `${QB.API.BASE_URL}${QB.API.ROUTES.TRACK_BROWSER}`;
  return await fetchJson(url, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function handleTrackProduct(message) {
  const { url, product } = message;

  if (!url) throw new Error("No URL provided");

  const productId = generateProductId(url);
  const marketplace = detectMarketplace(url);
  const trackedProducts = await getTrackedProducts();
  const existingIndex = trackedProducts.findIndex((p) => p.id === productId);
  const oldPrice =
    existingIndex !== -1 ? trackedProducts[existingIndex].currentPrice : null;

  const localEntry = {
    id: productId,
    name: product?.name || "Unknown Product",
    marketplace,
    currentPrice: product?.price || null,
    originalPrice: product?.price || null,
    currency: product?.currency || "USD",
    priceChange: 0,
    url,
    lastUpdated: Date.now(),
    nextRunAt: product?.next_run_at || null,
    image: product?.image || null,
    availability: product?.availability || "in_stock",
  };

  if (existingIndex === -1 && trackedProducts.length >= CONFIG.MAX_PRODUCTS) {
    throw new Error(
      `Maximum ${CONFIG.MAX_PRODUCTS} products reached. Please remove some products first.`
    );
  }

  if (existingIndex !== -1) {
    trackedProducts[existingIndex] = {
      ...trackedProducts[existingIndex],
      ...localEntry,
    };
  } else {
    trackedProducts.push(localEntry);
  }

  await setTrackedProducts(trackedProducts);

  const payload = normalizeProductPayload(url, product);
  console.log("[QB] Sending snapshot to backend:", payload);

  let backendResult = null;
  try {
    backendResult = await sendSnapshotToBackend(payload);
    console.log("[QB] Backend response:", backendResult);

    if (!backendResult) {
      throw new Error("Backend returned an empty response");
    }

    if (backendResult.next_run_at) {
      const updatedProducts = await getTrackedProducts();
      const idx = updatedProducts.findIndex((p) => p.id === productId);
      if (idx !== -1) {
        updatedProducts[idx].nextRunAt = backendResult.next_run_at;
        await setTrackedProducts(updatedProducts);
      }
    }

    let notificationShown = false;

    if (backendResult.availability_changed && existingIndex !== -1) {
      notificationShown = true;
      const productName = product?.name || "Product";
      const newAvailability = backendResult.availability;
      const previousAvailability = backendResult.previous_availability;

      if (
        newAvailability === "in_stock" &&
        previousAvailability === "out_of_stock"
      ) {
        const priceInfo = backendResult.price
          ? `\nPrice: ${product.currency} ${backendResult.price}`
          : "";
        showNotification(
          "Product Available!",
          `${productName.substring(0, 50)} is now in stock!${priceInfo}`,
          `qb_avail_${productId}_${Date.now()}`
        );
      } else if (
        newAvailability === "out_of_stock" &&
        previousAvailability === "in_stock"
      ) {
        showNotification(
          "Out of Stock",
          `${productName.substring(0, 50)} is no longer available.`,
          `qb_unavail_${productId}_${Date.now()}`
        );
      }
    }

    if (!notificationShown && existingIndex !== -1) {
      const newPrice = backendResult.price;
      if (
        newPrice !== null &&
        oldPrice !== null &&
        Number(newPrice) !== Number(oldPrice)
      ) {
        notificationShown = true;
        showNotification(
          "Price Updated",
          `${product?.name.substring(0, 40)}: ${
            product.currency
          } ${newPrice} (was ${oldPrice})`,
          `qb_price_${productId}_${Date.now()}`
        );
      }
    }

    if (!notificationShown && existingIndex === -1) {
      notificationShown = true;
      const ai = backendResult?.ai || null;
      const availability = backendResult?.availability || "in_stock";
      const productName = product?.name || "Product";

      if (ai?.summary && availability === "in_stock") {
        showNotification(
          "QuickBasket AI Insight",
          ai.summary,
          `qb_ai_${productId}_${Date.now()}`
        );
      } else if (availability === "out_of_stock") {
        showNotification(
          "Product Tracked (Out of Stock)",
          `Tracking: ${productName.substring(
            0,
            50
          )}\n\nYou'll be notified when it's back in stock!`,
          `qb_track_unavail_${productId}_${Date.now()}`
        );
      } else {
        showNotification(
          "Product Tracked",
          `Now tracking: ${productName.substring(0, 50)}`,
          `qb_track_${productId}_${Date.now()}`
        );
      }
    }

    if (!notificationShown && existingIndex !== -1) {
      showNotification(
        "Snapshot Recorded",
        `No changes detected for ${product?.name.substring(0, 40)}...`,
        `qb_nop_${productId}_${Date.now()}`
      );
    }

    if (backendResult.next_run_at) {
      await scheduleProductAlarm(
        backendResult.tracked_product_id,
        backendResult.next_run_at
      );
    }
  } catch (e) {
    // Silently ignore backend tracking errors
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

  setupAlertsPolling();

  return {
    success: true,
    productId,
    backend: { success: true, data: backendResult },
  };
}

async function scheduleProductAlarm(productId, nextRunAt) {
  const alarmName = `scrape-product-${productId}`;
  await chrome.alarms.clear(alarmName);

  if (!nextRunAt) return;

  let nextRunAtUTC = nextRunAt;
  if (
    typeof nextRunAt === "string" &&
    !nextRunAt.includes("Z") &&
    !nextRunAt.includes("+")
  ) {
    nextRunAtUTC = nextRunAt.replace(" ", "T") + "Z";
  }

  const nextRunTime = new Date(nextRunAtUTC).getTime();
  const now = Date.now();
  const diffMs = nextRunTime - now;

  let delayInMinutes;
  if (diffMs < 0) {
    delayInMinutes = 1;
  } else {
    const jitterMs = Math.random() * 30000; // 0-30 seconds jitter
    delayInMinutes = Math.max(1, (diffMs + jitterMs) / 60000);
  }

  chrome.alarms.create(alarmName, { delayInMinutes });
  console.log(
    `[QB] Scheduled #${productId} in ${delayInMinutes.toFixed(1)} mins`
  );
}

let syncInProgress = false;
let syncScheduled = false;

async function syncAllProductAlarms() {
  if (!navigator.onLine) {
    console.warn(
      "[QB] Offline: Skipping alarm sync to avoid backend DNS errors."
    );
    return;
  }

  if (syncInProgress) {
    syncScheduled = true;
    console.log("[QB] Alarm sync in progress, will retry after completion");
    return;
  }

  syncInProgress = true;

  try {
    console.log("[QB] Syncing all product alarms from backend...");

    const token = await getStoredToken();

    const headers = { "Content-Type": "application/json" };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn("[QB] No token found in storage, skipping alarm sync");
      return;
    }

    const response = await fetch(`${API_BASE}/dashboard/products`, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      // Silently skip sync if fetch fails
      return;
    }

    const products = await response.json();
    console.log(`[QB] Found ${products.length} product(s) to schedule`);

    const allAlarms = await chrome.alarms.getAll();
    const clearPromises = allAlarms
      .filter((alarm) => alarm.name.startsWith("scrape-product-"))
      .map((alarm) => chrome.alarms.clear(alarm.name));
    await Promise.all(clearPromises);

    const schedulePromises = products
      .filter((product) => product.next_run_at)
      .map((product) => scheduleProductAlarm(product.id, product.next_run_at));
    await Promise.all(schedulePromises);

    console.log("[QB] All product alarms synced");
  } catch (error) {
    // Silently ignore sync errors - will retry on next interval
  } finally {
    syncInProgress = false;

    if (syncScheduled) {
      syncScheduled = false;
      setTimeout(syncAllProductAlarms, 1000);
    }
  }
}

async function rescheduleProductAlarm(productId) {
  try {
    const response = await fetch(`${API_BASE}/dashboard/products/${productId}`);
    const product = await response.json();

    const alarmName = `scrape-product-${productId}`;
    await chrome.alarms.clear(alarmName);

    const intervalMinutes = (product.update_interval || 1) * 60;
    const scheduledTime = Date.now() + intervalMinutes * 60 * 1000;

    chrome.alarms.create(alarmName, { when: scheduledTime });
    console.log(
      `[QB] Rescheduled ${alarmName} for ${new Date(
        scheduledTime
      ).toLocaleString()}`
    );
  } catch (error) {
    // Silently ignore rescheduling errors
  }
}

const scrapeQueue = [];
let activeScrapes = 0;

async function processScrapeQueue() {
  while (
    scrapeQueue.length > 0 &&
    activeScrapes < CONFIG.MAX_CONCURRENT_SCRAPES
  ) {
    activeScrapes++;
    const productId = scrapeQueue.shift();

    console.log(
      `[QB] Starting scrape #${productId} (${activeScrapes}/${CONFIG.MAX_CONCURRENT_SCRAPES} active)`
    );

    (async () => {
      try {
        const token = await getStoredToken();

        const headers = { "Content-Type": "application/json" };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        } else {
          throw new Error("Authentication token missing");
        }

        const response = await fetch(
          `${API_BASE}/dashboard/products/${productId}`,
          {
            method: "GET",
            headers: headers,
          }
        );

        if (!response.ok) {
          throw new Error(`Backend unreachable (Status: ${response.status})`);
        }

        const productData = await response.json();
        const success = await scrapeProductInBackground(productData);

        if (success) {
          await rescheduleProductAlarm(productId);
          console.log(`[QB] Product ${productId} finished.`);
        } else {
          console.warn(`[QB] #${productId} failed, retrying in 5m`);
          const retryTime = new Date(
            Date.now() + CONFIG.RETRY_DELAY_MS
          ).toISOString();
          await scheduleProductAlarm(productId, retryTime);
        }
      } catch (error) {
        if (error.message && error.message.includes("token")) {
          console.warn(`[QB] Product ${productId}: ${error.message}`);
        } else {
          // Silently ignore other scraping errors
        }
      } finally {
        activeScrapes--;
        processScrapeQueue();
      }
    })();
  }
}
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("scrape-product-")) {
    const productId = alarm.name.replace("scrape-product-", "");

    const online = await checkActualConnectivity();

    if (!online) {
      console.log(`[QB] Offline - skipping scrape for #${productId}`);

      if (!offlineQueue.includes(productId)) {
        offlineQueue.push(productId);
      }

      return;
    }

    if (!scrapeQueue.includes(productId)) {
      scrapeQueue.push(productId);
      console.log(
        `[QB] Added #${productId} to queue (${scrapeQueue.length} pending)`
      );
    }

    processScrapeQueue();
  } else if (alarm.name === "qb_poll_alerts") {
    if (await checkActualConnectivity()) {
      await pollBackendAlerts();
    }
  } else if (alarm.name === "quickbasket-sync-alarms") {
    if (await checkActualConnectivity()) {
      await syncAllProductAlarms();
    }
  } else if (alarm.name === "connectivity-check") {
    await checkActualConnectivity();
  }
});

chrome.alarms.create("connectivity-check", { periodInMinutes: 1 });
console.log("[QB] Alarm listener registered");

self.addEventListener("online", async () => {
  console.log("[QB] Browser detected internet restored.");
  await checkActualConnectivity(true); // Force check
});

self.addEventListener("offline", () => {
  console.log("[QB] Browser detected internet lost.");
  isOnline = false;
});

async function injectContentScript(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url;

  let scriptFiles = ["config.js", "validators.js"];

  if (url.includes("amazon.")) {
    scriptFiles.push("amazon.js");
  } else if (url.includes("noon.")) {
    scriptFiles.push("noon.js");
  } else {
    throw new Error("Unsupported marketplace");
  }

  for (const file of scriptFiles) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file],
    });
  }
}

const ensureContentScriptReady = async (tabId, retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: "ping" }, (res) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(res);
        });
      });
      if (response?.status === "ok") return true;
    } catch (e) {
      if (i === 0) {
        try {
          await injectContentScript(tabId);
          console.log(`[QB] Manually injected content script for tab ${tabId}`);
        } catch (injectError) {
          console.warn(`[QB] Manual injection failed:`, injectError.message);
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
};

function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeProductInBackground(product) {
  const online = await checkActualConnectivity(true);

  if (!online) {
    console.warn(`[QB] Offline detected. Queuing #${product.id} for retry`);

    if (!offlineQueue.includes(product.id)) {
      offlineQueue.push(product.id);
    }

    return false;
  }

  console.log(
    `[QB] Scraping product #${product.id} from ${product.marketplace}`
  );

  let tabId = null;

  try {
    const newTab = await chrome.tabs.create({
      url: product.url,
      active: false,
      pinned: true,
    });
    tabId = newTab.id;

    console.log(`[QB] Tab ${tabId} created`);

    await waitForTabLoad(tabId);

    const waitTime = 15000;
    await sleep(waitTime);

    const isReady = await ensureContentScriptReady(tabId);
    if (!isReady) throw new Error("Content script failed to inject");

    const extractionResult = await Promise.race([
      new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          { action: "extractProduct" },
          (response) => {
            if (chrome.runtime.lastError)
              return reject(new Error(chrome.runtime.lastError.message));
            if (response?.success) resolve(response.product);
            else reject(new Error(response?.error || "Extraction failed"));
          }
        );
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Extraction timeout")),
          CONFIG.SCRAPE_TIMEOUT_MS
        )
      ),
    ]);

    console.log(`[QB] Data:`, extractionResult);

    await checkAndNotifyPriceChange(
      product.id,
      extractionResult.price,
      extractionResult.currency,
      extractionResult.name
    );

    await recordScrapeResult(product.url, extractionResult, product.id);

    await sleep(CONFIG.TAB_CLEANUP_DELAY_MS);

    return true;
  } catch (error) {
    // Error in scraping logged as warning above.
    return false;
  } finally {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        console.warn(`[QB] Failed to close tab ${tabId}:`, e);
      }
    }
  }
}

async function checkAndNotifyPriceChange(
  productId,
  newPrice,
  currency,
  productName
) {
  try {
    const token = await getStoredToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(
      `${API_BASE}/dashboard/products/${productId}`,
      {
        method: "GET",
        headers: headers,
      }
    );
    if (!response.ok) return false;

    const productData = await response.json();

    const parsedNewPrice = parseFloat(newPrice);
    const parsedLastPrice =
      productData.last_price !== null
        ? parseFloat(productData.last_price)
        : null;

    if (
      isNaN(parsedNewPrice) ||
      parsedLastPrice === null ||
      isNaN(parsedLastPrice)
    ) {
      console.log(
        `[QB] Product #${productId}: First check or invalid price format.`
      );
      return false;
    }

    const priceDiff = Math.abs(parsedNewPrice - parsedLastPrice);
    const EPSILON = 0.01;
    if (priceDiff < EPSILON) return false;

    const priceIncreased = parsedNewPrice > parsedLastPrice;
    const changeAmount = Math.abs(parsedNewPrice - parsedLastPrice);
    const changePercent = ((changeAmount / parsedLastPrice) * 100).toFixed(1);
    const direction = priceIncreased ? "increased" : "decreased";

    showNotification(
      `Price ${direction}!`,
      `${productName.substring(0, 50)}\n` +
        `Was: ${currency} ${parsedLastPrice.toFixed(2)}\n` +
        `Now: ${currency} ${parsedNewPrice.toFixed(2)} (${
          priceIncreased ? "+" : "-"
        }${changePercent}%)`
    );

    return true;
  } catch (error) {
    // Silently ignore price change check errors
    return false;
  }
}

async function recordScrapeResult(url, scrapedData, productId) {
  try {
    const recordUrl = `${API_BASE}/api/v1/products/${productId}/record-scrape`;
    console.log(`[QB] Updating backend for product #${productId}...`);

    const token = await getStoredToken();

    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      // Silently skip record without token
      return false;
    }

    const response = await fetch(recordUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        price: scrapedData.price ? parseFloat(scrapedData.price) : null,
        availability: scrapedData.availability || "in_stock",
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[QB] Backend Updated. Next run: ${result.next_run_at}`);

      if (result.availability_changed) {
        const productName = scrapedData.name || "Product";

        if (
          result.availability === "in_stock" &&
          result.previous_availability === "out_of_stock"
        ) {
          const priceInfo = scrapedData.price
            ? `\nPrice: ${scrapedData.currency} ${scrapedData.price}`
            : "";

          showNotification(
            "Back in Stock!",
            `${productName.substring(0, 50)}${priceInfo}`,
            `qb_available_${productId}_${Date.now()}`
          );
        } else if (
          result.availability === "out_of_stock" &&
          result.previous_availability === "in_stock"
        ) {
          showNotification(
            "Out of Stock",
            `${productName.substring(0, 50)} is no longer available.`,
            `qb_unavailable_${productId}_${Date.now()}`
          );
        }
      }

      apiCache.delete(`${API_BASE}/dashboard/products/${productId}`);
      apiCache.delete(`${API_BASE}/dashboard/products`);

      return true;
    } else {
      // Silently ignore backend update errors
      return false;
    }
  } catch (error) {
    // Silently ignore scrape result errors
    return false;
  }
}

function setupAlertsPolling() {
  chrome.alarms.create(CONFIG.ALERTS_ALARM, {
    periodInMinutes: CONFIG.ALERTS_POLL_MINUTES,
  });
}

async function pollBackendAlerts() {
  try {
    const url = `${QB.API.BASE_URL}${QB.API.ROUTES.ALERTS_PENDING}?source=extension`;
    const alerts = await fetchJson(url, { method: "GET" });

    if (!Array.isArray(alerts) || alerts.length === 0) return;

    console.log("[QB] Alerts received:", alerts);

    const ackPromises = alerts.map(async (alert) => {
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
        console.warn("[QB] Failed to ack alert:", id, e.message);
      }
    });

    await Promise.all(ackPromises);
  } catch (e) {
    // Silently ignore polling errors
  }
}

let offlineQueue = [];
let isOnline = navigator.onLine;
let lastConnectivityCheck = 0;
const CONNECTIVITY_CHECK_INTERVAL = 30000; // 30 seconds

async function checkActualConnectivity(forcedCheck = false) {
  const now = Date.now();

  if (
    !forcedCheck &&
    isOnline &&
    now - lastConnectivityCheck < CONNECTIVITY_CHECK_INTERVAL
  ) {
    return true;
  }

  lastConnectivityCheck = now;

  if (!navigator.onLine) {
    if (isOnline) {
      console.log("[QB] User is offline");
      isOnline = false;
      broadcastOnlineStatus(false);
    }
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://www.google.com/generate_204`, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
      mode: "no-cors",
    });

    clearTimeout(timeout);
    const nowOnline = response.type === "opaque" || response.ok;
    const wasOffline = !isOnline;

    isOnline = nowOnline;

    if (nowOnline && wasOffline) {
      console.log("[QB] Connectivity restored");
      broadcastOnlineStatus(true);
      handleRestoredConnection();
    } else if (!nowOnline && !wasOffline) {
      console.log("[QB] User is offline");
      broadcastOnlineStatus(false);
    }

    return nowOnline;
  } catch (error) {
    if (isOnline) {
      isOnline = false;
      broadcastOnlineStatus(false);
    }
    return false;
  }
}

function handleRestoredConnection() {
  let hadOfflineItems = false;

  if (offlineQueue.length > 0) {
    console.log(
      `[QB] Processing ${offlineQueue.length} items from offline queue`
    );
    for (const productId of offlineQueue) {
      if (!scrapeQueue.includes(productId)) {
        scrapeQueue.push(productId);
      }
    }
    offlineQueue = [];
    processScrapeQueue();
    hadOfflineItems = true;
  }

  syncAllProductAlarms().catch((e) => {
    // Silently ignore sync errors - will retry on next interval
  });

  if (!hadOfflineItems) {
    checkOverdueProducts().catch((e) => {
      // Silently ignore overdue check errors
    });
  }
}

async function apiFetchWrapper(url, options) {
  try {
    const response = await fetch(url, options);
    if (!isOnline) {
      isOnline = true;
      handleRestoredConnection();
    }
    return response;
  } catch (error) {
    isOnline = false;
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  const cacheKey = options.method === "GET" || !options.method ? url : null;
  if (cacheKey && apiCache.has(cacheKey)) {
    const cached = apiCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[QB] Cache hit: ${url}`);
      return cached.data;
    }
    apiCache.delete(cacheKey);
  }

  const token = await getStoredToken();

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
        Authorization: token ? `Bearer ${token}` : "",
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

    if (cacheKey && data) {
      apiCache.set(cacheKey, { data, timestamp: Date.now() });

      if (apiCache.size > 50) {
        const firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
      }
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOverdueProducts() {
  if (scrapeQueue.length > 0) {
    return;
  }
  try {
    const token = await getStoredToken();

    const headers = { "Content-Type": "application/json" };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn("[QB] No token found, skipping overdue check");
      return;
    }

    const response = await fetch(`${API_BASE}/api/v1/products/pending-scrape`, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      // Silently ignore fetch errors for pending alerts
      return;
    }

    const data = await response.json();
    const products = data.products || [];

    console.log(`[QB] Found ${products.length} overdue products`);

    for (const product of products) {
      const pId = typeof product === "object" ? product.id : product;
      if (
        !scrapeQueue.includes(pId) &&
        activeScrapes < CONFIG.MAX_CONCURRENT_SCRAPES
      ) {
        scrapeQueue.push(pId);
      }
    }

    if (scrapeQueue.length > 0) {
      processScrapeQueue();
    }
  } catch (error) {}
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[QB] Action:", request.action);

  if (request.action === "ping") {
    sendResponse({ status: "ok" });
    return false;
  }

  if (request.action === "triggerScrapeNow") {
    console.log("[QB] Forced manual scrape triggered");

    (async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/v1/products/pending-scrape?force=true`
        );
        if (!response.ok) throw new Error("Failed to fetch pending products");

        const data = await response.json();
        const products = data.products || [];

        console.log(`[QB] Force scraping ${products.length} products`);

        for (const product of products) {
          if (!scrapeQueue.includes(product.id)) {
            scrapeQueue.push(product.id);
          }
        }

        processScrapeQueue();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Channel stays open.
  }

  if (request.action === "updateProductAlarm") {
    const pid = parseInt(request.productId);
    scheduleProductAlarm(pid, request.nextRunAt)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "trackProduct") {
    handleTrackProduct(request)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("[QB] onInstalled fired - Reason:", details.reason);

  await clearAllDynamicRules();

  if (details.reason === "install") {
    chrome.storage.local.set({
      [CONFIG.STORAGE_KEY]: [],
      [CONFIG.BACKEND_MAP_KEY]: {},
    });
  }

  await chrome.alarms.clear("quickbasket-auto-scrape");
  console.log("[QB] Cleared legacy global alarm");

  console.log("[QB] Syncing product alarms...");
  await syncAllProductAlarms();

  chrome.alarms.create("quickbasket-sync-alarms", {
    delayInMinutes: 1,
    periodInMinutes: 60,
  });

  setupAlertsPolling();

  console.log("[QB] Initialization complete");
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[QB] onStartup fired - Browser restarted");

  await clearAllDynamicRules();

  await chrome.alarms.clear("quickbasket-auto-scrape");
  console.log("[QB] Cleared legacy global alarm");

  console.log("[QB] Syncing product alarms...");
  await syncAllProductAlarms();
  setupAlertsPolling();

  if (navigator.onLine) {
    console.log("[QB] Checking for overdue products after startup...");
    await checkOverdueProducts();
  } else {
    console.log("[QB] Starting offline - will check when connection restored");
  }

  console.log("[QB] Startup complete");
});

self.addEventListener("install", () => {
  console.log("[QB] Service worker installed");
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  console.log("[QB] Service worker activated");

  apiCache.clear();
  productsCache = null;
  backendMapCache = null;

  clearAllDynamicRules().catch(() => {});
});

console.log("[QB] Background script loaded and ready.");
