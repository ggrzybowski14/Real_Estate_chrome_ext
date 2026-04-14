/**
 * DOM-only explore: map URL → wait for listing anchors → scrape cards (no api37).
 *
 * Manual WAF: set EXPLORE_DOM_MANUAL_CHALLENGE_MODE=true and PLAYWRIGHT_HEADLESS=false, restart Next,
 * then complete the challenge in the visible Chromium window — we poll for /real-estate/ links until
 * EXPLORE_DOM_MANUAL_CHALLENGE_MAX_MS (default 15m).
 *
 * EXPLORE_DOM_KEEP_BROWSER_OPEN=true skips closing Chromium after the run (debugging).
 * EXPLORE_DOM_SKIP_MAP_SEARCH_TYPING=true skips filling the on-page map search box (hash URL only).
 *
 * Limitations: brittle selectors, lazy-loaded lists, same infra IP issues as API path;
 * pagination not fully implemented (see EXPLORE_DOM_MAX_PAGES).
 */

import { boundingBoxFromCenterMiles } from "./bounds";
import {
  EXPLORE_DEFAULT_RADIUS_MILES,
  buildExploreTimingProfile,
  jitteredDelayMs,
  type ExploreTimingProfile
} from "./explore-constants";
import type { ExploreJobInput, ExploreJobResult } from "./explore-job-types";
import { logExplorePhase } from "./explore-log";
import { geocodeLocationQuery } from "./geocode";
import {
  extractListingCardsFromPage,
  parseSearchPageInfo,
  waitForListingAnchors
} from "./realtor-dom-extract";
import { detectBlockedOrIncomplete } from "./realtor-dom-guards";
import { domCardsToExplorePayloads } from "./realtor-dom-payload";
import { buildRealtorMapSearchUrl } from "./realtor-map-url";
import {
  RealtorDomExploreError,
  REALTOR_DOM_ERROR_BLOCKED,
  type DomExploreDiagnostics
} from "./realtor-dom-types";
import { logRealtorBrowser, resolvePlaywrightHeadless } from "./realtor-browser-log";
import { withRealtorDomPlaywrightSession } from "./realtor-dom-session";
import { snapPriceMaxToTier, snapPriceMinToTier } from "./price-tiers";

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function getDomSettleMs(): number {
  const min = parseEnvInt("EXPLORE_DOM_SETTLE_MIN_MS", 2000);
  const max = parseEnvInt("EXPLORE_DOM_SETTLE_MAX_MS", 4500);
  return jitteredDelayMs(Math.min(min, max), Math.max(min, max));
}

function getDomMaxListings(): number {
  return Math.max(1, parseEnvInt("EXPLORE_DOM_MAX_LISTINGS", 12));
}

function getDomListingWaitMs(): number {
  return Math.max(5000, parseEnvInt("EXPLORE_DOM_LISTING_WAIT_MS", 45_000));
}

/** After normal timeouts, poll until listing links appear (for manual WAF / captcha solve in headed browser). */
function getManualChallengeMaxMs(): number {
  return Math.max(60_000, parseEnvInt("EXPLORE_DOM_MANUAL_CHALLENGE_MAX_MS", 900_000));
}

function isManualChallengeMode(): boolean {
  return process.env.EXPLORE_DOM_MANUAL_CHALLENGE_MODE === "true";
}

function shouldSkipMapSearchTyping(): boolean {
  return process.env.EXPLORE_DOM_SKIP_MAP_SEARCH_TYPING === "true";
}

/**
 * Hash-based map URL often loads the area, but listing anchors may not appear until the UI search
 * is applied. Best-effort: find a visible search/combobox input and submit the location query.
 */
