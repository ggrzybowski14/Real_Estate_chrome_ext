import type { AssumptionSourceDetail, ListingRecord } from "@rea/shared";
import { bedroomBucket, inferRegion, sqftBucket } from "./benchmark-resolver";

type RentalsCaEstimate = {
  monthlyRent: number;
  lowRent: number;
  highRent: number;
  confidence: number;
  noRentMatch: boolean;
  method: AssumptionSourceDetail["method"];
  assumptionSource: AssumptionSourceDetail;
  consideredComparables: number[];
};

function clampCurrency(value: number): number {
  return Math.max(Math.round(value), 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
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
    return parts[1];
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

async function fetchRentalsCaHtmlWithPlaywright(targetUrl: string): Promise<{
  html: string | null;
  error: string | null;
}> {
  const usePlaywright = process.env.RENTALS_USE_PLAYWRIGHT !== "false";
  if (!usePlaywright) {
    return { html: null, error: null };
  }

  try {
    process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0";
    const playwright = await import("playwright");
    const browser = await playwright.chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
      args: ["--disable-blink-features=AutomationControlled"]
    });
    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        locale: "en-CA"
      });
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4500);
      const renderedHtml = await page.content();
      const textContent = await page.evaluate(() => document.body?.innerText ?? "");
      return { html: `${renderedHtml}\n${textContent}`, error: null };
    } finally {
      await browser.close();
    }
  } catch (error) {
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
    consideredComparables: []
  };
}

export async function estimateRentFromRentalsCa(listing: ListingRecord): Promise<RentalsCaEstimate> {
  const searchUrl = buildRentalsCaSearchUrl(listing);
  const playwrightResult = await fetchRentalsCaHtmlWithPlaywright(searchUrl);
  const playwrightHtml = playwrightResult.html;
  const htmlFromPlaywright = playwrightHtml && playwrightHtml.trim().length > 0 ? playwrightHtml : null;

  let html = htmlFromPlaywright;
  let response: Response;
  if (!html) {
    try {
      response = await fetch(searchUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; REA-Analyzer/1.0; +https://example.local)"
        },
        cache: "no-store"
      });
      html = await response.text();
      if (!response.ok) {
        if (response.status === 403) {
          const playwrightFailureNote = playwrightResult.error
            ? ` Playwright error: ${playwrightResult.error}.`
            : "";
          return noMatchEstimate(
            searchUrl,
            listing,
            `Rentals.ca blocked direct access (HTTP 403). Playwright could not bypass challenge for this run.${playwrightFailureNote}`
          );
        }
        return noMatchEstimate(
          searchUrl,
          listing,
          `Rentals.ca fallback scrape returned HTTP ${response.status}.`
        );
      }
    } catch {
      return noMatchEstimate(searchUrl, listing, "Rentals.ca fallback scrape request failed.");
    }
  }

  if (looksLikeCloudflareBlock(html)) {
    return noMatchEstimate(
      searchUrl,
      listing,
      "Rentals.ca challenge page detected. Playwright session did not resolve listings for this request."
    );
  }
  const parsed = extractRentValuesFromHtml(html);
  const cleaned = removeOutliers(parsed);
  if (cleaned.length === 0) {
    return noMatchEstimate(searchUrl, listing, "No parseable Rentals.ca rent comparables found.");
  }

  const rent = clampCurrency(median(cleaned));
  const p25 = clampCurrency(quantile(cleaned, 0.25));
  const p75 = clampCurrency(quantile(cleaned, 0.75));
  const lowRent = p25 > 0 ? p25 : clampCurrency(rent * 0.9);
  const highRent = p75 > 0 ? p75 : clampCurrency(rent * 1.1);
  const region = inferRegion(listing);

  return {
    monthlyRent: rent,
    lowRent,
    highRent,
    confidence: Math.min(0.35 + cleaned.length * 0.04, 0.72),
    noRentMatch: rent <= 0,
    method: "regional_fallback",
    assumptionSource: {
      field: "monthlyRent",
      value: rent,
      method: "regional_fallback",
      confidence: Math.min(0.35 + cleaned.length * 0.04, 0.72),
      notes: `Rentals.ca fallback scrape (manual trigger), ${cleaned.length} comparable rent points.`,
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
    consideredComparables: cleaned.slice(0, 12)
  };
}

export const __rentalsCaTestUtils = {
  median,
  quantile,
  removeOutliers
};
