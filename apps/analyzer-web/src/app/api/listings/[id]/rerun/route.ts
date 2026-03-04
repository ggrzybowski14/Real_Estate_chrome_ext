import { NextResponse } from "next/server";
import { runRoiAnalysis } from "@rea/analysis";
import type { AssumptionSources, BenchmarkContext, ListingAssumptions } from "@rea/shared";
import {
  buildStoredListing,
  mapAnalysisRowToResult,
  mapAnalysisToInsert,
  mapListingRowToRecord
} from "@/lib/db-mappers";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return 0;
}

function parseAssumptions(value: unknown): ListingAssumptions | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const v = value as Record<string, unknown>;
  return {
    downPaymentPct: toNumber(v.downPaymentPct),
    mortgageRatePct: toNumber(v.mortgageRatePct),
    amortizationYears: toNumber(v.amortizationYears),
    closingCostsPct: toNumber(v.closingCostsPct),
    monthlyRent: toNumber(v.monthlyRent),
    vacancyPct: toNumber(v.vacancyPct),
    maintenancePct: toNumber(v.maintenancePct),
    annualPropertyTax: toNumber(v.annualPropertyTax),
    monthlyInsurance: toNumber(v.monthlyInsurance),
    monthlyUtilities: toNumber(v.monthlyUtilities),
    managementFeePct: toNumber(v.managementFeePct),
    rehabBudget: toNumber(v.rehabBudget)
  };
}

function parseAssumptionSources(value: unknown): AssumptionSources | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as AssumptionSources;
}

function parseBenchmarkContext(value: unknown): BenchmarkContext | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as BenchmarkContext;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => null);
  const assumptions = parseAssumptions(body?.assumptions);
  const assumptionSources = parseAssumptionSources(body?.assumptionSources);
  const benchmarkContext = parseBenchmarkContext(body?.benchmarkContext);
  if (!assumptions) {
    return NextResponse.json({ error: "Invalid assumptions payload" }, { status: 400 });
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
  const analysis = runRoiAnalysis(listingRecord, assumptions);
  analysis.assumptionSources = assumptionSources;
  analysis.benchmarkContext = benchmarkContext;
  const { error: insertError } = await supabase.from("analysis_runs").insert(mapAnalysisToInsert(analysis));

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: runs, error: runError } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("listing_id", params.id)
    .order("run_at", { ascending: false });

  if (runError || !runs) {
    return NextResponse.json(
      { error: runError?.message ?? "Could not fetch updated runs" },
      { status: 500 }
    );
  }

  const stored = buildStoredListing(
    listingRecord,
    runs.map((row) => mapAnalysisRowToResult(row))
  );
  if (!stored) {
    return NextResponse.json({ error: "Could not build updated listing" }, { status: 500 });
  }

  return NextResponse.json(stored);
}
