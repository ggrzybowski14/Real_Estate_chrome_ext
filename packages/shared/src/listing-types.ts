export type ListingSource = "realtor.ca";

export type ListingScore = "good" | "ok" | "bad";

export type AssumptionField =
  | "downPaymentPct"
  | "mortgageRatePct"
  | "amortizationYears"
  | "closingCostsPct"
  | "monthlyRent"
  | "vacancyPct"
  | "maintenancePct"
  | "annualPropertyTax"
  | "monthlyInsurance"
  | "monthlyUtilities"
  | "managementFeePct"
  | "rehabBudget";

export interface ListingRecord {
  id: string;
  source: ListingSource;
  sourceListingId?: string;
  url: string;
  capturedAt: string;
  address?: string;
  price?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  sqft?: number;
  description?: string;
  estimatedRent?: number;
  daysOnMarket?: number;
  taxesAnnual?: number;
  condoFeesMonthly?: number;
  scrapeConfidence: number;
  missingFields: string[];
  rawSnapshot?: Record<string, unknown>;
}

export interface ListingAssumptions {
  downPaymentPct: number;
  mortgageRatePct: number;
  amortizationYears: number;
  closingCostsPct: number;
  monthlyRent: number;
  vacancyPct: number;
  maintenancePct: number;
  annualPropertyTax: number;
  monthlyInsurance: number;
  monthlyUtilities: number;
  managementFeePct: number;
  rehabBudget: number;
}

export type AssumptionEstimateMethod =
  | "direct_match"
  | "bucket_match"
  | "regional_fallback"
  | "manual"
  | "default";

export interface AssumptionSourceReference {
  publisher: string;
  dataset: string;
  metric: string;
  region: string;
  period: string;
  url: string;
  fetchedAt: string;
}

export interface AssumptionSourceDetail {
  field: AssumptionField;
  value: number;
  method: AssumptionEstimateMethod;
  confidence: number;
  notes?: string;
  reference: AssumptionSourceReference;
}

export type AssumptionSources = Partial<Record<AssumptionField, AssumptionSourceDetail>>;

export interface BenchmarkContext {
  regionCode: string;
  regionLabel: string;
  propertyClass: string;
  bedroomBucket: number;
  sqftBucket: string;
  yearBuiltBucket?: string;
}

export interface ListingAnalysisResult {
  listingId: string;
  score: ListingScore;
  monthlyMortgagePayment: number;
  monthlyFixedCosts: number;
  monthlyOperatingCosts: number;
  monthlyCashFlow: number;
  annualNOI: number;
  annualCashOnCashRoiPct: number;
  breakEvenOccupancyPct: number;
  thresholdsVersion: string;
  assumptions: ListingAssumptions;
  assumptionSources?: AssumptionSources;
  benchmarkContext?: BenchmarkContext;
  runAt: string;
}
