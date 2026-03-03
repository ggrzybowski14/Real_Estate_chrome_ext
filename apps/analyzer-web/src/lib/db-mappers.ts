import type { ListingAnalysisResult, ListingAssumptions, ListingRecord } from "@rea/shared";
import type { StoredListing } from "./types";

type ListingRow = {
  id: string;
  source: "realtor.ca";
  source_listing_id: string | null;
  url: string;
  captured_at: string;
  address: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  property_type: string | null;
  sqft: number | null;
  description: string | null;
  estimated_rent: number | null;
  days_on_market: number | null;
  taxes_annual: number | null;
  condo_fees_monthly: number | null;
  scrape_confidence: number;
  missing_fields: string[] | null;
  raw_snapshot: Record<string, unknown> | null;
};

type AnalysisRunRow = {
  id: string;
  listing_id: string;
  score: "good" | "ok" | "bad";
  monthly_mortgage_payment: number;
  monthly_fixed_costs: number;
  monthly_operating_costs: number;
  monthly_cash_flow: number;
  annual_noi: number;
  annual_cash_on_cash_roi_pct: number;
  break_even_occupancy_pct: number;
  thresholds_version: string;
  assumptions: ListingAssumptions;
  run_at: string;
};

export function mapListingRowToRecord(row: ListingRow): ListingRecord {
  return {
    id: row.id,
    source: row.source,
    sourceListingId: row.source_listing_id ?? undefined,
    url: row.url,
    capturedAt: row.captured_at,
    address: row.address ?? undefined,
    price: row.price ?? undefined,
    beds: row.beds ?? undefined,
    baths: row.baths ?? undefined,
    propertyType: row.property_type ?? undefined,
    sqft: row.sqft ?? undefined,
    description: row.description ?? undefined,
    estimatedRent: row.estimated_rent ?? undefined,
    daysOnMarket: row.days_on_market ?? undefined,
    taxesAnnual: row.taxes_annual ?? undefined,
    condoFeesMonthly: row.condo_fees_monthly ?? undefined,
    scrapeConfidence: row.scrape_confidence,
    missingFields: row.missing_fields ?? [],
    rawSnapshot: row.raw_snapshot ?? undefined
  };
}

export function mapAnalysisRowToResult(row: AnalysisRunRow): ListingAnalysisResult {
  return {
    listingId: row.listing_id,
    score: row.score,
    monthlyMortgagePayment: row.monthly_mortgage_payment,
    monthlyFixedCosts: row.monthly_fixed_costs,
    monthlyOperatingCosts: row.monthly_operating_costs,
    monthlyCashFlow: row.monthly_cash_flow,
    annualNOI: row.annual_noi,
    annualCashOnCashRoiPct: row.annual_cash_on_cash_roi_pct,
    breakEvenOccupancyPct: row.break_even_occupancy_pct,
    thresholdsVersion: row.thresholds_version,
    assumptions: row.assumptions,
    runAt: row.run_at
  };
}

export function mapRecordToListingInsert(record: ListingRecord) {
  return {
    source: record.source,
    source_listing_id: record.sourceListingId ?? null,
    url: record.url,
    captured_at: record.capturedAt,
    address: record.address ?? null,
    price: record.price ?? null,
    beds: record.beds ?? null,
    baths: record.baths ?? null,
    property_type: record.propertyType ?? null,
    sqft: record.sqft ?? null,
    description: record.description ?? null,
    estimated_rent: record.estimatedRent ?? null,
    days_on_market: record.daysOnMarket ?? null,
    taxes_annual: record.taxesAnnual ?? null,
    condo_fees_monthly: record.condoFeesMonthly ?? null,
    scrape_confidence: record.scrapeConfidence,
    missing_fields: record.missingFields,
    raw_snapshot: record.rawSnapshot ?? null
  };
}

export function mapAnalysisToInsert(result: ListingAnalysisResult) {
  return {
    listing_id: result.listingId,
    score: result.score,
    monthly_mortgage_payment: result.monthlyMortgagePayment,
    monthly_fixed_costs: result.monthlyFixedCosts,
    monthly_operating_costs: result.monthlyOperatingCosts,
    monthly_cash_flow: result.monthlyCashFlow,
    annual_noi: result.annualNOI,
    annual_cash_on_cash_roi_pct: result.annualCashOnCashRoiPct,
    break_even_occupancy_pct: result.breakEvenOccupancyPct,
    thresholds_version: result.thresholdsVersion,
    assumptions: result.assumptions,
    run_at: result.runAt
  };
}

export function buildStoredListing(
  listing: ListingRecord,
  history: ListingAnalysisResult[]
): StoredListing | null {
  const latestAnalysis = history[0];
  if (!latestAnalysis) {
    return null;
  }
  return {
    listing,
    assumptions: latestAnalysis.assumptions,
    latestAnalysis,
    history
  };
}
