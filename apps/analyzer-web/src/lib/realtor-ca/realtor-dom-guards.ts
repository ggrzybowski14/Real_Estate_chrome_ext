import type { Page } from "playwright";
import { RealtorDomExploreError, REALTOR_DOM_ERROR_BLOCKED } from "./realtor-dom-types";

/**
 * Title hints for a dedicated error/challenge document.
 * Avoid "Just a moment" — CDNs often use that as a transient loading title before the real page.
 */
const BLOCK_TITLE_SUBSTRINGS = [
  /access denied/i,
  /forbidden/i,
  /attention required/i,
  /pardon (our )?interruption/i
];

/**
 * Incapsula **block page** shows "Incident ID: …" in visible copy. That string sometimes appears inside
 * `<script>`/JSON in **normal** pages too — scanning `page.content()` false-positives. Only check
 * `document.body.innerText`.
 */
const INCAPSULA_INCIDENT_VISIBLE_RE = /Incapsula\s+incident\s+ID\s*:\s*\d+/i;

export type DomGuardContext = {
  phase: "afterNavigation" | "afterListingWait";
  listingLinkCount: number;
  /**
   * After a listing wait timeout, skip the "no links ≠ empty" heuristic — it misclassified timeouts
   * as block pages. Hard blocks (title/HTML regex) still apply.
   */
  skipNoLinksSemanticGuard?: boolean;
};

/**
 * Throws RealtorDomExploreError if the page looks like a WAF/challenge or obviously broken HTML shell.
 */
export async function detectBlockedOrIncomplete(page: Page, context: DomGuardContext): Promise<void> {
  const url = page.url();
  const title = (await page.title()).replace(/\s+/gu, " ").trim();
  const html = await page.content();
  const htmlStart = html.slice(0, 8000);

  for (const re of BLOCK_TITLE_SUBSTRINGS) {
    if (re.test(title)) {
      throw new RealtorDomExploreError(
        `${REALTOR_DOM_ERROR_BLOCKED}: Suspicious page title (${title.slice(0, 120)})`,
        REALTOR_DOM_ERROR_BLOCKED
      );
    }
  }

  const visibleText = await page.evaluate(() => document.body?.innerText ?? "");
  if (INCAPSULA_INCIDENT_VISIBLE_RE.test(visibleText)) {
    throw new RealtorDomExploreError(
      `${REALTOR_DOM_ERROR_BLOCKED}: Incapsula block page (incident ID visible on screen — not in script noise)`,
      REALTOR_DOM_ERROR_BLOCKED
    );
  }

  if (url.includes("incapsula") || url.includes("challenge")) {
    throw new RealtorDomExploreError(
      `${REALTOR_DOM_ERROR_BLOCKED}: URL suggests challenge flow (${url.slice(0, 200)})`,
      REALTOR_DOM_ERROR_BLOCKED
    );
  }

  const bodyLen = html.length;
  if (bodyLen < 800) {
    throw new RealtorDomExploreError(
      `${REALTOR_DOM_ERROR_BLOCKED}: Response HTML unusually short (${bodyLen} chars)`,
      REALTOR_DOM_ERROR_BLOCKED
    );
  }

  if (
    !context.skipNoLinksSemanticGuard &&
    context.phase === "afterListingWait" &&
    context.listingLinkCount === 0
  ) {
    const hasNoResults =
      /no results|aucun résultat|0\s+listings|please refine|affiner votre recherche/i.test(htmlStart);
    if (hasNoResults) {
      return;
    }
    const loadingLike = /loading|spinner|please wait/i.test(htmlStart) && htmlStart.length < 4000;
    if (loadingLike) {
      throw new RealtorDomExploreError(
        `${REALTOR_DOM_ERROR_BLOCKED}: Page may still be loading or listings failed to render (no /real-estate/ links)`,
        REALTOR_DOM_ERROR_BLOCKED
      );
    }
    throw new RealtorDomExploreError(
      `${REALTOR_DOM_ERROR_BLOCKED}: No listing links found and page does not clearly indicate empty results`,
      REALTOR_DOM_ERROR_BLOCKED
    );
  }
}