async function tryApplyMapSearchQuery(
  page: import("playwright").Page,
  locationQuery: string
): Promise<boolean> {
  const q = locationQuery.trim();
  if (!q) {
    logExplorePhase("domMapSearchTyped", { ok: false, reason: "emptyQuery" });
    return false;
  }

  const tryLocators: Array<import("playwright").Locator> = [
    page.getByPlaceholder(/search|city|address|location|neighbourhood|postal|province/i),
    page.getByRole("searchbox"),
    page.locator('input[type="search"]'),
    page.locator('[role="combobox"] input'),
    page.locator("header input:not([type=\"hidden\"])"),
    page.locator('[class*="search" i] input:not([type="hidden"])')
  ];

  for (const root of tryLocators) {
    const loc = root.first();
    try {
      await loc.waitFor({ state: "visible", timeout: 6000 });
      await loc.scrollIntoViewIfNeeded();
      await loc.click({ timeout: 4000 });
      await loc.fill(q, { timeout: 4000 });
      await sleep(500);
      const opt = page.getByRole("option").first();
      if (await opt.isVisible().catch(() => false)) {
        await opt.click({ timeout: 5000 });
      } else {
        await page.keyboard.press("Enter");
      }
      await sleep(1200);
      logExplorePhase("domMapSearchTyped", { ok: true, queryLen: q.length });
      logRealtorBrowser("domExplore:mapSearchSubmitted", { queryLen: q.length });
      return true;
    } catch {
      /* try next locator */
    }
  }

  logExplorePhase("domMapSearchTyped", { ok: false, reason: "noMatchingInput" });
  logRealtorBrowser("domExplore:mapSearchSkipped", {
    hint: "No visible search/combobox input matched; relying on map URL hash only."
  });
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function countListingLinks(page: import("playwright").Page): Promise<number> {
  return page.evaluate(() => {
    const re = /\/real-estate\//i;
    return Array.from(document.querySelectorAll("a")).filter((a) => re.test(a.getAttribute("href") ?? ""))
      .length;
  });
}

/**
 * Realtor.ca shows a cookie consent layer on first visit; it can block map/list rendering until dismissed.
 * HIGH_RISK: button labels/locales change — try several patterns.
 */
async function tryDismissCookieBanner(page: import("playwright").Page): Promise<boolean> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole("button", { name: /^Dismiss$/iu }).click({ timeout: 2500 });
    },
    async () => {
      await page.getByRole("button", { name: /accept|agree|consent|ok/iu }).first().click({ timeout: 2500 });
    },
    async () => {
      await page.locator("button").filter({ hasText: /^Dismiss$/iu }).first().click({ timeout: 2500 });
    },
    async () => {
      await page
        .locator('[role="dialog"] button, [aria-modal="true"] button')
        .filter({ hasText: /^Dismiss$/iu })
        .first()
        .click({ timeout: 2500 });
    }
  ];
  for (const run of attempts) {
    try {
      await run();
      await sleep(600);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Map UI often defaults to map-only; try to reveal the listing list (best-effort, ignores failures). */
async function tryOpenListingsPanel(page: import("playwright").Page): Promise<void> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await page.getByRole("tab", { name: /^List$/iu }).first().click({ timeout: 2000 });
    },
    async () => {
      await page.getByRole("button", { name: /^List$/iu }).first().click({ timeout: 2000 });
    },
    async () => {
      await page.locator("button").filter({ hasText: /^List$/iu }).first().click({ timeout: 2000 });
    }
  ];
  for (const run of attempts) {
    try {
      await run();
      await sleep(1200);
      logExplorePhase("domListPanelClick", { ok: true });
      return;
    } catch {
      /* try next */
    }
  }
  logExplorePhase("domListPanelClick", { ok: false });
}

/**
 * Poll until at least one /real-estate/ link exists or deadline — use after completing bot checks by hand
 * (requires PLAYWRIGHT_HEADLESS=false).
 */
