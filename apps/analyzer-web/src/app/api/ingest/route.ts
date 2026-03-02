import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload.url !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  return NextResponse.json({
    accepted: true,
    message: "Use /ingest?payload=<encoded-json> for local MVP persistence."
  });
}
