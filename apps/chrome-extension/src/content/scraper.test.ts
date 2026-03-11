import test from "node:test";
import assert from "node:assert/strict";
import { parseListingPayload } from "./scraper";

test("parses listing with primary fields", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/12345678/test",
    h1Text: "12 Sample Ave, Toronto, ON",
    bodyText: "Price $799,000 3 beds 2 baths 1,200 sqft",
    photoUrls: ["https://cdn.realtor.ca/photo-1.jpg"],
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
  assert.equal(payload.photoUrls?.[0], "https://cdn.realtor.ca/photo-1.jpg");
});

test("falls back to jsonLd/meta data when selectors drift", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/99999999/test",
    meta: {
      "og:title": "99 Backup Street",
      "product:price:amount": "620000",
      "og:image": "https://cdn.realtor.ca/fallback.jpg",
      description: "Detached home"
    },
    jsonLdObjects: [
      {
        name: "99 Backup Street",
        description: "Great lot",
        "@type": "House",
        image: ["https://cdn.realtor.ca/photo-a.jpg", "https://cdn.realtor.ca/photo-b.jpg"]
      }
    ],
    bodyText: "2 beds 1 baths"
  });

  assert.equal(payload.address, "99 Backup Street");
  assert.equal(payload.price, 620000);
  assert.equal(payload.propertyType, "House");
  assert.equal(payload.description, "Great lot");
  assert.ok((payload.photoUrls?.length ?? 0) >= 2);
});

test("uses for-sale meta price before noisy body amounts", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/77777777/test",
    meta: {
      description: "Single Family house for sale $1,899,999. Price History available."
    },
    bodyText: "Mortgage calculator total: $2,192,026 over term"
  });

  assert.equal(payload.price, 1899999);
});

test("prefers jsonLd offers price when available", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/88888888/test",
    jsonLdObjects: [
      {
        "@context": "https://schema.org",
        "@type": "Offer",
        price: "1495000"
      }
    ],
    bodyText: "Total mortgage over term: $2,300,000"
  });

  assert.equal(payload.price, 1495000);
});

test("does not infer price from noisy body-only values", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/11111111/test",
    bodyText: "Mortgage calculator total: $2,300,000 and payment $9,999 per month"
  });

  assert.equal(payload.price, undefined);
});

test("extracts building type from body summary label", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/22222222/test",
    bodyText: "Property Summary\nBuilding Type\nDuplex\nProperty Type\nSingle Family"
  });

  assert.equal(payload.propertyType, "Duplex");
});

test("extracts condo fees and year built from body text", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/33333333/test",
    bodyText:
      "Maintenance or Condo Information\nMaintenance Fees\n$633 Monthly\nBuilding Information\nYear Built\n1998"
  });

  assert.equal(payload.condoFeesMonthly, 633);
  assert.equal(payload.yearBuilt, 1998);
});

test("extracts annual property taxes from body text", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/44444444/test",
    bodyText: "Property Summary\nProperty Taxes\n$3,782 / 2025"
  });

  assert.equal(payload.taxesAnnual, 3782);
});

test("normalizes missing street-city separator in scraped address", () => {
  const payload = parseListingPayload({
    url: "https://www.realtor.ca/real-estate/55555555/test",
    h1Text: "204 330 Brae RdDuncan, British Columbia V9L3T8"
  });

  assert.equal(payload.address, "204 330 Brae Rd, Duncan, British Columbia V9L3T8");
  assert.equal(payload.location?.street, "204 330 Brae Rd");
  assert.equal(payload.location?.city, "Duncan");
  assert.equal(payload.location?.province, "British Columbia");
  assert.equal(payload.location?.postalCode, "V9L3T8");
});
