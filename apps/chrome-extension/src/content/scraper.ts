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
  photoUrls?: string[];
  location?: LocationSnapshot;
  scrapeConfidence: number;
  missingFields: string[];
  rawSnapshot: Record<string, unknown>;
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
