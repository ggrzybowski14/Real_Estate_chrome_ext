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

test("buildRentalsCaSearchUrl repairs collapsed street-city addresses", () => {
  const url = buildRentalsCaSearchUrl(
    sampleListing({
      address: "204 330 Brae RdDuncan, British Columbia V9L3T8",
      rawSnapshot: {}
    })
  );
  assert.ok(url.startsWith("https://rentals.ca/duncan"));
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
    new Response(
      `
      <a href="/victoria/listing-a">$2,100 / month • 2 bed • 2 bath • 900 sqft • modern renovated suite</a>
      <a href="/victoria/listing-b">$2,300 / month • 2 bed • 2 bath • 920 sqft • modern apartment</a>
      <a href="/victoria/listing-c">$2,500 / month • 2 bed • 2 bath • 930 sqft • premium finishes</a>
      <a href="/victoria/listing-d">$3,400 / month • 4 bed • 3 bath • 1800 sqft • house</a>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(sampleListing());
    assert.equal(result.noRentMatch, false);
    assert.equal(result.monthlyRent, 2300);
    assert.equal(result.lowRent, 2200);
    assert.equal(result.highRent, 2400);
    assert.equal(result.method, "regional_fallback");
    assert.equal(result.assumptionSource.reference.publisher, "Rentals.ca");
    assert.equal(result.retrievalTrace.searchUrl.startsWith("https://rentals.ca/victoria"), true);
    assert.equal(result.retrievalTrace.fetchMode, "http_fetch");
    assert.equal(result.retrievalTrace.parsedRentCount, 4);
    assert.equal(result.retrievalTrace.cleanedRentCount, 3);
    assert.deepEqual(result.retrievalTrace.sampleCleanedRents.sort((a, b) => a - b), [2100, 2300, 2500]);
    assert.equal(result.retrievalTrace.matchedComparableCount, 3);
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
    assert.equal(result.retrievalTrace.parsedRentCount, 0);
    assert.equal(result.retrievalTrace.cleanedRentCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa rejects non-similar comparables", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `
      <a href="/victoria/large-home">$3,950 / month • 5 bed • 4 bath • 2600 sqft • luxury</a>
      <a href="/victoria/studio">$1,450 / month • 1 bed • 1 bath • 520 sqft • basic</a>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(sampleListing());
    assert.equal(result.noRentMatch, true);
    assert.equal(result.monthlyRent, 0);
    assert.equal(result.retrievalTrace.matchedComparableCount, 0);
    assert.match(result.assumptionSource.notes ?? "", /beds \+ rough location/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa parses Bedrooms/Bathrooms labels and urls without city slug", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `
      <a href="/apartments/abc-1">$2,180 / month • 2 Bedrooms • 2 Bathrooms • 1,000 sqft • modern</a>
      <a href="/apartments/abc-2">$2,260 / month • 2 Bedrooms • 2 Bathrooms • 1,040 sqft • renovated</a>
      <a href="/apartments/abc-3">$2,320 / month • 2 Bedrooms • 1 Bathrooms • 980 sqft • updated</a>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(
      sampleListing({
        address: "204 330 Brae RdDuncan, British Columbia V9L3T8",
        rawSnapshot: {
          data: { latitude: 48.7787, longitude: -123.7079 }
        }
      })
    );
    assert.equal(result.noRentMatch, false);
    assert.equal(result.retrievalTrace.matchedComparableCount, 3);
    assert.equal(result.retrievalTrace.cleanedRentCount, 3);
    assert.ok(result.monthlyRent >= 2180 && result.monthlyRent <= 2320);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa prefers nearby comps when coordinates are available", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `
      <script type="application/ld+json">
      {"url":"https://rentals.ca/apartments/near-1","price":"2200","name":"2 Bedrooms 2 Bathrooms 1000 sqft modern","latitude":48.7800,"longitude":-123.7000}
      {"url":"https://rentals.ca/apartments/far-1","price":"2250","name":"2 Bedrooms 2 Bathrooms 1010 sqft renovated","latitude":49.3000,"longitude":-123.1200}
      </script>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(
      sampleListing({
        rawSnapshot: {
          location: { city: "Duncan", province: "BC" },
          data: { latitude: "48.7787", longitude: "-123.7079" }
        }
      })
    );
    assert.equal(result.noRentMatch, false);
    assert.equal(result.retrievalTrace.matchedComparableCount, 1);
    assert.equal(result.retrievalTrace.comparableListings.length, 1);
    assert.match(result.retrievalTrace.matchingNotes ?? "", /within 15km/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa can match address-like inline comps without link URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `
      <div>$2,050 / month | 2 Bedrooms | 2 Bathrooms | 990 sqft | 120 Trunk Rd Duncan BC V9L</div>
      <div>$2,180 / month | 2 Bedrooms | 2 Bathrooms | 1040 sqft | 210 Brae Rd Duncan BC V9L</div>
      <div>$2,900 / month | 4 Bedrooms | 3 Bathrooms | 1850 sqft | Nanaimo BC</div>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(
      sampleListing({
        address: "204 330 Brae RdDuncan, British Columbia V9L3T8",
        rawSnapshot: {}
      })
    );
    assert.equal(result.noRentMatch, false);
    assert.ok((result.retrievalTrace.matchedComparableCount ?? 0) >= 1);
    assert.match(result.retrievalTrace.matchingNotes ?? "", /address proximity/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateRentFromRentalsCa can use address-only fallback when structural fields are missing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `
      <div>$2,040 / month | Duncan BC V9L | rentals.ca/apartments/a</div>
      <div>$2,120 / month | Duncan BC V9L | rentals.ca/apartments/b</div>
      <div>$2,980 / month | Victoria BC V8V | rentals.ca/apartments/c</div>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    )) as typeof fetch;

  try {
    const result = await estimateRentFromRentalsCa(
      sampleListing({
        address: "204 330 Brae RdDuncan, British Columbia V9L3T8",
        rawSnapshot: {}
      })
    );
    assert.equal(result.noRentMatch, false);
    assert.ok((result.retrievalTrace.matchedComparableCount ?? 0) >= 1);
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
