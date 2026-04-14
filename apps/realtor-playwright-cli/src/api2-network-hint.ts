import type { BrowserContext } from "playwright";

type Api2Row = { path: string; status: number };

const debugNet =
  process.env.REALTOR_PW_DEBUG === "1" ||
  process.env.REALTOR_PW_DEBUG === "true" ||
  process.env.REALTOR_PW_DEBUG === "yes";

/** Short hint for Playwright `requestfailed` errorText (Chrome net::… codes). */
function requestFailedHint(errorText: string): string {
  const e = errorText.toLowerCase();
  if (e.includes("err_aborted")) {
    return " — usually cancelled (navigation, hash change, or SPA), not a permanent MLS block.";
  }
  if (e.includes("err_blocked_by_client")) {
    return " — often an extension/adblocker; allow realtor.ca or use the CDP profile without blockers.";
  }
  if (e.includes("err_failed")) {
    return " — generic; common when an in-flight XHR is dropped during load. If you later see api2 responses with status 200, MLS is fine.";
  }
  if (e.includes("err_connection") || e.includes("err_internet_disconnected") || e.includes("err_name_not_resolved")) {
    return " — network/DNS/offline or VPN issue.";
  }
  return "";
}

/**
 * Realtor's map calls `https://api2.realtor.ca/...`. When the edge returns **403**, Chrome often also logs
 * "CORS policy" because the error body doesn't include ACAO — that is not fixed by --disable-web-security.
 *
 * Listen on **BrowserContext** (not only Page) so we do not miss XHR/fetch tied to workers or odd frame wiring.
 *
 * Also counts other `*.realtor.ca` hosts (e.g. api37) so a run with **no api2** but **some** MLS-adjacent traffic
 * is easier to interpret than a total blank.
 */
export function attachApi2Diagnostics(context: BrowserContext): {
  didSeeApi2Forbidden: () => boolean;
  hasAnyApi2Response: () => boolean;
  printSummary: (label: string) => void;
  warnIfNoApi2Calls: (label: string) => void;
} {
  const rows: Api2Row[] = [];
  /** Non-www `*.realtor.ca` hosts excluding api2 (which is tracked in `rows`). */
  const otherRealtorHosts = new Map<string, number>();
  let forbiddenLogged = false;

  context.on("response", (response) => {
    const u = response.url();
    let host: string;
    let path: string;
    try {
      const parsed = new URL(u);
      host = parsed.hostname;
      path = parsed.pathname;
    } catch {
      return;
    }
    if (!host.endsWith("realtor.ca") || host === "www.realtor.ca") return;

    const status = response.status();

    if (host !== "api2.realtor.ca") {
      otherRealtorHosts.set(host, (otherRealtorHosts.get(host) ?? 0) + 1);
      return;
    }

    rows.push({ path, status });
    if (debugNet) {
      console.error(`[realtor-playwright-cli] REALTOR_PW_DEBUG api2 ${status} ${path}`);
    }

    if ((status === 403 || status === 401) && !forbiddenLogged) {
      forbiddenLogged = true;
      console.error(`
[realtor-playwright-cli] api2.realtor.ca returned HTTP ${status} — MLS listing APIs are refusing this browser session.
  • If the same URL shows listings in manual Chrome/Incognito but not here, automation is being singled out — not your map-url.txt.
  • DevTools may also say "CORS"; that often happens when the real problem is 403 (response has no CORS headers).
  • Disabling web security in Chromium does not fix server-side 403.
  • Prefer: REALTOR_PW_CDP_ENDPOINT=http://127.0.0.1:9222 (attach to Chrome you start with --remote-debugging-port=9222; see README).
  • Optional: REALTOR_PW_CHANNEL=chrome (system Chrome; still an automation launch, may differ from CDP).
`);
    }
  });

  context.on("requestfailed", (request) => {
    const u = request.url();
    if (!u.includes("api2.realtor.ca")) return;
    let path: string;
    try {
      path = new URL(u).pathname;
    } catch {
      path = u.slice(0, 96);
    }
    const err = request.failure()?.errorText ?? "unknown";
    const hint = requestFailedHint(err);
    console.error(`[realtor-playwright-cli] api2.realtor.ca request failed: ${path} — ${err}${hint}`);
  });

  function summarize(): Map<string, Set<number>> {
    const m = new Map<string, Set<number>>();
    for (const r of rows) {
      if (!m.has(r.path)) m.set(r.path, new Set());
      m.get(r.path)!.add(r.status);
    }
    return m;
  }

  return {
    didSeeApi2Forbidden: () => rows.some((r) => r.status === 403 || r.status === 401),
    hasAnyApi2Response: () => rows.length > 0,
    printSummary: (label: string) => {
      if (rows.length === 0) {
        console.error(
          `[realtor-playwright-cli] ${label}: no api2.realtor.ca HTTP responses were captured — MLS APIs may not have run, or requests failed before a response.`
        );
        if (otherRealtorHosts.size > 0) {
          console.error(
            `[realtor-playwright-cli] ${label}: other *.realtor.ca API hosts (non-api2) did respond — counts by host:`
          );
          for (const [h, n] of [...otherRealtorHosts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            console.error(`  ${h}: ${n} response(s)`);
          }
        }
        return;
      }
      const m = summarize();
      const lines = [...m.entries()].map(([path, sts]) => `${path} → ${[...sts].sort().join(",")}`);
      console.error(`[realtor-playwright-cli] ${label}: api2.realtor.ca (${rows.length} response(s)):`);
      for (const line of lines.slice(0, 14)) {
        console.error(`  ${line}`);
      }
      if (lines.length > 14) {
        console.error(`  … +${lines.length - 14} path(s)`);
      }
    },
    warnIfNoApi2Calls: (label: string) => {
      if (rows.length === 0) {
        console.error(
          `[realtor-playwright-cli] Warning (${label}): no api2.realtor.ca traffic yet — search may not have triggered MLS endpoints.`
        );
      }
    }
  };
}
