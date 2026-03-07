import { parseListingPayload, type ScrapeSource } from "./scraper";

declare const chrome: any;

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

function extractOfferPriceFromObject(obj: Record<string, unknown>): number | undefined {
  const directPrice = Number(
    typeof obj.price === "string" ? obj.price.replace(/[^0-9.-]+/g, "") : String(obj.price ?? "")
  );
  if (Number.isFinite(directPrice) && directPrice > 0) {
    return directPrice;
  }

  const offers = obj.offers;
  if (offers && typeof offers === "object") {
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        if (offer && typeof offer === "object") {
          const price = extractOfferPriceFromObject(offer as Record<string, unknown>);
          if (price) {
            return price;
          }
        }
      }
    } else {
      const price = extractOfferPriceFromObject(offers as Record<string, unknown>);
      if (price) {
        return price;
      }
    }
  }

  const graph = obj["@graph"];
  if (Array.isArray(graph)) {
    for (const node of graph) {
      if (node && typeof node === "object") {
        const price = extractOfferPriceFromObject(node as Record<string, unknown>);
        if (price) {
          return price;
        }
      }
    }
  }

  return undefined;
}

function fromJsonLdOfferPrice(jsonLdObjects: unknown[]): number | undefined {
  for (const obj of jsonLdObjects) {
    if (obj && typeof obj === "object") {
      const price = extractOfferPriceFromObject(obj as Record<string, unknown>);
      if (price) {
        return price;
      }
    }
  }
  return undefined;
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

function collectLikelyListingPriceText(): string | undefined {
  const selectors = [
    '[data-testid*="Price"]',
    '[data-test*="price"]',
    'span[class*="listingPrice"]',
    'div[class*="listingPrice"]',
    '[class*="PropertyPrice"]',
    '[class*="Price"]'
  ];
  const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  for (const node of nodes) {
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!text.includes("$")) {
      continue;
    }
    if (
      /mortgage|payment|month|calculator|estimate|tax|assessment|history|down payment|cash flow|rent/iu.test(
        text
      )
    ) {
      continue;
    }
    if (extractCurrencyCandidates(text).length > 0) {
      return text;
    }
  }
  return undefined;
}

function extractCondoFeesFromBody(bodyText: string): number | undefined {
  const matchers = [
    /Maintenance Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu,
    /Condo Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    if (!matched?.[1]) {
      continue;
    }
    const parsed = Number(matched[1].replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function extractYearBuiltFromBody(bodyText: string): number | undefined {
  const matchers = [
    /Year Built\s*[:\n]?\s*(\d{4})/iu,
    /\bBuilt(?:\s+in)?\s*[:\n]?\s*(\d{4})\b/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    if (!matched?.[1]) {
      continue;
    }
    const parsed = Number(matched[1]);
    if (Number.isFinite(parsed) && parsed >= 1800 && parsed <= 2100) {
      return parsed;
    }
  }
  return undefined;
}

function extractTaxesAnnualFromBody(bodyText: string): number | undefined {
  const matchers = [
    /Property Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Annual Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*\/\s*\d{4})?/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    if (!matched?.[1]) {
      continue;
    }
    const parsed = Number(matched[1].replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function buildScrapeSource(): ScrapeSource {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  const bodyText = document.body?.innerText ?? "";

  const data: Record<string, string> = {};
  const likelyPriceText = collectLikelyListingPriceText();
  if (likelyPriceText) {
    data.price = likelyPriceText;
  }
  if (h1) {
    data.address = h1;
  }
  const metaDescription = readMetaContent("description") ?? "";
  const extractedMetaPrice = parsePriceFromDescription(metaDescription);
  if (typeof extractedMetaPrice === "number") {
    data.price = `${extractedMetaPrice}`;
  }
  const condoFeesMonthly = extractCondoFeesFromBody(bodyText);
  if (typeof condoFeesMonthly === "number") {
    data.condoFeesMonthly = `${condoFeesMonthly}`;
  }
  const yearBuilt = extractYearBuiltFromBody(bodyText);
  if (typeof yearBuilt === "number") {
    data.yearBuilt = `${yearBuilt}`;
  }
  const taxesAnnual = extractTaxesAnnualFromBody(bodyText);
  if (typeof taxesAnnual === "number") {
    data.taxesAnnual = `${taxesAnnual}`;
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
