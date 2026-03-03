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
  return extractCurrencyCandidates(text)[0];
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
