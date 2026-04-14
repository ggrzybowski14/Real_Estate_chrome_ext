import test from "node:test";
import assert from "node:assert/strict";
import { buildRealtorMapSearchUrl } from "./realtor-map-url";

test("buildRealtorMapSearchUrl encodes sorted keys and bounds", () => {
  const url = buildRealtorMapSearchUrl({
    bounds: {
      LatitudeMin: 48.0,
      LatitudeMax: 48.2,
      LongitudeMin: -123.5,
      LongitudeMax: -123.2
    },
    priceMin: 0,
    priceMax: 1_000_000
  });
  assert.ok(url.startsWith("https://www.realtor.ca/map#"));
  const frag = url.slice(url.indexOf("#") + 1);
  assert.match(frag, /^ApplicationId=/u);
  assert.ok(frag.includes("LatitudeMax=48.2"));
  assert.ok(frag.includes("LongitudeMin=-123.5"));
  assert.ok(frag.includes("PriceMax=1000000"));
  assert.ok(frag.includes("TransactionTypeId=2"));
});
