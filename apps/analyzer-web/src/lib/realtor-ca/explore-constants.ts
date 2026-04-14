/**
 * Conservative defaults reduce obvious automation patterns (fixed intervals, high volume).
 * They do not guarantee bypassing WAF/bot protection — tune via env in production if needed.
 */

/** Default search radius when user omits it. */
export const EXPLORE_DEFAULT_RADIUS_MILES = 10;

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function clampMinMax(min: number, max: number): { min: number; max: number } {
  if (min > max) return { min: max, max: min };
  return { min, max };
}

/** Integer in [min, max] inclusive. Exported for unit tests. */
export function randomIntInclusive(min: number, max: number): number {
  if (max < min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function jitteredDelayMs(minMs: number, maxMs: number): number {
  const { min, max } = clampMinMax(minMs, maxMs);
  return randomIntInclusive(min, max);
}

export type ExploreCaps = {
  maxSearchPages: number;
  recordsPerPage: number;
  maxDetailListings: number;
};

/** Volume caps (conservative defaults; override with EXPLORE_* env vars). */
export function getExploreCaps(): ExploreCaps {
  return {
    maxSearchPages: Math.max(1, parseEnvInt("EXPLORE_MAX_SEARCH_PAGES", 2)),
    recordsPerPage: Math.max(1, parseEnvInt("EXPLORE_RECORDS_PER_PAGE", 20)),
    maxDetailListings: Math.max(1, parseEnvInt("EXPLORE_MAX_DETAIL_LISTINGS", 12))
  };
}

export function getDetailDelayRangeMs(): { min: number; max: number } {
  return clampMinMax(
    parseEnvInt("EXPLORE_DETAIL_DELAY_MIN_MS", 1500),
    parseEnvInt("EXPLORE_DETAIL_DELAY_MAX_MS", 4000)
  );
}

export function getSearchPagePauseRangeMs(): { min: number; max: number } {
  return clampMinMax(
    parseEnvInt("EXPLORE_SEARCH_PAGE_PAUSE_MIN_MS", 800),
    parseEnvInt("EXPLORE_SEARCH_PAGE_PAUSE_MAX_MS", 2000)
  );
}

export function getMapSettleRangeMs(): { min: number; max: number } {
  return clampMinMax(
    parseEnvInt("EXPLORE_MAP_SETTLE_MIN_MS", 3500),
    parseEnvInt("EXPLORE_MAP_SETTLE_MAX_MS", 6000)
  );
}

export function getDetailDelayMs(): number {
  const r = getDetailDelayRangeMs();
  return jitteredDelayMs(r.min, r.max);
}

export function getSearchPagePauseMs(): number {
  const r = getSearchPagePauseRangeMs();
  return jitteredDelayMs(r.min, r.max);
}

export function getMapSettleMs(): number {
  const r = getMapSettleRangeMs();
  return jitteredDelayMs(r.min, r.max);
}

export type ExploreTimingProfile = {
  conservativeMode: true;
  delayProfile: "jitter";
  caps: ExploreCaps;
  rangesMs: {
    detailDelay: { min: number; max: number };
    mapSettle: { min: number; max: number };
    searchPagePause: { min: number; max: number };
  };
};

export function buildExploreTimingProfile(): ExploreTimingProfile {
  return {
    conservativeMode: true,
    delayProfile: "jitter",
    caps: getExploreCaps(),
    rangesMs: {
      detailDelay: getDetailDelayRangeMs(),
      mapSettle: getMapSettleRangeMs(),
      searchPagePause: getSearchPagePauseRangeMs()
    }
  };
}
