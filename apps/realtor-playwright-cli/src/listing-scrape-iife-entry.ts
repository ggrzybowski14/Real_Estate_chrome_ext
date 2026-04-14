/**
 * Bundled for the browser context (Playwright addInitScript). Exposes window.__rea_scrapeListing().
 */
import { scrapeListingPagePayload } from "./listing-page-scrape.js";

declare global {
  interface Window {
    __rea_scrapeListing: () => ReturnType<typeof scrapeListingPagePayload>;
  }
}

window.__rea_scrapeListing = () => scrapeListingPagePayload();
