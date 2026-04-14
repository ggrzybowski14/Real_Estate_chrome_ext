import type { AssumptionSourceDetail, ListingRecord } from "@rea/shared";
import { bedroomBucket, inferRegion, sqftBucket } from "./benchmark-resolver";
import { logRealtorBrowser, resolvePlaywrightHeadless } from "./realtor-ca/realtor-browser-log";

type RentalsComparable = {
  url: string;
  rent: number | null;
  title?: string;
  beds?: number;
  baths?: number;
  sqft?: number;
  yearBuilt?: number;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  nicenessScore: number;
  featureText: string;
};

type RentalsCaEstimate = {
  monthlyRent: number;
  lowRent: number;
  highRent: number;
  confidence: number;
  noRentMatch: boolean;
  method: AssumptionSourceDetail["method"];
  assumptionSource: AssumptionSourceDetail;
  consideredComparables: number[];
  retrievalTrace: {
    searchUrl: string;
    fetchMode: "playwright" | "http_fetch";
    httpStatus: number | null;
    isCloudflareBlock: boolean;
    parsedRentCount: number;
    cleanedRentCount: number;
    sampleParsedRents: number[];
    sampleCleanedRents: number[];
    comparableListings: RentalsComparable[];
    sourceComparableCount: number;
    returnedComparableCount: number;
    matchedComparableCount: number;
    matchingStrategy: "beds_location";
    fallbackMode: "structured_comparables" | "parsed_rent_only";
    matchingNotes: string;
    parsedPriceDiagnostics: Array<{
      rent: number;
      hasBedsToken: boolean;
      hasBathsToken: boolean;
      hasSqftToken: boolean;
      snippet: string;
    }>;
    geoRadiusKm: number;
    geoTarget: { latitude: number; longitude: number } | null;
    playwrightError: string | null;
  };
};

const MAX_COMPARABLE_DISTANCE_KM = 15;

function clampCurrency(value: number): number {
  return Math.max(Math.round(value), 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? 0;
  return lowerValue * (1 - weight) + upperValue * weight;
}

function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return values;
  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;
  return values.filter((value) => value >= min && value <= max);
}

function keywordCount(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  let count = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) count += 1;
  }
  return count;
}

function nicenessScoreFromText(text: string): number {
  const positive = [
    "luxury",
    "upscale",
    "premium",
    "modern",
    "renovated",
    "newly renovated",
    "new build",
    "high-end",
    "stainless",
    "quartz",
    "hardwood",
    "amenities",
    "gym",
    "concierge"
  ];
  const negative = ["dated", "fixer", "as-is", "needs work", "older", "basement"];
  const pos = keywordCount(text, positive);
  const neg = keywordCount(text, negative);
  return Math.min(Math.max(2 + pos - neg, 0), 5);
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function listingPostalPrefix(listing: ListingRecord): string | undefined {
  const location = (listing.rawSnapshot?.location ?? {}) as Record<string, unknown>;
  const nested = (listing.rawSnapshot?.rawSnapshot ?? {}) as Record<string, unknown>;
  const postalCandidates = [
    typeof location.postalCode === "string" ? location.postalCode : "",
    typeof nested.postalCode === "string" ? nested.postalCode : "",
    listing.address ?? ""
  ];
  for (const candidate of postalCandidates) {
    const match = candidate.match(/\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\b/iu);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

function listingStreetTokens(listing: ListingRecord): string[] {
  const address = normalizeForMatch(listing.address ?? "");
  if (!address) return [];
  const tokens = address.split(/\s+/u).filter((token) => token.length >= 4 && !/^\d+$/u.test(token));
  const stop = new Set([
    "british",
    "columbia",
    "alberta",
    "ontario",
    "quebec",
    "canada",
    "street",
    "st",
    "avenue",
    "ave",
    "road",
    "rd",
    "drive",
    "dr",
    "court",
    "unit"
  ]);
  return tokens.filter((token) => !stop.has(token)).slice(0, 4);
}

function addressSimilarityScore(listing: ListingRecord, comparable: RentalsComparable): {
  isMatch: boolean;
  penalty: number;
  note: string;
} {
  const text = normalizeForMatch(`${comparable.title ?? ""} ${comparable.featureText} ${comparable.url}`);
  const city = normalizeForMatch(cityFromListing(listing));
  const listingFsa = listingPostalPrefix(listing);
  const comparableFsaMatch = text.match(/\b([abceghj-nprstvxy]\d[abceghj-nprstv-z])\b/iu);
  const comparableFsa = comparableFsaMatch?.[1]?.toLowerCase();
  if (listingFsa && comparableFsa && listingFsa !== comparableFsa) {
    return { isMatch: false, penalty: 999, note: `postal prefix mismatch (${listingFsa} vs ${comparableFsa})` };
  }

  let penalty = 0;
  const notes: string[] = [];
  if (city && text.includes(city)) {
    notes.push("city match");
  } else {
    penalty += 1.2;
    notes.push("city not explicit");
  }

  const streetTokens = listingStreetTokens(listing);
  if (streetTokens.length > 0) {
    const matchedToken = streetTokens.find((token) => text.includes(token));
    if (matchedToken) {
      notes.push(`street token ${matchedToken}`);
    } else {
      penalty += 0.8;
      notes.push("street token not found");
    }
  }
  return { isMatch: true, penalty, note: notes.join("; ") };
}

function buildFailureBreakdown(
  scored: Array<{
    isMatch: boolean;
    note: string;
  }>
): string {
  const counts = new Map<string, number>();
  for (const row of scored) {
    if (row.isMatch) continue;
    const label = row.note.split(";")[0]?.trim() || "unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => `${label} (${count})`)
    .join(" | ");
}

function parseCoordinate(value: unknown, maxAbs: number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maxAbs) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && Math.abs(parsed) <= maxAbs) {
      return parsed;
    }
  }
  return undefined;
}

function priceContextDiagnostics(
  html: string
): Array<{
  rent: number;
  hasBedsToken: boolean;
  hasBathsToken: boolean;
  hasSqftToken: boolean;
  snippet: string;
}> {
  const diagnostics: Array<{
    rent: number;
    hasBedsToken: boolean;
    hasBathsToken: boolean;
    hasSqftToken: boolean;
    snippet: string;
  }> = [];
  const pattern = /\$\s*([0-9][0-9,]{2,})/giu;
  for (const match of html.matchAll(pattern)) {
    const rent = Number((match[1] ?? "").replace(/,/gu, ""));
    if (!Number.isFinite(rent) || rent < 600 || rent > 20000) continue;
    const start = Math.max((match.index ?? 0) - 140, 0);
    const end = Math.min((match.index ?? 0) + 180, html.length);
    const context = html.slice(start, end).replace(/\s+/gu, " ").trim();
    diagnostics.push({
      rent,
      hasBedsToken: /(bed|beds|bedroom|bedrooms|bd|br)\b/iu.test(context),
      hasBathsToken: /(bath|baths|bathroom|bathrooms|ba)\b/iu.test(context),
      hasSqftToken: /(sq\.?\s*ft|sqft|ft2|ft²)/iu.test(context),
      snippet: context.slice(0, 180)
    });
    if (diagnostics.length >= 8) break;
  }
  return diagnostics;
}

function collectCoordinates(node: unknown): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  const lat = parseCoordinate(record.latitude ?? record.lat, 90);
  const lng = parseCoordinate(record.longitude ?? record.lng ?? record.lon, 180);
  if (typeof lat === "number" && typeof lng === "number") {
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      out.push({ latitude: lat, longitude: lng });
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      out.push(...collectCoordinates(value));
    }
  }
  return out;
}

