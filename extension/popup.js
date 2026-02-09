(function () {
  "use strict";

  const CONFIG = {
    PRICE_DECIMALS: 2,
    MAX_NAME_LENGTH: 100,
    VALIDATION_DEBOUNCE: 300,
  };

  const state = {
    currentTab: null,
    currentProduct: null,
    isTracked: false,
    isAuthMode: true,
    validationTimeout: null,
  };

  const elements = {};

  function el(id) {
    if (!elements[id]) {
      elements[id] = document.getElementById(id);
    }
    return elements[id];
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

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatPrice(price, currency = "USD") {
    const numPrice = parseFloat(price);
    if (isNaN(numPrice)) return "N/A";
    return `${escapeHtml(currency)} ${numPrice.toFixed(CONFIG.PRICE_DECIMALS)}`;
  }

  function showMessage(message, type = "success", targetId = "authMessage") {
    const messageEl = el(targetId);
    if (!messageEl) return;

    messageEl.textContent = message;
    messageEl.className = `auth-message ${type} show`;

    setTimeout(() => {
      messageEl.classList.remove("show");
    }, 5000);
  }

  function setButtonLoading(buttonId, loading) {
    const btn = el(buttonId);
    if (!btn) return;

    if (loading) {
      btn.classList.add("loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  }

  function showFieldError(fieldId, errorId, message) {
    const field = el(fieldId);
    const error = el(errorId);

    if (field) field.classList.add("error");
    if (error) {
      error.textContent = message;
      error.classList.add("show");
    }
  }

  function clearFieldError(fieldId, errorId) {
    const field = el(fieldId);
    const error = el(errorId);

    if (field) field.classList.remove("error");
    if (error) error.classList.remove("show");
  }

  function validateEmailField(email) {
    clearFieldError("emailInput", "emailError");

    if (!email) {
      showFieldError("emailInput", "emailError", "Email is required");
      return false;
    }

    if (!authService.validateEmail(email)) {
      showFieldError(
        "emailInput",
        "emailError",
        "Please enter a valid email address"
      );
      return false;
    }

    return true;
  }

  function validatePasswordField(password, showStrength = false) {
    clearFieldError("passwordInput", "passwordError");

    if (!password) {
      showFieldError("passwordInput", "passwordError", "Password is required");
      return false;
    }

    const validation = authService.validatePassword(password);

    if (!validation.valid) {
      showFieldError("passwordInput", "passwordError", validation.error);
      return false;
    }

    if (showStrength) {
      updatePasswordStrength(password);
    }

    return true;
  }

  function updatePasswordStrength(password) {
    const strengthEl = el("passwordStrength");
    if (!strengthEl) return;

    let strength = "weak";
    let score = 0;

    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    if (score >= 4) strength = "strong";
    else if (score >= 3) strength = "medium";

    strengthEl.className = `password-strength ${strength} show`;
  }

  function switchToLogin() {
    el("loginTab").classList.add("active");
    el("registerTab").classList.remove("active");
    el("submitBtnText").textContent = "Login";
    el("passwordStrength").classList.remove("show");
    el("forgotPassword").style.display = "block";
  }

  function switchToRegister() {
    el("loginTab").classList.remove("active");
    el("registerTab").classList.add("active");
    el("submitBtnText").textContent = "Create Account";
    el("forgotPassword").style.display = "none";
  }

  function showAuthScreen() {
    el("authScreen").classList.remove("hidden");
    el("mainScreen").classList.remove("active");
    state.isAuthMode = true;
  }

  function showMainScreen() {
    el("authScreen").classList.add("hidden");
    el("mainScreen").classList.add("active");
    state.isAuthMode = false;

    if (authService.user) {
      const email = authService.user.email;
      el("userEmail").textContent = email;

      const avatar = el("userAvatar");
      if (avatar) {
        avatar.textContent = email.charAt(0).toUpperCase();
      }
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();

    const email = el("emailInput").value.trim();
    const password = el("passwordInput").value;
    const isLogin = el("loginTab").classList.contains("active");

    setButtonLoading("submitBtn", true);

    try {
      let result;

      if (isLogin) {
        result = await authService.login(email, password);
      } else {
        result = await authService.register(email, password);
      }

      if (result.success) {
        if (result.requiresConfirmation) {
          showMessage(result.message, "success");
          el("emailInput").value = "";
          el("passwordInput").value = "";
          switchToLogin();
        } else {
          showMessage(
            isLogin ? "Welcome back!" : "Account created!",
            "success"
          );
          setTimeout(() => {
            showMainScreen();
            checkCurrentPage();
          }, 800);
        }
      } else {
        showMessage(result.error, "error");
      }
    } catch (error) {
      showMessage("An unexpected error occurred. Please try again.", "error");
    } finally {
      setButtonLoading("submitBtn", false);
    }
  }

  async function handleLogout() {
    if (!confirm("Are you sure you want to logout?")) return;

    await authService.logout();
    showAuthScreen();

    el("emailInput").value = "";
    el("passwordInput").value = "";
    clearFieldError("emailInput", "emailError");
    clearFieldError("passwordInput", "passwordError");

    state.currentProduct = null;
    state.isTracked = false;
  }

  async function checkCurrentPage() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      state.currentTab = tab;

      if (!tab) {
        showMessage("Could not access current tab", "error", "statusMessage");
        el("trackBtn").disabled = true;
        return;
      }

      const url = tab.url || "";

      if (!isValidProductUrl(url)) {
        showMessage("Not on a supported marketplace", "error", "statusMessage");
        el("trackBtn").disabled = true;
        el("previewSkeleton").style.display = "none";
        el("previewContent").style.display = "none";
        return;
      }

      el("trackBtn").disabled = false;
      el("previewSkeleton").style.display = "flex";
      el("previewContent").style.display = "none";

      setTimeout(() => {
        el("previewSkeleton").style.display = "none";
      }, 1500);
    } catch (error) {
      showMessage("Error accessing page", "error", "statusMessage");
    }
  }

  async function handleTrackProduct() {
    if (state.isTracked) {
      showMessage(
        "This product is already being tracked!",
        "success",
        "statusMessage"
      );
      return;
    }

    if (!state.currentTab) {
      showMessage("No active tab found", "error", "statusMessage");
      return;
    }

    if (!isValidProductUrl(state.currentTab.url)) {
      showMessage("Not on a supported product page", "error", "statusMessage");
      return;
    }

    el("trackBtn").disabled = true;
    el("trackBtnText").textContent = "Tracking...";

    try {
      const extractResponse = await Promise.race([
        chrome.tabs.sendMessage(state.currentTab.id, {
          action: "extractProduct",
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 10000)
        ),
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

      el("previewSkeleton").style.display = "none";
      el("previewContent").style.display = "block";

      if (product.image) {
        el("productImage").src = product.image;
        el("productImage").style.display = "block";
      }

      el("productName").textContent = product.name || "Unknown Product";
      el("productPrice").textContent = formatPrice(
        product.price,
        product.currency
      );

      state.currentProduct = product;

      const trackResponse = await chrome.runtime.sendMessage({
        action: "trackProduct",
        url: state.currentTab.url,
        product: product,
      });

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      if (trackResponse?.success) {
        state.isTracked = true;
        el("trackBtnText").textContent = "Tracked Successfully!";
        el("trackBtn").style.background =
          "linear-gradient(135deg, #48bb78 0%, #38a169 100%)";

        const aiSummary =
          trackResponse?.backend?.data?.ai?.summary ||
          trackResponse?.backend?.data?.ai?.decision ||
          null;

        if (aiSummary) {
          showMessage(`AI: ${aiSummary}`, "success", "statusMessage");
        } else {
          showMessage(
            "Product tracked successfully!",
            "success",
            "statusMessage"
          );
        }

        setTimeout(() => {
          el("trackBtnText").textContent = "Track This Product";
          el("trackBtn").style.background = "";
          el("trackBtn").disabled = false;
        }, 3000);
      } else {
        throw new Error(trackResponse?.error || "Failed to save product");
      }
    } catch (error) {
      let errorMessage = "Failed to track product";

      if (
        error.message.includes("Timeout") ||
        error.message.includes("not responding")
      ) {
        errorMessage = "Page not responding. Please refresh and try again.";
      } else if (
        error.message.includes("receiving end") ||
        error.message.includes("connection")
      ) {
        errorMessage = "Please refresh the page and try again";
      } else if (error.message) {
        errorMessage = error.message;
      }

      showMessage(errorMessage, "error", "statusMessage");
      el("trackBtn").disabled = false;
      el("trackBtnText").textContent = "Track This Product";
    }
  }

  function setupEventListeners() {
    const loginTab = el("loginTab");
    const registerTab = el("registerTab");

    loginTab?.addEventListener("click", () => {
      switchToLogin();
    });

    registerTab?.addEventListener("click", () => {
      switchToRegister();
    });

    el("authForm")?.addEventListener("submit", handleAuthSubmit);

    el("emailInput")?.addEventListener("input", (e) => {
      if (state.validationTimeout) clearTimeout(state.validationTimeout);
      state.validationTimeout = setTimeout(() => {
        if (e.target.value) validateEmailField(e.target.value);
      }, CONFIG.VALIDATION_DEBOUNCE);
    });

    el("passwordInput")?.addEventListener("input", (e) => {
      const isRegisterMode = el("registerTab").classList.contains("active");
      if (state.validationTimeout) clearTimeout(state.validationTimeout);
      state.validationTimeout = setTimeout(() => {
        if (e.target.value)
          validatePasswordField(e.target.value, isRegisterMode);
      }, CONFIG.VALIDATION_DEBOUNCE);
    });

    el("logoutBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      handleLogout();
    });

    el("trackBtn")?.addEventListener("click", handleTrackProduct);

    el("dashboardLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });

    el("forgotPassword")?.addEventListener("click", (e) => {
      e.preventDefault();
      const email = el("emailInput").value.trim();

      if (!email || !authService.validateEmail(email)) {
        showMessage("Please enter your email address first", "error");
        return;
      }

      fetch(`${EXT_CONFIG.SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EXT_CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.error) {
            showMessage(data.error.message, "error");
          } else {
            showMessage(
              "Password reset email sent! Check your inbox.",
              "success"
            );
          }
        })
        .catch(() => {
          showMessage("Failed to send reset email. Please try again.", "error");
        });
    });
  }

  async function init() {
    if (typeof EXT_CONFIG === "undefined") {
      setupEventListeners();
      showMainScreen();
      await checkCurrentPage();
      return;
    }

    if (typeof authService === "undefined") {
      setTimeout(init, 100);
      return;
    }

    setupEventListeners();
    const isAuthenticated = await authService.init();

    if (isAuthenticated) {
      showMainScreen();
      await checkCurrentPage();
    } else {
      showAuthScreen();
    }
  }

  init();
})();
