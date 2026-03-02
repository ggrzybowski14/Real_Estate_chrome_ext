import test from "node:test";
import assert from "node:assert/strict";
import { parseListingPayload } from "./scraper";

test("parses listing with primary fields", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/12345678/test",
    h1Text: "12 Sample Ave, Toronto, ON",
    bodyText: "Price $799,000 3 beds 2 baths 1,200 sqft",
    data: {
      price: "$799,000",
      beds: "3",
      baths: "2"
    }
  });

  assert.equal(payload.source, "realtor.ca");
  assert.equal(payload.sourceListingId, "12345678");
  assert.equal(payload.price, 799000);
  assert.equal(payload.beds, 3);
  assert.equal(payload.baths, 2);
  assert.equal(payload.address, "12 Sample Ave, Toronto, ON");
});

test("falls back to jsonLd/meta data when selectors drift", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/99999999/test",
    meta: {
      "og:title": "99 Backup Street",
      "product:price:amount": "620000",
      description: "Detached home"
    },
    jsonLdObjects: [{ name: "99 Backup Street", description: "Great lot", "@type": "House" }],
    bodyText: "2 beds 1 baths"
  });

  assert.equal(payload.address, "99 Backup Street");
  assert.equal(payload.price, 620000);
  assert.equal(payload.propertyType, "House");
  assert.equal(payload.description, "Great lot");
});
