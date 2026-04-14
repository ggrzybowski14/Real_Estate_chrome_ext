/** Mirrors `ScrapedListingPayload` in apps/chrome-extension/src/content/scraper.ts */
export type LocationSnapshot = {
  street?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};

export type RealtorExploreListingPayload = {
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
};
