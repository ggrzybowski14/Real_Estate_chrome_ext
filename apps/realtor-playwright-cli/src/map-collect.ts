import type { BrowserContext, Page } from "playwright";

const REALTOR_ORIGIN = "https://www.realtor.ca";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalize timeout so Playwright never receives NaN (falls back to ~30s). */
export function resolveWaitMs(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Math.max(5000, Number.isFinite(n) ? n : fallback);
}

/**
 * Chrome’s **“Know your location”** bar is a native permission UI — it cannot be clicked with DOM selectors.
 * Pre-grant geolocation for realtor.ca and set coords from the map URL `Center=` so the prompt does not block the page.
 */
export function parseCenterFromMapUrl(mapUrl: string): { latitude: number; longitude: number } | undefined {
  try {
    const u = new URL(mapUrl);
    const hash = u.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const center = params.get("Center");
    if (!center) return undefined;
    const decoded = decodeURIComponent(center.replace(/\+/g, " "));
    const comma = decoded.indexOf(",");
    if (comma === -1) return undefined;
    const latitude = Number(decoded.slice(0, comma).trim());
    const longitude = Number(decoded.slice(comma + 1).trim());
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
    return { latitude, longitude };
  } catch {
    return undefined;
  }
}

export async function configureRealtorBrowserContext(context: BrowserContext, mapUrl: string): Promise<void> {
  await context.grantPermissions(["geolocation"], { origin: REALTOR_ORIGIN });
  const coords = parseCenterFromMapUrl(mapUrl);
  if (coords) {
    await context.setGeolocation(coords);
  }
}

/**
 * OneTrust + generic consent. Runs several rounds with `force: true` because banners often sit under overlays.
 */
export async function dismissRealtorCookieBanner(page: Page): Promise<void> {
  const clickers: Array<() => Promise<void>> = [
    () => page.locator("#onetrust-accept-btn-handler").click({ timeout: 4000, force: true }),
    () => page.locator("#onetrust-pc-btn-handler").click({ timeout: 3000, force: true }),
    () => page.locator(".onetrust-close-btn-handler").first().click({ timeout: 3000, force: true }),
    () => page.getByRole("button", { name: /^Accept all$/i }).first().click({ timeout: 3000, force: true }),
    () => page.getByRole("button", { name: /^Accept$/i }).first().click({ timeout: 3000, force: true }),
    () => page.getByRole("button", { name: /^Dismiss$/i }).first().click({ timeout: 3000, force: true }),
    () => page.getByRole("button", { name: /^(OK|Got it|I agree|Continuer)$/i }).first().click({ timeout: 3000, force: true }),
    () => page.getByText(/^Dismiss$/).first().click({ timeout: 3000, force: true }),
    () =>
      page
        .locator('[class*="cookie" i] button, [class*="consent" i] button, [id*="onetrust" i] button')
        .last()
        .click({ timeout: 3000, force: true }),
    () =>
      page
        .locator('[aria-modal="true"] button, [role="dialog"] button')
        .filter({ hasText: /^(Accept|Dismiss|OK)/i })
        .first()
        .click({ timeout: 3000, force: true })
  ];

  for (let round = 0; round < 3; round++) {
    for (const run of clickers) {
      try {
        await run();
        await sleep(350);
      } catch {
        /* try next */
      }
    }
    await sleep(500);
  }
}

/**
 * Map-only view often has no `/real-estate/` anchor tags (markers are not links). The List toggle loads cards with real listing URLs.
 * Matches patterns used in analyzer-web `run-explore-job-dom.ts` (`tryOpenListingsPanel`).
 */
