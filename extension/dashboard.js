/**
 * QuickBasket AI - Dashboard Script
 */

(function () {
  "use strict";

  console.log("[QB Dashboard] Backend dashboard loading...");

  const CONFIG = {
    PRICE_DECIMALS: 2,
    CHART_MAX_POINTS: 120,
  };

  const QB = self.QB_CONFIG || null;
  const API_BASE = QB?.API?.BASE_URL || "http://127.0.0.1:8000";

  const API = {
    DASHBOARD_PRODUCTS: `${API_BASE}/dashboard/products`,
    DASHBOARD_PRODUCT_DETAIL: (id) => `${API_BASE}/dashboard/products/${id}`,
    ALERTS_PENDING: `${API_BASE}${
      QB?.API?.ROUTES?.ALERTS_PENDING || "/api/v1/alerts/pending"
    }`,
    AI_COMPUTE: (id) => `${API_BASE}/api/v1/ai/products/${id}/insight`,
    AI_LATEST: (id) => `${API_BASE}/api/v1/ai/products/${id}/insight/latest`,
  };

  let state = {
    products: [],
    filteredProducts: [],
    currentFilter: "all",
    searchQuery: "",
    loading: false,
    selectedProductId: null,
    activeAlerts: 0,
  };

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
    if (x === "amazon") return "Amazon";
    if (x === "noon") return "Noon";
    return x || "Unknown";
  }

  async function apiFetch(url, opts = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        ...opts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(opts.headers || {}),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} ${text}`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) return await res.json();
      return await res.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function ensureChartJsLoaded() {
    if (window.Chart) return Promise.resolve(true);
    return Promise.reject(
      new Error("Chart.js not found. Ensure vendor/chart.umd.min.js is loaded.")
    );
  }

  async function loadProductsFromBackend() {
    const rows = await apiFetch(API.DASHBOARD_PRODUCTS);
    if (!rows || !Array.isArray(rows)) return [];

    const uniqueMap = new Map();

    rows.forEach((p) => {
      const cleanUrl = p.url.split("?")[0].split("#")[0].toLowerCase().trim();

      if (!uniqueMap.has(cleanUrl)) {
        uniqueMap.set(cleanUrl, {
          id: String(p.id),
          name: p.title || "Untitled Product",
          marketplace: (p.marketplace || "").toLowerCase(),
          currency: p.currency || "EGP",
          currentPrice: safeFloat(p.last_price),
          minPrice: safeFloat(p.min_price),
          maxPrice: safeFloat(p.max_price),
          url: p.url,
          image: p.image_url || null,
          snapshots: parseInt(p.snapshots) || 0,
          trackedDays: parseInt(p.tracked_days) || 0,
          lastUpdated: p.last_updated || null,
          change24h: safeFloat(p.change_24h),
        });
      } else {
        const existing = uniqueMap.get(cleanUrl);
        existing.snapshots += parseInt(p.snapshots) || 0;

        if (new Date(p.last_updated) > new Date(existing.lastUpdated)) {
          existing.currentPrice = safeFloat(p.last_price);
          existing.lastUpdated = p.last_updated;
          existing.change24h = safeFloat(p.change_24h);
          existing.id = String(p.id);
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

  function viewProduct(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product || !product.url) return;
    window.open(product.url, "_blank", "noopener,noreferrer");
  }

  async function removeProduct(productId) {
    if (!confirm("Are you sure you want to stop tracking this product?"))
      return;

    try {
      await apiFetch(API.DASHBOARD_PRODUCT_DETAIL(productId), {
        method: "DELETE",
      });
      state.products = state.products.filter((p) => p.id !== productId);
      updateStats();
      renderProducts();
    } catch (error) {
      console.error("[QB Dashboard] Remove error:", error);
      alert("Failed to remove product. Please try again.");
    }
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

  function createProductCard(product) {
    const mp = marketplaceName(product.marketplace);
    const currentPrice = formatCurrency(product.currentPrice, product.currency);
    const minPrice = formatCurrency(product.minPrice, product.currency);
    const maxPrice = formatCurrency(product.maxPrice, product.currency);

    let badgeHtml = "";
    const change = safeFloat(product.change24h);
    const current = safeFloat(product.currentPrice);

    if (change !== null && current !== null) {
      const isDown = change < 0;
      const isUp = change > 0;

      let cls = "badge-stable";
      let arrow = "•";

      if (isDown) {
        cls = "badge-down"; // Green
        arrow = "↓";
      } else if (isUp) {
        cls = "badge-up"; // Red
        arrow = "↑";
      }

      const amount = Math.abs(change);
      const prevPrice = current - change;
      let pctStr = " (0%)";

      if (prevPrice > 0 && (isDown || isUp)) {
        const pctValue = (amount / prevPrice) * 100;
        pctStr = ` (${pctValue.toFixed(1)}%)`;
      }

      badgeHtml = `
        <div class="product-badge ${cls}">
          ${arrow} 24h ${formatCurrency(amount, product.currency)}${pctStr}
        </div>
      `;
    }

    return `
      <div class="product-card" data-id="${escapeHtml(
        product.id
      )}" style="cursor:pointer;">
        ${badgeHtml}
        <div class="product-image">
          ${
            product.image
              ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(
                  product.name
                )}" loading="lazy">`
              : `<div style="color:#64748b;font-size:48px;">📦</div>`
          }
        </div>
        <div class="product-marketplace">${escapeHtml(mp)}</div>
        <div class="product-name" title="${escapeHtml(product.name)}">
          ${escapeHtml(product.name)}
        </div>
        <div class="price-info">
          <div class="current-price">${currentPrice}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px;">
            Min: ${minPrice} · Max: ${maxPrice}
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">
            Snapshots: ${product.snapshots} · Days: ${product.trackedDays}
          </div>
        </div>
        <div class="product-actions">
          <button class="action-btn action-btn-primary" data-action="details" data-id="${escapeHtml(
            product.id
          )}">Details</button>
          <button class="action-btn action-btn-danger" data-action="remove" data-id="${escapeHtml(
            product.id
          )}">Remove</button>
        </div>
      </div>
    `;
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
    grid.innerHTML = state.filteredProducts.map(createProductCard).join("");

    grid.onclick = (e) => {
      const btn = e.target.closest("[data-action]");
      if (btn) {
        e.stopPropagation();
        const { action, id } = btn.dataset;
        if (action === "remove") removeProduct(id);
        else if (action === "details") openProductDetail(id);
        return;
      }

      const card = e.target.closest(".product-card");
      if (card) viewProduct(card.dataset.id);
    };
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

  function updateStats() {
    const totalEl = el("totalProducts");
    const savedEl = el("totalSaved");
    const dropEl = el("biggestDrop");
    const alertsEl = el("activeAlerts");

    if (totalEl) totalEl.textContent = String(state.products.length);

    let biggestDrop = 0;
    const currencyTotals = {};
    const currencyCounts = {};

    for (const p of state.products) {
      const curr = p.currency || "EGP";
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

    let primaryCurrency = "EGP";
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
    if (alertsEl) alertsEl.textContent = String(state.activeAlerts || 0);
  }

  let detailChart = null;

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
      <div style="
        width:min(1000px, 96vw);
        max-height:92vh;
        overflow:auto;
        border-radius:16px;
        border:1px solid rgba(59,130,246,0.25);
        background:linear-gradient(135deg, rgba(20,24,41,0.96), rgba(30,40,70,0.92));
        backdrop-filter: blur(10px);
        padding:18px;
      ">
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
          <div>
            <button id="qbOpenProduct" class="btn btn-primary">Open Product</button>
          </div>
        </div>
      </div>
    `;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeDetailModal();
    });
    document.body.appendChild(modal);
    el("qbCloseModal").onclick = closeDetailModal;
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
        detail.currency || "EGP"
      }`;

      el("qbOpenProduct").onclick = () => {
        if (detail.url)
          window.open(detail.url, "_blank", "noopener,noreferrer");
      };

      el("qbRecomputeAI").onclick = async () => {
        aiEl.textContent = "Computing AI insight...";
        try {
          await apiFetch(API.AI_COMPUTE(productId), { method: "POST" });
          const latest = await apiFetch(API.AI_LATEST(productId));
          renderAIInsight(aiEl, latest);
        } catch (e) {
          aiEl.textContent = `AI compute failed: ${e.message}`;
        }
      };

      document.getElementById("qbOpenProduct").onclick = () => {
        const url = detail.url;
        if (!url) return;
        try {
          chrome.tabs.create({ url });
        } catch {
          window.open(url, "_blank");
        }
      };

      const history = Array.isArray(detail.history) ? detail.history : [];
      const points = history
        .filter((p) => p && p.price !== null)
        .slice(-CONFIG.CHART_MAX_POINTS);
      console.log(
        "History Length:",
        history.length,
        "Points Length:",
        points.length
      );

      if (detailChart) {
        detailChart.destroy();
        detailChart = null;
      }

      const canvas = el("qbPriceChart");

      if (points.length < 2) {
        if (emptyEl) emptyEl.style.display = "block";
        if (canvas) canvas.style.display = "none"; // Hide canvas if not enough data
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

      if (detail.ai_latest) renderAIInsight(aiEl, detail.ai_latest);
      else {
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
        7d Change: <b>${ch7 === null ? "—" : Number(ch7).toFixed(1) + "%"}</b>
 · Volatility: <b>${vol === null ? "—" : vol.toFixed(2)}</b>
      </div>
      <div style="color:#cbd5e1;">${escapeHtml(
        explanation || "No explanation."
      )}</div>
    `;
  }

  function setupEventListeners() {
    const searchInput = el("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        state.searchQuery = e.target.value || "";
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

    if (el("settingsBtn"))
      el("settingsBtn").onclick = () => refreshDashboard(true);
  }

  async function refreshDashboard(showToast = false) {
    try {
      state.loading = true;
      const [products, alertsCount] = await Promise.all([
        loadProductsFromBackend(),
        loadActiveAlertsCount(),
      ]);
      state.products = products;
      state.activeAlerts = alertsCount;
      updateStats();
      renderProducts();
      if (showToast) alert("Dashboard refreshed ✓");
    } catch (e) {
      console.error(e);
      alert("Failed to load dashboard data.");
    } finally {
      state.loading = false;
    }
  }

  async function init() {
    setupEventListeners();
    await refreshDashboard(false);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();

  // expose detail opener
  window.openProductDetail = openProductDetail;
})();
