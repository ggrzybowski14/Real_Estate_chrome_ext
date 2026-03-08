import { NextResponse } from "next/server";
import { refreshStatcanBenchmarks } from "@/lib/benchmarks/refresh-statcan";
import { getRequestIp, isApiSecretAuthorized, isRateLimited } from "@/lib/api-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!isApiSecretAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ip = getRequestIp(request);
  if (isRateLimited({ key: `benchmarks-refresh:${ip}`, maxRequests: 8, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = Boolean(body?.dryRun);
  const replaceExisting = body?.replaceExisting !== false;

  try {
    const summary = await refreshStatcanBenchmarks({ dryRun, replaceExisting });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    console.error("[benchmarks.refresh] failed", error);
    return NextResponse.json(
      { error: "Benchmark refresh failed" },
      { status: 500 }
    );
  }
}
