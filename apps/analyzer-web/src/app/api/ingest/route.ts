import { NextResponse } from "next/server";
import { defaultAssumptionsFor, runRoiAnalysis } from "@rea/analysis";
import {
  mapAnalysisRowToResult,
  mapAnalysisToInsert,
  mapListingRowToRecord,
  mapRecordToListingInsert
} from "@/lib/db-mappers";
import { getRequestIp, isRateLimited } from "@/lib/api-security";
import { resolveBenchmarkAssumptions } from "@/lib/benchmark-resolver";
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
  const requestId = `ingest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  const ip = getRequestIp(request);
  if (isRateLimited({ key: `ingest:${ip}`, maxRequests: 40, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests", requestId }, { status: 429 });
  }
  const timingsMs: Record<string, number> = {};
  const stepEvents: Array<{
    step: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    elapsedMs: number;
    meta?: Record<string, unknown>;
  }> = [];
  const timedStep = async <T>(
    step: string,
    run: () => Promise<T> | T,
    meta?: Record<string, unknown>
  ): Promise<T> => {
    const stepStartedAt = new Date().toISOString();
    const stepStartMs = performance.now();
    console.info("[ingest] step:start", {
      requestId,
      step,
      startedAt: stepStartedAt,
      elapsedMs: Math.round(stepStartMs - startedMs),
      ...(meta ?? {})
    });
    try {
      const result = await run();
      const endedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - stepStartMs);
      const elapsedMs = Math.round(performance.now() - startedMs);
      timingsMs[step] = elapsedMs;
      stepEvents.push({
        step,
        startedAt: stepStartedAt,
        endedAt,
        durationMs,
        elapsedMs,
        meta
      });
      console.info("[ingest] step:done", {
        requestId,
        step,
        endedAt,
        durationMs,
        elapsedMs,
        ...(meta ?? {})
      });
      return result;
    } catch (error) {
      const endedAt = new Date().toISOString();
      const durationMs = Math.round(performance.now() - stepStartMs);
      const elapsedMs = Math.round(performance.now() - startedMs);
      console.info("[ingest] step:error", {
        requestId,
        step,
        endedAt,
        durationMs,
        elapsedMs,
        error: error instanceof Error ? error.message : "unknown",
        ...(meta ?? {})
      });
      throw error;
    }
  };

  console.info("[ingest] start", { requestId, startedAt });
  const rawPayload = await timedStep("requestParsed", () => request.json().catch(() => null));
  if (!rawPayload || typeof rawPayload !== "object") {
    const endedAt = new Date().toISOString();
    const totalMs = Math.round(performance.now() - startedMs);
    console.info("[ingest] invalid-payload", { requestId, endedAt, totalMs, timingsMs, stepEvents });
    return NextResponse.json(
      { error: "Invalid payload", requestId, startedAt, endedAt, totalMs, timingsMs, stepEvents },
      { status: 400 }
    );
  }

  const listing = await timedStep("incomingParsed", () => parseIncomingListing(JSON.stringify(rawPayload)));
  if (!listing) {
    const endedAt = new Date().toISOString();
    const totalMs = Math.round(performance.now() - startedMs);
    console.info("[ingest] listing-parse-failed", { requestId, endedAt, totalMs, timingsMs, stepEvents });
    return NextResponse.json(
      {
        error: "Payload could not be parsed into listing",
        requestId,
        startedAt,
        endedAt,
        totalMs,
        timingsMs,
        stepEvents
      },
      { status: 400 }
    );
  }
  if (!listing.price || listing.price <= 0) {
    const endedAt = new Date().toISOString();
    const totalMs = Math.round(performance.now() - startedMs);
    console.info("[ingest] missing-property-cost", {
      requestId,
      endedAt,
      totalMs,
      timingsMs,
      stepEvents,
      sourceListingId: listing.sourceListingId ?? null,
      url: listing.url
    });
    return NextResponse.json(
      {
        error:
          "Property price could not be captured from the listing. Please reload the listing page and run Analyze again.",
        requestId,
        startedAt,
        endedAt,
        totalMs,
        timingsMs,
        stepEvents
      },
      { status: 422 }
    );
  }

  const supabase = getSupabaseAdminClient();
  const normalizedUrl = canonicalUrl(listing.url);
  const listingInsert = {
    ...mapRecordToListingInsert(listing),
    url: normalizedUrl
  };

  const sourceLookupPromise = listing.sourceListingId
    ? timedStep(
        "dedupeBySourceListingId",
        () =>
          supabase
            .from("listings")
            .select("*")
            .eq("source", listing.source)
            .eq("source_listing_id", listing.sourceListingId)
            .order("captured_at", { ascending: false })
            .limit(1),
        { source: listing.source, sourceListingId: listing.sourceListingId }
      )
    : Promise.resolve({ data: null });

  const urlLookupPromise = timedStep(
    "dedupeByUrl",
    () =>
      supabase
        .from("listings")
        .select("*")
        .eq("url", normalizedUrl)
        .order("captured_at", { ascending: false })
        .limit(1),
    { normalizedUrl }
  );

  const [sourceLookup, urlLookup] = await Promise.all([sourceLookupPromise, urlLookupPromise]);
  const sourceMatched = sourceLookup.data?.[0] ?? null;
  const urlMatched = urlLookup.data?.[0] ?? null;
  const matchedListing: Record<string, unknown> | null = sourceMatched ?? urlMatched;

  if (
    sourceMatched &&
    urlMatched &&
    String(sourceMatched.id) !== String(urlMatched.id)
  ) {
    console.info("[ingest] dedupe-conflict", {
      requestId,
      sourceMatchedId: String(sourceMatched.id),
      urlMatchedId: String(urlMatched.id),
      sourceListingId: listing.sourceListingId,
      normalizedUrl
    });
  }

  let persistedListing: Record<string, unknown> | null = null;
  let listingError: Error | null = null;

  if (matchedListing?.id) {
    const updatePayload = mergeListingForUpdate(matchedListing, listingInsert);
    const { data, error } = await timedStep(
      "listingPersisted:update",
      () =>
        supabase
          .from("listings")
          .update(updatePayload)
          .eq("id", String(matchedListing.id))
          .select("*")
          .single(),
      { matchedListingId: String(matchedListing.id) }
    );
    persistedListing = data;
    listingError = error;
  } else {
    const { data, error } = await timedStep(
      "listingPersisted:insert",
      () =>
        supabase
          .from("listings")
          .insert(listingInsert)
          .select("*")
          .single(),
      { normalizedUrl }
    );
    persistedListing = data;
    listingError = error;
  }

  if (listingError || !persistedListing) {
    const endedAt = new Date().toISOString();
    const totalMs = Math.round(performance.now() - startedMs);
    console.info("[ingest] listing-save-failed", {
      requestId,
      endedAt,
      totalMs,
      timingsMs,
      stepEvents,
      error: listingError?.message ?? "unknown"
    });
    return NextResponse.json(
      {
        error: "Could not save listing",
        requestId,
        startedAt,
        endedAt,
        totalMs,
        timingsMs,
        stepEvents
      },
      { status: 500 }
    );
  }

  const listingRecord = mapListingRowToRecord(
    persistedListing as Parameters<typeof mapListingRowToRecord>[0]
  );
  let assumptions = defaultAssumptionsFor(listingRecord);
  let assumptionSources = undefined;
  let benchmarkContext = undefined;
  try {
    const benchmark = await timedStep(
      "assumptionsResolved",
      () => resolveBenchmarkAssumptions(listingRecord),
      { listingId: listingRecord.id }
    );
    assumptions = benchmark.assumptions;
    assumptionSources = benchmark.assumptionSources;
    benchmarkContext = benchmark.benchmarkContext;
  } catch (error) {
    console.info("[ingest] assumptionsResolved:fallback-defaults", {
      requestId,
      error: error instanceof Error ? error.message : "unknown"
    });
    assumptions = defaultAssumptionsFor(listingRecord);
  }
  const analysis = await timedStep("analysisComputed", () => runRoiAnalysis(listingRecord, assumptions), {
    listingId: listingRecord.id
  });
  analysis.assumptionSources = assumptionSources;
  analysis.benchmarkContext = benchmarkContext;
  const { data: insertedRun, error: runError } = await timedStep(
    "analysisPersisted",
    () =>
      supabase
        .from("analysis_runs")
        .insert(mapAnalysisToInsert(analysis))
        .select("*")
        .single(),
    { listingId: listingRecord.id }
  );

  if (runError || !insertedRun) {
    const endedAt = new Date().toISOString();
    const totalMs = Math.round(performance.now() - startedMs);
    console.info("[ingest] analysis-save-failed", {
      requestId,
      endedAt,
      totalMs,
      timingsMs,
      stepEvents,
      error: runError?.message ?? "unknown"
    });
    return NextResponse.json(
      {
        error: "Could not save analysis run",
        requestId,
        startedAt,
        endedAt,
        totalMs,
        timingsMs,
        stepEvents
      },
      { status: 500 }
    );
  }

  const endedAt = new Date().toISOString();
  const totalMs = Math.round(performance.now() - startedMs);
  console.info("[ingest] success", {
    requestId,
    endedAt,
    totalMs,
    timingsMs,
    stepEvents,
    listingId: listingRecord.id
  });
  return NextResponse.json({
    listingId: listingRecord.id,
    score: insertedRun.score,
    listing: listingRecord,
    diagnostics: {
      requestId,
      startedAt,
      endedAt,
      totalMs,
      timingsMs,
      stepEvents
    },
    latestAnalysis: mapAnalysisRowToResult(
      insertedRun as Parameters<typeof mapAnalysisRowToResult>[0]
    )
  });
}
