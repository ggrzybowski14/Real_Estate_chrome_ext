import test from "node:test";
import assert from "node:assert/strict";
import { resolveExploreDomKeepBrowserOpen, resolvePlaywrightHeadless } from "./realtor-browser-log";

test("resolvePlaywrightHeadless is false only for exact string false", () => {
  const prev = process.env.PLAYWRIGHT_HEADLESS;
  try {
    delete process.env.PLAYWRIGHT_HEADLESS;
    assert.equal(resolvePlaywrightHeadless(), true);
    process.env.PLAYWRIGHT_HEADLESS = "";
    assert.equal(resolvePlaywrightHeadless(), true);
    process.env.PLAYWRIGHT_HEADLESS = "false";
    assert.equal(resolvePlaywrightHeadless(), false);
    process.env.PLAYWRIGHT_HEADLESS = "False";
    assert.equal(resolvePlaywrightHeadless(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.PLAYWRIGHT_HEADLESS;
    } else {
      process.env.PLAYWRIGHT_HEADLESS = prev;
    }
  }
});

test("resolveExploreDomKeepBrowserOpen is true only for exact string true", () => {
  const prev = process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN;
  try {
    delete process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN;
    assert.equal(resolveExploreDomKeepBrowserOpen(), false);
    process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN = "true";
    assert.equal(resolveExploreDomKeepBrowserOpen(), true);
    process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN = "True";
    assert.equal(resolveExploreDomKeepBrowserOpen(), false);
  } finally {
    if (prev === undefined) {
      delete process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN;
    } else {
      process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN = prev;
    }
  }
});
