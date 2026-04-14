/**
 * DOM extraction for Realtor.ca map search. Prefer link hrefs (`/real-estate/`) over class names.
 * HIGH_RISK: `CONTAINER_SELECTORS` uses `[class*="…"]` and tag heuristics — may break on redesign.
 */
import type { Page } from "playwright";
import type { DomListingCard, DomSearchPageInfo } from "./realtor-dom-types";

/** Match listing detail URLs; case-insensitive because some builds vary path casing. */
export const REALTOR_LISTING_PATH_RE = /\/real-estate\//i;

/** High-risk: class-based hooks; we try closest() in order. Documented for maintainers. */
const CONTAINER_SELECTORS = [
  "article",
  '[class*="listingCard"]',
  '[class*="ListingCard"]',
  '[class*="property-card"]',
  '[class*="PropertyCard"]',
  '[class*="card"]',
  "li"
] as const;

/**
 * Parse numeric fields from visible card text (language mostly EN; FR may reduce matches).
 * Exported for unit tests.
 */
export function parseFieldsFromCardText(text: string): {
  price?: number;
  beds?: number;
  baths?: number;
  propertyType?: string;
  badges: string[];
} {
  const compact = text.replace(/\s+/gu, " ").trim();
  const badges: string[] = [];
  const badgeChecks: Array<[RegExp, string]> = [
    [/\bNEW\b/i, "NEW"],
    [/\bUPDATED\b/i, "UPDATED"],
    [/\bOPEN\s+HOUSE\b/i, "OPEN HOUSE"],
    [/\bPRICE\s+CHANGE\b/i, "PRICE CHANGE"],
    [/\bCOMING\s+SOON\b/i, "COMING SOON"]
  ];
  for (const [re, label] of badgeChecks) {
    if (re.test(compact)) badges.push(label);
  }
  const deduped = Array.from(new Set(badges)).slice(0, 12);

  const priceM = compact.match(/\$\s*([\d,]+)(?!\s*[-–]\s*\$)/u);
  const price =
    priceM?.[1] !== undefined
      ? Number(String(priceM[1]).replace(/,/gu, ""))
      : undefined;
  const priceFinal = price !== undefined && Number.isFinite(price) && price > 0 ? price : undefined;

  const bedM = compact.match(/(\d+(?:\.\d+)?)\s*(?:bed|beds|bedroom|bedrooms|bd|br)\b/iu);
  const bathM = compact.match(/(\d+(?:\.\d+)?)\s*(?:bath|baths|bathroom|bathrooms|ba)\b/iu);
  const beds = bedM?.[1] !== undefined ? Number(bedM[1]) : undefined;
  const baths = bathM?.[1] !== undefined ? Number(bathM[1]) : undefined;

  const typeMatch = compact.match(
    /\b(Detached|Semi-Detached|Attached|Townhouse|Row\s*\/\s*Townhouse|Condo|Apartment|Duplex|Triplex|Fourplex|House|Mobile|Manufactured|Garden\s+Home)\b/iu
  );
  const propertyType = typeMatch?.[1]?.replace(/\s+/gu, " ").trim();

  return {
    price: priceFinal,
    beds: beds !== undefined && Number.isFinite(beds) ? beds : undefined,
    baths: baths !== undefined && Number.isFinite(baths) ? baths : undefined,
    propertyType,
    badges: deduped
  };
}

function guessAddressLine(text: string): string | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 4)) {
    if (/^\$\s*[\d,]+/u.test(line)) break;
    if (/\b(?:bed|bath|sq\.?\s*ft|ft²)\b/iu.test(line)) break;
    if (line.length > 8 && /[a-z]/iu.test(line) && /\d/.test(line)) {
      return line;
    }
  }
  return undefined;
}

export type RawDomCard = {
  href: string;
  containerText: string;
  containerSelector?: string;
  imageUrl?: string;
};

/**
 * Turn raw evaluate output into DomListingCard (shared by page + tests).
 */
export function rawDomCardsToListingCards(raw: RawDomCard[]): DomListingCard[] {
  const out: DomListingCard[] = [];
  for (const row of raw) {
    const parsed = parseFieldsFromCardText(row.containerText);
    const address = guessAddressLine(row.containerText);
    out.push({
      listingUrl: row.href,
      address,
      price: parsed.price,
      beds: parsed.beds,
      baths: parsed.baths,
      propertyType: parsed.propertyType,
      imageUrl: row.imageUrl,
      badges: [...new Set([...parsed.badges])].slice(0, 12),
      containerSelector: row.containerSelector,
      textSnippet: row.containerText.slice(0, 220)
    });
  }
  return out;
}

function fixAddressField(card: DomListingCard): DomListingCard {
  if (card.address) return card;
  const line = guessAddressLine(card.textSnippet ?? "");
  return line ? { ...card, address: line } : card;
}

/**
 * Runs in browser: collect unique listing links and surrounding container text.
 */