function listingCoordinates(listing: ListingRecord): { latitude: number; longitude: number } | null {
  const points = collectCoordinates(listing.rawSnapshot ?? {});
  return points[0] ?? null;
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 6371 * (2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function cityFromListing(listing: ListingRecord): string {
  const location = (listing.rawSnapshot?.location ?? {}) as Record<string, unknown>;
  const cityFromRaw = typeof location.city === "string" ? location.city.trim() : "";
  if (cityFromRaw) return cityFromRaw;

  const normalizedAddress = (listing.address ?? "")
    .replace(/\s+/gu, " ")
    .replace(
      /([a-z])([A-Z][a-z.'-]+,\s*(?:British Columbia|Alberta|Ontario|Quebec|Nova Scotia|New Brunswick|Manitoba|Saskatchewan|PEI|Prince Edward Island|Newfoundland and Labrador))/gu,
      "$1, $2"
    )
    .trim();
  const parts = normalizedAddress.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const city = parts[1];
    if (city) {
      return city;
    }
  }

  const provinceMatch = normalizedAddress.match(
    /(British Columbia|Alberta|Ontario|Quebec|Nova Scotia|New Brunswick|Manitoba|Saskatchewan|Prince Edward Island|Newfoundland and Labrador)/iu
  );
  if (provinceMatch?.index && provinceMatch.index > 0) {
    const beforeProvince = normalizedAddress.slice(0, provinceMatch.index).replace(/,\s*$/u, "");
    const spaced = beforeProvince.replace(/([a-z])([A-Z])/gu, "$1 $2");
    const tokens = spaced.trim().split(/\s+/u).filter(Boolean);
    const maybeCity = tokens[tokens.length - 1];
    if (maybeCity) {
      return maybeCity;
    }
  }

  return "canada";
}

function looksLikeCloudflareBlock(body: string): boolean {
  const text = body.toLowerCase();
  const hasTitle = text.includes("<title>just a moment...</title>") || text.includes("just a moment...");
  const hasChallengeCopy =
    text.includes("verify you are human") ||
    text.includes("enable javascript and cookies") ||
    text.includes("challenge-platform");
  return hasTitle && hasChallengeCopy;
}

/** Set `RENTALS_DEBUG_LOG=false` to silence server logs (see terminal running `next dev`). */
function logRentalsCaDebug(payload: Record<string, unknown>): void {
  if (process.env.RENTALS_DEBUG_LOG === "false") {
    return;
  }
  console.info("[rentals-ca-debug]", payload);
}

/** Headers that mimic a real browser; plain `fetch` with a bot UA is often rejected with HTTP 403. */
function rentalsCaFetchHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Ch-Ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1"
  };
}

async function fetchRentalsCaHtmlWithPlaywright(
  targetUrl: string,
  options?: { bypassEnvDisable?: boolean }
): Promise<{
  html: string | null;
  error: string | null;
}> {
  const usePlaywright =
    options?.bypassEnvDisable === true || process.env.RENTALS_USE_PLAYWRIGHT !== "false";
  if (!usePlaywright) {
    logRentalsCaDebug({
      phase: "playwright:skipped",
      targetUrl,
      reason: "RENTALS_USE_PLAYWRIGHT=false",
      bypassEnvDisable: options?.bypassEnvDisable ?? false
    });
    return { html: null, error: null };
  }

  const pwStarted = performance.now();
  try {
    const headless = resolvePlaywrightHeadless();
    logRentalsCaDebug({
      phase: "playwright:start",
      targetUrl,
      bypassEnvDisable: options?.bypassEnvDisable ?? false,
      headless
    });
    logRealtorBrowser("rentalsCa:launchRequest", {
      targetUrlSnippet: targetUrl.slice(0, 160),
      waitUntil: "domcontentloaded"
    });
    // Do not set PLAYWRIGHT_BROWSERS_PATH to "0" — that makes Playwright look under
    // node_modules/playwright-core/.local-browsers/ instead of the OS cache
    // (e.g. ~/Library/Caches/ms-playwright on macOS) where `npx playwright install` puts browsers.
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    logRealtorBrowser("rentalsCa:chromiumLaunched", { targetUrlSnippet: targetUrl.slice(0, 120) });
    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        locale: "en-CA"
      });
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4500);
      const finalUrl = page.url();
      const pageTitle = (await page.title()).replace(/\s+/gu, " ").trim().slice(0, 120);
      logRentalsCaDebug({
        phase: "playwright:after-goto",
        ms: Math.round(performance.now() - pwStarted),
        finalUrl,
        pageTitle: pageTitle || "(empty)"
      });
      const renderedHtml = await page.content();
      const textContent = await page.evaluate(() => document.body?.innerText ?? "");
      const comparableSnapshots = await page.evaluate(() => {
        const compact = (value: string): string => value.replace(/\s+/g, " ").trim();
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        const rows: Array<{
          url: string;
          title: string;
          text: string;
          rent: number | null;
          beds: number | null;
          baths: number | null;
          sqft: number | null;
        }> = [];
        const seen = new Set<string>();
        for (const anchor of anchors) {
          const href = anchor.getAttribute("href") ?? "";
          if (!href.includes("rentals.ca") && !href.startsWith("/")) continue;
          const absolute = new URL(href, "https://rentals.ca").toString();
          if (!/rentals\.ca\/.+/i.test(absolute)) continue;
          const container =
            anchor.closest("article, li, [data-testid*='listing'], [class*='listing'], [class*='card']") ??
            anchor.parentElement;
          const text = compact((container?.textContent ?? anchor.textContent ?? "").slice(0, 1200));
          if (!text) continue;
          const rentMatch = text.match(/\$\s*([0-9][0-9,]{2,})/i);
          const bedsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|bedroom|bedrooms|bd|br)\b/i);
          const bathsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|bathroom|bathrooms|ba)\b/i);
          const sqftMatch = text.match(/([0-9][0-9,]{2,4})\s*(?:sq\.?\s*ft|sqft|ft2|ft²)/i);
          const rent = rentMatch ? Number((rentMatch[1] ?? "").replace(/,/g, "")) : null;
          const beds = bedsMatch ? Number(bedsMatch[1] ?? "") : null;
          const baths = bathsMatch ? Number(bathsMatch[1] ?? "") : null;
          const sqft = sqftMatch ? Number((sqftMatch[1] ?? "").replace(/,/g, "")) : null;
          const key = `${absolute}|${rent ?? "na"}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            url: absolute,
            title: compact((anchor.textContent ?? "").slice(0, 180)),
            text,
            rent: Number.isFinite(rent as number) ? rent : null,
            beds: Number.isFinite(beds as number) ? beds : null,
            baths: Number.isFinite(baths as number) ? baths : null,
            sqft: Number.isFinite(sqft as number) ? sqft : null
          });
          if (rows.length >= 40) break;
        }
        return rows;
      });
      const detailLimitRaw = Number(process.env.RENTALS_PLAYWRIGHT_DETAIL_LIMIT ?? "6");
      const detailLimit = Number.isFinite(detailLimitRaw)
        ? Math.min(Math.max(Math.round(detailLimitRaw), 0), 12)
        : 6;
      const candidateUrls = Array.from(
        new Set(
          comparableSnapshots
            .map((item) => item.url)
            .filter((url) => /^https:\/\/rentals\.ca\/.+/iu.test(url))
        )
      ).slice(0, detailLimit);
      const detailSnapshots: Array<{
        url: string;
        title: string;
        price: number | null;
        beds: number | null;
        baths: number | null;
        sqft: number | null;
      }> = [];
      for (const url of candidateUrls) {
        const detailPage = await context.newPage();
        try {
          await detailPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await detailPage.waitForTimeout(1200);
          const detailText = await detailPage.evaluate(() => document.body?.innerText ?? "");
          const compactText = detailText.replace(/\s+/gu, " ").trim();
          const priceMatch = compactText.match(/\$\s*([0-9][0-9,]{2,})/u);
          const bedsMatch = compactText.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|bedroom|bedrooms|bd|br)\b/iu);
          const bathsMatch = compactText.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|bathroom|bathrooms|ba)\b/iu);
          const sqftMatch = compactText.match(/([0-9][0-9,]{2,4})\s*(?:sq\.?\s*ft|sqft|ft2|ft²)\b/iu);
          const price = priceMatch ? Number((priceMatch[1] ?? "").replace(/,/gu, "")) : null;
          const beds = bedsMatch ? Number(bedsMatch[1] ?? "") : null;
          const baths = bathsMatch ? Number(bathsMatch[1] ?? "") : null;
          const sqft = sqftMatch ? Number((sqftMatch[1] ?? "").replace(/,/gu, "")) : null;
          if (price !== null && Number.isFinite(price) && price >= 600 && price <= 20000) {
            detailSnapshots.push({
              url,
              title: compactText.slice(0, 180),
              price,
              beds: Number.isFinite(beds as number) ? beds : null,
              baths: Number.isFinite(baths as number) ? baths : null,
              sqft: Number.isFinite(sqft as number) ? sqft : null
            });
          }
        } catch {
          // Ignore individual detail page failures and continue.
        } finally {
          await detailPage.close();
        }
      }
      const serializedSnapshots = JSON.stringify(comparableSnapshots);
      const serializedDetailSnapshots = JSON.stringify(detailSnapshots);
      const injected = `<script id="rea-playwright-comparables" type="application/json">${serializedSnapshots}</script>`;
      const injectedDetails = `<script id="rea-playwright-detail-comparables" type="application/json">${serializedDetailSnapshots}</script>`;
      const combinedHtml = `${renderedHtml}\n${injected}\n${injectedDetails}\n${textContent}`;
      logRentalsCaDebug({
        phase: "playwright:success",
        ms: Math.round(performance.now() - pwStarted),
        htmlChars: combinedHtml.length,
        anchorRowCount: comparableSnapshots.length,
        detailCandidateUrls: candidateUrls.length,
        detailSnapshots: detailSnapshots.length,
        bodyTextChars: textContent.length
      });
      return { html: combinedHtml, error: null };
    } finally {
      logRealtorBrowser("rentalsCa:browserClose", { targetUrlSnippet: targetUrl.slice(0, 120) });
      await browser.close();
    }
  } catch (error) {
    logRealtorBrowser("rentalsCa:playwrightError", {
      message: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220)
    });
    logRentalsCaDebug({
      phase: "playwright:error",
      targetUrl,
      ms: Math.round(performance.now() - pwStarted),
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      html: null,
      error: error instanceof Error ? error.message : "Playwright failed"
    };
  }
}

export function buildRentalsCaSearchUrl(listing: ListingRecord): string {
  const city = cityFromListing(listing);
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  const beds = bedroomBucket(listing.beds);
  const sizeBand = sqftBucket(listing.sqft);
  const region = inferRegion(listing);

  const base = citySlug ? `https://rentals.ca/${citySlug}` : "https://rentals.ca";
  const url = new URL(base);
  url.searchParams.set("beds", beds >= 4 ? "4+" : String(beds));
  url.searchParams.set("sizeBand", sizeBand);
  url.searchParams.set("regionCode", region.regionCode);
  return url.toString();
}

