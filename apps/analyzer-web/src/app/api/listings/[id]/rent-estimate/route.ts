import { NextResponse } from "next/server";
import { mapAnalysisRowToResult, mapListingRowToRecord } from "@/lib/db-mappers";
import { estimateRentFromRows } from "@/lib/rent-estimate";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getRequestIp, isRateLimited } from "@/lib/api-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const ip = getRequestIp(request);
  if (isRateLimited({ key: `rent-estimate:${ip}`, maxRequests: 40, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = getSupabaseAdminClient();
  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("*")
    .eq("id", params.id)
    .single();

  if (listingError || !listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const listingRecord = mapListingRowToRecord(listing);
  const { data: runs, error: runsError } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("listing_id", params.id)
    .order("run_at", { ascending: false })
    .limit(1);

  if (runsError) {
    console.error("[rent-estimate] runs fetch failed", runsError);
    return NextResponse.json({ error: "Could not load listing context" }, { status: 500 });
  }

  const latestRun = runs?.[0] ? mapAnalysisRowToResult(runs[0]) : null;
  const regionCode = latestRun?.benchmarkContext?.regionCode ?? "ca-generic-metro";

  const { data: rentRows, error: rentError } = await supabase
    .from("market_rent_benchmarks")
    .select("*")
    .eq("region_code", regionCode)
    .limit(250);

  if (rentError) {
    console.error("[rent-estimate] benchmark fetch failed", rentError);
    return NextResponse.json({ error: "Could not fetch rent comparables" }, { status: 500 });
  }

  const estimate = estimateRentFromRows(
    (rentRows ?? []) as Parameters<typeof estimateRentFromRows>[0],
    listingRecord,
    latestRun?.assumptionSources ?? {}
  );

  return NextResponse.json({
    ok: true,
    estimate
  });
}
