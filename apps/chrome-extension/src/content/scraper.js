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
  return extractCurrencyCandidates(text)[0];
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

function fromJsonLdImages(jsonLdObjects) {
  if (!jsonLdObjects) {
    return [];
  }
  const urls = new Set();
  for (const obj of jsonLdObjects) {
    if (!obj || typeof obj !== "object") {
      continue;
    }
    const imageValue = obj.image;
    if (typeof imageValue === "string") {
      urls.add(imageValue);
      continue;
    }
    if (Array.isArray(imageValue)) {
      for (const item of imageValue) {
        if (typeof item === "string") {
          urls.add(item);
        } else if (item && typeof item === "object" && typeof item.url === "string") {
          urls.add(item.url);
        }
      }
      continue;
    }
    if (imageValue && typeof imageValue === "object" && typeof imageValue.url === "string") {
      urls.add(imageValue.url);
    }
  }
  return Array.from(urls);
}

function parseLocation(address) {
  if (!address) {
    return undefined;
  }
  const compact = address.replace(/\s+/g, " ").trim();
  const parts = compact.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { street: compact, country: "Canada" };
  }
  const street = parts[0];
  const city = parts[1];
  const provincePostal = parts[2] ?? "";
  const provinceMatch = provincePostal.match(/\b([A-Z]{2}|British Columbia|Alberta|Ontario|Quebec|Nova Scotia|New Brunswick|Manitoba|Saskatchewan|PEI|Prince Edward Island|Newfoundland and Labrador)\b/i);
  const postalMatch = provincePostal.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i);
  return {
    street,
    city,
    province: provinceMatch?.[0],
    postalCode: postalMatch?.[0]?.toUpperCase(),
    country: "Canada"
  };
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

export function parseListingPayload(source) {
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
  const photoUrls = Array.from(
    new Set([
      ...(source.photoUrls ?? []),
      ...fromJsonLdImages(source.jsonLdObjects),
      source.meta?.["og:image"] ?? ""
    ].filter((url) => Boolean(url)))
  );
  const location = parseLocation(address);

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
    photoUrls,
    location,
    scrapeConfidence: 0.8,
    estimatedRent: undefined,
    missingFields: [],
    rawSnapshot: {
      titleText: source.titleText,
      h1Text: source.h1Text,
      photoUrls,
      location,
      meta: source.meta,
      data: source.data
    }
  };

  payload.missingFields = inferMissingFields(payload);
  payload.scrapeConfidence = 1 - payload.missingFields.length / 10;
  return payload;
}
