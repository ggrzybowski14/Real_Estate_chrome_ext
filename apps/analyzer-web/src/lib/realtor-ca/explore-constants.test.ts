import test from "node:test";
import assert from "node:assert/strict";
import { jitteredDelayMs, randomIntInclusive } from "./explore-constants";

test("randomIntInclusive returns min when Math.random is 0", () => {
  const orig = Math.random;
  Math.random = () => 0;
  assert.equal(randomIntInclusive(5, 10), 5);
  Math.random = orig;
});

test("randomIntInclusive returns max when Math.random approaches 1", () => {
  const orig = Math.random;
  Math.random = () => 0.999999;
  assert.equal(randomIntInclusive(5, 10), 10);
  Math.random = orig;
});

test("randomIntInclusive when min equals max", () => {
  assert.equal(randomIntInclusive(7, 7), 7);
});

test("jitteredDelayMs respects swapped min/max", () => {
  const orig = Math.random;
  Math.random = () => 0;
  assert.equal(jitteredDelayMs(100, 50), 50);
  Math.random = orig;
});
