/**
 * Shared Playwright diagnostics for Realtor + rentals flows.
 * Set PLAYWRIGHT_HEADLESS=false (exact string) for a visible browser window; restart Next after changing .env.
 */

export function resolvePlaywrightHeadless(): boolean {
  return process.env.PLAYWRIGHT_HEADLESS !== "false";
}

/** When true, DOM explore leaves Chromium open after the run (debugging). Set EXPLORE_DOM_KEEP_BROWSER_OPEN=true. */
export function resolveExploreDomKeepBrowserOpen(): boolean {
  return process.env.EXPLORE_DOM_KEEP_BROWSER_OPEN === "true";
}

export function playwrightHeadlessDiagnostics(): {
  PLAYWRIGHT_HEADLESS_raw: string;
  headless: boolean;
  headlessHint: string;
} {
  const raw = process.env.PLAYWRIGHT_HEADLESS;
  let PLAYWRIGHT_HEADLESS_raw: string;
  if (raw === undefined) {
    PLAYWRIGHT_HEADLESS_raw = "(unset)";
  } else if (raw === "") {
    PLAYWRIGHT_HEADLESS_raw = "(empty string)";
  } else {
    PLAYWRIGHT_HEADLESS_raw = raw;
  }
  const headless = resolvePlaywrightHeadless();
  const headlessHint = headless
    ? "Using headless Chromium. For a visible window set PLAYWRIGHT_HEADLESS=false in apps/analyzer-web/.env.local and restart next dev."
    : "Using headed Chromium (visible window).";
  return { PLAYWRIGHT_HEADLESS_raw, headless, headlessHint };
}

export function logRealtorBrowser(
  phase: string,
  meta?: Record<string, string | number | boolean | undefined>
): void {
  const d = playwrightHeadlessDiagnostics();
  const safe =
    meta === undefined
      ? {}
      : (Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)) as Record<
          string,
          string | number | boolean
        >);
  console.info("[realtor-browser]", { phase, ...d, ...safe });
}
