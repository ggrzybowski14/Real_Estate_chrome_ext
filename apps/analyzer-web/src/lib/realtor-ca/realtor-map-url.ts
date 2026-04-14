import type { RealtorBoundingBox } from "./bounds";

const MAP_BASE_PRIMARY = "https://www.realtor.ca/map";

export type RealtorMapUrlParams = {
  bounds: RealtorBoundingBox;
  priceMin: number;
  priceMax: number;
};

/**
 * Build the same hash search the map SPA uses (aligned with PropertySearch_Post filters in run-explore-job).
 * Fragment uses application/x-www-form-urlencoded style key=value pairs.
 */
export function buildRealtorMapSearchUrl(params: RealtorMapUrlParams): string {
  const pairs: Array<[string, string]> = [
    ["ApplicationId", "37"],
    ["CultureId", "1"],
    ["HashCode", "0"],
    ["LatitudeMax", String(params.bounds.LatitudeMax)],
    ["LatitudeMin", String(params.bounds.LatitudeMin)],
    ["LongitudeMax", String(params.bounds.LongitudeMax)],
    ["LongitudeMin", String(params.bounds.LongitudeMin)],
    ["PriceMax", String(params.priceMax)],
    ["PriceMin", String(params.priceMin)],
    ["PropertySearchTypeId", "1"],
    ["TransactionTypeId", "2"]
  ];
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const frag = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${MAP_BASE_PRIMARY}#${frag}`;
}