export async function extractRawDomCardsFromPage(page: Page): Promise<RawDomCard[]> {
  return page.evaluate((selectors: readonly string[]) => {
    function absolutize(href: string): string {
      try {
        return new URL(href, window.location.origin).href;
      } catch {
        return href;
      }
    }

    const seen = new Set<string>();
    const rows: RawDomCard[] = [];
    const anchors = Array.from(document.querySelectorAll("a")).filter((a) =>
      REALTOR_LISTING_PATH_RE.test(a.getAttribute("href") ?? "")
    );

    for (const a of anchors) {
      const rawHref = a.getAttribute("href") ?? "";
      if (!REALTOR_LISTING_PATH_RE.test(rawHref)) continue;
      const href = absolutize(rawHref);
      if (!/\/real-estate\/[^/]+/iu.test(href)) continue;
      if (seen.has(href)) continue;
      seen.add(href);

      let container: Element | null = null;
      let usedSel: string | undefined;
      for (const sel of selectors) {
        const c = a.closest(sel);
        if (c) {
          container = c;
          usedSel = sel;
          break;
        }
      }
      const root = container ?? a.parentElement ?? a;
      const containerText = (root.textContent ?? "").replace(/\s+/gu, " ").trim();
      const img = root.querySelector("img[src]");
      const imgSrc = img ? absolutize(img.getAttribute("src") ?? "") : undefined;

      rows.push({
        href,
        containerText: containerText.slice(0, 4000),
        containerSelector: usedSel,
        imageUrl: imgSrc
      });
    }
    return rows;
  }, CONTAINER_SELECTORS);
}

export async function extractListingCardsFromPage(page: Page): Promise<DomListingCard[]> {
  const raw = await extractRawDomCardsFromPage(page);
  return rawDomCardsToListingCards(raw).map(fixAddressField);
}

/** Browser-only script as a string so tsx does not inject `__name` on nested `function` (breaks in page.evaluate). */
const COLLECT_REAL_ESTATE_URLS_DEEP = `(() => {
  const pathRe = /\\/real-estate\\/\\d+/i;
  const seen = new Set();
  const addHref = (href) => {
    if (!href || !pathRe.test(href)) return;
    try {
      const abs = new URL(href, window.location.origin).href;
      if (!pathRe.test(abs)) return;
      seen.add(abs);
    } catch (e) {}
  };
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      const el = node;
      addHref(el.getAttribute("href"));
      const sr = el.shadowRoot;
      if (sr) {
        for (let i = 0; i < sr.childNodes.length; i++) visit(sr.childNodes[i]);
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]);
  };
  if (document.documentElement) visit(document.documentElement);
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement) visit(doc.documentElement);
    } catch (e) {}
  }
  return Array.from(seen);
})()`;

/** Collect `/real-estate/<id>` URLs including inside open shadow roots and same-origin iframes. */
async function collectRealEstateListingHrefsDeep(page: Page): Promise<string[]> {
  return page.evaluate(COLLECT_REAL_ESTATE_URLS_DEEP);
}

/** Wait until at least one listing link appears (paths like `/real-estate/<digits>`), including shadow DOM. */
export async function waitForListingAnchors(page: Page, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const urls = await collectRealEstateListingHrefsDeep(page);
    if (urls.length > 0) return;
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`timeout ${timeoutMs}ms waiting for /real-estate/ listing links`);
}

/**
 * Page-level hints: totals, pagination (best-effort; high false-positive/negative rate).
 */
export async function parseSearchPageInfo(page: Page): Promise<DomSearchPageInfo | null> {
  const snapshot = await page.evaluate(() => {
    const t = document.body?.innerText ?? "";
    const buttons = Array.from(document.querySelectorAll("button, a[role='button'], [role='button']"))
      .map((el) => (el.textContent ?? "").replace(/\s+/gu, " ").trim())
      .filter(Boolean)
      .slice(0, 80);
    return { text: t.slice(0, 12000), buttons };
  });

  const text = snapshot.text;
  const lower = text.toLowerCase();
  let totalResultsHint: number | undefined;
  const ofMatch = text.match(/(?:of|\/)\s*([\d,]+)\s*$/imu) ?? text.match(/\bof\s+([\d,]+)\s+listing/iu);
  if (ofMatch?.[1]) {
    const n = Number(ofMatch[1].replace(/,/gu, ""));
    if (Number.isFinite(n)) totalResultsHint = n;
  }
  const resultsLabel = text.match(/Results:\s*([\d,]+)/iu);
  if (resultsLabel?.[1] && totalResultsHint === undefined) {
    const n = Number(resultsLabel[1].replace(/,/gu, ""));
    if (Number.isFinite(n)) totalResultsHint = n;
  }

  let currentPage: number | undefined;
  const pageMatch = text.match(/\bPage\s+(\d+)\s*(?:\/|of)\s*(\d+)/iu);
  if (pageMatch?.[1]) {
    const n = Number(pageMatch[1]);
    if (Number.isFinite(n)) currentPage = n;
  }

  let hasNext: boolean | undefined;
  if (/\bshow\s+more\b/iu.test(text) || /\bload\s+more\b/iu.test(text)) {
    hasNext = true;
  }
  if (snapshot.buttons.some((b) => /\bnext\b/iu.test(b) && !/^\s*1\s*$/u.test(b))) {
    hasNext = true;
  }
  if (/\bnext\s+page\b/iu.test(lower)) {
    hasNext = true;
  }

  if (
    totalResultsHint === undefined &&
    currentPage === undefined &&
    hasNext === undefined &&
    text.length < 40
  ) {
    return null;
  }

  return {
    totalResultsHint,
    currentPage,
    hasNext,
    rawTextSnippet: text.slice(0, 400)
  };
}
