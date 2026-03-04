function extractNumber(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const GENERIC_TYPES = new Set(["product", "offer", "thing", "residence"]);

function normalizeBuildingType(input) {
  if (!input) {
    return undefined;
  }
  const value = input.replace(/\s+/g, " ").trim();
  if (!value) {
    return undefined;
  }
  const lower = value.toLowerCase();
  if (GENERIC_TYPES.has(lower)) {
    return undefined;
  }
  if (/(duplex)/iu.test(value)) {
    return "Duplex";
  }
  if (/(triplex|fourplex|plex)/iu.test(value)) {
    return "Multiplex";
  }
  if (/(apartment|condo|condominium|loft|penthouse)/iu.test(value)) {
    return "Apartment";
  }
  if (/(townhouse|townhome|row house|row\/townhouse|rowhouse)/iu.test(value)) {
    return "Townhouse";
  }
  if (/(single family|house|detached|semi-detached)/iu.test(value)) {
    return "House";
  }
  return value
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function inferBuildingTypeFromDescription(description) {
  if (!description) {
    return undefined;
  }
  const compact = description.replace(/\s+/g, " ").trim();
  const beforeBeds = compact.match(/^(.*?)\b\d+\s+bedrooms?\b/iu)?.[1];
  return normalizeBuildingType(beforeBeds ?? compact);
}

function inferBuildingTypeFromBody(bodyText) {
  if (!bodyText) {
    return undefined;
  }
  const matchers = [
    /Building Type\s*[:\n]\s*([^\n\r]{2,50})/iu,
    /Property Type\s*[:\n]\s*([^\n\r]{2,50})/iu
  ];
  for (const matcher of matchers) {
    const match = bodyText.match(matcher);
    if (!match?.[1]) {
      continue;
    }
    const normalized = normalizeBuildingType(match[1]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
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

function extractOfferPriceFromObject(obj) {
  const directPrice = extractNumber(typeof obj.price === "string" ? obj.price : String(obj.price ?? ""));
  if (directPrice) {
    return directPrice;
  }
  const offers = obj.offers;
  if (offers && typeof offers === "object") {
    if (Array.isArray(offers)) {
      for (const offer of offers) {
        if (offer && typeof offer === "object") {
          const price = extractOfferPriceFromObject(offer);
          if (price) {
            return price;
          }
        }
      }
    } else {
      const price = extractOfferPriceFromObject(offers);
      if (price) {
        return price;
      }
    }
  }
  const graph = obj["@graph"];
  if (Array.isArray(graph)) {
    for (const node of graph) {
      if (node && typeof node === "object") {
        const price = extractOfferPriceFromObject(node);
        if (price) {
          return price;
        }
      }
    }
  }
  return undefined;
}

function fromJsonLdOfferPrice(jsonLdObjects) {
  if (!jsonLdObjects) {
    return undefined;
  }
  for (const obj of jsonLdObjects) {
    if (obj && typeof obj === "object") {
      const price = extractOfferPriceFromObject(obj);
      if (price) {
        return price;
      }
    }
  }
  return undefined;
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
  const jsonLdOfferPrice = fromJsonLdOfferPrice(source.jsonLdObjects);
  const descriptionPrice = parsePriceFromDescription(source.meta?.description);
  const price =
    jsonLdOfferPrice ||
    extractNumber(source.data?.price) ||
    descriptionPrice ||
    extractNumber(source.meta?.["product:price:amount"]);
  const beds =
    extractNumber(source.data?.beds) || extractNumber(source.bodyText?.match(/(\d+)\s*beds?/iu)?.[1]);
  const baths =
    extractNumber(source.data?.baths) ||
    extractNumber(source.bodyText?.match(/(\d+(?:\.\d+)?)\s*baths?/iu)?.[1]);
  const sqft =
    extractNumber(source.data?.sqft) ||
    extractNumber(source.bodyText?.match(/([\d,]+)\s*(?:sq\s*ft|sqft)/iu)?.[1]);
  const propertyType = normalizeBuildingType(
    source.data?.propertyType ||
      inferBuildingTypeFromBody(source.bodyText) ||
      fromJsonLd(source.jsonLdObjects, "@type") ||
      inferBuildingTypeFromDescription(source.meta?.description)
  );
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

function collectLikelyListingPriceText() {
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
    if (/mortgage|payment|month|calculator|estimate|tax|assessment|history|down payment|cash flow|rent/iu.test(text)) {
      continue;
    }
    if (extractCurrencyCandidates(text).length > 0) {
      return text;
    }
  }
  return undefined;
}

function buildScrapeSource() {
  const h1 = document.querySelector("h1")?.textContent?.trim();
  const bodyText = document.body?.innerText ?? "";
  const data = {};
  const likelyPriceText = collectLikelyListingPriceText();
  if (likelyPriceText) {
    data.price = likelyPriceText;
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
