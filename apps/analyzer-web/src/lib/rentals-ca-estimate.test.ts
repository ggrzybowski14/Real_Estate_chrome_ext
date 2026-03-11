import test from "node:test";
import assert from "node:assert/strict";
import type { ListingRecord } from "@rea/shared";
import {
  __rentalsCaTestUtils,
  buildRentalsCaSearchUrl,
  estimateRentFromRentalsCa,
  extractRentValuesFromHtml
} from "./rentals-ca-estimate";

process.env.RENTALS_USE_PLAYWRIGHT = "false";

function sampleListing(overrides?: Partial<ListingRecord>): ListingRecord {
  return {
    id: "listing-rentals-1",
    source: "realtor.ca",
    url: "https://realtor.ca/listing/1",
    capturedAt: "2026-03-10T00:00:00.000Z",
    address: "123 Main St, Victoria, BC",
    price: 900000,
    beds: 2,
    baths: 2,
    propertyType: "Apartment",
    sqft: 910,
    scrapeConfidence: 0.9,
    missingFields: [],
    rawSnapshot: {
      location: {
        city: "Victoria",
        province: "BC"
      }
    },
    ...overrides
  };
}

test("buildRentalsCaSearchUrl includes city and basic filters", () => {
  const url = buildRentalsCaSearchUrl(sampleListing());
  assert.ok(url.startsWith("https://rentals.ca/victoria"));
  assert.ok(url.includes("beds=2"));
  assert.ok(url.includes("sizeBand=900_1199"));
  assert.ok(url.includes("regionCode=ca-bc-victoria"));
});

test("extractRentValuesFromHtml parses dollar and json price values", () => {
  const html = `
    <div>$2,350 / month</div>
    <script type="application/ld+json">{"price":"2795"}</script>
    <span>$0</span>
    <span>$99,999</span>
  `;
  const rents = extractRentValuesFromHtml(html);
  assert.deepEqual(rents.sort((a, b) => a - b), [2350, 2795]);
});

test("outlier filter removes extreme values", () => {
  const cleaned = __rentalsCaTestUtils.removeOutliers([1800, 1900, 2000, 2100, 2200, 15000]);
  assert.deepEqual(cleaned.sort((a, b) => a - b), [1800, 1900, 2000, 2100, 2200]);
});

test("estimateRentFromRentalsCa returns summarized estimate when fetch parses data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<div>$2,100 / month</div><div>$2,300 / month</div><div>$2,500 / month</div>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(sampleListing());
    assert.equal(result.noRentMatch, false);
    assert.equal(result.monthlyRent, 2300);
    assert.equal(result.lowRent, 2200);
    assert.equal(result.highRent, 2400);
    assert.equal(result.method, "regional_fallback");
    assert.equal(result.assumptionSource.reference.publisher, "Rentals.ca");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa returns no-match payload when fallback has no data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<html><body>No rents found</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(sampleListing());
    assert.equal(result.noRentMatch, true);
    assert.equal(result.monthlyRent, 0);
    assert.equal(result.method, "default");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa returns explicit message for Cloudflare block pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      "<html><head><title>Just a moment...</title></head><body>Cloudflare challenge-platform</body></html>",
      {
        status: 403,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(sampleListing());
    assert.equal(result.noRentMatch, true);
    assert.match(result.assumptionSource.notes ?? "", /Cloudflare|Playwright|403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
