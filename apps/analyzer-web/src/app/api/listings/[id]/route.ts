import { NextResponse } from "next/server";
import { buildStoredListing, mapAnalysisRowToResult, mapListingRowToRecord } from "@/lib/db-mappers";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

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

  const stored = buildStoredListing(
    mapListingRowToRecord(listing),
    runs.map((row) => mapAnalysisRowToResult(row))
  );

  if (!stored) {
    return NextResponse.json({ error: "Listing has no analysis runs yet" }, { status: 404 });
  }

  return NextResponse.json(stored);
}
