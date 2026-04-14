import type { RealtorExploreListingPayload } from "./types";

export function inferMissingFields(payload: RealtorExploreListingPayload): string[] {
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

export function scrapeConfidenceFromMissing(missingFields: string[]): number {
  return Math.max(0, Math.min(1, 1 - missingFields.length / 10));
}
