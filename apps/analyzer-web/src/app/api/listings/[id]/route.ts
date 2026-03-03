import { NextResponse } from "next/server";
import { defaultAssumptionsFor, runRoiAnalysis } from "@rea/analysis";
import { buildStoredListing, mapAnalysisRowToResult, mapListingRowToRecord } from "@/lib/db-mappers";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = getSupabaseAdminClient();

  const { data: listing, error: listingError } = await supabase
    .from("listings")
    .select("*")
    .eq("id", params.id)
    .single();

  if (listingError || !listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }

  const { data: runs, error: runError } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("listing_id", params.id)
    .order("run_at", { ascending: false });

  if (runError || !runs) {
    return NextResponse.json(
      { error: runError?.message ?? "Could not fetch runs" },
      { status: 500 }
    );
  }

  const listingRecord = mapListingRowToRecord(listing);
  const history = runs.map((row) => mapAnalysisRowToResult(row));
  if (history.length === 0) {
    history.push(runRoiAnalysis(listingRecord, defaultAssumptionsFor(listingRecord)));
  }
  const stored = buildStoredListing(listingRecord, history);

  if (!stored) {
    return NextResponse.json({ error: "Listing could not be loaded" }, { status: 404 });
  }

  return NextResponse.json(stored);
}
