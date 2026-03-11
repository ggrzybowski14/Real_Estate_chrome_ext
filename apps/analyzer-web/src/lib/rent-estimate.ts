import type { AssumptionSourceDetail, AssumptionSources, ListingRecord } from "@rea/shared";
import {
  bedroomBucket,
  inferRegion,
  normalizePropertyClass,
  pickBestRentRow,
  sqftBucket,
  yearBuiltBucket
} from "./benchmark-resolver";

type RentBenchmarkRow = {
  region_code: string;
  region_label: string;
  property_type: string;
  bedrooms: number;
  sqft_band: string;
  year_built_band: string | null;
  period: string;
  median_rent: number;
  p25_rent: number | null;
  p75_rent: number | null;
  source_name: string;
  source_publisher: string;
  source_url: string;
  source_fetched_at: string;
};

type ComparableTier = "direct_or_bucket" | "same_type" | "same_beds" | "regional";

export type RentEstimateResult = {
  monthlyRent: number;
  lowRent: number;
  highRent: number;
  confidence: number;
  noRentMatch: boolean;
  method: "direct_match" | "bucket_match" | "regional_fallback" | "default";
  assumptionSource: AssumptionSourceDetail;
  consideredComparables: RentBenchmarkRow[];
};

function clampCurrency(value: number): number {
  return Math.max(Math.round(value), 0);
}

function buildEstimateFromRow(
  row: RentBenchmarkRow,
  method: "direct_match" | "bucket_match" | "regional_fallback",
  confidence: number,
  notes: string
): RentEstimateResult {
  const monthlyRent = clampCurrency(Number(row.median_rent) || 0);
  const lowRent = clampCurrency(
    Number.isFinite(Number(row.p25_rent)) && Number(row.p25_rent) > 0
      ? Number(row.p25_rent)
      : monthlyRent * 0.9
  );
  const highRent = clampCurrency(
    Number.isFinite(Number(row.p75_rent)) && Number(row.p75_rent) > 0
      ? Number(row.p75_rent)
      : monthlyRent * 1.1
  );
  return {
    monthlyRent,
    lowRent,
    highRent,
    confidence,
    noRentMatch: monthlyRent <= 0,
    method,
    assumptionSource: {
      field: "monthlyRent",
      value: monthlyRent,
      method,
      confidence,
      notes,
      reference: {
        publisher: row.source_publisher,
        dataset: row.source_name,
        metric: "median_rent",
        region: row.region_label,
        period: row.period,
        url: row.source_url,
        fetchedAt: row.source_fetched_at
      }
    },
    consideredComparables: [row]
  };
}

function fallbackEstimate(regionLabel: string): RentEstimateResult {
  return {
    monthlyRent: 0,
    lowRent: 0,
    highRent: 0,
    confidence: 0,
    noRentMatch: true,
    method: "default",
    assumptionSource: {
      field: "monthlyRent",
      value: 0,
      method: "default",
      confidence: 0,
      notes: "No regional comparables found for deterministic rent estimate.",
      reference: {
        publisher: "No comparable match",
        dataset: "Deterministic comparable search",
        metric: "median_rent",
        region: regionLabel,
        period: "n/a",
        url: "",
        fetchedAt: new Date().toISOString()
      }
    },
    consideredComparables: []
  };
}

function sortByRecency(rows: RentBenchmarkRow[]): RentBenchmarkRow[] {
  return rows.slice().sort((a, b) => b.period.localeCompare(a.period));
}

export function estimateRentFromRows(
  rows: RentBenchmarkRow[],
  listing: ListingRecord,
  assumptionSources: AssumptionSources
): RentEstimateResult {
  const propertyClass = normalizePropertyClass(listing.propertyType);
  const beds = bedroomBucket(listing.beds);
  const sizeBand = sqftBucket(listing.sqft);
  const builtBand = yearBuiltBucket(listing);
  const region = inferRegion(listing);

  const directOrBucket = pickBestRentRow(rows, propertyClass, beds, sizeBand, builtBand);
  if (directOrBucket.row) {
    return buildEstimateFromRow(
      directOrBucket.row,
      directOrBucket.method === "bucket_match" ? "bucket_match" : "direct_match",
      directOrBucket.confidence,
      `Deterministic comparable search selected ${directOrBucket.method} for ${propertyClass}/${beds} bed.`
    );
  }

  const ordered = sortByRecency(rows);
  const sameType = ordered.filter((row) => row.property_type === propertyClass);
  if (sameType.length > 0) {
    const withClosestBeds = sameType.sort((a, b) => {
      const distance = Math.abs(a.bedrooms - beds) - Math.abs(b.bedrooms - beds);
      if (distance !== 0) return distance;
      return b.period.localeCompare(a.period);
    });
    return {
      ...buildEstimateFromRow(
        withClosestBeds[0],
        "regional_fallback",
        0.7,
        `No exact ${propertyClass}/${beds} bed comparable; used closest bedroom count in same property type.`
      ),
      consideredComparables: withClosestBeds.slice(0, 5)
    };
  }

  const sameBeds = ordered.filter((row) => row.bedrooms === beds);
  if (sameBeds.length > 0) {
    return {
      ...buildEstimateFromRow(
        sameBeds[0],
        "regional_fallback",
        0.58,
        `No ${propertyClass} comparable; used same-bedroom regional comparable.`
      ),
      consideredComparables: sameBeds.slice(0, 5)
    };
  }

  if (ordered.length > 0) {
    return {
      ...buildEstimateFromRow(
        ordered[0],
        "regional_fallback",
        0.46,
        "No property-type or bedroom comparable; used latest regional benchmark."
      ),
      consideredComparables: ordered.slice(0, 5)
    };
  }

  if (assumptionSources.monthlyRent?.reference.region) {
    return fallbackEstimate(assumptionSources.monthlyRent.reference.region);
  }
  return fallbackEstimate(region.regionLabel);
}
