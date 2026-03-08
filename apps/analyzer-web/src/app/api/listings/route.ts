import { NextResponse } from "next/server";
import { defaultAssumptionsFor, runRoiAnalysis } from "@rea/analysis";
import { buildStoredListing, mapAnalysisRowToResult, mapListingRowToRecord } from "@/lib/db-mappers";
import { resolveBenchmarkAssumptions } from "@/lib/benchmark-resolver";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function dedupeKey(row: Record<string, unknown>): string {
  const source = String(row.source ?? "realtor.ca");
  const sourceListingId = row.source_listing_id ? String(row.source_listing_id) : "";
  const url = row.url ? String(row.url).replace(/\/+$/u, "") : "";
  if (sourceListingId) {
    return `${source}:${sourceListingId}`;
  }
  return `${source}:url:${url}`;
}

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const { data: allListings, error: listingError } = await supabase
    .from("listings")
    .select("*")
    .order("captured_at", { ascending: false })
    .limit(300);

  if (listingError || !allListings) {
    if (listingError) {
      console.error("[listings.get] listing fetch failed", listingError);
    }
    return NextResponse.json(
      { error: "Could not fetch listings" },
      { status: 500 }
    );
  }

  const seen = new Set<string>();
  const listings = allListings.filter((row) => {
    const key = dedupeKey(row as Record<string, unknown>);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  if (listings.length === 0) {
    return NextResponse.json([]);
  }

  const listingIds = listings.map((row) => row.id);
  const { data: runs, error: runError } = await supabase
    .from("analysis_runs")
    .select("*")
    .in("listing_id", listingIds)
    .order("run_at", { ascending: false });

  if (runError || !runs) {
    if (runError) {
      console.error("[listings.get] analysis fetch failed", runError);
    }
    return NextResponse.json(
      { error: "Could not fetch analysis runs" },
      { status: 500 }
    );
  }

  const runsByListingId = new Map<string, ReturnType<typeof mapAnalysisRowToResult>[]>();
  for (const row of runs) {
    const mapped = mapAnalysisRowToResult(row);
    const existing = runsByListingId.get(row.listing_id) ?? [];
    existing.push(mapped);
    runsByListingId.set(row.listing_id, existing);
  }

  const storedListings = await Promise.all(
    listings.map(async (row) => {
      const listing = mapListingRowToRecord(row);
      const history = runsByListingId.get(row.id) ?? [];
      if (history.length === 0) {
        try {
          const benchmark = await resolveBenchmarkAssumptions(listing);
          const analysis = runRoiAnalysis(listing, benchmark.assumptions);
          analysis.assumptionSources = benchmark.assumptionSources;
          analysis.benchmarkContext = benchmark.benchmarkContext;
          history.push(analysis);
        } catch {
          const assumptions = defaultAssumptionsFor(listing);
          history.push(runRoiAnalysis(listing, assumptions));
        }
      }
      return buildStoredListing(listing, history);
    })
  );

  return NextResponse.json(storedListings.filter(Boolean));
}
