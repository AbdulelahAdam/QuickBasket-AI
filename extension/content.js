(() => {
  function extractProduct() {
    const title = document.querySelector("h1")?.innerText || null;
    const price =
      document.querySelector('[data-qa="product-price"]')?.innerText ||
      document.querySelector('meta[property="product:price:amount"]')
        ?.content ||
      null;

    return {
      url: location.href,
      title,
      price_raw: price,
      marketplace: "noon",
    };
  }

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === "EXTRACT_PRODUCT") {
      sendResponse(extractProduct());
    }
  });
})();
