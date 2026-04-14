import type { Page } from "playwright";
import { logRealtorBrowser, resolvePlaywrightHeadless } from "./realtor-browser-log";
import { getMapSettleMs } from "./explore-constants";
import { logExplorePhase } from "./explore-log";

export const REALTOR_API_ORIGIN = "https://api37.realtor.ca";

/** Match requests to what the Realtor.ca map SPA sends (used with page.request — not subject to browser CORS). */
const BROWSER_API_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  Origin: "https://www.realtor.ca",
  Referer: "https://www.realtor.ca/map"
};

export type PropertySearchResponse = {
  Results?: unknown[];
  Paging?: {
    TotalRecords?: number;
    RecordsPerPage?: number;
    CurrentPage?: number;
  };
};

function assertNotHtmlBlockPage(text: string): void {
  const s = text.trimStart();
  if (s.startsWith("<") || s.includes("Incapsula") || s.includes("_Incapsula_")) {
    throw new Error(
      "Realtor API returned HTML (often a bot block) instead of JSON. If this persists, try again later or run from a different network."
    );
  }
}

function parseApiEnvelope(text: string): { data: Record<string, unknown>; errorMessage?: string } {
  assertNotHtmlBlockPage(text);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Realtor API returned non-JSON (starts: ${text.slice(0, 120)})`);
  }
  const err = data.ErrorCode as { Id?: number | string; Description?: string } | undefined;
  if (err && err.Id !== undefined && Number(err.Id) !== 200) {
    const msg = err.Description ?? `ErrorCode ${err.Id}`;
    throw new Error(`Realtor API: ${msg}`);
  }
  return { data };
}

export function buildPropertySearchForm(params: Record<string, string | number>): string {
  const e = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    e.set(k, String(v));
  }
  return e.toString();
}

export async function propertySearchPost(page: Page, params: Record<string, string | number>): Promise<PropertySearchResponse> {
  const body = buildPropertySearchForm(params);
  const url = `${REALTOR_API_ORIGIN}/Listing.svc/PropertySearch_Post`;
  // Use page.request (not page.evaluate fetch). In-page fetch() is subject to CORS; cross-origin calls to
  // api37.realtor.ca from realtor.ca often fail with TypeError: Failed to fetch. page.request uses the
  // page's cookie jar and is not CORS-limited; send Origin/Referer like the map SPA.
  const response = await page.request.post(url, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...BROWSER_API_HEADERS
    },
    data: body,
    timeout: 60_000
  });
  const text = await response.text();
  const status = response.status();

  if (status === 403) {
    console.warn("[realtor-api] PropertySearch_Post 403", {
      bodySnippet: text.replace(/\s+/gu, " ").slice(0, 160)
    });
    throw new Error(
      "Realtor.ca blocked PropertySearch (HTTP 403). Their edge filter may flag automation. Try again later, use a residential network/VPN, or run the search from the Chrome extension on realtor.ca instead of server Playwright."
    );
  }
  if (status < 200 || status >= 300) {
    throw new Error(`PropertySearch_Post HTTP ${status}: ${text.slice(0, 200)}`);
  }
  const { data } = parseApiEnvelope(text);
  return data as PropertySearchResponse;
}

export async function propertyDetailsGet(
  page: Page,
  propertyId: string,
  referenceNumber: string
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({
    PropertyId: propertyId,
    ReferenceNumber: referenceNumber,
    ApplicationId: "37",
    CultureId: "1",
    HashCode: "0"
  });
  const url = `${REALTOR_API_ORIGIN}/Listing.svc/PropertyDetails?${qs.toString()}`;
  const response = await page.request.get(url, {
    headers: { ...BROWSER_API_HEADERS },
    timeout: 60_000
  });
  const text = await response.text();
  if (response.status() < 200 || response.status() >= 300) {
    return null;
  }
  try {
    const { data } = parseApiEnvelope(text);
    return data;
  } catch {
    return null;
  }
}

const PLAYWRIGHT_INSTALL_HINT = " If browsers are missing, run: npx playwright install chromium";

export async function withRealtorPlaywrightSession<T>(
  run: (page: Page) => Promise<T>
): Promise<T> {
  logRealtorBrowser("apiExplore:launchRequest", {
    initialUrl: "https://www.realtor.ca/map",
    waitUntil: "load"
  });

  const playwright = await import("playwright");
  const headless = resolvePlaywrightHeadless();
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    logRealtorBrowser("apiExplore:chromiumLaunched", {});
  } catch (e) {
    logRealtorBrowser("apiExplore:launchFailed", {
      message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
    });
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg}${PLAYWRIGHT_INSTALL_HINT}`);
  }
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      locale: "en-CA",
      viewport: { width: 1280, height: 800 }
    });
    logRealtorBrowser("apiExplore:contextCreated", {});
    const page = await context.newPage();
    logRealtorBrowser("apiExplore:gotoStart", { url: "https://www.realtor.ca/map" });
    await page.goto("https://www.realtor.ca/map", {
      waitUntil: "load",
      timeout: 90_000
    });
    const finalUrl = page.url();
    const title = (await page.title()).replace(/\s+/gu, " ").trim().slice(0, 120);
    logRealtorBrowser("apiExplore:gotoDone", {
      finalUrlSnippet: finalUrl.slice(0, 160),
      titleSnippet: title || "(empty)"
    });
    // Jittered pause: map boot + Incapsula/challenge; variable delay reduces clockwork patterns.
    const settleMs = getMapSettleMs();
    logExplorePhase("mapSettleWait", { ms: settleMs });
    logRealtorBrowser("apiExplore:mapSettleWait", { ms: settleMs });
    await new Promise((r) => setTimeout(r, settleMs));
    return await run(page);
  } finally {
    logRealtorBrowser("apiExplore:browserClose");
    await browser.close();
  }
}
