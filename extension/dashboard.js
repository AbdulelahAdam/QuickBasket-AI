/**
 * QuickBasket AI - Dashboard Script (Final)
 */

(function () {
  "use strict";

  console.log("[QB Dashboard] Loading...");

  const CONFIG = {
    STORAGE_KEY: "trackedProducts",
    PRICE_DECIMALS: 2,
  };

  let state = {
    products: [],
    filteredProducts: [],
    currentFilter: "all",
    searchQuery: "",
  };

  const elements = {};

  // ==========================================
  // UTILITY FUNCTIONS
  // ==========================================

  const tempDiv = document.createElement("div");
  function escapeHtml(text) {
    if (typeof text !== "string") return "";
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  function parsePrice(price) {
    if (typeof price === "number") return price;
    if (typeof price === "string")
      return parseFloat(price.replace(/[^\d.]/g, ""));
    return 0;
  }

  function validateProduct(product) {
    return !!(
      product &&
      product.id &&
      product.name &&
      product.marketplace &&
      (product.currentPrice !== undefined || product.price !== undefined) &&
      product.currency &&
      product.url
    );
  }

  function sanitizeProduct(product) {
    const currentPrice = parsePrice(product.currentPrice ?? product.price ?? 0);
    const originalPrice = product.originalPrice
      ? parsePrice(product.originalPrice)
      : currentPrice;
    const priceChange =
      typeof product.priceChange === "number" ? product.priceChange : 0;

    return {
      id: String(product.id),
      name: escapeHtml(product.name),
      marketplace: product.marketplace.toLowerCase(),
      currentPrice: currentPrice,
      originalPrice: originalPrice,
      currency: escapeHtml(product.currency),
      url: product.url,
      priceChange: priceChange,
      lastUpdated: product.lastUpdated || Date.now(),
      image: product.image || null,
    };
  }

  function formatCurrency(amount, currency = "USD") {
    return `${escapeHtml(currency)} ${parseFloat(amount).toFixed(
      CONFIG.PRICE_DECIMALS
    )}`;
  }

  // ==========================================
  // STORAGE
  // ==========================================

  async function loadProducts() {
    console.log("[QB Dashboard] Loading products...");

    try {
      const result = await chrome.storage.local.get([CONFIG.STORAGE_KEY]);
      const rawProducts = result[CONFIG.STORAGE_KEY] || [];

      console.log("[QB Dashboard] Found", rawProducts.length, "products");

      state.products = rawProducts.filter(validateProduct).map(sanitizeProduct);

      console.log(
        "[QB Dashboard] Loaded",
        state.products.length,
        "valid products"
      );
    } catch (error) {
      console.error("[QB Dashboard] Error:", error);
      state.products = [];
    }
  }

  async function saveProducts() {
    try {
      await chrome.storage.local.set({ [CONFIG.STORAGE_KEY]: state.products });
      return true;
    } catch (error) {
      console.error("[QB Dashboard] Save error:", error);
      return false;
    }
  }

  // ==========================================
  // RENDERING
  // ==========================================

  function createProductCard(product) {
    const marketplaceName =
      product.marketplace === "amazon" ? "Amazon" : "Noon";
    const currentPrice = formatCurrency(product.currentPrice, product.currency);
    const originalPrice =
      product.originalPrice && product.originalPrice !== product.currentPrice
        ? formatCurrency(product.originalPrice, product.currency)
        : null;

    const badgeClass = product.priceChange < 0 ? "badge-down" : "badge-up";
    const priceChangeText =
      product.priceChange < 0
        ? `↓ ${Math.abs(product.priceChange).toFixed(1)}%`
        : `↑ ${product.priceChange.toFixed(1)}%`;

    const priceDiff =
      product.originalPrice && product.originalPrice !== product.currentPrice
        ? formatCurrency(
            Math.abs(product.originalPrice - product.currentPrice),
            product.currency
          )
        : null;

    return `
      <div class="product-card" data-id="${product.id}" data-url="${escapeHtml(
      product.url
    )}" style="
        background: linear-gradient(135deg, rgba(20, 24, 41, 0.8), rgba(30, 40, 70, 0.5));
        backdrop-filter: blur(10px);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: 12px;
        padding: 20px;
        transition: all 0.3s ease;
        position: relative;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        text-align: left;
      ">
        ${
          Math.abs(product.priceChange) > 0
            ? `
          <div class="product-badge ${badgeClass}" style="
            position: absolute; top: 12px; right: 12px;
            padding: 4px 12px; border-radius: 12px;
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            z-index: 2;
            ${
              product.priceChange < 0
                ? "background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3);"
                : "background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);"
            }
          ">
            ${escapeHtml(priceChangeText)}
          </div>
        `
            : ""
        }
        
        <!-- Image Container -->
        <div style="
          width: 100%; height: 180px;
          background: rgba(10, 14, 39, 0.5);
          border-radius: 8px; margin-bottom: 16px;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; flex-shrink: 0;
        ">
          ${
            product.image
              ? `<img src="${escapeHtml(product.image)}" alt="${
                  product.name
                }" loading="lazy" style="max-width: 100%; max-height: 100%; object-fit: contain;">`
              : '<div style="color: #64748b; font-size: 48px;">📦</div>'
          }
        </div>
        
        <!-- Info Container: Forces left alignment for title, marketplace, and price -->
        <div style="width: 100%; display: flex; flex-direction: column; align-items: flex-start; flex-grow: 1;">
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            ${escapeHtml(marketplaceName)}
          </div>
          
          <div style="
            font-size: 15px; font-weight: 600; color: #e2e8f0;
            margin-bottom: 12px; line-height: 1.4;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            overflow: hidden; min-height: 2.8em;
          " title="${product.name}">${product.name}</div>
          
          <div style="margin-bottom: 20px; width: 100%;">
            <div style="
              font-size: 24px; font-weight: 800;
              background: linear-gradient(135deg, #3b82f6, #2563eb);
              -webkit-background-clip: text; -webkit-text-fill-color: transparent;
              background-clip: text; display: inline-block;
            ">${currentPrice}</div>
            
            ${
              originalPrice
                ? `
              <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                <span style="font-size: 14px; color: #64748b; text-decoration: line-through;">${originalPrice}</span>
                <span style="font-size: 12px; font-weight: 700; color: ${
                  product.priceChange < 0 ? "#4ade80" : "#f87171"
                };">
                  ${product.priceChange < 0 ? "SAVED" : "UP"}: ${priceDiff}
                </span>
              </div>
            `
                : ""
            }
          </div>
        </div>
        
        <!-- Actions (Pinned to bottom via flex-grow in the container above) -->
        <div class="product-actions" style="display: flex; gap: 8px; width: 100%; margin-top: auto;">
          <button class="action-btn action-btn-primary" data-action="view" data-id="${
            product.id
          }" style="
            flex: 1; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 600;
            cursor: pointer; border: none; color: white;
            background: linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%);
          ">View Product</button>
          <button class="action-btn action-btn-danger" data-action="remove" data-id="${
            product.id
          }" style="
            flex: 1; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: 600;
            cursor: pointer; background: transparent; color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.5);
          ">Remove</button>
        </div>
      </div>
    `;
  }

  function applyFilters() {
    state.filteredProducts = state.products.filter((product) => {
      if (state.currentFilter !== "all") {
        if (state.currentFilter === "price-drop" && product.priceChange >= 0)
          return false;
        if (
          state.currentFilter !== "price-drop" &&
          product.marketplace !== state.currentFilter
        )
          return false;
      }
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        if (!product.name.toLowerCase().includes(query)) return false;
      }
      return true;
    });
  }

  function renderProducts() {
    console.log("[QB Dashboard] Rendering...");

    const grid = document.getElementById("productsGrid");
    const emptyState = document.getElementById("emptyState");

    if (!grid || !emptyState) {
      console.error("[QB Dashboard] DOM elements missing!");
      return;
    }

    applyFilters();

    console.log("[QB Dashboard] Filtered:", state.filteredProducts.length);

    if (state.filteredProducts.length === 0) {
      grid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    // FORCE VISIBILITY with inline styles
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(320px, 1fr))";
    grid.style.gap = "20px";
    grid.style.marginBottom = "40px";
    emptyState.style.display = "none";

    const html = state.filteredProducts.map(createProductCard).join("");
    grid.innerHTML = html;

    setupProductActions();

    console.log(
      "[QB Dashboard] Rendered",
      state.filteredProducts.length,
      "products"
    );
  }

  function setupProductActions() {
    const grid = document.getElementById("productsGrid");
    if (!grid) return;

    grid.removeEventListener("click", handleProductAction);
    grid.addEventListener("click", handleProductAction);
  }

  function handleProductAction(e) {
    // Check if button clicked
    const button = e.target.closest("[data-action]");

    if (button) {
      e.stopPropagation(); // Prevent card click
      const action = button.dataset.action;
      const productId = button.dataset.id;

      if (action === "view") {
        viewProduct(productId);
      } else if (action === "remove") {
        removeProduct(productId);
      }
      return;
    }

    // Check if card clicked (but not buttons)
    const card = e.target.closest(".product-card");
    if (card && !e.target.closest(".product-actions")) {
      const url = card.dataset.url;
      if (url) {
        chrome.tabs.create({ url: url });
      }
    }
  }

  // ==========================================
  // ACTIONS
  // ==========================================

  function viewProduct(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;

    try {
      chrome.tabs.create({ url: product.url });
    } catch (error) {
      console.error("[QB Dashboard] Error:", error);
      alert("Could not open product page");
    }
  }

  async function removeProduct(productId) {
    if (!confirm("Are you sure you want to stop tracking this product?")) {
      return;
    }

    console.log("[QB Dashboard] Removing:", productId);

    state.products = state.products.filter((p) => p.id !== productId);

    const saved = await saveProducts();

    if (saved) {
      updateStats();
      renderProducts();
    } else {
      alert("Failed to remove product. Please try again.");
      await loadProducts();
      updateStats();
      renderProducts();
    }
  }

  function exportData() {
    try {
      const dataStr = JSON.stringify(state.products, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `quickbasket-data-${Date.now()}.json`;
      link.click();

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("[QB Dashboard] Export error:", error);
      alert("Failed to export data");
    }
  }

  // ==========================================
  // STATS
  // ==========================================

  function updateStats() {
    const totalEl = document.getElementById("totalProducts");
    const savedEl = document.getElementById("totalSaved");
    const dropEl = document.getElementById("biggestDrop");
    const alertsEl = document.getElementById("activeAlerts");

    if (!totalEl) return;

    totalEl.textContent = state.products.length;

    const totalSaved = state.products.reduce((sum, p) => {
      if (p.originalPrice && p.originalPrice !== p.currentPrice) {
        const saved = p.originalPrice - p.currentPrice;
        return sum + (saved > 0 ? saved : 0);
      }
      return sum;
    }, 0);
    savedEl.textContent = `$${totalSaved.toFixed(CONFIG.PRICE_DECIMALS)}`;

    const biggestDrop = Math.max(
      ...state.products.map((p) =>
        p.priceChange < 0 ? Math.abs(p.priceChange) : 0
      ),
      0
    );
    dropEl.textContent = `${biggestDrop.toFixed(1)}%`;

    const activeAlerts = state.products.filter((p) => p.priceChange < 0).length;
    alertsEl.textContent = activeAlerts;
  }

  // ==========================================
  // EVENT LISTENERS
  // ==========================================

  function setupEventListeners() {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value;
        renderProducts();
      });
    }

    document.querySelectorAll(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentFilter = btn.dataset.filter;
        renderProducts();
      });
    });

    const exportBtn = document.getElementById("exportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportData);
    }

    const settingsBtn = document.getElementById("settingsBtn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        alert("Settings coming soon!");
      });
    }

    const emptyState = document.getElementById("emptyState");
    if (emptyState) {
      emptyState.addEventListener("click", (e) => {
        if (e.target.classList.contains("btn-primary")) {
          window.close();
        }
      });
    }
  }

  // ==========================================
  // INIT
  // ==========================================

  async function init() {
    console.log("[QB Dashboard] Initializing...");

    await loadProducts();
    updateStats();
    renderProducts();
    setupEventListeners();

    console.log("[QB Dashboard] Ready! Products:", state.products.length);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
