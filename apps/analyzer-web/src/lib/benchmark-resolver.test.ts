import test from "node:test";
import assert from "node:assert/strict";
import type { ListingRecord } from "@rea/shared";
import {
  bedroomBucket,
  inferRegion,
  normalizePropertyClass,
  pickBestRentRow,
  pickBestVacancyRow,
  sqftBucket
} from "./benchmark-resolver";

function sampleListing(overrides?: Partial<ListingRecord>): ListingRecord {
  return {
    id: "listing-1",
    source: "realtor.ca",
    url: "https://realtor.ca/listing/1",
    capturedAt: "2026-03-01T00:00:00.000Z",
    address: "123 Main St, Toronto, ON",
    price: 900000,
    beds: 2,
    baths: 2,
    propertyType: "Apartment",
    sqft: 950,
    scrapeConfidence: 0.9,
    missingFields: [],
    rawSnapshot: {
      location: {
        city: "Toronto",
        province: "ON"
      }
    },
    ...overrides
  };
}

test("inferRegion maps GTA listing by city", () => {
  const region = inferRegion(sampleListing());
  assert.equal(region.regionCode, "ca-on-gta");
});

test("inferRegion maps listing by FSA postal prefix", () => {
  const region = inferRegion(
    sampleListing({
      address: "201 9949 Third St, Sidney, BC V8L 3B1",
      rawSnapshot: {
        location: {
          city: "Sidney",
          province: "BC",
          postalCode: "V8L 3B1"
        }
      }
    })
  );
  assert.equal(region.regionCode, "ca-bc-victoria");
});

test("inferRegion can infer province from postal when missing", () => {
  const region = inferRegion(
    sampleListing({
      address: "88 Unknown Ave, Ottawa K1P 1J1",
      rawSnapshot: {
        location: {
          city: "",
          province: "",
          postalCode: "K1P 1J1"
        }
      }
    })
  );
  assert.equal(region.regionCode, "ca-on-ottawa");
});

test("property and bucket helpers normalize input", () => {
  assert.equal(normalizePropertyClass("Townhouse"), "townhouse");
  assert.equal(bedroomBucket(5), 4);
  assert.equal(sqftBucket(1020), "900_1199");
});

test("pickBestRentRow prioritizes direct then bucket fallback", () => {
  const rows = [
    {
      region_code: "ca-on-gta",
      region_label: "Greater Toronto Area, ON",
      property_type: "apartment",
      bedrooms: 2,
      sqft_band: "900_1199",
      year_built_band: null,
      period: "2025-Q1",
      median_rent: 3200,
      source_name: "CMHC",
      source_publisher: "CMHC",
      source_url: "https://example.com",
      source_fetched_at: "2025-01-01T00:00:00.000Z"
    },
    {
      region_code: "ca-on-gta",
      region_label: "Greater Toronto Area, ON",
      property_type: "apartment",
      bedrooms: 2,
      sqft_band: "1200_1599",
      year_built_band: null,
      period: "2024-Q4",
      median_rent: 3000,
      source_name: "CMHC",
      source_publisher: "CMHC",
      source_url: "https://example.com",
      source_fetched_at: "2025-01-01T00:00:00.000Z"
    }
  ];

  const direct = pickBestRentRow(rows, "apartment", 2, "900_1199");
  assert.equal(direct.method, "direct_match");
  assert.equal(direct.row?.median_rent, 3200);

  const bucket = pickBestRentRow(rows, "apartment", 2, "600_899");
  assert.equal(bucket.method, "bucket_match");
  assert.ok(bucket.row);
});

test("pickBestRentRow returns no data when bedroom bucket has no match", () => {
  const rows = [
    {
      region_code: "ca-bc-victoria",
      region_label: "Greater Victoria, BC",
      property_type: "apartment",
      bedrooms: 2,
      sqft_band: "900_1199",
      year_built_band: null,
      period: "2025-Q1",
      median_rent: 2400,
      source_name: "CMHC",
      source_publisher: "CMHC",
      source_url: "https://example.com",
      source_fetched_at: "2025-01-01T00:00:00.000Z"
    }
  ];

  const result = pickBestRentRow(rows, "apartment", 4, "gte_1600");
  assert.equal(result.method, "default");
  assert.equal(result.row, null);
});

test("pickBestVacancyRow falls back to regional entry", () => {
  const rows = [
    {
      region_code: "ca-on-gta",
      region_label: "Greater Toronto Area, ON",
      property_type: "house",
      period: "2025-Q1",
      vacancy_pct: 2.1,
      source_name: "CMHC",
      source_publisher: "CMHC",
      source_url: "https://example.com",
      source_fetched_at: "2025-01-01T00:00:00.000Z"
    }
  ];
  const result = pickBestVacancyRow(rows, "apartment");
  assert.equal(result.method, "regional_fallback");
  assert.equal(result.row?.vacancy_pct, 2.1);
});
