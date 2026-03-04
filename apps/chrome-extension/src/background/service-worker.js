import { ANALYZER_BASE_URL } from "../shared/config.js";

function isRealtorListing(url) {
  return Boolean(url && /realtor\.ca\/real-estate\//iu.test(url));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function requestScrape(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "REA_SCRAPE_LISTING" });
    if (response?.ok && response.payload) {
      return response;
    }
  } catch (_error) {
    // Ignore and try script injection fallback.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/content-script.js"]
  });

  return chrome.tabs.sendMessage(tabId, { type: "REA_SCRAPE_LISTING" });
}

async function analyzeActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id || !isRealtorListing(tab.url)) {
    return;
  }

  const response = await requestScrape(tab.id);
  if (!response?.ok || !response.payload) {
    return;
  }

  const payload = encodeURIComponent(JSON.stringify(response.payload));
  const nextUrl = `${ANALYZER_BASE_URL}?payload=${payload}`;
  await chrome.tabs.create({ url: nextUrl });
}

chrome.action.onClicked.addListener(() => {
  void analyzeActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "REA_ANALYZE_ACTIVE_TAB") {
    return;
  }
  void analyzeActiveTab()
    .then(() => sendResponse({ ok: true }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error"
      })
    );
  return true;
});
