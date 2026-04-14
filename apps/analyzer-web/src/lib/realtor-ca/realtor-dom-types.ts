/**
 * Raw card data extracted from Realtor.ca map/list DOM (prototype).
 * Field names mirror what we try to read from the page — not guaranteed complete.
 */

export type DomListingCard = {
  listingUrl: string;
  address?: string;
  price?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  imageUrl?: string;
  badges: string[];
  /** Which container selector matched (high-risk — for debugging). */
  containerSelector?: string;
  /** Short innerText sample for debugging (truncated). */
  textSnippet?: string;
};

export type DomSearchPageInfo = {
  /** Regex / UI hint for total hits, if parsed. */
  totalResultsHint?: number;
  currentPage?: number;
  /** True if a Next or Show more control appears actionable. */
  hasNext?: boolean;
  rawTextSnippet: string;
};

export const REALTOR_DOM_ERROR_BLOCKED = "REALTOR_DOM_BLOCKED_OR_INCOMPLETE";

/** Snapshot of what Playwright saw when a DOM explore fails (for debugging timeouts vs bad search). */
export type DomExploreDiagnostics = {
  mapUrl: string;
  pageUrl: string;
  pageTitle: string;
  listingLinkCount: number;
  waitMs?: number;
  /** First ~600 chars of visible body text (whitespace collapsed). */
  bodyTextSample?: string;
};

export class RealtorDomExploreError extends Error {
  readonly code: typeof REALTOR_DOM_ERROR_BLOCKED | "REALTOR_DOM_NO_LISTINGS_TIMEOUT";
  readonly diagnostics?: DomExploreDiagnostics;

  constructor(
    message: string,
    code: typeof REALTOR_DOM_ERROR_BLOCKED | "REALTOR_DOM_NO_LISTINGS_TIMEOUT" = REALTOR_DOM_ERROR_BLOCKED,
    diagnostics?: DomExploreDiagnostics
  ) {
    super(message);
    this.name = "RealtorDomExploreError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
