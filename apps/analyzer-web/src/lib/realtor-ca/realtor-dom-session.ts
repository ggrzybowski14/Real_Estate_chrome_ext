import type { Page } from "playwright";
import {
  logRealtorBrowser,
  resolveExploreDomKeepBrowserOpen,
  resolvePlaywrightHeadless
} from "./realtor-browser-log";

const PLAYWRIGHT_INSTALL_HINT = " If browsers are missing, run: npx playwright install chromium";

/**
 * Launches Chromium and navigates to the given Realtor.ca URL (map hash search).
 * Does not call api37 — DOM-only path.
 */
export async function withRealtorDomPlaywrightSession<T>(
  targetUrl: string,
  run: (page: Page) => Promise<T>
): Promise<T> {
  const keepBrowserOpen = resolveExploreDomKeepBrowserOpen();
  logRealtorBrowser("domExplore:launchRequest", {
    targetUrlSnippet: targetUrl.slice(0, 160),
    waitUntil: "load",
    gotoTimeoutMs: 90_000,
    keepBrowserOpen
  });

  const playwright = await import("playwright");
  const headless = resolvePlaywrightHeadless();
  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    logRealtorBrowser("domExplore:chromiumLaunched", {
      targetUrlSnippet: targetUrl.slice(0, 120)
    });
  } catch (e) {
    logRealtorBrowser("domExplore:launchFailed", {
      message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
    });
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg}${PLAYWRIGHT_INSTALL_HINT}`);
  }
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      locale: "en-CA",
      viewport: { width: 1280, height: 800 }
    });
    logRealtorBrowser("domExplore:contextCreated", { viewport: "1280x800", locale: "en-CA" });
    const page = await context.newPage();
    logRealtorBrowser("domExplore:gotoStart", { targetUrlSnippet: targetUrl.slice(0, 120) });
    await page.goto(targetUrl, {
      waitUntil: "load",
      timeout: 90_000
    });
    const finalUrl = page.url();
    const title = (await page.title()).replace(/\s+/gu, " ").trim().slice(0, 120);
    logRealtorBrowser("domExplore:gotoDone", {
      finalUrlSnippet: finalUrl.slice(0, 160),
      titleSnippet: title || "(empty)"
    });
    return await run(page);
  } finally {
    if (keepBrowserOpen) {
      logRealtorBrowser("domExplore:browserLeftOpen", {
        hint: "EXPLORE_DOM_KEEP_BROWSER_OPEN=true — close Chromium manually when done."
      });
    } else {
      logRealtorBrowser("domExplore:browserClose");
      await browser.close();
    }
  }
}