export function extractRentValuesFromHtml(html: string): number[] {
  const values: number[] = [];
  const rangeMatches = html.matchAll(/\$\s*([0-9][0-9,]{2,})\s*-\s*\$\s*([0-9][0-9,]{2,})/giu);
  for (const match of rangeMatches) {
    const low = Number((match[1] ?? "").replace(/,/gu, ""));
    const high = Number((match[2] ?? "").replace(/,/gu, ""));
    for (const n of [low, high]) {
      if (Number.isFinite(n) && n >= 600 && n <= 20000) {
        values.push(Math.round(n));
      }
    }
  }

  const patterns = [
    /\$\s*([0-9][0-9,]{2,})(?:\s*\/\s*(?:month|mo)\b|\s*\+)?/giu,
    /"price"\s*:\s*"?\$?\s*([0-9][0-9,]{2,})"?/giu
  ];
  for (const pattern of patterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const n = Number((match[1] ?? "").replace(/,/gu, ""));
      if (Number.isFinite(n) && n >= 600 && n <= 20000) {
        values.push(Math.round(n));
      }
    }
  }

  return Array.from(new Set(values));
}

function noMatchEstimate(searchUrl: string, listing: ListingRecord, notes: string): RentalsCaEstimate {
  const region = inferRegion(listing);
  return {
    monthlyRent: 0,
    lowRent: 0,
    highRent: 0,
    confidence: 0,
    noRentMatch: true,
    method: "default",
    assumptionSource: {
      field: "monthlyRent",
      value: 0,
      method: "default",
      confidence: 0,
      notes,
      reference: {
        publisher: "Rentals.ca",
        dataset: "Manual fallback scrape",
        metric: "median_rent",
        region: region.regionLabel,
        period: "live",
        url: searchUrl,
        fetchedAt: new Date().toISOString()
      }
    },
    consideredComparables: [],
    retrievalTrace: {
      searchUrl,
      fetchMode: "http_fetch",
      httpStatus: null,
      isCloudflareBlock: false,
      parsedRentCount: 0,
      cleanedRentCount: 0,
      sampleParsedRents: [],
      sampleCleanedRents: [],
      comparableListings: [],
      sourceComparableCount: 0,
      returnedComparableCount: 0,
      matchedComparableCount: 0,
      matchingStrategy: "beds_location",
      fallbackMode: "structured_comparables",
      matchingNotes: "No comparables were eligible.",
      parsedPriceDiagnostics: [],
      geoRadiusKm: MAX_COMPARABLE_DISTANCE_KM,
      geoTarget: listingCoordinates(listing),
      playwrightError: null
    }
  };
}

