import type { RealtorExploreListingPayload, LocationSnapshot } from "./types";
import { inferMissingFields, scrapeConfidenceFromMissing } from "./payload-utils";

const REALTOR_ORIGIN = "https://www.realtor.ca";

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]+/gu, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parsePriceField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/gu, "");
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function parseSqftFromSizeInterior(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/([\d,]+)\s*sq\s*ft|([\d,]+)\s*sqft/iu);
  const raw = m?.[1] ?? m?.[2];
  if (!raw) return undefined;
  const n = Number(raw.replace(/,/gu, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseLocationFromAddressText(address?: string): LocationSnapshot | undefined {
  if (!address) return undefined;
  const compact = address.replace(/\s+/gu, " ").trim();
  const parts = compact.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { street: compact, country: "Canada" };
  }
  const street = parts[0];
  const city = parts[1];
  const provincePostal = parts[2] ?? "";
  const postalMatch = provincePostal.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/iu);
  const provMatch = provincePostal.match(
    /British Columbia|Alberta|Ontario|Quebec|Nova Scotia|New Brunswick|Manitoba|Saskatchewan|PEI|Prince Edward Island|Newfoundland and Labrador|[A-Z]{2}\b/i
  );
  return {
    street,
    city,
    province: provMatch?.[0],
    postalCode: postalMatch?.[0]?.toUpperCase(),
    country: "Canada"
  };
}

function listingUrlFromRelative(path?: string): string | undefined {
  if (!path || typeof path !== "string") return undefined;
  if (path.startsWith("http")) return path;
  return `${REALTOR_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildPayloadFromSearchAndDetail(
  searchRow: Record<string, unknown>,
  detailJson: Record<string, unknown> | null
): RealtorExploreListingPayload {
  const mls = String(searchRow.MlsNumber ?? searchRow.ReferenceNumber ?? "").trim();
  const propertyId = String(searchRow.Id ?? searchRow.PropertyId ?? "").trim();
  const relUrl =
    (searchRow.RelativeDetailsURL as string | undefined) ??
    (searchRow.RelativeDetailURL as string | undefined);
  const url = listingUrlFromRelative(relUrl) ?? `${REALTOR_ORIGIN}/real-estate/${mls || propertyId || "unknown"}`;

  const prop = (searchRow.Property ?? {}) as Record<string, unknown>;
  const addr = (prop.Address ?? {}) as Record<string, unknown>;
  const building = (searchRow.Building ?? {}) as Record<string, unknown>;

  let address = typeof addr.AddressText === "string" ? addr.AddressText : undefined;
  let price = parsePriceField(prop.Price);
  let beds = toNumber(building.Bedrooms);
  let baths = toNumber(building.BathroomTotal);
  let sqft = parseSqftFromSizeInterior(building.SizeInterior);
  let propertyType =
    typeof building.Type === "string"
      ? building.Type
      : typeof prop.Type === "string"
        ? prop.Type
        : undefined;

  let description: string | undefined;
  let taxesAnnual: number | undefined;
  let condoFeesMonthly: number | undefined;
  let yearBuilt: number | undefined;
  const photoUrls: string[] = [];

  if (detailJson && typeof detailJson === "object") {
    const dProp = (detailJson.Property ?? {}) as Record<string, unknown>;
    const dAddr = (dProp.Address ?? {}) as Record<string, unknown>;
    const dBuilding = (detailJson.Building ?? {}) as Record<string, unknown>;

    if (typeof dAddr.AddressText === "string") address = dAddr.AddressText;
    const detailPrice = parsePriceField(dProp.Price);
    if (detailPrice !== undefined) price = detailPrice;
    if (beds === undefined) beds = toNumber(dBuilding.Bedrooms);
    if (baths === undefined) baths = toNumber(dBuilding.BathroomTotal);
    if (sqft === undefined) sqft = parseSqftFromSizeInterior(dBuilding.SizeInterior);
    if (!propertyType && typeof dBuilding.Type === "string") propertyType = dBuilding.Type;
    if (typeof detailJson.PublicRemarks === "string") {
      description = detailJson.PublicRemarks;
    }
    const constructed =
      toNumber(dBuilding.ConstructedDate) ??
      toNumber((dBuilding as { BuiltIn?: string }).BuiltIn);
    if (constructed !== undefined && constructed >= 1800 && constructed <= 2100) {
      yearBuilt = Math.round(constructed);
    }

    const remarks = typeof detailJson.PublicRemarks === "string" ? detailJson.PublicRemarks : "";
    const detailBlob = `${remarks}\n${JSON.stringify(detailJson).slice(0, 8000)}`;
    taxesAnnual = extractTaxesAnnualFromText(detailBlob);
    condoFeesMonthly = extractCondoFeesFromText(detailBlob);

    const photos = dProp.Photo;
    if (Array.isArray(photos)) {
      for (const ph of photos) {
        if (ph && typeof ph === "object") {
          const p = ph as { HighResPath?: string; MedResPath?: string };
          const u = p.HighResPath ?? p.MedResPath;
          if (typeof u === "string" && u) photoUrls.push(u);
        }
      }
    }
  }

  const location = parseLocationFromAddressText(address);

  const payload: RealtorExploreListingPayload = {
    source: "realtor.ca",
    sourceListingId: mls || propertyId || undefined,
    url,
    address,
    price,
    beds,
    baths,
    propertyType,
    sqft,
    description,
    estimatedRent: undefined,
    taxesAnnual,
    condoFeesMonthly,
    yearBuilt,
    photoUrls: photoUrls.length > 0 ? Array.from(new Set(photoUrls)) : undefined,
    location,
    scrapeConfidence: 0.8,
    missingFields: [],
    rawSnapshot: {
      exploreSource: "realtor-api",
      searchRow,
      detail: detailJson
    }
  };

  payload.missingFields = inferMissingFields(payload);
  payload.scrapeConfidence = scrapeConfidenceFromMissing(payload.missingFields);
  return payload;
}

function extractTaxesAnnualFromText(body: string): number | undefined {
  const matchers = [
    /Property Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Annual Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)/iu,
    /Taxes?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*\/\s*\d{4})?/iu
  ];
  for (const matcher of matchers) {
    const matched = body.match(matcher);
    const n = toNumber(matched?.[1]);
    if (n !== undefined && n > 0) return n;
  }
  return undefined;
}

function extractCondoFeesFromText(body: string): number | undefined {
  const matchers = [
    /Maintenance Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu,
    /Condo Fees?\s*[:\n]?\s*\$?\s*([\d,]+(?:\.\d+)?)(?:\s*(?:\/|per)?\s*month(?:ly)?|\s*Monthly)?/iu
  ];
  for (const matcher of matchers) {
    const matched = body.match(matcher);
    const n = toNumber(matched?.[1]);
    if (n !== undefined && n > 0) return n;
  }
  return undefined;
}
