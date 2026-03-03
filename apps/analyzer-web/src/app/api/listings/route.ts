import { NextResponse } from "next/server";
import { defaultAssumptionsFor, runRoiAnalysis } from "@rea/analysis";
import { buildStoredListing, mapAnalysisRowToResult, mapListingRowToRecord } from "@/lib/db-mappers";
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
    return NextResponse.json(
      { error: listingError?.message ?? "Could not fetch listings" },
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
    return NextResponse.json(
      { error: runError?.message ?? "Could not fetch analysis runs" },
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

  const storedListings = listings
    .map((row) => {
      const listing = mapListingRowToRecord(row);
      const history = runsByListingId.get(row.id) ?? [];
      if (history.length === 0) {
        const assumptions = defaultAssumptionsFor(listing);
        history.push(runRoiAnalysis(listing, assumptions));
      }
      return buildStoredListing(listing, history);
    })
    .filter(Boolean);

  return NextResponse.json(storedListings);
}
