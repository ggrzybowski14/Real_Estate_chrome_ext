#!/usr/bin/env node
/**
 * Standalone Playwright CLI: map URL → listing detail pages → same scrape as Chrome extension → Supabase.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import type { Page } from "playwright";
import type { ScrapedListingPayload } from "../../chrome-extension/src/content/scraper.js";
import {
  collectListingUrlsFromMapPage,
  configureRealtorBrowserContext,
  ensureViewListInMapUrl,
  mapPageDiagnostics,
  prepareRealtorMapPage,
  resolveWaitMs,
  waitForListingAnchors,
  waitForListingDetailHydrated
} from "./map-collect.js";
import { insertExploreJobAndResults } from "./supabase-job.js";
import { buildChromiumLaunchOptions, resolveRealtorLaunchConfig } from "./chromium-launch.js";
import { attachApi2Diagnostics } from "./api2-network-hint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, "..");
const repoRoot = join(cliRoot, "..", "..");
const bundlePath = join(cliRoot, "dist", "listing-scrape.iife.js");

config({ path: join(repoRoot, "apps/analyzer-web/.env.local") });
config({ path: join(cliRoot, ".env"), override: true });

declare global {
  interface Window {
    __rea_scrapeListing: () => ScrapedListingPayload;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Workspace scripts run with cwd under `apps/realtor-playwright-cli`, so bare `map-url.txt` must resolve against the repo root. */
function resolveReadableFilePath(userPath: string): string | null {
  const p = userPath.trim();
  if (existsSync(p)) return p;
  if (!isAbsolute(p)) {
    const atRepoRoot = join(repoRoot, p);
    if (existsSync(atRepoRoot)) return atRepoRoot;
  }
  return null;
}

function locationLabelFromMapUrl(mapUrl: string): string {
  try {
    const u = new URL(mapUrl);
    const hash = u.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const geo = params.get("GeoName");
    if (geo) return `Map: ${decodeURIComponent(geo.replace(/\+/g, " "))}`;
  } catch {
    /* fall through */
  }
  return mapUrl.length > 200 ? `${mapUrl.slice(0, 197)}...` : mapUrl;
}

