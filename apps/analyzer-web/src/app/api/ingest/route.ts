import { NextResponse } from "next/server";
import { defaultAssumptionsFor, runRoiAnalysis } from "@rea/analysis";
import {
  mapAnalysisRowToResult,
  mapAnalysisToInsert,
  mapListingRowToRecord,
  mapRecordToListingInsert
} from "@/lib/db-mappers";
import { parseIncomingListing } from "@/lib/ingest";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function canonicalUrl(input: string): string {
  try {
    const parsed = new URL(input);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/u, "");
  } catch {
    return input.trim().replace(/\/+$/u, "");
  }
}

function mergeListingForUpdate(
  existing: Record<string, unknown>,
  incoming: ReturnType<typeof mapRecordToListingInsert>
) {
  const merged: Record<string, unknown> = { ...incoming };

  for (const [key, value] of Object.entries(merged)) {
    const hasIncomingValue =
      value !== null && value !== undefined && !(typeof value === "string" && value === "");
    if (!hasIncomingValue) {
      const existingValue = existing[key];
      if (
        existingValue !== null &&
        existingValue !== undefined &&
        !(typeof existingValue === "string" && existingValue === "")
      ) {
        merged[key] = existingValue;
      }
    }
  }

  merged.captured_at = incoming.captured_at;
  merged.url = canonicalUrl(String(incoming.url));
  return merged;
}

export async function POST(request: Request) {
  const rawPayload = await request.json().catch(() => null);
  if (!rawPayload || typeof rawPayload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const listing = parseIncomingListing(JSON.stringify(rawPayload));
  if (!listing) {
    return NextResponse.json({ error: "Payload could not be parsed into listing" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const normalizedUrl = canonicalUrl(listing.url);
  const listingInsert = {
    ...mapRecordToListingInsert(listing),
    url: normalizedUrl
  };

  let matchedListing: Record<string, unknown> | null = null;
  if (listing.sourceListingId) {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("source", listing.source)
      .eq("source_listing_id", listing.sourceListingId)
      .order("captured_at", { ascending: false })
      .limit(1);
    matchedListing = data?.[0] ?? null;
  }

  if (!matchedListing) {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("url", normalizedUrl)
      .order("captured_at", { ascending: false })
      .limit(1);
    matchedListing = data?.[0] ?? null;
  }

  let persistedListing: Record<string, unknown> | null = null;
  let listingError: Error | null = null;

  if (matchedListing?.id) {
    const updatePayload = mergeListingForUpdate(matchedListing, listingInsert);
    const { data, error } = await supabase
      .from("listings")
      .update(updatePayload)
      .eq("id", String(matchedListing.id))
      .select("*")
      .single();
    persistedListing = data;
    listingError = error;
  } else {
    const { data, error } = await supabase
      .from("listings")
      .insert(listingInsert)
      .select("*")
      .single();
    persistedListing = data;
    listingError = error;
  }

  if (listingError || !persistedListing) {
    return NextResponse.json(
      { error: listingError?.message ?? "Could not save listing" },
      { status: 500 }
    );
  }

  const listingRecord = mapListingRowToRecord(
    persistedListing as Parameters<typeof mapListingRowToRecord>[0]
  );
  const assumptions = defaultAssumptionsFor(listingRecord);
  const analysis = runRoiAnalysis(listingRecord, assumptions);
  const { data: insertedRun, error: runError } = await supabase
    .from("analysis_runs")
    .insert(mapAnalysisToInsert(analysis))
    .select("*")
    .single();

  if (runError || !insertedRun) {
    return NextResponse.json(
      { error: runError?.message ?? "Could not save analysis run" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    listingId: listingRecord.id,
    score: insertedRun.score,
    listing: listingRecord,
    latestAnalysis: mapAnalysisRowToResult(
      insertedRun as Parameters<typeof mapAnalysisRowToResult>[0]
    )
  });
}
