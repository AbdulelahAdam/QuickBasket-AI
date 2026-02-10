(function () {
  "use strict";

  console.log("[QB Dashboard] Initializing.");

  const CONFIG = {
    PRICE_DECIMALS: 2,
    CHART_MAX_POINTS: 120,
    PRODUCTS_PER_PAGE: 20,
    CACHE_TTL_MS: 30000,
    REFRESH_INTERVAL_MS: 30000,
    DEBOUNCE_DELAY_MS: 300,
    API_TIMEOUT_MS: 30000,
    RECONNECT_CHECK_INTERVAL: 5000,
  };

  const QB = self.QB_CONFIG || null;
  const API_BASE =
    EXT_CONFIG?.API_BASE_URL || QB?.API?.BASE_URL || "http://127.0.0.1:8000";

  const API = {
    DASHBOARD_PRODUCTS: `${API_BASE}/dashboard/products`,
    DASHBOARD_PRODUCT_DETAIL: (id) => `${API_BASE}/dashboard/products/${id}`,
    ALERTS_PENDING: `${API_BASE}${
      QB?.API?.ROUTES?.ALERTS_PENDING || "/api/v1/alerts/pending"
    }`,
    AI_COMPUTE: (id) => `${API_BASE}/api/v1/ai/products/${id}/insight`,
    AI_LATEST: (id) => `${API_BASE}/api/v1/ai/products/${id}/insight/latest`,
    PRODUCT_INTERVAL: (id) => `${API_BASE}/dashboard/products/${id}/interval`,
  };

  let state = {
    products: [],
    filteredProducts: [],
    currentFilter: "all",
    searchQuery: "",
    loading: false,
    selectedProductId: null,
    activeAlerts: 0,
    displayedCount: CONFIG.PRODUCTS_PER_PAGE,
    lastUpdate: 0,
    isOnline: navigator.onLine,
    serverConnected: false,
  };

  const cache = new Map();
  const imageCache = new Map();
  const IMAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const abortControllers = new Map();
  let reconnectInterval = null;

  function getCached(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL_MS) {
      return cached.data;
    }
    cache.delete(key);
    return null;
  }

  function setCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
    if (cache.size > 20) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
  }

  function getCachedImage(productId) {
    const item = imageCache.get(productId);
    if (!item) return null;
    const isExpired = Date.now() - item.timestamp > IMAGE_CACHE_TTL_MS;
    if (isExpired) {
      imageCache.delete(productId);
      return null;
    }
    return item.url;
  }

  function setCachedImage(productId, imageUrl) {
    if (imageUrl) {
      imageCache.set(productId, { url: imageUrl, timestamp: Date.now() });
    }
  }

  const elements = {};
  function el(id) {
    if (!elements[id]) {
      elements[id] = document.getElementById(id);
    }
    return elements[id];
  }

  const tempDiv = document.createElement("div");

  function escapeHtml(text) {
    if (typeof text !== "string") return "";
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  function formatCurrency(amount, currency = null) {
    if (amount === null || amount === undefined || Number.isNaN(amount))
      return "—";
    const n = typeof amount === "number" ? amount : parseFloat(amount);
    const symbol = currency ? escapeHtml(currency) : "";
    return `${symbol} ${n.toFixed(CONFIG.PRICE_DECIMALS)}`;
  }

  function safeFloat(v) {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function marketplaceName(m) {
    const x = (m || "").toLowerCase();
    const names = {
      amazon: "Amazon",
      noon: "Noon",
      alibaba: "Alibaba",
      aliexpress: "AliExpress",
      shein: "Shein",
      ebay: "eBay",
      jumia: "Jumia",
      nike: "Nike",
      adidas: "Adidas",
    };
    return names[x] || x || "Unknown";
  }

  function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return "Just now";
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }

  function updateConnectionUI(isConnected) {
    const dot = el("connectionDot");
    const text = el("connectionText");
    const banner = el("offlineBanner");

    if (!dot || !text) return;

    if (isConnected) {
      dot.className = "qb-status-dot status-online";
      text.textContent = "Session Active";
      text.style.color = "#10b981";
      if (banner) banner.classList.remove("show");
      state.serverConnected = true;
    } else {
      dot.className = "qb-status-dot status-offline";
      text.textContent = "Connection Lost";
      text.style.color = "#ef4444";
      if (banner) banner.classList.add("show");
      state.serverConnected = false;
    }
  }

  function startReconnectMonitor() {
    if (reconnectInterval) return;

    reconnectInterval = setInterval(async () => {
      if (state.serverConnected) {
        stopReconnectMonitor();
        return;
      }

      if (!navigator.onLine) {
        return;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${API_BASE}/health`, {
          signal: controller.signal,
          method: "HEAD",
          cache: "no-store",
        });

        clearTimeout(timeout);

        if (response.ok && response.status === 200) {
          console.log("[Dashboard] Connection restored");
          updateConnectionUI(true);
          stopReconnectMonitor();
          setTimeout(() => refreshDashboard(false), 500);
        }
      } catch (error) {
        // should stay silent
      }
    }, CONFIG.RECONNECT_CHECK_INTERVAL);
  }

  function stopReconnectMonitor() {
    if (reconnectInterval) {
      clearInterval(reconnectInterval);
      reconnectInterval = null;
    }
  }

  window.addEventListener("online", () => {
    console.log("[Dashboard] Browser online event");
    state.isOnline = true;
    if (!state.serverConnected) {
      startReconnectMonitor();
    }
  });

  window.addEventListener("offline", () => {
    console.log("[Dashboard] Browser offline event");
    state.isOnline = false;
    updateConnectionUI(false);
    stopReconnectMonitor();
  });

  async function apiFetch(url, opts = {}) {
    if (!navigator.onLine) {
      throw new Error("CONNECTION_LOST");
    }

    const cacheKey = opts.method === "GET" || !opts.method ? url : null;
    if (cacheKey) {
      const cached = getCached(cacheKey);
      if (cached) return cached;
    }

    if (abortControllers.has(url)) {
      return;
    }

    const controller = new AbortController();
    abortControllers.set(url, controller);
    const timeout = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT_MS);

    try {
      const authHeader = authService?.getAuthHeader
        ? authService.getAuthHeader()
        : null;

      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
          ...(opts.headers || {}),
        },
      });

      if (res.status >= 500) {
        if (state.serverConnected) {
          updateConnectionUI(false);
          startReconnectMonitor();
        }
        // Silent.
        return null;
      }

      if (!res.ok) {
        if (res.status === 401 && authService?.refreshSession) {
          await authService.refreshSession();
          throw new Error("Session expired");
        }

        if (res.status >= 400 && res.status < 500) {
          throw new Error(`Client error: ${res.status}`);
        }

        throw new Error("CONNECTION_LOST");
      }

      if (!state.serverConnected && res.status >= 200 && res.status < 300) {
        updateConnectionUI(true);
        stopReconnectMonitor();
      }

      const data = (res.headers.get("content-type") || "").includes(
        "application/json"
      )
        ? await res.json()
        : await res.text();

      if (cacheKey && data) setCache(cacheKey, data);
      return data;
    } catch (error) {
      if (
        error.name === "AbortError" ||
        error.message.includes("Failed to fetch") ||
        error.message.includes("NetworkError") ||
        error.message.includes("Load failed")
      ) {
        if (state.serverConnected) {
          updateConnectionUI(false);
          startReconnectMonitor();
        }
        throw new Error("CONNECTION_LOST");
      }
      //throw error;
    } finally {
      clearTimeout(timeout);
      abortControllers.delete(url);
    }
  }

  function showLoadingSkeletons() {
    const grid = el("productsGrid");
    if (!grid) return;

    const skeletonHTML = `
      <div class="skeleton-card">
        <div class="skeleton-image"></div>
        <div class="skeleton-text"></div>
        <div class="skeleton-text short"></div>
        <div class="skeleton-price"></div>
        <div class="skeleton-text"></div>
      </div>
    `.repeat(6);

    grid.innerHTML = skeletonHTML;
  }

  async function loadProductsFromBackend() {
    const rows = await apiFetch(API.DASHBOARD_PRODUCTS);
    if (!rows || !Array.isArray(rows)) return [];

    const uniqueMap = new Map();

    rows.forEach((p) => {
      const cleanUrl = p.url.split("?")[0].split("#")[0].toLowerCase().trim();
      const cachedImage = getCachedImage(p.id);
      const imageUrl = cachedImage || p.image_url || null;

      if (!uniqueMap.has(cleanUrl)) {
        uniqueMap.set(cleanUrl, {
          id: p.id,
          name: p.title || "Untitled Product",
          marketplace: (p.marketplace || "").toLowerCase(),
          currency: p.currency || "USD",
          currentPrice: safeFloat(p.last_price),
          minPrice: safeFloat(p.min_price),
          maxPrice: safeFloat(p.max_price),
          url: p.url,
          image: imageUrl,
          snapshots: parseInt(p.snapshots) || 0,
          trackedDays: parseInt(p.tracked_days) || 0,
          lastUpdated: p.last_updated || null,
          nextRun: p.next_run_at || null,
          change24h: safeFloat(p.change_24h),
          update_interval: p.update_interval || 24,
          last_availability: p.last_availability || "in_stock",
        });
        if (p.image_url) setCachedImage(p.id, p.image_url);
      } else {
        const existing = uniqueMap.get(cleanUrl);
        existing.snapshots += parseInt(p.snapshots) || 0;

        if (new Date(p.last_updated) > new Date(existing.lastUpdated)) {
          existing.currentPrice = safeFloat(p.last_price);
          existing.lastUpdated = p.last_updated;
          existing.change24h = safeFloat(p.change_24h);
          existing.id = String(p.id);
          existing.last_availability = p.last_availability || "in_stock";
          if (p.image_url) {
            existing.image = p.image_url;
            setCachedImage(p.id, p.image_url);
          }
        }
      }
    });

    return Array.from(uniqueMap.values());
  }

  async function loadActiveAlertsCount() {
    try {
      const pending = await apiFetch(`${API.ALERTS_PENDING}?source=extension`);
      if (Array.isArray(pending)) return pending.length;
      if (pending?.pending && Array.isArray(pending.pending))
        return pending.pending.length;
      return 0;
    } catch {
      return 0;
    }
  }

  function createProductCard(product) {
    const mp = marketplaceName(product.marketplace);
    const currentPrice = formatCurrency(product.currentPrice, product.currency);
    const minPrice = formatCurrency(product.minPrice, product.currency);
    const maxPrice = formatCurrency(product.maxPrice, product.currency);

    const change = safeFloat(product.change24h);
    const current = safeFloat(product.currentPrice);
    const interval = product.update_interval || 1;
    const lastScraped = product.lastUpdated
      ? timeAgo(product.lastUpdated)
      : "Never";

    const now = new Date();
    const nextRun = product.nextRun ? new Date(product.nextRun) : null;
    const timeRemainingHours = nextRun ? (nextRun - now) / 3600000 : 0;

    const availability =
      product.last_availability || product.availability || "in_stock";

    let availabilityBadge = "";
    if (availability === "out_of_stock") {
      availabilityBadge = `
        <div class="product-badge badge-unavailable" style="background: #7f1d1d; border: 1px solid #991b1b; color: #fecaca;">
          Out of Stock
        </div>
      `;
    }

    let badgeHtml = "";
    if (change !== null && current !== null && availability === "in_stock") {
      const isDown = change < 0;
      const isUp = change > 0;

      if (isDown || isUp) {
        const cls = isDown ? "badge-down" : "badge-up";
        const arrow = isDown ? "↓" : "↑";
        const amount = Math.abs(change);
        const prevPrice = current - change;
        const pctValue = prevPrice > 0 ? (amount / prevPrice) * 100 : 0;
        const pctStr = ` (${pctValue.toFixed(1)}%)`;

        badgeHtml = `
          <div class="product-badge ${cls}">
            ${arrow} 24h ${formatCurrency(amount, product.currency)}${pctStr}
          </div>
        `;
      }
    }

    const intervalOptions = [1, 6, 12, 24]
      .map((hours) => {
        const isCurrentInterval = interval === hours;
        const isTooShort = timeRemainingHours > 0 && timeRemainingHours < hours;
        const disabled = !isCurrentInterval && isTooShort ? "disabled" : "";
        const label = hours === 1 ? "1h" : `${hours}h`;

        return `<option value="${hours}" ${
          interval == hours ? "selected" : ""
        } ${disabled}>${label}</option>`;
      })
      .join("");

    return `
      <div class="product-card" data-id="${escapeHtml(
        product.id
      )}" style="cursor:pointer;">
        ${availabilityBadge}
        ${badgeHtml}
        <div class="product-image">
          ${
            product.image
              ? `<img src="${escapeHtml(
                  product.image
                )}" loading="lazy" alt="${escapeHtml(product.name)}">`
              : `<div></div>`
          }
        </div>
        <div class="product-marketplace">${escapeHtml(mp)}</div>
        <div class="product-name" title="${escapeHtml(
          product.name
        )}">${escapeHtml(product.name)}</div>
        
        <div class="price-info">
          <div class="current-price">${currentPrice}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px;">Min: ${minPrice} · Max: ${maxPrice}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">
            Snapshots: ${product.snapshots || 0} · Days: ${
      product.trackedDays || 1
    }
          </div>
          
          <div class="scrape-metrics" style="background: rgba(0,0,0,0.15); padding: 8px; border-radius: 6px; margin: 10px 0; border: 1px solid rgba(255,255,255,0.03);">
            <div style="font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between;">
              <span>Last Snapshot:</span>
              <span style="color: #e2e8f0;">${lastScraped}</span>
            </div>
            <div class="countdown-timer" data-next-run="${
              product.nextRun || ""
            }" style="font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; margin-top: 4px;">
              <span>Next Snapshot:</span>
              <span class="timer-display" style="color: #3b82f6; font-family: monospace; font-weight: 600;">Calculating...</span>
            </div>
          </div>
        </div>

        <div class="product-actions" style="margin-top: 16px; display: flex; flex-direction: column; gap: 12px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Interval</span>
            <div style="position: relative; width: 100px;">
              <select 
                data-action="change-interval" 
                data-id="${product.id}"
                class="modern-select"
                style="appearance: none; width: 100%; background: #0f172a; color: #f8fafc; border: 1px solid #334155; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; outline: none;"
              >
                ${intervalOptions}
              </select>
              <div style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 8px; color: #475569;">▼</div>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" data-action="details" data-id="${
              product.id
            }" style="flex: 2;">Details</button>
            <button class="btn action-btn-danger" data-action="remove" data-id="${
              product.id
            }" style="flex: 1; background: #991b1b; color: #fef2f2; border: none; font-weight: bold; font-size: 11px;">STOP</button>
          </div>
        </div>
      </div>
    `;
  }

  function applyFilters() {
    state.filteredProducts = state.products.filter((product) => {
      if (state.currentFilter !== "all") {
        if (state.currentFilter === "price-drop") {
          if (!(product.change24h !== null && product.change24h < 0))
            return false;
        } else {
          if (product.marketplace !== state.currentFilter) return false;
        }
      }

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        if (!product.name.toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }

  function renderProducts() {
    const grid = el("productsGrid");
    const emptyState = el("emptyState");
    if (!grid || !emptyState) return;

    applyFilters();

    if (state.filteredProducts.length === 0) {
      grid.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    grid.style.display = "grid";
    emptyState.style.display = "none";

    const productsToRender = state.filteredProducts.slice(
      0,
      state.displayedCount
    );
    grid.innerHTML = productsToRender.map(createProductCard).join("");

    if (state.filteredProducts.length > state.displayedCount) {
      const loadMoreBtn = document.createElement("div");
      loadMoreBtn.style.cssText =
        "grid-column: 1 / -1; text-align: center; padding: 20px;";
      loadMoreBtn.innerHTML = `
        <button class="btn btn-primary" data-action="load-more" style="padding: 12px 24px;">
          Load More (${
            state.filteredProducts.length - state.displayedCount
          } remaining)
        </button>
      `;
      grid.appendChild(loadMoreBtn);
    }

    grid.onchange = (e) => {
      const select = e.target.closest('[data-action="change-interval"]');
      if (select) updateInterval(select.dataset.id, select.value, e);
    };

    grid.onclick = (e) => {
      const btn = e.target.closest("[data-action]");
      if (btn) {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === "remove") removeProduct(id);
        else if (action === "details") openProductDetail(id);
        else if (action === "load-more") {
          state.displayedCount += CONFIG.PRODUCTS_PER_PAGE;
          renderProducts();
        }
      }
    };
  }

  setInterval(() => {
    if (document.hidden) return;

    requestAnimationFrame(() => {
      const now = new Date();
      const timers = document.querySelectorAll(".countdown-timer");
      const updates = [];

      timers.forEach((container) => {
        if (container.offsetParent === null) return;

        let nextRunStr = container.dataset.nextRun;
        const display = container.querySelector(".timer-display");

        if (
          !nextRunStr ||
          nextRunStr === "undefined" ||
          nextRunStr === "null"
        ) {
          updates.push({ display, text: "Not scheduled", color: null });
          return;
        }

        if (nextRunStr.includes(".")) {
          nextRunStr = nextRunStr.split(".")[0] + "Z";
        }

        const nextRun = new Date(nextRunStr);
        const diff = nextRun - now;

        if (isNaN(diff)) {
          updates.push({ display, text: "Invalid Date", color: null });
        } else if (diff <= 0) {
          updates.push({ display, text: "Loading...", color: "#10b981" });
        } else {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          const newText = `${h}h ${String(m).padStart(2, "0")}m ${String(
            s
          ).padStart(2, "0")}s`;
          updates.push({ display, text: newText, color: "#3b82f6" });
        }
      });

      updates.forEach(({ display, text, color }) => {
        if (display) {
          display.textContent = text;
          if (color) display.style.color = color;
        }
      });
    });
  }, 1000);

  setInterval(async () => {
    if (!navigator.onLine || !state.serverConnected || document.hidden) {
      return;
    }

    const scrapingProducts = document.querySelectorAll(
      '.timer-display[style*="color: rgb(16, 185, 129)"]'
    );

    if (scrapingProducts.length > 0) {
      await refreshDashboard(false);
    } else {
      const timeSinceLastUpdate = Date.now() - state.lastUpdate;
      if (timeSinceLastUpdate >= CONFIG.REFRESH_INTERVAL_MS) {
        await refreshDashboard(false);
      }
    }
  }, 60000); // 1 minute - increased from 30s to minimize API calls and image reloads

  async function removeProduct(productId) {
    if (!confirm("Are you sure you want to stop tracking this product?"))
      return;

    try {
      await apiFetch(API.DASHBOARD_PRODUCT_DETAIL(productId), {
        method: "DELETE",
      });
      cache.delete(API.DASHBOARD_PRODUCTS);
      state.products = state.products.filter((p) => p.id !== productId);
      updateStats();
      renderProducts();
    } catch (error) {
      alert("Failed to remove product. Please check your connection.");
    }
  }

  async function updateInterval(productId, hours, event) {
    if (event) event.stopPropagation();
    const select = event?.target;
    if (!select) return;

    const oldValue = select.value;

    try {
      select.disabled = true;
      select.style.background = "#fbbf24";

      const response = await apiFetch(API.PRODUCT_INTERVAL(productId), {
        method: "PATCH",
        body: JSON.stringify({ update_interval: parseInt(hours) }),
      });

      cache.delete(API.DASHBOARD_PRODUCTS);
      cache.delete(API.DASHBOARD_PRODUCT_DETAIL(productId));

      const product = state.products.find((p) => p.id === productId);
      if (product) {
        product.update_interval = parseInt(hours);

        if (response.next_run_at) {
          product.nextRun = response.next_run_at;

          const timerEl = document.querySelector(
            `.product-card[data-id="${productId}"] .countdown-timer`
          );
          if (timerEl) {
            timerEl.dataset.nextRun = response.next_run_at;
          }
        }
      }

      select.style.background = "#10b981";
      setTimeout(() => {
        select.disabled = false;
        select.style.background = "#0f172a";
      }, 1000);

      chrome.runtime.sendMessage({
        action: "updateProductAlarm",
        productId: productId,
        nextRunAt: response.next_run_at,
      });
    } catch (error) {
      alert("Could not save interval preference.");
      select.value = oldValue;
      select.style.background = "#ef4444";
      setTimeout(() => {
        select.disabled = false;
        select.style.background = "#0f172a";
      }, 1000);
    }
  }

  function updateStats() {
    const totalEl = el("totalProducts");
    const savedEl = el("totalSaved");
    const dropEl = el("biggestDrop");

    if (totalEl) totalEl.textContent = String(state.products.length);

    let biggestDrop = 0;
    const currencyTotals = {};
    const currencyCounts = {};

    for (const p of state.products) {
      const curr = p.currency || "USD";
      currencyCounts[curr] = (currencyCounts[curr] || 0) + 1;

      if (p.currentPrice !== null && p.maxPrice !== null) {
        const saved = p.maxPrice - p.currentPrice;
        if (saved > 0)
          currencyTotals[curr] = (currencyTotals[curr] || 0) + saved;

        if (p.maxPrice > 0) {
          const d = (p.maxPrice - p.currentPrice) / p.maxPrice;
          if (d > biggestDrop) biggestDrop = d;
        }
      }
    }

    let primaryCurrency = "USD";
    let maxCount = -1;
    for (const [curr, count] of Object.entries(currencyCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryCurrency = curr;
      }
    }

    const primarySavedTotal = currencyTotals[primaryCurrency] || 0;
    const breakdownParts = Object.entries(currencyTotals)
      .filter(([curr]) => curr !== primaryCurrency)
      .map(([curr, amt]) => formatCurrency(amt, curr));

    if (savedEl) {
      if (state.products.length === 0) {
        savedEl.textContent = "—";
      } else {
        savedEl.innerHTML = `
          <div>${formatCurrency(primarySavedTotal, primaryCurrency)}</div>
          ${
            breakdownParts.length > 0
              ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 400; margin-top: 4px;">+ ${breakdownParts.join(
                  " + "
                )}</div>`
              : ""
          }
        `;
      }
    }

    if (dropEl) dropEl.textContent = `${(biggestDrop * 100).toFixed(1)}%`;
  }

  let detailChart = null;

  function ensureChartJsLoaded() {
    if (window.Chart) return Promise.resolve(true);
    return Promise.reject(new Error("Chart.js not found."));
  }

  function ensureDetailModal() {
    if (el("qbDetailModal")) return;

    const modal = document.createElement("div");
    modal.id = "qbDetailModal";
    modal.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55);
      z-index:999999; display:none; align-items:center; justify-content:center;
      padding:24px;
    `;

    modal.innerHTML = `
      <div style="width:min(1000px, 96vw); max-height:92vh; overflow:auto; border-radius:16px; border:1px solid rgba(59,130,246,0.25); background:linear-gradient(135deg, rgba(20,24,41,0.96), rgba(30,40,70,0.92)); backdrop-filter: blur(10px); padding:18px;">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px;">
          <div>
            <div id="qbDetailTitle" style="font-size:18px; font-weight:800; color:#e2e8f0;">Loading...</div>
            <div id="qbDetailMeta" style="font-size:12px; color:#94a3b8; margin-top:4px;"></div>
          </div>
          <div style="display:flex; gap:10px;">
            <button id="qbRecomputeAI" class="btn btn-secondary" style="padding:8px 12px;">Recompute AI</button>
            <button id="qbCloseModal" class="btn btn-primary" style="padding:8px 12px;">Close</button>
          </div>
        </div>
        <div style="display:grid; grid-template-columns: 1.3fr 1fr; gap:16px;">
          <div style="border:1px solid rgba(59,130,246,0.18); border-radius:12px; padding:14px; background:rgba(10,14,39,0.35);">
            <div style="font-weight:700; margin-bottom:10px;">Price History</div>
            <div style="position: relative; height: 200px; width: 100%;">
              <canvas id="qbPriceChart"></canvas>
            </div>
            <div id="qbChartEmpty" style="display:none; margin-top:10px; font-size:12px; color:#94a3b8;">
              Not enough price snapshots yet to display a chart.
            </div>
          </div>
          <div style="border:1px solid rgba(59,130,246,0.18); border-radius:12px; padding:14px; background:rgba(10,14,39,0.35);">
            <div style="font-weight:700; margin-bottom:10px;">AI Insight</div>
            <div id="qbAiBox" style="font-size:13px; color:#cbd5e1; line-height:1.5;">Loading insight...</div>
          </div>
        </div>
        <div style="margin-top:16px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div id="qbNumbers" style="font-size:13px; color:#94a3b8;"></div>
          <div><button id="qbOpenProduct" class="btn btn-primary">Open Product</button></div>
        </div>
      </div>
    `;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeDetailModal();
    });
    document.body.appendChild(modal);
    el("qbCloseModal").onclick = closeDetailModal;
  }

  async function setupDynamicFilters() {
    const filterContainer = document.querySelector(".filters");
    if (!filterContainer) return;

    const marketplaces = new Set();
    state.products.forEach((product) => {
      if (product.marketplace) {
        marketplaces.add(product.marketplace.toLowerCase());
      }
    });

    const marketplaceNames = {
      amazon: { name: "Amazon" },
      noon: { name: "Noon" },
      alibaba: { name: "Alibaba" },
      aliexpress: { name: "AliExpress" },
      shein: { name: "Shein" },
      ebay: { name: "eBay" },
      jumia: { name: "Jumia" },
      nike: { name: "Nike" },
      adidas: { name: "Adidas" },
    };

    const existingFilters = filterContainer.querySelectorAll(".filter-btn");
    existingFilters.forEach((btn) => {
      const filter = btn.dataset.filter;
      if (filter !== "all" && filter !== "price-drop") {
        btn.remove();
      }
    });

    const sortedMarketplaces = Array.from(marketplaces).sort();

    sortedMarketplaces.forEach((marketplace) => {
      const config = marketplaceNames[marketplace] || { name: marketplace };

      const btn = document.createElement("button");
      btn.className = "filter-btn";
      btn.dataset.filter = marketplace;
      btn.textContent = config.name;

      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.currentFilter = marketplace;
        state.displayedCount = CONFIG.PRODUCTS_PER_PAGE;
        renderProducts();
      });

      const priceDropBtn = filterContainer.querySelector(
        '[data-filter="price-drop"]'
      );
      if (priceDropBtn) {
        filterContainer.insertBefore(btn, priceDropBtn);
      } else {
        filterContainer.appendChild(btn);
      }
    });

    const allBtn = filterContainer.querySelector('[data-filter="all"]');
    const priceDropBtn = filterContainer.querySelector(
      '[data-filter="price-drop"]'
    );

    if (allBtn) {
      allBtn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-btn")
          .forEach((b) => b.classList.remove("active"));
        allBtn.classList.add("active");
        state.currentFilter = "all";
        state.displayedCount = CONFIG.PRODUCTS_PER_PAGE;
        renderProducts();
      });
    }

    if (priceDropBtn) {
      priceDropBtn.addEventListener("click", () => {
        document
          .querySelectorAll(".filter-btn")
          .forEach((b) => b.classList.remove("active"));
        priceDropBtn.classList.add("active");
        state.currentFilter = "price-drop";
        state.displayedCount = CONFIG.PRODUCTS_PER_PAGE;
        renderProducts();
      });
    }
  }

  function openDetailModal() {
    const modal = el("qbDetailModal");
    if (modal) modal.style.display = "flex";
  }

  function closeDetailModal() {
    const modal = el("qbDetailModal");
    if (modal) modal.style.display = "none";
    state.selectedProductId = null;
    if (detailChart) {
      detailChart.destroy();
      detailChart = null;
    }
  }

  async function openProductDetail(productId) {
    ensureDetailModal();
    openDetailModal();
    state.selectedProductId = productId;

    const titleEl = el("qbDetailTitle");
    const metaEl = el("qbDetailMeta");
    const aiEl = el("qbAiBox");
    const numsEl = el("qbNumbers");
    const emptyEl = el("qbChartEmpty");

    titleEl.textContent = "Loading...";
    metaEl.textContent = "";
    aiEl.textContent = "Loading insight...";
    numsEl.textContent = "";
    if (emptyEl) emptyEl.style.display = "none";

    try {
      ensureChartJsLoaded();
      const detail = await apiFetch(API.DASHBOARD_PRODUCT_DETAIL(productId));

      titleEl.textContent = detail.title || "Untitled Product";
      metaEl.textContent = `${marketplaceName(detail.marketplace)} · ${
        detail.currency || "USD"
      }`;

      el("qbOpenProduct").onclick = () => {
        if (detail.url)
          window.open(detail.url, "_blank", "noopener,noreferrer");
      };

      el("qbRecomputeAI").onclick = async () => {
        aiEl.textContent = "Computing AI insight...";
        try {
          await apiFetch(API.AI_COMPUTE(productId), { method: "POST" });
          cache.delete(API.AI_LATEST(productId));
          const latest = await apiFetch(API.AI_LATEST(productId));
          renderAIInsight(aiEl, latest);
        } catch (e) {
          aiEl.textContent = `AI compute failed: ${e.message}`;
        }
      };

      const history = Array.isArray(detail.history) ? detail.history : [];
      const points = history
        .filter((p) => p && p.price !== null)
        .slice(-CONFIG.CHART_MAX_POINTS);

      if (detailChart) {
        detailChart.destroy();
        detailChart = null;
      }

      const canvas = el("qbPriceChart");

      if (points.length < 2) {
        if (emptyEl) emptyEl.style.display = "block";
        if (canvas) canvas.style.display = "none";
      } else {
        if (emptyEl) emptyEl.style.display = "none";
        if (canvas) canvas.style.display = "block";

        const labels = points.map((p) =>
          new Date(p.fetched_at).toLocaleString()
        );
        const values = points.map((p) => p.price);

        detailChart = new Chart(canvas, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Price",
                data: values,
                tension: 0.25,
                spanGaps: true,
                borderWidth: 2,
                pointRadius: 2,
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { ticks: { maxTicksLimit: 6 } } },
          },
        });
      }

      numsEl.innerHTML = `<b>Last:</b> ${formatCurrency(
        detail.last_price,
        detail.currency
      )} · <b>Min:</b> ${formatCurrency(
        detail.min_price,
        detail.currency
      )} · <b>Max:</b> ${formatCurrency(
        detail.max_price,
        detail.currency
      )} · <b>Points:</b> ${history.length}`;

      if (detail.ai_latest) {
        renderAIInsight(aiEl, detail.ai_latest);
      } else {
        try {
          const latest = await apiFetch(API.AI_LATEST(productId));
          renderAIInsight(aiEl, latest);
        } catch {
          aiEl.textContent = "No AI insight found yet. Click Recompute AI.";
        }
      }
    } catch (e) {
      titleEl.textContent = "Failed to load product";
      aiEl.textContent = e.message;
    }
  }

  function renderAIInsight(aiEl, insight) {
    if (!aiEl) return;
    const x = insight || {};
    const trend = x.trend || "unknown";
    const rec = x.recommendation || "watch";
    const conf =
      x.confidence !== undefined ? `${Math.round(x.confidence * 100)}%` : "—";

    const explanation = x.explanation || "";
    const last = x.last_price ?? null;
    const min = x.min_price ?? null;
    const max = x.max_price ?? null;
    const avg = x.avg_price ?? null;
    const vol = x.volatility ?? null;
    const ch7 = x.pct_change_7d ?? null;

    aiEl.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <span style="padding:4px 10px;border-radius:999px;border:1px solid rgba(59,130,246,0.35); color:#93c5fd;">Trend: <b>${escapeHtml(
          trend
        )}</b></span>
        <span style="padding:4px 10px;border-radius:999px;border:1px solid rgba(34,197,94,0.25); color:#86efac;">Rec: <b>${escapeHtml(
          rec.toUpperCase()
        )}</b></span>
        <span style="padding:4px 10px;border-radius:999px;border:1px solid rgba(148,163,184,0.25); color:#e2e8f0;">Confidence: <b>${escapeHtml(
          conf
        )}</b></span>
      </div>
      <div style="font-size:12px; color:#94a3b8; margin-bottom:10px;">
        Last: <b>${last ?? "—"}</b> · Min: <b>${min ?? "—"}</b> · Max: <b>${
      max ?? "—"
    }</b> · Avg: <b>${avg ?? "—"}</b>
      </div>
      <div style="font-size:12px; color:#94a3b8; margin-bottom:10px;">
        7d Change: <b>${
          ch7 === null ? "—" : Number(ch7).toFixed(1) + "%"
        }</b> · Volatility: <b>${vol === null ? "—" : vol.toFixed(2)}</b>
      </div>
      <div style="color:#cbd5e1;">${escapeHtml(
        explanation || "No explanation."
      )}</div>
    `;
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
      alert("Failed to export data");
    }
  }

  let searchTimeout = null;

  async function setupEventListeners() {
    const searchInput = el("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.searchQuery = e.target.value || "";
          state.displayedCount = CONFIG.PRODUCTS_PER_PAGE;
          renderProducts();
        }, CONFIG.DEBOUNCE_DELAY_MS);
      });
    }

    await setupDynamicFilters();

    const exportBtn = el("exportBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", exportData);
    }

    const refreshBtn = el("refreshBtn");
    if (refreshBtn) {
      refreshBtn.onclick = () => refreshDashboard(true);
    }

    const qbRefreshBtn = document.getElementById("qbRefreshBtn");
    if (qbRefreshBtn) {
      qbRefreshBtn.addEventListener("click", () => location.reload());
    }

    const logoutBtn = el("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!confirm("Are you sure you want to logout?")) return;
        if (authService?.logout) {
          await authService.logout();
        }
        chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
        window.close();
      });
    }
  }

  let isRefreshing = false;

  async function refreshDashboard(showToast = false) {
    if (isRefreshing) return;
    if (!navigator.onLine) return;
    if (!state.serverConnected) return;

    try {
      isRefreshing = true;
      state.loading = true;

      const [products, alertsCount] = await Promise.all([
        loadProductsFromBackend(),
        loadActiveAlertsCount(),
      ]);

      state.products = products;
      state.activeAlerts = alertsCount;
      state.lastUpdate = Date.now();
      state.displayedCount = CONFIG.PRODUCTS_PER_PAGE;

      updateStats();
      await setupDynamicFilters();
      renderProducts();

      if (showToast) alert("Dashboard refreshed");
    } catch (error) {
      if (error.message === "CONNECTION_LOST") {
        updateConnectionUI(false);
        const grid = el("productsGrid");
        if (grid) {
          grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
              <div style="background: #334155; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <span style="font-size: 30px;">:(</span>
              </div>
              <h3 style="color: white; font-size: 18px; margin-bottom: 8px;">Connection Lost</h3>
              <p style="color: #94a3b8; font-size: 14px; max-width: 300px; margin: 0 auto 16px;">
                Cannot reach the server. Retrying...
              </p>
              <div style="display: inline-block; width: 20px; height: 20px; border: 2px solid #475569; border-top-color: #3b82f6; border-radius: 50%; animation: qb-spin 0.8s linear infinite;"></div>
            </div>
          `;
        }
      } else if (error) {
        const grid = el("productsGrid");
        if (grid && state.products.length === 0) {
          grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: #1e293b; border-radius: 12px; border: 1px solid #991b1b;">
              <div style="background: #7f1d1d; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <span style="font-size: 30px;">:(</span>
              </div>
              <h3 style="color: white; font-size: 18px; margin-bottom: 8px;">Server Error</h3>
              <p style="color: #94a3b8; font-size: 14px; max-width: 300px; margin: 0 auto 16px;">
                The server encountered an error. Please try again in a moment.
              </p>
              <button class="btn btn-primary" id="qbRefreshBtn" style="margin-top: 12px;">Refresh Page</button>
            </div>
          `;
        }
      }
    } finally {
      state.loading = false;
      isRefreshing = false;
    }
  }

  async function checkInitialServerConnection() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${API_BASE}/health`, {
        signal: controller.signal,
        method: "HEAD",
        cache: "no-store",
      });

      clearTimeout(timeout);
      return response.ok && response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async function init() {
    if (typeof authService !== "undefined" && authService.init) {
      const isAuthenticated = await authService.init();

      if (!isAuthenticated) {
        chrome.action.openPopup().catch(() => {
          chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
        });
        return;
      }

      if (authService.user) {
        const emailEl = el("userEmail");
        if (emailEl) {
          emailEl.textContent = authService.user.email;
        }
      }
    }

    showLoadingSkeletons();

    const isConnected =
      navigator.onLine && (await checkInitialServerConnection());
    updateConnectionUI(isConnected);

    setupEventListeners();
    if (!isConnected) {
      startReconnectMonitor();
    }

    await refreshDashboard(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.openProductDetail = openProductDetail;
  window.updateInterval = updateInterval;

  console.log("[Dashboard] Initialized.");
})();