export async function trySwitchToListView(page: Page): Promise<boolean> {
  const candidates = [
    () => page.getByRole("tab", { name: /^List$/iu }).first(),
    () => page.getByRole("radio", { name: /^List$/iu }).first(),
    () => page.getByRole("button", { name: /^List$/iu }).first(),
    () => page.locator("button").filter({ hasText: /^List$/iu }).first(),
    () => page.getByRole("tab", { name: "Liste", exact: true }),
    () => page.locator('[role="tab"]').filter({ hasText: /^(List|Liste)$/i }).first(),
    () => page.locator("div[role='tab']").filter({ hasText: /^List$/i }).first(),
    () => page.getByText("List", { exact: true }).first()
  ];
  for (const getLoc of candidates) {
    try {
      const el = getLoc();
      if (await el.isVisible({ timeout: 2500 }).catch(() => false)) {
        await el.click({ timeout: 5000, force: true });
        await sleep(1800);
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Set `view=list` in the hash so the SPA switches off map-only (sidebar stays empty until then). */
async function nudgeMapHashToViewList(page: Page): Promise<void> {
  await page.evaluate(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(raw);
    params.set("view", "list");
    window.location.hash = params.toString();
  });
  await sleep(2500);
}

/**
 * Ensure the map URL hash includes `view=list` before `goto`, so the first paint targets the list panel
 * (pins/cards + `/real-estate/` links) instead of map-only chrome with a blank gray column.
 */
export function ensureViewListInMapUrl(mapUrl: string): string {
  try {
    const u = new URL(mapUrl);
    const path = u.pathname.replace(/\/$/, "") || "/";
    if (path !== "/map") return mapUrl;
    if (!u.hash) return mapUrl;
    const params = new URLSearchParams(u.hash.replace(/^#/, ""));
    if (params.get("view") === "list") return mapUrl;
    params.set("view", "list");
    u.hash = params.toString();
    return u.toString();
  } catch {
    return mapUrl;
  }
}

/** Scroll panels that usually hold listing cards so lazy-rendered `<a href="/real-estate/...">` mount. */
export async function scrollProbableListingPanels(page: Page): Promise<void> {
  const selectors = [
    '[class*="ListView" i]',
    '[class*="listView" i]',
    '[class*="SearchResult" i]',
    '[class*="listing" i][class*="list" i]',
    '[class*="property-list" i]',
    '[class*="scroll" i][class*="list" i]',
    "aside",
    '[role="complementary"]'
  ];
  for (const sel of selectors) {
    const panel = page.locator(sel).first();
    if (await panel.isVisible({ timeout: 600 }).catch(() => false)) {
      for (let i = 0; i < 12; i++) {
        await panel.evaluate((el) => {
          el.scrollBy(0, 450);
        });
        await sleep(200);
      }
      return;
    }
  }
  await page.mouse.wheel(0, 1400);
  await sleep(500);
}

/**
 * Parse common MLS filter keys from the map URL **hash** (what the SPA uses after navigation).
 * Helps debug “Results: 0 Listings” (wrong TransactionType / stale hash vs typed search).
 */
export function parseRealtorMapHashParams(pageUrl: string): {
  TransactionTypeId: string | null;
  PropertySearchTypeId: string | null;
  GeoName: string | null;
  PGeoIds: string | null;
  view: string | null;
} {
  try {
    const u = new URL(pageUrl);
    const hash = u.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const geo = params.get("GeoName");
    return {
      TransactionTypeId: params.get("TransactionTypeId"),
      PropertySearchTypeId: params.get("PropertySearchTypeId"),
      GeoName: geo ? decodeURIComponent(geo.replace(/\+/g, " ")).trim() || null : null,
      PGeoIds: params.get("PGeoIds"),
      view: params.get("view")
    };
  } catch {
    return {
      TransactionTypeId: null,
      PropertySearchTypeId: null,
      GeoName: null,
      PGeoIds: null,
      view: null
    };
  }
}

/** Parse `GeoName` from the map hash (e.g. Sidney%2C%20BC → Sidney, BC). */
export function parseGeoNameFromMapUrl(mapUrl: string): string | undefined {
  try {
    const u = new URL(mapUrl);
    const hash = u.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const geo = params.get("GeoName");
    if (!geo) return undefined;
    const decoded = decodeURIComponent(geo.replace(/\+/g, " ")).trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Clicks the map toolbar search (green magnifying glass). Scoped to avoid site-wide “Search” nav links.
 */
export async function clickGreenMapSearchButton(page: Page): Promise<boolean> {
  const attempts: Array<() => Promise<void>> = [
    async () => {
      await page.locator('button[aria-label*="Search" i]').first().click({ timeout: 5000, force: true });
    },
    async () => {
      await page.locator("header button:has(svg)").first().click({ timeout: 5000, force: true });
    },
    async () => {
      await page
        .locator('[class*="SearchButton" i], [class*="searchButton" i], [class*="search-bar" i] button')
        .first()
        .click({ timeout: 5000, force: true });
    },
    async () => {
      await page.locator('form button[type="submit"]').first().click({ timeout: 5000, force: true });
    }
  ];
  for (const run of attempts) {
    try {
      await run();
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/**
 * Wait for listing/search traffic after submitting the map search (best-effort).
 * Returns whether `AsyncPropertySearch_Post` was observed (any HTTP status).
 * If not, optionally reload once and switch to List view so the SPA re-runs MLS from the hash.
 */
export async function waitAfterMapSearch(
  page: Page,
  options?: { reloadOnFailure?: boolean }
): Promise<boolean> {
  const reloadOnFailure = options?.reloadOnFailure !== false;

  await page
    .waitForResponse(
      (r) => {
        const u = r.url();
        if (!u.includes("realtor.ca") && !u.includes("api37.realtor.ca")) return false;
        if (r.request().resourceType() === "image") return false;
        return /listing|property|search|map|gateway|graphql|Listing|PropertySearch|MapView/i.test(u);
      },
      { timeout: 40_000 }
    )
    .catch(() => {});

  async function waitAsyncPropertySearch(timeout: number): Promise<boolean> {
    return page
      .waitForResponse(
        (r) => r.url().includes("api2.realtor.ca") && r.url().includes("AsyncPropertySearch_Post"),
        { timeout }
      )
      .then(() => true)
      .catch(() => false);
  }

  let ok = await waitAsyncPropertySearch(45_000);

  if (!ok && reloadOnFailure) {
    console.error(
      "[realtor-playwright-cli] AsyncPropertySearch_Post not seen — reloading map once to re-run MLS from URL hash…"
    );
    await page.reload({ waitUntil: "load", timeout: 120_000 }).catch(() => {});
    await sleep(2500);
    await dismissRealtorCookieBanner(page);
    await trySwitchToListView(page);
    await sleep(1200);
    await scrollProbableListingPanels(page);
    await sleep(2000);
    ok = await waitAsyncPropertySearch(60_000);
  }

  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await sleep(4500);
  return ok;
}

/**
 * Same idea as `tryApplyMapSearchQuery` in analyzer-web `run-explore-job-dom.ts`: hash-only navigation
 * often does not run the search API. We target the **location** combobox (not min price), pick a suggestion, then click the **search** button.
 */
export async function tryApplyMapSearchQuery(page: Page, locationQuery: string): Promise<boolean> {
  const q = locationQuery.trim();
  if (!q) return false;

  const tryLocators = [
    page.getByPlaceholder(
      /City,\s*Neighborhood|City.*Neighborhood|Add a city|city.*neighborhood|neighborhood|address.*school|postal code/i
    ),
    page.getByPlaceholder(/search|city|address|location|neighbourhood|postal|province/i),
    page.getByRole("searchbox"),
    page.locator('[role="combobox"] input').first(),
    page.locator('input[type="search"]').first(),
    page.locator('header input:not([type="hidden"]):not([type="number"])').first()
  ];

  for (const root of tryLocators) {
    const loc = root.first();
    try {
      await loc.waitFor({ state: "visible", timeout: 10_000 });
      await loc.scrollIntoViewIfNeeded();
      await loc.click({ timeout: 5000 });
      await loc.fill("", { timeout: 2000 }).catch(() => {});
      await loc.fill(q, { timeout: 5000 });
      await sleep(1000);

      const opt = page.getByRole("option").first();
      if (await opt.isVisible({ timeout: 4000 }).catch(() => false)) {
        await opt.click({ timeout: 7000 });
      } else {
        await page.keyboard.press("ArrowDown").catch(() => {});
        await sleep(200);
        await page.keyboard.press("Enter");
      }

      await sleep(400);
      await clickGreenMapSearchButton(page);
      return true;
    } catch {
      /* try next locator */
    }
  }

  return false;
}

/** Fallback: click the green search control (hash-only or typing failed). */
export async function tryClickMapSearchSubmitButton(page: Page): Promise<boolean> {
  const ok = await clickGreenMapSearchButton(page);
  if (ok) await sleep(2000);
  return ok;
}

export async function prepareRealtorMapPage(
  page: Page,
  options: { postGotoWaitMs: number; mapUrl: string; skipSearchTyping?: boolean }
): Promise<{ searchApplied: boolean; geoName?: string; mlsAsyncPropertySearchConfirmed: boolean }> {
  const { postGotoWaitMs, mapUrl, skipSearchTyping } = options;
  await sleep(postGotoWaitMs);
  await page.keyboard.press("Escape").catch(() => {});
  await dismissRealtorCookieBanner(page);
  await sleep(600);
  await dismissRealtorCookieBanner(page);

  const geoName = parseGeoNameFromMapUrl(mapUrl);
  let searchApplied = false;
  let mlsAsyncPropertySearchConfirmed = false;

  if (!skipSearchTyping && geoName) {
    searchApplied = await tryApplyMapSearchQuery(page, geoName);
    if (!searchApplied && geoName.includes(",")) {
      const cityOnly = geoName.split(",")[0]?.trim();
      if (cityOnly && cityOnly.length >= 2) {
        searchApplied = await tryApplyMapSearchQuery(page, cityOnly);
      }
    }
    if (!searchApplied) {
      await tryClickMapSearchSubmitButton(page);
    }
    mlsAsyncPropertySearchConfirmed = await waitAfterMapSearch(page, { reloadOnFailure: true });
  }

  let listOpened = await trySwitchToListView(page);
  if (!listOpened) {
    await nudgeMapHashToViewList(page);
  }
  await sleep(800);
  await trySwitchToListView(page);
  await sleep(1200);
  await scrollProbableListingPanels(page);
  await sleep(1500);

  if (skipSearchTyping || !geoName) {
    mlsAsyncPropertySearchConfirmed = await waitAfterMapSearch(page, { reloadOnFailure: true });
  }

  await page.locator('[href*="/real-estate/"]').first().waitFor({ state: "attached", timeout: 25_000 }).catch(() => {});
  return { searchApplied, geoName, mlsAsyncPropertySearchConfirmed };
}

/**
 * Collect listing detail URLs. Realtor’s map list often renders cards inside **open shadow roots** or
 * same-origin iframes — `querySelectorAll("a")` on `document` alone misses them, which led to timeouts
 * even when the UI showed “Results: N Listings” and api2 returned 200.
 *
 * We merge (1) a deep `page.evaluate` walker (iframes + shadow trees) with (2) Playwright’s
 * `[href*="/real-estate/"]` locator, which pierces open shadow and can surface links the walker misses.
 */
export async function collectListingUrls(page: Page): Promise<string[]> {
  const [deep, viaLocator] = await Promise.all([
    collectListingUrlsDeep(page),
    collectListingUrlsViaPlaywrightLocators(page)
  ]);
  return mergeUniqueUrls(deep, viaLocator);
}

function mergeUniqueUrls(a: string[], b: string[]): string[] {
  const s = new Set<string>();
  for (const u of a) s.add(u);
  for (const u of b) s.add(u);
  return Array.from(s);
}

async function collectListingUrlsViaPlaywrightLocators(page: Page): Promise<string[]> {
  const loc = page.locator('[href*="/real-estate/"]');
  if ((await loc.count()) === 0) return [];
  return loc.evaluateAll((elements: Element[]) => {
    const pathRe = /\/real-estate\/\d+/i;
    const seen = new Set<string>();
    for (const el of elements) {
      const href = el.getAttribute("href");
      if (!href || !pathRe.test(href)) continue;
      try {
        const abs = new URL(href, window.location.origin).href;
        if (pathRe.test(abs)) seen.add(abs);
      } catch {
        /* ignore */
      }
    }
    return Array.from(seen);
  });
}

/** Browser-only script as a string so tsx does not inject `__name` on nested `function` (breaks in page.evaluate). */
const COLLECT_REAL_ESTATE_URLS_DEEP = `(() => {
  const pathRe = /\\/real-estate\\/\\d+/i;
  const seen = new Set();
  const addHref = (href) => {
    if (!href || !pathRe.test(href)) return;
    try {
      const abs = new URL(href, window.location.origin).href;
      if (!pathRe.test(abs)) return;
      seen.add(abs);
    } catch (e) {}
  };
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      const el = node;
      addHref(el.getAttribute("href"));
      const sr = el.shadowRoot;
      if (sr) {
        for (let i = 0; i < sr.childNodes.length; i++) visit(sr.childNodes[i]);
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]);
  };
  if (document.documentElement) visit(document.documentElement);
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) visit(doc.documentElement);
    } catch (e) {}
  }
  return Array.from(seen);
})()`;

async function collectListingUrlsDeep(page: Page): Promise<string[]> {
  return page.evaluate(COLLECT_REAL_ESTATE_URLS_DEEP);
}

export async function waitForListingAnchors(page: Page, timeoutMs: number): Promise<void> {
  const ms = resolveWaitMs(timeoutMs, 90_000);
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const urls = await collectListingUrls(page);
    if (urls.length > 0) return;
    await scrollProbableListingPanels(page);
    await sleep(900);
  }
  throw new Error(
    `timeout ${ms}ms waiting for /real-estate/ listing links (deep walker + Playwright locators, shadow/iframes)`
  );
}

/**
 * Listing detail pages are SPA-hydrated. `waitUntil: "load"` often fires before price/address/meta exist,
 * so `buildScrapeSource()` sees an empty shell (same as extension timing when a human already waited).
 */
export async function waitForListingDetailHydrated(page: Page, timeoutMs: number): Promise<void> {
  const ms = resolveWaitMs(timeoutMs, 45_000);
  await page.waitForLoadState("networkidle", { timeout: Math.min(ms, 28_000) }).catch(() => {});
  await page.evaluate(() => window.scrollTo(0, Math.min(480, document.body?.scrollHeight ?? 480)));
  await sleep(200);

  await page.waitForFunction(
    () => {
      const body = document.body?.innerText ?? "";
      const title = document.title ?? "";
      const og =
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ??
        document.querySelector('meta[name="og:title"]')?.getAttribute("content") ??
        "";
      const h1 = document.querySelector("h1")?.textContent?.trim() ?? "";
      const hasMoney = /\$\s*[\d,]+/.test(body);
      const hasBeds = /\b\d+\s*(bed|bedroom|bdrm)/iu.test(body);
      const shellOk = body.length > 380 && (hasMoney || hasBeds);
      const headOk = title.length > 8 || og.length > 8 || h1.length > 4;
      return shellOk && headOk;
    },
    { timeout: ms }
  );
}

async function tryClickLoadMore(page: Page): Promise<boolean> {
  const candidates = [
    page.getByRole("button", { name: /show\s+more|load\s+more|voir\s+plus/i }),
    page.locator("button, a").filter({ hasText: /show\s+more|load\s+more/i }).first()
  ];
  for (const loc of candidates) {
    try {
      const first = loc.first();
      if (await first.isVisible({ timeout: 800 }).catch(() => false)) {
        await first.click({ timeout: 5000 }).catch(() => {});
        await sleep(1200);
        return true;
      }
    } catch {
      /* continue */
    }
  }
  return false;
}

/**
 * Scroll the map results panel / window to trigger lazy-loaded cards, then optionally click "Show more".
 */
export async function expandVisibleListings(page: Page, options: { scrollRounds: number }): Promise<void> {
  const { scrollRounds } = options;
  for (let i = 0; i < scrollRounds; i++) {
    await tryClickLoadMore(page);
    await page.evaluate(() => {
      window.scrollBy(0, Math.min(1200, window.innerHeight));
      const main = document.querySelector("main");
      if (main) main.scrollBy(0, 600);
      const scrollables = document.querySelectorAll("[data-testid], [class*='scroll'], [class*='list']");
      for (const el of Array.from(scrollables).slice(0, 6)) {
        try {
          (el as HTMLElement).scrollBy?.(0, 500);
        } catch {
          /* ignore */
        }
      }
    });
    await sleep(700 + Math.floor(Math.random() * 500));
  }
}

export type MapCollectionResult = {
  urls: string[];
  /** After last expand pass */
  linkCount: number;
};

/**
 * Wait for anchors, expand the list a few times, collect unique URLs (capped).
 */
export async function collectListingUrlsFromMapPage(
  page: Page,
  options: {
    maxListings: number;
    scrollRounds: number;
    settleMs: number;
  }
): Promise<MapCollectionResult> {
  const { maxListings, scrollRounds, settleMs } = options;
  await sleep(settleMs);
  await expandVisibleListings(page, { scrollRounds });
  let urls = await collectListingUrls(page);
  const seen = new Set(urls);

  // Second pass if we still have room — sometimes first scroll loads more.
  if (urls.length < maxListings && scrollRounds > 0) {
    await expandVisibleListings(page, { scrollRounds: Math.min(3, scrollRounds) });
    const again = await collectListingUrls(page);
    for (const u of again) seen.add(u);
    urls = Array.from(seen);
  }

  return {
    urls: urls.slice(0, maxListings),
    linkCount: urls.length
  };
}

export async function mapPageDiagnostics(page: Page): Promise<{
  url: string;
  title: string;
  listingLinkCount: number;
  bodyTextSample: string;
  /** True when the visible copy says there are zero listings (MLS empty state vs no links scraped yet). */
  uiShowsZeroListings: boolean;
  /** Snippet like "Results: 0 Listings" when matched. */
  resultsBannerText: string | null;
  /** Parsed from the live URL hash (compare to your map-url.txt if the SPA rewrote filters). */
  mapHashParams: ReturnType<typeof parseRealtorMapHashParams>;
}> {
  const url = page.url();
  const title = (await page.title()).replace(/\s+/gu, " ").trim();
  const mapHashParams = parseRealtorMapHashParams(url);
  const listingLinkCount = (await collectListingUrls(page)).length;
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? ""))
    .replace(/\s+/gu, " ")
    .trim();
  const bodyTextSample = bodyText.slice(0, 400);
  const resultsMatch = bodyText.match(/Results:\s*(\d+)\s*Listings?/iu);
  const resultsBannerText = resultsMatch ? resultsMatch[0]!.trim() : null;
  const uiShowsZeroListings = /\bResults:\s*0\s*Listings?\b/iu.test(bodyText);
  return {
    url,
    title,
    listingLinkCount,
    bodyTextSample,
    uiShowsZeroListings,
    resultsBannerText,
    mapHashParams
  };
}
