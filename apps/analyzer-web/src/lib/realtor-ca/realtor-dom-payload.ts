import { inferMissingFields, scrapeConfidenceFromMissing } from "./payload-utils";
import type { DomListingCard } from "./realtor-dom-types";
import type { RealtorExploreListingPayload } from "./types";

const MLS_IN_PATH = /\/real-estate\/(\d{6,12})(?:\/|$)/iu;

export function listingIdFromRealtorUrl(url: string): string | undefined {
  const m = url.match(MLS_IN_PATH);
  return m?.[1];
}

/**
 * Map DOM cards to the same payload shape as API explore (lower confidence; sparse fields).
 */
export function domCardsToExplorePayloads(cards: DomListingCard[]): RealtorExploreListingPayload[] {
  return cards.map((card) => {
    const sourceListingId = listingIdFromRealtorUrl(card.listingUrl);
    const photoUrls = card.imageUrl ? [card.imageUrl] : undefined;
    const payload: RealtorExploreListingPayload = {
      source: "realtor.ca",
      sourceListingId,
      url: card.listingUrl,
      address: card.address,
      price: card.price,
      beds: card.beds,
      baths: card.baths,
      propertyType: card.propertyType,
      photoUrls,
      scrapeConfidence: 0.45,
      missingFields: [],
      rawSnapshot: {
        dom: true,
        badges: card.badges,
        containerSelector: card.containerSelector,
        textSnippet: card.textSnippet
      }
    };
    payload.missingFields = inferMissingFields(payload);
    payload.scrapeConfidence = scrapeConfidenceFromMissing(payload.missingFields);
    return payload;
  });
}
