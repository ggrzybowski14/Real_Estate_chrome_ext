import test from "node:test";
import assert from "node:assert/strict";
import type { ListingRecord } from "@rea/shared";
import { defaultAssumptionsFor, runRoiAnalysis } from "./index";

const listing: ListingRecord = {
  id: "l-1",
  source: "realtor.ca",
  url: "https://www.realtor.ca/real-estate/123",
  capturedAt: new Date().toISOString(),
  address: "123 Test St",
  price: 500000,
  scrapeConfidence: 0.9,
  missingFields: []
};

test("runRoiAnalysis returns numeric metrics", () => {
  const assumptions = defaultAssumptionsFor(listing);
  const result = runRoiAnalysis(listing, assumptions);

  assert.equal(result.listingId, listing.id);
  assert.equal(typeof result.monthlyCashFlow, "number");
  assert.equal(typeof result.annualCashOnCashRoiPct, "number");
  assert.equal(typeof result.breakEvenOccupancyPct, "number");
  assert.ok(["good", "ok", "bad"].includes(result.score));
});

test("score is bad for clearly negative cash flow", () => {
  const assumptions = {
    ...defaultAssumptionsFor(listing),
    monthlyRent: 1200,
    mortgageRatePct: 8
  };
  const result = runRoiAnalysis(listing, assumptions);
  assert.equal(result.score, "bad");
});

test("score improves with strong rent and lower financing costs", () => {
  const assumptions = {
    ...defaultAssumptionsFor(listing),
    monthlyRent: 4500,
    downPaymentPct: 35,
    mortgageRatePct: 3.5
  };
  const result = runRoiAnalysis(listing, assumptions);
  assert.ok(result.score === "ok" || result.score === "good");
});
