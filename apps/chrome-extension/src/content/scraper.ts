export interface ScrapeSource {
  url: string;
  titleText?: string;
  h1Text?: string;
  bodyText?: string;
  photoUrls?: string[];
  jsonLdObjects?: unknown[];
  meta?: Record<string, string>;
  data?: Record<string, string>;
}

interface LocationSnapshot {
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
}

const GENERIC_TYPES = new Set(["product", "offer", "thing", "residence"]);

export interface ScrapedListingPayload {
  source: "realtor.ca";
  sourceListingId?: string;
  url: string;
  address?: string;
  price?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  sqft?: number;
  description?: string;
  estimatedRent?: number;
  taxesAnnual?: number;
  condoFeesMonthly?: number;
  yearBuilt?: number;
  photoUrls?: string[];
  location?: LocationSnapshot;
  scrapeConfidence: number;
  missingFields: string[];
  rawSnapshot: Record<string, unknown>;
}

function parseYearBuilt(value?: string): number | undefined {
  const parsed = extractNumber(value);
  if (!parsed) {
    return undefined;
  }
  if (parsed < 1800 || parsed > 2100) {
    return undefined;
  }
  return Math.round(parsed);
}

function extractCondoFeesFromBody(bodyText?: string): number | undefined {
  if (!bodyText) {
    return undefined;
  }
  const matchers = [
    /Maintenance Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu,
    /Condo Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    const parsed = extractNumber(matched?.[1]);
    if (parsed && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function extractYearBuiltFromBody(bodyText?: string): number | undefined {
  if (!bodyText) {
    return undefined;
  }
  const matchers = [
    /Year Built\s*[:\n]?\s*(\d{4})/iu,
    /\bBuilt(?:\s+in)?\s*[:\n]?\s*(\d{4})\b/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    const parsed = parseYearBuilt(matched?.[1]);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractTaxesAnnualFromBody(bodyText?: string): number | undefined {
  if (!bodyText) {
    return undefined;
  }
  const matchers = [
    /Property Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Annual Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*\/\s*\d{4})?/iu
  ];
  for (const matcher of matchers) {
    const matched = bodyText.match(matcher);
    const parsed = extractNumber(matched?.[1]);
    if (parsed && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeBuildingType(input?: string): string | undefined {
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

function inferBuildingTypeFromDescription(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }
  const compact = description.replace(/\s+/g, " ").trim();
  const beforeBeds = compact.match(/^(.*?)\b\d+\s+bedrooms?\b/iu)?.[1];
  return normalizeBuildingType(beforeBeds ?? compact);
}

function inferBuildingTypeFromBody(bodyText?: string): string | undefined {
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

function extractNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractCurrencyCandidates(text?: string): number[] {
  if (!text) {
    return [];
  }
  const matches = text.match(/\$[\d,]+/gu) ?? [];
  return matches
    .map((match) => extractNumber(match))
    .filter((value): value is number => typeof value === "number")
    .filter((value) => value >= 50000 && value <= 25000000);
}

function parsePriceFromDescription(text?: string): number | undefined {
  if (!text) {
    return undefined;
  }
  const saleMatch = text.match(/for sale[^$]*\$([\d,]+)/iu);
  if (saleMatch?.[1]) {
    return extractNumber(saleMatch[1]);
  }
  return extractCurrencyCandidates(text)[0];
}

function extractOfferPriceFromObject(obj: Record<string, unknown>): number | undefined {
  const directPrice = extractNumber(typeof obj.price === "string" ? obj.price : String(obj.price ?? ""));
  if (directPrice) {
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

function fromJsonLdOfferPrice(jsonLdObjects: unknown[] | undefined): number | undefined {
  if (!jsonLdObjects) {
    return undefined;
  }
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

function fromJsonLd(jsonLdObjects: unknown[] | undefined, key: string): string | undefined {
  if (!jsonLdObjects) {
    return undefined;
  }

  for (const obj of jsonLdObjects) {
    if (!obj || typeof obj !== "object") {
      continue;
    }
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function inferMissingFields(payload: ScrapedListingPayload): string[] {
  const missing: string[] = [];
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

function fromJsonLdImages(jsonLdObjects: unknown[] | undefined): string[] {
  if (!jsonLdObjects) {
    return [];
  }
  const urls = new Set<string>();
  for (const obj of jsonLdObjects) {
    if (!obj || typeof obj !== "object") {
      continue;
    }
    const imageValue = (obj as Record<string, unknown>).image;
    if (typeof imageValue === "string") {
      urls.add(imageValue);
      continue;
    }
    if (Array.isArray(imageValue)) {
      for (const item of imageValue) {
        if (typeof item === "string") {
          urls.add(item);
        } else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") {
          urls.add((item as Record<string, string>).url);
        }
      }
      continue;
    }
    if (imageValue && typeof imageValue === "object" && typeof (imageValue as Record<string, unknown>).url === "string") {
      urls.add((imageValue as Record<string, string>).url);
    }
  }
  return Array.from(urls);
}

function parseLocation(address?: string): LocationSnapshot | undefined {
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

export function parseListingPayload(source: ScrapeSource): ScrapedListingPayload {
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
  const taxesAnnual = extractNumber(source.data?.taxesAnnual) ?? extractTaxesAnnualFromBody(source.bodyText);
  const condoFeesMonthly = extractNumber(source.data?.condoFeesMonthly) ?? extractCondoFeesFromBody(source.bodyText);
  const yearBuilt = parseYearBuilt(source.data?.yearBuilt) ?? extractYearBuiltFromBody(source.bodyText);
  const photoUrls = Array.from(
    new Set([
      ...(source.photoUrls ?? []),
      ...fromJsonLdImages(source.jsonLdObjects),
      source.meta?.["og:image"] ?? ""
    ].filter((url): url is string => Boolean(url)))
  );
  const location = parseLocation(address);

  const payload: ScrapedListingPayload = {
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
    yearBuilt,
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
      yearBuilt,
      meta: source.meta,
      data: source.data
    }
  };

  payload.missingFields = inferMissingFields(payload);
  payload.scrapeConfidence = 1 - payload.missingFields.length / 10;
  return payload;
}
