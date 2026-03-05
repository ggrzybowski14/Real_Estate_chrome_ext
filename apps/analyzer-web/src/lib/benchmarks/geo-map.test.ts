import test from "node:test";
import assert from "node:assert/strict";
import {
  mapStatcanGeographyToRegion,
  parseBedrooms,
  parsePeriod,
  parsePropertyType
} from "./geo-map";

test("maps StatCan geography aliases to internal region", () => {
  const toronto = mapStatcanGeographyToRegion("Toronto, Ontario");
  assert.equal(toronto?.regionCode, "ca-on-gta");

  const victoria = mapStatcanGeographyToRegion("Victoria CMA");
  assert.equal(victoria?.regionCode, "ca-bc-victoria");
});

test("parses bedroom text values", () => {
  assert.equal(parseBedrooms("Two bedroom"), 2);
  assert.equal(parseBedrooms("3 bedrooms"), 3);
  assert.equal(parseBedrooms("Bachelor"), 1);
});

test("parses quarterly and annual periods", () => {
  assert.equal(parsePeriod("2025-Q1"), "2025-Q1");
  assert.equal(parsePeriod("First quarter 2025"), "2025-Q1");
  assert.equal(parsePeriod("2024"), "2024");
});

test("normalizes property types from source labels", () => {
  assert.equal(parsePropertyType("Townhouse"), "townhouse");
  assert.equal(parsePropertyType("Detached house"), "house");
  assert.equal(parsePropertyType("Apartment"), "apartment");
});
