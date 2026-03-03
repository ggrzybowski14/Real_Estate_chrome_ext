function extractNumber(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractCurrencyCandidates(text) {
  if (!text) {
    return [];
  }
  const matches = text.match(/\$[\d,]+/gu) ?? [];
  const values = matches
    .map((match) => extractNumber(match))
    .filter((value) => typeof value === "number");
  return values.filter((value) => value >= 50000 && value <= 25000000);
}

function parsePriceFromDescription(text) {
  if (!text) {
    return undefined;
  }
  const saleMatch = text.match(/for sale[^$]*\$([\d,]+)/iu);
  if (saleMatch?.[1]) {
    return extractNumber(saleMatch[1]);
  }
  const candidates = extractCurrencyCandidates(text);
  return candidates[0];
}

function fromJsonLd(jsonLdObjects, key) {
  if (!jsonLdObjects) {
    return undefined;
  }
  for (const obj of jsonLdObjects) {
    if (!obj || typeof obj !== "object") {
      continue;
    }
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function inferMissingFields(payload) {
  const missing = [];
  if (!payload.address) {
    missing.push("address");
  }
  if (!payload.price) {
    missing.push("price");
  }
  if (!payload.beds) {
    missing.push("beds");
  }
  if (!payload.baths) {
    missing.push("baths");
  }
  return missing;
}

function parseListingPayload(source) {
  const url = source.url;
  const sourceListingId = url.match(/\/(\d+)(?:$|[/?#])/u)?.[1];

  const address =
    source.data?.address ||
    source.h1Text ||
    fromJsonLd(source.jsonLdObjects, "name") ||
    source.meta?.["og:title"];
  const description =
    source.data?.description ||
    fromJsonLd(source.jsonLdObjects, "description") ||
    source.meta?.description;
  const descriptionPrice = parsePriceFromDescription(source.meta?.description);
  const bodyPrices = extractCurrencyCandidates(source.bodyText);
  const price =
    extractNumber(source.data?.price) ||
    descriptionPrice ||
    extractNumber(source.meta?.["product:price:amount"]) ||
    bodyPrices[0];
  const beds =
    extractNumber(source.data?.beds) || extractNumber(source.bodyText?.match(/(\d+)\s*beds?/iu)?.[1]);
  const baths =
    extractNumber(source.data?.baths) ||
    extractNumber(source.bodyText?.match(/(\d+(?:\.\d+)?)\s*baths?/iu)?.[1]);
  const sqft =
    extractNumber(source.data?.sqft) ||
    extractNumber(source.bodyText?.match(/([\d,]+)\s*(?:sq\s*ft|sqft)/iu)?.[1]);
  const propertyType = source.data?.propertyType || fromJsonLd(source.jsonLdObjects, "@type");
  const taxesAnnual = extractNumber(source.data?.taxesAnnual);
  const condoFeesMonthly = extractNumber(source.data?.condoFeesMonthly);

  const payload = {
    source: "realtor.ca",
    sourceListingId,
    url,
    address,
    price,
    beds,
    baths,
    propertyType,
    sqft,
    description,
    taxesAnnual,
    condoFeesMonthly,
    scrapeConfidence: 0.8,
    estimatedRent: undefined,
    missingFields: [],
    rawSnapshot: {
      titleText: source.titleText,
      h1Text: source.h1Text,
      meta: source.meta,
      data: source.data
    }
  };

  payload.missingFields = inferMissingFields(payload);
  payload.scrapeConfidence = 1 - payload.missingFields.length / 10;
  return payload;
}

function readMetaContent(property) {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return el?.getAttribute("content") ?? undefined;
}

function collectJsonLd() {
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

function collectPhotoUrls() {
  const images = Array.from(document.querySelectorAll("img"));
  const urls = images
    .map((img) => img.currentSrc || img.src)
    .filter((src) => Boolean(src) && /^https?:\/\//u.test(src))
    .filter((src) => /\.(jpg|jpeg|png|webp)(\?|$)/iu.test(src) || src.includes("realtor"))
    .slice(0, 25);
  return Array.from(new Set(urls));
}

function buildScrapeSource() {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  const bodyText = document.body?.innerText ?? "";
  const data = {};
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
    photoUrls: collectPhotoUrls(),
    jsonLdObjects: collectJsonLd(),
    meta: {
      "og:title": readMetaContent("og:title") ?? "",
      "product:price:amount": readMetaContent("product:price:amount") ?? "",
      "og:image": readMetaContent("og:image") ?? "",
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
