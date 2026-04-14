import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ScrapedListingPayload } from "../../chrome-extension/src/content/scraper.js";

const MLS_IN_PATH = /\/real-estate\/(\d{6,12})(?:\/|$)/iu;

export function listingIdFromRealtorUrl(url: string): string | undefined {
  const m = url.match(MLS_IN_PATH);
  return m?.[1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function getSupabaseAdminForCli(): SupabaseClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

const SENTINEL_MAX_PRICE = 999_999_999;

export type CliJobMeta = {
  source: "playwright-cli";
  inputMapUrl: string;
  headed: boolean;
  dryRun: boolean;
  listingCount: number;
  detailErrors: number;
  maxListings: number;
  scrollRounds: number;
  /** Set when REALTOR_PW_CDP_ENDPOINT was used (attach to existing Chrome). */
  cdpEndpoint: string | null;
  listingWaitMs: number;
  stealthInitScript: boolean;
};

export async function insertExploreJobAndResults(input: {
  mapUrl: string;
  locationLabel: string;
  listings: ScrapedListingPayload[];
  meta: CliJobMeta;
}): Promise<{ jobId: string }> {
  const supabase = getSupabaseAdminForCli();

  const { data: jobRow, error: insertError } = await supabase
    .from("realtor_explore_jobs")
    .insert({
      status: "complete",
      location_query: input.locationLabel.slice(0, 500),
      max_price: SENTINEL_MAX_PRICE,
      radius_miles: 0,
      result_count: input.listings.length,
      meta: {
        ...input.meta,
        inputMapUrl: input.mapUrl,
        maxPriceSentinel: SENTINEL_MAX_PRICE,
        note:
          "max_price is a sentinel (999999999) for CLI map-URL runs; real filters are in the pasted map URL hash."
      }
    })
    .select("id")
    .single();

  if (insertError || !jobRow?.id) {
    throw new Error(
      `Could not insert realtor_explore_jobs: ${insertError?.message ?? "unknown"} — apply apps/analyzer-web/supabase/explore_schema.sql`
    );
  }

  const jobId = jobRow.id as string;

  if (input.listings.length > 0) {
    const rows = input.listings.map((payload) => ({
      job_id: jobId,
      mls_number: listingIdFromRealtorUrl(payload.url) ?? null,
      listing_url: payload.url,
      payload: payload as unknown as Record<string, unknown>
    }));

    const { error: resErr } = await supabase.from("realtor_explore_results").insert(rows);
    if (resErr) {
      throw new Error(`Could not insert realtor_explore_results: ${resErr.message}`);
    }
  }

  return { jobId };
}
