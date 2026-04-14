#!/usr/bin/env npx tsx
/**
 * One-off DOM explore probe (network + Playwright). Run from apps/analyzer-web:
 *
 *   EXPLORE_USE_DOM_SCRAPER=true npx tsx scripts/run-realtor-dom-explore-probe.mts
 *
 * Optional env: LOCATION="Victoria, BC" MAX_PRICE=900000 RADIUS_MILES=10
 */
import { runRealtorDomExploreJob } from "../src/lib/realtor-ca/run-explore-job-dom";

const location = process.env.LOCATION ?? "Victoria, BC";
const maxPrice = Number(process.env.MAX_PRICE ?? "900000");
const radiusMiles = process.env.RADIUS_MILES !== undefined ? Number(process.env.RADIUS_MILES) : 10;

async function main(): Promise<void> {
  const started = performance.now();
  try {
    const result = await runRealtorDomExploreJob({
      locationQuery: location,
      maxPrice,
      radiusMiles
    });
    console.info(
      JSON.stringify(
        {
          ok: true,
          ms: Math.round(performance.now() - started),
          geocodedLabel: result.geocodedLabel,
          listingCount: result.listings.length,
          truncated: result.truncated,
          domMeta: result.domMeta,
          sample: result.listings.slice(0, 2)
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          ms: Math.round(performance.now() - started),
          error: e instanceof Error ? e.message : String(e)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

void main();