function extractComparableListingsFromHtml(html: string, searchUrl: string): RentalsComparable[] {
  const sourceHost = "https://rentals.ca";
  const items: RentalsComparable[] = [];
  const seen = new Set<string>();
  const pushComparable = (
    url: string,
    rent: number | null,
    title: string | undefined,
    featureText: string
  ): void => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    const key = `${normalizedUrl}|${rent ?? "na"}`;
    if (seen.has(key)) return;
    seen.add(key);
    const bedsMatch =
      featureText.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|bedroom|bedrooms|bd|br)\b/iu) ??
      featureText.match(/"beds?"\s*:\s*([0-9]+(?:\.[0-9]+)?)/iu);
    const bathsMatch =
      featureText.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|bathroom|bathrooms|ba)\b/iu) ??
      featureText.match(/"baths?"\s*:\s*([0-9]+(?:\.[0-9]+)?)/iu);
    const sqftRangeMatch = featureText.match(
      /([0-9][0-9,]{2,4})\s*-\s*([0-9][0-9,]{2,4})\s*(?:sq\.?\s*ft|sqft|ft2|ft²)/iu
    );
    const sqftSingleMatch =
      featureText.match(/([0-9][0-9,]{2,4})\s*(?:sq\.?\s*ft|sqft|ft2|ft²)/iu) ??
      featureText.match(/"sqft"\s*:\s*([0-9][0-9,]{2,4})/iu);
    const yearMatch = featureText.match(/\b(19[5-9]\d|20[0-2]\d)\b/u);
    const latMatch = featureText.match(/"?(?:latitude|lat)"?\s*[:=]\s*(-?\d{1,2}\.\d+)/iu);
    const lngMatch = featureText.match(/"?(?:longitude|lng|lon)"?\s*[:=]\s*(-?\d{1,3}\.\d+)/iu);
    const beds = bedsMatch ? Number(bedsMatch[1] ?? "") : undefined;
    const baths = bathsMatch ? Number(bathsMatch[1] ?? "") : undefined;
    const sqft = sqftRangeMatch
      ? Math.round(
          (Number((sqftRangeMatch[1] ?? "").replace(/,/gu, "")) +
            Number((sqftRangeMatch[2] ?? "").replace(/,/gu, ""))) /
            2
        )
      : sqftSingleMatch
        ? Number((sqftSingleMatch[1] ?? "").replace(/,/gu, ""))
        : undefined;
    const yearBuilt = yearMatch ? Number(yearMatch[1] ?? "") : undefined;
    const latitude = latMatch ? Number(latMatch[1] ?? "") : undefined;
    const longitude = lngMatch ? Number(lngMatch[1] ?? "") : undefined;
    items.push({
      url: normalizedUrl,
      rent,
      title,
      beds: Number.isFinite(beds) ? beds : undefined,
      baths: Number.isFinite(baths) ? baths : undefined,
      sqft: Number.isFinite(sqft) ? sqft : undefined,
      yearBuilt: Number.isFinite(yearBuilt) ? yearBuilt : undefined,
      latitude:
        typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90
          ? latitude
          : undefined,
      longitude:
        typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180
          ? longitude
          : undefined,
      nicenessScore: nicenessScoreFromText(featureText),
      featureText
    });
  };

  const anchorPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = (match[1] ?? "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
    let absoluteUrl = "";
    try {
      absoluteUrl = new URL(rawHref, sourceHost).toString();
    } catch {
      continue;
    }
    if (!absoluteUrl.includes("rentals.ca")) continue;

    const body = (match[2] ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
    const rentMatch = body.match(/\$\s*([0-9][0-9,]{2,})/u);
    const rent = rentMatch ? Number((rentMatch[1] ?? "").replace(/,/gu, "")) : null;
    const title = body.length > 0 ? body.slice(0, 140) : undefined;
    if (rent !== null && (!Number.isFinite(rent) || rent < 600 || rent > 20000)) continue;
    if (rent === null) continue;
    pushComparable(absoluteUrl, rent, title, body);
    if (items.length >= 12) return items;
  }

  const jsonUrlPattern = /"url"\s*:\s*"(https?:\/\/(?:www\.)?rentals\.ca[^"]+)"/giu;
  for (const match of html.matchAll(jsonUrlPattern)) {
    const url = (match[1] ?? "").trim();
    if (!url) continue;
    const index = match.index ?? 0;
    const objectStart = html.lastIndexOf("{", index);
    const objectEnd = html.indexOf("}", index);
    const context =
      objectStart >= 0 && objectEnd > objectStart && objectEnd - objectStart < 5000
        ? html.slice(objectStart, objectEnd + 1)
        : html.slice(Math.max(index - 700, 0), Math.min(index + 700, html.length));
    const rentMatch = context.match(/"price"\s*:\s*"?\$?\s*([0-9][0-9,]{2,})"?/iu);
    const rent = rentMatch ? Number((rentMatch[1] ?? "").replace(/,/gu, "")) : null;
    if (rent !== null && (!Number.isFinite(rent) || rent < 600 || rent > 20000)) continue;
    if (rent === null) continue;
    pushComparable(url, rent, undefined, context);
    if (items.length >= 12) break;
  }

  if (items.length === 0) {
    const textOnly = html
      .replace(/<script[\s\S]*?<\/script>/giu, " ")
      .replace(/<style[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, "\n")
      .replace(/\u00a0/gu, " ")
      .replace(/\r/gu, "");
    const lines = textOnly.split("\n").map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!/\$\s*[0-9][0-9,]{2,}/u.test(line)) continue;
      if (!/(bed|bath|sqft|ft²|month|mo)/iu.test(line)) continue;
      const rentMatch = line.match(/\$\s*([0-9][0-9,]{2,})/u);
      const rent = rentMatch ? Number((rentMatch[1] ?? "").replace(/,/gu, "")) : null;
      if (rent === null || !Number.isFinite(rent) || rent < 600 || rent > 20000) continue;
      pushComparable(`${searchUrl}#inline-${index}`, rent, line.slice(0, 140), line);
      if (items.length >= 12) break;
    }
  }
  return items;
}

