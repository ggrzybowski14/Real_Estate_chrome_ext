import { timingSafeEqual } from "node:crypto";

const rateBuckets = new Map<string, number[]>();
const warned = new Set<string>();

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requestSecretToken(request: Request): string {
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return bearer.slice("Bearer ".length);
  }

  return (
    request.headers.get("x-api-secret") ??
    request.headers.get("x-benchmark-refresh-secret") ??
    ""
  );
}

export function isApiSecretAuthorized(request: Request): boolean {
  const secret = process.env.API_WRITE_SECRET ?? process.env.BENCHMARK_REFRESH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      warnOnce(
        "missing_write_secret_prod",
        "[security] API_WRITE_SECRET is missing in production; mutating routes are blocked."
      );
      return false;
    }
    warnOnce(
      "missing_write_secret_nonprod",
      "[security] API_WRITE_SECRET not set; mutating routes are open in non-production."
    );
    return true;
  }

  const token = requestSecretToken(request);
  return token !== "" && safeCompare(token, secret);
}

export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function isRateLimited(params: {
  key: string;
  maxRequests: number;
  windowMs: number;
}): boolean {
  const now = Date.now();
  const current = rateBuckets.get(params.key) ?? [];
  const active = current.filter((timestamp) => now - timestamp <= params.windowMs);
  active.push(now);
  rateBuckets.set(params.key, active);
  return active.length > params.maxRequests;
}
