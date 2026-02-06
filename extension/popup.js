

(function () {
  "use strict";


  const CONFIG = {
    PRICE_DECIMALS: 2,
    MAX_NAME_LENGTH: 100,
  };


  const elements = {
    trackBtn: null,
    btnText: null,
    status: null,
    productInfo: null,
    productName: null,
    productPrice: null,
    productImage: null,
    openDashboard: null,
  };


  let currentProduct = null;
  let currentTab = null;
  let isTracked = false;





  async function getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab;
    } catch (error) {
      console.error("[QB Popup] Error getting current tab:", error);
      return null;
    }
  }

  const VALID_DOMAINS = new Set([
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
    "noon.com",
  ]);

  function isValidProductUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== "https:") return false;
      return Array.from(VALID_DOMAINS).some((domain) =>
        urlObj.hostname.includes(domain)
      );
    } catch {
      return false;
    }
  }

  const tempDiv = document.createElement("div");
  function escapeHtml(text) {
    if (typeof text !== "string") return "";
    tempDiv.textContent = text;
    return tempDiv.innerHTML;
  }

  function formatPrice(price, currency = "USD") {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return "N/A";
    return `${escapeHtml(currency)} ${numPrice.toFixed(CONFIG.PRICE_DECIMALS)}`;
  }





  function showStatus(message, type = "success") {
    if (!elements.status) return;

    elements.status.textContent = message;
    elements.status.className = `status ${type} show`;


    setTimeout(() => {
      elements.status.classList.remove("show");
    }, 5000);
  }

  function setButtonState(state) {
    if (!elements.trackBtn || !elements.btnText) return;

    switch (state) {
      case "loading":
        elements.trackBtn.disabled = true;
        elements.btnText.innerHTML =
          'Tracking... <span class="loading"></span>';
        break;

      case "tracked":
        elements.trackBtn.disabled = false;
        elements.btnText.textContent = "Tracked ";
        elements.trackBtn.style.background =
          "linear-gradient(135deg, 059669 0%, 047857 100%)";
        break;

      case "ready":
      default:
        elements.trackBtn.disabled = false;
        elements.btnText.textContent = "Track This Product";
        elements.trackBtn.style.background = "";
        break;
    }
  }

  function displayProduct(product) {
    if (!product || !elements.productInfo) return;

    try {
      const name = escapeHtml(product.name || "Unknown Product").substring(
        0,
        CONFIG.MAX_NAME_LENGTH
      );

      const price = formatPrice(product.price, product.currency);

      elements.productName.textContent = name;
      elements.productPrice.textContent = price;


      if (product.image && elements.productImage) {
        elements.productImage.src = product.image;
        elements.productImage.style.display = "block";
      }

      elements.productInfo.style.display = "block";

      currentProduct = product;
    } catch (error) {
      console.error("[QB Popup] Error displaying product:", error);
    }
  }

  function hideProduct() {
    if (elements.productInfo) {
      elements.productInfo.style.display = "none";
    }
  }





  function initElements() {
    elements.trackBtn = document.getElementById("trackBtn");
    elements.btnText = document.getElementById("btnText");
    elements.status = document.getElementById("status");
    elements.productInfo = document.getElementById("productInfo");
    elements.productName = document.getElementById("productName");
    elements.productPrice = document.getElementById("productPrice");
    elements.productImage = document.getElementById("productImage");
    elements.openDashboard = document.getElementById("openDashboard");
  }

  function setupEventListeners() {
    if (elements.trackBtn) {
      elements.trackBtn.addEventListener("click", handleTrackClick);
    }

    if (elements.openDashboard) {
      elements.openDashboard.addEventListener("click", handleDashboardClick);
    }
  }

  async function init() {
    initElements();
    setupEventListeners();

    currentTab = await getCurrentTab();
    if (!currentTab) {
      showStatus("Could not access current tab", "error");
      if (elements.trackBtn) elements.trackBtn.disabled = true;
      return;
    }

    const url = currentTab.url || "";

    if (!isValidProductUrl(url)) {
      showStatus("Not on a supported marketplace", "error");
      if (elements.trackBtn) elements.trackBtn.disabled = true;
      hideProduct();
      return;
    }

    console.log("[QB Popup] Ready on product page - waiting for user action");
    setButtonState("ready");
  }





  async function handleTrackClick() {
    if (isTracked) {

      showStatus("This product is already being tracked!", "success");
      return;
    }

    setButtonState("loading");

    try {
      if (!currentTab) {
        throw new Error("No tab information available");
      }

      if (!isValidProductUrl(currentTab.url)) {
        throw new Error("Not on a supported product page");
      }

      console.log("[QB Popup] Requesting product extraction...");


      const extractPromise = chrome.tabs.sendMessage(currentTab.id, {
        action: "extractProduct",
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Content script not responding. Please refresh the page."
              )
            ),
          10000
        );
      });

      const extractResponse = await Promise.race([
        extractPromise,
        timeoutPromise,
      ]);

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      if (!extractResponse?.success) {
        throw new Error(
          extractResponse?.error || "Failed to extract product data"
        );
      }

      const product = extractResponse.product;
      console.log("[QB Popup] Product extracted:", product);


      displayProduct(product);


      console.log("[QB Popup] Sending to background for storage...");
      const trackResponse = await chrome.runtime.sendMessage({
        action: "trackProduct",
        url: currentTab.url,
        product: product,
      });

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      if (trackResponse?.success) {
        isTracked = true;
        setButtonState("tracked");
        showStatus("Product tracked successfully! ", "success");
        if (trackResponse?.success) {
          isTracked = true;
          setButtonState("tracked");

          const aiSummary =
            trackResponse?.backend?.data?.ai?.summary ||
            trackResponse?.backend?.data?.ai?.decision ||
            null;

          if (aiSummary) {
            showStatus(`AI: ${aiSummary}`, "success");
          } else {
            showStatus("Product tracked successfully! ", "success");
          }
          console.log("[QB Popup] Product tracked successfully");
        } else {
          throw new Error(trackResponse?.error || "Failed to save product");
        }
      }
    } catch (error) {
      console.error("[QB Popup] Track error:", error);

      let errorMessage = "Failed to track product";

      if (
        error.message.includes("receiving end") ||
        error.message.includes("Could not establish connection")
      ) {
        errorMessage = "Please refresh the page and try again";
      } else if (
        error.message.includes("timeout") ||
        error.message.includes("not responding")
      ) {
        errorMessage = "Page not responding. Please refresh and try again.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      showStatus(errorMessage, "error");
      setButtonState("ready");
    }
  }

  function handleDashboardClick(e) {
    e.preventDefault();

    try {
      chrome.tabs.create({
        url: chrome.runtime.getURL("dashboard.html"),
      });
    } catch (error) {
      console.error("[QB Popup] Dashboard error:", error);
      showStatus("Could not open dashboard", "error");
    }
  }





  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.addEventListener("beforeunload", () => {
    currentProduct = null;
    currentTab = null;
  });
})();
