document.getElementById("track").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PRODUCT" }, (data) => {
    chrome.runtime.sendMessage({
      type: "TRACK_PRODUCT",
      payload: data,
    });
  });
};
