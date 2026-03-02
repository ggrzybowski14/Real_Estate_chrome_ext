import { parseListingPayload, type ScrapeSource } from "./scraper";

function readMetaContent(property: string): string | undefined {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return el?.getAttribute("content") ?? undefined;
}

function collectJsonLd(): unknown[] {
  const nodes = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  return nodes
    .map((node) => {
      try {
        return JSON.parse(node.textContent ?? "");
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildScrapeSource(): ScrapeSource {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  const bodyText = document.body?.innerText ?? "";

  const data: Record<string, string> = {};
  const priceNode = document.querySelector('[class*="Price"], [data-test*="price"]');
  if (priceNode?.textContent) {
    data.price = priceNode.textContent.trim();
  }
  if (h1) {
    data.address = h1;
  }

  return {
    url: window.location.href,
    titleText: document.title,
    h1Text: h1,
    bodyText,
    jsonLdObjects: collectJsonLd(),
    meta: {
      "og:title": readMetaContent("og:title") ?? "",
      "product:price:amount": readMetaContent("product:price:amount") ?? "",
      description: readMetaContent("description") ?? ""
    },
    data
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "REA_SCRAPE_LISTING") {
    return;
  }

  try {
    const source = buildScrapeSource();
    const payload = parseListingPayload(source);
    sendResponse({ ok: true, payload });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown scrape error"
    });
  }
});
