import type { RealtorBoundingBox } from "./bounds";
import type { ExploreTimingProfile } from "./explore-constants";
import type { DomSearchPageInfo } from "./realtor-dom-types";
import type { RealtorExploreListingPayload } from "./types";

export type ExploreJobInput = {
  locationQuery: string;
  maxPrice: number;
  radiusMiles?: number;
};

/** Optional metadata when explore runs in DOM mode (no api37). */
export type DomExploreJobMeta = {
  mode: "dom";
  mapUrl: string;
  cardsParsed: number;
  pagination: DomSearchPageInfo | null;
  domWarnings: string[];
  /** True when EXPLORE_DOM_MANUAL_CHALLENGE_MODE waited for you to pass WAF in a visible browser. */
  manualChallengeMode?: boolean;
};

export type ExploreJobResult = {
  geocodedLabel: string;
  center: { lat: number; lon: number };
  bounds: RealtorBoundingBox;
  priceMaxTier: number;
  listings: RealtorExploreListingPayload[];
  truncated: boolean;
  searchPagesFetched: number;
  detailFetches: number;
  timingProfile: ExploreTimingProfile;
  /** Present when EXPLORE_USE_DOM_SCRAPER is enabled. */
  domMeta?: DomExploreJobMeta;
};