async function pollUntilListingLinksOrThrow(
  page: import("playwright").Page,
  mapUrl: string,
  waitMs: number,
  manualMaxMs: number
): Promise<void> {
  const started = Date.now();
  const deadline = started + manualMaxMs;
  let lastLogAt = started;
  logRealtorBrowser("domExplore:manualChallengePollStart", {
    manualMaxMs,
    hint:
      "Complete the challenge in the Chromium window. Polling for /real-estate/ links until deadline."
  });
  logExplorePhase("domManualChallengePollStart", {
    manualMaxMs,
    deadlineIso: new Date(deadline).toISOString()
  });

  while (Date.now() < deadline) {
    await sleep(2000);
    await tryDismissCookieBanner(page);
    await tryOpenListingsPanel(page);
    const n = await countListingLinks(page);
    if (n > 0) {
      logExplorePhase("domManualChallengeResolved", {
        linkCount: n,
        ms: Math.round(Date.now() - started)
      });
      logRealtorBrowser("domExplore:manualChallengeResolved", { linkCount: n });
      return;
    }
    const now = Date.now();
    if (now - lastLogAt >= 30_000) {
      lastLogAt = now;
      const title = (await page.title()).replace(/\s+/gu, " ").trim();
      const elapsedSec = Math.round((now - started) / 1000);
      logRealtorBrowser("domExplore:manualChallengeStillWaiting", {
        elapsedSec,
        linkCount: n,
        titleSnippet: title.slice(0, 100)
      });
      logExplorePhase("domManualChallengeTick", { elapsedSec, linkCount: n });
    }
  }

  const n = await countListingLinks(page);
  const diagnostics = await collectDomDiagnostics(page, mapUrl, waitMs, n);
  throw new RealtorDomExploreError(
    `${REALTOR_DOM_ERROR_BLOCKED}: Manual challenge wait expired (${Math.round(manualMaxMs / 1000)}s) with no listing links. Use a headed browser (PLAYWRIGHT_HEADLESS=false), complete the check, and ensure the map shows results.`,
    REALTOR_DOM_ERROR_BLOCKED,
    diagnostics
  );
}

async function collectDomDiagnostics(
  page: import("playwright").Page,
  mapUrl: string,
  waitMs: number,
  listingLinkCount: number
): Promise<DomExploreDiagnostics> {
  let bodyTextSample: string | undefined;
  try {
    const t = await page.evaluate(() => document.body?.innerText ?? "");
    bodyTextSample = t.replace(/\s+/gu, " ").trim().slice(0, 600);
  } catch {
    bodyTextSample = undefined;
  }
  const pageTitle = (await page.title()).replace(/\s+/gu, " ").trim().slice(0, 200);
  return {
    mapUrl,
    pageUrl: page.url(),
    pageTitle,
    listingLinkCount,
    waitMs,
    bodyTextSample
  };
}

