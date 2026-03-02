export type ListingSource = "realtor.ca";

export type ListingScore = "good" | "ok" | "bad";

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
  runAt: string;
}
