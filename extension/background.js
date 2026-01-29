/**
 * QuickBasket AI - Background Service Worker
 * Handles:
 * - Product tracking requests
 * - Price monitoring
 * - Storage management
 */

console.log("[QB Background] Service worker initialized");

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
  STORAGE_KEY: "trackedProducts",
  MAX_PRODUCTS: 100,
  PRICE_CHECK_INTERVAL: 3600000, // 1 hour in milliseconds
};

// ==========================================
// MESSAGE HANDLERS
// ==========================================

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[QB Background] Received message:", message.action);

  if (message.action === "trackProduct") {
    handleTrackProduct(message, sender)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        console.error("[QB Background] Track error:", error);
        sendResponse({
          success: false,
          error: error.message || "Failed to track product",
        });
      });

    // Return true to indicate async response
    return true;
  }

  if (message.action === "getProductInfo") {
    // This is handled by content scripts, just acknowledge
    sendResponse({ success: true });
    return false;
  }

  // Unknown action
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ==========================================
// PRODUCT TRACKING
// ==========================================

/**
 * Handle product tracking request
 */
async function handleTrackProduct(message, sender) {
  try {
    const { url, product } = message;

    if (!url) {
      throw new Error("No URL provided");
    }

    console.log("[QB Background] Tracking product:", url);

    // Generate product ID from URL
    const productId = generateProductId(url);

    // Get existing products
    const result = await chrome.storage.local.get([CONFIG.STORAGE_KEY]);
    const trackedProducts = result[CONFIG.STORAGE_KEY] || [];

    // Check if already tracking
    const existingIndex = trackedProducts.findIndex((p) => p.id === productId);

    if (existingIndex !== -1) {
      console.log("[QB Background] Product already tracked, updating...");

      // Update existing product
      if (product) {
        trackedProducts[existingIndex] = {
          ...trackedProducts[existingIndex],
          ...product,
          id: productId,
          url: url,
          lastUpdated: Date.now(),
        };
      }
    } else {
      console.log("[QB Background] Adding new product...");

      // Check limit
      if (trackedProducts.length >= CONFIG.MAX_PRODUCTS) {
        throw new Error(
          `Maximum ${CONFIG.MAX_PRODUCTS} products reached. Please remove some products.`
        );
      }

      // Create new product entry
      const newProduct = {
        id: productId,
        name: product?.name || "Unknown Product",
        marketplace: detectMarketplace(url),
        currentPrice: product?.price || 0,
        originalPrice: product?.price || 0,
        currency: product?.currency || "USD",
        priceChange: 0,
        url: url,
        lastUpdated: Date.now(),
        image: product?.image || null, // Include image
      };

      trackedProducts.push(newProduct);
    }

    // Save to storage
    await chrome.storage.local.set({
      [CONFIG.STORAGE_KEY]: trackedProducts,
    });

    console.log("[QB Background] Product tracked successfully");

    // Show notification
    showNotification(
      "Product Tracked",
      `Now tracking: ${product?.name?.substring(0, 50) || "Product"}`,
      productId
    );

    return {
      success: true,
      productId: productId,
      message: "Product tracked successfully",
    };
  } catch (error) {
    console.error("[QB Background] Error tracking product:", error);
    throw error;
  }
}

/**
 * Generate unique product ID from URL
 */
function generateProductId(url) {
  try {
    const urlObj = new URL(url);

    // For Amazon: extract ASIN
    const asinMatch = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asinMatch) {
      return `amazon_${asinMatch[1]}`;
    }

    // For Noon: extract SKU
    const noonMatch = url.match(/\/([A-Z0-9]+)\/p\//);
    if (noonMatch) {
      return `noon_${noonMatch[1]}`;
    }

    // Fallback: use pathname hash
    return `product_${simpleHash(urlObj.pathname)}`;
  } catch (error) {
    // Fallback: use URL hash
    return `product_${simpleHash(url)}`;
  }
}

/**
 * Simple string hash function
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Detect marketplace from URL
 */
function detectMarketplace(url) {
  if (url.includes("amazon.")) return "amazon";
  if (url.includes("noon.")) return "noon";
  return "unknown";
}

/**
 * Show browser notification (clickable)
 */
function showNotification(title, message, productId) {
  try {
    chrome.notifications.create(productId || `notif_${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: title,
      message: message,
      priority: 2,
      requireInteraction: false, // Auto-dismiss
    });
  } catch (error) {
    console.error("[QB Background] Notification error:", error);
  }
}

// ==========================================
// NOTIFICATION CLICK HANDLER
// ==========================================

/**
 * Handle notification clicks - open dashboard
 */
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log("[QB Background] Notification clicked:", notificationId);

  // Open dashboard
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html"),
  });

  // Clear the notification
  chrome.notifications.clear(notificationId);
});

// ==========================================
// STORAGE CLEANUP
// ==========================================

/**
 * Clean up invalid storage keys
 */
async function cleanupStorage() {
  try {
    const allData = await chrome.storage.local.get(null);
    const keys = Object.keys(allData);

    console.log("[QB Background] Storage keys found:", keys);

    // Remove any undefined or invalid keys
    const invalidKeys = keys.filter(
      (key) =>
        key === "undefined" || key === "null" || key === "" || key === "NaN"
    );

    if (invalidKeys.length > 0) {
      console.log("[QB Background] Removing invalid keys:", invalidKeys);
      await chrome.storage.local.remove(invalidKeys);
      console.log("[QB Background] Invalid keys removed");
    }
  } catch (error) {
    console.error("[QB Background] Cleanup error:", error);
  }
}

// ==========================================
// PRICE MONITORING (Future feature)
// ==========================================

/**
 * Setup periodic price checks
 */
function setupPriceMonitoring() {
  // Create alarm for periodic checks
  chrome.alarms.create("priceCheck", {
    periodInMinutes: CONFIG.PRICE_CHECK_INTERVAL / 60000,
  });

  // Listen for alarm
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "priceCheck") {
      checkPrices();
    }
  });
}

/**
 * Check prices for all tracked products
 */
async function checkPrices() {
  try {
    console.log("[QB Background] Checking prices...");

    const result = await chrome.storage.local.get([CONFIG.STORAGE_KEY]);
    const trackedProducts = result[CONFIG.STORAGE_KEY] || [];

    // TODO: Implement price checking logic
    // This would involve:
    // 1. Fetching current prices from marketplace APIs
    // 2. Comparing with stored prices
    // 3. Updating storage
    // 4. Sending notifications for price drops

    console.log("[QB Background] Price check complete");
  } catch (error) {
    console.error("[QB Background] Price check error:", error);
  }
}

// ==========================================
// INSTALLATION
// ==========================================

/**
 * Handle extension installation/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log("[QB Background] Extension installed/updated:", details.reason);

  if (details.reason === "install") {
    // First time installation
    console.log("[QB Background] First time installation");

    // Initialize storage
    chrome.storage.local.set({
      [CONFIG.STORAGE_KEY]: [],
    });

    // Clean up any invalid keys
    cleanupStorage();
  } else if (details.reason === "update") {
    // Extension updated
    console.log("[QB Background] Extension updated");

    // Clean up invalid keys on update
    cleanupStorage();
  }

  // Setup price monitoring (future feature)
  // setupPriceMonitoring();
});

// ==========================================
// EXTENSION LIFECYCLE
// ==========================================

console.log("[QB Background] Service worker ready");
