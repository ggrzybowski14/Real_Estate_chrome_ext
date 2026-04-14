import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import type { RealtorExploreListingPayload } from "@/lib/realtor-ca/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = getSupabaseAdminClient();
  const { data: job, error: jobError } = await supabase
    .from("realtor_explore_jobs")
    .select("*")
    .eq("id", params.id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: resultRows, error: resError } = await supabase
    .from("realtor_explore_results")
    .select("mls_number, listing_url, payload")
    .eq("job_id", params.id)
    .order("created_at", { ascending: true });

  if (resError) {
    console.error("[explore/jobs/id] results", resError);
    return NextResponse.json({ error: "Could not load results" }, { status: 500 });
  }

  const listings = (resultRows ?? []).map((r) => r.payload as RealtorExploreListingPayload);

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      locationQuery: job.location_query,
      maxPrice: job.max_price,
      radiusMiles: job.radius_miles,
      geocodedLabel: job.geocoded_label,
      center:
        job.center_lat != null && job.center_lon != null
          ? { lat: job.center_lat, lon: job.center_lon }
          : null,
      priceMaxTier: job.price_max_tier,
      resultCount: job.result_count,
      errorMessage: job.error_message,
      meta: job.meta,
      createdAt: job.created_at
    },
    listings
  });
}
