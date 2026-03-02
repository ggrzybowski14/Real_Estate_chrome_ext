import type {
  ListingAnalysisResult,
  ListingAssumptions,
  ListingRecord,
  ListingScore
} from "@rea/shared";
import { SCORE_THRESHOLDS } from "./config";

function monthlyMortgagePayment(
  principal: number,
  annualRatePct: number,
  amortizationYears: number
): number {
  const monthlyRate = annualRatePct / 100 / 12;
  const n = amortizationYears * 12;

  if (principal <= 0 || n <= 0) {
    return 0;
  }

  if (monthlyRate === 0) {
    return principal / n;
  }

  const factor = Math.pow(1 + monthlyRate, n);
  return (principal * monthlyRate * factor) / (factor - 1);
}

function classifyScore(roiPct: number, monthlyCashFlow: number): ListingScore {
  if (
    roiPct >= SCORE_THRESHOLDS.goodMinRoiPct &&
    monthlyCashFlow >= SCORE_THRESHOLDS.minimumMonthlyCashFlowForGood
  ) {
    return "good";
  }

  if (
    roiPct >= SCORE_THRESHOLDS.okMinRoiPct &&
    monthlyCashFlow >= SCORE_THRESHOLDS.minimumMonthlyCashFlowForOk
  ) {
    return "ok";
  }

  return "bad";
}

export function defaultAssumptionsFor(listing: ListingRecord): ListingAssumptions {
  const monthlyRentEstimate = listing.estimatedRent ?? 2500;
  return {
    downPaymentPct: 20,
    mortgageRatePct: 5.2,
    amortizationYears: 25,
    closingCostsPct: 1.5,
    monthlyRent: monthlyRentEstimate,
    vacancyPct: 5,
    maintenancePct: 5,
    annualPropertyTax: listing.taxesAnnual ?? 3500,
    monthlyInsurance: 120,
    monthlyUtilities: 180,
    managementFeePct: 8,
    rehabBudget: 10000
  };
}

export function runRoiAnalysis(
  listing: ListingRecord,
  assumptions: ListingAssumptions
): ListingAnalysisResult {
  const price = listing.price ?? 0;
  const downPayment = price * (assumptions.downPaymentPct / 100);
  const loanAmount = Math.max(price - downPayment, 0);
  const closingCosts = price * (assumptions.closingCostsPct / 100);
  const initialCashInvested = downPayment + closingCosts + assumptions.rehabBudget;

  const mortgage = monthlyMortgagePayment(
    loanAmount,
    assumptions.mortgageRatePct,
    assumptions.amortizationYears
  );
  const effectiveRent = assumptions.monthlyRent * (1 - assumptions.vacancyPct / 100);
  const monthlyMaintenance = assumptions.monthlyRent * (assumptions.maintenancePct / 100);
  const monthlyManagement = assumptions.monthlyRent * (assumptions.managementFeePct / 100);
  const monthlyPropertyTax = assumptions.annualPropertyTax / 12;

  const monthlyOperatingCosts =
    monthlyMaintenance +
    monthlyManagement +
    monthlyPropertyTax +
    assumptions.monthlyInsurance +
    assumptions.monthlyUtilities +
    (listing.condoFeesMonthly ?? 0);
  const monthlyCashFlow = effectiveRent - (mortgage + monthlyOperatingCosts);
  const annualNOI = (effectiveRent - monthlyOperatingCosts) * 12;
  const annualCashFlow = monthlyCashFlow * 12;
  const annualCashOnCashRoiPct =
    initialCashInvested > 0 ? (annualCashFlow / initialCashInvested) * 100 : 0;

  const breakEvenOccupancyPct =
    assumptions.monthlyRent > 0
      ? ((mortgage + monthlyOperatingCosts) / assumptions.monthlyRent) * 100
      : 100;

  const score = classifyScore(annualCashOnCashRoiPct, monthlyCashFlow);

  return {
    listingId: listing.id,
    score,
    monthlyMortgagePayment: mortgage,
    monthlyFixedCosts: mortgage + monthlyPropertyTax + assumptions.monthlyInsurance,
    monthlyOperatingCosts,
    monthlyCashFlow,
    annualNOI,
    annualCashOnCashRoiPct,
    breakEvenOccupancyPct,
    thresholdsVersion: SCORE_THRESHOLDS.version,
    assumptions,
    runAt: new Date().toISOString()
  };
}

export { SCORE_THRESHOLDS };
