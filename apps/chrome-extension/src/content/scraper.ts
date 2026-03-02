export interface ScrapeSource {
  url: string;
  titleText?: string;
  h1Text?: string;
  bodyText?: string;
  jsonLdObjects?: unknown[];
  meta?: Record<string, string>;
  data?: Record<string, string>;
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
  const price =
    extractNumber(source.data?.price) ||
    extractNumber(source.meta?.["product:price:amount"]) ||
    extractNumber(source.bodyText?.match(/\$[\d,]+/u)?.[0]);
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
