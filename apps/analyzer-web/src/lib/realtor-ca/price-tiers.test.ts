import test from "node:test";
import assert from "node:assert/strict";
import { snapPriceMaxToTier, snapPriceMinToTier } from "./price-tiers";

test("snapPriceMaxToTier rounds up to next tier", () => {
  assert.equal(snapPriceMaxToTier(999000), 1000000);
  assert.equal(snapPriceMaxToTier(1000000), 1000000);
});

test("snapPriceMinToTier rounds down", () => {
  assert.equal(snapPriceMinToTier(0), 0);
  assert.equal(snapPriceMinToTier(100000), 100000);
});
