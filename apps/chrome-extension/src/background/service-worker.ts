import { ANALYZER_BASE_URL } from "../shared/config";

function isRealtorListing(url?: string): boolean {
  return Boolean(url && /realtor\.ca\/real-estate\//iu.test(url));
}

type AnalyzeTiming = {
  startedAt: string;
  endedAt: string;
  totalMs: number;
};

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

async function requestScrape(tabId: number) {
  const startedMs = performance.now();
  try {
    console.info("[REA] requestScrape:first-attempt:start", {
      timestamp: new Date().toISOString(),
      tabId
    });
    const response = await chrome.tabs.sendMessage(tabId, { type: "REA_SCRAPE_LISTING" });
    if (response?.ok && response.payload) {
      console.info("[REA] requestScrape:first-attempt:success", {
        timestamp: new Date().toISOString(),
        tabId,
        elapsedMs: Math.round(performance.now() - startedMs)
      });
      return response;
    }
  } catch {
    console.info("[REA] requestScrape:first-attempt:failed", {
      timestamp: new Date().toISOString(),
      tabId,
      elapsedMs: Math.round(performance.now() - startedMs)
    });
  }

  console.info("[REA] requestScrape:inject-content-script:start", {
    timestamp: new Date().toISOString(),
    tabId,
    elapsedMs: Math.round(performance.now() - startedMs)
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/content-script.js"]
  });

  const response = await chrome.tabs.sendMessage(tabId, { type: "REA_SCRAPE_LISTING" });
  console.info("[REA] requestScrape:inject-content-script:done", {
    timestamp: new Date().toISOString(),
    tabId,
    elapsedMs: Math.round(performance.now() - startedMs),
    ok: Boolean(response?.ok && response?.payload)
  });
  return response;
}

function logTiming(prefix: string, startedMs: number, detail?: Record<string, unknown>) {
  const payload = {
    timestamp: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedMs),
    ...detail
  };
  console.info(prefix, payload);
}

async function analyzeActiveTab(): Promise<AnalyzeTiming> {
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  logTiming("[REA] analyzeActiveTab:start", startedMs, { startedAt });

  const tab = await getActiveTab();
  if (!tab?.id || !isRealtorListing(tab.url)) {
    logTiming("[REA] analyzeActiveTab:skipped", startedMs, {
      reason: "No active realtor listing tab",
      tabId: tab?.id,
      tabUrl: tab?.url ?? null
    });
    const endedAt = new Date().toISOString();
    return {
      startedAt,
      endedAt,
      totalMs: Math.round(performance.now() - startedMs)
    };
  }

  logTiming("[REA] analyzeActiveTab:tab-ready", startedMs, { tabId: tab.id, url: tab.url });
  const response = await requestScrape(tab.id);
  if (!response?.ok || !response.payload) {
    logTiming("[REA] analyzeActiveTab:scrape-failed", startedMs, { tabId: tab.id });
    throw new Error("Content script did not return listing payload.");
  }

  const payload = encodeURIComponent(JSON.stringify(response.payload));
  const nextUrl = `${ANALYZER_BASE_URL}?payload=${payload}`;
  logTiming("[REA] analyzeActiveTab:open-analyzer", startedMs, {
    payloadBytes: payload.length,
    analyzerBaseUrl: ANALYZER_BASE_URL
  });
  await chrome.tabs.create({ url: nextUrl });
  const endedAt = new Date().toISOString();
  const totalMs = Math.round(performance.now() - startedMs);
  logTiming("[REA] analyzeActiveTab:done", startedMs, { endedAt, totalMs });
  return {
    startedAt,
    endedAt,
    totalMs
  };
}

chrome.action.onClicked.addListener(() => {
  void analyzeActiveTab();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "REA_ANALYZE_ACTIVE_TAB") {
    return;
  }
  void analyzeActiveTab()
    .then((timings) => sendResponse({ ok: true, timings }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown background error"
      })
    );
  return true;
});
