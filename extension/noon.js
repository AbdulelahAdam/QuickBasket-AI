(function () {
  "use strict";

  console.log("[QB Noon] Content script loaded - on-demand mode");

  let scriptsInjected = false;

  async function injectScripts() {
    if (scriptsInjected) {
      console.log("[QB Noon] Scripts already injected");
      return true;
    }

    const scripts = ["config.js", "validators.js", "inject-noon.js"];

    try {
      for (const file of scripts) {
        await injectScript(file);
      }
      scriptsInjected = true;
      console.log("[QB Noon] All scripts loaded successfully");
      return true;
    } catch (err) {
      console.error("[QB Noon] Script injection failed:", err.message);
      return false;
    }
  }

  function injectScript(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(file);

      script.onload = () => {
        console.log(`[QB Noon] Loaded: ${file}`);
        script.remove();
        resolve();
      };

      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to load ${file}`));
      };

      (document.head || document.documentElement).appendChild(script);

      setTimeout(() => reject(new Error(`${file} load timeout`)), 5000);
    });
  }

  async function requestProductExtraction() {
    const injected = await injectScripts();
    if (!injected) {
      throw new Error("Failed to inject extraction scripts");
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", messageHandler);
        reject(new Error("Product extraction timeout"));
      }, 5000);

      function messageHandler(event) {
        if (event.source !== window) return;
        if (event.data?.source !== "quickbasket-injected-noon") return;

        clearTimeout(timeout);
        window.removeEventListener("message", messageHandler);

        if (event.data.type === "PRODUCT_EXTRACTED") {
          console.log("[QB Noon] Product extracted successfully");
          resolve(event.data.product);
        } else if (event.data.type === "EXTRACTION_FAILED") {
          console.log("[QB Noon] Extraction failed:", event.data.error);
          reject(new Error(event.data.error || "Extraction failed"));
        } else if (event.data.type === "EXTRACTION_ERROR") {
          console.error("[QB Noon] Extraction error:", event.data.error);
          reject(new Error(event.data.error || "Extraction error"));
        }
      }

      window.addEventListener("message", messageHandler);

      window.postMessage(
        {
          source: "quickbasket-content-noon",
          action: "extractProduct",
        },
        window.location.origin
      );
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[QB Noon] Received message:", message.action);

    if (message.action === "ping") {
      sendResponse({ status: "ok" });
      return false;
    }

    if (message.action === "extractProduct") {
      requestProductExtraction()
        .then((product) => {
          console.log("[QB Noon] Sending product data back");
          sendResponse({ success: true, product });
        })
        .catch((error) => {
          console.error("[QB Noon] Extraction failed:", error);
          sendResponse({
            success: false,
            error: error.message || "Could not extract product data",
          });
        });

      return true;
    }

    sendResponse({ success: false, error: "Unknown action" });
    return false;
  });

  console.log("[QB Noon] Ready - waiting for user action");
})();
