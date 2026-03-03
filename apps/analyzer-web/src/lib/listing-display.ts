import type { ListingRecord } from "@rea/shared";

export interface ListingDisplayData {
  photoUrls: string[];
  city?: string;
  province?: string;
  postalCode?: string;
  street?: string;
  country?: string;
  description?: string;
  propertyType?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string" && Boolean(v));
}

export function getListingDisplayData(listing: ListingRecord): ListingDisplayData {
  const raw = asObject(listing.rawSnapshot);
  const nested = asObject(raw.rawSnapshot);
  const location = asObject(raw.location);
  const nestedLocation = asObject(nested.location);

  const photos = Array.from(
    new Set([
      ...stringArray(raw.photoUrls),
      ...stringArray(nested.photoUrls),
      stringValue(asObject(raw.meta)["og:image"]),
      stringValue(asObject(nested.meta)["og:image"])
    ].filter((v): v is string => Boolean(v)))
  );

  return {
    photoUrls: photos,
    city: stringValue(location.city) ?? stringValue(nestedLocation.city),
    province: stringValue(location.province) ?? stringValue(nestedLocation.province),
    postalCode: stringValue(location.postalCode) ?? stringValue(nestedLocation.postalCode),
    street: stringValue(location.street) ?? stringValue(nestedLocation.street),
    country: stringValue(location.country) ?? stringValue(nestedLocation.country),
    description:
      listing.description ??
      stringValue(raw.description) ??
      stringValue(nested.description),
    propertyType:
      listing.propertyType ??
      stringValue(raw.propertyType) ??
      stringValue(nested.propertyType)
  };
}