function similarityScore(
  listing: ListingRecord,
  comparable: RentalsComparable,
  geoTarget: { latitude: number; longitude: number } | null
): {
  isMatch: boolean;
  score: number;
  note: string;
} {
  const targetBeds = typeof listing.beds === "number" ? listing.beds : undefined;

  let score = 0;
  const notes: string[] = [];

  if (targetBeds && comparable.beds) {
    const diff = Math.abs(targetBeds - comparable.beds);
    if (diff > 0) return { isMatch: false, score: 999, note: "bed mismatch" };
    notes.push(`beds diff ${diff.toFixed(1)}`);
  } else {
    score += 1.5;
    notes.push("beds missing");
  }
  if (geoTarget && typeof comparable.latitude === "number" && typeof comparable.longitude === "number") {
    const distanceKm = haversineKm(geoTarget, { latitude: comparable.latitude, longitude: comparable.longitude });
    comparable.distanceKm = Number(distanceKm.toFixed(2));
    if (distanceKm > MAX_COMPARABLE_DISTANCE_KM) {
      return {
        isMatch: false,
        score: 999,
        note: `distance ${distanceKm.toFixed(1)}km > ${MAX_COMPARABLE_DISTANCE_KM}km`
      };
    }
    score += Math.min(distanceKm / 3, 4);
    notes.push(`distance ${distanceKm.toFixed(1)}km`);
  } else if (geoTarget) {
    score += 1;
    notes.push("distance unknown");
  } else {
    const addressSimilarity = addressSimilarityScore(listing, comparable);
    if (!addressSimilarity.isMatch) {
      return { isMatch: false, score: 999, note: addressSimilarity.note };
    }
    score += addressSimilarity.penalty;
    notes.push(addressSimilarity.note);
  }
  return { isMatch: true, score, note: notes.join("; ") };
}

