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

function extractCurrencyCandidates(text?: string): number[] {
  if (!text) {
    return [];
  }
  const matches = text.match(/\$[\d,]+/gu) ?? [];
  return matches
    .map((match) => Number(match.replace(/[^0-9.-]+/g, "")))
    .filter((value) => Number.isFinite(value))
    .filter((value) => value >= 50000 && value <= 25000000);
}

function parsePriceFromDescription(text?: string): number | undefined {
  if (!text) {
    return undefined;
  }
  const saleMatch = text.match(/for sale[^$]*\$([\d,]+)/iu);
  if (saleMatch?.[1]) {
    const parsed = Number(saleMatch[1].replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return extractCurrencyCandidates(text)[0];
}

function collectPhotoUrls(): string[] {
  const images = Array.from(document.querySelectorAll("img"));
  const urls = images
    .map((img) => (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src)
    .filter((src) => Boolean(src) && /^https?:\/\//u.test(src))
    .filter((src) => /\.(jpg|jpeg|png|webp)(\?|$)/iu.test(src) || src.includes("realtor"))
    .slice(0, 25);
  return Array.from(new Set(urls));
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
  const metaDescription = readMetaContent("description") ?? "";
  const extractedMetaPrice = parsePriceFromDescription(metaDescription);
  if (typeof extractedMetaPrice === "number") {
    data.price = `${extractedMetaPrice}`;
  }

  return {
    url: window.location.href,
    titleText: document.title,
    h1Text: h1,
    bodyText,
    photoUrls: collectPhotoUrls(),
    jsonLdObjects: collectJsonLd(),
    meta: {
      "og:title": readMetaContent("og:title") ?? "",
      "product:price:amount": readMetaContent("product:price:amount") ?? "",
      "og:image": readMetaContent("og:image") ?? "",
      description: metaDescription
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
