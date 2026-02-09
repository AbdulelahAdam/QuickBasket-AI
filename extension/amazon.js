(function () {
  "use strict";

  console.log("[QB Amazon] Content script loaded - on-demand mode");

  let scriptsInjected = false;

  async function injectScripts() {
    if (scriptsInjected) {
      console.log("[QB Amazon] Scripts already injected");
      return true;
    }

    const scripts = ["config.js", "validators.js", "inject-amazon.js"];

    try {
      for (const file of scripts) {
        await injectScript(file);
      }
      scriptsInjected = true;
      console.log("[QB Amazon] All scripts loaded successfully");
      return true;
    } catch (err) {
      console.error("[QB Amazon] Script injection failed:", err.message);
      return false;
    }
  }

  function injectScript(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(file);

      script.onload = () => {
        console.log(`[QB Amazon] Loaded: ${file}`);
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
        if (event.data?.source !== "quickbasket-injected-amazon") return;

        clearTimeout(timeout);
        window.removeEventListener("message", messageHandler);

        if (event.data.type === "PRODUCT_EXTRACTED") {
          console.log("[QB Amazon] Product extracted successfully");
          resolve(event.data.product);
        } else if (event.data.type === "EXTRACTION_FAILED") {
          console.log("[QB Amazon] Extraction failed:", event.data.error);
          reject(new Error(event.data.error || "Extraction failed"));
        } else if (event.data.type === "EXTRACTION_ERROR") {
          console.error("[QB Amazon] Extraction error:", event.data.error);
          reject(new Error(event.data.error || "Extraction error"));
        }
      }

      window.addEventListener("message", messageHandler);

      window.postMessage(
        {
          source: "quickbasket-content-amazon",
          action: "extractProduct",
        },
        window.location.origin
      );
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "ping") {
      sendResponse({ status: "ok" });
      return false;
    }

    if (message.action === "extractProduct") {
      requestProductExtraction()
        .then((product) => {
          sendResponse({ success: true, product });
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }
  });

  console.log("[QB Amazon] Ready - waiting for user action");
})();
