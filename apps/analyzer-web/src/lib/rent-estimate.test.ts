import test from "node:test";
import assert from "node:assert/strict";
import type { ListingRecord } from "@rea/shared";
import { estimateRentFromRows } from "./rent-estimate";

function sampleListing(overrides?: Partial<ListingRecord>): ListingRecord {
  return {
    id: "listing-1",
    source: "realtor.ca",
    url: "https://realtor.ca/listing/1",
    capturedAt: "2026-03-01T00:00:00.000Z",
    address: "123 Main St, Victoria, BC",
    price: 900000,
    beds: 3,
    baths: 2,
    propertyType: "House",
    sqft: 1500,
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

test("estimateRentFromRows returns direct match when available", () => {
  const listing = sampleListing();
  const rows = [
    {
      region_code: "ca-bc-victoria",
      region_label: "Greater Victoria, BC",
      property_type: "house",
      bedrooms: 3,
      sqft_band: "1200_1599",
      year_built_band: null,
      period: "2025-Q1",
      median_rent: 3600,
      p25_rent: 3300,
      p75_rent: 3900,
      source_name: "StatCan Quarterly Rent Statistics",
      source_publisher: "Statistics Canada",
      source_url: "https://example.com",
      source_fetched_at: "2026-01-01T00:00:00.000Z"
    }
  ];

  const result = estimateRentFromRows(rows, listing, {});
  assert.equal(result.method, "direct_match");
  assert.equal(result.monthlyRent, 3600);
  assert.equal(result.lowRent, 3300);
  assert.equal(result.highRent, 3900);
});

test("estimateRentFromRows falls back to same property type when beds do not match", () => {
  const listing = sampleListing({ beds: 4 });
  const rows = [
    {
      region_code: "ca-bc-victoria",
      region_label: "Greater Victoria, BC",
      property_type: "house",
      bedrooms: 3,
      sqft_band: "1200_1599",
      year_built_band: null,
      period: "2025-Q1",
      median_rent: 3450,
      p25_rent: null,
      p75_rent: null,
      source_name: "CMHC Average Rents (StatCan 34-10-0133-01)",
      source_publisher: "CMHC / Statistics Canada",
      source_url: "https://example.com",
      source_fetched_at: "2026-01-01T00:00:00.000Z"
    }
  ];

  const result = estimateRentFromRows(rows, listing, {});
  assert.equal(result.method, "regional_fallback");
  assert.equal(result.monthlyRent, 3450);
  assert.equal(result.lowRent, 3105);
  assert.equal(result.highRent, 3795);
});

test("estimateRentFromRows returns default no-match when no comparables exist", () => {
  const listing = sampleListing();
  const result = estimateRentFromRows([], listing, {});
  assert.equal(result.method, "default");
  assert.equal(result.monthlyRent, 0);
  assert.equal(result.noRentMatch, true);
});
