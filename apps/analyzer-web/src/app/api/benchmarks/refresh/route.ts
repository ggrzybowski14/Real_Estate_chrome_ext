import { NextResponse } from "next/server";
import { refreshStatcanBenchmarks } from "@/lib/benchmarks/refresh-statcan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(request: Request): boolean {
  const secret = process.env.BENCHMARK_REFRESH_SECRET;
  if (!secret) {
    return false;
  }
  const header = request.headers.get("x-benchmark-refresh-secret");
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return header === secret || token === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const dryRun = Boolean(body?.dryRun);
  const replaceExisting = body?.replaceExisting !== false;

  try {
    const summary = await refreshStatcanBenchmarks({ dryRun, replaceExisting });
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Benchmark refresh failed" },
      { status: 500 }
    );
  }
}
