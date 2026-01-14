chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "TRACK_PRODUCT") {
    fetch("http://localhost:8000/track/browser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    });
  }
});
