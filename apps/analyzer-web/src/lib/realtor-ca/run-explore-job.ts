import { boundingBoxFromCenterMiles } from "./bounds";
import type { ExploreJobInput, ExploreJobResult } from "./explore-job-types";
import {
  EXPLORE_DEFAULT_RADIUS_MILES,
  buildExploreTimingProfile,
  getDetailDelayMs,
  getExploreCaps,
  getSearchPagePauseMs
} from "./explore-constants";
import { logExplorePhase } from "./explore-log";
import {
  propertyDetailsGet,
  propertySearchPost,
  withRealtorPlaywrightSession,
  type PropertySearchResponse
} from "./realtor-api";
import { geocodeLocationQuery } from "./geocode";
import { buildPayloadFromSearchAndDetail } from "./map-payload";
import { snapPriceMaxToTier, snapPriceMinToTier } from "./price-tiers";
import type { RealtorExploreListingPayload } from "./types";

export type { ExploreJobInput, ExploreJobResult } from "./explore-job-types";

function normalizeSearchRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== "object") return {};
  return row as Record<string, unknown>;
}

function rowKey(row: Record<string, unknown>): string {
  const mls = String(row.MlsNumber ?? "").trim();
  if (mls) return mls;
  const id = String(row.Id ?? "").trim();
  return id || JSON.stringify(row).slice(0, 80);
}

function propertyIdsFromRow(row: Record<string, unknown>): { propertyId: string; mls: string } | null {
  const mls = String(row.MlsNumber ?? row.ReferenceNumber ?? "").trim();
  const idRaw = row.Id ?? row.PropertyId ?? (row.Property as Record<string, unknown> | undefined)?.Id;
  const propertyId = idRaw !== undefined && idRaw !== null ? String(idRaw).trim() : "";
  if (!mls || !propertyId) return null;
  return { propertyId, mls };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function runRealtorExploreJob(input: ExploreJobInput): Promise<ExploreJobResult> {
  const caps = getExploreCaps();
  const timingProfile = buildExploreTimingProfile();
  const radius = input.radiusMiles ?? EXPLORE_DEFAULT_RADIUS_MILES;

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

  return withRealtorPlaywrightSession(async (page) => {
    logExplorePhase("exploreSessionStart", {
      maxSearchPages: caps.maxSearchPages,
      recordsPerPage: caps.recordsPerPage,
      maxDetailListings: caps.maxDetailListings
    });

    const seen = new Map<string, Record<string, unknown>>();
    let searchPagesFetched = 0;

    for (let pageNum = 1; pageNum <= caps.maxSearchPages; pageNum += 1) {
      if (pageNum > 1) {
        const pauseMs = getSearchPagePauseMs();
        logExplorePhase("searchPagePause", { ms: pauseMs, beforePage: pageNum });
        await sleep(pauseMs);
      }

      const searchStarted = performance.now();
      const res: PropertySearchResponse = await propertySearchPost(page, {
        CultureId: 1,
        ApplicationId: 37,
        PropertySearchTypeId: 1,
        TransactionTypeId: 2,
        HashCode: 0,
        LongitudeMin: bounds.LongitudeMin,
        LongitudeMax: bounds.LongitudeMax,
        LatitudeMin: bounds.LatitudeMin,
        LatitudeMax: bounds.LatitudeMax,
        PriceMin: priceMinTier,
        PriceMax: priceMaxTier,
        CurrentPage: pageNum,
        RecordsPerPage: caps.recordsPerPage
      });

      const rawList = res.Results ?? (res as { results?: unknown[] }).results;
      const results = Array.isArray(rawList) ? rawList : [];
      searchPagesFetched += 1;
      logExplorePhase("propertySearchDone", {
        page: pageNum,
        resultCount: results.length,
        ms: Math.round(performance.now() - searchStarted)
      });

      if (results.length === 0) break;

      for (const raw of results) {
        const row = normalizeSearchRow(raw);
        const key = rowKey(row);
        if (!seen.has(key)) seen.set(key, row);
      }

      if (results.length < caps.recordsPerPage) break;
    }

    const rows = Array.from(seen.values()).slice(0, caps.maxDetailListings);
    const truncated = seen.size > caps.maxDetailListings;

    const listings: RealtorExploreListingPayload[] = [];
    let detailFetches = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      const ids = propertyIdsFromRow(row);
      let detail: Record<string, unknown> | null = null;
      if (ids) {
        const dStarted = performance.now();
        logExplorePhase("detailFetchStart", {
          index: i + 1,
          total: rows.length,
          mls: ids.mls
        });
        detail = await propertyDetailsGet(page, ids.propertyId, ids.mls);
        detailFetches += 1;
        logExplorePhase("detailFetchDone", {
          index: i + 1,
          ms: Math.round(performance.now() - dStarted)
        });
      }
      listings.push(buildPayloadFromSearchAndDetail(row, detail));

      if (i < rows.length - 1) {
        const delayMs = getDetailDelayMs();
        logExplorePhase("detailDelay", { ms: delayMs, afterRow: i + 1 });
        await sleep(delayMs);
      }
    }

    logExplorePhase("exploreSessionComplete", {
      listings: listings.length,
      detailFetches,
      searchPagesFetched,
      truncated
    });

    return {
      geocodedLabel: geo.displayName,
      center: { lat: geo.lat, lon: geo.lon },
      bounds,
      priceMaxTier,
      listings,
      truncated,
      searchPagesFetched,
      detailFetches,
      timingProfile
    };
  });
}