export async function estimateRentFromRentalsCa(listing: ListingRecord): Promise<RentalsCaEstimate> {
  const estimateStarted = performance.now();
  const searchUrl = buildRentalsCaSearchUrl(listing);
  logRentalsCaDebug({
    phase: "estimate:start",
    listingId: listing.id,
    searchUrl,
    rentalsUsePlaywright: process.env.RENTALS_USE_PLAYWRIGHT ?? "(unset)"
  });
  let playwrightResult = await fetchRentalsCaHtmlWithPlaywright(searchUrl);
  const playwrightHtml = playwrightResult.html;
  const htmlFromPlaywright = playwrightHtml && playwrightHtml.trim().length > 0 ? playwrightHtml : null;

  logRentalsCaDebug({
    phase: "estimate:after-first-playwright",
    ms: Math.round(performance.now() - estimateStarted),
    htmlLen: playwrightHtml?.length ?? 0,
    playwrightError: playwrightResult.error
  });

  let html = htmlFromPlaywright;
  let response: Response | undefined;
  let fetchMode: "playwright" | "http_fetch" = htmlFromPlaywright ? "playwright" : "http_fetch";
  if (!html) {
    try {
      logRentalsCaDebug({ phase: "estimate:http-fetch:start", searchUrl });
      response = await fetch(searchUrl, {
        headers: rentalsCaFetchHeaders(),
        cache: "no-store"
      });
      html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
      logRentalsCaDebug({
        phase: "estimate:http-fetch:response",
        ms: Math.round(performance.now() - estimateStarted),
        status: response.status,
        ok: response.ok,
        bodyChars: html.length,
        titleSnippet:
          titleMatch?.[1]?.replace(/\s+/gu, " ").trim().slice(0, 100) ?? "(no title)"
      });
      if (!response.ok) {
        if (looksLikeCloudflareBlock(html)) {
          const pwAfterCf =
            process.env.RENTALS_CLOUDFLARE_PLAYWRIGHT_RETRY === "false"
              ? { html: null as string | null, error: null as string | null }
              : await fetchRentalsCaHtmlWithPlaywright(searchUrl, {
                  bypassEnvDisable: true
                });
          if (pwAfterCf.html?.trim()) {
            html = pwAfterCf.html;
            fetchMode = "playwright";
            playwrightResult = pwAfterCf;
            response = undefined;
            logRentalsCaDebug({
              phase: "estimate:recovered-after-cloudflare-fetch-via-playwright",
              ms: Math.round(performance.now() - estimateStarted),
              htmlChars: html.length
            });
          } else {
            logRentalsCaDebug({
              phase: "estimate:cloudflare-fetch-playwright-retry-failed",
              firstPlaywrightError: playwrightResult.error,
              retryError: pwAfterCf.error
            });
            const estimate = noMatchEstimate(
              searchUrl,
              listing,
              "Rentals.ca returned HTTP 403 (Cloudflare / challenge page). Direct fetch cannot bypass this; Playwright retry also did not return HTML. Ensure RENTALS_USE_PLAYWRIGHT is not false, run: npx playwright install chromium, and check server logs [rentals-ca-debug]."
            );
            estimate.retrievalTrace.fetchMode = "http_fetch";
            estimate.retrievalTrace.httpStatus = response.status;
            estimate.retrievalTrace.isCloudflareBlock = true;
            estimate.retrievalTrace.playwrightError = pwAfterCf.error ?? playwrightResult.error;
            return estimate;
          }
        } else if (response.status === 403) {
          const retryPlaywright =
            process.env.RENTALS_USE_PLAYWRIGHT === "false"
              ? await fetchRentalsCaHtmlWithPlaywright(searchUrl, { bypassEnvDisable: true })
              : { html: null as string | null, error: null as string | null };
          if (retryPlaywright.html?.trim()) {
            html = retryPlaywright.html;
            fetchMode = "playwright";
            playwrightResult = retryPlaywright;
            response = undefined;
          } else {
            const playwrightFailureNote = playwrightResult.error
              ? ` Playwright error: ${playwrightResult.error}.`
              : "";
            const retryNote = retryPlaywright.error ? ` Playwright retry: ${retryPlaywright.error}.` : "";
            const hint =
              process.env.RENTALS_USE_PLAYWRIGHT === "false"
                ? " Remove RENTALS_USE_PLAYWRIGHT=false from env, or ensure Playwright can run."
                : " Ensure Chromium is installed: npx playwright install chromium";
            const estimate = noMatchEstimate(
              searchUrl,
              listing,
              `Rentals.ca blocked direct access (HTTP 403).${playwrightFailureNote}${retryNote} ${hint}`
            );
            estimate.retrievalTrace.httpStatus = 403;
            estimate.retrievalTrace.playwrightError = retryPlaywright.error ?? playwrightResult.error;
            return estimate;
          }
        } else {
          const estimate = noMatchEstimate(
            searchUrl,
            listing,
            `Rentals.ca fallback scrape returned HTTP ${response.status}.`
          );
          estimate.retrievalTrace.httpStatus = response.status;
          estimate.retrievalTrace.playwrightError = playwrightResult.error;
          return estimate;
        }
      }
    } catch (err) {
      logRentalsCaDebug({
        phase: "estimate:http-fetch:throw",
        message: err instanceof Error ? err.message : String(err)
      });
      const estimate = noMatchEstimate(searchUrl, listing, "Rentals.ca fallback scrape request failed.");
      estimate.retrievalTrace.playwrightError = playwrightResult.error;
      return estimate;
    }
  }

  if (!html?.trim()) {
    logRentalsCaDebug({
      phase: "estimate:empty-html",
      playwrightError: playwrightResult.error
    });
    const estimate = noMatchEstimate(searchUrl, listing, "Rentals.ca fallback returned empty HTML.");
    estimate.retrievalTrace.playwrightError = playwrightResult.error;
    return estimate;
  }

  if (looksLikeCloudflareBlock(html)) {
    const estimate = noMatchEstimate(
      searchUrl,
      listing,
      "Rentals.ca challenge page detected. Playwright session did not resolve listings for this request."
    );
    estimate.retrievalTrace.fetchMode = fetchMode;
    estimate.retrievalTrace.httpStatus = response?.status ?? null;
    estimate.retrievalTrace.isCloudflareBlock = true;
    estimate.retrievalTrace.playwrightError = playwrightResult.error;
    return estimate;
  }
  const parsed = extractRentValuesFromHtml(html);
  const parsedDiagnostics = priceContextDiagnostics(html);
  const geoTarget = listingCoordinates(listing);
  const allComparableListings = extractComparableListingsFromHtml(html, searchUrl);
  const fallbackParsedOnlyRents = allComparableListings.length === 0 ? removeOutliers(parsed) : [];
  if (allComparableListings.length === 0 && fallbackParsedOnlyRents.length > 0) {
    const fallbackRent = clampCurrency(median(fallbackParsedOnlyRents));
    const p25 = clampCurrency(quantile(fallbackParsedOnlyRents, 0.25));
    const p75 = clampCurrency(quantile(fallbackParsedOnlyRents, 0.75));
    const lowRent = p25 > 0 ? p25 : clampCurrency(fallbackRent * 0.9);
    const highRent = p75 > 0 ? p75 : clampCurrency(fallbackRent * 1.1);
    const region = inferRegion(listing);
    console.info("[rentals-fallback:diagnostics]", {
      listingId: listing.id,
      searchUrl,
      fetchMode,
      parsedRentCount: parsed.length,
      extractedComparableCount: 0,
      matchedComparableCount: fallbackParsedOnlyRents.length,
      cleanedComparableCount: fallbackParsedOnlyRents.length,
      estimateRent: fallbackRent,
      geoTarget,
      reason: "parsed_rent_points_only"
      ,
      parsedDiagnostics: parsedDiagnostics.map((row) => ({
        rent: row.rent,
        hasBedsToken: row.hasBedsToken,
        hasBathsToken: row.hasBathsToken,
        hasSqftToken: row.hasSqftToken
      }))
    });
    return {
      monthlyRent: fallbackRent,
      lowRent,
      highRent,
      confidence: Math.min(0.28 + fallbackParsedOnlyRents.length * 0.03, 0.6),
      noRentMatch: fallbackRent <= 0,
      method: "regional_fallback",
      assumptionSource: {
        field: "monthlyRent",
        value: fallbackRent,
        method: "regional_fallback",
        confidence: Math.min(0.28 + fallbackParsedOnlyRents.length * 0.03, 0.6),
        notes:
          "Rentals.ca fallback used parsed rent points only (listing metadata unavailable in response).",
        reference: {
          publisher: "Rentals.ca",
          dataset: "Manual fallback scrape",
          metric: "median_rent",
          region: region.regionLabel,
          period: "live",
          url: searchUrl,
          fetchedAt: new Date().toISOString()
        }
      },
      consideredComparables: fallbackParsedOnlyRents.slice(0, 12),
      retrievalTrace: {
        searchUrl,
        fetchMode,
        httpStatus: response?.status ?? null,
        isCloudflareBlock: false,
        parsedRentCount: parsed.length,
        cleanedRentCount: fallbackParsedOnlyRents.length,
        sampleParsedRents: parsed.slice(0, 12),
        sampleCleanedRents: fallbackParsedOnlyRents.slice(0, 12),
        comparableListings: fallbackParsedOnlyRents.slice(0, 8).map((rent, index) => ({
          url: `${searchUrl}#parsed-rent-${index + 1}`,
          rent,
          title: "Parsed rent point (metadata unavailable)",
          nicenessScore: 0,
          featureText: "parsed_rent_only"
        })),
        sourceComparableCount: 0,
        returnedComparableCount: Math.min(fallbackParsedOnlyRents.length, 8),
        matchedComparableCount: fallbackParsedOnlyRents.length,
        matchingStrategy: "beds_location",
        fallbackMode: "parsed_rent_only",
        matchingNotes:
          "Used parsed rent points only because Rentals.ca response did not include comparable listing metadata.",
        parsedPriceDiagnostics: parsedDiagnostics,
        geoRadiusKm: MAX_COMPARABLE_DISTANCE_KM,
        geoTarget,
        playwrightError: playwrightResult.error
      }
    };
  }
  const scored = allComparableListings
    .filter((item) => typeof item.rent === "number" && Number.isFinite(item.rent))
    .map((item) => {
      const similarity = similarityScore(listing, item, geoTarget);
      return { item, ...similarity };
    });
  const matchedComparables = scored
    .filter((row) => row.isMatch)
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map((row) => row.item);
  const matchedRents = matchedComparables.map((item) => item.rent ?? 0).filter((rent) => rent > 0);
  const cleaned = removeOutliers(matchedRents);
  const failureBreakdown = buildFailureBreakdown(scored);
  const scoredPreview = scored.slice(0, 6).map((row) => ({
    isMatch: row.isMatch,
    score: Number.isFinite(row.score) ? Number(row.score.toFixed(2)) : row.score,
    note: row.note,
    rent: row.item.rent,
    beds: row.item.beds,
    baths: row.item.baths,
    sqft: row.item.sqft,
    distanceKm: row.item.distanceKm,
    url: row.item.url
  }));
  if (cleaned.length === 0) {
    console.warn("[rentals-fallback:diagnostics]", {
      listingId: listing.id,
      searchUrl,
      fetchMode,
      parsedRentCount: parsed.length,
      extractedComparableCount: allComparableListings.length,
      matchedComparableCount: matchedComparables.length,
      cleanedComparableCount: cleaned.length,
      geoTarget,
      failureBreakdown: failureBreakdown || "no matches",
      scoredPreview
    });
    const estimate = noMatchEstimate(
      searchUrl,
      listing,
      "No Rentals.ca comparables matched beds + rough location requirements."
    );
    estimate.retrievalTrace.fetchMode = fetchMode;
    estimate.retrievalTrace.httpStatus = response?.status ?? null;
    estimate.retrievalTrace.parsedRentCount = parsed.length;
    estimate.retrievalTrace.cleanedRentCount = cleaned.length;
    estimate.retrievalTrace.sampleParsedRents = parsed.slice(0, 12);
    estimate.retrievalTrace.sampleCleanedRents = cleaned.slice(0, 12);
    estimate.retrievalTrace.comparableListings = allComparableListings.slice(0, 12);
    estimate.retrievalTrace.sourceComparableCount = allComparableListings.length;
    estimate.retrievalTrace.returnedComparableCount = 0;
    estimate.retrievalTrace.matchedComparableCount = matchedComparables.length;
    estimate.retrievalTrace.matchingNotes = failureBreakdown || "No comparable listings with required features.";
    estimate.retrievalTrace.fallbackMode = "structured_comparables";
    estimate.retrievalTrace.parsedPriceDiagnostics = parsedDiagnostics;
    estimate.retrievalTrace.geoRadiusKm = MAX_COMPARABLE_DISTANCE_KM;
    estimate.retrievalTrace.geoTarget = geoTarget;
    estimate.retrievalTrace.playwrightError = playwrightResult.error;
    return estimate;
  }

  const rent = clampCurrency(median(cleaned));
  const p25 = clampCurrency(quantile(cleaned, 0.25));
  const p75 = clampCurrency(quantile(cleaned, 0.75));
  const lowRent = p25 > 0 ? p25 : clampCurrency(rent * 0.9);
  const highRent = p75 > 0 ? p75 : clampCurrency(rent * 1.1);
  const region = inferRegion(listing);
  console.info("[rentals-fallback:diagnostics]", {
    listingId: listing.id,
    searchUrl,
    fetchMode,
    parsedRentCount: parsed.length,
    extractedComparableCount: allComparableListings.length,
    matchedComparableCount: matchedComparables.length,
    cleanedComparableCount: cleaned.length,
    estimateRent: rent,
    geoTarget,
    scoredPreview
  });

  return {
    monthlyRent: rent,
    lowRent,
    highRent,
    confidence: Math.min(0.4 + cleaned.length * 0.05, 0.82),
    noRentMatch: rent <= 0,
    method: "regional_fallback",
    assumptionSource: {
      field: "monthlyRent",
      value: rent,
      method: "regional_fallback",
      confidence: Math.min(0.4 + cleaned.length * 0.05, 0.82),
      notes: `Rentals.ca fallback (bedrooms + rough location), ${cleaned.length} comparable rent points.`,
      reference: {
        publisher: "Rentals.ca",
        dataset: "Manual fallback scrape",
        metric: "median_rent",
        region: region.regionLabel,
        period: "live",
        url: searchUrl,
        fetchedAt: new Date().toISOString()
      }
    },
    consideredComparables: cleaned.slice(0, 12),
    retrievalTrace: {
      searchUrl,
      fetchMode,
      httpStatus: response?.status ?? null,
      isCloudflareBlock: false,
      parsedRentCount: parsed.length,
      cleanedRentCount: cleaned.length,
      sampleParsedRents: parsed.slice(0, 12),
      sampleCleanedRents: cleaned.slice(0, 12),
      comparableListings: matchedComparables,
      sourceComparableCount: allComparableListings.length,
      returnedComparableCount: matchedComparables.length,
      matchedComparableCount: matchedComparables.length,
      matchingStrategy: "beds_location",
      fallbackMode: "structured_comparables",
      matchingNotes: geoTarget
        ? `Matched by bedrooms and within ${MAX_COMPARABLE_DISTANCE_KM}km when coordinates are available.`
        : "Matched by bedrooms plus rough address proximity (city/postal/street tokens).",
      parsedPriceDiagnostics: parsedDiagnostics,
      geoRadiusKm: MAX_COMPARABLE_DISTANCE_KM,
      geoTarget,
      playwrightError: playwrightResult.error
    }
  };
}

export const __rentalsCaTestUtils = {
  median,
  quantile,
  removeOutliers
};
