import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFieldsFromCardText,
  rawDomCardsToListingCards,
  type RawDomCard
} from "./realtor-dom-extract";
import { domCardsToExplorePayloads } from "./realtor-dom-payload";

test("parseFieldsFromCardText extracts price beds baths type and badges", () => {
  const text = `NEW\n123 Main St, Victoria, BC\n$899,900\n3 bed\n2 bath\nHouse\n`;
  const p = parseFieldsFromCardText(text);
  assert.equal(p.price, 899900);
  assert.equal(p.beds, 3);
  assert.equal(p.baths, 2);
  assert.equal(p.propertyType, "House");
  assert.ok(p.badges.includes("NEW"));
});

test("rawDomCardsToListingCards maps href and fields", () => {
  const raw: RawDomCard[] = [
    {
      href: "https://www.realtor.ca/real-estate/12345678/some-slug",
      containerText:
        "UPDATED 456 Oak Ave $1,200,000 4 bed 3 bath Condo https://cdn.realtor.ca/x.jpg",
      containerSelector: "article",
      imageUrl: "https://cdn.realtor.ca/x.jpg"
    }
  ];
  const cards = rawDomCardsToListingCards(raw);
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.listingUrl, "https://www.realtor.ca/real-estate/12345678/some-slug");
  assert.equal(cards[0]?.price, 1_200_000);
  assert.equal(cards[0]?.beds, 4);
  assert.equal(cards[0]?.baths, 3);
  assert.equal(cards[0]?.propertyType, "Condo");
  assert.ok((cards[0]?.badges ?? []).includes("UPDATED"));
  assert.equal(cards[0]?.containerSelector, "article");
});

test("domCardsToExplorePayloads sets source and listing id from URL", () => {
  const cards = rawDomCardsToListingCards([
    {
      href: "https://www.realtor.ca/real-estate/87654321/x",
      containerText: "$500,000 2 bed 1 bath Townhouse",
      imageUrl: undefined
    }
  ]);
  const payloads = domCardsToExplorePayloads(cards);
  assert.equal(payloads[0]?.sourceListingId, "87654321");
  assert.equal(payloads[0]?.source, "realtor.ca");
  assert.equal(payloads[0]?.rawSnapshot.dom, true);
});
