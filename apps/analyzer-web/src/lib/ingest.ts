import type { ListingRecord } from "@rea/shared";

function safeJsonParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]+/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function parseIncomingListing(payloadParam: string): ListingRecord | null {
  const parsed = safeJsonParse(payloadParam) as Record<string, unknown> | null;
  if (!parsed || typeof parsed.url !== "string") {
    return null;
  }

  const now = new Date().toISOString();
  const listing: ListingRecord = {
    id:
      (typeof parsed.sourceListingId === "string" && parsed.sourceListingId) ||
      `${Date.now()}`,
    source: "realtor.ca",
    sourceListingId:
      typeof parsed.sourceListingId === "string" ? parsed.sourceListingId : undefined,
    url: parsed.url,
    capturedAt: now,
    address: typeof parsed.address === "string" ? parsed.address : undefined,
    price: toNumber(parsed.price),
    beds: toNumber(parsed.beds),
    baths: toNumber(parsed.baths),
    propertyType:
      typeof parsed.propertyType === "string" ? parsed.propertyType : undefined,
    sqft: toNumber(parsed.sqft),
    description: typeof parsed.description === "string" ? parsed.description : undefined,
    estimatedRent: toNumber(parsed.estimatedRent),
    daysOnMarket: toNumber(parsed.daysOnMarket),
    taxesAnnual: toNumber(parsed.taxesAnnual),
    condoFeesMonthly: toNumber(parsed.condoFeesMonthly),
    scrapeConfidence:
      typeof parsed.scrapeConfidence === "number" ? parsed.scrapeConfidence : 0.6,
    missingFields: Array.isArray(parsed.missingFields)
      ? parsed.missingFields.filter((v): v is string => typeof v === "string")
      : [],
    rawSnapshot:
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  };

  return listing;
}

