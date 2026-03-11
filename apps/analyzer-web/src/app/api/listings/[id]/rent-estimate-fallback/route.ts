import { NextResponse } from "next/server";
import { mapListingRowToRecord } from "@/lib/db-mappers";
import { getRequestIp, isRateLimited } from "@/lib/api-security";
import { estimateRentFromRentalsCa } from "@/lib/rentals-ca-estimate";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const ip = getRequestIp(request);
  if (isRateLimited({ key: `rent-estimate-fallback:${ip}`, maxRequests: 20, windowMs: 60_000 })) {
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
  const estimate = await estimateRentFromRentalsCa(listingRecord);

  return NextResponse.json({
    ok: true,
    estimate
  });
}