function textLooksLikeBotChallenge(title: string, bodyText: string): boolean {
  const t = title.toLowerCase();
  const b = bodyText.toLowerCase();
  return (
    /additional security check|security check is required/i.test(b) ||
    /why am i seeing this/i.test(b) ||
    /\blooks like a robot\b/i.test(b) ||
    /i['’]m not a robot/i.test(b) ||
    /verify you are human/i.test(b) ||
    /select in this order/i.test(b) ||
    /attention required|access denied|forbidden/i.test(t)
  );
}

async function assertNotBlocked(
  page: Page,
  phase: string,
  options?: { allowBotChallengePage?: boolean }
): Promise<void> {
  const title = (await page.title()).replace(/\s+/gu, " ").trim();
  const visible = await page.evaluate(() => document.body?.innerText ?? "");

  if (textLooksLikeBotChallenge(title, visible) && !options?.allowBotChallengePage) {
    throw new Error(
      `[${phase}] Bot / security challenge page detected. In the visible Chrome window, complete the check until the map loads. Then re-run with --manual-challenge (waits up to 15m for listing links) or solve the challenge before the script continues. Masking alone cannot reliably bypass these challenges.`
    );
  }

  if (/access denied|forbidden|attention required/i.test(title) && !options?.allowBotChallengePage) {
    throw new Error(`[${phase}] Blocked or challenge page (title: ${title.slice(0, 120)})`);
  }
  if (/Incapsula\s+incident\s+ID\s*:\s*\d+/i.test(visible)) {
    throw new Error(`[${phase}] Incapsula block page visible in body text`);
  }
}

async function run(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: "string" },
      "max-listings": { type: "string", default: "24" },
      "scroll-rounds": { type: "string", default: "6" },
      "map-wait-ms": { type: "string", default: "90000" },
      "post-goto-wait-ms": { type: "string", default: "3500" },
      "listing-wait-ms": { type: "string", default: "45000" },
      headed: { type: "boolean", default: true },
      headless: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      out: { type: "string" },
      "manual-challenge": { type: "boolean", default: false },
      "skip-search-typing": { type: "boolean", default: false },
      "url-file": { type: "string" },
      help: { type: "boolean", short: "h", default: false }
    },
    allowPositionals: true
  });

  if (values.help) {
    console.log(`
Usage: npm run start -- --url <realtor.ca map URL> [options]

Options:
  --url <url>           Full map URL (hash with ZoomLevel, bounds, etc.). Or use --url-file / REALTOR_MAP_URL.
  --url-file <path>   Read map URL from a file (avoids npm/shell stripping & in the URL)
  --skip-search-typing  Do not type GeoName + submit (hash-only; default is to run search like DOM explore)
  --max-listings <n>    Cap detail page fetches (default 24)
  --scroll-rounds <n>   Scroll / load-more passes on map (default 6)
  --map-wait-ms <n>     Timeout waiting for first /real-estate/ link (default 90000)
  --post-goto-wait-ms <n>  Wait after load before cookie/list prep (default 3500)
  --listing-wait-ms <n>   Max wait for each listing detail page SPA to hydrate before scrape (default 45000)
  --headed              Run headed Chromium (default true)
  --headless            Run headless (overrides --headed)
  --dry-run             Do not write to Supabase; print JSON summary
  --out <file.json>     Write all listing payloads to a file
  --manual-challenge    After navigation, wait up to 15m for you to complete WAF in the browser window
  -h, --help            Show this help

Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from apps/analyzer-web/.env.local)
     REALTOR_MAP_URL     Map URL if you do not pass --url (useful when npm eats query params)
     REALTOR_PW_STRICT_CORS   Set to 1 to skip --disable-web-security (default: relaxed CORS for api2 XHRs)
     REALTOR_PW_CHANNEL       Set to chrome to use system Google Chrome instead of Chromium for Testing
     REALTOR_PW_IGNORE_HTTPS_ERRORS  Set to 1 for ignoreHTTPSErrors on the browser context
     REALTOR_PW_CDP_ENDPOINT  e.g. http://127.0.0.1:9222 — attach to an existing Chrome (see README); ignores launch flags
     REALTOR_PW_STEALTH       Set to 1 to hide navigator.webdriver in injected pages (minor; CDP+real Chrome is the main win)
     REALTOR_PW_DEBUG         Set to 1 to log each api2.realtor.ca response (path + status) as it arrives

Prefer --url-file map-url.txt with the full URL on one line if npm strips & from --url.

Build: npm run build:browser (runs automatically before npm start via prestart)
`);
    process.exit(0);
  }

  let mapUrl = "";
  if (typeof values["url-file"] === "string" && values["url-file"].trim()) {
    const fp = values["url-file"].trim();
    const resolved = resolveReadableFilePath(fp);
    if (!resolved) {
      console.error(
        `--url-file not found: ${fp}\n  (tried cwd and repo root ${repoRoot}; use an absolute path if the file lives elsewhere.)`
      );
      process.exit(1);
    }
    mapUrl = readFileSync(resolved, "utf8").trim();
  } else if (typeof values.url === "string" && values.url.trim()) {
    mapUrl = values.url.trim();
  } else if (positionals[0]?.trim()) {
    mapUrl = positionals[0].trim();
  } else if (process.env.REALTOR_MAP_URL?.trim()) {
    mapUrl = process.env.REALTOR_MAP_URL.trim();
  }

  if (!mapUrl) {
    console.error("Missing map URL: use --url, --url-file, a positional argument, or REALTOR_MAP_URL.");
    process.exit(1);
  }

  const mapUrlBeforeNormalize = mapUrl.trim();
  mapUrl = ensureViewListInMapUrl(mapUrlBeforeNormalize);
  if (mapUrl !== mapUrlBeforeNormalize) {
    console.error(
      "Map URL normalized: added hash view=list — map-only view often leaves the results column blank until List is active."
    );
  }

  if (!existsSync(bundlePath)) {
    console.error(`Browser bundle not found: ${bundlePath}\nRun: npm run build:browser`);
    process.exit(1);
  }

  const maxListings = Math.max(1, Number(values["max-listings"]) || 24);
  const scrollRounds = Math.max(0, Number(values["scroll-rounds"]) || 0);
  const mapWaitMs = resolveWaitMs(values["map-wait-ms"], 90_000);
  const postGotoWaitMs = resolveWaitMs(values["post-goto-wait-ms"], 3500);
  const listingWaitMs = resolveWaitMs(values["listing-wait-ms"], 45_000);
  const headed = values.headless ? false : values.headed;
  const dryRun = values["dry-run"] === true;
  const manualChallenge = values["manual-challenge"] === true;
  const skipSearchTyping = values["skip-search-typing"] === true;

  const bundleContent = readFileSync(bundlePath, "utf8");

  const launchCfg = resolveRealtorLaunchConfig();
  const cdpEndpoint = process.env.REALTOR_PW_CDP_ENDPOINT?.trim();

  const playwright = await import("playwright");
  let browser: import("playwright").Browser;

  if (cdpEndpoint) {
    console.error(
      `Connecting to Chrome via CDP at ${cdpEndpoint} (REALTOR_PW_CDP_ENDPOINT). Launch flags, --headed/--headless, and REALTOR_PW_CHANNEL are ignored — this uses your running Chrome.`
    );
    browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
  } else {
    if (launchCfg.relaxedCors) {
      console.error(
        "Launch: relaxed CORS flags enabled so api2.realtor.ca XHRs can complete (set REALTOR_PW_STRICT_CORS=1 to use default Chromium security)."
      );
    }
    if (launchCfg.channel) {
      console.error(`Launch: using channel=${launchCfg.channel} (set REALTOR_PW_CHANNEL unset for bundled Chromium).`);
    }
    browser = await playwright.chromium.launch(
      buildChromiumLaunchOptions({ headless: !headed, config: launchCfg })
    );
  }

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    locale: "en-CA",
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: launchCfg.ignoreHttpsErrors
  });

  await configureRealtorBrowserContext(context, mapUrl.trim());

  const stealth =
    process.env.REALTOR_PW_STEALTH === "1" ||
    process.env.REALTOR_PW_STEALTH === "true" ||
    process.env.REALTOR_PW_STEALTH === "yes";
  if (stealth) {
    console.error(
      "Init: REALTOR_PW_STEALTH — masking navigator.webdriver before page scripts (use with CDP + real Chrome for best results)."
    );
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      } catch {
        /* ignore */
      }
    });
  }

  await context.addInitScript(bundleContent);

  const api2Diag = attachApi2Diagnostics(context);
  const page = await context.newPage();
  page.on("dialog", (dialog) => {
    void dialog.dismiss().catch(() => {});
  });

  console.error(
    cdpEndpoint ? "Navigating to map (CDP session)…" : `Navigating to map (headed=${headed})…`
  );
  await page.goto(mapUrl.trim(), { waitUntil: "load", timeout: 120_000 });
  page.setDefaultTimeout(mapWaitMs);
  await assertNotBlocked(page, "afterMapGoto", { allowBotChallengePage: manualChallenge });

  if (manualChallenge) {
    console.error(
      "Manual challenge mode: complete any WAF in the browser window. Polling for listing links (up to 15m)…"
    );
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const d = await mapPageDiagnostics(page);
      if (d.listingLinkCount > 0) break;
      await sleep(3000);
    }
  }

  console.error(
    skipSearchTyping
      ? "Preparing map (cookies + List view; hash-only, --skip-search-typing)…"
      : "Cookies, map search (GeoName from URL), then List view…"
  );
  const prep = await prepareRealtorMapPage(page, {
    postGotoWaitMs,
    mapUrl: mapUrl.trim(),
    skipSearchTyping
  });
  console.error(
    prep.geoName
      ? `Map search: ${prep.searchApplied ? "submitted" : "not confirmed"} for “${prep.geoName}”.`
      : "Map search: no GeoName in URL hash — rely on hash alone or add GeoName to the URL."
  );
  console.error(
    `MLS AsyncPropertySearch_Post (wait heuristic): ${prep.mlsAsyncPropertySearchConfirmed ? "confirmed" : "not confirmed"}.`
  );
  api2Diag.warnIfNoApi2Calls("after map prep");

  try {
    await waitForListingAnchors(page, manualChallenge ? 15 * 60_000 : mapWaitMs);
  } catch (e) {
    const diag = await mapPageDiagnostics(page);
    console.error("Diagnostics:", JSON.stringify(diag, null, 2));
    api2Diag.printSummary("Map wait failed");
    if (diag.uiShowsZeroListings) {
      console.error(
        "The page shows “Results: 0 Listings” (or similar) while the map shell loaded — that usually means MLS search APIs did not return data for this browser session, not that Sidney has no homes for sale."
      );
    }
    if (diag.uiShowsZeroListings && !prep.mlsAsyncPropertySearchConfirmed) {
      console.error(
        "Prep heuristic: AsyncPropertySearch_Post was not observed — MLS may not have run (timing, block, or SPA). Check Diagnostics.mapHashParams vs your map-url.txt; retry with REALTOR_PW_DEBUG=1 for per-response api2 logs."
      );
    }
    if (api2Diag.didSeeApi2Forbidden()) {
      console.error(
        "Map wait failed after api2.realtor.ca returned 403 — MLS APIs did not run, so no /real-estate/ links appeared. Try REALTOR_PW_CHANNEL=chrome or REALTOR_PW_CDP_ENDPOINT with a normal Chrome (README)."
      );
    } else if (!api2Diag.hasAnyApi2Response()) {
      console.error(
        "No api2 traffic was captured — try REALTOR_PW_CDP_ENDPOINT with Chrome started using --remote-debugging-port=9222, or confirm filters in the URL match what you see in a manual browser (e.g. For sale vs For rent)."
      );
    }
    throw e;
  }

  await assertNotBlocked(page, "afterListingWait", { allowBotChallengePage: manualChallenge });

  const collected = await collectListingUrlsFromMapPage(page, {
    maxListings,
    scrollRounds,
    settleMs: 1500
  });

  console.error(`Collected ${collected.urls.length} listing URL(s) (DOM had ${collected.linkCount} unique).`);

  if (collected.urls.length === 0) {
    const diag = await mapPageDiagnostics(page);
    console.error("No listing links found. Diagnostics:", JSON.stringify(diag, null, 2));
    api2Diag.printSummary("No listing links after collection");
    if (diag.uiShowsZeroListings) {
      console.error(
        "UI still shows zero listings — MLS data likely did not load. Use REALTOR_PW_CDP_ENDPOINT (see README) so the scraper drives the same Chrome session where realtor.ca already works."
      );
    }
    await browser.close();
    process.exit(2);
  }

  const listings: ScrapedListingPayload[] = [];
  let detailErrors = 0;

  for (let i = 0; i < collected.urls.length; i++) {
    const listingUrl = collected.urls[i]!;
    console.error(`[${i + 1}/${collected.urls.length}] ${listingUrl}`);
    try {
      await page.goto(listingUrl, { waitUntil: "load", timeout: 90_000 });
      await assertNotBlocked(page, "listing", { allowBotChallengePage: manualChallenge });
      await waitForListingDetailHydrated(page, listingWaitMs);
      await sleep(400 + Math.floor(Math.random() * 400));

      const payload = await page.evaluate(() => {
        const fn = window.__rea_scrapeListing;
        if (typeof fn !== "function") {
          throw new Error("__rea_scrapeListing not injected");
        }
        return fn();
      });
      listings.push(payload);
    } catch (err) {
      detailErrors += 1;
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await browser.close();

  const outPayload = {
    mapUrl: mapUrl.trim(),
    locationLabel: locationLabelFromMapUrl(mapUrl.trim()),
    count: listings.length,
    detailErrors,
    listings
  };

  if (values.out) {
    writeFileSync(values.out, JSON.stringify(outPayload, null, 2), "utf8");
    console.error(`Wrote ${values.out}`);
  }

  if (dryRun) {
    console.log(JSON.stringify(outPayload, null, 2));
    console.error(`Dry run: skipped Supabase (${listings.length} listing payloads).`);
    return;
  }

  const { jobId } = await insertExploreJobAndResults({
    mapUrl: mapUrl.trim(),
    locationLabel: locationLabelFromMapUrl(mapUrl.trim()),
    listings,
    meta: {
      source: "playwright-cli",
      inputMapUrl: mapUrl.trim(),
      headed,
      dryRun: false,
      listingCount: listings.length,
      detailErrors,
      maxListings,
      scrollRounds,
      cdpEndpoint: cdpEndpoint ?? null,
      listingWaitMs,
      stealthInitScript: stealth
    }
  });

  console.error(`Supabase: inserted job ${jobId} with ${listings.length} result row(s).`);
  console.log(JSON.stringify({ jobId, resultCount: listings.length, detailErrors }, null, 2));
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
