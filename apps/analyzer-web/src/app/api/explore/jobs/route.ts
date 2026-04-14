import { NextResponse } from "next/server";
import { getRequestIp, isRateLimited } from "@/lib/api-security";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { runRealtorDomExploreJob } from "@/lib/realtor-ca/run-explore-job-dom";
import { runRealtorExploreJob } from "@/lib/realtor-ca/run-explore-job";
import { RealtorDomExploreError } from "@/lib/realtor-ca/realtor-dom-types";
import type { RealtorExploreListingPayload } from "@/lib/realtor-ca/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type PostBody = {
  location?: string;
  maxPrice?: number;
  radiusMiles?: number;
  /** Client override: `"api"` (api37) or `"dom"` (map HTML). If omitted, uses EXPLORE_USE_DOM_SCRAPER env. */
  scraper?: string;
};

function resolveScraperMode(body: PostBody): "api" | "dom" {
  const s = typeof body.scraper === "string" ? body.scraper.trim().toLowerCase() : "";
  if (s === "dom") return "dom";
  if (s === "api") return "api";
  return process.env.EXPLORE_USE_DOM_SCRAPER === "true" ? "dom" : "api";
}

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  if (isRateLimited({ key: `explore-jobs:${ip}`, maxRequests: 8, windowMs: 60 * 60_000 })) {
    return NextResponse.json({ error: "Too many explore requests — try again later." }, { status: 429 });
  }

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const locationQuery = typeof body.location === "string" ? body.location.trim() : "";
  const maxPrice = typeof body.maxPrice === "number" ? body.maxPrice : Number(body.maxPrice);
  const radiusMiles =
    body.radiusMiles === undefined || body.radiusMiles === null
      ? undefined
      : Number(body.radiusMiles);

  if (locationQuery.length < 2) {
    return NextResponse.json({ error: "location is required (e.g. \"Victoria, BC\")." }, { status: 400 });
  }
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return NextResponse.json({ error: "maxPrice must be a positive number." }, { status: 400 });
  }
  if (radiusMiles !== undefined && (!Number.isFinite(radiusMiles) || radiusMiles < 1 || radiusMiles > 80)) {
    return NextResponse.json({ error: "radiusMiles must be between 1 and 80 when provided." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();

  const { data: jobRow, error: insertError } = await supabase
    .from("realtor_explore_jobs")
    .insert({
      status: "running",
      location_query: locationQuery,
      max_price: maxPrice,
      radius_miles: radiusMiles ?? 10
    })
    .select("id")
    .single();

  if (insertError || !jobRow?.id) {
    console.error("[explore/jobs] insert failed", insertError);
    return NextResponse.json(
      {
        error:
          "Could not create explore job. Apply supabase/explore_schema.sql to your database (realtor_explore_jobs table)."
      },
      { status: 503 }
    );
  }

  const jobId = jobRow.id as string;
  const scraperMode = resolveScraperMode(body);

  try {
    const result =
      scraperMode === "dom"
        ? await runRealtorDomExploreJob({
            locationQuery,
            maxPrice,
            radiusMiles
          })
        : await runRealtorExploreJob({
            locationQuery,
            maxPrice,
            radiusMiles
          });

    const rows = result.listings.map((payload: RealtorExploreListingPayload) => ({
      job_id: jobId,
      mls_number: payload.sourceListingId ?? null,
      listing_url: payload.url,
      payload
    }));

    if (rows.length > 0) {
      const { error: resErr } = await supabase.from("realtor_explore_results").insert(rows);
      if (resErr) {
        console.error("[explore/jobs] results insert failed", resErr);
      }
    }

    const { error: updErr } = await supabase
      .from("realtor_explore_jobs")
      .update({
        status: "complete",
        geocoded_label: result.geocodedLabel,
        center_lat: result.center.lat,
        center_lon: result.center.lon,
        price_max_tier: result.priceMaxTier,
        result_count: result.listings.length,
        meta: {
          scraper: scraperMode,
          bounds: result.bounds,
          truncated: result.truncated,
          searchPagesFetched: result.searchPagesFetched,
          detailFetches: result.detailFetches,
          timingProfile: result.timingProfile,
          ...(result.domMeta ? { dom: result.domMeta } : {})
        },
        updated_at: new Date().toISOString()
      })
      .eq("id", jobId);

    if (updErr) {
      console.error("[explore/jobs] job update failed", updErr);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      scraperUsed: scraperMode,
      job: {
        id: jobId,
        status: "complete",
        geocodedLabel: result.geocodedLabel,
        center: result.center,
        priceMaxTier: result.priceMaxTier,
        resultCount: result.listings.length,
        truncated: result.truncated,
        searchPagesFetched: result.searchPagesFetched,
        detailFetches: result.detailFetches,
        timingProfile: result.timingProfile,
        meta: result.domMeta ? { dom: result.domMeta } : undefined
      },
      listings: result.listings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[explore/jobs] scrape failed", error);
    await supabase
      .from("realtor_explore_jobs")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString()
      })
      .eq("id", jobId);

    const upstreamBlocked =
      /Realtor\.ca blocked|HTTP 403|Incapsula|bot block|REALTOR_DOM_BLOCKED/i.test(message) ||
      message.includes("edge filter");
    const httpStatus = upstreamBlocked ? 503 : 502;

    const domDiag = error instanceof RealtorDomExploreError ? error.diagnostics : undefined;

    return NextResponse.json(
      {
        ok: false,
        jobId,
        scraperUsed: scraperMode,
        error: message,
        errorCode: upstreamBlocked ? "REALTOR_UPSTREAM_BLOCKED" : "EXPLORE_SCRAPE_FAILED",
        diagnostics: domDiag
      },
      { status: httpStatus }
    );
  }
}