export async function runRealtorDomExploreJob(input: ExploreJobInput): Promise<ExploreJobResult> {
  const radius = input.radiusMiles ?? EXPLORE_DEFAULT_RADIUS_MILES;
  const maxCards = getDomMaxListings();
  const waitMs = getDomListingWaitMs();
  const timingProfile: ExploreTimingProfile = buildExploreTimingProfile();

  const geoStarted = performance.now();
  const geo = await geocodeLocationQuery(input.locationQuery);
  if (!geo) {
    throw new Error(`Could not geocode location: "${input.locationQuery}"`);
  }
  logExplorePhase("geocodeDone", {
    ms: Math.round(performance.now() - geoStarted),
    label: geo.displayName.slice(0, 80)
  });

  const bounds = boundingBoxFromCenterMiles(geo.lat, geo.lon, radius);
  const priceMinTier = snapPriceMinToTier(0);
  const priceMaxTier = snapPriceMaxToTier(input.maxPrice);
  const mapUrl = buildRealtorMapSearchUrl({
    bounds,
    priceMin: priceMinTier,
    priceMax: priceMaxTier
  });

  const manualChallenge = isManualChallengeMode();
  const manualMaxMs = getManualChallengeMaxMs();

  const locationQuery = input.locationQuery;

  return withRealtorDomPlaywrightSession(mapUrl, async (page) => {
    logExplorePhase("domNavigate", { urlLen: mapUrl.length, manualChallenge });
    if (manualChallenge) {
      logRealtorBrowser("domExplore:manualChallengeMode", {
        manualMaxMs,
        headed: !resolvePlaywrightHeadless(),
        hint:
          "Lenient guards until listings appear. Set PLAYWRIGHT_HEADLESS=false to interact with the browser."
      });
      if (resolvePlaywrightHeadless()) {
        logRealtorBrowser("domExplore:manualChallengeHeadlessWarning", {
          warning:
            "PLAYWRIGHT_HEADLESS is not false — you cannot see the browser to solve challenges. Set PLAYWRIGHT_HEADLESS=false in apps/analyzer-web/.env.local and restart next dev."
        });
      }
    }

    const cookieDismissed = await tryDismissCookieBanner(page);
    logExplorePhase("domCookieDismiss", { ok: cookieDismissed });

    if (!shouldSkipMapSearchTyping()) {
      await tryApplyMapSearchQuery(page, locationQuery);
    } else {
      logExplorePhase("domMapSearchTyped", { ok: false, reason: "EXPLORE_DOM_SKIP_MAP_SEARCH_TYPING" });
    }

    if (!manualChallenge) {
      await detectBlockedOrIncomplete(page, {
        phase: "afterNavigation",
        listingLinkCount: await countListingLinks(page)
      });
    }

    await tryOpenListingsPanel(page);

    try {
      await waitForListingAnchors(page, waitMs);
    } catch {
      await tryDismissCookieBanner(page);
      await tryOpenListingsPanel(page);
      try {
        await waitForListingAnchors(page, Math.min(15_000, waitMs));
      } catch {
        if (manualChallenge) {
          await pollUntilListingLinksOrThrow(page, mapUrl, waitMs, manualMaxMs);
        } else {
          const n = await countListingLinks(page);
          const title = (await page.title()).replace(/\s+/gu, " ").trim();
          await detectBlockedOrIncomplete(page, {
            phase: "afterListingWait",
            listingLinkCount: n,
            skipNoLinksSemanticGuard: true
          });
          logExplorePhase("domListingWaitFailed", { linkCount: n, title: title.slice(0, 100) });
          const diagnostics = await collectDomDiagnostics(page, mapUrl, waitMs, n);
          throw new RealtorDomExploreError(
            `${REALTOR_DOM_ERROR_BLOCKED}: Timed out waiting for listing links (no <a href> with /real-estate/ after ${waitMs}ms). The map may still be loading, the List panel may be closed, or automation may not be rendering results. Try PLAYWRIGHT_HEADLESS=false, EXPLORE_DOM_MANUAL_CHALLENGE_MODE=true, increase EXPLORE_DOM_LISTING_WAIT_MS, or use the API explore path.`,
            REALTOR_DOM_ERROR_BLOCKED,
            diagnostics
          );
        }
      }
    }

    const settleMs = getDomSettleMs();
    logExplorePhase("domWaitListings", { ms: settleMs });
    await sleep(settleMs);

    await page.evaluate(() => {
      window.scrollBy(0, 800);
    });
    await sleep(400);

    let listingLinkCount = await countListingLinks(page);
    await detectBlockedOrIncomplete(page, { phase: "afterListingWait", listingLinkCount });

    logExplorePhase("domExtractCards", { listingLinkCount });
    const allCards = await extractListingCardsFromPage(page);
    const domWarnings: string[] = [];
    const truncated = allCards.length > maxCards;
    const cards = truncated ? allCards.slice(0, maxCards) : allCards;
    if (truncated) {
      domWarnings.push(`Truncated from ${allCards.length} to ${maxCards} (EXPLORE_DOM_MAX_LISTINGS)`);
    }
    const pagination = await parseSearchPageInfo(page);
    logExplorePhase("domPageInfo", {
      hasPagination: pagination !== null,
      totalHint: pagination?.totalResultsHint ?? -1
    });

    const listings = domCardsToExplorePayloads(cards);

    logExplorePhase("exploreSessionComplete", {
      mode: "dom",
      listings: listings.length,
      detailFetches: 0,
      searchPagesFetched: 1
    });

    return {
      geocodedLabel: geo.displayName,
      center: { lat: geo.lat, lon: geo.lon },
      bounds,
      priceMaxTier,
      listings,
      truncated,
      searchPagesFetched: 1,
      detailFetches: 0,
      timingProfile,
      domMeta: {
        mode: "dom",
        mapUrl,
        cardsParsed: cards.length,
        pagination,
        domWarnings,
        manualChallengeMode: manualChallenge
      }
    };
  });
}
